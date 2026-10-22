'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { score5, bestHoldem, bestOmaha } = require('../server/engine/evaluator');
const { Table } = require('../server/engine/table');

// ---------- evaluator ----------

const s5 = (str) => score5(str.split(' '));

test('категории рук распознаются', () => {
  assert.equal(s5('As Ks Qs Js Ts').category, 9);
  assert.equal(s5('9s 8s 7s 6s 5s').category, 8);
  assert.equal(s5('9s 9h 9d 9c 5s').category, 7);
  assert.equal(s5('9s 9h 9d 5c 5s').category, 6);
  assert.equal(s5('As 9s 7s 4s 2s').category, 5);
  assert.equal(s5('Ah 2s 3d 4c 5s').category, 4); // колесо
  assert.equal(s5('9s 9h 9d Kc 5s').category, 3);
  assert.equal(s5('9s 9h Kd Kc 5s').category, 2);
  assert.equal(s5('9s 9h Kd Qc 5s').category, 1);
  assert.equal(s5('As Jh 9d 7c 5s').category, 0);
});

test('сравнение рук и кикеры', () => {
  assert.ok(s5('Ah 2s 3d 4c 5s').score < s5('2h 3s 4d 5c 6s').score, 'колесо младше стрита до шестёрки');
  assert.ok(s5('Ks Kh Ad 7c 5s').score > s5('Ks Kh Qd Jc Ts').score, 'кикер туз');
  assert.ok(s5('As Ah 3d 3c Ks').score > s5('Ks Kh Qd Qc As').score, 'старшая пара решает');
  assert.equal(s5('As Ah 3d 3c Ks').score, s5('Ad Ac 3h 3s Kd').score);
  assert.ok(s5('2s 2h 2d 3c 3s').score > s5('As Ks Qs Js 9s').score, 'фулл-хаус > флеш');
  assert.ok(s5('9s 8s 7s 6s 5s').score < s5('As Ks Qs Js Ts').score);
});

test('Холдем: лучшая из 7 карт', () => {
  const r = bestHoldem(['Ah', 'Kh'], ['Qh', 'Jh', 'Th', '2c', '3d']);
  assert.equal(r.name, 'Роял-флеш');
  const board = bestHoldem(['2c', '3d'], ['As', 'Ks', 'Qs', 'Js', 'Ts']);
  assert.equal(board.name, 'Роял-флеш', 'можно играть бордом');
});

test('Омаха: ровно 2 карты с руки и 3 с борда', () => {
  // На борде 4 пики, у игрока одна пика — флеша нет
  const r = bestOmaha(['As', 'Kd', 'Qc', 'Jh'], ['2s', '5s', '8s', 'Ts', '3h']);
  assert.notEqual(r.name, 'Флеш');
  // В Холдеме здесь был бы фулл-хаус (999 + 22), в Омахе нужно 4 карты борда — только сет
  const r2 = bestOmaha(['2d', 'Kd', 'Qc', 'Jh'], ['9s', '9h', '9d', '2c', '3h']);
  assert.equal(r2.name, 'Сет');
  assert.equal(bestHoldem(['2d', 'Kd'], ['9s', '9h', '9d', '2c', '3h']).name, 'Фулл-хаус');
  const r3 = bestOmaha(['As', 'Ks', 'Qc', 'Jh'], ['2s', '5s', '8s', 'Td', '3h']);
  assert.equal(r3.name, 'Флеш');
});

// ---------- table helpers ----------

function fakeTimers() {
  let id = 0;
  const pending = new Map();
  return {
    set(fn, ms) { const k = ++id; pending.set(k, { fn, ms }); return k; },
    clear(k) { pending.delete(k); },
    runAll() { let guard = 0; while (pending.size && guard++ < 1000) { const [k, t] = pending.entries().next().value; pending.delete(k); t.fn(); } },
    runOne() { const e = pending.entries().next().value; if (!e) return false; pending.delete(e[0]); e[1].fn(); return true; },
    get size() { return pending.size; },
  };
}

function riggedShuffle(order) {
  // deck.pop() deals from the end: put cards to deal at the end, in reverse
  return (deck) => {
    const rest = deck.filter((c) => !order.includes(c));
    return [...rest, ...order.slice().reverse()];
  };
}

