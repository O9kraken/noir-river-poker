'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { io: connect } = require('socket.io-client');
const { createServer } = require('../server');
const { PartyTable } = require('../server/party/base');
const { GAMES } = require('../server/party');

async function boot(t, ptOpts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-'));
  const srv = createServer({ dataFile: path.join(dir, 'u.json'), adminNames: [], ptOpts: { sweepMs: 1e9, ...ptOpts } });
  await new Promise((r) => srv.server.listen(0, r));
  const cl = [];
  t.after(() => { cl.forEach((c) => c.close()); srv.shutdown(); });
  const base = `http://localhost:${srv.server.address().port}`;
  const reg = (name) => fetch(base + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password: 'secret1', agree: true }) }).then((r) => r.json());
  const conn = (token) => new Promise((res) => { const c = connect(base, { auth: { token }, reconnection: false }); cl.push(c); c.on('connect', () => res(c)); });
  const call = (c, ev, p) => new Promise((r) => c.emit(ev, p, r));
  return { srv, reg, conn, call };
}

test('настолки: ушедший со стола встаёт, пустой стол закрывается, новый стол освобождает старый', async (t) => {
  const { srv, reg, conn, call } = await boot(t);
  const ua = await reg('Ушедший');
  const a = await conn(ua.token);
  const PT = srv.extra.pt;
  const id1 = (await call(a, 'pt:create', { game: 'bomb', name: 'Первый', stake: 0, maxPlayers: 4 })).tableId;
  await call(a, 'pt:watch', { tableId: id1 });
  await call(a, 'pt:sit', { tableId: id1 });
  assert.equal(PT.map.get(id1).playerCount(), 1);
  // a new table of their own: the old waiting one is left and closed
  const id2 = (await call(a, 'pt:create', { game: 'spy', name: 'Второй', stake: 0, maxPlayers: 6 })).tableId;
  await call(a, 'pt:sit', { tableId: id2 });
  assert.ok(!PT.map.has(id1), 'старый пустой стол закрыт');
  // walked away to the lobby: seat freed after the away time, then the empty table closes
  await call(a, 'pt:unwatch', { tableId: id2 });
  const now = Date.now();
  srv.ptSweep(now);
  assert.equal(PT.map.get(id2).playerCount(), 1, 'сразу не выкидываем');
  srv.ptSweep(now + 3 * 60 * 1000 + 1);
  assert.equal(PT.map.get(id2).playerCount(), 0, 'встал из-за стола');
  srv.ptSweep(now + 6 * 60 * 1000);
  assert.ok(!PT.map.has(id2), 'пустой стол закрыт');
  // permanent tables never close
  assert.ok(PT.map.has('pt-bomb'));
});

test('настолки: пауза останавливает таймеры и ходы, снимается кем угодно из игроков', () => {
  let now = 0;
  const pending = new Map(); let k = 0;
  const timers = { set(fn, ms) { const id = ++k; pending.set(id, { fn, at: now + ms }); return id; }, clear(id) { pending.delete(id); } };
  const advance = (ms) => { const end = now + ms; for (;;) { const due = [...pending].filter(([, e]) => e.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!due) break; now = due[1].at; pending.delete(due[0]); due[1].fn(); } now = end; };
  const t = new PartyTable({ id: 't', name: 'T', game: 'dark', stake: 0, maxPlayers: 3, options: { goal: 5 } }, {}, { games: GAMES, timers, now: () => now, countdown: 10, resultPause: 10 });
  ['a', 'b', 'c'].forEach((u, i) => { t.sit(u, u.toUpperCase(), i); t.setReady(u, true); });
  advance(20);
  assert.equal(t.status, 'playing');
  const round = t.g.round;
  const left = t.timerLeft('answer');
  t.pause('a');
  assert.ok(t.publicState('b').paused);
  assert.throws(() => t.act('b', 'answer', { cards: [t.g.hands.get(1)[0].id] }), /паузе/);
  advance(120000);
  assert.equal(t.g.round, round, 'таймер ответа стоит');
  assert.equal(t.timerLeft('answer'), left);
  t.unpause('c');
  assert.equal(t.publicState('a').paused, null);
  advance(left + 10);
  assert.notEqual(t.g.round, round, 'после паузы время пошло');
  // pauses are limited, and a long pause ends on its own
  t.pause('a'); t.unpause('a'); t.pause('a'); t.unpause('a');
  assert.throws(() => t.pause('a'), /не больше/);
  t.pause('b');
  advance(3 * 60 * 1000 + 5);
  assert.equal(t.paused, null, 'пауза закончилась сама');
});

test('админка: массовое закрытие столов разных игр', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-'));
  const srv = createServer({ dataFile: path.join(dir, 'u.json'), adminNames: ['Главный'], ptOpts: { sweepMs: 1e9 } });
  await new Promise((r) => srv.server.listen(0, r));
  const cl = [];
  t.after(() => { cl.forEach((c) => c.close()); srv.shutdown(); });
  const base = `http://localhost:${srv.server.address().port}`;
  const reg = (name) => fetch(base + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password: 'secret1', agree: true }) }).then((r) => r.json());
  const conn = (token) => new Promise((res) => { const c = connect(base, { auth: { token }, reconnection: false }); cl.push(c); c.on('connect', () => res(c)); });
  const call = (c, ev, p) => new Promise((r) => c.emit(ev, p, r));
  const [adm, pl] = [await reg('Главный'), await reg('Игрок')];
  const [a, p] = [await conn(adm.token), await conn(pl.token)];
  const id1 = (await call(p, 'pt:create', { game: 'bomb', name: 'Раз', stake: 0, maxPlayers: 4 })).tableId;
  const id2 = (await call(p, 'pt:create', { game: 'spy', name: 'Два', stake: 0, maxPlayers: 6 })).tableId;
  await call(p, 'pt:sit', { tableId: id2 });
  const ov = await call(a, 'admin:overview', {});
  assert.ok(ov.extra.some((x) => x.id === id1 && x.kind === 'pt' && x.creator === 'Игрок'));
  assert.ok((await call(p, 'admin:bulk', { items: [{ kind: 'pt', id: id1 }], action: 'close' })).error, 'не админ — нельзя');
  const res = await call(a, 'admin:bulk', { items: [{ kind: 'pt', id: id1 }, { kind: 'pt', id: id2 }, { kind: 'durak', id: 'nope' }], action: 'close' });
  assert.equal(res.done, 2);
  assert.ok(!srv.extra.pt.map.has(id1) && !srv.extra.pt.map.has(id2));
});
