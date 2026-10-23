'use strict';
const crypto = require('crypto');
const { GameError } = require('../engine/table');

const ROLE_NAMES = { civ: 'Мирный житель', maf: 'Мафия', don: 'Дон мафии', com: 'Комиссар', doc: 'Доктор' };
const MAFIA = new Set(['maf', 'don']);
const isBot = (u) => typeof u === 'string' && u.startsWith('bot:');

function rolesFor(n) {
  const mafia = Math.max(1, Math.floor(n / 3));
  const roles = [];
  for (let k = 0; k < mafia; k++) roles.push(k === 0 && mafia >= 2 ? 'don' : 'maf');
  roles.push('com');
  if (n >= 6) roles.push('doc');
  while (roles.length < n) roles.push('civ');
  return roles;
}

/**
 * Mafia with the server as the host. 5–10 players.
 * Night: the mafia picks a victim (the don also looks for the commissar), the commissar checks a player,
 * the doctor saves someone. Day: talk, then an open vote. The winning side splits the pot.
 *
 * deps: { charge, pay, onUpdate, onInPlay, onGameEnd(table, results) }
 */
class MafiaTable {
  constructor(cfg, deps = {}, opts = {}) {
    this.id = cfg.id;
    this.kind = 'mf';
    this.name = cfg.name;
    this.stake = cfg.stake;
    this.maxSeats = Math.min(10, Math.max(5, cfg.maxPlayers || 8));
    this.minPlayers = opts.minPlayers ?? 5;
    this.permanent = !!cfg.permanent;
    this.deps = deps;
    this.timers = opts.timers || { set: setTimeout, clear: clearTimeout };
    this.now = opts.now || Date.now;
    this.randomInt = opts.randomInt || crypto.randomInt;
    this.ms = {
      intro: opts.introMs ?? 9000, night: opts.nightMs ?? 35000, morning: opts.morningMs ?? 7000,
      day: opts.dayMs ?? 100000, vote: opts.voteMs ?? 30000, verdict: opts.verdictMs ?? 7000,
    };
    this.lateMs = opts.lateMs ?? Math.min(1500, Math.round(this.ms.night * 0.05)); // see _phase
    this.waitMs = opts.waitMs ?? Math.min(20000, Math.round(this.ms.night * 0.5)); // waiting once for a dropped player
    this.countdownMs = opts.countdown ?? 4000;
    this.resultPause = opts.resultPause ?? 12000;
    this.seats = Array(this.maxSeats).fill(null);
    this.status = 'waiting'; // waiting | countdown | playing | result
    this.g = null;
    this.gameNo = 0;
    this.pot = 0;
    this.result = null;
    this.log = [];
    this.chat = [];
    this._timer = null;
    this._flow = null;
    this.lastActivity = this.now();
  }

  seatOf(userId) { return this.seats.findIndex((s) => s && s.userId === userId); }

  /**
   * Who may speak and whom one may hear in the voice chat, by the rules of the game:
   * at night only the mafia talk among themselves; by day the living talk and the fallen only listen.
   * hear: null = everyone, otherwise the list of userIds whose voice is played.
   */
  voicePolicy(userId) {
    const g = this.g;
    if (!g || this.status !== 'playing') return { speak: true, hear: null, note: '' };
    const p = g.players.find((x) => x.userId === userId);
    const alive = g.players.filter((x) => x.alive);
    if (g.phase === 'night') {
      const fam = alive.filter((x) => MAFIA.has(x.role)).map((x) => x.userId);
      if (p && p.alive && MAFIA.has(p.role)) return { speak: true, hear: fam, note: 'Ночь: вас слышит только мафия' };
      return { speak: false, hear: [], note: 'Ночь: город спит, голос выключен' };
    }
    const living = alive.map((x) => x.userId);
    if (!p || !p.alive) return { speak: false, hear: living, note: 'Вы выбыли: только слушаете' };
    return { speak: true, hear: living, note: '' };
  }
  playerCount() { return this.seats.filter(Boolean).length; }
  freeSeat() { return this.seats.findIndex((s) => !s); }
  _update() { this.lastActivity = this.now(); (this.deps.onUpdate || (() => {}))(this); }
  _log(text) { this.log.push({ t: this.now(), text }); if (this.log.length > 100) this.log.shift(); }
  _clear(n) { if (this[n]) { this.timers.clear(this[n]); this[n] = null; } }
  _sys(text, channel = 'all') { this.chat.push({ t: this.now(), sys: true, text, channel }); if (this.chat.length > 120) this.chat.shift(); }

