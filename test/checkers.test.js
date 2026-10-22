'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { CheckersGame, legalMoves, sqOf, name } = require('../server/checkers/engine');

const empty = () => Array(64).fill(null);
const put = (b, sq, c, k = false) => { b[typeof sq === 'string' ? toSq(sq) : sq] = { c, k }; return b; };
function toSq(n) { return sqOf(8 - Number(n[1]), 'abcdefgh'.indexOf(n[0])); }
const paths = (moves) => moves.map((m) => m.path.map(name).join(m.captures.length ? ':' : '-')).sort();

test('начальная позиция: у белых 7 ходов, у каждой стороны 12 шашек', () => {
  const g = new CheckersGame();
  assert.equal(g.count('w'), 12);
  assert.equal(g.count('b'), 12);
  assert.equal(g.legal().length, 7);
  assert.deepEqual(paths(g.legal()).slice(0, 3), ['a3-b4', 'c3-b4', 'c3-d4']);
});

test('бить обязательно, простая бьёт и назад', () => {
  const b = empty();
  put(b, 'c3', 'w'); put(b, 'd4', 'b'); put(b, 'g3', 'w'); put(b, 'f2', 'b');
  const m = legalMoves(b, 'w');
  assert.deepEqual(paths(m), ['c3:e5', 'g3:e1']);
});

test('множественное взятие нужно довести до конца', () => {
  const b = empty();
  put(b, 'a1', 'w'); put(b, 'b2', 'b'); put(b, 'd4', 'b'); put(b, 'f6', 'b');
  assert.deepEqual(paths(legalMoves(b, 'w')), ['a1:c3:e5:g7']);
});

test('турецкий удар: одну шашку нельзя бить дважды, сбитые убираются после хода', () => {
  // the white king could loop back over d4 again if pieces vanished at once
  const b = empty();
  put(b, 'a1', 'w', true); put(b, 'c3', 'b'); put(b, 'e3', 'b'); put(b, 'e5', 'b'); put(b, 'c5', 'b');
  const m = legalMoves(b, 'w');
  for (const mv of m) assert.equal(new Set(mv.captures).size, mv.captures.length);
  assert.ok(m.every((mv) => mv.captures.length <= 4));
});

test('простая, дошедшая до последней линии во время взятия, продолжает бить как дамка', () => {
  const b = empty();
  put(b, 'c7', 'w'); put(b, 'd8', null); put(b, 'b8', null);
  put(b, 'd8', null);
  // c7 x d8? no: set up c5 -> takes d6 lands e7? Use: white man on e5, black on f6 and g7? simpler:
  const b2 = empty();
  put(b2, 'f6', 'w'); put(b2, 'e7', 'b'); put(b2, 'c6', 'b');
  // f6:d8 promotes on d8, then as a king d8:b6... over c7? place black on c7 instead of c6
  const b3 = empty();
  put(b3, 'f6', 'w'); put(b3, 'e7', 'b'); put(b3, 'b6', 'b');
  const m = legalMoves(b3, 'w');
  assert.deepEqual(paths(m), ['f6:d8:a5']);
  assert.ok(m[0].promote);
});

test('дамка летает и бьёт издалека; выбирает поле, с которого взятие продолжается', () => {
  const b = empty();
  put(b, 'a1', 'w', true); put(b, 'd4', 'b'); put(b, 'g5', 'b');
  const m = legalMoves(b, 'w');
  // after d4 the king must land on f6? no: from e5 it can hit f6? Only landing e5 continues (e5 -> g5? not diagonal). Check concretely:
  assert.ok(m.length >= 1);
  for (const mv of m) assert.equal(mv.path[0], toSq('a1'));
  const b2 = empty();
  put(b2, 'a1', 'w', true); put(b2, 'c3', 'b'); put(b2, 'f6', 'w');
  // a1 x c3 lands on d4 or e5 (f6 is own piece)
  assert.deepEqual(paths(legalMoves(b2, 'w')).filter((p) => p.startsWith('a1')), ['a1:d4', 'a1:e5']);
  const b3 = empty();
  put(b3, 'a1', 'w', true); put(b3, 'c3', 'b'); put(b3, 'f4', 'b');
  // only e5 lets it continue (e5 -> f4 -> g3/h2)
  assert.deepEqual(paths(legalMoves(b3, 'w')), ['a1:e5:g3', 'a1:e5:h2']);
});

test('партия: ход вне правил отклоняется, победа при отсутствии ходов', () => {
  const g = new CheckersGame();
  assert.throws(() => g.play('b', [toSq('b6'), toSq('a5')]), /соперника/);
  assert.throws(() => g.play('w', [toSq('c3'), toSq('c4')]), /нельзя/);
  g.play('w', [toSq('c3'), toSq('d4')]);
  g.play('b', [toSq('f6'), toSq('e5')]);
  assert.throws(() => g.play('w', [toSq('a3'), toSq('b4')]), /Бить обязательно/);
  g.play('w', [toSq('d4'), toSq('f6')]);
  assert.equal(g.count('b'), 11);
  assert.match(g.moves[2].text, /d4:f6/);
  const g2 = new CheckersGame();
  g2.board = put(empty(), 'a1', 'w');
  g2.board[toSq('a1')] = null; put(g2.board, 'c3', 'w'); put(g2.board, 'd4', 'b');
  g2._legal = null;
  g2.play('w', [toSq('c3'), toSq('e5')]);
  assert.deepEqual(g2.result, { winner: 'w', reason: 'captured' });
});
