'use strict';
const crypto = require('crypto');
const { GameError } = require('../engine/table');

/** European single-zero wheel, in pocket order (clockwise from zero). */
const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const colorOf = (n) => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');

/** Every spot on the layout: which numbers win and what it pays (x to 1). */
const SPOTS = {};
for (let n = 0; n <= 36; n++) SPOTS['n' + n] = { label: String(n), pays: 35, wins: (x) => x === n };
Object.assign(SPOTS, {
  red: { label: 'Красное', pays: 1, wins: (x) => RED.has(x) },
  black: { label: 'Чёрное', pays: 1, wins: (x) => x !== 0 && !RED.has(x) },
  even: { label: 'Чёт', pays: 1, wins: (x) => x !== 0 && x % 2 === 0 },
  odd: { label: 'Нечет', pays: 1, wins: (x) => x % 2 === 1 },
  low: { label: '1–18', pays: 1, wins: (x) => x >= 1 && x <= 18 },
  high: { label: '19–36', pays: 1, wins: (x) => x >= 19 },
  d1: { label: '1–12', pays: 2, wins: (x) => x >= 1 && x <= 12 },
  d2: { label: '13–24', pays: 2, wins: (x) => x >= 13 && x <= 24 },
  d3: { label: '25–36', pays: 2, wins: (x) => x >= 25 },
  c1: { label: '1-я колонна', pays: 2, wins: (x) => x !== 0 && x % 3 === 1 },
  c2: { label: '2-я колонна', pays: 2, wins: (x) => x !== 0 && x % 3 === 2 },
  c3: { label: '3-я колонна', pays: 2, wins: (x) => x !== 0 && x % 3 === 0 },
});

/**
 * A shared roulette table (up to 8 players). Bets are open until the timer that starts with the first chip,
 * then the wheel spins, the spot is announced and winnings are paid.
 *
 * deps: { charge(userId, amount) -> boolean, pay(userId, amount), onUpdate(table), onInPlay(userId, amount), onRoundEnd(table, results) }
 */
class RouletteTable {
  constructor(cfg, deps = {}, opts = {}) {
    this.id = cfg.id;
    this.kind = 'rl';
    this.name = cfg.name;
    this.minBet = cfg.minBet;
    this.maxBet = cfg.maxBet; // per player per spin
    this.maxSeats = 8;
    this.permanent = !!cfg.permanent;
    this.deps = deps;
    this.timers = opts.timers || { set: setTimeout, clear: clearTimeout };
    this.now = opts.now || Date.now;
    this.randomInt = opts.randomInt || crypto.randomInt;
    this.bettingTime = opts.bettingTime ?? 15000;
    // the countdown shows bettingTime, but chips that left a slow player's screen at the last second still count
    this.lateMs = opts.lateMs ?? (this.bettingTime >= 5000 ? 1500 : 0);
    this.spinTime = opts.spinTime ?? 7000;
    this.resultPause = opts.resultPause ?? 5000;
    this.seats = Array(this.maxSeats).fill(null);
    this.status = 'betting'; // betting | spinning | result
    this.spinNo = 0;
    this.result = null;
    this.history = [];
    this.bettingEnds = 0;
    this.spinEnds = 0;
    this.lastWinners = [];
    this.log = [];
    this.chat = [];
    this._bet = null;
    this._flow = null;
    this.lastActivity = this.now();
  }

  seatOf(userId) { return this.seats.findIndex((s) => s && s.userId === userId); }
  playerCount() { return this.seats.filter(Boolean).length; }
  _log(text) { this.log.push({ t: this.now(), text }); if (this.log.length > 60) this.log.shift(); }
  _update() { this.lastActivity = this.now(); (this.deps.onUpdate || (() => {}))(this); }
  _clear(name) { if (this[name]) { this.timers.clear(this[name]); this[name] = null; } }
  static total(bets) { return Object.values(bets).reduce((a, b) => a + b, 0); }

  sit(userId, name, seatIdx) {
    if (this.seatOf(userId) !== -1) throw new GameError('Вы уже за этим столом');
    if (!Number.isInteger(seatIdx) || seatIdx < 0 || seatIdx >= this.maxSeats) throw new GameError('Нет такого места');
    if (this.seats[seatIdx]) throw new GameError('Место занято');
    this.seats[seatIdx] = { userId, name, bets: {}, stack: [], lastBets: {}, connected: true, leaving: false };
    this._log(`${name} подходит к столу`);
    this._update();
  }

