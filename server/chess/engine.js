'use strict';
/**
 * Chess rules. Squares 0..63 = row * 8 + col, row 0 is rank 8 (black's back rank), white moves up.
 * A position: { board[64] of null | { c: 'w'|'b', t: 'p'|'n'|'b'|'r'|'q'|'k' }, turn, castle: 'KQkq' subset, ep, half, full }.
 * Moves: { from, to, promo?, flag?: 'ep' | 'castle' | 'double', piece, captured? }.
 */

const FILES = 'abcdefgh';
const rc = (sq) => [sq >> 3, sq & 7];
const sqOf = (r, c) => (r < 0 || r > 7 || c < 0 || c > 7 ? -1 : r * 8 + c);
const other = (c) => (c === 'w' ? 'b' : 'w');
const name = (sq) => FILES[sq & 7] + (8 - (sq >> 3));
const parseSq = (s) => (typeof s === 'string' && /^[a-h][1-8]$/.test(s) ? (8 - Number(s[1])) * 8 + FILES.indexOf(s[0]) : -1);

const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const BISHOP = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ROOK = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function initialPosition() {
  const board = Array(64).fill(null);
  const back = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
  for (let c = 0; c < 8; c++) {
    board[c] = { c: 'b', t: back[c] };
    board[8 + c] = { c: 'b', t: 'p' };
    board[48 + c] = { c: 'w', t: 'p' };
    board[56 + c] = { c: 'w', t: back[c] };
  }
  return { board, turn: 'w', castle: 'KQkq', ep: -1, half: 0, full: 1 };
}

/** Position from FEN (tests and puzzles). */
function fromFen(fen) {
  const [rows, turn, castle, ep, half, full] = fen.trim().split(/\s+/);
  const board = Array(64).fill(null);
  let sq = 0;
  for (const ch of rows) {
    if (ch === '/') continue;
    if (/\d/.test(ch)) { sq += Number(ch); continue; }
    board[sq++] = { c: ch === ch.toUpperCase() ? 'w' : 'b', t: ch.toLowerCase() };
  }
  return { board, turn: turn || 'w', castle: castle && castle !== '-' ? castle : '', ep: ep && ep !== '-' ? parseSq(ep) : -1, half: Number(half) || 0, full: Number(full) || 1 };
}

function toFen(pos) {
  let out = '';
  for (let r = 0; r < 8; r++) {
    let empty = 0;
    for (let c = 0; c < 8; c++) {
      const p = pos.board[r * 8 + c];
      if (!p) { empty++; continue; }
      if (empty) { out += empty; empty = 0; }
      out += p.c === 'w' ? p.t.toUpperCase() : p.t;
    }
    if (empty) out += empty;
    if (r < 7) out += '/';
  }
  return `${out} ${pos.turn} ${pos.castle || '-'} ${pos.ep >= 0 ? name(pos.ep) : '-'} ${pos.half} ${pos.full}`;
}

/** Is `sq` attacked by any piece of colour `by`? */
function attacked(board, sq, by) {
  const [r, c] = rc(sq);
  // pawns
  const pr = by === 'w' ? r + 1 : r - 1;
  for (const dc of [-1, 1]) {
    const s = sqOf(pr, c + dc);
    if (s !== -1 && board[s] && board[s].c === by && board[s].t === 'p') return true;
  }
  for (const [dr, dc] of KNIGHT) {
    const s = sqOf(r + dr, c + dc);
    if (s !== -1 && board[s] && board[s].c === by && board[s].t === 'n') return true;
  }
  for (const [dr, dc] of KING) {
    const s = sqOf(r + dr, c + dc);
    if (s !== -1 && board[s] && board[s].c === by && board[s].t === 'k') return true;
  }
  for (const [dirs, kinds] of [[BISHOP, 'bq'], [ROOK, 'rq']]) {
    for (const [dr, dc] of dirs) {
      let k = 1;
      for (;;) {
        const s = sqOf(r + dr * k, c + dc * k);
        if (s === -1) break;
        const p = board[s];
        if (p) { if (p.c === by && kinds.includes(p.t)) return true; break; }
        k++;
      }
    }
  }
  return false;
}

const kingSq = (board, color) => board.findIndex((p) => p && p.c === color && p.t === 'k');
const inCheck = (pos, color = pos.turn) => { const k = kingSq(pos.board, color); return k !== -1 && attacked(pos.board, k, other(color)); };

