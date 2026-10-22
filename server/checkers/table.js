'use strict';
const crypto = require('crypto');
const { CheckersGame, other } = require('./engine');
const { GameError } = require('../engine/table');

const REASONS = {
  captured: 'все шашки соперника сбиты', blocked: 'у соперника нет ходов', time: 'у соперника кончилось время',
  resign: 'соперник сдался', left: 'соперник ушёл из-за стола', quiet: '15 ходов дамками без взятий', repetition: 'позиция повторилась трижды', agreed: 'по соглашению',
};

/**
 * A checkers table for two. Both press "Готов", the stake leaves each balance, the winner takes the pot,
 * a draw returns the stakes. Each side has a clock with an increment.
 *
 * deps: { charge(userId, amount) -> boolean, pay(userId, amount), onUpdate(table), onInPlay(userId, amount), onGameEnd(table, results) }
 */
class CheckersTable {
  constructor(cfg, deps = {}, opts = {}) {
    this.id = cfg.id;
    this.kind = 'ck';
    this.name = cfg.name;
    this.stake = cfg.stake;
    this.maxSeats = 2;
    this.permanent = !!cfg.permanent;
    this.deps = deps;
    this.timers = opts.timers || { set: setTimeout, clear: clearTimeout };
    this.now = opts.now || Date.now;
    this.clockMs = cfg.clockMs || opts.clockMs || 5 * 60 * 1000;
    this.incrementMs = opts.incrementMs ?? 3000;
    this.resultPause = opts.resultPause ?? 6000;
    this.seats = [null, null];
    this.status = 'waiting'; // waiting | playing | result
    this.game = null;
    this.gameNo = 0;
    this.pot = 0;
    this.colors = null; // { w: seatIdx, b: seatIdx }
    this.clock = { w: 0, b: 0, since: 0 };
    this.drawOffer = null; // color that offered
    this.lastResult = null;
    this.log = [];
    this.chat = [];
    this._clockTimer = null;
    this._flow = null;
    this.lastActivity = this.now();
  }

  seatOf(userId) { return this.seats.findIndex((s) => s && s.userId === userId); }
  playerCount() { return this.seats.filter(Boolean).length; }
  _log(text) { this.log.push({ t: this.now(), text }); if (this.log.length > 80) this.log.shift(); }
  _update() { this.lastActivity = this.now(); (this.deps.onUpdate || (() => {}))(this); }
  _clear(name) { if (this[name]) { this.timers.clear(this[name]); this[name] = null; } }
  colorOf(seat) { if (!this.colors) return null; return this.colors.w === seat ? 'w' : this.colors.b === seat ? 'b' : null; }

  sit(userId, name, seatIdx) {
    if (this.seatOf(userId) !== -1) throw new GameError('Вы уже за этим столом');
    if (seatIdx !== 0 && seatIdx !== 1) throw new GameError('Нет такого места');
    if (this.seats[seatIdx]) throw new GameError('Место занято');
    this.seats[seatIdx] = { userId, name, ready: false, connected: true };
    this._log(`${name} садится за доску`);
    this._update();
  }

  leave(userId) {
    const i = this.seatOf(userId);
    if (i === -1) return;
    const s = this.seats[i];
    if (this.status === 'playing') this._finish(other(this.colorOf(i)), 'left');
    this.seats[i] = null;
    this.deps.onInPlay && this.deps.onInPlay(s.userId, 0);
    if (this.status === 'waiting') for (const x of this.seats) if (x) x.ready = false;
    this._log(`${s.name} уходит`);
    this._update();
  }

  setConnected(userId, connected) {
    const i = this.seatOf(userId);
    if (i === -1) return;
    this.seats[i].connected = connected;
    this._update();
  }

  setReady(userId, value) {
    const i = this.seatOf(userId);
    if (i === -1) throw new GameError('Сначала сядьте за доску');
    if (this.status !== 'waiting') throw new GameError('Партия уже идёт');
    this.seats[i].ready = !!value;
    this._update();
    if (this.seats.every((s) => s && s.ready)) this._start();
  }

