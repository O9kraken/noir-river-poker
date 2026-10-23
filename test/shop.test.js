'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { Store, SHOP } = require('../server/store');

test('лавка: покупка, надевание, рамка видна на аватаре, титул в профиле', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-'));
  const store = new Store(path.join(dir, 'u.json'));
  const { user } = store.register('Модник', 'secret1');
  const id = user.id;
  const start = store.get(id).balance;
  let v = store.shopView(id);
  assert.equal(v.items.length, SHOP.length);
  assert.ok(v.items.find((x) => x.id === 'frame-none').equipped, 'по умолчанию без рамки');
  assert.throws(() => store.equip(id, 'frame-gold'), /купите/);
  v = store.buy(id, 'frame-gold');
  assert.equal(store.get(id).balance, start - 5000);
  assert.ok(v.items.find((x) => x.id === 'frame-gold').equipped);
  assert.equal(store.get(id).avatar.frame, 'gold');
  assert.equal(store.brief(id).avatar.frame, 'gold', 'рамка уходит вместе с аватаром');
  assert.throws(() => store.buy(id, 'frame-gold'), /Уже/);
  // changing the avatar keeps the frame
  store.setAvatar(id, 120, '');
  assert.equal(store.get(id).avatar.frame, 'gold');
  store.equip(id, 'frame-none');
  assert.equal(store.get(id).avatar.frame, undefined);
  store.buy(id, 'title-shark');
  assert.equal(store.publicProfile(id).title, 'Акула');
  assert.equal(store.profile(id).looks.title, 'title-shark');
  assert.throws(() => store.buy(id, 'title-legend'), /Не хватает/);
  assert.throws(() => store.buy(id, 'nope'), /нет/);
});

test('лавка: нашивка видна на аватаре, лицо карт — в образе игрока', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-'));
  const store = new Store(path.join(dir, 'u.json'));
  const { user } = store.register('Нашивка', 'secret1');
  const id = user.id;
  store.buy(id, 'badge-spade');
  assert.equal(store.brief(id).avatar.badge, 'spade');
  store.buy(id, 'frame-bronze');
  store.setAvatar(id, 200, '');
  assert.equal(store.get(id).avatar.badge, 'spade', 'нашивка остаётся при смене аватара');
  assert.equal(store.get(id).avatar.frame, 'bronze');
  store.equip(id, 'badge-none');
  assert.equal(store.get(id).avatar.badge, undefined);
  store.buy(id, 'deck-night');
  assert.equal(store.profile(id).looks.deck, 'deck-night');
  for (const cat of ['frame', 'back', 'felt', 'title', 'deck', 'badge']) assert.ok(SHOP.some((x) => x.cat === cat && !x.price), `бесплатный вариант в «${cat}»`);
  assert.equal(new Set(SHOP.map((x) => x.id)).size, SHOP.length, 'id товаров уникальны');
});

test('резервная копия: скачать и восстановить через админку; не админу нельзя', async (t) => {
  const { createServer } = require('../server');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-'));
  const srv = createServer({ dataFile: path.join(dir, 'u.json'), adminNames: ['Хранитель'] });
  await new Promise((r) => srv.server.listen(0, r));
  t.after(() => srv.shutdown());
  const base = `http://localhost:${srv.server.address().port}`;
  const reg = (name) => fetch(base + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password: 'secret1', agree: true }) }).then((r) => r.json());
  const admin = await reg('Хранитель');
  const player = await reg('Игрок');
  assert.equal((await fetch(base + '/api/admin/backup', { headers: { Authorization: `Bearer ${player.token}` } })).status, 403);
  const copy = await fetch(base + '/api/admin/backup', { headers: { Authorization: `Bearer ${admin.token}` } }).then((r) => r.json());
  assert.equal(copy.format, 'noir-river-backup');
  assert.equal(Object.keys(copy.data.users).length, 2);
  assert.equal(copy.data.sessions, undefined, 'сессий в копии нет');
  // the player wins chips after the backup; the restore puts the old balance back
  srv.store.deposit(player.user.id, 777);
  const res = await fetch(base + '/api/admin/restore', { method: 'POST', headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(copy) }).then((r) => r.json());
  assert.equal(res.users, 2);
  assert.equal(srv.store.get(player.user.id).balance, copy.data.users[player.user.id].balance);
  assert.ok(srv.store.userByToken(admin.token), 'сессия админа осталась');
  const bad = await fetch(base + '/api/admin/restore', { method: 'POST', headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ hello: 1 }) });
  assert.equal(bad.status, 400);
});