function pseudoMoves(pos) {
  const { board, turn } = pos;
  const out = [];
  const add = (from, to, extra) => out.push({ from, to, piece: board[from].t, captured: board[to] ? board[to].t : undefined, ...extra });
  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq];
    if (!p || p.c !== turn) continue;
    const [r, c] = rc(sq);
    if (p.t === 'p') {
      const dir = turn === 'w' ? -1 : 1;
      const start = turn === 'w' ? 6 : 1;
      const last = turn === 'w' ? 0 : 7;
      const one = sqOf(r + dir, c);
      const pawnTo = (to, extra = {}) => {
        if ((to >> 3) === last) for (const promo of ['q', 'r', 'b', 'n']) add(sq, to, { ...extra, promo });
        else add(sq, to, extra);
      };
      if (one !== -1 && !board[one]) {
        pawnTo(one);
        const two = sqOf(r + 2 * dir, c);
        if (r === start && !board[two]) add(sq, two, { flag: 'double' });
      }
      for (const dc of [-1, 1]) {
        const t = sqOf(r + dir, c + dc);
        if (t === -1) continue;
        if (board[t] && board[t].c !== turn) pawnTo(t);
        else if (t === pos.ep) out.push({ from: sq, to: t, piece: 'p', captured: 'p', flag: 'ep' });
      }
      continue;
    }
    if (p.t === 'n' || p.t === 'k') {
      for (const [dr, dc] of p.t === 'n' ? KNIGHT : KING) {
        const t = sqOf(r + dr, c + dc);
        if (t !== -1 && (!board[t] || board[t].c !== turn)) add(sq, t);
      }
      if (p.t === 'k') {
        const home = turn === 'w' ? 60 : 4;
        const [K, Q] = turn === 'w' ? ['K', 'Q'] : ['k', 'q'];
        if (sq === home && !attacked(board, home, other(turn))) {
          if (pos.castle.includes(K) && !board[home + 1] && !board[home + 2] && board[home + 3] && board[home + 3].t === 'r' && board[home + 3].c === turn
            && !attacked(board, home + 1, other(turn)) && !attacked(board, home + 2, other(turn))) out.push({ from: home, to: home + 2, piece: 'k', flag: 'castle' });
          if (pos.castle.includes(Q) && !board[home - 1] && !board[home - 2] && !board[home - 3] && board[home - 4] && board[home - 4].t === 'r' && board[home - 4].c === turn
            && !attacked(board, home - 1, other(turn)) && !attacked(board, home - 2, other(turn))) out.push({ from: home, to: home - 2, piece: 'k', flag: 'castle' });
        }
      }
      continue;
    }
    const dirs = p.t === 'b' ? BISHOP : p.t === 'r' ? ROOK : BISHOP.concat(ROOK);
    for (const [dr, dc] of dirs) {
      let k = 1;
      for (;;) {
        const t = sqOf(r + dr * k, c + dc * k);
        if (t === -1) break;
        if (board[t]) { if (board[t].c !== turn) add(sq, t); break; }
        add(sq, t);
        k++;
      }
    }
  }
  return out;
}

const ROOK_HOMES = { 63: 'K', 56: 'Q', 7: 'k', 0: 'q' };

/** New position after a move (the move must come from the generator). */
function applyMove(pos, m) {
  const board = pos.board.slice();
  const piece = board[m.from];
  board[m.from] = null;
  if (m.flag === 'ep') board[m.to + (pos.turn === 'w' ? 8 : -8)] = null;
  board[m.to] = m.promo ? { c: piece.c, t: m.promo } : piece;
  if (m.flag === 'castle') {
    const kingSide = m.to > m.from;
    const rookFrom = kingSide ? m.from + 3 : m.from - 4;
    board[kingSide ? m.from + 1 : m.from - 1] = board[rookFrom];
    board[rookFrom] = null;
  }
  let castle = pos.castle;
  if (castle) {
    if (piece.t === 'k') castle = castle.replace(piece.c === 'w' ? /[KQ]/g : /[kq]/g, '');
    for (const s of [m.from, m.to]) if (ROOK_HOMES[s]) castle = castle.replace(ROOK_HOMES[s], '');
  }
  return {
    board, turn: other(pos.turn), castle,
    ep: m.flag === 'double' ? (m.from + m.to) / 2 : -1,
    half: piece.t === 'p' || m.captured ? 0 : pos.half + 1,
    full: pos.full + (pos.turn === 'b' ? 1 : 0),
  };
}

