'use strict';
const crypto = require('crypto');
const { GameError } = require('../engine/table');
const { TurnClock } = require('../turnclock');

const isBot = (u) => typeof u === 'string' && u.startsWith('bot:');

/**
 * A table for the party board games (2–10 players). The table does the seats, "ready" buttons,
 * the stake and the pot, the chat and the turn clocks; the game itself is a plug-in object:
 *
 *   new Game(host, players, options)   players: [{ seat, userId, name }]
 *   game.act(seat, type, payload)      a player's move; throws GameError when not allowed
 *   game.view(seat)                    what this seat sees (-1: spectator)
 *   game.leave(seat)                   a player left in the middle of the game
 *   game.botDelay(seat) / botAct(seat, level, rng)  computer players
 *
 * The game calls back: host.update(), host.log(text), host.sys(text), host.turn(seat, ms, fn),
 * host.timer(name, ms, fn), host.clear(name), host.finish({ winners: [seat], text, scores }).
 *
 * Stake 0 is a friendly game: nothing is charged, the result goes to the stats only.
 *
 * deps: { charge, pay, onUpdate, onInPlay, onGameEnd(table, results) }
 */
class PartyTable {
  constructor(cfg, deps = {}, opts = {}) {
    const Game = opts.games && opts.games[cfg.game];
    if (!Game) throw new GameError('Нет такой игры');
    this.Game = Game;
    this.meta = Game.meta;
    this.id = cfg.id;
    this.kind = 'pt';
    this.game = cfg.game;
    this.name = cfg.name;
    this.stake = Math.max(0, Math.floor(cfg.stake || 0));
    this.options = Game.options ? Game.options(cfg.options || {}) : {};
    this.maxSeats = Math.min(this.meta.max, Math.max(this.meta.min, cfg.maxPlayers || this.meta.max));
    this.minPlayers = Math.max(this.meta.min, opts.minPlayers || 0);
    this.permanent = !!cfg.permanent;
    this.deps = deps;
    this.hooks = opts.hooks || {};
    this.opts = opts;
    this.timers = opts.timers || { set: setTimeout, clear: clearTimeout };
    this.now = opts.now || Date.now;
    this.randomInt = opts.randomInt || crypto.randomInt;
    this.rng = opts.rng || (() => this.randomInt(1e9) / 1e9);
    this.countdownMs = opts.countdown ?? 4000;
    this.resultPause = opts.resultPause ?? 14000;
    // turn clocks: tests run them faster; with bots there is no rush, so practice tables give twice the time
    this.speed = opts.speed ?? (cfg.practice ? 2 : 1);
    this.clock = new TurnClock({ timers: this.timers, now: this.now, grace: opts.seenGrace ?? 6000, pauseMs: opts.pauseMs ?? 45000, awayMs: 1500 });
    this.seats = Array(this.maxSeats).fill(null);
    this.status = 'waiting'; // waiting | countdown | playing | result
    this.g = null;
    this.gameNo = 0;
    this.pot = 0;
    this.result = null;
    this.log = [];
    this.chat = [];
    this.players = [];
    this._named = new Map();
    this._flow = null;
    this.lastActivity = this.now();
  }

  // ---------- seats ----------
  seatOf(userId) { return this.seats.findIndex((s) => s && s.userId === userId); }
  playerCount() { return this.seats.filter(Boolean).length; }
  freeSeat() { return this.seats.findIndex((s) => !s); }
  _update() { this.lastActivity = this.now(); (this.deps.onUpdate || (() => {}))(this); }
  _clear(n) { if (this[n]) { this.timers.clear(this[n]); this[n] = null; } }
  inGame(seat) { return this.players.some((p) => p.seat === seat); }

  sit(userId, name, seat) {
    if (this.seatOf(userId) !== -1) throw new GameError('Вы уже за этим столом');
    if (!Number.isInteger(seat) || seat < 0 || seat >= this.maxSeats) throw new GameError('Нет такого места');
    if (this.seats[seat]) throw new GameError('Место занято');
    if (this.status === 'playing') throw new GameError('Идёт партия — дождитесь следующей');
    this.seats[seat] = { userId, name, ready: false, connected: true, pref: {} };
    this.addLog(`${name} садится за стол`);
    this._maybeCountdown();
    this._update();
  }

