'use strict';
const { CheckersTable } = require('../checkers/table');
const { GameError } = require('../engine/table');
const { NardyGame, other } = require('./engine');
const nardyAI = require('../bots/nardy-ai');

const REASONS = {
  oin: 'все шашки выброшены', mars: 'марс — соперник не успел выбросить ни одной шашки',
  time: 'соперник трижды подряд не успел сходить', resign: 'соперник сдался', left: 'соперник ушёл из-за доски', agreed: 'по соглашению',
};

/**
 * A long nardy table for two. Same seats, stakes, ready buttons, resign and chat as checkers;
 * instead of chess clocks each turn has its own time limit. When it runs out the dice are thrown
 * and the turn is played for the player; three such turns in a row lose the game.
 */
class NardyTable extends CheckersTable {
  constructor(cfg, deps = {}, opts = {}) {
    super(cfg, deps, opts);
    this.kind = 'bg';
    this.reasons = REASONS;
    this.turnMs = (cfg.turnSec || opts.turnSec || 45) * 1000;
    this.endDelay = opts.endDelay ?? 1100; // a moment to undo the last move before the turn passes
    this.noMoveDelay = opts.noMoveDelay ?? 1600; // time to see the dice when there is no move
    this.rng = opts.rng || Math.random;
    this.turnEnds = 0;
    this.misses = { w: 0, b: 0 };
    this._endTimer = null;
  }

  _newGame() {
    this.misses = { w: 0, b: 0 };
    return new NardyGame('w', this.rng);
  }
  _legalView() { return {}; }

  // ---------- turn timer instead of chess clocks ----------
  _armClock() {
    this._clear('_clockTimer');
    this.turnEnds = this.now() + this.turnMs;
    this._clockTimer = this.timers.set(() => { this._clockTimer = null; this._timeout(); }, this.turnMs);
  }
  _tick() {}

  _timeout() {
    if (this.status !== 'playing') return;
    const g = this.game;
    const color = g.turn;
    if (g.dice && g.done()) { this._clear('_endTimer'); this._passTurn(); return; } // already played, just waiting to pass
    this.misses[color] += 1;
    if (this.misses[color] >= 3) { this._finish(other(color), 'time'); return; }
    this._log(`${this._name(color)} не успевает — ход делается автоматически`);
    if (!g.dice) g.roll();
    for (const m of nardyAI.chooseTurn(g, 'easy', this.rng)) { g.play(color, m.from, m.die); if (g.result) break; }
    this._afterMove(true);
  }

  _name(color) { const s = this.seats[this.colors[color]]; return s ? s.name : (color === 'w' ? 'Белые' : 'Чёрные'); }
  _me(userId) {
    const i = this.seatOf(userId);
    if (i === -1) throw new GameError('Вы не за доской');
    if (this.status !== 'playing') throw new GameError('Партия не идёт');
    const color = this.colorOf(i);
    if (this.game.turn !== color) throw new GameError('Сейчас ход соперника');
    return color;
  }

  roll(userId) {
    const color = this._me(userId);
    const g = this.game;
    if (g.dice) throw new GameError('Кубики уже брошены');
    g.roll();
    this.misses[color] = 0;
    this.lastMove = null;
    this._log(`${this._name(color)}: ${g.dice[0]}–${g.dice[1]}${g.dice[0] === g.dice[1] ? ' (дубль)' : ''}`);
    if (!g.need) {
      this._log(`${this._name(color)}: хода нет`);
      this._clear('_endTimer');
      this._endTimer = this.timers.set(() => { this._endTimer = null; this._passTurn(); }, this.noMoveDelay);
    }
    this._update();
  }

  /** mv: { from: own point 1..24, die: 1..6 } */
  move(userId, mv) {
    const color = this._me(userId);
    const g = this.game;
    const from = Number(mv && mv.from);
    const die = Number(mv && mv.die);
    if (!Number.isInteger(from) || !Number.isInteger(die) || from < 1 || from > 24 || die < 1 || die > 6) throw new GameError('Неверный ход');
    let m;
    try { m = g.play(color, from, die); } catch (e) { throw new GameError(e.message); }
    this.misses[color] = 0;
    this.lastMove = { color, ...m };
    this._afterMove(false);
  }

  undo(userId) {
    const color = this._me(userId);
    try { this.game.undo(color); } catch (e) { throw new GameError(e.message); }
    this._clear('_endTimer');
    this.lastMove = null;
    this._update();
  }

  _afterMove(auto) {
    const g = this.game;
    if (g.result) { this._finish(g.result.winner, g.result.reason); return; }
    if (g.done()) {
      this._clear('_endTimer');
      if (auto) this._passTurn();
      else this._endTimer = this.timers.set(() => { this._endTimer = null; this._passTurn(); }, this.endDelay);
    }
    this._update();
  }

  _passTurn() {
    if (this.status !== 'playing') return;
    const g = this.game;
    if (!g.done()) return;
    const t = g.dice;
    const moves = g.played.map((m) => `${m.from}→${m.to || 'вон'}`).join(', ');
    if (moves) this._log(`${this._name(g.turn)}: ${moves}`);
    g.endTurn();
    void t;
    this._armClock();
    this._update();
  }

  _finish(winner, reason) {
    this._clear('_endTimer');
    if (this.status === 'playing' && winner && reason === 'mars') this._log('Марс!');
    super._finish(winner, reason);
  }

  destroy() { this._clear('_endTimer'); super.destroy(); }

  offerDraw() { throw new GameError('В нардах ничьих нет'); }

  summary() {
    return { ...super.summary(), kind: 'bg', turnSec: Math.round(this.turnMs / 1000), clockMin: undefined };
  }

  publicState(viewerId) {
    const st = super.publicState(viewerId);
    const g = this.game;
    st.kind = 'bg';
    st.board = null; st.moves = []; st.counts = null; st.clock = null;
    if (!g) { st.nardy = null; return st; }
    const p = g.pos;
    const mine = st.myColor && this.status === 'playing' && g.turn === st.myColor;
    st.nardy = {
      points: p.c.map((c, i) => (c ? { c, n: p.n[i] } : null)),
      off: { ...p.off },
      pips: { w: p.pips('w'), b: p.pips('b') },
      dice: g.dice,
      left: g.left,
      played: g.played,
      canUndo: !!(mine && g.played.length && !g.result),
      phase: this.status !== 'playing' ? 'over' : !g.dice ? 'roll' : g.done() ? 'done' : 'move',
      legal: mine && g.dice ? g.legal() : [],
      turnLeft: this.status === 'playing' ? Math.max(0, this.turnEnds - this.now()) : 0,
      turnMs: this.turnMs,
      lastTurn: g.lastTurn,
      misses: { ...this.misses },
      turnNo: g.moves.length,
    };
    return st;
  }
}

module.exports = { NardyTable };
