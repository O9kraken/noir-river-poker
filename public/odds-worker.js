/* Odds calculator: Monte Carlo over the cards the player cannot see.
 * Uses only what the player already knows (own hole cards + the board), so it gives no unfair edge.
 * Input:  { key, game: {hole, deck, omaha}, hole: [...], board: [...], opponents, iterations }
 * Output: { key, equity, win, tie, cats: [p0..p9], current, iterations }
 */
'use strict';

const RANKS = '23456789TJQKA';
const SUITS = 'shdc';
const rv = (c) => RANKS.indexOf(c[0]) + 2;
const SHORT_RANK = [0, 1, 2, 4, 3, 6, 5, 7, 8, 8];

function score5(cards, sd) {
  const r = [rv(cards[0]), rv(cards[1]), rv(cards[2]), rv(cards[3]), rv(cards[4])].sort((a, b) => b - a);
  const s0 = cards[0][1];
  const flush = cards[1][1] === s0 && cards[2][1] === s0 && cards[3][1] === s0 && cards[4][1] === s0;
  const uniq = r[0] !== r[1] && r[1] !== r[2] && r[2] !== r[3] && r[3] !== r[4];
  let sh = 0;
  if (uniq) {
    if (r[0] - r[4] === 4) sh = r[0];
    else if (!sd && r[0] === 14 && r[1] === 5) sh = 5;
    else if (sd && r[0] === 14 && r[1] === 9 && r[4] === 6) sh = 9;
  }
  // group counts
  const cnt = {};
  for (const x of r) cnt[x] = (cnt[x] || 0) + 1;
  const groups = Object.keys(cnt).map(Number).sort((a, b) => cnt[b] - cnt[a] || b - a);
  const shape = groups.map((g) => cnt[g]).join('');
  let cat; let k;
  if (sh && flush) { cat = sh === 14 ? 9 : 8; k = [sh]; }
  else if (shape === '41') { cat = 7; k = groups; }
  else if (shape === '32') { cat = 6; k = groups; }
  else if (flush) { cat = 5; k = r; }
  else if (sh) { cat = 4; k = [sh]; }
  else if (shape === '311') { cat = 3; k = groups; }
  else if (shape === '221') { cat = 2; k = groups; }
  else if (shape === '2111') { cat = 1; k = groups; }
  else { cat = 0; k = r; }
  let score = sd ? SHORT_RANK[cat] : cat === 9 ? 8 : cat;
  for (let i = 0; i < 5; i++) score = score * 15 + (k[i] || 0);
  return [score, cat];
}

const C5 = (n) => { const out = []; for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) for (let d = c + 1; d < n; d++) for (let e = d + 1; e < n; e++) out.push([a, b, c, d, e]); return out; };
const C2 = (n) => { const out = []; for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) out.push([a, b]); return out; };
const C3 = (n) => { const out = []; for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) out.push([a, b, c]); return out; };
const IDX7 = C5(7);
const IDX6 = C5(6);
const IDX5 = C5(5);

function best(game, hole, board) {
  let bs = -1; let bc = 0;
  if (game.omaha) {
    for (const [a, b] of C2(hole.length)) {
      for (const [x, y, z] of C3(board.length)) {
        const [s, c] = score5([hole[a], hole[b], board[x], board[y], board[z]], false);
        if (s > bs) { bs = s; bc = c; }
      }
    }
    return [bs, bc];
  }
  const all = hole.concat(board);
  const idx = all.length === 7 ? IDX7 : all.length === 6 ? IDX6 : IDX5;
  const sd = game.deck === 'short';
  for (const p of idx) {
    const [s, c] = score5([all[p[0]], all[p[1]], all[p[2]], all[p[3]], all[p[4]]], sd);
    if (s > bs) { bs = s; bc = c; }
  }
  return [bs, bc];
}

function deckFor(game) {
  const d = [];
  for (const r of RANKS) {
    if (game.deck === 'short' && '2345'.includes(r)) continue;
    for (const s of SUITS) d.push(r + s);
  }
  return d;
}

self.onmessage = (e) => {
  const { key, game, hole, board, opponents, iterations } = e.data;
  const known = new Set(hole.concat(board));
  const rest = deckFor(game).filter((c) => !known.has(c));
  const need = 5 - board.length;
  const oppN = Math.max(0, opponents | 0);
  const cats = new Array(10).fill(0);
  let win = 0; let tie = 0; let eq = 0;
  const n = rest.length;
  const draw = need + oppN * game.hole;
  let iters = iterations;
  if (draw > n) iters = 0;
  const pool = rest.slice();
  for (let it = 0; it < iters; it++) {
    // partial Fisher–Yates: only the cards we need
    for (let i = 0; i < draw; i++) {
      const j = i + Math.floor(Math.random() * (n - i));
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    const fullBoard = board.concat(pool.slice(0, need));
    const [mine, cat] = best(game, hole, fullBoard);
    cats[cat]++;
    if (!oppN) continue;
    let bestOpp = -1; let ties = 0;
    for (let o = 0; o < oppN; o++) {
      const start = need + o * game.hole;
      const [s] = best(game, pool.slice(start, start + game.hole), fullBoard);
      if (s > bestOpp) { bestOpp = s; ties = s === mine ? 1 : 0; } else if (s === bestOpp && s === mine) ties++;
    }
    if (mine > bestOpp) { win++; eq += 1; }
    else if (mine === bestOpp) { tie++; eq += 1 / (ties + 1); }
  }
  let current = null;
  if (board.length >= 3) current = best(game, hole, board)[1];
  else if (!game.omaha && hole.length === 2 && hole[0][0] === hole[1][0]) current = 1;
  else if (!game.omaha) current = 0;
  self.postMessage({
    key,
    iterations: iters,
    equity: iters && oppN ? eq / iters : null,
    win: iters ? win / iters : 0,
    tie: iters ? tie / iters : 0,
    cats: cats.map((x) => (iters ? x / iters : 0)),
    current,
  });
};
