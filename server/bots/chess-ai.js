'use strict';
/**
 * Chess opponent: iterative-deepening negamax with alpha-beta, captures-only quiescence,
 * material + piece-square tables. Time budgets stay small because it runs on the server's event loop.
 */
const { legalMoves, applyMove, inCheck } = require('../chess/engine');

const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
// piece-square tables from white's point of view, row 0 = rank 8
const PST = {
  p: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  n: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  b: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  r: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  k: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
  kEnd: [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50],
};
const MATE = 100000;

function evaluate(pos) {
  const b = pos.board;
  let heavy = 0;
  for (const p of b) if (p && (p.t === 'q' || p.t === 'r' || p.t === 'n' || p.t === 'b')) heavy += VAL[p.t];
  const endgame = heavy <= 1700;
  let score = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = b[sq];
    if (!p) continue;
    const idx = p.c === 'w' ? sq : (7 - (sq >> 3)) * 8 + (sq & 7);
    const table = p.t === 'k' && endgame ? PST.kEnd : PST[p.t];
    const v = VAL[p.t] + table[idx];
    score += p.c === 'w' ? v : -v;
  }
  return pos.turn === 'w' ? score : -score;
}

const order = (moves) => moves.sort((a, b) => ((b.captured ? VAL[b.captured] * 10 - VAL[b.piece] : 0) + (b.promo ? 800 : 0))
  - ((a.captured ? VAL[a.captured] * 10 - VAL[a.piece] : 0) + (a.promo ? 800 : 0)));

function quiesce(pos, alpha, beta, st, qd = 0) {
  st.nodes++;
  if ((st.nodes & 127) === 0 && Date.now() > st.deadline) st.timeout = true;
  const stand = evaluate(pos);
  if (st.timeout) return stand;
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;
  if (qd > 6) return alpha;
  const caps = order(legalMoves(pos).filter((m) => m.captured || m.promo));
  for (const m of caps) {
    const v = -quiesce(applyMove(pos, m), -beta, -alpha, st, qd + 1);
    if (v >= beta) return beta;
    if (v > alpha) alpha = v;
  }
  return alpha;
}

function search(pos, depth, alpha, beta, ply, st) {
  st.nodes++;
  if ((st.nodes & 127) === 0 && Date.now() > st.deadline) st.timeout = true;
  if (st.timeout) return 0;
  const moves = legalMoves(pos);
  if (!moves.length) return inCheck(pos) ? -MATE + ply : 0;
  if (pos.half >= 100) return 0;
  if (depth <= 0) return quiesce(pos, alpha, beta, st);
  order(moves);
  let best = -Infinity;
  for (const m of moves) {
    const v = -search(applyMove(pos, m), depth - 1, -beta, -alpha, ply + 1, st);
    if (st.timeout) return 0;
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}

const LEVELS = {
  easy: { depth: 1, blunder: 0.3, budget: 60, noise: 60 },
  normal: { depth: 3, blunder: 0.04, budget: 220, noise: 15 },
  hard: { depth: 6, blunder: 0, budget: 400, noise: 0 },
};

/** Best move for the side to move, or null. */
function chooseMove(pos, level = 'normal', random = Math.random) {
  const L = LEVELS[level] || LEVELS.normal;
  const moves = legalMoves(pos);
  if (!moves.length) return null;
  if (moves.length === 1) return moves[0];
  if (random() < L.blunder) return moves[Math.floor(random() * moves.length)];
  const st = { nodes: 0, timeout: false, deadline: Date.now() + L.budget };
  let scored = order(moves.slice()).map((m) => ({ m, v: 0 }));
  for (let d = 1; d <= L.depth; d++) {
    const next = [];
    let alpha = -Infinity;
    for (const { m } of scored) {
      // with no randomness a narrowed window is enough; otherwise every root move needs an exact score
      const beta = L.noise ? Infinity : -alpha;
      let v = -search(applyMove(pos, m), d - 1, -Infinity, beta, 1, st);
      if (st.timeout) break;
      if (!L.noise && alpha !== -Infinity && v <= alpha) v = alpha - 1000; // only a bound: never better than the best
      next.push({ m, v });
      if (v > alpha) alpha = v;
    }
    if (st.timeout && next.length < scored.length) {
      // keep the finished part of this iteration only if it found something better
      if (next.length && next.sort((a, b) => b.v - a.v)[0].v > scored[0].v) scored = next.concat(scored.filter((x) => !next.some((y) => y.m === x.m)));
      break;
    }
    scored = next.sort((a, b) => b.v - a.v);
    if (Math.abs(scored[0].v) > MATE / 2) break;
  }
  const top = scored.filter((x) => x.v >= scored[0].v - L.noise);
  return top[Math.floor(random() * top.length)].m;
}

function acceptsDraw(pos) { return evaluate(pos) <= 50; }

module.exports = { chooseMove, evaluate, acceptsDraw };
