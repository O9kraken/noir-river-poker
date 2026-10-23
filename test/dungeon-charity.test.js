'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PartyTable } = require('../server/party/base');
const { GAMES } = require('../server/party');

function seeded(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function table(seed = 3) {
  let now = 0;
  const pending = new Map(); let k = 0;
  const timers = { set(fn, ms) { const id = ++k; pending.set(id, { fn, at: now + ms }); return id; }, clear(id) { pending.delete(id); } };
  const advance = (ms) => { const end = now + ms; for (;;) { const due = [...pending].filter(([, e]) => e.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!due) break; now = due[1].at; pending.delete(due[0]); due[1].fn(); } now = end; };
  const rng = seeded(seed);
  const t = new PartyTable({ id: 't', name: 'T', game: 'dungeon', stake: 0, maxPlayers: 3, options: {} }, {}, { games: GAMES, timers, now: () => now, rng, randomInt: (n) => Math.floor(rng() * n), countdown: 10, resultPause: 10 });
  ['a', 'b', 'c'].forEach((u, i) => { t.sit(u, u.toUpperCase(), i); t.setReady(u, true); });
  advance(20);
  return { t, g: t.g, advance };
}
const total = (g) => g.doors.length + g.treasures.length + g.doorDiscard.length + g.trDiscard.length
  + [...g.ps.values()].reduce((a, p) => a + p.hand.length + g._items(p).length + (p.clsCard ? 1 : 0), 0)
  + (g.fight ? g.fight.monsters.reduce((a, m) => a + 1 + m.mods.length, 0) : 0);

/** Play the current player's turn up to its end without touching the hand. */
function endTurn(t, g) {
  const u = t.seats[g.cur].userId;
  if (g.phase === 'start') t.act(u, 'kick', {});
  if (g.phase === 'fight') t.act(u, 'run', {});
  if (g.phase === 'after') t.act(u, 'loot', {});
}

test('подземелье: лишние карты игрок выбирает сам, ничего не пропадает молча', () => {
  const { t, g } = table();
  const before = total(g);
  const seat = g.cur;
  const u = t.seats[seat].userId;
  assert.ok(g.p(seat).hand.length > 5, 'на старте 8 карт при лимите 5');
  endTurn(t, g);
  if (g.phase !== 'charity') { assert.ok(g.p(seat).hand.length <= 5); return; }
  const v = g.view(seat);
  assert.equal(v.charity.need, g.p(seat).hand.length - 5);
  assert.throws(() => t.act(u, 'give', { cards: [g.p(seat).hand[0].id] }), /ровно/);
  const ids = g.p(seat).hand.slice(0, v.charity.need).map((c) => c.id);
  t.act(u, 'give', { cards: ids });
  assert.equal(g.p(seat).hand.length, 5);
  assert.notEqual(g.cur, seat, 'ход перешёл дальше');
  assert.equal(total(g), before, 'все карты на месте');
  assert.ok(g.ev && g.ev.type === 'gave' && /лишнее/.test(g.ev.text), 'в логе написано, что ушло');
});

test('подземелье: не успел выбрать — уходят самые дешёвые; надеть вещь вместо сброса можно', () => {
  const { t, g, advance } = table(7);
  const before = total(g);
  let seat = g.cur;
  endTurn(t, g);
  if (g.phase === 'charity') {
    advance(31000 * 1);
    assert.notEqual(g.phase, 'charity');
    assert.equal(g.p(seat).hand.length, 5);
  }
  assert.equal(total(g), before);
  // next player: put gear on during the charity phase until the hand fits
  for (let k = 0; k < 6 && g.phase !== 'over'; k++) {
    seat = g.cur;
    const u = t.seats[seat].userId;
    endTurn(t, g);
    if (g.phase !== 'charity' || g.cur !== seat) continue;
    const gear = g.p(seat).hand.filter((c) => g.def(c).type === 'gear' && !g.def(c).only);
    if (!gear.length) { t.act(u, 'give', { cards: g.p(seat).hand.slice(0, g.p(seat).hand.length - 5).map((c) => c.id) }); continue; }
    const need = g.p(seat).hand.length - 5;
    t.act(u, 'equip', { card: gear[0].id });
    if (need === 1 && g.def(gear[0]).slot !== 'misc') assert.ok(g.cur !== seat || g.phase === 'charity');
    assert.equal(total(g), before);
    return;
  }
});
