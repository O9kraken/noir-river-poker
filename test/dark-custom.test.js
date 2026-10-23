'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PartyTable } = require('../server/party/base');
const { GAMES } = require('../server/party');
const { Store } = require('../server/store');

function seeded(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const timers = { set: () => 0, clear: () => {} };

/** A dark table with three real players wired to a store like server/index.js does. */
function table(store, options = { goal: 7, mat: false }, seed = 1) {
  const rng = seeded(seed);
  const hooks = {
    darkPool: (o) => store.darkPool(o),
    darkAdd: (text, { userId, name, mat }) => store.addDarkCard(text, { userId, name, mat }),
    darkWin: (id) => store.darkWin(id),
    darkFlag: (id, userId) => store.flagDarkCard(id, userId),
  };
  const t = new PartyTable({ id: 't', name: 'T', game: 'dark', stake: 0, maxPlayers: 3, options }, {}, { games: GAMES, timers, now: () => 0, rng, randomInt: (k) => Math.floor(rng() * k), countdown: 0, hooks });
  const users = ['Аня', 'Боря', 'Вика'].map((n) => store.register(n + seed, 'secret1', { agree: true }).user);
  users.forEach((u, i) => t.sit(u.id, u.name, i));
  return { t, users };
}
function start(t) {
  for (const s of t.seats) if (s) t.setReady(s.userId, true);
  t._start();
}
function fresh() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-dark-')); return path.join(dir, 'u.json'); }

test('свою карту можно писать каждый раунд, и она уходит в колоду клуба', () => {
  const file = fresh();
  const store = new Store(file);
  const { t, users } = table(store);
  start(t);
  assert.ok(t.g, 'партия началась');
  const g = t.g;
  for (let round = 0; round < 3; round++) {
    const players = g.order.filter((s) => s !== g.judge);
    for (const s of players) {
      const u = t.seats[s].userId;
      const cards = g.pick === 2 ? ['blank', g.hands.get(s)[0].id] : ['blank'];
      t.act(u, 'answer', { cards, text: `Мой ответ ${round}-${s}` });
    }
    assert.equal(g.phase, 'judge');
    t.act(t.seats[g.judge].userId, 'choose', { i: 0 });
    if (g.phase === 'over') break;
    g._nextJudge();
  }
  const pool = store.darkPool({ mat: false });
  assert.ok(pool.length >= 6, `в колоде клуба ${pool.length} карт`);
  assert.ok(pool.some((c) => c.byName === users[0].name || c.byName === users[1].name || c.byName === users[2].name));
  assert.ok(store.darkCards().some((c) => c.wins === 1), 'победа карты засчитана');
  // written cards also go around in this very game
  assert.ok(g.used.some((c) => c.cid), 'вписанные карты вернулись в колоду партии');
  store.flush && store.flush();
  assert.ok(new Store(file).darkPool({ mat: false }).length >= 6, 'колода переживает перезапуск');
});

test('карты игроков попадают в руки в новых партиях, мат не уходит за столы без мата', () => {
  const store = new Store(fresh());
  for (let i = 0; i < 300; i++) store.addDarkCard(`Карта игроков номер ${i}`, { userId: null, name: 'Автор', mat: false });
  store.addDarkCard('Охуенный повод', { name: 'Автор' });
  store.addDarkCard('Карта игроков номер 1', { name: 'Повтор' });
  assert.equal(store.darkPool({ mat: false }).length, 300, 'дубли не сохраняются, мат отделён');
  assert.equal(store.darkPool({ mat: true }).length, 301);
  const { t } = table(store, { goal: 7, mat: false }, 2);
  start(t);
  const g = t.g;
  assert.ok(g.customIn > 20, `в колоду партии подмешано ${g.customIn}`);
  assert.ok(!g.answers.concat(...g.hands.values()).some((c) => /хуе/i.test(c.t)));
  const seat = g.order.find((s) => g.hands.get(s).some((c) => c.cid)) ?? g.order[0];
  // force a players' card into the hand to test flagging
  const h = g.hands.get(seat);
  const own = g.answers.find((c) => c.cid);
  g.answers.splice(g.answers.indexOf(own), 1);
  h[0] = own;
  const v = g.view(seat);
  assert.ok(v.hand.find((c) => c.id === own.id).custom);
  assert.equal(v.blank, 1);
  const uid = t.seats[seat].userId;
  t.act(uid, 'flag', { id: own.id });
  assert.ok(!g.hands.get(seat).includes(own));
  assert.equal(store.darkCards().find((c) => c.id === own.cid).flagCount, 1);
  assert.throws(() => store.flagDarkCard(own.cid, uid), /уже/);
  store.flagDarkCard(own.cid, 'x2'); store.flagDarkCard(own.cid, 'x3');
  assert.ok(!store.darkPool({ mat: true }).some((c) => c.id === own.cid), 'после трёх жалоб карта скрыта');
  store.darkCardAdmin(own.cid, 'show');
  assert.ok(store.darkPool({ mat: true }).some((c) => c.id === own.cid));
  store.darkCardAdmin(own.cid, 'delete');
  assert.equal(store.darkPool({ mat: true }).length, 300);
});

test('одна своя карта на ответ, пустой текст не принимается', () => {
  const store = new Store(fresh());
  const { t } = table(store, { goal: 7, mat: true }, 3);
  start(t);
  const g = t.g;
  const s = g.order.find((x) => x !== g.judge);
  const u = t.seats[s].userId;
  assert.throws(() => t.act(u, 'answer', { cards: g.pick === 2 ? ['blank', 'blank'] : ['blank'], text: g.pick === 2 ? 'x' : '' }));
});