  leave(userId) {
    const i = this.seatOf(userId);
    if (i === -1) return;
    const s = this.seats[i];
    if (this.status === 'playing' && this.inGame(i)) {
      this.sys(`${s.name} уходит из-за стола`);
      this.players = this.players.filter((p) => p.seat !== i);
      this.deps.onInPlay && this.deps.onInPlay(s.userId, 0);
      this.left.push({ userId: s.userId, seat: i, name: s.name });
      try { this.g.leave(i); } catch (e) { /* the game copes on its own */ }
    }
    this.seats[i] = null;
    if (this.status === 'playing' && this.players.length < 1) this._abort();
    this._maybeCountdown();
    this._update();
  }

  setConnected(userId, connected) {
    const i = this.seatOf(userId);
    if (i === -1) return;
    this.seats[i].connected = connected;
    if (this.status === 'playing') this.clock.connection(i, connected);
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

  /** Wishes before the game: a team, "I want to be the captain". */
  setPref(userId, pref) {
    const i = this.seatOf(userId);
    if (i === -1) throw new GameError('Сначала сядьте за стол');
    if (this.status === 'playing') throw new GameError('Партия уже идёт');
    const allowed = this.meta.prefs || [];
    const clean = {};
    for (const k of allowed) if (pref[k] !== undefined) clean[k] = pref[k];
    this.seats[i].pref = { ...this.seats[i].pref, ...clean };
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
    if (this.stake > 0) {
      for (const i of seats) {
        const s = this.seats[i];
        if (this.deps.charge && !this.deps.charge(s.userId, this.stake)) {
          for (const j of paid) this.deps.pay && this.deps.pay(this.seats[j].userId, this.stake);
          s.ready = false;
          this.addLog(`${s.name}: не хватает фишек на ставку`);
          this.status = 'waiting';
          this._update();
          return;
        }
        paid.push(i);
      }
    }
    this.gameNo += 1;
    this.pot = this.stake * seats.length;
    this.chat = [];
    this.left = [];
    this.players = seats.map((seat) => ({ seat, userId: this.seats[seat].userId, name: this.seats[seat].name, pref: { ...this.seats[seat].pref } }));
    for (const i of seats) { this.seats[i].ready = false; if (this.stake) this.deps.onInPlay && this.deps.onInPlay(this.seats[i].userId, this.stake); }
    this.status = 'playing';
    this.result = null;
    this.clock.resetBudgets();
    this.addLog(`— Партия №${this.gameNo}: ${this.meta.title}, игроков ${seats.length}${this.pot ? `, банк ${this.pot}` : ''} —`);
    this.g = new this.Game(this, this.players.map((p) => ({ ...p })), this.options);
    this._update();
  }

  // ---------- callbacks for the game ----------
  /** Optional services from the server (card pools and the like); a missing hook returns undefined. */
  hook(name, ...args) { const f = this.hooks[name]; if (!f) return undefined; try { return f(...args); } catch (e) { return undefined; } }
  userOf(seat) { const p = this.players.find((x) => x.seat === seat) || this.seats[seat]; return p ? { userId: p.userId, name: p.name } : null; }
  update() { this._update(); }
  addLog(text) { this.log.push({ t: this.now(), text }); if (this.log.length > 120) this.log.shift(); }
  sys(text) { this.chat.push({ t: this.now(), sys: true, text }); if (this.chat.length > 120) this.chat.shift(); }
  nameOf(seat) { const p = this.players.find((x) => x.seat === seat) || (this.left || []).find((x) => x.seat === seat); return p ? p.name : (this.seats[seat] || {}).name || '—'; }
  connected(seat) { const s = this.seats[seat]; return !!(s && s.connected && this.inGame(seat)); }
  ms(n) { return Math.max(10, Math.round(n * this.speed)); }

  /** A personal turn with the fair clock (paused while the player is offline). */
  turn(seat, ms, onTimeout) {
    const s = this.seats[seat];
    return this.clock.start({ seat, ms: this.ms(ms), connected: !!(s && s.connected), present: this.inGame(seat), onTimeout: () => { if (this.status === 'playing') { onTimeout(); this._update(); } } });
  }
  stopTurn() { this.clock.stop(); }
  turnView() { const v = this.clock.view(); return v && v.seat != null ? v : null; }

  /** A plain named timer (windows, everyone-answers phases). */
  timer(name, ms, fn, scale = true) {
    this.clear(name);
    const len = scale ? this.ms(ms) : Math.max(10, Math.round(ms * Math.min(1, this.speed)));
    const at = this.now() + len;
    const h = this.timers.set(() => { this._named.delete(name); if (this.status === 'playing') { fn(); this._update(); } }, len);
    this._named.set(name, { h, at, len });
    return at;
  }
  clear(name) { const t = this._named.get(name); if (t) { this.timers.clear(t.h); this._named.delete(name); } }
  timerLeft(name) { const t = this._named.get(name); return t ? Math.max(0, t.at - this.now()) : 0; }
  timerLen(name) { const t = this._named.get(name); return t ? t.len : 0; }
  _clearAll() { for (const k of [...this._named.keys()]) this.clear(k); this.clock.stop(); }

  seen(userId, key) {
    const i = this.seatOf(userId);
    if (this.clock.seen(i, String(key || ''))) this._update();
  }

  /**
   * The game is over. winners: seats that split the pot; scores: { seat: number } for the table.
   */
  finish({ winners = [], text = '', scores = null, extra = null }) {
    if (this.status !== 'playing') return;
    this._clearAll();
    const live = winners.filter((s) => this.players.some((p) => p.seat === s));
    const share = live.length ? Math.floor(this.pot / live.length) : 0;
    let rest = this.pot - share * live.length;
    const results = [];
    for (const p of this.players) {
      const win = live.includes(p.seat);
      const back = win ? share + (rest-- > 0 ? 1 : 0) : 0;
      if (back && this.deps.pay) this.deps.pay(p.userId, back);
      if (this.stake) this.deps.onInPlay && this.deps.onInPlay(p.userId, 0);
      results.push({ userId: p.userId, seat: p.seat, net: back - this.stake, win, game: this.game });
    }
    for (const l of this.left || []) results.push({ userId: l.userId, seat: l.seat, net: -this.stake, win: false, game: this.game, left: true });
    // nobody left to win (everyone walked away): return the stakes of those still here
    if (!live.length && this.pot) for (const p of this.players) { if (this.deps.pay) this.deps.pay(p.userId, this.stake); const r = results.find((x) => x.userId === p.userId); r.net = 0; }
    this.status = 'result';
    this.result = { winners: live, names: live.map((s) => this.nameOf(s)), text, pot: this.pot, share, scores, extra };
    this.sys(text || `Победа: ${this.result.names.join(', ')}`);
    this.addLog(text || `Победа: ${this.result.names.join(', ')}`);
    this.deps.onGameEnd && this.deps.onGameEnd(this, results);
    this.pot = 0;
    this._update();
    this._flow = this.timers.set(() => {
      this._flow = null;
      this.status = 'waiting';
      this.g = null;
      this.players = [];
      this.seats.forEach((s, i) => { if (s) { s.ready = false; if (!s.connected && !isBot(s.userId)) this.seats[i] = null; } });
      this._update();
    }, this.resultPause);
  }

  _abort() {
    this._clearAll();
    this.status = 'waiting';
    this.g = null;
    this.players = [];
    this.pot = 0;
  }

  act(userId, type, payload) {
    if (this.status !== 'playing' || !this.g) throw new GameError('Партия не идёт');
    const seat = this.seatOf(userId);
    if (seat === -1 || !this.inGame(seat)) throw new GameError('Вы не в этой партии');
    this.g.act(seat, String(type || ''), payload || {});
    this._update();
  }

  destroy() {
    this._clearAll();
    this._clear('_flow');
    if (this.status === 'playing' && this.stake) for (const p of this.players) { if (this.deps.pay) this.deps.pay(p.userId, this.stake); this.deps.onInPlay && this.deps.onInPlay(p.userId, 0); }
    this.status = 'waiting';
    this.g = null;
  }

  addChat(name, text, hue = null) {
    this.chat.push({ t: this.now(), name, text, hue });
    if (this.chat.length > 120) this.chat.shift();
    this._update();
  }

  // ---------- computer players ----------
  botDelay(botIds) {
    if (this.status === 'waiting' || this.status === 'countdown') {
      return this.seats.some((s) => s && botIds.has(s.userId) && !s.ready) ? 500 : null;
    }
    if (this.status !== 'playing' || !this.g || !this.g.botDelay) return null;
    let best = null;
    for (const p of this.players) {
      if (!botIds.has(p.userId)) continue;
      const d = this.g.botDelay(p.seat);
      if (d != null && (best == null || d < best)) best = d;
    }
    return best;
  }
  botStep(botIds, level, rng) {
    if (this.status === 'waiting' || this.status === 'countdown') {
      const s = this.seats.find((x) => x && botIds.has(x.userId) && !x.ready);
      if (s) this.setReady(s.userId, true);
      return;
    }
    if (this.status !== 'playing' || !this.g) return;
    let pick = null;
    for (const p of this.players) {
      if (!botIds.has(p.userId)) continue;
      const d = this.g.botDelay(p.seat);
      if (d != null && (!pick || d < pick.d)) pick = { p, d };
    }
    if (!pick) return;
    this.g.botAct(pick.p.seat, level, rng);
    this._update();
  }

  // ---------- surviving a restart ----------
  /** Everything needed to bring the table back after a deploy, as plain JSON. */
  snapshot() {
    const snap = { seats: this.seats.map((s, i) => s && { seat: i, userId: s.userId, name: s.name, pref: s.pref }).filter(Boolean) };
    if (this.status === 'playing' && this.g) {
      snap.game = {
        gameNo: this.gameNo, stake: this.stake, players: this.players, left: this.left || [],
        chat: this.chat.slice(-60), log: this.log.slice(-60), state: encode(this.g, new Set(['host', 'rng', '_bots'])),
      };
    }
    return snap;
  }

  /**
   * Continue a game from a snapshot. The seats are already taken (connected: false);
   * charge(userId, amount) takes the stake again, as the restart returned it to the balance.
   */
  restoreGame(game, charge) {
    const players = game.players.filter((p) => this.seatOf(p.userId) === p.seat);
    if (players.length < 1) return false;
    let pot = 0;
    for (const p of players) {
      if (this.stake && !isBot(p.userId)) { if (charge(p.userId, this.stake)) { pot += this.stake; this.deps.onInPlay && this.deps.onInPlay(p.userId, this.stake); } }
    }
    const g = Object.create(this.Game.prototype);
    Object.assign(g, decode(game.state));
    g.host = this;
    g.rng = this.rng;
    this.players = players;
    this.left = game.left || [];
    this.gameNo = game.gameNo;
    this.pot = pot;
    this.chat = game.chat || [];
    this.log = game.log || [];
    this.status = 'playing';
    this.result = null;
    this.g = g;
    this.clock.resetBudgets();
    for (const s of this.seats) if (s) s.ready = false;
    // a player who did not come back is treated as having left
    const gone = game.players.filter((p) => !players.includes(p));
    for (const p of gone) { this.left.push(p); try { g.leave(p.seat); } catch (e) { /* the game copes */ } }
    if (this.status !== 'playing') return true;
    this.sys('Сервер перезапускался — партия продолжается с того же места');
    if (g.resume) g.resume();
    return true;
  }

  // ---------- views ----------
  summary() {
    return {
      id: this.id, kind: 'pt', game: this.game, gameTitle: this.meta.title, name: this.name, stake: this.stake,
      maxSeats: this.maxSeats, minPlayers: this.minPlayers, players: this.playerCount(), status: this.status,
      permanent: this.permanent, private: !!this.private, owner: this.ownerName || null, options: this.options,
    };
  }

  publicState(viewerId) {
    const mySeat = this.seatOf(viewerId);
    const tv = this.status === 'playing' ? this.turnView() : null;
    const st = {
      ...this.summary(),
      gameNo: this.gameNo, pot: this.pot, mySeat,
      inGame: mySeat !== -1 && this.inGame(mySeat),
      countdownIn: this.status === 'countdown' ? Math.max(0, this.countdownEnds - this.now()) : 0,
      seats: this.seats.map((s) => s && { name: s.name, ready: s.ready, connected: s.connected, pref: s.pref, avatar: this.avatarOf ? this.avatarOf(s.userId) : null, bot: isBot(s.userId) }),
      log: this.log.slice(-30),
      chat: this.chat.slice(-60),
      result: this.status === 'result' ? this.result : null,
      turn: tv ? { seat: tv.seat, left: tv.left, ms: tv.ms, paused: !!tv.paused, key: tv.seat === mySeat ? tv.key : null } : null,
      g: null,
    };
    if (this.g && (this.status === 'playing' || this.status === 'result')) st.g = this.g.view(st.inGame ? mySeat : -1, this.status === 'result');
    return st;
  }
}

/** JSON with Maps and Sets. */
function encode(v, skip) {
  if (v instanceof Map) return { $map: [...v].map(([k, x]) => [k, encode(x)]) };
  if (v instanceof Set) return { $set: [...v].map((x) => encode(x)) };
  if (Array.isArray(v)) return v.map((x) => encode(x));
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) if (!(skip && skip.has(k)) && typeof x !== 'function') o[k] = encode(x);
    return o;
  }
  return v;
}
function decode(v) {
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === 'object') {
    if (v.$map) return new Map(v.$map.map(([k, x]) => [k, decode(x)]));
    if (v.$set) return new Set(v.$set.map(decode));
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = decode(x);
    return o;
  }
  return v;
}

/** Fisher–Yates with the table's random source. */
function shuffle(arr, rng) {
  for (let k = arr.length - 1; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); [arr[k], arr[j]] = [arr[j], arr[k]]; }
  return arr;
}

module.exports = { PartyTable, shuffle, isBot, GameError, encode, decode };
