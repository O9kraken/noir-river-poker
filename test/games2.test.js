'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { io: connect } = require('socket.io-client');
const E = require('../server/chess/engine');
const chessAI = require('../server/bots/chess-ai');
const { ChessTable } = require('../server/chess/table');
const { CapitalTable } = require('../server/capital/table');
const { MafiaTable, rolesFor } = require('../server/mafia/table');
const { BotDriver, makeBots } = require('../server/bots');
const { createServer } = require('../server');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function perft(pos, d) { if (!d) return 1; let n = 0; for (const m of E.legalMoves(pos)) n += d === 1 ? 1 : perft(E.applyMove(pos, m), d - 1); return n; }

test('шахматы: генератор ходов (perft), мат, пат, рокировка, превращение', () => {
  assert.equal(perft(E.initialPosition(), 3), 8902);
  assert.equal(perft(E.fromFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1'), 2), 2039);
  assert.equal(perft(E.fromFen('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1'), 3), 2812);
  // fool's mate
  const g = new E.ChessGame();
  for (const [c, f, t] of [['w', 'f2', 'f3'], ['b', 'e7', 'e5'], ['w', 'g2', 'g4'], ['b', 'd8', 'h4']]) g.play(c, { from: E.parseSq(f), to: E.parseSq(t) });
  assert.deepEqual(g.result, { winner: 'b', reason: 'mate' });
  assert.equal(g.moves[3].san, 'Qh4#');
  // stalemate
  const s2 = new E.ChessGame('7k/8/5QK1/8/8/8/8/8 w - - 0 1');
  s2.play('w', { from: E.parseSq('f6'), to: E.parseSq('f7') });
  assert.deepEqual(s2.result, { winner: null, reason: 'stalemate' });
  // castling and promotion
  const c = new E.ChessGame('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  c.play('w', { from: E.parseSq('e1'), to: E.parseSq('g1') });
  assert.equal(c.moves[0].san, 'O-O');
  assert.equal(c.board[E.parseSq('f1')].t, 'r');
  const p = new E.ChessGame('8/P7/8/8/8/8/8/k6K w - - 0 1');
  p.play('w', { from: E.parseSq('a7'), to: E.parseSq('a8'), promo: 'n' });
  assert.equal(p.board[E.parseSq('a8')].t, 'n');
  // the bot finds a mate in one
  const mv = chessAI.chooseMove(E.fromFen('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1'), 'normal', () => 0.5);
  assert.equal(E.name(mv.to), 'a8');
});

test('шахматы: стол, ставки и мат', () => {
  const bal = { a: 1000, b: 1000 };
  const t = new ChessTable({ id: 'x', name: 'x', stake: 100 }, { charge: (u, a) => { bal[u] -= a; return true; }, pay: (u, a) => { bal[u] += a; } }, { resultPause: 5 });
  t.sit('a', 'A', 0); t.sit('b', 'B', 1);
  t.setReady('a', true); t.setReady('b', true);
  const w = t.colors.w === 0 ? 'a' : 'b';
  const b = w === 'a' ? 'b' : 'a';
  let who = w;
  for (const [f, to] of [['e2', 'e4'], ['e7', 'e5'], ['d1', 'h5'], ['b8', 'c6'], ['f1', 'c4'], ['g8', 'f6'], ['h5', 'f7']]) { t.move(who, { from: E.parseSq(f), to: E.parseSq(to) }); who = who === w ? b : w; }
  assert.equal(t.lastResult.reason, 'mate');
  assert.equal(bal[w], 1100);
  assert.equal(bal[b], 900);
  assert.equal(t.publicState(w).moves.at(-1), 'Qxf7#');
  t.destroy();
});

function botGame(Ctor, kind, n, cfg, opts) {
  return new Promise((resolve) => {
    let t;
    const bal = {};
    t = new Ctor({ id: 'x', name: 'x', stake: 100, maxPlayers: n, ...cfg }, {
      charge: (u, a) => { bal[u] = (bal[u] || 0) - a; return true; }, pay: (u, a) => { bal[u] = (bal[u] || 0) + a; },
      onUpdate: () => t.bots && t.bots.poke(),
      onGameEnd: (tt, r) => setTimeout(() => { t.bots.stop(); t.destroy(); resolve({ t: tt, r, bal }); }, 0),
    }, opts);
    const bots = makeBots(n, 0);
    t.bots = new BotDriver(t, kind, bots, 'normal', { fast: true });
    bots.forEach((b, k) => t.sit(b.userId, b.name, k));
  });
}

test('Капитал: боты доигрывают партию, банк уходит победителю', async () => {
  for (const n of [2, 4]) {
    const { t, r, bal } = await botGame(CapitalTable, 'cap', n, { timeLimitMin: 0.05 }, { turnMs: 2000, countdown: 5, resultPause: 5 });
    assert.equal(Object.values(bal).reduce((a, b) => a + b, 0), 0, 'фишки не теряются');
    assert.equal(r.filter((x) => x.win).length, 1);
    assert.equal(t.result.ranking.length, n);
  }
  // rules: rent doubles with a full set, building needs the set and goes evenly
  const t = new CapitalTable({ id: 'y', name: 'y', stake: 0, maxPlayers: 2 }, {}, { countdown: 1 });
  t.sit('a', 'A', 0); t.sit('b', 'B', 1);
  t.seats.forEach((x) => { x.ready = true; });
  t._start();
  const g = t.g;
  const A = t._player(0);
  g.turn = g.players.indexOf(A);
  g.cells[1].owner = 0;
  assert.equal(t.rentOf(1), 4);
  assert.throws(() => t.build('a', 1), /всю отрасль/);
  g.cells[3].owner = 0;
  assert.equal(t.rentOf(1), 8);
  t.build('a', 1);
  assert.throws(() => t.build('a', 1), /равномерно/);
  t.build('a', 3);
  assert.equal(g.cells[1].houses, 1);
  assert.equal(t.rentOf(1), 20);
  // a trade swaps streets and money
  g.cells[39].owner = 1;
  assert.throws(() => t.offerTrade('a', { to: 1, give: { cells: [1] }, get: { cells: [39] } }), /закройте филиалы/);
  t.sell('a', 1); t.sell('a', 3);
  t.offerTrade('a', { to: 1, give: { cells: [1], cash: 100 }, get: { cells: [39] } });
  t.answerTrade('b', true);
  assert.equal(g.cells[39].owner, 0);
  assert.equal(g.cells[1].owner, 1);
  t.destroy();
});

test('мафия: роли, ночь, голосование, боты доигрывают партию', async () => {
  assert.deepEqual(rolesFor(5).sort(), ['civ', 'civ', 'civ', 'com', 'maf']);
  assert.deepEqual(rolesFor(9).filter((r) => r === 'maf' || r === 'don').length, 3);
  for (const n of [5, 8]) {
    const { t, r, bal } = await botGame(MafiaTable, 'mf', n, {}, { introMs: 5, nightMs: 100, morningMs: 5, dayMs: 100, voteMs: 100, verdictMs: 5, countdown: 5, resultPause: 5 });
    assert.ok(['mafia', 'town'].includes(t.result.side));
    assert.ok(Math.abs(Object.values(bal).reduce((a, b) => a + b, 0)) <= 2, 'банк делится без потерь');
    assert.ok(r.some((x) => x.win));
  }
  // what a player may see and do
  const t = new MafiaTable({ id: 'z', name: 'z', stake: 0, maxPlayers: 6 }, {}, { countdown: 1, introMs: 100000 });
  for (let i = 0; i < 6; i++) t.sit('u' + i, 'U' + i, i);
  for (let i = 0; i < 6; i++) t.setReady('u' + i, true);
  t._clear('_flow'); t._start();
  const civ = t.g.players.find((p) => p.role === 'civ');
  const maf = t.g.players.find((p) => p.role === 'maf' || p.role === 'don');
  const viewCiv = t.publicState(civ.userId);
  assert.equal(viewCiv.me.role, 'civ');
  assert.ok(viewCiv.game.players.filter((p) => p.role).length === 1, 'мирный видит только себя');
  const viewMaf = t.publicState(maf.userId);
  assert.equal(viewMaf.game.players.filter((p) => p.role && (p.role === 'maf' || p.role === 'don')).length, 2, 'мафия видит своих');
  t._startNight();
  assert.throws(() => t.nightAction(civ.userId, 'kill', maf.seat), /не мафия/);
  assert.throws(() => t.say(civ.userId, civ.name, 'привет'), /город спит/);
  t.say(maf.userId, maf.name, 'берём его');
  assert.equal(t.publicState(civ.userId).chat.filter((m) => !m.sys).length, 0, 'ночной чат мафии не виден городу');
  t.destroy();
});

test('сервер: шахматы, Капитал и мафия — лобби, создание, тренировки', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-'));
  const srv = createServer({ dataFile: path.join(dir, 'u.json'), adminNames: [], botOpts: { fast: true }, capOpts: { countdown: 10 }, mfOpts: { countdown: 10, introMs: 50, nightMs: 300 } });
  await new Promise((r) => srv.server.listen(0, r));
  let cl = null;
  t.after(() => { if (cl) cl.close(); try { srv.shutdown(); } catch (e) { /* closed */ } });
  const base = `http://localhost:${srv.server.address().port}`;
  const reg = await fetch(base + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Гамбит', password: 'secret1', agree: true }) }).then((r) => r.json());
  cl = await new Promise((resolve) => { const s = connect(base, { auth: { token: reg.token }, reconnection: false }); s.on('connect', () => resolve(s)); });
  const call = (ev, p) => new Promise((r) => cl.emit(ev, p, r));
  const hello = await call('hello', {});
  assert.equal(hello.ch.length, 3);
  assert.equal(hello.cap.length, 2);
  assert.equal(hello.mf.length, 2);
  assert.ok((await call('ch:create', { name: 'Моя', stake: 100, clock: 5 })).tableId);
  assert.ok((await call('cap:create', { stake: 200, maxPlayers: 3, time: 30 })).tableId);
  assert.match((await call('mf:create', { stake: 100, maxPlayers: 3 })).error, /Неверные/);
  // chess against the computer: the bot answers
  const ch = await call('practice:create', { game: 'ch', level: 'easy' });
  const ct = srv.extra.ch.map.get(ch.id);
  await sleep(30);
  await call('ch:ready', { tableId: ch.id, value: true });
  assert.equal(ct.status, 'playing');
  for (let k = 0; k < 4 && ct.status === 'playing'; k++) {
    await sleep(80);
    if (ct.game.turn !== ct.colorOf(0)) continue;
    const m = ct.game.legal()[0];
    assert.ok((await call('ch:move', { tableId: ch.id, from: m.from, to: m.to, promo: m.promo })).ok);
  }
  assert.ok(ct.game.moves.length >= 3);
  // Капитал with two bots: roll and play a few turns
  const cap = await call('practice:create', { game: 'cap', level: 'normal', bots: 2 });
  const capT = srv.extra.cap.map.get(cap.id);
  await call('cap:ready', { tableId: cap.id, value: true });
  await sleep(80);
  assert.equal(capT.status, 'playing');
  for (let k = 0; k < 30 && capT.status === 'playing'; k++) {
    await sleep(30);
    const g = capT.g;
    if (!g || g.trade || capT._current().userId !== reg.user.id) continue;
    if (g.phase === 'roll') await call('cap:roll', { tableId: cap.id });
    else if (g.phase === 'buy') await call('cap:decline', { tableId: cap.id });
    else await call('cap:end', { tableId: cap.id });
  }
  assert.ok(capT.g.moveNo >= 3, `бросков: ${capT.g.moveNo}`);
  // mafia with six bots
  const mf = await call('practice:create', { game: 'mf', level: 'normal', bots: 6 });
  const mfT = srv.extra.mf.map.get(mf.id);
  await call('mf:ready', { tableId: mf.id, value: true });
  await sleep(200);
  assert.equal(mfT.status, 'playing');
  const st = (await call('mf:watch', { tableId: mf.id })).state;
  assert.ok(st.me && st.me.role);
  assert.equal(srv.store.get(reg.user.id).stats.mafia.games, 0);
});

test('покер: пауза, пока игрок, чей ход, не в сети', () => {
  const { Table } = require('../server/engine/table');
  let now = 0; const timers = [];
  const T = { set: (fn, ms) => { const t = { fn, at: now + ms }; timers.push(t); return t; }, clear: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); } };
  const run = (ms) => { now += ms; for (;;) { const due = timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at)[0]; if (!due) break; timers.splice(timers.indexOf(due), 1); due.fn(); } };
  const t = new Table({ id: 'x', name: 'x', game: 'NLH', sb: 5, bb: 10, maxSeats: 6 }, { timers: T, now: () => now, startDelay: 0, actionTime: 20000, pauseMs: 60000 });
  t.sit('a', 'A', 0, 1000); t.sit('b', 'B', 1, 1000); run(1);
  const who = t.seats[t.hand.toAct].userId;
  run(5000);
  t.setConnected(who, false);
  const st = t.publicState('a');
  assert.ok(st.paused);
  assert.equal(st.turnRemaining, 15000, 'таймер хода заморожен');
  run(40000);
  assert.equal(t.seats[t.hand.toAct].userId, who, 'стол ждёт');
  t.setConnected(who, true);
  assert.equal(t.publicState('a').paused, null);
  run(14000);
  assert.equal(t.seats[t.hand.toAct].userId, who, 'после возвращения — оставшееся время');
  run(2000);
  assert.equal(t.seats[t.seatOf(who)].lastAction, 'Фолд');
  // a second drop in the same hand uses what is left of the 60 s
  const h2 = t.handNo;
  run(10000);
  if (t.hand && t.hand.no !== h2 && t.hand.toAct !== -1) {
    const w2 = t.seats[t.hand.toAct].userId;
    t.setConnected(w2, false);
    run(61000);
    assert.notEqual(t.hand && t.hand.toAct !== -1 ? t.seats[t.hand.toAct].userId : null, w2);
  }
  t.destroy();
});
