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
      { id: 'hu', name: 'Дуэль', game: 'NLH', seats: 2, buyIn: 1000, startStack: 1500, levelHands: 2 },
      { id: 'three', name: 'Трое', game: 'PLO', seats: 3, buyIn: 500, startStack: 1500, levelHands: 2 },
    ],
    sngLinger: 50,
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

test('админка и дурак через сокеты', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-'));
  const srv = createServer({
    dataFile: path.join(dir, 'users.json'), actionTime: 3000, adminNames: [],
    tableOpts: { startDelay: 30, pauseAfterHand: 40, runoutDelay: 5 },
    durakOpts: { actionTime: 40, awayTime: 20, countdown: 20, resultPause: 30, roundPause: 10 },
  });
  await new Promise((r) => srv.server.listen(0, r));
  t.after(() => { try { srv.shutdown(); } catch (e) { /* closed */ } });
  const base = `http://localhost:${srv.server.address().port}`;
  const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const reg = [];
  for (const n of ['Босс', 'Игрок', 'Гость']) reg.push((await post('/api/register', { name: n, password: 'secret1' })).body);
  assert.equal(reg[0].user.role, 'admin', 'первый аккаунт — админ');
  assert.equal(reg[1].user.role, 'player');
  let clients = [];
  t.after(() => clients.forEach((c) => c.close()));
  const connectAs = (token) => new Promise((resolve, reject) => {
    const c = connect(base, { auth: { token }, reconnection: false });
    c.notices = [];
    c.on('notice', (n) => c.notices.push(n));
    c.on('durak:state', (s) => { c.durak = s; });
    c.on('connect', () => resolve(c));
    c.on('connect_error', (e) => reject(e));
  });
  clients = await Promise.all(reg.map((r) => connectAs(r.token)));
  const [boss, pl, guest] = clients;
  const call = (c, ev, p) => new Promise((r) => c.emit(ev, p, r));
  const sum = () => Object.values(srv.store.data.users).reduce((a, u) => a + u.balance + Object.values(u.inPlay || {}).reduce((x, y) => x + y, 0), 0);

  // права
  assert.match((await call(pl, 'admin:overview', {})).error, /прав/);
  const ov = await call(boss, 'admin:overview', {});
  assert.ok(ov.ok && ov.users.length === 3 && ov.stats.online === 3);
  const plId = reg[1].user.id;
  const guestId = reg[2].user.id;

  // фишки
  assert.equal((await call(boss, 'admin:user', { userId: plId, action: 'chips', amount: 500 })).real, 500);
  assert.equal((await call(boss, 'admin:user', { userId: plId, action: 'chips', amount: -999999 })).real, -10500, 'не ниже нуля');
  await call(boss, 'admin:user', { userId: plId, action: 'chips', amount: 10000 });

  // мут
  await call(boss, 'admin:user', { userId: plId, action: 'mute' });
  assert.match((await call(pl, 'table:chat', { tableId: 'holdem-micro', text: 'hi' })).error, /запретил/);
  await call(boss, 'admin:user', { userId: plId, action: 'unmute' });
  assert.ok((await call(pl, 'table:chat', { tableId: 'holdem-micro', text: 'hi' })).ok);

  // объявление
  const ann = new Promise((r) => guest.once('announce', r));
  await call(boss, 'admin:announce', { text: 'Турнир в 21:00!' });
  assert.equal((await ann).text, 'Турнир в 21:00!');

  // стол: создать, сменить блайнды, кикнуть, закрыть с возвратом
  const ct = await call(boss, 'admin:createTable', { name: 'Админский', game: 'NLH', stakes: 1, seats: 6, blindsEvery: 5, permanent: true });
  assert.ok(ct.ok);
  assert.ok((await call(pl, 'table:sit', { tableId: ct.tableId, seat: 0, buyIn: 1000 })).ok);
  assert.ok((await call(boss, 'admin:table', { tableId: ct.tableId, action: 'blinds', sb: 50, bb: 100 })).ok);
  assert.equal(srv.tables.get(ct.tableId).pendingBlinds.bb, 100);
  const before = sum();
  assert.ok((await call(boss, 'admin:table', { tableId: ct.tableId, action: 'close' })).ok);
  assert.ok(!srv.tables.has(ct.tableId));
  assert.equal(sum(), before, 'фишки со стола вернулись');

  // сброс пароля
  const rp = await call(boss, 'admin:user', { userId: guestId, action: 'resetPassword' });
  assert.ok(rp.password && rp.password.length === 8);
  assert.equal((await post('/api/login', { name: 'Гость', password: rp.password })).status, 200);

  // дурак: двое садятся, готовы, партия доигрывается сама (тайм-ауты), банк сходится
  const total0 = sum();
  const g2 = await connectAs((await post('/api/login', { name: 'Гость', password: rp.password })).body.token);
  clients.push(g2);
  assert.ok((await call(pl, 'durak:sit', { tableId: 'durak-duel', seat: 0 })).ok);
  assert.ok((await call(g2, 'durak:sit', { tableId: 'durak-duel', seat: 1 })).ok);
  await call(g2, 'durak:watch', { tableId: 'durak-duel' });
  await call(pl, 'durak:ready', { tableId: 'durak-duel', value: true });
  await call(g2, 'durak:ready', { tableId: 'durak-duel', value: true });
  const dt = srv.durakTables.get('durak-duel');
  for (let i = 0; i < 200 && dt.status !== 'playing'; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(dt.status, 'playing');
  assert.equal(sum(), total0, 'ставки учтены в игре');
  // гость видит только свои карты
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(g2.durak.hand.length, 6);
  assert.equal(g2.durak.seats[0].cards, 6);
  for (let i = 0; i < 500 && dt.status === 'playing'; i++) await new Promise((r) => setTimeout(r, 10));
  assert.notEqual(dt.status, 'playing', 'партия закончилась');
  assert.equal(sum(), total0, 'банк дурака выплачен');

  // бан
  const gone = new Promise((r) => pl.once('disconnect', r));
  assert.ok((await call(boss, 'admin:user', { userId: plId, action: 'ban' })).ok);
  await gone;
  assert.equal((await post('/api/login', { name: 'Игрок', password: 'secret1' })).status, 400);
  assert.match((await call(boss, 'admin:user', { userId: reg[0].user.id, action: 'ban' })).error, /себя/);
  const log = (await call(boss, 'admin:overview', {})).log;
  assert.ok(log.length >= 8, 'действия админа в журнале');
});