  sit(userId, name, seat) {
    if (this.seatOf(userId) !== -1) throw new GameError('Вы уже за этим столом');
    if (!Number.isInteger(seat) || seat < 0 || seat >= this.maxSeats) throw new GameError('Нет такого места');
    if (this.seats[seat]) throw new GameError('Место занято');
    if (this.status === 'playing') throw new GameError('Идёт партия — дождитесь следующей');
    this.seats[seat] = { userId, name, ready: false, connected: true };
    this._log(`${name} садится за стол`);
    this._update();
  }

  leave(userId) {
    const i = this.seatOf(userId);
    if (i === -1) return;
    const s = this.seats[i];
    if (this.status === 'playing') {
      const p = this._p(i);
      if (p && p.alive) { this._kill(p, 'left'); this._sys(`${p.name} покидает город. Роль: ${ROLE_NAMES[p.role]}`); this._checkWin(); }
    }
    this.seats[i] = null;
    this._maybeCountdown();
    this._update();
  }

  setConnected(userId, connected) {
    const i = this.seatOf(userId);
    if (i === -1) return;
    this.seats[i].connected = connected;
    this._update();
  }

  setReady(userId, ready) {
    const i = this.seatOf(userId);
    if (i === -1) throw new GameError('Сначала сядьте за стол');
    if (this.status === 'playing' || this.status === 'result') throw new GameError('Дождитесь конца партии');
    this.seats[i].ready = !!ready;
    this._maybeCountdown();
    this._update();
  }

  _maybeCountdown() {
    if (this.status !== 'waiting' && this.status !== 'countdown') return;
    const seated = this.seats.filter(Boolean);
    const go = seated.length >= this.minPlayers && seated.every((s) => s.ready);
    if (go && this.status === 'waiting') {
      this.status = 'countdown';
      this.countdownEnds = this.now() + this.countdownMs;
      this._flow = this.timers.set(() => { this._flow = null; this._start(); }, this.countdownMs);
    } else if (!go && this.status === 'countdown') { this._clear('_flow'); this.status = 'waiting'; }
  }

  _start() {
    const seats = [];
    this.seats.forEach((s, i) => { if (s && s.ready) seats.push(i); });
    if (seats.length < this.minPlayers) { this.status = 'waiting'; this._update(); return; }
    const paid = [];
    for (const i of seats) {
      const s = this.seats[i];
      if (this.deps.charge && !this.deps.charge(s.userId, this.stake)) {
        for (const j of paid) this.deps.pay && this.deps.pay(this.seats[j].userId, this.stake);
        s.ready = false;
        this._log(`${s.name}: не хватает фишек на ставку`);
        this.status = 'waiting';
        this._update();
        return;
      }
      paid.push(i);
    }
    const roles = rolesFor(seats.length);
    for (let k = roles.length - 1; k > 0; k--) { const j = this.randomInt(k + 1); [roles[k], roles[j]] = [roles[j], roles[k]]; }
    this.gameNo += 1;
    this.pot = this.stake * seats.length;
    this.chat = [];
    this.g = {
      players: seats.map((seat, k) => ({ seat, userId: this.seats[seat].userId, name: this.seats[seat].name, role: roles[k], alive: true, died: null })),
      phase: 'intro', day: 0, night: null, votes: {}, ready: new Set(), checks: {}, donChecks: {}, lastHeal: null, lastNews: null, verdict: null,
    };
    for (const i of seats) { this.seats[i].ready = false; this.deps.onInPlay && this.deps.onInPlay(this.seats[i].userId, this.stake); }
    this.status = 'playing';
    this.result = null;
    const mafia = roles.filter((r) => MAFIA.has(r)).length;
    this._log(`— Партия №${this.gameNo}: ${seats.length} игроков, мафии ${mafia}, банк ${this.pot} —`);
    this._sys(`Город засыпает спокойно… пока. Игроков: ${seats.length}, мафии среди них: ${mafia}. Узнайте свою роль.`);
    this._phase('intro');
  }

