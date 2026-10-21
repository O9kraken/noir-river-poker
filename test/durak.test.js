'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DurakGame, beats } = require('../server/durak/engine');

test('дурак: старшинство и козыри', () => {
  assert.ok(beats('7h', '6h', 's'));
  assert.ok(!beats('6h', '7h', 's'));
  assert.ok(beats('6s', 'Ah', 's'), 'козырь бьёт любую некозырную');
  assert.ok(!beats('Ah', '6s', 's'), 'некозырная не бьёт козырь');
  assert.ok(beats('7s', '6s', 's'));
  assert.ok(!beats('Ad', 'Kh', 's'), 'другая масть не бьёт');
});

// deck: deck[0] is the trump (bottom), deal pops from the end
function riggedDeck(handsBySeat, trumpCard) {
  const all = [];
  for (const r of '6789TJQKA') for (const su of 'shdc') all.push(r + su);
  const dealt = [];
  // deal is round-robin: card k of every seat in order
  const seats = handsBySeat.length;
  for (let k = 0; k < 6; k++) for (let s = 0; s < seats; s++) dealt.push(handsBySeat[s][k]);
  const rest = all.filter((c) => !dealt.includes(c) && c !== trumpCard);
  return [trumpCard, ...rest, ...dealt.reverse()];
}

test('дурак: первым ходит младший козырь, подкидывание по рангам, бито', () => {
  const deck = riggedDeck([
    ['6h', '6d', '7c', '9h', 'Td', 'Jc'],
    ['7h', '7d', 'Kc', 'Ah', '6s', 'Qd'],
  ], '8s');
  const g = new DurakGame([0, 1], { deck });
  assert.equal(g.trump, 's');
  assert.equal(g.attacker, 1, 'у места 1 младший козырь 6♠');
  assert.equal(g.defender, 0);
  assert.equal(g.roundLimit, 5, 'первый отбой — не больше 5 карт');
  assert.throws(() => g.attack(0, '6h'), /нельзя/);
  g.attack(1, '7h');
  assert.ok(!g.canThrow(1, 'Kc'), 'подкидывать можно только ранги со стола');
  g.defend(0, '9h', 0);
  g.attack(1, '7d');
  g.defend(0, 'Td', 1);
  // подкинуть нечего (7, 9, T на столе) — раунд закрывается сам
  assert.equal(g.table.length, 0, 'бито');
  assert.equal(g.discard, 4);
  assert.equal(g.attacker, 0, 'отбившийся ходит следующим');
  assert.equal(g.hand(0).length, 6);
  assert.equal(g.hand(1).length, 6);
  assert.equal(g.totalCards(), 36);
});

test('дурак: «Беру» — подкидывание вдогонку и пропуск хода', () => {
  const deck = riggedDeck([
    ['6h', '6d', '7c', '9c', 'Tc', 'Jc'],
    ['8h', '8d', 'Kc', 'Ah', '6s', '8c'],
    ['7h', '7d', '7s', 'Qh', 'Qd', 'Qc'],
  ], '9s');
  const g = new DurakGame([0, 1, 2], { deck });
  assert.equal(g.attacker, 1);
  assert.equal(g.defender, 2);
  g.attack(1, '8h');
  g.take(2);
  assert.ok(g.canThrow(0, '9c') === false);
  g.attack(1, '8d');
  g.pass(1);
  assert.equal(g.hand(2).length, 6 + 2, 'взял две карты');
  assert.equal(g.attacker, 0, 'взявший пропускает ход');
  assert.equal(g.defender, 1);
});

test('дурак: перевод в переводном', () => {
  const deck = riggedDeck([
    ['6h', 'Td', '7c', '9c', 'Tc', 'Jc'],
    ['7h', '8d', 'Kc', 'Ah', '6s', '8c'],
    ['7d', '9d', 'Js', 'Qh', 'Qd', 'Qc'],
  ], '9s');
  const g = new DurakGame([0, 1, 2], { deck, variant: 'perevodnoy' });
  assert.equal(g.attacker, 1);
  g.attack(1, '7h');
  assert.ok(g.canTransfer(2, '7d'));
  g.transfer(2, '7d');
  assert.equal(g.defender, 0, 'отбивается следующий');
  assert.equal(g.table.length, 2);
  const pod = new DurakGame([0, 1, 2], { deck, variant: 'podkidnoy' });
  pod.attack(1, '7h');
  assert.ok(!pod.canTransfer(2, '7d'), 'в подкидном переводить нельзя');
});