function makeTable(cfg, extra = {}) {
  const timers = fakeTimers();
  const left = [];
  const t = new Table({ id: 't', name: 'T', game: 'NLH', sb: 10, bb: 20, maxSeats: 6, minBuyIn: 100, maxBuyIn: 100000, ...cfg },
    { timers, onLeave: (u, st) => left.push([u, st]), ...extra });
  return { t, timers, left };
}

test('блайнды, порядок хода и выигрыш без вскрытия', () => {
  const { t, timers } = makeTable();
  t.sit('a', 'A', 0, 1000);
  t.sit('b', 'B', 1, 1000);
  t.sit('c', 'C', 2, 1000);
  timers.runOne(); // старт раздачи
  assert.equal(t.dealer, 0);
  assert.equal(t.seats[1].bet, 10);
  assert.equal(t.seats[2].bet, 20);
  assert.equal(t.hand.toAct, 0, 'первым ходит UTG (здесь баттон)');
  t.act('a', 'fold');
  t.act('b', 'raise', 60);
  t.act('c', 'fold');
  assert.equal(t.seats[1].stack, 1020, 'B выигрывает блайнды, лишняя ставка возвращена');
  assert.equal(t.seats[2].stack, 980);
});

test('хедз-ап: баттон ставит SB и ходит первым на префлопе', () => {
  const { t, timers } = makeTable();
  t.sit('a', 'A', 0, 1000);
  t.sit('b', 'B', 3, 1000);
  timers.runOne();
  assert.equal(t.hand.sbIdx, t.dealer);
  assert.equal(t.hand.toAct, t.dealer);
  t.act(t.seats[t.dealer].userId, 'call');
  const bb = t.hand.bbIdx;
  assert.equal(t.hand.toAct, bb, 'у BB остаётся опцион');
  t.act(t.seats[bb].userId, 'check');
  assert.equal(t.hand.street, 'flop');
  assert.equal(t.hand.toAct, bb, 'постфлоп первым ходит BB');
});

test('минимальный рейз и неполный олл-ин не открывает торговлю', () => {
  const { t, timers } = makeTable();
  t.sit('a', 'A', 0, 1000);
  t.sit('b', 'B', 1, 1000);
  t.sit('c', 'C', 2, 130);
  timers.runOne();
  // a — UTG/баттон, b — SB, c — BB
  assert.throws(() => t.act('a', 'raise', 30), /от 40/);
  t.act('a', 'raise', 100); // рейз на 80
  t.act('b', 'call');
  t.act('c', 'allin'); // до 130: доплата 30 < 80 — неполный рейз
  const st = t.publicState('a');
  assert.equal(st.you.turn.canRaise, false, 'A не может перерейзить после неполного олл-ина');
  assert.equal(st.you.turn.toCall, 30);
  t.act('a', 'call');
  t.act('b', 'call');
  assert.equal(t.hand.street, 'flop');
});

test('пот-лимит Омахи ограничивает рейз размером банка', () => {
  const { t, timers } = makeTable({ game: 'PLO' });
  t.sit('a', 'A', 0, 5000);
  t.sit('b', 'B', 1, 5000);
  t.sit('c', 'C', 2, 5000);
  timers.runOne();
  assert.equal(t.seats[0].hole.length, 4);
  // банк 30, колл 20 → пот-рейз до 20 + 30 + 20 = 70
  assert.equal(t.publicState('a').you.turn.maxTo, 70);
  assert.throws(() => t.act('a', 'raise', 80));
  t.act('a', 'raise', 70);
  // SB: банк 100, колл 60 → до 70 + 100 + 60 = 230
  assert.equal(t.publicState('b').you.turn.maxTo, 230);
});

