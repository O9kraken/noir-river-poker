'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { io: connect } = require('socket.io-client');
const { createServer } = require('../server');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('сервер: регистрация, посадка, игра живыми игроками, сохранение фишек', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-'));
  const dataFile = path.join(dir, 'users.json');
  const srv = createServer({ dataFile, actionTime: 3000, tableOpts: { startDelay: 50, pauseAfterHand: 80, runoutDelay: 10 } });
  await new Promise((r) => srv.server.listen(0, r));
  t.after(() => { try { srv.shutdown(); } catch (e) { /* already closed */ } });
  const base = `http://localhost:${srv.server.address().port}`;

  const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));

  // регистрация и валидация
  assert.equal((await post('/api/register', { name: 'ab', password: '123456' })).status, 400);
  assert.equal((await post('/api/register', { name: 'Алиса', password: '123' })).status, 400);
  const names = ['Алиса', 'Борис', 'Вера'];
  const tokens = [];
  for (const n of names) {
    const r = await post('/api/register', { name: n, password: 'secret1' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    tokens.push(r.body.token);
  }
  assert.equal((await post('/api/register', { name: 'алиса', password: 'secret1' })).status, 400, 'ник уникален без учёта регистра');
  assert.equal((await post('/api/login', { name: 'Алиса', password: 'wrong!!' })).status, 400);
  assert.equal((await post('/api/login', { name: 'Алиса', password: 'secret1' })).status, 200);

  // без токена соединение отклоняется
  const bad = connect(base, { auth: { token: 'nope' }, reconnection: false });
  const badErr = await new Promise((r) => bad.on('connect_error', (e) => r(e.message)));
  assert.equal(badErr, 'unauthorized');
  bad.close();

  let clients = [];
  t.after(() => clients.forEach((c) => c.close()));
  clients = await Promise.all(tokens.map((token) => new Promise((resolve) => {
    const c = connect(base, { auth: { token }, reconnection: false });
    c.state = null;
    c.on('table:state', (s) => { c.state = s; });
    c.on('connect', () => resolve(c));
  })));
  const call = (c, ev, p) => new Promise((r) => c.emit(ev, p, r));

  const hello = await call(clients[0], 'hello', {});
  assert.ok(hello.ok && hello.tables.length >= 5);
  const tableId = 'holdem-micro';
  const tbl = srv.tables.get(tableId);

  // зритель
  const watch = await call(clients[2], 'table:watch', { tableId });
  assert.ok(watch.ok);

  // бай-ин больше баланса и неверное место
  assert.match((await call(clients[0], 'table:sit', { tableId, seat: 0, buyIn: 999999 })).error, /Бай-ин|Недостаточно/);
  assert.ok((await call(clients[0], 'table:sit', { tableId, seat: 99, buyIn: 1000 })).error);

  assert.ok((await call(clients[0], 'table:sit', { tableId, seat: 0, buyIn: 1000 })).ok);
  assert.ok((await call(clients[1], 'table:sit', { tableId, seat: 3, buyIn: 1500 })).ok);
  assert.ok((await call(clients[2], 'table:sit', { tableId, seat: 5, buyIn: 800 })).ok);
  assert.ok((await call(clients[2], 'table:sit', { tableId, seat: 1, buyIn: 800 })).error, 'нельзя сесть дважды');

  const totalChips = () => Object.values(srv.store.data.users).reduce((s, u) => s + u.balance, 0) + tbl.chipsOnTable();
  const start = 30000;
  assert.equal(totalChips(), start);

  // играем случайными действиями через сокеты
  let hands = 0;
  let lastHand = 0;
  const deadline = Date.now() + 15000;
  while (hands < 25 && Date.now() < deadline) {
    await sleep(15);
    for (const c of clients) {
      const s = c.state;
      if (!s || !s.you || !s.you.turn) continue;
      const key = `${s.handNo}-${s.street}-${s.currentBet}-${s.toAct}-${s.you.turn.myBet}`;
      if (c.actedKey === key) continue; // ждём свежее состояние
      c.actedKey = key;
      // клиент видит только свои карты (кроме вскрытых на шоудауне)
      s.seats.forEach((seat, i) => {
        if (seat && i !== s.mySeat && seat.cards) assert.ok(!s.inHand || tbl.seats[i].revealed, 'утечка чужих карт');
      });
      const t = s.you.turn;
      const x = Math.random();
      let res;
      if (x < 0.15) res = await call(c, 'table:act', { tableId, type: 'fold' });
      else if (x < 0.75 || !t.canRaise) res = await call(c, 'table:act', { tableId, type: t.canCheck ? 'check' : 'call' });
      else res = await call(c, 'table:act', { tableId, type: 'raise', amount: t.minTo });
      if (res.error && !/не ваш ход|не идёт/.test(res.error)) assert.fail(res.error);
    }
    if (tbl.handNo !== lastHand) { lastHand = tbl.handNo; hands++; }
    assert.equal(totalChips(), start, 'фишки сохраняются');
    // докупка разорившихся, чтобы игра шла
    for (const c of clients) {
      const s = c.state;
      if (!s || !s.you || !s.you.sittingOut || s.inHand) continue;
      if (s.you.stack === 0) await call(c, 'table:addchips', { tableId, amount: 500 });
      else await call(c, 'table:sitout', { tableId, value: false });
    }
  }
  assert.ok(hands >= 10, `сыграно раздач: ${hands}`);

  // чат
  assert.ok((await call(clients[0], 'table:chat', { tableId, text: '<b>gl hf</b>' })).ok);
  await sleep(50);
  assert.equal(tbl.chat.at(-1).text, '<b>gl hf</b>', 'текст хранится как есть, экранируется клиентом');

  // встать: фишки возвращаются на баланс
  for (const c of clients) await call(c, 'table:stand', { tableId });
  for (let i = 0; i < 100 && tbl.playerCount() > 0; i++) await sleep(30);
  assert.equal(tbl.playerCount(), 0);
  assert.equal(Object.values(srv.store.data.users).reduce((s, u) => s + u.balance, 0), start, 'всё вернулось на балансы');

  // создание стола
  const created = await call(clients[0], 'table:create', { name: 'Мой', game: 'PLO', stakes: 1, seats: 2 });
  assert.ok(created.ok && srv.tables.get(created.tableId).game === 'PLO');

  clients.forEach((c) => c.close());
  srv.shutdown();
  // данные пережили перезапуск
  const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  assert.equal(Object.keys(saved.users).length, 3);
});

