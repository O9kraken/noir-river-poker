'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { io: connect } = require('socket.io-client');
const { CheckersGame, initialBoard, sqOf } = require('../server/checkers/engine');
const checkersAI = require('../server/bots/checkers-ai');
const durakAI = require('../server/bots/durak-ai');
const pokerAI = require('../server/bots/poker-ai');
const { DurakGame } = require('../server/durak/engine');
const { Table } = require('../server/engine/table');
const { Store, WHEEL, newSeason } = require('../server/store');
const { createServer } = require('../server');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seeded = (seed) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

test('шашки: компьютер берёт выигрышное взятие и доигрывает партию', () => {
  // white man on c3 can take two black men; the bot must find the double capture
  const b = Array(64).fill(null);
  b[sqOf(5, 2)] = { c: 'w', k: false };
  b[sqOf(4, 3)] = { c: 'b', k: false };
  b[sqOf(2, 5)] = { c: 'b', k: false };
  b[sqOf(0, 1)] = { c: 'b', k: false };
  const mv = checkersAI.chooseMove(b, 'w', 'normal', seeded(1));
  assert.equal(mv.captures.length, 2);

  for (const [lw, lb] of [['hard', 'easy'], ['normal', 'normal']]) {
    const g = new CheckersGame();
    const rnd = seeded(7);
    let plies = 0;
    while (!g.result && plies < 300) {
      const m = checkersAI.chooseMove(g.board, g.turn, g.turn === 'w' ? lw : lb, rnd);
      g.play(g.turn, m.path);
      plies += 1;
    }
    assert.ok(g.result, `партия ${lw}/${lb} закончилась`);
  }
  assert.ok(checkersAI.evaluate(initialBoard(), 'w') === 0);
});

test('дурак: боты доигрывают партии на 2–4 игроков в обоих вариантах', () => {
  for (const variant of ['podkidnoy', 'perevodnoy']) {
    for (const n of [2, 3, 4]) {
      for (let seed = 1; seed <= 6; seed++) {
        const rnd = seeded(seed * 31 + n);
        const seats = Array.from({ length: n }, (_, i) => i);
        const g = new DurakGame(seats, { variant, randomInt: (k) => Math.floor(rnd() * k) });
        let steps = 0;
        while (!g.over && steps < 2000) {
          const w = g.waitingFor();
          let acted = false;
          for (const s of w.seats) {
            const a = durakAI.decide(g, s, ['easy', 'normal', 'hard'][seed % 3], rnd);
            if (!a) continue;
            if (a.type === 'attack') g.attack(s, a.card);
            else if (a.type === 'defend') g.defend(s, a.card, a.index);
            else if (a.type === 'transfer') g.transfer(s, a.card);
            else if (a.type === 'take') g.take(s);
            else g.pass(s);
            acted = true;
            break;
          }
          assert.ok(acted, `бот должен уметь ходить (${variant}, ${n}, ${w.kind})`);
          steps += 1;
        }
        assert.ok(g.over, `партия ${variant}/${n}/${seed} закончилась`);
        assert.equal(g.totalCards(), 36);
      }
    }
  }
});

test('покер: боты играют раздачи, фишки сохраняются', async () => {
  const timers = [];
  const t = new Table({ id: 'x', name: 'x', game: 'NLH', sb: 10, bb: 20, maxSeats: 6 }, {
    timers: { set: (fn) => { timers.push(fn); return fn; }, clear: (fn) => { const i = timers.indexOf(fn); if (i !== -1) timers.splice(i, 1); } },
    startDelay: 0, pauseAfterHand: 0, runoutDelay: 0,
  });
  for (let i = 0; i < 4; i++) t.sit('p' + i, 'P' + i, i, 2000);
  const rnd = seeded(5);
  let guard = 0;
  while (t.handNo < 30 && guard++ < 5000) {
    if (t.hand && !t.hand.ended && t.hand.toAct !== -1) {
      const i = t.hand.toAct;
      const d = pokerAI.decide(t, i, ['easy', 'normal', 'hard'][i % 3], rnd);
      t.act(t.seats[i].userId, d.type, d.amount);
    } else if (timers.length) timers.shift()();
    else break;
    // rebuy busted players so the game continues
    if (!t.hand) for (const s of t.seats) if (s && s.stack === 0) { s.stack = 2000; s.sittingOut = false; }
  }
  assert.ok(t.handNo >= 30, `сыграно раздач: ${t.handNo}`);
  const eqAA = pokerAI.equity('NLH', ['As', 'Ad'], [], 1, 400, seeded(3));
  const eq72 = pokerAI.equity('NLH', ['7c', '2d'], [], 1, 400, seeded(3));
  assert.ok(eqAA > 0.75 && eq72 < 0.45, `AA ${eqAA}, 72 ${eq72}`);
});

