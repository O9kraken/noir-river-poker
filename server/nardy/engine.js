'use strict';
/**
 * Long nardy (длинные нарды), the Russian rules.
 *
 * Board: 24 points, absolute index 0..23. Each side counts its own points 24 → 1:
 * white's point p is index p-1, black's point p is index (p+11) % 24. Both start with 15 checkers
 * on their point 24 (the "head") and move the same way round the board, home is own points 1–6.
 *
 *  - no hitting: a point with even one enemy checker is closed;
 *  - one checker per turn may leave the head; on a side's first throw 6-6, 4-4 or 3-3 allow two;
 *  - doubles are played four times;
 *  - both dice must be used when possible; if only one can, the larger one if possible;
 *  - six own points in a row are allowed only if at least one enemy checker is already past them;
 *  - bearing off once all 15 are home: by the exact number, or a larger die from the highest point.
 *  - The winner bears off all 15; if the loser has borne off none it is a "mars".
 */
const other = (c) => (c === 'w' ? 'b' : 'w');
const abs = (c, p) => (c === 'w' ? p - 1 : (p + 11) % 24);
const own = (c, i) => (c === 'w' ? i + 1 : ((i + 12) % 24) + 1);

class NardyPosition {
  constructor() {
    this.c = new Array(24).fill(null); // 'w' | 'b' | null
    this.n = new Array(24).fill(0);
    this.off = { w: 0, b: 0 };
  }
  static start() {
    const p = new NardyPosition();
    p.c[abs('w', 24)] = 'w'; p.n[abs('w', 24)] = 15;
    p.c[abs('b', 24)] = 'b'; p.n[abs('b', 24)] = 15;
    return p;
  }
  clone() {
    const p = new NardyPosition();
    p.c = this.c.slice(); p.n = this.n.slice(); p.off = { ...this.off };
    return p;
  }
  key() { let s = ''; for (let i = 0; i < 24; i++) s += this.n[i] ? (this.c[i] + this.n[i]) : '.'; return s + this.off.w + ':' + this.off.b; }
  at(c, p) { const i = abs(c, p); return this.c[i] === c ? this.n[i] : 0; }
  /** Own points of colour c that hold its checkers, highest first. */
  points(c) { const out = []; for (let p = 24; p >= 1; p--) if (this.at(c, p)) out.push(p); return out; }
  allHome(c) { let n = this.off[c]; for (let p = 1; p <= 6; p++) n += this.at(c, p); return n === 15; }
  pips(c) { let s = 0; for (let p = 1; p <= 24; p++) s += this.at(c, p) * p; return s; }
  /** Six own points in a row with no enemy checker already past them. */
  badBlock(c) {
    const e = other(c);
    // in the enemy's own coordinates, my points form a run; the enemy has "passed" a run if it has checkers with smaller coordinates
    let run = 0;
    let lowestEnemy = 25;
    for (let q = 1; q <= 24; q++) if (this.c[abs(e, q)] === e) { lowestEnemy = q; break; }
    if (this.off[e]) lowestEnemy = 0;
    for (let q = 24; q >= 1; q--) {
      const i = abs(e, q);
      if (this.c[i] === c) {
        run += 1;
        if (run >= 6) {
          const low = q; // the run spans q .. q+5 in enemy coordinates
          if (!(lowestEnemy < low)) return true;
        }
      } else run = 0;
    }
    return false;
  }
}

