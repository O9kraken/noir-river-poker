'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { io: connect } = require('socket.io-client');
const { MafiaTable } = require('../server/mafia/table');
const { createServer } = require('../server');

test('голос в мафии: ночью говорит только мафия, выбывшие только слушают', () => {
  const t = new MafiaTable({ id: 'v', name: 'v', stake: 0, maxPlayers: 6 }, {}, { countdown: 1, introMs: 100000 });
  for (let i = 0; i < 6; i++) t.sit('u' + i, 'U' + i, i);
  assert.deepEqual(t.voicePolicy('u0'), { speak: true, hear: null, note: '' }, 'до партии говорят все');
  for (let i = 0; i < 6; i++) t.setReady('u' + i, true);
  t._clear('_flow'); t._start();
  const civ = t.g.players.find((p) => p.role === 'civ');
  const mafia = t.g.players.filter((p) => p.role === 'maf' || p.role === 'don');
  t._startNight();
  const night = t.voicePolicy(civ.userId);
  assert.equal(night.speak, false);
  assert.deepEqual(night.hear, []);
  const m = t.voicePolicy(mafia[0].userId);
  assert.equal(m.speak, true);
  assert.deepEqual(new Set(m.hear), new Set(mafia.map((p) => p.userId)), 'мафия слышит только своих');
  // day: the living talk; a fallen player listens
  t._clear('_timer');
  t.g.phase = 'day';
  civ.alive = false;
  const dead = t.voicePolicy(civ.userId);
  assert.equal(dead.speak, false);
  assert.ok(!dead.hear.includes(civ.userId));
  assert.equal(t.voicePolicy(mafia[0].userId).speak, true);
  t.destroy();
});

test('голосовой чат: только для сидящих, обмен сигналами, выключенный микрофон, выход из-за стола', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-'));
  const srv = createServer({ dataFile: path.join(dir, 'u.json'), adminNames: [] });
  await new Promise((r) => srv.server.listen(0, r));
  const socks = [];
  t.after(() => { socks.forEach((s) => s.close()); srv.shutdown(); });
  const base = `http://localhost:${srv.server.address().port}`;
  async function user(name) {
    const reg = await fetch(base + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password: 'secret1', agree: true }) }).then((r) => r.json());
    const s = await new Promise((resolve) => { const c = connect(base, { auth: { token: reg.token }, reconnection: false }); c.on('connect', () => resolve(c)); });
    socks.push(s);
    const call = (ev, p) => new Promise((r) => s.emit(ev, p, r));
    const wait = (ev) => new Promise((r) => s.once(ev, r));
    return { s, call, wait };
  }
  const a = await user('Голос1');
  const b = await user('Голос2');
  assert.match((await a.call('voice:join', { kind: 'ch', id: 'ch-club' })).error, /сидит за столом/);
  assert.ok((await a.call('ch:sit', { tableId: 'ch-club', seat: 0 })).ok);
  assert.ok((await b.call('ch:sit', { tableId: 'ch-club', seat: 1 })).ok);
  const ja = await a.call('voice:join', { kind: 'ch', id: 'ch-club' });
  assert.ok(ja.ok);
  assert.equal(ja.peers.length, 0);
  assert.ok(ja.iceServers.length >= 1);
  const joined = a.wait('voice:joined');
  const jb = await b.call('voice:join', { kind: 'ch', id: 'ch-club' });
  assert.equal(jb.peers.length, 1);
  assert.equal(jb.peers[0].name, 'Голос1');
  assert.equal((await joined).name, 'Голос2');
  // signalling goes only to someone in the same room
  const got = a.wait('voice:signal');
  await b.call('voice:signal', { to: ja.sid, data: { sdp: { type: 'offer', sdp: 'x' } } });
  const sig = await got;
  assert.equal(sig.from, jb.sid);
  assert.equal(sig.data.sdp.type, 'offer');
  const muted = a.wait('voice:muted');
  await b.call('voice:mute', { muted: true });
  assert.deepEqual(await muted, { sid: jb.sid, muted: true });
  // standing up removes you from the voice chat
  const left = a.wait('voice:left');
  const kicked = b.wait('voice:kicked');
  await b.call('ch:leave', { tableId: 'ch-club' });
  assert.equal((await left).sid, jb.sid);
  assert.match((await kicked).reason, /встали/);
});