test('колесо фортуны, рейтинг Эло и недельный сезон', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-'));
  const store = new Store(path.join(dir, 'u.json'));
  const ids = ['Ася', 'Боря', 'Ваня', 'Гена'].map((n) => store.register(n, 'secret1').user.id);
  // the wheel: one spin a day, the prize is one of the sectors
  const u = store.get(ids[0]);
  u.lastBonus = 0;
  const before = u.balance;
  const spin = store.claimBonus(ids[0]);
  assert.equal(WHEEL[spin.sector].amount, spin.amount);
  assert.equal(u.balance, before + spin.amount);
  assert.throws(() => store.claimBonus(ids[0]), /Колесо уже крутили/);
  assert.equal(store.profile(ids[0]).wheel.length, WHEEL.length);

  // Elo: the winner gains what the loser loses
  const [r1] = store.applyRatings('checkers', [{ userId: ids[0], score: 1 }, { userId: ids[1], score: 0 }]);
  assert.equal(r1.delta, 20);
  assert.equal(store.get(ids[1]).rating.checkers.r, 1180);
  // a durak game with three: the durak loses, the two others gain
  const d = store.applyRatings('durak', [{ userId: ids[0], score: 1 }, { userId: ids[1], score: 1 }, { userId: ids[2], score: 0 }]);
  assert.ok(d[0].delta > 0 && d[2].delta < 0);
  assert.equal(store.ratingTable('checkers')[0].name, 'Ася');

  // season: results add up, the week closes and pays the top with enough games
  for (let k = 0; k < 12; k++) store.recordGame(ids[0], 'bj', { table: 'x', net: 100 });
  for (let k = 0; k < 12; k++) store.recordGame(ids[1], 'durak', { table: 'x', net: 50, draw: false, durak: false });
  for (let k = 0; k < 3; k++) store.recordGame(ids[2], 'bj', { table: 'x', net: 5000 }); // too few games for a prize
  const view = store.seasonView('total', ids[1]);
  assert.equal(view.top[0].name, 'Ваня');
  assert.equal(view.me.place, 3);
  assert.equal(store.seasonView('bj').top.length, 2);
  const b0 = store.get(ids[0]).balance;
  const b1 = store.get(ids[1]).balance;
  const closed = store.seasonTick(store.data.season.end + 1000);
  assert.deepEqual(closed.winners.map((w) => w.name), ['Ася', 'Боря']);
  assert.equal(store.get(ids[0]).balance, b0 + 5000);
  assert.equal(store.get(ids[1]).balance, b1 + 3000);
  assert.equal(store.data.seasonHistory.length, 1);
  assert.equal(Object.keys(store.data.season.scores).length, 0);
  assert.equal(store.seasonTick(), null);
  const s = newSeason(Date.UTC(2026, 9, 21, 12));
  assert.equal(s.id, '2026-10-19');
  assert.equal(s.end - s.start, 7 * 24 * 3600 * 1000);
});