/** The single step "move a checker of c from own point `from` by die d", or null if not allowed. */
function step(pos, c, from, d, ctx) {
  if (!pos.at(c, from)) return null;
  if (from === 24 && ctx.head >= ctx.headLimit) return null;
  const to = from - d;
  if (to >= 1) {
    const i = abs(c, to);
    if (pos.c[i] && pos.c[i] !== c) return null;
  } else {
    if (!pos.allHome(c)) return null;
    if (to < 0) { for (let p = from + 1; p <= 6; p++) if (pos.at(c, p)) return null; }
  }
  const nx = pos.clone();
  const fi = abs(c, from);
  nx.n[fi] -= 1; if (!nx.n[fi]) nx.c[fi] = null;
  if (to >= 1) { const ti = abs(c, to); nx.c[ti] = c; nx.n[ti] += 1; } else nx.off[c] += 1;
  if (to >= 1 && nx.badBlock(c)) return null;
  return { pos: nx, move: { from, to: Math.max(0, to), die: d }, head: ctx.head + (from === 24 ? 1 : 0) };
}

const without = (dice, d) => { const k = dice.indexOf(d); return dice.slice(0, k).concat(dice.slice(k + 1)); };

/** How many more dice can still be played from here (memoised per turn). */
function maxDepth(pos, c, dice, ctx, memo) {
  if (!dice.length) return 0;
  const key = pos.key() + '|' + dice.join('') + '|' + ctx.head;
  if (memo.has(key)) return memo.get(key);
  let best = 0;
  for (const d of new Set(dice)) {
    for (const from of pos.points(c)) {
      const r = step(pos, c, from, d, ctx);
      if (!r) continue;
      // bearing off the last checker ends the game: that counts as playing the whole throw
      const v = r.pos.off[c] === 15 ? dice.length : 1 + maxDepth(r.pos, c, without(dice, d), { ...ctx, head: r.head }, memo);
      if (v > best) best = v;
      if (best === dice.length) break;
    }
    if (best === dice.length) break;
  }
  memo.set(key, best);
  return best;
}

/** Every complete way to play the throw (deduplicated by the final position). */
function sequences(pos, c, dice, ctx) {
  const memo = new Map();
  const need = maxDepth(pos, c, dice, ctx, memo);
  const out = new Map();
  const walk = (p, left, cx, path) => {
    if (path.length === need || (path.length && p.off[c] === 15)) { const k = p.key(); if (!out.has(k)) out.set(k, { moves: path, pos: p }); return; }
    for (const d of new Set(left)) {
      for (const from of p.points(c)) {
        const r = step(p, c, from, d, cx);
        if (!r) continue;
        const nl = without(left, d);
        const ncx = { ...cx, head: r.head };
        if (r.pos.off[c] !== 15 && path.length + 1 + maxDepth(r.pos, c, nl, ncx, memo) < need) continue;
        walk(r.pos, nl, ncx, path.concat([r.move]));
      }
    }
  };
  walk(pos, dice, ctx, []);
  let list = [...out.values()];
  // only one die playable out of two different ones: the larger, if it can be played
  if (need === 1 && dice.length === 2 && dice[0] !== dice[1]) {
    const big = Math.max(...dice);
    if (list.some((s) => s.moves[0].die === big)) list = list.filter((s) => s.moves[0].die === big);
  }
  return list;
}

class NardyGame {
  constructor(first = 'w', rng = Math.random) {
    this.pos = NardyPosition.start();
    this.turn = first;
    this.rng = rng;
    this.dice = null;          // the throw, e.g. [6, 3]
    this.left = [];            // dice still to play this turn
    this.played = [];          // moves made this turn
    this.turnStart = null;     // snapshot for undo
    this.firstThrow = { w: true, b: true };
    this.ctx = null;
    this.need = 0;
    this.moves = [];           // history: { color, dice, moves }
    this.result = null;
    this.lastTurn = null;
  }

  roll(forced) {
    if (this.result) throw new Error('Партия окончена');
    if (this.dice) throw new Error('Кубики уже брошены');
    const a = forced ? forced[0] : 1 + Math.floor(this.rng() * 6);
    const b = forced ? forced[1] : 1 + Math.floor(this.rng() * 6);
    this.dice = [a, b];
    this.left = a === b ? [a, a, a, a] : [a, b];
    const special = this.firstThrow[this.turn] && a === b && [6, 4, 3].includes(a);
    this.ctx = { head: 0, headLimit: special ? 2 : 1 };
    this.firstThrow[this.turn] = false;
    this.played = [];
    this.turnStart = { pos: this.pos.clone(), left: this.left.slice(), ctx: { ...this.ctx } };
    this._refresh();
    return this.dice;
  }