  _p(seat) { return this.g.players.find((p) => p.seat === seat); }
  _alive() { return this.g.players.filter((p) => p.alive); }
  _me(userId) {
    if (this.status !== 'playing') throw new GameError('Партия не идёт');
    const p = this._p(this.seatOf(userId));
    if (!p) throw new GameError('Вы не в этой партии');
    return p;
  }

  _phase(name) {
    const g = this.g;
    g.phase = name;
    this._clear('_timer');
    g.deadline = this.now() + this.ms[name];
    g.phaseMs = this.ms[name];
    g.extended = false;
    // night moves and votes get a little extra so a choice sent at the last second on a slow line still counts
    const late = name === 'night' || name === 'vote' ? this.lateMs : 0;
    this._timer = this.timers.set(() => { this._timer = null; this._phaseEnd(); }, this.ms[name] + late);
    this._update();
  }

  /** Players who still owe a night move or a vote and whose connection is down. */
  _pendingOffline() {
    const g = this.g;
    const n = g.night;
    const owes = (p) => {
      if (g.phase === 'vote') return g.votes[p.seat] === undefined;
      if (g.phase !== 'night') return false;
      return (MAFIA.has(p.role) && n.kills[p.seat] == null) || (p.role === 'don' && n.donCheck == null) || (p.role === 'com' && n.check == null) || (p.role === 'doc' && n.heal == null);
    };
    return this._alive().filter((p) => owes(p) && this.seats[p.seat] && !this.seats[p.seat].connected && !isBot(p.userId));
  }

  /** The phase time is up: once per phase, wait a little longer for someone whose connection dropped. */
  _phaseEnd() {
    const g = this.g;
    if (this.status !== 'playing') return;
    const away = (g.phase === 'night' || g.phase === 'vote') && !g.extended ? this._pendingOffline() : [];
    if (away.length) {
      g.extended = true;
      g.deadline = this.now() + this.waitMs;
      g.phaseMs = this.waitMs;
      this._sys(`Ждём ${away.map((p) => p.name).join(', ')}: связь прервалась`);
      this._timer = this.timers.set(() => { this._timer = null; this._next(); }, this.waitMs);
      this._update();
      return;
    }
    this._next();
  }

  _next() {
    if (this.status !== 'playing') return;
    const g = this.g;
    switch (g.phase) {
      case 'intro': case 'verdict': this._startNight(); break;
      case 'night': this._resolveNight(); break;
      case 'morning': if (!this._checkWin()) { g.ready = new Set(); this._phase('day'); this._sys('Обсуждение. Найдите мафию, пока не поздно.'); } break;
      case 'day': this._startVote(); break;
      case 'vote': this._resolveVote(); break;
      default:
    }
  }

  _startNight() {
    const g = this.g;
    g.day += 1;
    g.night = { kills: {}, heal: null, check: null, donCheck: null };
    this._sys(`Ночь ${g.day}. Город засыпает, просыпается мафия.`);
    this._phase('night');
  }

  /** Everyone with a night job has done it: no need to wait for the timer. */
  _nightDone() {
    const n = this.g.night;
    return this._alive().every((p) => {
      if (MAFIA.has(p.role) && n.kills[p.seat] == null) return false;
      if (p.role === 'don' && n.donCheck == null) return false;
      if (p.role === 'com' && n.check == null) return false;
      if (p.role === 'doc' && n.heal == null) return false;
      return true;
    });
  }