test('блэкджек через сокеты: ставка, ходы, расчёт, админ закрывает стол', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-'));
  const srv = createServer({
    dataFile: path.join(dir, 'users.json'), adminNames: [],
    bjOpts: { bettingTime: 40, allInDelay: 20, actionTime: 2000, dealerStepMs: 5, resultPause: 30 },
  });
  await new Promise((r) => srv.server.listen(0, r));
  t.after(() => { try { srv.shutdown(); } catch (e) { /* closed */ } });
  const base = `http://localhost:${srv.server.address().port}`;
  const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const a = await post('/api/register', { name: 'Крупье', password: 'secret1' });
  const b = await post('/api/register', { name: 'Игрок', password: 'secret1' });
  let clients = [];
  t.after(() => clients.forEach((c) => c.close()));
  clients = await Promise.all([a, b].map(({ token }) => new Promise((resolve) => {
    const c = connect(base, { auth: { token }, reconnection: false });
    c.on('bj:state', (s) => { c.st = s; });
    c.on('connect', () => resolve(c));
  })));
  const [admin, pl] = clients;
  const call = (c, ev, p) => new Promise((r) => c.emit(ev, p, r));
  const hello = await call(pl, 'hello', {});
  assert.ok(hello.bj.length >= 3);
  assert.ok((await call(pl, 'bj:sit', { tableId: 'bj-classic', seat: 2 })).ok);
  assert.match((await call(pl, 'bj:bet', { tableId: 'bj-classic', amount: 5000 })).error, /Максимальная/);
  assert.ok((await call(pl, 'bj:bet', { tableId: 'bj-classic', amount: 100 })).ok);
  const user = () => Object.values(srv.store.data.users).find((u) => u.name === 'Игрок');
  assert.equal(user().balance, 9900);
  assert.equal(user().inPlay['bj:bj-classic'], 100, 'ставка учтена на случай падения');
  const tbl = srv.bjTables.get('bj-classic');
  // играем до результата: стоим всегда
  for (let i = 0; i < 300 && tbl.status !== 'result'; i++) {
    await new Promise((r) => setTimeout(r, 10));
    if (pl.st && pl.st.you && pl.st.you.turn) { pl.st = null; await call(pl, 'bj:act', { tableId: 'bj-classic', type: 'stand' }); }
  }
  assert.equal(tbl.status, 'result');
  assert.ok([0, 100, 200, 250].includes(user().balance - 9900), `выплата по правилам: ${user().balance - 9900}`);
  assert.ok(!user().inPlay['bj:bj-classic'], 'после расчёта в игре ничего нет');
  // админ: закрыть стол со ставкой — ставка вернётся
  for (let i = 0; i < 100 && tbl.status !== 'betting'; i++) await new Promise((r) => setTimeout(r, 10));
  const before = user().balance;
  await call(pl, 'bj:bet', { tableId: 'bj-classic', amount: 50 });
  assert.ok((await call(admin, 'admin:bj', { tableId: 'bj-classic', action: 'close' })).ok);
  assert.equal(user().balance, before, 'ставка вернулась');
  assert.ok(!srv.bjTables.has('bj-classic'));
});