test('сервер: при падении фишки за столом возвращаются на баланс при старте', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-'));
  const dataFile = path.join(dir, 'users.json');
  fs.writeFileSync(dataFile, JSON.stringify({
    users: { u1: { id: 'u1', name: 'X', nameLower: 'x', salt: 's', hash: 'h', balance: 100, inPlay: { t1: 900 }, lastBonus: 0 } },
    sessions: {},
  }));
  const { Store } = require('../server/store');
  const st = new Store(dataFile);
  assert.equal(st.get('u1').balance, 1000);
  assert.deepEqual(st.get('u1').inPlay, {});
  st.saveNow();
});

test('Sit & Go: регистрация, отмена, старт при заполнении, призы, новый турнир', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-'));
  const srv = createServer({
    dataFile: path.join(dir, 'users.json'), actionTime: 3000,
    tableOpts: { startDelay: 30, pauseAfterHand: 40, runoutDelay: 5 },
    sngTemplates: [
      { id: 'hu', name: 'Дуэль', game: 'NLH', seats: 2, buyIn: 1000, startStack: 1500, levelMinutes: 1 },
      { id: 'three', name: 'Трое', game: 'PLO', seats: 3, buyIn: 500, startStack: 1500, levelMinutes: 1 },
    ],
    levelMs: 200, sngLinger: 50,
  });
  await new Promise((r) => srv.server.listen(0, r));
  t.after(() => { try { srv.shutdown(); } catch (e) { /* closed */ } });
  const base = `http://localhost:${srv.server.address().port}`;
  const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const tokens = [];
  for (const n of ['Игрок1', 'Игрок2', 'Игрок3']) tokens.push((await post('/api/register', { name: n, password: 'secret1' })).token);
  let clients = [];
  t.after(() => clients.forEach((c) => c.close()));
  clients = await Promise.all(tokens.map((token) => new Promise((resolve) => {
    const c = connect(base, { auth: { token }, reconnection: false });
    c.events = [];
    c.on('sng:started', (e) => c.events.push(['started', e]));
    c.on('sng:result', (e) => c.events.push(['result', e]));
    c.on('table:state', (s) => { c.state = s; });
    c.on('connect', () => resolve(c));
  })));
  const call = (c, ev, p) => new Promise((r) => c.emit(ev, p, r));
  const balances = () => Object.values(srv.store.data.users).map((u) => u.balance);
  const sum = (a) => a.reduce((x, y) => x + y, 0);

  const hello = await call(clients[0], 'hello', {});
  const duel = hello.sngs.find((x) => x.templateId === 'hu');
  assert.equal(duel.status, 'registering');
  assert.deepEqual(duel.payouts, [2000]);

  // регистрация и отмена с возвратом
  assert.ok((await call(clients[0], 'sng:register', { sngId: duel.id })).ok);
  assert.match((await call(clients[0], 'sng:register', { sngId: duel.id })).error, /уже/);
  assert.equal(srv.store.get(Object.keys(srv.store.data.users)[0]).balance, 9000);
  assert.ok((await call(clients[0], 'sng:unregister', { sngId: duel.id })).ok);
  assert.equal(sum(balances()), 30000);

  // заполняем — турнир стартует
  assert.ok((await call(clients[0], 'sng:register', { sngId: duel.id })).ok);
  const reg = await call(clients[1], 'sng:register', { sngId: duel.id });
  assert.ok(reg.ok && reg.tableId, 'стол турнира создан');
  const sng = srv.sngs.get(duel.id);
  assert.equal(sng.status, 'running');
  assert.ok([...srv.sngs.values()].some((x) => x.templateId === 'hu' && x.status === 'registering'), 'открыт новый турнир того же типа');
  const tbl = srv.tables.get(reg.tableId);
  assert.equal(tbl.tournament, true);
  assert.ok((await call(clients[0], 'table:watch', { tableId: tbl.id })).ok);
  await call(clients[1], 'table:watch', { tableId: tbl.id });
  assert.ok((await call(clients[0], 'table:stand', { tableId: tbl.id })).error, 'встать нельзя');
  assert.ok((await call(clients[0], 'table:addchips', { tableId: tbl.id, amount: 100 })).error, 'докупки нет');

  // играем олл-инами до конца
  const deadline = Date.now() + 20000;
  let sawLevelUp = false;
  while (sng.status === 'running' && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10));
    if (tbl.bb > 20) sawLevelUp = true;
    for (const c of clients.slice(0, 2)) {
      const s = c.state;
      if (s && s.you && s.you.turn) { c.state = null; await call(c, 'table:act', { tableId: tbl.id, type: 'allin' }); }
    }
    // фишки турнира не влияют на балансы
    assert.equal(sum(balances()), 30000 - 2000 + sng.players.reduce((a, p) => a + p.prize, 0));
  }
  assert.equal(sng.status, 'finished');
  assert.ok(sawLevelUp || tbl.handNo < 3, 'блайнды росли');
  const winner = sng.players.find((p) => p.place === 1);
  const loser = sng.players.find((p) => p.place === 2);
  assert.ok(winner && loser);
  assert.equal(winner.prize, 2000);
  assert.equal(sum(balances()), 30000, 'призовой фонд выплачен целиком');
  await new Promise((r) => setTimeout(r, 100));
  const events = clients[0].events.concat(clients[1].events);
  assert.ok(events.some(([e]) => e === 'started'));
  assert.equal(events.filter(([e]) => e === 'result').length, 2);
  assert.ok(!srv.tables.has(tbl.id), 'стол завершённого турнира убран');

  // история и повтор доступны за обычным столом
  const three = [...srv.sngs.values()].find((x) => x.templateId === 'three');
  await call(clients[0], 'sng:register', { sngId: three.id });
  await call(clients[1], 'sng:register', { sngId: three.id });
  const r3 = await call(clients[2], 'sng:register', { sngId: three.id });
  assert.ok(r3.ok);
  const t3 = srv.tables.get(r3.tableId);
  assert.equal(t3.game, 'PLO');
  // остановка сервера посреди турнира: остаток фонда делится по фишкам
  await new Promise((r) => setTimeout(r, 100));
  srv.shutdown();
  assert.equal(sum(balances()), 30000, 'при остановке ничего не потеряно');
});