  _refresh() {
    this._legal = null;
    this.seqs = sequences(this.pos, this.turn, this.left, this.ctx);
    this.need = this.left.length ? maxDepth(this.pos, this.turn, this.left, this.ctx, new Map()) : 0;
  }

  /** Single steps that keep a full-length play possible (in any order of the dice). */
  legal() {
    if (!this.dice || this.result || !this.need) return [];
    if (this._legal) return this._legal;
    const memo = new Map();
    const out = [];
    let dice = [...new Set(this.left)];
    // only one of two different dice can be played: the larger, if possible
    if (this.need === 1 && this.left.length === 2 && this.left[0] !== this.left[1]) {
      const big = Math.max(...this.left);
      if (this.seqs.some((s) => s.moves[0].die === big)) dice = [big];
    }
    for (const d of dice) {
      for (const from of this.pos.points(this.turn)) {
        const r = step(this.pos, this.turn, from, d, this.ctx);
        if (!r) continue;
        const full = r.pos.off[this.turn] === 15 ? this.left.length : 1 + maxDepth(r.pos, this.turn, without(this.left, d), { ...this.ctx, head: r.head }, memo);
        if (full === this.need) out.push(r.move);
      }
    }
    this._legal = out;
    return out;
  }

  /** Is the turn over (all playable dice used)? */
  done() { return !!this.dice && this.need === 0; }

  play(color, from, die) {
    if (this.result) throw new Error('Партия окончена');
    if (color !== this.turn) throw new Error('Сейчас не ваш ход');
    if (!this.dice) throw new Error('Сначала бросьте кубики');
    const m = this.legal().find((x) => x.from === from && x.die === die);
    if (!m) throw new Error('Так ходить нельзя');
    const r = step(this.pos, color, from, die, this.ctx);
    this.pos = r.pos;
    this.ctx = { ...this.ctx, head: r.head };
    this.left = without(this.left, die);
    this.played.push(r.move);
    if (this.pos.off[color] === 15) {
      this._closeTurn();
      this.result = { winner: color, reason: this.pos.off[other(color)] === 0 ? 'mars' : 'oin' };
      return r.move;
    }
    this._refresh();
    return r.move;
  }

  undo(color) {
    if (color !== this.turn || !this.played.length || this.result) throw new Error('Нечего отменять');
    const keep = this.played.slice(0, -1);
    this.pos = this.turnStart.pos.clone();
    this.left = this.turnStart.left.slice();
    this.ctx = { ...this.turnStart.ctx };
    this.played = [];
    for (const m of keep) {
      const r = step(this.pos, color, m.from, m.die, this.ctx);
      this.pos = r.pos; this.ctx = { ...this.ctx, head: r.head }; this.left = without(this.left, m.die); this.played.push(r.move);
    }
    this._refresh();
  }

  /** Close the turn once nothing is left to play; the other side throws next. */
  endTurn() {
    if (!this.done()) throw new Error('Ход ещё не сделан');
    this._closeTurn();
    this.turn = other(this.turn);
  }

  _closeTurn() {
    this.lastTurn = { color: this.turn, dice: this.dice, moves: this.played.slice() };
    this.moves.push(this.lastTurn);
    this.dice = null; this.left = []; this.played = []; this.seqs = []; this.need = 0; this.turnStart = null; this._legal = null;
  }

  finish(winner, reason) { if (!this.result) this.result = { winner, reason }; }
  /** The shared two-player table shell reads these; nardy keeps its own state in pos. */
  get board() { return []; }
}

module.exports = { NardyGame, NardyPosition, sequences, step, maxDepth, abs, own, other };