test('дурак: 4000 случайных партий — карты сохраняются, игра заканчивается', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const randomInt = (n) => Math.floor(rnd() * n);
  let draws = 0;
  for (let game = 0; game < 4000; game++) {
    const n = 2 + (game % 5);
    const seats = Array.from({ length: n }, (_, i) => i);
    const g = new DurakGame(seats, { variant: game % 2 ? 'perevodnoy' : 'podkidnoy', randomInt });
    let steps = 0;
    while (!g.over && steps++ < 5000) {
      const w = g.waitingFor();
      if (w.kind === 'lead') { g.attack(g.attacker, rnd() < 0.5 ? g.autoLead() : g.hand(g.attacker)[randomInt(g.hand(g.attacker).length)]); continue; }
      if (w.kind === 'defend') {
        const d = g.defender;
        const tr = g.hand(d).find((c) => g.canTransfer(d, c));
        if (tr && rnd() < 0.5) { g.transfer(d, tr); continue; }
        const idx = g.table.findIndex((p) => !p.d);
        const card = g.hand(d).find((c) => g.canDefend(d, c, idx));
        if (card && rnd() < 0.85) g.defend(d, card, idx); else g.take(d);
        continue;
      }
      // throw-in phase
      const s = w.seats[randomInt(w.seats.length)];
      const c = g.hand(s).find((x) => g.canThrow(s, x));
      if (c && rnd() < 0.4) g.attack(s, c); else g.pass(s);
      assert.equal(g.totalCards(), 36, 'в игре всегда 36 карт');
      for (const [, h] of g.hands) assert.ok(h.length >= 0);
    }
    assert.ok(g.over, `партия ${game} завершилась`);
    if (g.durak == null) draws++;
    else assert.ok(g.hand(g.durak).length > 0, 'у дурака остались карты');
  }
  assert.ok(draws < 4000);
});

// ---------- table with stakes ----------
const { DurakTable } = require('../server/durak/table');

function fakeTimers() {
  let id = 0;
  const pending = new Map();
  return {
    set(fn, ms) { const k = ++id; pending.set(k, { fn, ms }); return k; },
    clear(k) { pending.delete(k); },
    runOne() { const e = pending.entries().next().value; if (!e) return false; pending.delete(e[0]); e[1].fn(); return true; },
    get size() { return pending.size; },
  };
}

function makeDurak(n, cfg = {}) {
  const timers = fakeTimers();
  const bal = new Map();
  const deps = {
    canAfford: (u, a) => (bal.get(u) || 0) >= a,
    charge: (u, a) => { if ((bal.get(u) || 0) < a) return false; bal.set(u, bal.get(u) - a); return true; },
    pay: (u, a) => bal.set(u, (bal.get(u) || 0) + a),
  };
  const t = new DurakTable({ id: 'd', name: 'D', variant: 'podkidnoy', stake: 100, maxPlayers: 6, ...cfg }, deps, { timers });
  for (let i = 0; i < n; i++) { bal.set('u' + i, 1000); t.sit('u' + i, 'P' + i, i); }
  return { t, timers, bal };
}
const total = (bal) => [...bal.values()].reduce((a, b) => a + b, 0);

