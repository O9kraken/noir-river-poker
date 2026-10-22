'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { RouletteTable, WHEEL, SPOTS, colorOf } = require('../server/roulette/table');
const { CheckersTable } = require('../server/checkers/table');
const { sqOf } = require('../server/checkers/engine');

function fakeTimers() {
  let t = 0; let id = 0; const q = new Map();
  return {
    now: () => t,
    timers: { set: (fn, ms) => { q.set(++id, { fn, at: t + ms }); return id; }, clear: (k) => q.delete(k) },
    run(ms) { const end = t + ms; for (;;) { const next = [...q.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!next) break; q.delete(next[0]); t = next[1].at; next[1].fn(); } t = end; },
  };
}
function wallet(start = 10000) {
  const bal = {}; const inPlay = {};
  return {
    bal, inPlay,
    deps: {
      charge: (u, a) => { bal[u] ??= start; if (bal[u] < a) return false; bal[u] -= a; return true; },
      pay: (u, a) => { bal[u] = (bal[u] ?? start) + a; },
      onInPlay: (u, a) => { inPlay[u] = a; },
    },
  };
}

test('рулетка: колесо европейское, выплаты по таблице', () => {
  assert.equal(WHEEL.length, 37);
  assert.deepEqual([...new Set(WHEEL)].sort((a, b) => a - b), Array.from({ length: 37 }, (_, i) => i));
  assert.equal(colorOf(0), 'green'); assert.equal(colorOf(32), 'red'); assert.equal(colorOf(15), 'black');
  assert.ok(SPOTS.c3.wins(36) && SPOTS.c1.wins(34) && !SPOTS.red.wins(0) && !SPOTS.odd.wins(0));
  // the house edge of every bet is 1/37
  for (const [k, s] of Object.entries(SPOTS)) {
    let ret = 0; for (let n = 0; n <= 36; n++) if (s.wins(n)) ret += s.pays + 1;
    assert.equal(ret, 36, k);
  }
});

test('рулетка: таймер со первой фишки, спин, выплаты, повтор ставок', () => {
  const ft = fakeTimers(); const w = wallet();
  const ends = [];
  const t = new RouletteTable({ id: 'r', name: 'R', minBet: 10, maxBet: 1000 }, { ...w.deps, onRoundEnd: (tt, r) => ends.push(r) }, { timers: ft.timers, now: ft.now, randomInt: () => 17, bettingTime: 10000, spinTime: 5000, resultPause: 3000 });
  t.sit('a', 'Аня', 0); t.sit('b', 'Боря', 1);
  assert.equal(t.publicState('a').bettingIn, 0, 'без ставок таймер не идёт');
  assert.throws(() => t.bet('a', 'n17', 5), /Минимальная/);
  t.bet('a', 'n17', 100); t.bet('a', 'red', 50); t.bet('b', 'black', 200); t.bet('b', 'd2', 100);
  assert.throws(() => t.bet('a', 'n1', 900), /не больше 1000/);
  t.undo('b');
  assert.equal(w.bal.b, 9800);
  assert.equal(t.publicState('a').bettingIn, 10000);
  ft.run(10000);
  assert.equal(t.status, 'spinning');
  assert.throws(() => t.bet('a', 'n1', 10), /ставок больше нет/);
  assert.equal(t.publicState('a').result, 17);
  ft.run(5000);
  assert.equal(t.status, 'result');
  assert.equal(w.bal.a, 10000 - 150 + 3600);
  assert.equal(w.bal.b, 9800 + 400);
  assert.deepEqual(ends[0].map((r) => r.net), [3450, 200]);
  assert.ok(ends[0][0].straight);
  ft.run(3000);
  assert.equal(t.status, 'betting');
  t.rebet('a');
  assert.deepEqual(t.seats[0].bets, { n17: 100, red: 50 });
  t.leave('a');
  assert.equal(w.bal.a, 10000 - 150 + 3600, 'ушёл до спина — ставки вернулись');
  assert.equal(w.inPlay.a, 0);
});

test('шашки: ставки, ход, сдача, банк победителю, ничья возвращает ставки', () => {
  const ft = fakeTimers(); const w = wallet();
  const ends = [];
  const t = new CheckersTable({ id: 'c', name: 'C', stake: 500 }, { ...w.deps, onGameEnd: (tt, r) => ends.push(r) }, { timers: ft.timers, now: ft.now, resultPause: 1000 });
  t.sit('a', 'Аня', 0); t.sit('b', 'Боря', 1);
  t.setReady('a', true);
  assert.equal(t.status, 'waiting');
  t.setReady('b', true);
  assert.equal(t.status, 'playing');
  assert.equal(w.bal.a, 9500); assert.equal(w.bal.b, 9500);
  const white = t.seats[t.colors.w].userId; const black = t.seats[t.colors.b].userId;
  const st = t.publicState(white);
  assert.equal(st.myColor, 'w'); assert.equal(st.legal.length, 7);
  assert.equal(t.publicState(black).legal.length, 0);
  assert.throws(() => t.move(black, [sqOf(2, 1), sqOf(3, 0)]), /соперника/);
  t.move(white, st.legal[0]);
  assert.equal(t.publicState(white).turn, 'b');
  t.resign(black);
  assert.equal(t.status, 'result');
  assert.equal(w.bal[white], 10500); assert.equal(w.bal[black], 9500);
  assert.equal(ends[0].find((r) => r.userId === white).net, 500);
  ft.run(1000);
  assert.equal(t.status, 'waiting');
  // second game: colours swap, draw by agreement
  t.setReady('a', true); t.setReady('b', true);
  assert.equal(t.seats[t.colors.w].userId, black, 'цвета меняются');
  t.offerDraw('a'); t.offerDraw('b');
  assert.equal(t.lastResult.reason, 'agreed');
  assert.equal(w.bal[white], 10500); assert.equal(w.bal[black], 9500);
  ft.run(1000);
  // third game: time runs out
  t.setReady('a', true); t.setReady('b', true);
  const mover = t.seats[t.colors.w].userId;
  ft.run(5 * 60 * 1000 + 100);
  assert.equal(t.lastResult.reason, 'time');
  assert.equal(t.lastResult.winner, 'b');
  assert.ok(w.bal[mover] < 10500);
});
