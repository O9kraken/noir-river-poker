'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { newDb } = require('pg-mem');
const { PgBackend } = require('../server/persist');
const { Store } = require('../server/store');

function memPool() {
  const db = newDb({ noAstCoverageCheck: true });
  const { Pool } = db.adapters.createPg();
  return new Pool();
}

test('PostgreSQL: данные переживают перезапуск, пишутся только изменения', async () => {
  const pool = memPool();
  let backend = new PgBackend(pool);
  let data = await backend.load();
  assert.equal(data, null, 'пустая база');
  let store = new Store(null, { backend, initialData: data, adminNames: [] });
  const a = store.register('Аня', 'secret1');
  const b = store.register('Боря', 'secret1');
  store.withdraw(a.user.id, 500);
  store.setInPlay(a.user.id, 't1', 500); // фишки за столом в момент «падения»
  store.recordGame(b.user.id, 'durak', { table: 'Д', net: 100, draw: false, durak: false });
  store.friendRequest(a.user.id, 'Боря');
  store.setAnnouncement('Привет!');
  await store.flush();

  // счётчик запросов: при неизменных данных база не трогается
  let writes = 0;
  const origConnect = pool.connect.bind(pool);
  pool.connect = async () => { writes++; return origConnect(); };
  await store.flush();
  assert.equal(writes, 0, 'нечего сохранять — ни одного запроса');
  store.deposit(b.user.id, 1);
  await store.flush();
  assert.equal(writes, 1, 'одно изменение — одна транзакция');
  pool.connect = origConnect;

  // «перезапуск»: новый бэкенд поверх той же базы
  backend = new PgBackend(pool);
  data = await backend.load();
  store = new Store(null, { backend, initialData: data, adminNames: [] });
  const ua = store.get(a.user.id);
  assert.equal(ua.balance, 10000, 'фишки со стола вернулись на баланс после рестарта');
  assert.deepEqual(ua.inPlay, {});
  assert.equal(store.get(b.user.id).balance, 10001);
  assert.equal(store.get(b.user.id).stats.durak.wins, 1);
  assert.deepEqual(store.get(b.user.id).friendReq.in, [a.user.id]);
  assert.equal(store.data.announcement.text, 'Привет!');
  assert.ok(store.userByToken(a.token), 'сессия сохранилась — повторно входить не нужно');
  assert.equal(ua.role, 'admin', 'первый игрок — админ');
  // логин по паролю после рестарта
  assert.ok(store.login('Аня', 'secret1').token);
  await store.flush();
});

test('статистика, достижения, друзья', () => {
  const os = require('os');
  const path = require('path');
  const fs = require('fs');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nr-')), 'u.json');
  const store = new Store(file, {});
  const a = store.register('Аня', 'secret1').user.id;
  const b = store.register('Боря', 'secret1').user.id;
  store.recordGame(a, 'poker', { table: 'T', bb: 10, net: 300, won: 300, showdown: true, category: 7, handName: 'Каре' });
  store.recordGame(a, 'poker', { table: 'T', bb: 10, net: -10, won: 0, showdown: false });
  store.recordGame(a, 'sng', { table: 'Дуэль', place: 1, total: 2, prize: 2000, buyIn: 1000 });
  store.recordGame(a, 'bj', { table: 'B', net: 150, blackjacks: 1 });
  const p = store.publicProfile('аня');
  assert.equal(p.stats.poker.hands, 2);
  assert.equal(p.stats.poker.won, 1);
  assert.equal(p.stats.poker.bestHand, 7);
  assert.equal(p.recent.length, 3, 'раздачи за одним столом сгруппированы');
  assert.equal(p.recent[2].hands, 2);
  assert.equal(p.recent[2].net, 290);
  assert.equal(p.recent[2].best, 'Каре');
  assert.equal(p.recent[0].kind, 'bj');
  const done = new Set(p.achievements.filter((x) => x.done).map((x) => x.id));
  for (const id of ['first', 'boat', 'quads', 'sng', 'natural']) assert.ok(done.has(id), id);
  assert.ok(!done.has('royal'));
  assert.equal(p.history.length, 1);
  // друзья
  assert.throws(() => store.friendRequest(a, 'Аня'), /самого себя/);
  assert.throws(() => store.friendRequest(a, 'Никто'), /не найден/);
  assert.equal(store.friendRequest(a, 'Боря').status, 'sent');
  assert.throws(() => store.friendRequest(a, 'Боря'), /уже отправлена/);
  assert.equal(store.friendRequest(b, 'Аня').status, 'friends', 'встречная заявка = дружба');
  assert.ok(store.areFriends(a, b) && store.areFriends(b, a));
  store.friendRemove(b, a);
  assert.ok(!store.areFriends(a, b));
  // аватар
  assert.deepEqual(store.setAvatar(a, 400, 'crown'), { hue: 40, sym: 'crown' });
  assert.deepEqual(store.setAvatar(a, 'x', '<script>'), { hue: null, sym: '' });
});
