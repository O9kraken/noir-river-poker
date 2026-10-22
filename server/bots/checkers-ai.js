'use strict';
/**
 * Checkers opponent: negamax with alpha-beta over the rules engine.
 * Levels: easy (shallow, often careless), normal, hard (deeper, iterative deepening with a time budget).
 */
const { legalMoves, applyMove, rc, other } = require('../checkers/engine');

const MAN = 100;
const KING = 320;
const WIN = 100000;
const CENTER = new Set([27, 28, 35, 36, 18, 21, 42, 45]);

/** Static evaluation from `color`'s point of view. */
function evaluate(board, color) {
  let score = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq];
    if (!p) continue;
    const [r] = rc(sq);
    let v;
    if (p.k) v = KING;
    else {
      const adv = p.c === 'w' ? 7 - r : r; // rows travelled from home
      v = MAN + adv * 5;
      if (adv === 0) v += 8; // back rank guards against enemy kings
    }
    if (CENTER.has(sq)) v += 6;
    score += p.c === color ? v : -v;
  }
  return score;
}

function search(board, color, depth, alpha, beta, ply, deadline, stats) {
  stats.nodes += 1;
  if ((stats.nodes & 1023) === 0 && Date.now() > deadline) stats.timeout = true;
  const moves = legalMoves(board, color);
  if (!moves.length) return -WIN + ply;
  // forced captures don't count against the depth (avoids horizon blunders)
  if (depth <= 0 && !moves[0].captures.length) return evaluate(board, color);
  if (stats.timeout) return evaluate(board, color);
  // try big captures and promotions first
  moves.sort((a, b) => b.captures.length - a.captures.length || (b.promote ? 1 : 0) - (a.promote ? 1 : 0));
  let best = -Infinity;
  for (const m of moves) {
    const v = -search(applyMove(board, m), other(color), depth - 1, -beta, -alpha, ply + 1, deadline, stats);
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}

const LEVELS = {
  // budgets stay small: the search runs on the server's event loop
  easy: { depth: 2, blunder: 0.35, budget: 40 },
  normal: { depth: 4, blunder: 0.06, budget: 150 },
  hard: { depth: 8, blunder: 0, budget: 300 },
};

/**
 * Pick a move for `color`. Returns the move ({ path, captures }) or null when there is none.
 * `random` is injectable for tests.
 */
function chooseMove(board, color, level = 'normal', random = Math.random) {
  const L = LEVELS[level] || LEVELS.normal;
  const moves = legalMoves(board, color);
  if (!moves.length) return null;
  if (moves.length === 1) return moves[0];
  if (random() < L.blunder) return moves[Math.floor(random() * moves.length)];
  const deadline = Date.now() + L.budget;
  let scored = moves.map((m) => ({ m, v: 0 }));
  // iterative deepening: keep the last fully finished depth
  for (let d = 1; d <= L.depth; d++) {
    const stats = { nodes: 0, timeout: false };
    const next = [];
    for (const { m } of scored) {
      const v = -search(applyMove(board, m), other(color), d - 1, -Infinity, Infinity, 1, deadline, stats);
      next.push({ m, v });
      if (stats.timeout) break;
    }
    if (stats.timeout && next.length < scored.length) break;
    scored = next.sort((a, b) => b.v - a.v);
    if (Math.abs(scored[0].v) > WIN / 2) break; // found a forced result
    if (Date.now() > deadline) break;
  }
  // among equal best moves pick one at random so games differ
  const top = scored.filter((x) => x.v >= scored[0].v - (level === 'hard' ? 0 : 8));
  return top[Math.floor(random() * top.length)].m;
}

/** Should the bot accept a draw offer? Only when it isn't better. */
function acceptsDraw(board, color) {
  return evaluate(board, color) <= 40;
}

module.exports = { chooseMove, evaluate, acceptsDraw, LEVELS };
