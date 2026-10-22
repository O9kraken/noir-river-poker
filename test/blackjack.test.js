'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { BlackjackRound, handValue, isBlackjack, newShoe } = require('../server/blackjack/engine');
const { BlackjackTable } = require('../server/blackjack/table');

// shoe is dealt from the end: list cards in dealing order and reverse
const shoeOf = (...cards) => cards.slice().reverse();

test('блэкджек: подсчёт очков и тузы', () => {
  assert.deepEqual(handValue(['As', '6d']), { total: 17, soft: true });
  assert.deepEqual(handValue(['As', '6d', 'Th']), { total: 17, soft: false });
  assert.equal(handValue(['As', 'Ad', '9h']).total, 21);
  assert.equal(handValue(['Ks', 'Qd', '5h']).total, 25);
  assert.ok(isBlackjack(['As', 'Kd']));
  assert.ok(!isBlackjack(['7s', '7d', '7h']));
  assert.equal(newShoe(6).length, 312);
});

test('блэкджек: игрок берёт и стоит, дилер добирает до 17, выплаты', () => {
  // player: 10, 6 ; dealer: 9 (up), 7 (hole) ; player hits 4 -> 20 ; dealer draws 5 -> 21
  const r = new BlackjackRound([{ seat: 0, bet: 100 }], shoeOf('Th', '9s', '6d', '7c', '4h', '5s'));
  assert.equal(r.phase, 'player');
  r.hit(0);
  assert.equal(handValue(r.players[0].hands[0].cards).total, 20);
  r.stand(0);
  assert.equal(r.phase, 'dealer');
  while (r.dealerStep());
  assert.equal(r.phase, 'done');
  assert.equal(handValue(r.dealer.cards).total, 21);
  assert.equal(r.players[0].hands[0].result, 'lose');
});

test('блэкджек: натуральный блэкджек платит 3:2, у дилера блэкджек — пик', () => {
  const r = new BlackjackRound([{ seat: 0, bet: 100 }, { seat: 1, bet: 50 }], shoeOf('As', '9d', '8c', 'Kh', '7s', '9h'));
  // seat0: A,K = BJ ; seat1: 9,7 ; dealer: 8,9
  r.stand(1);
  while (r.dealerStep());
  assert.equal(r.players[0].hands[0].result, 'blackjack');
  assert.equal(r.players[0].hands[0].payout, 250);
  assert.equal(r.players[1].hands[0].result, 'lose');
  const peek = new BlackjackRound([{ seat: 0, bet: 100 }], shoeOf('Th', 'As', '9d', 'Kc'));
  assert.equal(peek.phase, 'done', 'дилер с тузом проверил блэкджек — раунд окончен сразу');
  assert.equal(peek.players[0].hands[0].result, 'lose');
});

test('блэкджек: удвоение и сплит', () => {
  // double: player 6,5 dealer 7,T ; double gets T -> 21 ; dealer 17 stands
  const d = new BlackjackRound([{ seat: 0, bet: 100 }], shoeOf('6h', '7d', '5c', 'Ts', 'Th'));
  assert.ok(d.canDouble());
  d.double(0);
  assert.equal(d.players[0].hands[0].bet, 200);
  while (d.dealerStep());
  assert.equal(d.players[0].hands[0].result, 'win');
  assert.equal(d.players[0].hands[0].payout, 400);
  // split eights: 8,8 vs dealer 6,T ; hands get 3 and K ; both stand; dealer draws 9 -> bust
  const s = new BlackjackRound([{ seat: 0, bet: 50 }], shoeOf('8h', '6d', '8c', 'Ts', '3d', 'Kc', '9s'));
  assert.ok(s.canSplit());
  s.split(0);
  assert.equal(s.players[0].hands.length, 2);
  assert.equal(handValue(s.players[0].hands[0].cards).total, 11);
  assert.ok(s.canDouble(), 'удвоение после сплита');
  s.stand(0);
  s.stand(0);
  while (s.dealerStep());
  assert.ok(s.players[0].hands.every((hd) => hd.result === 'win'));
  // split aces get one card each, 21 is not a blackjack
  const a = new BlackjackRound([{ seat: 0, bet: 10 }], shoeOf('Ah', '6d', 'Ac', 'Ts', 'Kd', '2c', '9s'));
  a.split(0);
  assert.equal(a.phase, 'dealer', 'тузы после сплита сразу закрыты');
  while (a.dealerStep());
  assert.equal(a.players[0].hands[0].result, 'win');
  assert.equal(a.players[0].hands[0].payout, 20, '21 после сплита платит 1:1');
});