test('друзья, приглашения, приватные столы и профиль через сокеты', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-'));
  const srv = createServer({ dataFile: path.join(dir, 'users.json'), adminNames: [] });
  await new Promise((r) => srv.server.listen(0, r));
  t.after(() => { try { srv.shutdown(); } catch (e) { /* closed */ } });
  const base = `http://localhost:${srv.server.address().port}`;
  const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const regs = [];
  for (const n of ['Хозяин', 'Друг', 'Чужой']) regs.push(await post('/api/register', { name: n, password: 'secret1' }));
  let clients = [];
  t.after(() => clients.forEach((c) => c.close()));
  clients = await Promise.all(regs.map(({ token }) => new Promise((resolve) => {
    const c = connect(base, { auth: { token }, reconnection: false });
    c.ev = [];
    for (const e of ['friends:request', 'friends:dirty', 'invite', 'lobby:private', 'notice']) c.on(e, (x) => c.ev.push([e, x]));
    c.on('connect', () => resolve(c));
  })));
  const [host, friend, stranger] = clients;
  const call = (c, ev, p) => new Promise((r) => c.emit(ev, p, r));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // заявка и принятие
  assert.equal((await call(host, 'friends:add', { name: 'друг' })).status, 'sent');
  await wait(50);
  assert.ok(friend.ev.some(([e]) => e === 'friends:request'));
  const fl = await call(friend, 'friends:list', {});
  assert.equal(fl.incoming[0].name, 'Хозяин');
  const acc = await call(friend, 'friends:accept', { id: regs[0].user.id });
  assert.equal(acc.friends[0].name, 'Хозяин');
  assert.equal(acc.friends[0].online, true);

  // приватный стол: не виден в общем лобби и чужим, виден другу
  const cr = await call(host, 'table:create', { name: 'Свои', game: 'NLH', stakes: 1, seats: 6, private: true });
  assert.ok(cr.ok && cr.tableId.length >= 16, 'длинный неугадываемый id');
  await wait(350);
  const helloStranger = await call(stranger, 'hello', {});
  assert.ok(!helloStranger.tables.some((x) => x.id === cr.tableId), 'в общем лобби нет');
  assert.equal(helloStranger.private.length, 0, 'чужой не видит');
  const helloFriend = await call(friend, 'hello', {});
  assert.equal(helloFriend.private[0].id, cr.tableId, 'друг видит');
  assert.equal(helloFriend.private[0].owner, 'Хозяин');
  assert.ok(friend.ev.some(([e, x]) => e === 'lobby:private' && x.length === 1), 'обновление прилетело само');
  // по ссылке может зайти кто угодно
  assert.ok((await call(stranger, 'table:watch', { tableId: cr.tableId })).ok);

  // приглашение: только другу и только на существующий стол
  assert.match((await call(host, 'friends:invite', { id: regs[2].user.id, href: `#/table/${cr.tableId}` })).error, /друзей/);
  assert.match((await call(host, 'friends:invite', { id: regs[1].user.id, href: 'javascript:alert(1)' })).error, /ссылка/);
  assert.ok((await call(host, 'friends:invite', { id: regs[1].user.id, href: `#/table/${cr.tableId}` })).ok);
  await wait(50);
  const inv = friend.ev.find(([e]) => e === 'invite');
  assert.equal(inv[1].title, 'Свои');
  assert.equal(inv[1].from.name, 'Хозяин');

  // друг видит, где сидит хозяин
  await call(host, 'table:sit', { tableId: cr.tableId, seat: 0, buyIn: 400 });
  const fl2 = await call(friend, 'friends:list', {});
  assert.equal(fl2.friends[0].where[0].name, 'Свои');

  // профиль и аватар
  const av = await call(host, 'profile:avatar', { hue: 200, sym: 'crown' });
  assert.deepEqual(av.avatar, { hue: 200, sym: 'crown' });
  const pr = (await call(stranger, 'profile:get', { name: 'Хозяин' })).profile;
  assert.equal(pr.name, 'Хозяин');
  assert.equal(pr.friend, false);
  assert.deepEqual(pr.where, [], 'чужим не показываем, где сидит');
  assert.ok(Array.isArray(pr.achievements) && pr.achievements.length > 5);
  const prF = (await call(friend, 'profile:get', { name: 'Хозяин' })).profile;
  assert.equal(prF.where.length, 1);
  const st = (await call(host, 'table:watch', { tableId: cr.tableId })).state;
  assert.deepEqual(st.seats[0].avatar, { hue: 200, sym: 'crown' }, 'аватар виден за столом');

  // удаление из друзей убирает приватный стол из лобби друга
  await call(friend, 'friends:remove', { id: regs[0].user.id });
  await call(host, 'table:stand', { tableId: cr.tableId });
  const helloAfter = await call(friend, 'hello', {});
  assert.equal(helloAfter.private.length, 0);
});