  _start() {
    // take the stakes; whoever can't pay is unready again
    const paid = [];
    for (const s of this.seats) {
      if (this.deps.charge && !this.deps.charge(s.userId, this.stake)) {
        for (const p of paid) this.deps.pay && this.deps.pay(p.userId, this.stake);
        s.ready = false;
        this._log(`У ${s.name} не хватает фишек на ставку`);
        this._update();
        return;
      }
      paid.push(s);
    }
    this.gameNo += 1;
    this.pot = this.stake * 2;
    const first = this.gameNo === 1 ? crypto.randomInt(2) : (this.colors ? this.colors.b : 0);
    this.colors = { w: first, b: 1 - first };
    for (const s of this.seats) { s.ready = false; this.deps.onInPlay && this.deps.onInPlay(s.userId, this.stake); }
    this.game = new CheckersGame();
    this.status = 'playing';
    this.drawOffer = null;
    this.lastResult = null;
    this.lastMove = null;
    this.clock = { w: this.clockMs, b: this.clockMs, since: this.now() };
    this._log(`Партия №${this.gameNo}: белыми ${this.seats[this.colors.w].name}, чёрными ${this.seats[this.colors.b].name}. Банк ${this.pot}`);
    this._armClock();
    this._update();
  }

  _armClock() {
    this._clear('_clockTimer');
    const color = this.game.turn;
    this._clockTimer = this.timers.set(() => {
      this._clockTimer = null;
      if (this.status !== 'playing') return;
      this._tick();
      if (this.clock[color] <= 0) this._finish(other(color), 'time');
      else this._armClock();
    }, Math.max(50, this.clock[color] + 20));
  }

  _tick() {
    const now = this.now();
    this.clock[this.game.turn] = Math.max(0, this.clock[this.game.turn] - (now - this.clock.since));
    this.clock.since = now;
  }

  move(userId, path) {
    const i = this.seatOf(userId);
    if (i === -1) throw new GameError('Вы не за доской');
    if (this.status !== 'playing') throw new GameError('Партия не идёт');
    const color = this.colorOf(i);
    if (!Array.isArray(path) || path.length < 2 || path.length > 20 || !path.every((x) => Number.isInteger(x) && x >= 0 && x < 64)) throw new GameError('Неверный ход');
    this._tick();
    if (this.clock[color] <= 0) { this._finish(other(color), 'time'); throw new GameError('Время вышло'); }
    let mv;
    try { mv = this.game.play(color, path); } catch (e) { throw new GameError(e.message); }
    this.clock[color] += this.incrementMs;
    this.drawOffer = null;
    this.lastMove = { path: mv.path, captures: mv.captures, color };
    if (this.game.result) { this._finish(this.game.result.winner, this.game.result.reason); return; }
    this._armClock();
    this._update();
  }

  resign(userId) {
    const i = this.seatOf(userId);
    if (i === -1 || this.status !== 'playing') throw new GameError('Партия не идёт');
    this._finish(other(this.colorOf(i)), 'resign');
  }

  offerDraw(userId) {
    const i = this.seatOf(userId);
    if (i === -1 || this.status !== 'playing') throw new GameError('Партия не идёт');
    const color = this.colorOf(i);
    if (this.drawOffer && this.drawOffer !== color) { this._finish(null, 'agreed'); return; } // the other side offered: accept
    this.drawOffer = color;
    this._log(`${this.seats[i].name} предлагает ничью`);
    this._update();
  }

  declineDraw(userId) {
    const i = this.seatOf(userId);
    if (i === -1 || !this.drawOffer || this.drawOffer === this.colorOf(i)) return;
    this.drawOffer = null;
    this._log(`${this.seats[i].name} отклоняет ничью`);
    this._update();
  }