test('побочные банки при нескольких олл-инах', () => {
  const { t, timers } = makeTable({}, {
    // A — лучшая рука, но маленький стек; B — вторая; C — худшая
    shuffle: riggedShuffle([
      // раздача начинается слева от баттона (0): места 1, 2, 0, 1, 2, 0
      'Kd', 'Qc', 'As', 'Kh', '2c', 'Ah',
      '3d', '7s', '8h', 'Jc', '4d', '5c', '9d', '6h', // сжигания и борд
    ]),
  });
  t.dealer = 2; // следующий баттон — место 0
  t.sit('a', 'A', 0, 100);
  t.sit('b', 'B', 1, 300);
  t.sit('c', 'C', 2, 1000);
  timers.runOne();
  // баттон 0, SB 1, BB 2. Раздача: 1, 2, 0, 1, 2, 0
  const hole = t.seats.map((s) => s && s.hole.join(''));
  t.act('a', 'allin');
  t.act('b', 'allin');
  t.act('c', 'call');
  while (!t.hand.ended) timers.runOne(); // доезд борда
  const r = t.lastResult;
  assert.ok(r && r.showdown);
  assert.equal(r.pots.length, 2, `банки: ${JSON.stringify(r.pots)} руки ${hole}`);
  assert.equal(r.pots[0].amount, 300);
  assert.equal(r.pots[1].amount, 400);
  const total = t.seats.reduce((x, s) => x + (s ? s.stack : 0), 0) + 0;
  // фишки сохраняются (за вычетом ушедших никого нет)
  assert.equal(total, 1400);
});

test('ничья делит банк, нечётная фишка — первому слева от баттона', () => {
  const { t, timers } = makeTable({ sb: 5, bb: 10 }, {
    // у обоих одинаковый стрит на борде
    shuffle: riggedShuffle(['2c', '2d', '3c', '3d', '4c', '4h', '5d', 'Ts', 'Js', 'Qd', '6d', 'Kh', '7d', 'Ah']),
  });
  t.sit('a', 'A', 0, 1000);
  t.sit('b', 'B', 1, 1000);
  t.sit('c', 'C', 2, 1000);
  timers.runOne();
  t.act('a', 'fold');
  t.act('b', 'call');
  t.act('c', 'check');
  while (t.hand && !t.hand.ended) {
    const who = t.seats[t.hand.toAct].userId;
    t.act(who, 'check');
  }
  const r = t.lastResult;
  assert.equal(r.pots[0].winners.length, 2, JSON.stringify(r));
  assert.equal(t.seats[1].stack + t.seats[2].stack, 2000);
});

test('тайм-аут: чек или фолд и пропуск следующих раздач', () => {
  const { t, timers } = makeTable();
  t.sit('a', 'A', 0, 1000);
  t.sit('b', 'B', 1, 1000);
  t.sit('c', 'C', 2, 1000);
  timers.runOne();
  assert.equal(t.hand.toAct, 0);
  timers.runOne(); // таймер хода A
  assert.equal(t.seats[0].folded, true);
  assert.equal(t.seats[0].sittingOut, true);
});

test('уход из-за стола посреди раздачи не теряет фишки', () => {
  const { t, timers, left } = makeTable();
  t.sit('a', 'A', 0, 1000);
  t.sit('b', 'B', 1, 1000);
  t.sit('c', 'C', 2, 1000);
  timers.runOne();
  t.act('a', 'raise', 100);
  t.standUp('b'); // SB уходит не в свой ход
  t.act('c', 'call');
  t.standUp('a'); // A уходит на флопе
  timers.runAll();
  const onTable = t.seats.reduce((x, s) => x + (s ? s.stack : 0), 0);
  const gone = left.reduce((x, [, st]) => x + st, 0);
  assert.equal(onTable + gone, 3000);
});

// ---------- randomized simulation ----------