test('конструктор турниров: фриролл с гарантией, свои блайнды, ручной старт, удаление', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-'));
  const dataFile = path.join(dir, 'users.json');
  const srv = createServer({ dataFile, adminNames: [], tableOpts: { startDelay: 20, pauseAfterHand: 20, runoutDelay: 5 } });
  await new Promise((r) => srv.server.listen(0, r));
  t.after(() => { try { srv.shutdown(); } catch (e) { /* closed */ } });
  const base = `http://localhost:${srv.server.address().port}`;
  const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const regs = [];
  for (const n of ['Админ', 'Игрок1', 'Игрок2']) regs.push(await post('/api/register', { name: n, password: 'secret1' }));
  let clients = [];
  t.after(() => clients.forEach((c) => c.close()));
  clients = await Promise.all(regs.map(({ token }) => new Promise((resolve) => {
    const c = connect(base, { auth: { token }, reconnection: false });
    c.on('connect', () => resolve(c));
  })));
  const [adm, p1, p2] = clients;
  const call = (c, ev, p) => new Promise((r) => c.emit(ev, p, r));

  // validation
  assert.match((await call(adm, 'admin:sngCreate', { name: 'X', game: 'NLH', seats: 3, startStack: 1000 })).error, /Название/);
  assert.match((await call(adm, 'admin:sngCreate', { name: 'Без денег', game: 'NLH', seats: 3, buyIn: 0, startStack: 2000 })).error, /гарантия/);
  assert.match((await call(adm, 'admin:sngCreate', { name: 'Пятёрка', game: 'PLO5', seats: 9, buyIn: 10, startStack: 2000 })).error, /Мест/);
  assert.match((await call(adm, 'admin:sngCreate', { name: 'Выплаты', game: 'NLH', seats: 3, buyIn: 10, startStack: 2000, payouts: '30,70' })).error, /убыванию/);
  assert.match((await call(p1, 'admin:sngCreate', { name: 'Хак', game: 'NLH', seats: 3, buyIn: 10, startStack: 2000 })).error, /прав/);

  const cr = await call(adm, 'admin:sngCreate', {
    name: 'Фриролл друзей', game: 'SD', seats: 3, buyIn: 0, guarantee: 3000, startStack: 2000,
    startSb: 50, startBb: 100, levelHands: 3, actionTime: 15, payouts: '70, 30', recurring: false,
  });
  assert.ok(cr.ok, JSON.stringify(cr));
  const sng = srv.sngs.get(cr.sngId);
  assert.equal(sng.summary().prizePool, 3000);
  assert.deepEqual(sng.payouts(), [2100, 900], 'до старта — по полному столу');
  assert.ok((await call(p1, 'sng:register', { sngId: cr.sngId })).ok);
  assert.equal(srv.store.get(regs[1].user.id).balance, 10000, 'фриролл не списывает фишки');
  assert.match((await call(adm, 'admin:sng', { sngId: cr.sngId, action: 'start' })).error, /2 игрока/);
  await call(p2, 'sng:register', { sngId: cr.sngId });
  assert.ok((await call(adm, 'admin:sng', { sngId: cr.sngId, action: 'start' })).ok, 'старт не дожидаясь третьего');
  assert.equal(sng.status, 'running');
  assert.deepEqual(sng.payouts(), [3000], 'двое игроков — платим одно место, но всю гарантию');
  assert.equal(sng.table.game, 'SD');
  assert.equal(sng.table.bb, 100);
  assert.equal(sng.table.actionTime, 15000);
  // одноразовый турнир не открывается заново
  assert.ok(![...srv.sngs.values()].some((x) => x.templateId === cr.templateId && x.status === 'registering'));
  // сохранён в базе и виден в админке
  const ov = await call(adm, 'admin:overview', {});
  assert.ok(ov.templates.some((x) => x.id === cr.templateId && x.custom));
  srv.store.saveNow();
  assert.ok(JSON.parse(fs.readFileSync(dataFile, 'utf8')).sngTemplates.length === 1);

  // турнир по расписанию с повтором, затем удаление с возвратом бай-ина
  const at = Date.now() + 3600 * 1000;
  const sch = await call(adm, 'admin:sngCreate', { name: 'Вечерний', game: 'NLH', seats: 6, buyIn: 300, startStack: 3000, startAt: at, minPlayers: 3, recurring: true });
  assert.ok(sch.ok);
  assert.equal(srv.sngs.get(sch.sngId).summary().startAt, at);
  await call(p1, 'sng:register', { sngId: sch.sngId });
  assert.equal(srv.store.get(regs[1].user.id).balance, 9700);
  assert.ok((await call(adm, 'admin:sngTemplateDelete', { templateId: sch.templateId })).ok);
  assert.equal(srv.store.get(regs[1].user.id).balance, 10000, 'удаление вернуло бай-ин');
  assert.match((await call(adm, 'admin:sngTemplateDelete', { templateId: 'turbo6' })).error, /свои/);
});