  nightAction(userId, kind, target) {
    const p = this._me(userId);
    const g = this.g;
    if (g.phase !== 'night') throw new GameError('Сейчас не ночь');
    if (!p.alive) throw new GameError('Вы выбыли из игры');
    const t = this._p(Number(target));
    if (!t || !t.alive) throw new GameError('Выберите живого игрока');
    const n = g.night;
    if (kind === 'kill') {
      if (!MAFIA.has(p.role)) throw new GameError('Вы не мафия');
      if (MAFIA.has(t.role)) throw new GameError('Своих не трогаем');
      n.kills[p.seat] = t.seat;
      this._sys(`${p.name} выбирает: ${t.name}`, 'maf');
    } else if (kind === 'check') {
      if (p.role !== 'com') throw new GameError('Вы не комиссар');
      if (n.check != null) throw new GameError('Вы уже проверили игрока этой ночью');
      if (t === p) throw new GameError('Себя проверять незачем');
      n.check = t.seat;
      (g.checks[p.seat] ||= []).push({ seat: t.seat, mafia: MAFIA.has(t.role) });
    } else if (kind === 'don') {
      if (p.role !== 'don') throw new GameError('Вы не дон');
      if (n.donCheck != null) throw new GameError('Вы уже искали комиссара этой ночью');
      n.donCheck = t.seat;
      (g.donChecks[p.seat] ||= []).push({ seat: t.seat, com: t.role === 'com' });
    } else if (kind === 'heal') {
      if (p.role !== 'doc') throw new GameError('Вы не доктор');
      if (g.lastHeal === t.seat) throw new GameError('Одного и того же игрока нельзя лечить две ночи подряд');
      n.heal = t.seat;
    } else throw new GameError('Неизвестное действие');
    if (this._nightDone()) { this._clear('_timer'); this._timer = this.timers.set(() => { this._timer = null; this._next(); }, 1500); }
    this._update();
  }

  _resolveNight() {
    const g = this.g;
    const n = g.night;
    const tally = {};
    for (const t of Object.values(n.kills)) tally[t] = (tally[t] || 0) + 1;
    const max = Math.max(0, ...Object.values(tally));
    const top = Object.keys(tally).filter((k) => tally[k] === max).map(Number);
    // the don's vote breaks a tie
    const don = this._alive().find((p) => p.role === 'don');
    let victim = null;
    if (top.length === 1) victim = top[0];
    else if (top.length > 1) victim = don && top.includes(n.kills[don.seat]) ? n.kills[don.seat] : top[this.randomInt(top.length)];
    g.lastHeal = n.heal;
    let news;
    if (victim != null && victim === n.heal) news = 'Этой ночью мафия промахнулась: доктор успел вовремя. Все живы.';
    else if (victim != null) {
      const v = this._p(victim);
      this._kill(v, 'night');
      news = `Этой ночью погиб ${v.name}. Роль: ${ROLE_NAMES[v.role]}.`;
    } else news = 'Ночь прошла тихо. Все живы.';
    g.lastNews = news;
    this._sys(`Утро ${g.day}. ${news}`);
    this._log(news);
    if (this._checkWin()) return;
    this._phase('morning');
  }

  _kill(p, how) { p.alive = false; p.died = { how, day: this.g.day }; }

  readyToVote(userId) {
    const p = this._me(userId);
    const g = this.g;
    if (g.phase !== 'day') throw new GameError('Сейчас не обсуждение');
    if (!p.alive) throw new GameError('Вы выбыли из игры');
    g.ready.add(p.seat);
    const humans = this._alive().filter((x) => !isBot(x.userId));
    if (humans.length && humans.every((x) => g.ready.has(x.seat))) this._startVote();
    else this._update();
  }

  _startVote() {
    const g = this.g;
    g.votes = {};
    this._sys('Голосование. Кого город отправит в тюрьму?');
    this._phase('vote');
  }