  /** Free seat for a newcomer (roulette has no fixed places in the UI). */
  freeSeat() { return this.seats.findIndex((s) => !s); }

  leave(userId) {
    const i = this.seatOf(userId);
    if (i === -1) return;
    const s = this.seats[i];
    if (this.status === 'betting') {
      const back = RouletteTable.total(s.bets);
      if (back) this.deps.pay && this.deps.pay(s.userId, back);
      this.seats[i] = null;
      this.deps.onInPlay && this.deps.onInPlay(s.userId, 0);
      this._log(`${s.name} отходит от стола`);
      this._maybeStopTimer();
    } else {
      s.leaving = true; // bets on the spinning wheel are settled first
      this._log(`${s.name} уйдёт после этого спина`);
    }
    this._update();
  }

  setConnected(userId, connected) {
    const i = this.seatOf(userId);
    if (i === -1) return;
    this.seats[i].connected = connected;
    this._update();
  }

  _seatFor(userId) {
    const i = this.seatOf(userId);
    if (i === -1) throw new GameError('Сначала подойдите к столу');
    if (this.status !== 'betting') throw new GameError('Ставки сделаны, ставок больше нет');
    return this.seats[i];
  }

  bet(userId, spot, amount) {
    const s = this._seatFor(userId);
    if (!SPOTS[spot]) throw new GameError('Нет такой ставки');
    amount = Math.floor(Number(amount));
    if (!Number.isFinite(amount) || amount < this.minBet) throw new GameError(`Минимальная фишка — ${this.minBet}`);
    if (RouletteTable.total(s.bets) + amount > this.maxBet) throw new GameError(`За спин можно поставить не больше ${this.maxBet}`);
    if (this.deps.charge && !this.deps.charge(s.userId, amount)) throw new GameError('Не хватает фишек на балансе');
    s.bets[spot] = (s.bets[spot] || 0) + amount;
    s.stack.push([spot, amount]);
    this.deps.onInPlay && this.deps.onInPlay(s.userId, RouletteTable.total(s.bets));
    this._startTimer();
    this._update();
  }

  undo(userId) {
    const s = this._seatFor(userId);
    const last = s.stack.pop();
    if (!last) return;
    const [spot, amount] = last;
    s.bets[spot] -= amount;
    if (!s.bets[spot]) delete s.bets[spot];
    this.deps.pay && this.deps.pay(s.userId, amount);
    this.deps.onInPlay && this.deps.onInPlay(s.userId, RouletteTable.total(s.bets));
    this._maybeStopTimer();
    this._update();
  }

  clear(userId) {
    const s = this._seatFor(userId);
    const back = RouletteTable.total(s.bets);
    if (!back) return;
    s.bets = {};
    s.stack = [];
    this.deps.pay && this.deps.pay(s.userId, back);
    this.deps.onInPlay && this.deps.onInPlay(s.userId, 0);
    this._maybeStopTimer();
    this._update();
  }

  /** Put the previous spin's bets down again (or double the current ones). */
  rebet(userId, double = false) {
    const s = this._seatFor(userId);
    const src = double ? { ...s.bets } : s.lastBets;
    const sum = RouletteTable.total(src);
    if (!sum) throw new GameError(double ? 'Сначала сделайте ставку' : 'Повторять нечего');
    if (RouletteTable.total(s.bets) + sum > this.maxBet) throw new GameError(`За спин можно поставить не больше ${this.maxBet}`);
    if (this.deps.charge && !this.deps.charge(s.userId, sum)) throw new GameError('Не хватает фишек на балансе');
    for (const [spot, amount] of Object.entries(src)) { s.bets[spot] = (s.bets[spot] || 0) + amount; s.stack.push([spot, amount]); }
    this.deps.onInPlay && this.deps.onInPlay(s.userId, RouletteTable.total(s.bets));
    this._startTimer();
    this._update();
  }

  _startTimer() {
    if (this._bet) return;
    this.bettingEnds = this.now() + this.bettingTime;
    this._bet = this.timers.set(() => { this._bet = null; this._spin(); }, this.bettingTime + this.lateMs);
  }

  _maybeStopTimer() {
    if (this.seats.some((s) => s && RouletteTable.total(s.bets) > 0)) return;
    this._clear('_bet');
    this.bettingEnds = 0;
  }

  _spin() {
    this.status = 'spinning';
    this.spinNo += 1;
    this.result = this.randomInt(37);
    this.spinEnds = this.now() + this.spinTime;
    this._log(`Спин №${this.spinNo}: ставок больше нет`);
    this._update();
    this._flow = this.timers.set(() => { this._flow = null; this._settle(); }, this.spinTime);
  }