test('/api/me: аккаунт для шапки лендинга', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-'));
  const srv = createServer({ dataFile: path.join(dir, 'u.json'), adminNames: [] });
  await new Promise((r) => srv.server.listen(0, r));
  t.after(() => { try { srv.shutdown(); } catch (e) { /* closed */ } });
  const base = `http://localhost:${srv.server.address().port}`;
  assert.equal((await fetch(base + '/api/me')).status, 401);
  assert.equal((await fetch(base + '/api/me', { headers: { Authorization: 'Bearer nope' } })).status, 401);
  const reg = await fetch(base + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Лендинг', password: 'secret1' }) }).then((r) => r.json());
  const me = await fetch(base + '/api/me', { headers: { Authorization: 'Bearer ' + reg.token } }).then((r) => r.json());
  assert.equal(me.name, 'Лендинг');
  assert.equal(me.balance, 10000);
  assert.ok(!('password' in me) && !('hash' in me));
});

test('задания дня, награды за достижения, своя картинка на аватаре', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-'));
  const srv = createServer({ dataFile: path.join(dir, 'u.json'), adminNames: [] });
  await new Promise((r) => srv.server.listen(0, r));
  let c;
  t.after(() => { try { c && c.close(); srv.shutdown(); } catch (e) { /* closed */ } });
  const base = `http://localhost:${srv.server.address().port}`;
  const reg = await fetch(base + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Квестер', password: 'secret1' }) }).then((r) => r.json());
  const uid = reg.user.id;
  c = await new Promise((resolve) => { const s = connect(base, { auth: { token: reg.token }, reconnection: false }); s.on('connect', () => resolve(s)); });
  const call = (ev, p) => new Promise((r) => c.emit(ev, p, r));

  let pr = await call('progress:get', {});
  assert.equal(pr.quests.length, 3);
  assert.ok(pr.resetIn > 0 && pr.resetIn <= 24 * 3600 * 1000);
  assert.equal(new Set(pr.quests.map((q) => q.id)).size, 3);
  assert.match((await call('quest:claim', { id: pr.quests[0].id })).error, /не выполнено/);

  // play enough to finish every metric
  for (let i = 0; i < 30; i++) srv.store.recordGame(uid, 'poker', { table: 'x', net: 10, won: 50, category: 3, showdown: true });
  for (let i = 0; i < 12; i++) srv.store.recordGame(uid, 'bj', { table: 'b', net: 5 });
  for (let i = 0; i < 3; i++) srv.store.recordGame(uid, 'durak', { table: 'd', net: 10 });
  srv.store.recordGame(uid, 'sng', { table: 's', place: 1, total: 2, prize: 100, buyIn: 50 });
  for (let i = 0; i < 10; i++) srv.store.recordGame(uid, 'roulette', { table: 'r', net: 10, number: 5 });
  srv.store.recordGame(uid, 'checkers', { table: 'c', net: 100, win: true });
  srv.store.recordGame(uid, 'chess', { table: 'ch', net: 100, win: true });
  srv.store.recordGame(uid, 'capital', { table: 'cap', net: 100, win: true });
  srv.store.recordGame(uid, 'mafia', { table: 'mf', net: 100, win: true });
  srv.store.recordGame(uid, 'nardy', { table: 'bg', net: 100, win: true });
  pr = await call('progress:get', {});
  assert.ok(pr.quests.every((q) => q.done));
  const before = srv.store.get(uid).balance;
  const r1 = await call('quest:claim', { id: pr.quests[0].id });
  assert.equal(srv.store.get(uid).balance, before + r1.reward);
  assert.match((await call('quest:claim', { id: pr.quests[0].id })).error, /уже получена/);
  assert.equal(srv.store.profile(uid).rewardsReady >= 2, true);

  // achievement reward
  const first = pr.achievements.find((a) => a.id === 'first');
  assert.ok(first.done && !first.claimed && first.reward === 500);
  const b2 = srv.store.get(uid).balance;
  await call('ach:claim', { id: 'first' });
  assert.equal(srv.store.get(uid).balance, b2 + 500);
  assert.match((await call('ach:claim', { id: 'first' })).error, /уже получена/);
  assert.match((await call('ach:claim', { id: 'royal' })).error, /не открыто/);

  // avatar picture
  const png = Buffer.from('89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D4944415478DA63F8CFC0F01F0005000201E2E18A3A0000000049454E44AE426082', 'hex');
  const auth = { Authorization: 'Bearer ' + reg.token };
  assert.equal((await fetch(base + '/api/avatar', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png })).status, 401);
  assert.equal((await fetch(base + '/api/avatar', { method: 'POST', headers: { ...auth, 'Content-Type': 'image/png' }, body: Buffer.from('<svg onload=alert(1)>') })).status, 400);
  const big = Buffer.alloc(1024 * 1024 + 10, 1); png.copy(big);
  assert.equal((await fetch(base + '/api/avatar', { method: 'POST', headers: { ...auth, 'Content-Type': 'image/png' }, body: big })).status, 413);
  const up = await fetch(base + '/api/avatar', { method: 'POST', headers: { ...auth, 'Content-Type': 'image/png' }, body: png }).then((r) => r.json());
  assert.match(up.avatar.img, new RegExp(`^/avatar/${uid}\\?v=`));
  const got = await fetch(base + up.avatar.img);
  assert.equal(got.headers.get('content-type'), 'image/png');
  assert.equal(Buffer.from(await got.arrayBuffer()).length, png.length);
  // colour change keeps the picture; leaderboard carries it
  await call('profile:avatar', { hue: 120, sym: 's' });
  assert.ok(srv.store.get(uid).avatar.img);
  assert.ok((await fetch(base + '/api/leaderboard').then((r) => r.json()))[0].avatar.img);
  await fetch(base + '/api/avatar', { method: 'DELETE', headers: auth });
  assert.equal(srv.store.get(uid).avatar.img, undefined);
  assert.equal((await fetch(base + `/avatar/${uid}`)).status, 404);
});