  vote(userId, target) {
    const p = this._me(userId);
    const g = this.g;
    if (g.phase !== 'vote') throw new GameError('Сейчас не голосование');
    if (!p.alive) throw new GameError('Вы выбыли из игры');
    if (g.votes[p.seat] !== undefined) throw new GameError('Вы уже проголосовали');
    let t = null;
    if (target != null && target !== 'skip') {
      const x = this._p(Number(target));
      if (!x || !x.alive) throw new GameError('Выберите живого игрока');
      if (x === p) throw new GameError('За себя голосовать нельзя');
      t = x.seat;
    }
    g.votes[p.seat] = t;
    if (this._alive().every((x) => g.votes[x.seat] !== undefined)) { this._clear('_timer'); this._timer = this.timers.set(() => { this._timer = null; this._next(); }, 1200); }
    this._update();
  }

  _resolveVote() {
    const g = this.g;
    const tally = {};
    for (const t of Object.values(g.votes)) if (t != null) tally[t] = (tally[t] || 0) + 1;
    const max = Math.max(0, ...Object.values(tally));
    const top = Object.keys(tally).filter((k) => tally[k] === max).map(Number);
    const skips = Object.values(g.votes).filter((t) => t == null).length;
    let text;
    if (!max || top.length > 1 || skips >= max) { text = top.length > 1 ? 'Голоса разделились — сегодня никого не посадили.' : 'Город решил никого не сажать.'; g.verdict = null; }
    else {
      const v = this._p(top[0]);
      this._kill(v, 'vote');
      g.verdict = v.seat;
      text = `Город отправляет в тюрьму: ${v.name} (${max} голос${max === 1 ? '' : max < 5 ? 'а' : 'ов'}). Роль: ${ROLE_NAMES[v.role]}.`;
    }
    this._sys(text);
    this._log(text);
    if (this._checkWin()) return;
    this._phase('verdict');
  }

  _checkWin() {
    const alive = this._alive();
    const maf = alive.filter((p) => MAFIA.has(p.role)).length;
    const town = alive.length - maf;
    if (maf === 0) { this._finish('town'); return true; }
    if (maf >= town) { this._finish('mafia'); return true; }
    return false;
  }

  _finish(side) {
    if (this.status !== 'playing') return;
    this._clear('_timer');
    const g = this.g;
    const winners = g.players.filter((p) => (side === 'mafia') === MAFIA.has(p.role));
    const share = winners.length ? Math.floor(this.pot / winners.length) : 0;
    let rest = this.pot - share * winners.length;
    const results = [];
    for (const p of g.players) {
      const win = winners.includes(p);
      const back = win ? share + (rest-- > 0 ? 1 : 0) : 0;
      if (back && this.deps.pay) this.deps.pay(p.userId, back);
      this.deps.onInPlay && this.deps.onInPlay(p.userId, 0);
      results.push({ userId: p.userId, seat: p.seat, net: back - this.stake, win, role: p.role, alive: p.alive });
    }
    this.status = 'result';
    g.phase = 'result';
    this.result = { side, winners: winners.map((p) => p.seat), roles: g.players.map((p) => ({ seat: p.seat, name: p.name, role: p.role, alive: p.alive })), pot: this.pot, share };
    const text = side === 'mafia' ? 'Мафия захватила город.' : 'Город победил: вся мафия за решёткой.';
    this._sys(`${text} Банк ${this.pot} делят победители.`);
    this._log(text);
    this.deps.onGameEnd && this.deps.onGameEnd(this, results);
    this.pot = 0;
    this._update();
    this._flow = this.timers.set(() => {
      this._flow = null;
      this.status = 'waiting';
      this.seats.forEach((s, i) => { if (s) { s.ready = false; if (!s.connected) this.seats[i] = null; } });
      this._update();
    }, this.resultPause);
  }

