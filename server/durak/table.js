'use strict';
const { DurakGame, DurakError, sortHand } = require('./engine');
const { GameError } = require('../engine/table');

const VARIANT_NAMES = { podkidnoy: 'Подкидной', perevodnoy: 'Переводной' };
const MAX_MISSED = 3;

/**
 * A durak table: seats, "ready" check, stakes and the game timer.
 * Everyone who starts a game puts the stake in the pot; the durak loses it,
 * the others split the pot. A draw refunds everybody.
 *
 * deps: { charge(userId, amount) -> boolean, pay(userId, amount), canAfford(userId, amount) -> boolean,
 *         onUpdate(table), onGameEnd(table) }
 */
class DurakTable {
  constructor(cfg, deps = {}, opts = {}) {
    this.id = cfg.id;
    this.name = cfg.name;
    this.variant = cfg.variant === 'perevodnoy' ? 'perevodnoy' : 'podkidnoy';
    this.stake = cfg.stake;
    this.maxPlayers = Math.min(6, Math.max(2, cfg.maxPlayers || 4));
    this.permanent = !!cfg.permanent;
    this.createdBy = cfg.createdBy || null;
    this.kind = 'durak';

    this.deps = deps;
    this.actionTime = opts.actionTime ?? 30000;
    this.awayTime = opts.awayTime ?? 6000;
    this.countdownMs = opts.countdown ?? 3000;
    this.resultPause = opts.resultPause ?? 7000;
    this.timers = opts.timers || { set: setTimeout, clear: clearTimeout };
    this.now = opts.now || Date.now;
    this.randomInt = opts.randomInt;

    this.seats = Array(this.maxPlayers).fill(null);
    this.status = 'waiting'; // waiting | countdown | playing | result
    this.game = null;
    this.players = []; // seat indices in the current game
    this.pot = 0;
    this.result = null;
    this.deadline = 0;
    this.countdownEnds = 0;
    this.gameNo = 0;
    this.log = [];
    this.chat = [];
    this._timer = null;
    this._flow = null;
    this.lastActivity = this.now();
  }

  // ---------- seating ----------

  seatOf(userId) { return this.seats.findIndex((s) => s && s.userId === userId); }
  playerCount() { return this.seats.filter(Boolean).length; }
  _update() { this.lastActivity = this.now(); (this.deps.onUpdate || (() => {}))(this); }
  _log(text) { this.log.push({ t: this.now(), text }); if (this.log.length > 60) this.log.shift(); }
  _name(seat) {
    if (this.seats[seat]) return this.seats[seat].name;
    return (this._nameBySeat && this._nameBySeat.get(seat)) || `Место ${seat + 1}`;
  }

  sit(userId, name, seatIdx) {
    if (this.seatOf(userId) !== -1) throw new GameError('Вы уже за этим столом');
    if (!Number.isInteger(seatIdx) || seatIdx < 0 || seatIdx >= this.maxPlayers) throw new GameError('Нет такого места');
    if (this.seats[seatIdx]) throw new GameError('Место занято');
    if (this.players.includes(seatIdx) && this.status === 'playing') throw new GameError('Место занято до конца партии');
    this.seats[seatIdx] = { userId, name, ready: false, connected: true };
    this._log(`${name} садится за стол`);
    this._update();
  }

  leave(userId) {
    const i = this.seatOf(userId);
    if (i === -1) return;
    const s = this.seats[i];
    if (this.status === 'playing' && this.players.includes(i) && !this.game.out.includes(i)) {
      this._log(`${s.name} покидает партию — засчитано поражение`);
      this._finish(i);
    }
    this.seats[i] = null;
    this._log(`${s.name} уходит`);
    this._maybeCountdown();
    this._update();
  }

  setConnected(userId, connected) {
    const i = this.seatOf(userId);
    if (i === -1) return;
    this.seats[i].connected = connected;
    if (this.status === 'playing') this._armTimer();
    this._update();
  }

