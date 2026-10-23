'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TurnClock } = require('../server/turnclock');
const { ChessTable } = require('../server/chess/table');

function clockWorld() {
  let now = 0;
  const pending = new Map(); let id = 0;
  const timers = { set(fn, ms) { const k = ++id; pending.set(k, { fn, at: now + ms }); return k; }, clear(k) { pending.delete(k); } };
  const advance = (ms) => { const end = now + ms; for (;;) { const due = [...pending].filter(([, e]) => e.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!due) break; now = due[1].at; pending.delete(due[0]); due[1].fn(); } now = end; };
  return { timers, now: () => now, advance };
}

test('честные часы: время с момента показа хода, пауза при обрыве, бюджет паузы', () => {
  const w = clockWorld();
  const c = new TurnClock({ timers: w.timers, now: w.now, grace: 8000, pauseMs: 30000, awayMs: 1500 });
  let out = 0;
  const key = c.start({ seat: 2, ms: 20000, onTimeout: () => { out += 1; } });
  assert.equal(c.view().left, 20000, 'до подтверждения показываем обычное время');
  w.advance(5000); // the turn reached the player 5 s late
  assert.ok(c.seen(2, key));
  assert.ok(!c.seen(2, key), 'второй раз не считается');
  w.advance(19000);
  assert.equal(out, 0, 'у игрока полные 20 с с момента показа');
  w.advance(1500);
  assert.equal(out, 1);
  // a drop: the clock waits, then the budget runs out and the turn is played after awayMs
  c.start({ seat: 2, ms: 20000, onTimeout: () => { out += 1; } });
  c.connection(2, false);
  assert.ok(c.view().paused);
  w.advance(20000);
  c.connection(2, true); // back after 20 s of the 30 s budget
  assert.equal(c.view().paused, null);
  w.advance(27000);
  assert.equal(out, 1, 'после возвращения снова полное время');
  w.advance(2000);
  assert.equal(out, 2);
  c.start({ seat: 2, ms: 20000, connected: false, onTimeout: () => { out += 1; } });
  w.advance(10500); // the remaining 10 s of the budget
  assert.equal(out, 3, 'бюджет паузы на партию закончился');
  c.start({ seat: 2, ms: 20000, connected: false, onTimeout: () => { out += 1; } });
  w.advance(1600);
  assert.equal(out, 4, 'без бюджета — короткое ожидание');
  c.resetBudgets();
  c.start({ seat: 2, ms: 20000, connected: false, onTimeout: () => { out += 1; } });
  w.advance(29000);
  assert.equal(out, 4, 'новая партия — бюджет снова полный');
  c.stop();
});

test('шахматные часы: задержка сети возвращается, часы стоят, пока у ходящего нет связи', () => {
  const w = clockWorld();
  const t = new ChessTable({ id: 'c', name: 'C', stake: 0, clockMs: 60000 }, {}, { timers: w.timers, now: w.now, incrementMs: 0, freezeMs: 30000 });
  t.sit('a', 'A', 0); t.sit('b', 'B', 1);
  t.setReady('a', true); t.setReady('b', true);
  const white = t.colors.w === 0 ? 'a' : 'b';
  const black = white === 'a' ? 'b' : 'a';
  w.advance(5000);
  t.move(white, { from: 52, to: 36 }, 400); // e2-e4, the move spent 400 ms on the way
  assert.equal(t.clock.w, 60000 - 5000 + 400);
  // black's connection drops on their move: their clock stops
  t.setConnected(black, false);
  w.advance(20000);
  assert.equal(t.publicState(white).clock.running, null);
  assert.ok(t.publicState(white).waiting);
  assert.equal(t.clock.b, 60000);
  t.setConnected(black, true);
  w.advance(3000);
  assert.equal(t.publicState(white).clock.b, 57000, 'вернулся — часы снова идут');
  // a lag claim is capped at maxLag (1 s)
  t.move(black, { from: 12, to: 28 }, 999999);
  assert.equal(t.clock.b, 57000 + 1000);
  t.destroy();
});