test('симуляция 3000 раздач: фишки сохраняются, инварианты соблюдаются', () => {
  for (const game of ['NLH', 'PLO']) {
    let seed = 42;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const { t, timers, left } = makeTable({ game, maxSeats: 6, sb: 5, bb: 10, minBuyIn: 50, maxBuyIn: 5000 });
    const users = ['u0', 'u1', 'u2', 'u3', 'u4', 'u5'];
    let bank = 0; // фишки, принесённые за стол
    users.forEach((u, i) => { const b = 200 + Math.floor(rnd() * 1500); bank += b; t.sit(u, u, i, b); });
    let hands = 0;
    let steps = 0;
    while (hands < 1500 && steps++ < 200000) {
      if (t.hand && !t.hand.ended && t.hand.toAct !== -1) {
        const uid = t.seats[t.hand.toAct].userId;
        const turn = t.publicState(uid).you.turn;
        // ни один игрок не видит чужие карты
        const view = t.publicState(uid);
        view.seats.forEach((s, i) => { if (s && i !== view.mySeat && s.cards) assert.ok(t.seats[i].revealed); });
        const x = rnd();
        if (x < 0.02) { timers.runOne(); continue; } // тайм-аут
        if (x < 0.2) t.act(uid, 'fold');
        else if (x < 0.55) t.act(uid, turn.canCheck ? 'check' : 'call');
        else if (turn.canRaise && x < 0.9) {
          const amt = turn.minTo + Math.floor(rnd() * (turn.maxTo - turn.minTo + 1));
          t.act(uid, 'raise', amt);
        } else t.act(uid, 'allin');
        const h = t.hand;
        if (h && !h.ended) {
          const chips = t.chipsOnTable();
          const gone = left.reduce((s, [, st]) => s + st, 0);
          assert.equal(chips + gone, bank, `сохранение фишек в процессе (${game})`);
        }
      } else {
        if (t.hand && t.hand.ended) hands++;
        // вернуть всех в игру и докупить разорившихся
        t.seats.forEach((s) => {
          if (!s) return;
          if (s.stack < 50 && !(t.hand && s.inHand && !t.hand.ended)) {
            if (!(t.hand && !t.hand.ended)) { const add = 500; t.addChips(s.userId, add); bank += add; }
          }
          if (s.sittingOut && s.stack > 0) t.setSittingOut(s.userId, false);
        });
        if (!timers.runOne()) break;
      }
      for (const s of t.seats) if (s) assert.ok(s.stack >= 0, 'отрицательный стек');
    }
    assert.ok(hands >= 1500, `сыграно ${hands} раздач (${game})`);
    const onTable = t.seats.reduce((x, s) => x + (s ? s.stack : 0), 0);
    const gone = left.reduce((s, [, st]) => s + st, 0);
    if (!t.hand || t.hand.ended) assert.equal(onTable + gone, bank, `итоговое сохранение фишек (${game})`);
  }
});

// ---------- tournament mode, history, show cards ----------

test('турнирный стол: блайнды растут, вылеты ранжируются, конец турнира', () => {
  const timers = fakeTimers();
  const busts = [];
  let ended = false;
  const t = new Table({ id: 's', name: 'SNG', game: 'NLH', sb: 10, bb: 20, maxSeats: 3 }, {
    timers, tournament: true,
    onBust: (list) => busts.push(...list.map((b) => b.name)),
    onTournamentEnd: () => { ended = true; },
  });
  assert.throws(() => t.sit('x', 'X', 0, 1000), /турнир/);
  t.seatDirect('a', 'A', 0, 100);
  t.seatDirect('b', 'B', 1, 300);
  t.seatDirect('c', 'C', 2, 600);
  t.setBlinds(25, 50);
  t.start();
  timers.runOne();
  assert.equal(t.bb, 50, 'новые блайнды со следующей раздачи');
  assert.throws(() => t.standUp('a'), /нельзя выйти/);
  assert.throws(() => t.addChips('a', 100), /докупки нет/);
  let guard = 0;
  while (!ended && guard++ < 5000) {
    if (t.hand && !t.hand.ended && t.hand.toAct !== -1) t.act(t.seats[t.hand.toAct].userId, 'allin');
    else if (!timers.runOne()) break;
  }
  assert.ok(ended, 'турнир завершился');
  assert.equal(busts.length, 2);
  assert.equal(t.playerCount(), 1);
  const winner = t.seats.find(Boolean);
  assert.equal(winner.stack, 1000, 'все фишки у победителя');
});

test('турнир: отошедший игрок остаётся в раздачах и ходит автоматически', () => {
  const timers = fakeTimers();
  const t = new Table({ id: 's', name: 'SNG', game: 'NLH', sb: 10, bb: 20, maxSeats: 2 }, { timers, tournament: true, autoActDelay: 5 });
  t.seatDirect('a', 'A', 0, 1000);
  t.seatDirect('b', 'B', 1, 1000);
  t.start();
  timers.runOne();
  t.setSittingOut(t.seats[t.hand.toAct].userId, true);
  const absent = t.hand.toAct;
  // таймер текущего хода уже стоит на обычное время; следующий ход отошедшего — авто
  timers.runOne();
  assert.ok(t.seats[absent].folded || t.hand.ended, 'отошедший сбросил');
  assert.equal(t.publicState('a').seats[absent].sittingOut, true);
});