  setReady(userId, ready) {
    const i = this.seatOf(userId);
    if (i === -1) throw new GameError('Сначала сядьте за стол');
    if (this.status === 'playing' || this.status === 'result') throw new GameError('Дождитесь конца партии');
    if (ready && this.deps.canAfford && !this.deps.canAfford(userId, this.stake)) {
      throw new GameError(`Нужно ${this.stake} фишек на балансе`);
    }
    this.seats[i].ready = !!ready;
    this._maybeCountdown();
    this._update();
  }

  _maybeCountdown() {
    if (this.status !== 'waiting' && this.status !== 'countdown') return;
    const seated = this.seats.filter(Boolean);
    const go = seated.length >= 2 && seated.every((s) => s.ready);
    if (go && this.status === 'waiting') {
      this.status = 'countdown';
      this.countdownEnds = this.now() + this.countdownMs;
      this._flow = this.timers.set(() => { this._flow = null; this._start(); }, this.countdownMs);
    } else if (!go && this.status === 'countdown') {
      this.timers.clear(this._flow);
      this._flow = null;
      this.status = 'waiting';
    }
  }

  // ---------- game ----------

  _start() {
    const seats = [];
    this.seats.forEach((s, i) => { if (s && s.ready) seats.push(i); });
    if (seats.length < 2) { this.status = 'waiting'; this._update(); return; }
    // take the stakes; anyone who can't pay any more is un-readied
    const paid = [];
    for (const i of seats) {
      const s = this.seats[i];
      if (this.deps.charge && !this.deps.charge(s.userId, this.stake)) {
        s.ready = false;
        for (const j of paid) this.deps.pay(this.seats[j].userId, this.stake, true);
        this._log(`${s.name}: не хватает фишек на ставку`);
        this.status = 'waiting';
        this._update();
        return;
      }
      paid.push(i);
    }
    this.players = seats;
    // remember who played where: finished players may leave before the pot is settled
    this._userBySeat = new Map(seats.map((i) => [i, this.seats[i].userId]));
    this._nameBySeat = new Map(seats.map((i) => [i, this.seats[i].name]));
    this.pot = this.stake * seats.length;
    this.missed = new Map(seats.map((i) => [i, 0])); // consecutive timeouts per seat
    this.game = new DurakGame(seats, { variant: this.variant, randomInt: this.randomInt });
    this.status = 'playing';
    this.result = null;
    this.gameNo += 1;
    this._log(`— Партия #${this.gameNo}: ${VARIANT_NAMES[this.variant].toLowerCase()}, козырь ${this.game.trumpCard} —`);
    if (this.game.leadTrump) this._log(`Первым ходит ${this._name(this.game.attacker)} (младший козырь ${this.game.leadTrump})`);
    this._armTimer();
    this._update();
  }

  act(userId, type, card, index) {
    if (this.status !== 'playing' || !this.game) throw new GameError('Партия не идёт');
    const i = this.seatOf(userId);
    if (i === -1 || !this.players.includes(i)) throw new GameError('Вы не в этой партии');
    const g = this.game;
    const before = { attacker: g.attacker, defender: g.defender, table: g.table.length };
    if (this.missed) this.missed.set(i, 0);
    try {
      switch (type) {
        case 'attack': g.attack(i, String(card)); this._log(`${this._name(i)}: ${before.table ? 'подкидывает' : 'ходит'} ${card}`); break;
        case 'defend': g.defend(i, String(card), Number(index)); this._log(`${this._name(i)}: бьёт ${card}`); break;
        case 'transfer': g.transfer(i, String(card)); this._log(`${this._name(i)}: переводит ${card} на ${this._name(g.defender)}`); break;
        case 'take': g.take(i); this._log(`${this._name(i)}: беру`); break;
        case 'pass': g.pass(i); this._log(`${this._name(i)}: ${g.taking ? 'пас' : 'бито'}`); break;
        default: throw new GameError('Неизвестное действие');
      }
    } catch (e) {
      if (e instanceof DurakError) throw new GameError(e.message);
      throw e;
    }
    this._after(before);
  }