test('игрок создаёт турнир за фишки: фонд организатора, отмена с возвратом, старт', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-'));
  const srv = createServer({ dataFile: path.join(dir, 'u.json'), adminNames: ['никто'], tableOpts: { startDelay: 20, pauseAfterHand: 20, runoutDelay: 5 } });
  await new Promise((r) => srv.server.listen(0, r));
  let cl = [];
  t.after(() => { cl.forEach((x) => x.close()); try { srv.shutdown(); } catch (e) { /* closed */ } });
  const base = `http://localhost:${srv.server.address().port}`;
  const regs = [];
  for (const n of ['Организатор', 'Гость1']) regs.push(await fetch(base + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n, password: 'secret1' }) }).then((r) => r.json()));
  cl = await Promise.all(regs.map(({ token }) => new Promise((resolve) => { const s = connect(base, { auth: { token }, reconnection: false }); s.on('connect', () => resolve(s)); })));
  const call = (c, ev, p) => new Promise((r) => c.emit(ev, p, r));
  const [own, guest] = cl;
  const [oid, gid] = regs.map((r) => r.user.id);

  assert.match((await call(own, 'sng:create', { name: 'Пусто', game: 'NLH', seats: 2, buyIn: 0, startStack: 1500 })).error, /бай-ин или добавьте/);
  assert.match((await call(own, 'sng:create', { name: 'Гарант', game: 'NLH', seats: 2, buyIn: 0, guarantee: 99999, startStack: 1500 })).error, /бай-ин или добавьте/, 'игрок не может напечатать гарантию');
  const cr = await call(own, 'sng:create', { name: 'Мой фриролл', game: 'NLH', seats: 3, buyIn: 0, sponsor: 1500, startStack: 1500, register: true });
  assert.ok(cr.sngId, JSON.stringify(cr));
  assert.equal(srv.store.get(oid).balance, 8500, 'фонд списан с организатора');
  const sng = srv.sngs.get(cr.sngId);
  assert.equal(sng.prizePool, 1500);
  assert.equal(sng.summary().ownerName, 'Организатор');
  assert.equal(sng.players.length, 1, 'организатор сразу в списке');
  assert.match((await call(guest, 'sng:cancelOwn', { sngId: cr.sngId })).error, /организатор/);
  await call(guest, 'sng:register', { sngId: cr.sngId });
  assert.ok(!(await call(own, 'sng:cancelOwn', { sngId: cr.sngId })).error);
  assert.equal(srv.store.get(oid).balance, 10000, 'фонд вернулся');
  assert.equal(srv.store.data.sngTemplates.length, 0);

  // paid one: starts when full and the template is consumed
  const cr2 = await call(own, 'sng:create', { name: 'Дуэль за фишки', game: 'NLH', seats: 2, buyIn: 300, sponsor: 200, startStack: 1500, register: true });
  await call(guest, 'sng:register', { sngId: cr2.sngId });
  const s2 = srv.sngs.get(cr2.sngId);
  assert.equal(s2.status, 'running');
  assert.equal(s2.prizePool, 800);
  assert.equal(srv.store.get(oid).balance, 10000 - 300 - 200);
  assert.equal(srv.store.get(gid).balance, 10000 - 300);
  assert.equal(srv.store.data.sngTemplates.length, 0);
  // limits
  await call(own, 'sng:create', { name: 'Первый', game: 'NLH', seats: 6, buyIn: 100, startStack: 1500 });
  await call(own, 'sng:create', { name: 'Второй', game: 'NLH', seats: 6, buyIn: 100, startStack: 1500 });
  assert.match((await call(own, 'sng:create', { name: 'Третий', game: 'NLH', seats: 6, buyIn: 100, startStack: 1500 })).error, /2 открытых/);
});