test('стол дурака: готовность, ставки, тайм-ауты доигрывают партию, банк делится', () => {
  const { t, timers, bal } = makeDurak(3);
  t.setReady('u0', true);
  t.setReady('u1', true);
  assert.equal(t.status, 'waiting', 'ждём всех за столом');
  t.setReady('u2', true);
  assert.equal(t.status, 'countdown');
  timers.runOne();
  assert.equal(t.status, 'playing');
  assert.equal(t.pot, 300);
  assert.equal(total(bal), 2700);
  // никто ничего не делает: тайм-ауты, а трижды пропустивший ход проигрывает
  let guard = 0;
  while (t.status === 'playing' && guard++ < 2000) timers.runOne();
  assert.equal(t.status, 'result');
  assert.equal(total(bal), 3000, 'банк выплачен полностью');
  const r = t.result;
  if (!r.draw) {
    const loser = r.payouts.find((p) => p.net === -100);
    assert.ok(loser && loser.name === r.durak.name);
  }
  timers.runOne();
  assert.equal(t.status, 'waiting');
  assert.ok(t.seats.every((s) => !s || !s.ready), 'готовность сбрасывается');
});

test('стол дурака: уход посреди партии — поражение; закрытие стола — возврат ставок', () => {
  const { t, timers, bal } = makeDurak(2);
  t.setReady('u0', true); t.setReady('u1', true); timers.runOne();
  t.leave('u0');
  assert.equal(t.result.durak.name, 'P0');
  assert.equal(bal.get('u1'), 1100);
  assert.equal(bal.get('u0'), 900);
  const b = makeDurak(2);
  b.t.setReady('u0', true); b.t.setReady('u1', true); b.timers.runOne();
  b.t.destroy();
  assert.equal(total(b.bal), 2000);
  assert.throws(() => b.t.setReady('nobody', true), /сядьте/);
});

test('стол дурака: игрок видит только свои карты и доступные действия', () => {
  const { t, timers } = makeDurak(2, { variant: 'perevodnoy' });
  t.setReady('u0', true); t.setReady('u1', true); timers.runOne();
  const s0 = t.publicState('u0');
  assert.equal(s0.hand.length, 6);
  assert.equal(s0.seats[1].cards, 6);
  assert.ok(!('hand' in s0.seats[1]));
  const att = t.game.attacker === 0 ? 'u0' : 'u1';
  const st = t.publicState(att);
  assert.equal(st.you.role, 'attacker');
  assert.equal(st.you.throwable.length, 6);
  t.act(att, 'attack', st.you.throwable[0]);
  const def = att === 'u0' ? 'u1' : 'u0';
  const sd = t.publicState(def);
  assert.equal(sd.you.canTake, true);
  assert.equal(t.publicState('stranger').hand.length, 0);
});

test('стол дурака: после «бито» карты лежат на столе паузу, потом уходят в отбой', () => {
  const { t, timers } = makeDurak(2);
  t.setReady('u0', true); t.setReady('u1', true); timers.runOne();
  const g = t.game;
  const att = g.attacker === 0 ? 'u0' : 'u1';
  const def = att === 'u0' ? 'u1' : 'u0';
  const dSeat = g.defender;
  // атакуем картой, которую защитник может побить, если такая есть
  let card = null;
  let beat = null;
  for (const c of g.hand(g.attacker)) {
    const b = g.hand(dSeat).find((d) => require('../server/durak/engine').beats(d, c, g.trump));
    if (b) { card = c; beat = b; break; }
  }
  if (!card) return; // редкая раздача без возможного отбоя
  t.act(att, 'attack', card);
  t.act(def, 'defend', beat, 0);
  // подкинуть больше нечего или атакующий пасует
  if (!g.pendingEnd) t.act(att, 'pass');
  assert.equal(g.pendingEnd, true);
  assert.equal(g.table.length, 1, 'карты ещё на столе');
  const st = t.publicState(att);
  assert.deepEqual(st.roundEnding, { took: false, defender: dSeat });
  assert.equal(st.you.throwable.length, 0, 'во время паузы ходить нельзя');
  assert.ok(st.lastMove && st.lastMove.type, 'последний ход виден клиенту');
  // таймер паузы — первый в очереди после таймера хода? запускаем, пока раунд не закроется
  let guard = 0;
  while (g.pendingEnd && guard++ < 5) timers.runOne();
  assert.equal(g.table.length, 0);
  assert.equal(g.discard, 2, 'бито');
  assert.equal(t.publicState(att).roundEnding, null);
});