  _after(before) {
    const g = this.game;
    if (g.lastRound && g.table.length === 0 && before.table > 0) {
      const lr = g.lastRound;
      this._log(lr.took ? `${this._name(lr.defender)} забирает карты` : 'Бито');
      g.lastRound = null;
      for (const s of g.out) if (!this._announced?.has(s)) {
        this._announced = this._announced || new Set();
        this._announced.add(s);
        this._log(`${this._name(s)} выходит из игры`);
      }
    }
    if (g.over) { this._finish(); return; }
    this._armTimer();
    this._update();
  }

  _armTimer() {
    if (this._timer) { this.timers.clear(this._timer); this._timer = null; }
    if (this.status !== 'playing' || !this.game || this.game.over) return;
    const w = this.game.waitingFor();
    if (!w.seats.length) return;
    // nobody to wait for if every expected player is offline
    const allAway = w.seats.every((s) => !this.seats[s] || !this.seats[s].connected);
    const ms = allAway ? this.awayTime : this.actionTime;
    this.deadline = this.now() + ms;
    this.deadlineMs = ms;
    this._timer = this.timers.set(() => { this._timer = null; this._timeout(); }, ms);
  }

  _timeout() {
    const g = this.game;
    if (!g || g.over || this.status !== 'playing') return;
    const w = g.waitingFor();
    const before = { attacker: g.attacker, defender: g.defender, table: g.table.length };
    // three missed turns in a row = the player has left: they lose the game
    if (w.kind === 'lead' || w.kind === 'defend') {
      const seat = w.seats[0];
      const n = (this.missed.get(seat) || 0) + 1;
      this.missed.set(seat, n);
      if (n >= MAX_MISSED) {
        this._log(`${this._name(seat)}: ${MAX_MISSED} хода пропущено — поражение`);
        this._finish(seat);
        return;
      }
    }
    if (w.kind === 'lead') {
      const c = g.autoLead();
      g.attack(g.attacker, c);
      this._log(`${this._name(g.attacker)}: время вышло, ход ${c}`);
    } else if (w.kind === 'defend') {
      g.take(g.defender);
      this._log(`${this._name(g.defender)}: время вышло — берёт`);
    } else if (w.kind === 'throw') {
      for (const s of w.seats) if (!g.over && g.canPass(s)) g.pass(s);
    }
    this._after(before);
  }

  /** Settle the pot. `forfeitSeat` loses regardless of the cards. */
  _finish(forfeitSeat = null) {
    const g = this.game;
    if (this._timer) { this.timers.clear(this._timer); this._timer = null; }
    g.over = true;
    const durak = forfeitSeat != null ? forfeitSeat : g.durak;
    const payouts = [];
    if (durak == null) {
      for (const i of this.players) {
        this.deps.pay && this.deps.pay(this._userOf(i), this.stake, true);
        payouts.push({ seat: i, name: this._name(i), amount: this.stake, net: 0 });
      }
      this._log('Ничья — ставки возвращены');
    } else {
      const winners = [...g.out.filter((s) => s !== durak), ...this.players.filter((s) => s !== durak && !g.out.includes(s))];
      const share = Math.floor(this.pot / winners.length);
      let rest = this.pot - share * winners.length;
      for (const w of winners) {
        const amount = share + (rest-- > 0 ? 1 : 0);
        this.deps.pay && this.deps.pay(this._userOf(w), amount, false);
        payouts.push({ seat: w, name: this._name(w), amount, net: amount - this.stake });
      }
      payouts.push({ seat: durak, name: this._name(durak), amount: 0, net: -this.stake });
      this._log(`Дурак — ${this._name(durak)}`);
    }
    this.result = {
      gameNo: this.gameNo,
      durak: durak == null ? null : { seat: durak, name: this._name(durak), cards: g.hand(durak).slice() },
      draw: durak == null,
      forfeit: forfeitSeat != null,
      payouts,
      order: g.out.map((s) => this._name(s)),
    };
    this.status = 'result';
    this.deps.onGameEnd && this.deps.onGameEnd(this);
    this._flow = this.timers.set(() => { this._flow = null; this._reset(); }, this.resultPause);
    this._update();
  }