function legalMoves(pos) {
  return pseudoMoves(pos).filter((m) => {
    const next = applyMove(pos, m);
    const k = kingSq(next.board, pos.turn);
    return !attacked(next.board, k, next.turn);
  });
}

function insufficient(board) {
  const rest = [];
  board.forEach((p, sq) => { if (p && p.t !== 'k') rest.push({ ...p, sq }); });
  if (!rest.length) return true;
  if (rest.length === 1 && (rest[0].t === 'b' || rest[0].t === 'n')) return true;
  if (rest.every((p) => p.t === 'b')) {
    const shade = (sq) => ((sq >> 3) + (sq & 7)) % 2;
    return rest.every((p) => shade(p.sq) === shade(rest[0].sq));
  }
  return false;
}

/** Standard algebraic notation, e.g. "Nbd7", "exd5", "O-O", "e8=Q+". */
function san(pos, m, legal = legalMoves(pos)) {
  let s;
  if (m.flag === 'castle') s = m.to > m.from ? 'O-O' : 'O-O-O';
  else {
    const P = m.piece.toUpperCase();
    const cap = m.captured ? 'x' : '';
    if (m.piece === 'p') s = (cap ? FILES[m.from & 7] : '') + cap + name(m.to) + (m.promo ? '=' + m.promo.toUpperCase() : '');
    else {
      const rivals = legal.filter((x) => x.piece === m.piece && x.to === m.to && x.from !== m.from);
      let dis = '';
      if (rivals.length) {
        const sameFile = rivals.some((x) => (x.from & 7) === (m.from & 7));
        const sameRank = rivals.some((x) => (x.from >> 3) === (m.from >> 3));
        dis = !sameFile ? FILES[m.from & 7] : !sameRank ? String(8 - (m.from >> 3)) : name(m.from);
      }
      s = P + dis + cap + name(m.to);
    }
  }
  const next = applyMove(pos, m);
  if (inCheck(next)) s += legalMoves(next).length ? '+' : '#';
  return s;
}

const posKey = (pos) => toFen(pos).split(' ').slice(0, 4).join(' ');

/** One game with its history and draw rules. */
class ChessGame {
  constructor(fen) {
    this.pos = fen ? fromFen(fen) : initialPosition();
    this.moves = []; // { color, from, to, promo, san }
    this.seen = new Map([[posKey(this.pos), 1]]);
    this.result = null; // { winner: 'w'|'b'|null, reason }
    this._legal = null;
  }
  get turn() { return this.pos.turn; }
  get board() { return this.pos.board; }
  legal() { return this._legal || (this._legal = legalMoves(this.pos)); }
  check() { return inCheck(this.pos); }

  play(color, { from, to, promo }) {
    if (this.result) throw new Error('Партия окончена');
    if (color !== this.pos.turn) throw new Error('Сейчас ход соперника');
    const legal = this.legal();
    const cands = legal.filter((m) => m.from === from && m.to === to);
    if (!cands.length) throw new Error(inCheck(this.pos) ? 'Королю шах — так ходить нельзя' : 'Так ходить нельзя');
    const m = cands.length > 1 ? cands.find((x) => x.promo === (promo || 'q')) || cands[0] : cands[0];
    const text = san(this.pos, m, legal);
    this.pos = applyMove(this.pos, m);
    this._legal = null;
    this.moves.push({ color, from: m.from, to: m.to, promo: m.promo, san: text, captured: m.captured || null, flag: m.flag || null });
    const key = posKey(this.pos);
    const reps = (this.seen.get(key) || 0) + 1;
    this.seen.set(key, reps);
    const next = this.legal();
    if (!next.length) this.result = inCheck(this.pos) ? { winner: color, reason: 'mate' } : { winner: null, reason: 'stalemate' };
    else if (insufficient(this.pos.board)) this.result = { winner: null, reason: 'material' };
    else if (this.pos.half >= 100) this.result = { winner: null, reason: 'fifty' };
    else if (reps >= 3) this.result = { winner: null, reason: 'repetition' };
    return m;
  }
  finish(winner, reason) { if (!this.result) this.result = { winner, reason }; }
  material(color) {
    const V = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
    return this.pos.board.reduce((a, p) => a + (p && p.c === color ? V[p.t] : 0), 0);
  }
}

module.exports = { ChessGame, initialPosition, fromFen, toFen, legalMoves, applyMove, attacked, inCheck, san, name, parseSq, other, insufficient, kingSq };