test('рулетка и шашки через сокеты: лобби, ставка, партия на фишки, приглашения', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-'));
  const srv = createServer({ dataFile: path.join(dir, 'u.json'), adminNames: ['Админ'], rlOpts: { bettingTime: 60, spinTime: 30, resultPause: 30, randomInt: () => 7 }, ckOpts: { resultPause: 50 } });
  await new Promise((r) => srv.server.listen(0, r));
  let cl = [];
  t.after(() => { cl.forEach((x) => x.close()); try { srv.shutdown(); } catch (e) { /* closed */ } });
  const base = `http://localhost:${srv.server.address().port}`;
  const regs = [];
  for (const n of ['Админ', 'Соня']) regs.push(await fetch(base + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n, password: 'secret1' }) }).then((r) => r.json()));
  cl = await Promise.all(regs.map(({ token }) => new Promise((resolve) => { const s = connect(base, { auth: { token }, reconnection: false }); s.on('connect', () => resolve(s)); })));
  const call = (c, ev, p) => new Promise((r) => c.emit(ev, p, r));
  const [a, b] = cl;
  const [aid, bid] = regs.map((r) => r.user.id);
  const hello = await call(a, 'hello', {});
  assert.equal(hello.rl.length, 3);
  assert.equal(hello.ck.length, 3);

  // roulette: bet on 7 and red, wheel lands on 7
  await call(a, 'rl:watch', { tableId: 'rl-euro' });
  assert.ok((await call(a, 'rl:sit', { tableId: 'rl-euro' })).ok);
  assert.ok((await call(a, 'rl:bet', { tableId: 'rl-euro', spot: 'n7', amount: 100 })).ok);
  await call(a, 'rl:bet', { tableId: 'rl-euro', spot: 'red', amount: 50 });
  assert.match((await call(a, 'rl:bet', { tableId: 'rl-euro', spot: 'n99', amount: 50 })).error, /Нет такой ставки/);
  assert.equal(srv.store.get(aid).balance, 9850);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(srv.store.get(aid).balance, 9850 + 3600 + 100);
  assert.equal(srv.store.get(aid).stats.roulette.straight, 1);

  // checkers: private table, invite, play until resignation
  const cr = await call(a, 'ck:create', { name: 'Партия', stake: 500, clock: 5, private: true });
  assert.ok(cr.tableId);
  await call(a, 'ck:sit', { tableId: cr.tableId, seat: 0 });
  await call(b, 'ck:sit', { tableId: cr.tableId, seat: 1 });
  await call(a, 'ck:ready', { tableId: cr.tableId, value: true });
  await call(b, 'ck:ready', { tableId: cr.tableId, value: true });
  const tbl = srv.extra.ck.map.get(cr.tableId);
  assert.equal(tbl.status, 'playing');
  const white = tbl.colors.w === 0 ? a : b;
  const black = white === a ? b : a;
  const st = (await call(white, 'ck:watch', { tableId: cr.tableId })).state;
  assert.equal(st.legal.length, 7);
  assert.ok((await call(white, 'ck:move', { tableId: cr.tableId, path: st.legal[2] })).ok);
  assert.match((await call(white, 'ck:move', { tableId: cr.tableId, path: st.legal[0] })).error, /соперника/);
  await call(black, 'ck:resign', { tableId: cr.tableId });
  const wid = white === a ? aid : bid;
  const bal = srv.store.get(wid).balance;
  assert.equal(srv.store.get(wid).stats.checkers.wins, 1);
  assert.ok(bal >= 10000);
  // friends + invite to a checkers table
  await call(a, 'friends:add', { name: 'Соня' });
  await call(b, 'friends:accept', { id: aid });
  const got = new Promise((r) => b.once('invite', r));
  assert.ok((await call(a, 'friends:invite', { id: bid, href: `#/ck/${cr.tableId}` })).ok);
  assert.equal((await got).game, 'Шашки');
  // admin closes a roulette table
  assert.ok((await call(a, 'admin:extra', { kind: 'rl', tableId: 'rl-vip', action: 'close' })).ok);
  assert.ok(!srv.extra.rl.map.has('rl-vip'));
});