  _userOf(seat) {
    if (this._userBySeat && this._userBySeat.has(seat)) return this._userBySeat.get(seat);
    return this.seats[seat] ? this.seats[seat].userId : null;
  }

  _reset() {
    this.status = 'waiting';
    this.game = null;
    this.players = [];
    this.pot = 0;
    this._announced = null;
    // offline players are removed between games
    this.seats.forEach((s, i) => {
      if (!s) return;
      s.ready = false;
      if (!s.connected) { this.seats[i] = null; this._log(`${s.name} не в сети — место освобождено`); }
    });
    this._update();
  }

  // ---------- admin / shutdown ----------

  destroy() {
    if (this._timer) this.timers.clear(this._timer);
    if (this._flow) this.timers.clear(this._flow);
    this._timer = null;
    this._flow = null;
    if (this.status === 'playing' && this.game && !this.game.over) {
      for (const i of this.players) { const u = this._userOf(i); if (u) this.deps.pay && this.deps.pay(u, this.stake, true); }
    }
    this.status = 'waiting';
    this.game = null;
  }

  addChat(name, text) {
    this.chat.push({ t: this.now(), name, text });
    if (this.chat.length > 50) this.chat.shift();
    this._update();
  }

  // ---------- views ----------

  summary() {
    return {
      id: this.id, kind: 'durak', name: this.name, variant: this.variant, stake: this.stake,
      maxPlayers: this.maxPlayers, players: this.playerCount(), status: this.status, permanent: this.permanent,
    };
  }

  publicState(viewerId) {
    const g = this.game;
    const me = this.seatOf(viewerId);
    const inGame = g && this.players.includes(me);
    const st = {
      ...this.summary(),
      gameNo: this.gameNo,
      mySeat: me,
      pot: this.pot,
      countdownIn: this.status === 'countdown' ? Math.max(0, this.countdownEnds - this.now()) : 0,
      seats: this.seats.map((s, i) => s && {
        name: s.name,
        ready: s.ready,
        connected: s.connected,
        inGame: !!g && this.players.includes(i),
        cards: g && this.players.includes(i) ? g.hand(i).length : 0,
        out: !!g && g.out.includes(i),
        place: g && g.out.includes(i) ? g.out.indexOf(i) + 1 : null,
        attacker: !!g && !g.over && g.attacker === i,
        defender: !!g && !g.over && g.defender === i,
        passed: !!g && g.passed.has(i),
      }),
      deck: g ? g.deck.length : 0,
      trumpCard: g ? g.trumpCard : null,
      trump: g ? g.trump : null,
      table: g ? g.table.map((p) => ({ a: p.a, d: p.d })) : [],
      discard: g ? g.discard : 0,
      taking: !!(g && g.taking),
      waiting: g && !g.over ? g.waitingFor() : { kind: 'none', seats: [] },
      deadlineIn: g && !g.over && this._timer ? Math.max(0, this.deadline - this.now()) : 0,
      actionTime: this.deadlineMs || this.actionTime,
      hand: inGame ? sortHand(g.hand(me), g.trump) : [],
      result: this.status === 'result' ? this.result : null,
      log: this.log.slice(-30),
      chat: this.chat.slice(-30),
      you: null,
    };
    if (me !== -1) {
      const you = { ready: this.seats[me].ready, inGame: !!inGame };
      if (inGame && !g.over) {
        const hand = g.hand(me);
        you.throwable = hand.filter((c) => g.canThrow(me, c));
        you.transfer = hand.filter((c) => g.canTransfer(me, c));
        you.defend = {};
        g.table.forEach((p, idx) => {
          if (p.d) return;
          const cs = hand.filter((c) => g.canDefend(me, c, idx));
          if (cs.length) you.defend[idx] = cs;
        });
        you.canTake = g.canTake(me);
        you.canPass = g.canPass(me);
        you.role = g.defender === me ? 'defender' : g.attacker === me ? 'attacker' : 'thrower';
        you.out = g.out.includes(me);
      }
      st.you = you;
    }
    return st;
  }
}

module.exports = { DurakTable, VARIANT_NAMES };
