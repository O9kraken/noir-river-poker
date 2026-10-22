'use strict';
const { CheckersTable } = require('../checkers/table');
const { GameError } = require('../engine/table');
const { ChessGame, other } = require('./engine');

const REASONS = {
  mate: 'мат', stalemate: 'пат', material: 'не хватает фигур для мата', fifty: '50 ходов без взятий и ходов пешкой',
  repetition: 'позиция повторилась трижды', time: 'у соперника кончилось время', resign: 'соперник сдался',
  left: 'соперник ушёл из-за доски', agreed: 'по соглашению',
};

/**
 * A chess table for two: same seats, stakes, clocks, resign and draw offers as checkers,
 * with the chess engine underneath.
 */
class ChessTable extends CheckersTable {
  constructor(cfg, deps = {}, opts = {}) {
    super(cfg, deps, opts);
    this.kind = 'ch';
    this.reasons = REASONS;
    this.incrementMs = opts.incrementMs ?? 2000;
  }

  _newGame() { return new ChessGame(); }

  _legalView(g, myColor, running) {
    const mine = myColor && running === myColor;
    // promotions are sent once; the client asks which piece
    return { legal: mine ? g.legal().filter((m) => !m.promo || m.promo === 'q').map((m) => ({ from: m.from, to: m.to, promo: !!m.promo })) : [], mustCapture: false };
  }

  move(userId, mv) {
    const i = this.seatOf(userId);
    if (i === -1) throw new GameError('Вы не за доской');
    if (this.status !== 'playing') throw new GameError('Партия не идёт');
    const color = this.colorOf(i);
    const from = Number(mv && mv.from);
    const to = Number(mv && mv.to);
    const promo = ['q', 'r', 'b', 'n'].includes(mv && mv.promo) ? mv.promo : undefined;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from > 63 || to < 0 || to > 63) throw new GameError('Неверный ход');
    this._tick();
    if (this.clock[color] <= 0) { this._finish(other(color), 'time'); throw new GameError('Время вышло'); }
    let m;
    try { m = this.game.play(color, { from, to, promo }); } catch (e) { throw new GameError(e.message); }
    this.clock[color] += this.incrementMs;
    this.drawOffer = null;
    const last = this.game.moves[this.game.moves.length - 1];
    this.lastMove = { from: m.from, to: m.to, color, san: last.san, captured: !!m.captured, flag: m.flag || null };
    if (this.game.result) { this._finish(this.game.result.winner, this.game.result.reason); return; }
    this._armClock();
    this._update();
  }

  summary() {
    return { ...super.summary(), kind: 'ch' };
  }

  publicState(viewerId) {
    const st = super.publicState(viewerId);
    const g = this.game;
    st.kind = 'ch';
    st.board = g ? g.board.map((p) => (p ? (p.c === 'w' ? p.t.toUpperCase() : p.t) : '')) : null;
    st.moves = g ? g.moves.map((m) => m.san) : [];
    st.check = g && this.status === 'playing' ? (g.check() ? g.turn : null) : null;
    if (g) {
      const lost = { w: [], b: [] };
      for (const m of g.moves) if (m.captured) lost[other(m.color)].push(m.captured);
      st.captured = lost; // pieces each colour has lost
      st.counts = { w: g.material('w'), b: g.material('b') };
    } else { st.captured = { w: [], b: [] }; st.counts = null; }
    return st;
  }
}

module.exports = { ChessTable };
