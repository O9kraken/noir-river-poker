'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { io: connect } = require('socket.io-client');
const { NardyGame, NardyPosition, abs, own } = require('../server/nardy/engine');
const bp = (whitePoint) => own('b', abs('w', whitePoint)); // black's own number of a white point
const { NardyTable } = require('../server/nardy/table');
const { BotDriver, makeBots } = require('../server/bots');
const ai = require('../server/bots/nardy-ai');
const { createServer } = require('../server');

/** A position from { w: { point: count }, b: { point: count } } in each side's own points. */
function setup(spec, off = { w: 0, b: 0 }) {
  const p = new NardyPosition();
  for (const c of ['w', 'b']) for (const [pt, n] of Object.entries(spec[c] || {})) { p.c[abs(c, Number(pt))] = c; p.n[abs(c, Number(pt))] = n; }
  p.off = { ...off };
  return p;
}
const game = (pos, turn = 'w') => { const g = new NardyGame(turn); g.pos = pos; g.firstThrow = { w: false, b: false }; return g; };

test('нарды: старт, голова, дубли первого броска', () => {
  let g = new NardyGame('w');
  assert.equal(g.pos.at('w', 24), 15);
  assert.equal(g.pos.at('b', 24), 15);
  assert.notEqual(abs('w', 24), abs('b', 24));
  g.roll([5, 2]);
  assert.deepEqual(g.legal().map((m) => `${m.from}-${m.to}`).sort(), ['24-19', '24-22']);
  g.play('w', 24, 5);
  assert.deepEqual(g.legal().map((m) => `${m.from}-${m.to}`), ['19-17'], 'с головы — только одна шашка');
  // first throw 6-6: two checkers leave the head (24→18 twice; 18→12 is the enemy head)
  g = new NardyGame('w');
  g.roll([6, 6]);
  assert.equal(g.need, 2);
  g.play('w', 24, 6); g.play('w', 24, 6);
  assert.ok(g.done());
  g.endTurn();
  // later in the game 6-6 allows only one from the head again
  g.roll([1, 2]); g.play('b', 24, 2); g.play('b', 22, 1); g.endTurn();
  g.roll([6, 6]);
  const heads = g.legal().filter((m) => m.from === 24);
  assert.equal(heads.length, 1);
  g.play('w', 24, 6);
  assert.ok(!g.legal().some((m) => m.from === 24), 'вторая шашка с головы нельзя');
});

test('нарды: чужая шашка закрывает пункт, обязательный больший кубик, отмена', () => {
  // white on 10, black occupies white's 7 and 5: 10-3 and 10-5 closed
  const pos = setup({ w: { 10: 1, 1: 14 }, b: { [bp(7)]: 1, [bp(5)]: 1, 24: 13 } });
  assert.equal(pos.c[abs('w', 7)], 'b');
  let g = game(pos);
  g.roll([3, 5]);
  assert.equal(g.need, 0, 'оба хода закрыты');
  // only one of two dice is playable: it must be the larger one when possible
  const p2 = setup({ w: { 9: 1, 1: 14 }, b: { [bp(3)]: 1, 24: 14 } });
  g = game(p2);
  g.roll([2, 6]);
  assert.ok(g.need >= 1);
  // undo returns to the start of the turn
  const before = g.pos.key();
  const m = g.legal()[0];
  g.play('w', m.from, m.die);
  g.undo('w');
  assert.equal(g.pos.key(), before);
});

test('нарды: запрет глухого заслона из шести пунктов', () => {
  // white holds 13..17 (in black's coordinates that's black's 1..5 region? use own coords) and moves onto the sixth
  const pos = setup({ w: { 20: 1, 19: 1, 18: 1, 17: 1, 16: 1, 22: 1, 1: 9 }, b: { 24: 15 } });
  const g = game(pos);
  g.roll([1, 3]);
  // 22→21 would make 21..16 six in a row with every black checker still behind (on its head): not allowed
  assert.ok(!g.legal().some((m) => m.from === 22 && m.to === 21), 'шесть подряд без обогнавшей шашки нельзя');
  // when a black checker is already past the block, it is allowed
  // a black checker on its own point 2 has already gone past the block
  const pos2 = setup({ w: { 20: 1, 19: 1, 18: 1, 17: 1, 16: 1, 22: 1, 1: 9 }, b: { 24: 14, 2: 1 } });
  const g2 = game(pos2);
  g2.roll([1, 3]);
  assert.ok(g2.legal().some((m) => m.from === 22 && m.to === 21));
});