function fakeTimers() {
  let id = 0;
  const pending = new Map();
  return {
    set(fn, ms) { const k = ++id; pending.set(k, { fn, ms }); return k; },
    clear(k) { pending.delete(k); },
    runOne() { const e = pending.entries().next().value; if (!e) return false; pending.delete(e[0]); e[1].fn(); return true; },
  };
}

test('стол блэкджека: 2000 раундов — фишки сходятся с учётом выигрыша казино', () => {
  let seed = 3;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const timers = fakeTimers();
  const bal = new Map([['a', 1e6], ['b', 1e6], ['c', 1e6]]);
  let house = 0;
  const deps = {
    charge: (u, x) => { if (bal.get(u) < x) return false; bal.set(u, bal.get(u) - x); house += x; return true; },
    pay: (u, x) => { bal.set(u, bal.get(u) + x); house -= x; },
  };
  const t = new BlackjackTable({ id: 'b', name: 'B', minBet: 10, maxBet: 1000 }, deps, { timers, randomInt: (n) => Math.floor(rnd() * n) });
  t.sit('a', 'A', 0); t.sit('b', 'B', 2); t.sit('c', 'C', 4);
  let rounds = 0;
  let guard = 0;
  while (rounds < 2000 && guard++ < 200000) {
    if (t.status === 'betting' && !t._bet) {
      for (const u of ['a', 'b', 'c']) if (rnd() < 0.9) t.bet(u, 10 + Math.floor(rnd() * 10) * 10);
      if (!t._bet) continue;
    }
    const st = t.publicState('a');
    if (t.status === 'playing' && t.round.current()) {
      const cur = t.round.current();
      const u = ['a', 'b', 'c'][[0, 2, 4].indexOf(cur.seat)];
      const you = t.publicState(u).you.turn;
      const x = rnd();
      if (you.split && x < 0.3) t.act(u, 'split');
      else if (you.double && x < 0.4) t.act(u, 'double');
      else if (you.hit && handValue(cur.hand.cards).total < 17 && x < 0.9) t.act(u, 'hit');
      else if (x < 0.97) t.act(u, 'stand');
      else timers.runOne(); // тайм-аут
      continue;
    }
    if (t.status === 'result') rounds++;
    timers.runOne();
    // деньги игроков + выигрыш казино = константа
    const total = [...bal.values()].reduce((s, v) => s + v, 0) + house;
    assert.equal(total, 3e6);
    assert.ok(st);
  }
  assert.ok(rounds >= 2000, `сыграно ${rounds}`);
  // закрытие стола посреди раздачи возвращает ставки
  t.bet('a', 100); timers.runOne();
  t.destroy();
  assert.equal([...bal.values()].reduce((s, v) => s + v, 0) + house, 3e6);
});

test('стол блэкджека: ставки, лимиты, видимость карты дилера', () => {
  const timers = fakeTimers();
  const bal = new Map([['a', 500]]);
  const deps = {
    charge: (u, x) => { if (bal.get(u) < x) return false; bal.set(u, bal.get(u) - x); return true; },
    pay: (u, x) => bal.set(u, bal.get(u) + x),
  };
  const t = new BlackjackTable({ id: 'b', name: 'B', minBet: 10, maxBet: 300 }, deps, { timers });
  assert.throws(() => t.bet('a', 10), /сядьте/);
  t.sit('a', 'A', 1);
  assert.throws(() => t.bet('a', 400), /Максимальная/);
  t.bet('a', 200);
  assert.throws(() => t.bet('a', 400), /Максимальная/);
  assert.equal(bal.get('a'), 300);
  t.clearBet('a');
  assert.equal(bal.get('a'), 500);
  t.bet('a', 100);
  timers.runOne(); // все поставили — раздача
  const st = t.publicState('a');
  if (st.status === 'playing') {
    assert.equal(st.dealer.cards.length, 2);
    assert.equal(st.dealer.cards[1], null, 'закрытая карта дилера не видна');
  }
  assert.equal(st.seats[1].hands[0].cards.length, 2);
});