  destroy() {
    this._clear('_timer');
    this._clear('_flow');
    if (this.status === 'playing') for (const p of this.g.players) { if (this.deps.pay) this.deps.pay(p.userId, this.stake); this.deps.onInPlay && this.deps.onInPlay(p.userId, 0); }
    this.status = 'waiting';
  }

  /** Chat: alive players by day, the mafia among themselves at night. */
  say(userId, name, text, hue = null) {
    const i = this.seatOf(userId);
    let channel = 'all';
    if (this.status === 'playing') {
      const p = this._p(i);
      if (!p) throw new GameError('Во время партии пишут только игроки');
      if (!p.alive) throw new GameError('Выбывшие молчат до конца партии');
      if (this.g.phase === 'night') {
        if (!MAFIA.has(p.role)) throw new GameError('Ночью город спит');
        channel = 'maf';
      }
    }
    this.chat.push({ t: this.now(), name, text, hue, channel, seat: i });
    if (this.chat.length > 120) this.chat.shift();
    this._update();
  }

  summary() {
    return { id: this.id, kind: 'mf', name: this.name, stake: this.stake, maxSeats: this.maxSeats, minPlayers: this.minPlayers, players: this.playerCount(), status: this.status, permanent: this.permanent, private: !!this.private, owner: this.ownerName || null };
  }

  publicState(viewerId) {
    const mySeat = this.seatOf(viewerId);
    const g = this.g;
    const me = g && this.status !== 'waiting' ? this._p(mySeat) : null;
    const mafiaView = me && MAFIA.has(me.role) && this.status === 'playing';
    const st = {
      ...this.summary(),
      gameNo: this.gameNo, pot: this.pot, mySeat,
      countdownIn: this.status === 'countdown' ? Math.max(0, this.countdownEnds - this.now()) : 0,
      seats: this.seats.map((s) => s && { name: s.name, ready: s.ready, connected: s.connected, avatar: this.avatarOf ? this.avatarOf(s.userId) : null, bot: isBot(s.userId) }),
      log: this.log.slice(-30),
      chat: this.chat.filter((m) => m.channel === 'all' || (m.channel === 'maf' && (mafiaView || this.status === 'result'))).slice(-60),
      result: this.status === 'result' ? this.result : null,
      game: null, me: null,
    };
    if (g && (this.status === 'playing' || this.status === 'result')) {
      const reveal = (p) => this.status === 'result' || !p.alive || (me && p === me) || (mafiaView && MAFIA.has(p.role));
      st.game = {
        phase: g.phase, day: g.day,
        deadlineIn: this._timer ? Math.max(0, g.deadline - this.now()) : 0, phaseMs: g.phaseMs,
        players: g.players.map((p) => ({ seat: p.seat, name: p.name, alive: p.alive, died: p.died, role: reveal(p) ? p.role : null, ready: g.phase === 'day' && g.ready.has(p.seat) })),
        votes: g.phase === 'vote' || g.phase === 'verdict' ? { ...g.votes } : null,
        verdict: g.verdict, news: g.lastNews,
        mafiaCount: g.players.filter((p) => MAFIA.has(p.role) && p.alive).length,
      };
      if (me) {
        const n = g.night;
        st.me = {
          seat: me.seat, role: me.role, roleName: ROLE_NAMES[me.role], alive: me.alive,
          checks: me.role === 'com' ? g.checks[me.seat] || [] : null,
          donChecks: me.role === 'don' ? g.donChecks[me.seat] || [] : null,
          kills: mafiaView && n ? { ...n.kills } : null,
          acted: g.phase === 'night' && n ? {
            kill: n.kills[me.seat] ?? null, check: me.role === 'com' ? n.check : null, don: me.role === 'don' ? n.donCheck : null, heal: me.role === 'doc' ? n.heal : null,
          } : null,
          lastHeal: me.role === 'doc' ? g.lastHeal : null,
          hasVoted: g.phase === 'vote' ? g.votes[me.seat] !== undefined : false,
        };
      }
    }
    return st;
  }
}

module.exports = { MafiaTable, ROLE_NAMES, MAFIA, rolesFor };