test('нарды: выброс шашек точным и большим кубиком, марс', () => {
  const pos = setup({ w: { 1: 1, 3: 1, 5: 13 }, b: { 24: 15 } });
  const g = game(pos);
  g.roll([6, 2]);
  // 6 removes from the highest point (5); 2 cannot remove from 3 while... 3-2=1 is a move, 1-2 off only if no higher
  const L = g.legal().map((m) => `${m.from}-${m.to}-${m.die}`);
  assert.ok(L.includes('5-0-6'), 'большим кубиком с самого дальнего пункта');
  assert.ok(!L.includes('1-0-2'), 'с первого пункта кубиком 2 нельзя, пока есть шашки выше');
  const last = setup({ w: { 2: 1 }, b: { 24: 15 } }, { w: 14, b: 0 });
  const g2 = game(last);
  g2.roll([4, 1]);
  g2.play('w', 2, 4);
  assert.deepEqual(g2.result, { winner: 'w', reason: 'mars' });
});

test('нарды: бот против бота за столом доигрывают, банк победителю', async () => {
  const paid = {};
  const t = new NardyTable({ id: 'bg1', name: 'Тест', stake: 100, turnSec: 60 }, {
    charge: () => true, pay: (u, a) => { paid[u] = (paid[u] || 0) + a; }, onUpdate: () => t.bots && t.bots.poke(),
  }, { endDelay: 0, noMoveDelay: 0, resultPause: 100000 });
  const bots = makeBots(2);
  t.bots = new BotDriver(t, 'bg', bots, 'normal', { fast: true });
  // two bots on one driver: it acts for whichever bot's turn it is
  t.bots._pending = function pending() {
    if (t.status === 'waiting') return t.seats.some((s) => s && !s.ready) ? 0 : null;
    if (t.status !== 'playing' || t.game.result) return null;
    return t.game.done() ? null : 0;
  };
  t.bots._step = function stepBoth() {
    if (t.status === 'waiting') { for (const s of t.seats) if (!s.ready) t.setReady(s.userId, true); return; }
    const g = t.game; const seat = t.colors[g.turn]; const uid = t.seats[seat].userId;
    if (!g.dice) { t.roll(uid); return; }
    const plan = ai.chooseTurn(g, 'normal');
    for (const m of plan) { if (t.status !== 'playing') break; t.move(uid, { from: m.from, die: m.die }); }
  };
  t.sit(bots[0].userId, bots[0].name, 0);
  t.sit(bots[1].userId, bots[1].name, 1);
  const until = Date.now() + 30000;
  while (t.status !== 'result' && Date.now() < until) await new Promise((r) => setTimeout(r, 2));
  if (t.status !== 'result') t.destroy();
  assert.equal(t.status, 'result');
  assert.ok(['oin', 'mars'].includes(t.lastResult.reason));
  assert.equal(Object.values(paid).reduce((a, b) => a + b, 0), 200);
  t.destroy();
});

test('сервер: нарды в лобби, создание стола, тренировка с ботом', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-'));
  const srv = createServer({ dataFile: path.join(dir, 'u.json'), adminNames: [], botOpts: { fast: true }, bgOpts: { endDelay: 0, noMoveDelay: 0 } });
  await new Promise((r) => srv.server.listen(0, r));
  let cl;
  t.after(() => { try { cl && cl.close(); srv.shutdown(); } catch (e) { /* closed */ } });
  const base = `http://localhost:${srv.server.address().port}`;
  const reg = await fetch(base + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Шешбеш', password: 'secret1' }) }).then((r) => r.json());
  cl = await new Promise((resolve) => { const s = connect(base, { auth: { token: reg.token }, reconnection: false }); s.on('connect', () => resolve(s)); });
  const call = (ev, p) => new Promise((r) => cl.emit(ev, p, r));
  const hello = await call('hello', {});
  assert.ok(hello.bg.length >= 3);
  assert.deepEqual(hello.bgTimes, [30, 45, 60]);
  const made = await call('bg:create', { name: 'Мои нарды', stake: 100, turn: 30 });
  assert.ok(made.tableId);
  const pr = await call('practice:create', { game: 'bg', level: 'easy' });
  assert.equal(pr.kind, 'bg');
  const states = [];
  cl.on('bg:state', (s) => states.push(s));
  await call('bg:ready', { tableId: pr.id, value: true });
  // play our turns with the bot's brain until a few turns have passed
  for (let k = 0; k < 400; k++) {
    await new Promise((r) => setTimeout(r, 10));
    const st = states[states.length - 1];
    if (!st || !st.nardy) continue;
    if (st.nardy.turnNo >= 6) break;
    if (st.myColor && st.nardy.phase === 'roll' && st.turn === st.myColor) await call('bg:roll', { tableId: pr.id });
    else if (st.nardy.phase === 'move' && st.nardy.legal.length) { const m = st.nardy.legal[0]; await call('bg:move', { tableId: pr.id, from: m.from, die: m.die }); }
  }
  assert.ok(states[states.length - 1].nardy.turnNo >= 6, 'партия идёт: ходы бота и наши');
  const rt = await call('ratings:get', { kind: 'nardy' });
  assert.ok(Array.isArray(rt.list));
});