test('личные сообщения: только друзьям, непрочитанные, сохранение', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-'));
  const dataFile = path.join(dir, 'u.json');
  const srv = createServer({ dataFile, adminNames: [] });
  await new Promise((r) => srv.server.listen(0, r));
  let cl = [];
  t.after(() => { cl.forEach((x) => x.close()); try { srv.shutdown(); } catch (e) { /* closed */ } });
  const base = `http://localhost:${srv.server.address().port}`;
  const regs = [];
  for (const n of ['Лиза', 'Марк', 'Чужой']) regs.push(await fetch(base + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n, password: 'secret1' }) }).then((r) => r.json()));
  cl = await Promise.all(regs.map(({ token }) => new Promise((resolve) => { const s = connect(base, { auth: { token }, reconnection: false }); s.on('connect', () => resolve(s)); })));
  const call = (c, ev, p) => new Promise((r) => c.emit(ev, p, r));
  const [a, b, c] = cl;
  const [aid, bid] = regs.map((r) => r.user.id);
  assert.match((await call(a, 'dm:send', { id: bid, text: 'привет' })).error, /только друзьям/);
  await call(a, 'friends:add', { name: 'Марк' });
  await call(b, 'friends:accept', { id: aid });
  const got = new Promise((r) => b.once('dm:new', r));
  const sent = await call(a, 'dm:send', { id: bid, text: '  Привет!  Сыграем в шашки?  ' });
  assert.equal(sent.msg.text, 'Привет! Сыграем в шашки?');
  const ev = await got;
  assert.equal(ev.with, aid);
  assert.equal(ev.from.name, 'Лиза');
  assert.equal(srv.store.profile(bid).dmUnread, 1);
  const list = await call(b, 'dm:list', {});
  assert.equal(list.list[0].friend.name, 'Лиза');
  assert.equal(list.list[0].unread, 1);
  const hist = await call(b, 'dm:history', { id: aid });
  assert.equal(hist.messages.length, 1);
  assert.equal(srv.store.profile(bid).dmUnread, 0, 'открыл диалог — прочитано');
  await new Promise((r) => setTimeout(r, 450));
  assert.match((await call(a, 'dm:send', { id: bid, text: '   ' })).error, /Пустое/);
  assert.match((await call(c, 'dm:history', { id: 'нет' })).error, /не найден/);
  srv.store.saveNow();
  assert.equal(Object.values(JSON.parse(fs.readFileSync(dataFile, 'utf8')).dms)[0].msgs.length, 1);
});
