'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PartyTable } = require('../server/party/base');
const { GAMES } = require('../server/party');

function world() {
  let now = 0;
  const pending = new Map(); let id = 0;
  const timers = { set(fn, ms) { const k = ++id; pending.set(k, { fn, at: now + ms }); return k; }, clear(k) { pending.delete(k); } };
  const advance = (ms) => { const end = now + ms; for (;;) { const due = [...pending].filter(([, e]) => e.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!due) break; now = due[1].at; pending.delete(due[0]); due[1].fn(); } now = end; };
  return { timers, now: () => now, advance };
}
function seeded(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/** A whole game played by bots only: no exceptions, it ends, the pot goes to the winners. */
function botGame(game, n, seed, options = {}) {
  const w = world();
  const rng = seeded(seed);
  const wallet = new Map();
  let ended = null;
  const t = new PartyTable({ id: 't', name: 'T', game, stake: 100, maxPlayers: n, options }, {
    charge: (u, a) => { wallet.set(u, (wallet.get(u) || 0) - a); return true; },
    pay: (u, a) => { wallet.set(u, (wallet.get(u) || 0) + a); },
    onGameEnd: (tt, r) => { ended = r; },
  }, { games: GAMES, timers: w.timers, now: w.now, rng, randomInt: (k) => Math.floor(rng() * k), countdown: 10, resultPause: 10 });
  const ids = new Set();
  for (let i = 0; i < n; i++) { const u = `bot:${i}`; ids.add(u); t.sit(u, `Бот${i}`, i); }
  let steps = 0;
  while (!ended && steps < 20000) {
    steps += 1;
    const d = t.botDelay(ids);
    if (d != null && rng() < 0.9) { w.advance(Math.min(d, 400)); t.botStep(ids, ['easy', 'normal', 'hard'][steps % 3], rng); } else w.advance(1500);
  }
  return { t, ended, wallet, steps };
}

for (const [game, sizes] of Object.entries({ bomb: [2, 5, 10], spy: [4, 7, 10], dungeon: [3, 6], dark: [3, 6, 10] })) {
  test(`${game}: партии ботов доходят до конца`, () => {
    for (const n of sizes) {
      for (const seed of [1, 7, 42]) {
        const { t, ended, wallet, steps } = botGame(game, n, seed, game === 'dungeon' ? { goal: 6 } : game === 'dark' ? { goal: 4 } : {});
        assert.ok(ended, `${game} ${n} игроков, сид ${seed}: партия не закончилась за ${steps} шагов (${JSON.stringify(t.g && t.g.view(-1).phase)})`);
        const total = [...wallet.values()].reduce((a, b) => a + b, 0);
        assert.equal(total, 0, 'фишки не появляются и не пропадают');
        assert.ok(ended.some((r) => r.win), 'есть победитель');
      }
    }
  });
}

test('настолки через сервер: стол на фишки, двое людей играют в котобомбу до конца', async (t) => {
  const os = require('os'); const fs = require('fs'); const path = require('path');
  const { io: connect } = require('socket.io-client');
  const { createServer } = require('../server');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-'));
  const srv = createServer({ dataFile: path.join(dir, 'u.json'), ptOpts: { countdown: 20, resultPause: 3000 } });
  await new Promise((r) => srv.server.listen(0, r));
  const clients = [];
  t.after(() => { clients.forEach((c) => c.close()); srv.shutdown(); });
  const base = `http://localhost:${srv.server.address().port}`;
  const reg = (name) => fetch(base + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password: 'secret1', agree: true }) }).then((r) => r.json());
  const users = [await reg('Кошатник'), await reg('Сапёрша')];
  const conn = (token) => new Promise((res) => { const c = connect(base, { auth: { token }, reconnection: false }); clients.push(c); c.on('pt:state', (s) => { c.st = s; }); c.on('connect', () => res(c)); });
  const [a, b] = [await conn(users[0].token), await conn(users[1].token)];
  const call = (c, ev, p) => new Promise((r) => c.emit(ev, p, r));
  const hello = await call(a, 'hello', {});
  assert.ok(hello.ptGames.bomb && hello.pt.some((x) => x.game === 'spy'), 'в лобби есть настолки');
  assert.ok((await call(a, 'pt:create', { game: 'nope', stake: 0, maxPlayers: 4 })).error);
  const made = await call(a, 'pt:create', { game: 'bomb', name: 'Тест', stake: 100, maxPlayers: 2 });
  const id = made.tableId;
  for (const c of [a, b]) { await call(c, 'pt:watch', { tableId: id }); assert.ok((await call(c, 'pt:sit', { tableId: id })).ok); }
  for (const c of [a, b]) await call(c, 'pt:ready', { tableId: id, value: true });
  const before = users.map((u) => srv.store.get(u.user.id).balance);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let steps = 0;
  while (steps++ < 400) {
    await sleep(30);
    const st = a.st;
    if (!st || st.status === 'waiting' || st.status === 'countdown') continue;
    if (st.status === 'result') break;
    const g = st.g;
    const cur = [a, b].find((c) => c.st && c.st.mySeat === g.cur);
    if (g.pending) continue;
    if (g.phase === 'insert') { const who = [a, b].find((c) => c.st.mySeat === g.phaseInfo.seat); await call(who, 'pt:act', { tableId: id, type: 'insert', data: { pos: 'random' } }); continue; }
    if (g.phase === 'turn' && cur) await call(cur, 'pt:act', { tableId: id, type: 'draw', data: {} });
  }
  await sleep(100);
  assert.equal(a.st.status, 'result', 'партия закончилась');
  const after = users.map((u) => srv.store.get(u.user.id).balance);
  assert.equal(after[0] + after[1], before[0] + before[1], 'банк ушёл победителю целиком');
  assert.ok(after.some((x, i) => x === before[i] + 100));
  for (const u of users) assert.equal(srv.store.get(u.user.id).stats.party.games, 1);
  assert.equal(srv.store.get(users[0].user.id).stats.party.by.bomb.games, 1);
  // a practice table with bots
  const pr = await call(a, 'practice:create', { game: 'pt', variant: 'spy', level: 'easy', bots: 3 });
  assert.equal(pr.kind, 'pt');
  assert.match(pr.href, /^#\/pt\//);
});

test('шпионы: подсказка не может быть словом с поля', () => {
  const { SpyGame } = require('../server/party/spy');
  const host = { rng: seeded(5), sys() {}, addLog() {}, nameOf: (s) => `И${s}`, turn() {}, stopTurn() {}, timer() {}, clear() {}, timerLeft: () => 0, finish() {}, seats: [] };
  const g = new SpyGame(host, [0, 1, 2, 3].map((s) => ({ seat: s, userId: 'u' + s, name: 'И' + s, pref: s === 0 ? { team: 'r', captain: true } : {} })), { clueSec: 90 });
  assert.equal(g.captain.r, 0, 'желание быть капитаном учтено');
  const w = g.cards[0].w;
  assert.ok(g.validClue(w));
  assert.ok(g.validClue('два слова'));
  assert.equal(g.validClue('абракадабра'), null);
});
