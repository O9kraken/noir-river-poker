'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { io: connect } = require('socket.io-client');
const { createServer } = require('../server');
const { Store, LEGAL_VERSION } = require('../server/store');

test('согласие: без галочки регистрации нет; старые аккаунты подтверждают правила', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-'));
  const srv = createServer({ dataFile: path.join(dir, 'u.json') });
  await new Promise((r) => srv.server.listen(0, r));
  t.after(() => srv.shutdown());
  const base = `http://localhost:${srv.server.address().port}`;
  const post = (body) => fetch(base + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const no = await post({ name: 'Новичок', password: 'secret1' });
  assert.equal(no.status, 400);
  assert.match(no.body.error, /18/);
  const ok = await post({ name: 'Новичок', password: 'secret1', agree: true });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.needsAgree, false);
  assert.equal(srv.store.get(ok.body.user.id).agreed.version, LEGAL_VERSION);
  // an old account without consent is asked once
  delete srv.store.get(ok.body.user.id).agreed;
  assert.equal(srv.store.profile(ok.body.user.id).needsAgree, true);
  srv.store.acceptLegal(ok.body.user.id);
  assert.equal(srv.store.profile(ok.body.user.id).needsAgree, false);
  // the documents are served with the owner filled in
  for (const p of ['/privacy', '/terms']) {
    const html = await fetch(base + p).then((r) => r.text());
    assert.ok(!html.includes('%OWNER%') && !html.includes('%CONTACT%'), p);
    assert.match(html, /NOIR RIVER/);
  }
  assert.match(await fetch(base + '/sitemap.xml').then((r) => r.text()), /\/privacy/);
});

test('жалобы и удаление аккаунта', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-'));
  const srv = createServer({ dataFile: path.join(dir, 'u.json'), adminNames: ['Модератор'] });
  await new Promise((r) => srv.server.listen(0, r));
  const clients = [];
  t.after(() => { clients.forEach((c) => c.close()); srv.shutdown(); });
  const base = `http://localhost:${srv.server.address().port}`;
  const reg = (name) => fetch(base + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password: 'secret1', agree: true }) }).then((r) => r.json());
  const [mod, a, b] = [await reg('Модератор'), await reg('Анна'), await reg('Борис')];
  const conn = (token) => new Promise((res, rej) => { const c = connect(base, { auth: { token }, reconnection: false }); clients.push(c); c.on('connect', () => res(c)); c.on('connect_error', rej); });
  const [cm, ca, cb] = [await conn(mod.token), await conn(a.token), await conn(b.token)];
  const call = (c, ev, p) => new Promise((r) => c.emit(ev, p, r));
  // DMs between the two, so deletion has something to remove
  await call(ca, 'dm:send', { id: b.user.id, text: 'привет' });
  assert.ok((await call(ca, 'report:create', { name: 'Анна', reason: 'abuse' })).error, 'на себя нельзя');
  assert.ok((await call(ca, 'report:create', { name: 'Борис', reason: 'xxx' })).error, 'нужна причина');
  assert.deepEqual(await call(ca, 'report:create', { name: 'Борис', reason: 'abuse', where: 'Чат стола', text: 'плохое слово' }), { ok: true });
  assert.ok((await call(ca, 'report:create', { name: 'Борис', reason: 'spam' })).error, 'не чаще раза в 5 секунд');
  assert.ok((await call(ca, 'admin:reports', {})).error, 'не админу список не виден');
  let r = await call(cm, 'admin:reports', {});
  assert.equal(r.reports.length, 1);
  assert.equal(r.reports[0].targetName, 'Борис');
  assert.equal(r.reports[0].reasonText, 'Оскорбления');
  r = await call(cm, 'admin:report', { id: r.reports[0].id, action: 'resolve' });
  assert.equal(r.reports[0].done, true);
  // self-service deletion needs the password
  assert.ok((await call(cb, 'account:delete', { password: 'wrong' })).error);
  assert.deepEqual(await call(cb, 'account:delete', { password: 'secret1' }), { ok: true });
  assert.equal(srv.store.data.users[b.user.id], undefined);
  assert.equal(Object.keys(srv.store.data.dms).filter((k) => k.includes(b.user.id)).length, 0);
  assert.equal(srv.store.reports().length, 0, 'жалобы на удалённого убраны');
  assert.equal(srv.store.userByToken(b.token), null);
  const again = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Борис', password: 'secret1' }) });
  assert.ok(again.status >= 400, 'войти больше нельзя');
  // admin deletion
  assert.deepEqual(await call(cm, 'admin:user', { userId: a.user.id, action: 'delete' }), { ok: true });
  assert.equal(srv.store.data.users[a.user.id], undefined);
});

test('жалобы сохраняются в хранилище', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-'));
  const file = path.join(dir, 'u.json');
  const s = new Store(file);
  const x = s.register('Икс', 'secret1', { agree: true }).user;
  s.register('Игрек', 'secret1', { agree: true });
  s.report(x.id, { targetName: 'Игрек', reason: 'spam' });
  s.flush && s.flush();
  const s2 = new Store(file);
  assert.equal(s2.reports().length, 1);
});