test('тренировка с компьютером: шашки, дурак и покер без фишек; реакции', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-'));
  const srv = createServer({
    dataFile: path.join(dir, 'u.json'), adminNames: [],
    botOpts: { fast: true }, tableOpts: { startDelay: 20, pauseAfterHand: 30, runoutDelay: 5 },
    durakOpts: { countdown: 20, roundPause: 10, resultPause: 50 }, ckOpts: { resultPause: 50 },
  });
  await new Promise((r) => srv.server.listen(0, r));
  let cl = null;
  t.after(() => { if (cl) cl.close(); try { srv.shutdown(); } catch (e) { /* closed */ } });
  const base = `http://localhost:${srv.server.address().port}`;
  const reg = await fetch(base + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Ученик', password: 'secret1' }) }).then((r) => r.json());
  cl = await new Promise((resolve) => { const s = connect(base, { auth: { token: reg.token }, reconnection: false }); s.on('connect', () => resolve(s)); });
  const call = (ev, p) => new Promise((r) => cl.emit(ev, p, r));
  const uid = reg.user.id;
  const balance = srv.store.get(uid).balance;
  const hello = await call('hello', {});
  assert.equal(hello.botLevels.length, 3);
  assert.ok(hello.reactions.includes('🔥'));

  // checkers: the bot gets ready and answers moves
  const ck = await call('practice:create', { game: 'ck', level: 'easy' });
  assert.equal(ck.kind, 'ck');
  const ct = srv.extra.ck.map.get(ck.id);
  assert.ok(ct.practice && ct.private);
  assert.ok(!(await call('hello', {})).ck.some((x) => x.id === ck.id), 'тренировка не видна в лобби');
  await sleep(30);
  assert.ok(ct.seats[1].ready, 'бот готов');
  await call('ck:ready', { tableId: ck.id, value: true });
  assert.equal(ct.status, 'playing');
  const myColor = ct.colorOf(0);
  for (let k = 0; k < 6 && ct.status === 'playing'; k++) {
    await sleep(40);
    if (ct.game.turn !== myColor) continue;
    const legal = ct.game.legal();
    assert.ok((await call('ck:move', { tableId: ck.id, path: legal[0].path })).ok);
  }
  assert.ok(ct.game.moves.length >= 4, `сделано ходов: ${ct.game.moves.length}`);
  const fxGot = new Promise((r) => cl.once('fx', r));
  await call('ck:resign', { tableId: ck.id });
  assert.equal((await fxGot).items[0].text, 'Победа');
  assert.equal(srv.store.get(uid).stats.checkers.games, 0, 'тренировка не идёт в статистику');
  assert.equal(srv.store.get(uid).rating.checkers.games, 0);
  await call('ck:leave', { tableId: ck.id });
  await sleep(20);
  assert.ok(!srv.extra.ck.map.has(ck.id), 'стол закрыт, когда человек ушёл');

  // durak: two bots, the game runs to the end with the player timing out
  const dk = await call('practice:create', { game: 'durak', level: 'normal', bots: 2, variant: 'perevodnoy' });
  const dt = srv.durakTables.get(dk.id);
  assert.equal(dt.playerCount(), 3);
  await call('durak:watch', { tableId: dk.id });
  await call('durak:ready', { tableId: dk.id, value: true });
  await sleep(120);
  assert.equal(dt.status, 'playing');
  // the player answers with the first legal option until the game is over
  const deadline = Date.now() + 15000;
  while (dt.status === 'playing' && Date.now() < deadline) {
    await sleep(15);
    const g = dt.game;
    if (!g || g.over) continue;
    const w = g.waitingFor();
    if (!w.seats.includes(0)) continue;
    const a = durakAI.decide(g, 0, 'normal');
    if (a) await call('durak:act', { tableId: dk.id, type: a.type, card: a.card, index: a.index });
  }
  assert.notEqual(dt.status, 'playing', 'партия в дурака закончилась');
  assert.equal(srv.store.get(uid).stats.durak.games, 0);
  // reactions are for seated players and limited to the list
  const reacted = new Promise((r) => cl.once('react', r));
  assert.ok((await call('react', { room: 'durak:' + dk.id, emoji: '🔥' })).ok);
  assert.equal((await reacted).seat, 0);
  assert.match((await call('react', { room: 'durak:' + dk.id, emoji: '💩' })).error, /реакции/);
  assert.match((await call('react', { room: 'durak:durak-classic', emoji: '👍' })).error, /за столом/);

  // poker: three bots, hands are dealt, no chips leave the balance
  const pk = await call('practice:create', { game: 'poker', level: 'hard', bots: 3 });
  const pt = srv.tables.get(pk.id);
  await call('table:watch', { tableId: pk.id });
  const pdeadline = Date.now() + 15000;
  while (pt.handNo < 4 && Date.now() < pdeadline) {
    await sleep(20);
    const h = pt.hand;
    if (h && !h.ended && h.toAct === 0) {
      const s = pt.seats[0];
      await call('table:act', { tableId: pk.id, type: s.bet >= h.currentBet ? 'check' : 'call' });
    }
  }
  assert.ok(pt.handNo >= 4, `раздач: ${pt.handNo}`);
  assert.equal(srv.store.get(uid).stats.poker.hands, 0);
  await call('table:stand', { tableId: pk.id });
  await sleep(60);
  assert.equal(srv.store.get(uid).balance, balance, 'баланс не тронут');
  assert.ok((await call('season:get', { game: 'total' })).season.label);
  assert.ok(Array.isArray((await call('ratings:get', { kind: 'durak' })).list));
});
