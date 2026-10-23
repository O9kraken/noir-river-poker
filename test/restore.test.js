'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { io: connect } = require('socket.io-client');
const { createServer } = require('../server');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('деплой: свои столы, места, фишки на покерном столе и идущая партия в настолку переживают перезапуск', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-'));
  const dataFile = path.join(dir, 'u.json');
  const opts = { dataFile, adminNames: [], ptOpts: { countdown: 10 }, tableOpts: { startDelay: 60000 } };
  let srv = createServer(opts);
  await new Promise((r) => srv.server.listen(0, r));
  let base = `http://localhost:${srv.server.address().port}`;
  const reg = (name) => fetch(base + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password: 'secret1', agree: true }) }).then((r) => r.json());
  const users = [await reg('Первый'), await reg('Второй')];
  let clients = [];
  const conn = (token) => new Promise((res) => { const c = connect(base, { auth: { token }, reconnection: false }); clients.push(c); c.on('pt:state', (s) => { c.st = s; }); c.on('connect', () => res(c)); });
  const call = (c, ev, p) => new Promise((r) => c.emit(ev, p, r));
  let [a, b] = [await conn(users[0].token), await conn(users[1].token)];
  // a board game on chips, started
  const pt = (await call(a, 'pt:create', { game: 'bomb', name: 'Котики', stake: 100, maxPlayers: 4 })).tableId;
  for (const c of [a, b]) { await call(c, 'pt:watch', { tableId: pt }); await call(c, 'pt:sit', { tableId: pt }); await call(c, 'pt:ready', { tableId: pt, value: true }); }
  await sleep(150);
  assert.equal(a.st.status, 'playing');
  const handBefore = a.st.g.hand.map((x) => x.id).join(',');
  // an own poker table with a seat
  const pk = (await call(a, 'table:create', { name: 'Покерок', game: 'NLH', stakes: 1, seats: 6 })).tableId;
  const tp = srv.tables.get(pk);
  await call(b, 'table:sit', { tableId: pk, seat: 2, buyIn: tp.minBuyIn });
  // an own checkers table
  const ck = (await call(a, 'ck:create', { name: 'Шашечки', stake: 100, clock: 5 })).tableId;
  await call(a, 'ck:sit', { tableId: ck, seat: 0 });
  const total = (id) => { const u = srv.store.get(id); return u.balance + Object.values(u.inPlay).reduce((x, y) => x + y, 0); };
  const before = users.map((u) => total(u.user.id));
  clients.forEach((c) => c.close());
  await srv.shutdown();

  // the new server
  srv = createServer(opts);
  await new Promise((r) => srv.server.listen(0, r));
  t.after(() => { clients.forEach((c) => c.close()); srv.shutdown(); });
  base = `http://localhost:${srv.server.address().port}`;
  const after = users.map((u) => total(u.user.id));
  assert.deepEqual(after, before, 'фишек ровно столько же');
  const P = srv.extra.pt.map.get(pt);
  assert.ok(P, 'настолка на месте');
  assert.equal(P.status, 'playing', 'партия продолжается');
  assert.equal(P.pot, 200, 'банк собран заново');
  assert.ok(srv.tables.get(pk), 'покерный стол на месте');
  assert.equal(srv.tables.get(pk).seats[2].userId, users[1].user.id, 'игрок на своём месте');
  assert.equal(srv.tables.get(pk).seats[2].stack, tp.minBuyIn, 'с тем же стеком');
  assert.equal(srv.extra.ck.map.get(ck).seats[0].userId, users[0].user.id);
  clients = [];
  a = await conn(users[0].token);
  const st = await call(a, 'pt:watch', { tableId: pt });
  assert.equal(st.state.g.hand.map((x) => x.id).join(','), handBefore, 'те же карты на руке');
  assert.ok(st.state.seats.some((x) => x && x.name === 'Первый' && x.connected), 'вернулся — снова в сети');
});