test('история раздачи и повтор скрывают чужие карты; показ карт после раздачи', () => {
  const { t, timers } = makeTable();
  t.sit('a', 'A', 0, 1000);
  t.sit('b', 'B', 1, 1000);
  t.sit('c', 'C', 2, 1000);
  timers.runOne();
  t.act('a', 'raise', 60);
  t.act('b', 'fold');
  t.act('c', 'fold');
  assert.ok(t.hand.ended);
  const list = t.historyList('a');
  assert.equal(list.length, 1);
  assert.equal(list[0].myNet, 30, 'A выиграл блайнды');
  const rpB = t.replay('b', 1);
  const aInB = rpB.events[0].players.find((p) => p.seat === 0);
  assert.equal(aInB.cards, null, 'B не видит карты A в повторе');
  assert.ok(rpB.events[0].players.find((p) => p.seat === 1).cards, 'свои карты видны');
  assert.ok(rpB.events.length >= 4);
  // A показывает карты
  assert.equal(t.publicState('a').you.canShow, true);
  t.showCards('a');
  assert.deepEqual(t.publicState('b').seats[0].cards, t.seats[0].hole);
  assert.ok(t.replay('b', 1).events[0].players.find((p) => p.seat === 0).cards, 'после показа видны и в повторе');
  assert.throws(() => t.replay('a', 99), /не найдена/);
});

test('кэш-стол: блайнды растут каждые N раздач и сбрасываются, когда стол пустеет', () => {
  const { t, timers } = makeTable({ sb: 5, bb: 10, blindsEvery: 2 });
  t.sit('a', 'A', 0, 2000);
  t.sit('b', 'B', 1, 2000);
  const playHand = () => {
    timers.runOne(); // старт
    t.act(t.seats[t.hand.toAct].userId, 'fold');
    timers.runOne(); // пауза после раздачи
  };
  playHand();
  assert.equal(t.bb, 10);
  assert.equal(t.blindInfo().nextAtHand, 3);
  playHand();
  assert.equal(t.bb, 10, 'раздачи 1–2 на первом уровне');
  timers.runOne();
  assert.equal(t.handNo, 3);
  assert.equal(t.bb, 20, 'с 3-й раздачи блайнды выше');
  assert.equal(t.sb, 10);
  assert.equal(t.publicState('a').blinds.level, 2);
  t.act(t.seats[t.hand.toAct].userId, 'fold');
  timers.runOne();
  t.standUp('a');
  t.standUp('b');
  assert.equal(t.bb, 10, 'пустой стол вернулся к базовым блайндам');
  assert.equal(t.blindInfo().level, 1);
});

test('турнир: уровни по раздачам', () => {
  const timers = fakeTimers();
  const t = new Table({ id: 's', name: 'S', game: 'NLH', sb: 10, bb: 20, maxSeats: 2, blindsEvery: 1, levels: [[10, 20], [15, 30], [25, 50]] }, { timers, tournament: true });
  t.seatDirect('a', 'A', 0, 5000);
  t.seatDirect('b', 'B', 1, 5000);
  t.start();
  const bbs = [];
  for (let k = 0; k < 4; k++) {
    timers.runOne();
    bbs.push(t.bb);
    t.act(t.seats[t.hand.toAct].userId, 'fold');
    timers.runOne();
  }
  assert.deepEqual(bbs, [20, 30, 50, 50], 'каждую раздачу новый уровень, на последнем остаёмся');
});

test('счётчик рейзов: опен — 2-бет, ререйз — 3-бет', () => {
  const { t, timers } = makeTable();
  t.sit('a', 'A', 0, 5000); t.sit('b', 'B', 1, 5000); t.sit('c', 'C', 2, 5000);
  timers.runOne();
  assert.equal(t.publicState('a').raises, 1, 'большой блайнд — первая ставка');
  t.act('a', 'raise', 60);
  assert.equal(t.publicState('b').raises, 2, 'опен');
  t.act('b', 'raise', 180);
  assert.equal(t.publicState('c').raises, 3, '3-бет');
  t.act('c', 'fold'); t.act('a', 'call');
  assert.equal(t.hand.street, 'flop');
  assert.equal(t.publicState('a').raises, 0, 'на новой улице счёт заново');
});
