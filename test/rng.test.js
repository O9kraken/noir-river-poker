'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { newDeck, shuffle } = require('../server/engine/cards');
const { bestHoldem } = require('../server/engine/evaluator');

// Exact frequencies of the best 5-card hand out of 7 cards (Hold'em, 2 hole + 5 board).
const EXACT = [17.41, 43.83, 23.50, 4.83, 4.62, 3.03, 2.60, 0.168, 0.031];

test('честность раздачи: частоты комбинаций совпадают с математикой', () => {
  const N = 40000;
  const cnt = new Array(9).fill(0);
  for (let i = 0; i < N; i++) {
    const d = shuffle(newDeck());
    const c = bestHoldem([d[0], d[1]], d.slice(2, 7)).category;
    cnt[Math.min(c, 8)]++;
  }
  let chi = 0;
  for (let k = 0; k < 9; k++) {
    const exp = (EXACT[k] / 100) * N;
    if (exp >= 5) chi += (cnt[k] - exp) ** 2 / exp;
  }
  // 7 degrees of freedom: 24.3 is the 0.1% critical value
  assert.ok(chi < 24.3, `хи-квадрат ${chi.toFixed(1)}: ${cnt.join(', ')}`);
  // "a combination every hand" is normal: pair or better ~82.6% of the time
  const pairPlus = (N - cnt[0]) / N;
  assert.ok(Math.abs(pairPlus - 0.8259) < 0.012, `пара и лучше: ${(pairPlus * 100).toFixed(1)}%`);
});

test('честность тасовки: каждая карта равновероятно на первом месте', () => {
  const N = 52000;
  const first = new Map();
  for (let i = 0; i < N; i++) { const c = shuffle(newDeck())[0]; first.set(c, (first.get(c) || 0) + 1); }
  assert.equal(first.size, 52);
  let chi = 0;
  for (const v of first.values()) chi += (v - 1000) ** 2 / 1000;
  assert.ok(chi < 97, `хи-квадрат ${chi.toFixed(1)} (51 ст. св., порог 0,01%)`);
});