  _finish(winner, reason) {
    if (this.status !== 'playing') return;
    this._clear('_clockTimer');
    if (this.game) this.game.finish(winner, reason);
    const results = [];
    for (const color of ['w', 'b']) {
      const s = this.seats[this.colors[color]];
      const back = winner === null ? this.stake : winner === color ? this.pot : 0;
      const net = back - this.stake;
      if (s) {
        if (back) this.deps.pay && this.deps.pay(s.userId, back);
        this.deps.onInPlay && this.deps.onInPlay(s.userId, 0);
      }
      results.push({ userId: s ? s.userId : null, color, net, win: winner === color, draw: winner === null });
    }
    this.status = 'result';
    this.lastResult = { winner, reason, text: REASONS[reason] || '', winnerName: winner ? (this.seats[this.colors[winner]] || {}).name || null : null };
    this._log(winner ? `Победа ${winner === 'w' ? 'белых' : 'чёрных'}: ${REASONS[reason]}. Банк ${this.pot}` : `Ничья: ${REASONS[reason]}. Ставки возвращены`);
    this.deps.onGameEnd && this.deps.onGameEnd(this, results);
    this.pot = 0;
    this._update();
    this._flow = this.timers.set(() => {
      this._flow = null;
      this.status = 'waiting';
      for (const s of this.seats) if (s) s.ready = false;
      this.seats.forEach((s, i) => { if (s && !s.connected) { this.seats[i] = null; } });
      this._update();
    }, this.resultPause);
  }

  destroy() {
    this._clear('_clockTimer');
    this._clear('_flow');
    if (this.status === 'playing') {
      for (const s of this.seats) if (s) { this.deps.pay && this.deps.pay(s.userId, this.stake); this.deps.onInPlay && this.deps.onInPlay(s.userId, 0); }
    }
    this.status = 'waiting';
    this.seats = [null, null];
  }

  addChat(name, text, hue = null) {
    this.chat.push({ t: this.now(), name, text, hue });
    if (this.chat.length > 50) this.chat.shift();
    this._update();
  }

  summary() {
    return {
      id: this.id, kind: 'ck', name: this.name, stake: this.stake, clockMin: Math.round(this.clockMs / 60000),
      maxSeats: 2, players: this.playerCount(), status: this.status, permanent: this.permanent, private: !!this.private, owner: this.ownerName || null,
    };
  }

  publicState(viewerId) {
    const me = this.seatOf(viewerId);
    const g = this.game;
    const myColor = me !== -1 ? this.colorOf(me) : null;
    const running = this.status === 'playing' && g ? g.turn : null;
    const clock = { ...this.clock };
    if (running) clock[running] = Math.max(0, clock[running] - (this.now() - clock.since));
    return {
      ...this.summary(),
      gameNo: this.gameNo,
      pot: this.pot,
      seats: this.seats.map((s, i) => s && {
        name: s.name, ready: s.ready, connected: s.connected, color: this.status !== 'waiting' ? this.colorOf(i) : null,
        avatar: this.avatarOf ? this.avatarOf(s.userId) : null,
      }),
      board: g ? g.board.map((p) => (p ? (p.k ? p.c.toUpperCase() : p.c) : '')) : null,
      turn: g && this.status === 'playing' ? g.turn : null,
      clock: g ? { w: clock.w, b: clock.b, running } : null,
      lastMove: this.lastMove || null,
      moves: g ? g.moves.map((m) => m.text) : [],
      counts: g ? { w: g.count('w'), b: g.count('b'), wk: g.kings('w'), bk: g.kings('b') } : null,
      drawOffer: this.drawOffer,
      result: this.lastResult,
      mySeat: me,
      myColor,
      legal: myColor && running === myColor ? g.legal().map((m) => m.path) : [],
      mustCapture: myColor && running === myColor ? g.legal().some((m) => m.captures.length) : false,
      log: this.log.slice(-30),
      chat: this.chat.slice(-30),
    };
  }
}

module.exports = { CheckersTable };
