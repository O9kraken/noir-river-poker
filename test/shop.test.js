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