  _settle() {
    const n = this.result;
    const results = [];
    this.lastWinners = [];
    for (const s of this.seats) {
      if (!s) continue;
      const staked = RouletteTable.total(s.bets);
      if (!staked) continue;
      let payout = 0;
      let straight = false;
      const won = [];
      for (const [spot, amount] of Object.entries(s.bets)) {
        if (!SPOTS[spot].wins(n)) continue;
        payout += amount * (SPOTS[spot].pays + 1);
        won.push(spot);
        if (spot[0] === 'n') straight = true;
      }
      if (payout) this.deps.pay && this.deps.pay(s.userId, payout);
      this.deps.onInPlay && this.deps.onInPlay(s.userId, 0);
      s.net = payout - staked;
      s.won = won;
      results.push({ userId: s.userId, name: s.name, net: payout - staked, staked, payout, straight });
      if (payout > staked) this.lastWinners.push({ name: s.name, net: payout - staked });
    }
    this.history.unshift(n);
    if (this.history.length > 18) this.history.length = 18;
    this._log(`Выпало ${n} ${{ green: 'зеро', red: 'красное', black: 'чёрное' }[colorOf(n)]}${this.lastWinners.length ? ` · выиграли: ${this.lastWinners.map((w) => `${w.name} +${w.net}`).join(', ')}` : ''}`);
    this.deps.onRoundEnd && this.deps.onRoundEnd(this, results);
    this.status = 'result';
    this._update();
    this._flow = this.timers.set(() => { this._flow = null; this._reset(); }, this.resultPause);
  }

  _reset() {
    this.status = 'betting';
    this.bettingEnds = 0;
    this.seats.forEach((s, i) => {
      if (!s) return;
      if (RouletteTable.total(s.bets)) s.lastBets = s.bets;
      s.bets = {};
      s.stack = [];
      s.net = null;
      s.won = null;
      if (s.leaving || !s.connected) { this.seats[i] = null; this.deps.onInPlay && this.deps.onInPlay(s.userId, 0); }
    });
    this._update();
  }

  destroy() {
    this._clear('_bet');
    this._clear('_flow');
    for (const s of this.seats) {
      if (!s) continue;
      const back = this.status === 'result' ? 0 : RouletteTable.total(s.bets);
      if (back) this.deps.pay && this.deps.pay(s.userId, back);
      this.deps.onInPlay && this.deps.onInPlay(s.userId, 0);
    }
    this.seats = this.seats.map(() => null);
  }

  addChat(name, text, hue = null) {
    this.chat.push({ t: this.now(), name, text, hue });
    if (this.chat.length > 50) this.chat.shift();
    this._update();
  }

  summary() {
    return {
      id: this.id, kind: 'rl', name: this.name, minBet: this.minBet, maxBet: this.maxBet, maxSeats: this.maxSeats,
      players: this.playerCount(), status: this.status, permanent: this.permanent, private: !!this.private, owner: this.ownerName || null,
      last: this.history.slice(0, 5),
    };
  }

  publicState(viewerId) {
    const me = this.seatOf(viewerId);
    const showResult = this.status !== 'betting';
    return {
      ...this.summary(),
      spinNo: this.spinNo,
      bettingIn: this.status === 'betting' && this._bet ? Math.max(0, this.bettingEnds - this.now()) : 0,
      bettingTime: this.bettingTime,
      spinIn: this.status === 'spinning' ? Math.max(0, this.spinEnds - this.now()) : 0,
      spinTime: this.spinTime,
      result: showResult ? this.result : null,
      history: this.history,
      seats: this.seats.map((s) => s && {
        name: s.name, connected: s.connected, leaving: s.leaving, total: RouletteTable.total(s.bets), bets: s.bets,
        net: this.status === 'result' ? s.net ?? null : null, won: this.status === 'result' ? s.won || [] : [],
        avatar: this.avatarOf ? this.avatarOf(s.userId) : null,
      }),
      winners: this.status === 'result' ? this.lastWinners : [],
      mySeat: me,
      you: me === -1 ? null : { bets: this.seats[me].bets, total: RouletteTable.total(this.seats[me].bets), last: RouletteTable.total(this.seats[me].lastBets), canBet: this.status === 'betting' },
      log: this.log.slice(-30),
      chat: this.chat.slice(-30),
    };
  }
}

module.exports = { RouletteTable, WHEEL, RED, SPOTS, colorOf };
