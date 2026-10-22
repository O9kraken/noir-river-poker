'use strict';
/**
 * Russian draughts (русские шашки) on an 8×8 board.
 * Squares are 0..63 (row * 8 + col), row 0 is the top (black's home), white moves up.
 * Rules: men move forward one square and capture both ways; capturing is mandatory and must be
 * finished; flying kings; a man that reaches the last row during a capture continues as a king;
 * captured pieces are removed after the move (Turkish strike: a piece can't be jumped twice).
 */

const DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const rc = (sq) => [Math.floor(sq / 8), sq % 8];
const sqOf = (r, c) => (r < 0 || r > 7 || c < 0 || c > 7 ? -1 : r * 8 + c);
const other = (color) => (color === 'w' ? 'b' : 'w');
const lastRow = (color) => (color === 'w' ? 0 : 7);
const FILES = 'abcdefgh';
const name = (sq) => { const [r, c] = rc(sq); return FILES[c] + (8 - r); };

/** Board: array of 64, each null or { c: 'w' | 'b', k: boolean }. */
function initialBoard() {
  const b = Array(64).fill(null);
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 !== 1) continue;
      if (r < 3) b[sqOf(r, c)] = { c: 'b', k: false };
      else if (r > 4) b[sqOf(r, c)] = { c: 'w', k: false };
    }
  }
  return b;
}

/** All capture sequences for the piece on `from`. Each: { path, captures, promote }. */
function capturesFrom(board, from) {
  const piece = board[from];
  const out = [];
  const empty = (sq) => sq !== -1 && (board[sq] === null || sq === from);
  const enemy = (sq, taken) => sq !== -1 && sq !== from && board[sq] && board[sq].c !== piece.c && !taken.includes(sq);

  // landing options after jumping from `pos` in direction d; returns [{ land, cap }]
  function jumps(pos, king, taken) {
    const res = [];
    const [r, c] = rc(pos);
    for (const [dr, dc] of DIRS) {
      if (!king) {
        const mid = sqOf(r + dr, c + dc);
        const land = sqOf(r + 2 * dr, c + 2 * dc);
        if (enemy(mid, taken) && empty(land)) res.push({ land, cap: mid });
        continue;
      }
      let k = 1;
      let sq = sqOf(r + dr, c + dc);
      while (sq !== -1 && empty(sq)) { k++; sq = sqOf(r + dr * k, c + dc * k); }
      if (!enemy(sq, taken)) continue; // own piece, already taken piece, edge
      const cap = sq;
      k++;
      let land = sqOf(r + dr * k, c + dc * k);
      while (land !== -1 && empty(land)) { res.push({ land, cap }); k++; land = sqOf(r + dr * k, c + dc * k); }
    }
    return res;
  }

  function dfs(pos, king, path, taken) {
    const options = jumps(pos, king, taken);
    if (!options.length) {
      if (taken.length) out.push({ path, captures: taken, promote: king && !piece.k });
      return;
    }
    // a king must pick a landing square that keeps the capture going, if any does
    const byCap = new Map();
    for (const o of options) { if (!byCap.has(o.cap)) byCap.set(o.cap, []); byCap.get(o.cap).push(o); }
    for (const list of byCap.values()) {
      const cont = list.filter((o) => {
        const k2 = king || rc(o.land)[0] === lastRow(piece.c);
        return jumps(o.land, k2, taken.concat(o.cap)).length > 0;
      });
      for (const o of (cont.length ? cont : list)) {
        const k2 = king || rc(o.land)[0] === lastRow(piece.c);
        dfs(o.land, k2, path.concat(o.land), taken.concat(o.cap));
      }
    }
  }

  dfs(from, piece.k, [from], []);
  return out;
}

function simpleFrom(board, from) {
  const piece = board[from];
  const [r, c] = rc(from);
  const out = [];
  for (const [dr, dc] of DIRS) {
    if (!piece.k) {
      if (dr !== (piece.c === 'w' ? -1 : 1)) continue;
      const to = sqOf(r + dr, c + dc);
      if (to !== -1 && !board[to]) out.push({ path: [from, to], captures: [], promote: rc(to)[0] === lastRow(piece.c) });
      continue;
    }
    let k = 1;
    let to = sqOf(r + dr, c + dc);
    while (to !== -1 && !board[to]) { out.push({ path: [from, to], captures: [], promote: false }); k++; to = sqOf(r + dr * k, c + dc * k); }
  }
  return out;
}

/** Legal moves for `color`: captures if there are any, otherwise quiet moves. */
function legalMoves(board, color) {
  const caps = [];
  const quiet = [];
  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq];
    if (!p || p.c !== color) continue;
    caps.push(...capturesFrom(board, sq));
    if (!caps.length) quiet.push(...simpleFrom(board, sq));
  }
  return caps.length ? caps : quiet;
}

function applyMove(board, move) {
  const b = board.map((p) => (p ? { ...p } : null));
  const from = move.path[0];
  const to = move.path[move.path.length - 1];
  const piece = b[from];
  b[from] = null;
  for (const sq of move.captures) b[sq] = null;
  b[to] = { c: piece.c, k: piece.k || move.promote || rc(to)[0] === lastRow(piece.c) };
  return b;
}

const sameMove = (a, path) => a.path.length === path.length && a.path.every((x, i) => x === path[i]);
const notation = (m) => m.path.map(name).join(m.captures.length ? ':' : '-');
const boardKey = (b, turn) => turn + b.map((p) => (p ? (p.k ? p.c.toUpperCase() : p.c) : '.')).join('');

/** One game with its own move history and draw rules. */
class CheckersGame {
  constructor() {
    this.board = initialBoard();
    this.turn = 'w';
    this.moves = [];
    this.quiet = 0; // plies in a row with only king moves and no captures
    this.seen = new Map();
    this.result = null; // { winner: 'w' | 'b' | null, reason }
    this._legal = null;
    this._remember();
  }

  legal() { return this._legal || (this._legal = legalMoves(this.board, this.turn)); }

  _remember() {
    const k = boardKey(this.board, this.turn);
    this.seen.set(k, (this.seen.get(k) || 0) + 1);
    return this.seen.get(k);
  }

  play(color, path) {
    if (this.result) throw new Error('Партия окончена');
    if (color !== this.turn) throw new Error('Сейчас ход соперника');
    const move = this.legal().find((m) => sameMove(m, path));
    if (!move) throw new Error(this.legal().some((m) => m.captures.length) ? 'Бить обязательно' : 'Так ходить нельзя');
    const piece = this.board[move.path[0]];
    this.board = applyMove(this.board, move);
    this.quiet = move.captures.length || !piece.k ? 0 : this.quiet + 1;
    this.moves.push({ color, path: move.path, captures: move.captures, text: notation(move) });
    this.turn = other(this.turn);
    this._legal = null;
    const reps = this._remember();
    if (!this.legal().length) this.result = { winner: color, reason: this.count(this.turn) ? 'blocked' : 'captured' };
    else if (this.quiet >= 30) this.result = { winner: null, reason: 'quiet' };
    else if (reps >= 3) this.result = { winner: null, reason: 'repetition' };
    return move;
  }

  count(color) { return this.board.filter((p) => p && p.c === color).length; }
  kings(color) { return this.board.filter((p) => p && p.c === color && p.k).length; }
  finish(winner, reason) { if (!this.result) this.result = { winner, reason }; }
}

module.exports = { CheckersGame, initialBoard, legalMoves, applyMove, capturesFrom, notation, name, sqOf, rc, other };
