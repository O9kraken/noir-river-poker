'use strict';
const { rankValue } = require('./cards');
const { GAMES } = require('./games');

const CATEGORY_NAMES = [
  'Старшая карта', 'Пара', 'Две пары', 'Сет', 'Стрит',
  'Флеш', 'Фулл-хаус', 'Каре', 'Стрит-флеш', 'Роял-флеш',
];

// Short deck order: high, pair, two pair, STRAIGHT, TRIPS, FULL HOUSE, FLUSH, quads, straight flush
const SHORT_RANK = [0, 1, 2, 4, 3, 6, 5, 7, 8, 8];

/**
 * Scores exactly five cards. Higher score = stronger hand.
 * Score = category * 15^5 + tie-breakers packed in base 15.
 * shortDeck: 36-card rules (A-6-7-8-9 is the lowest straight, flush > full house, trips > straight).
 */
function score5(cards, shortDeck = false) {
  const ranks = cards.map(rankValue).sort((a, b) => b - a);
  const flush = cards.every((c) => c[1] === cards[0][1]);

  const unique = [...new Set(ranks)];
  let straightHigh = 0;
  if (unique.length === 5) {
    if (ranks[0] - ranks[4] === 4) straightHigh = ranks[0];
    else if (!shortDeck && ranks[0] === 14 && ranks[1] === 5) straightHigh = 5; // wheel A-2-3-4-5
    else if (shortDeck && ranks[0] === 14 && ranks[1] === 9 && ranks[4] === 6) straightHigh = 9; // A-6-7-8-9
  }

  const counts = new Map();
  for (const r of ranks) counts.set(r, (counts.get(r) || 0) + 1);
  // groups sorted by count desc, then rank desc
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const ordered = groups.map((g) => g[0]);
  const shape = groups.map((g) => g[1]).join('');

  let category;
  let kickers;
  if (straightHigh && flush) { category = straightHigh === 14 ? 9 : 8; kickers = [straightHigh]; }
  else if (shape === '41') { category = 7; kickers = ordered; }
  else if (shape === '32') { category = 6; kickers = ordered; }
  else if (flush) { category = 5; kickers = ranks; }
  else if (straightHigh) { category = 4; kickers = [straightHigh]; }
  else if (shape === '311') { category = 3; kickers = ordered; }
  else if (shape === '221') { category = 2; kickers = ordered; }
  else if (shape === '2111') { category = 1; kickers = ordered; }
  else { category = 0; kickers = ranks; }

  // Royal flush is a straight flush; give it the same comparison base.
  const cmpCategory = shortDeck ? SHORT_RANK[category] : category === 9 ? 8 : category;
  let score = cmpCategory;
  for (let i = 0; i < 5; i++) score = score * 15 + (kickers[i] || 0);
  return { score, category, cards };
}

function combinations(arr, k, start = 0, acc = [], out = []) {
  if (acc.length === k) { out.push(acc.slice()); return out; }
  for (let i = start; i <= arr.length - (k - acc.length); i++) {
    acc.push(arr[i]);
    combinations(arr, k, i + 1, acc, out);
    acc.pop();
  }
  return out;
}

function better(a, b) { return !b || a.score > b.score ? a : b; }

/** Texas Hold'em: best 5 of hole + board (any combination). */
function bestHoldem(hole, board, shortDeck = false) {
  let best = null;
  for (const combo of combinations([...hole, ...board], 5)) best = better(score5(combo, shortDeck), best);
  return describe(best);
}

/** Omaha: exactly 2 hole cards + exactly 3 board cards. */
function bestOmaha(hole, board) {
  let best = null;
  const holePairs = combinations(hole, 2);
  const boardTrips = combinations(board, 3);
  for (const h of holePairs) for (const b of boardTrips) best = better(score5([...h, ...b]), best);
  return describe(best);
}

function describe(result) {
  return { score: result.score, category: result.category, name: CATEGORY_NAMES[result.category], cards: result.cards };
}

function bestHand(game, hole, board) {
  const g = GAMES[game] || GAMES.NLH;
  return g.omaha ? bestOmaha(hole, board) : bestHoldem(hole, board, g.deck === 'short');
}

module.exports = { score5, bestHoldem, bestOmaha, bestHand, combinations, CATEGORY_NAMES };
