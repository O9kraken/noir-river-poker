'use strict';
/**
 * Long nardy computer player: tries every complete way to play the throw and scores the resulting position.
 * The score weighs the race (pip count), progress home, blocks in the opponent's way and flexibility.
 * Levels differ by how much randomness is mixed into the choice.
 */
const { sequences, abs, other } = require('../nardy/engine');

/** Each side has left the other's half: nothing can block anymore, it is a pure race. */
function separated(pos) {
  for (const c of ['w', 'b']) for (let p = 13; p <= 24; p++) if (pos.at(c, p)) return false;
  return true;
}

function evaluate(pos, c) {
  const e = other(c);
  let s = (pos.pips(e) - pos.pips(c)) * 1.0 + pos.off[c] * 6 - pos.off[e] * 6;
  if (separated(pos)) return s; // pure race
  let points = 0; let run = 0; let bestRun = 0; let stackPen = 0; let blocks = 0;
  for (let p = 23; p >= 1; p--) {
    const n = pos.at(c, p);
    if (n) {
      points += 1; run += 1; bestRun = Math.max(bestRun, run);
      if (n > 3) stackPen += n - 3;
      // points in the enemy's first half (its own 13..23) get in the way of its exit from the head
      const eq = (() => { const i = abs(c, p); return e === 'w' ? i + 1 : ((i + 12) % 24) + 1; })();
      if (eq >= 13 && eq <= 23) blocks += 1;
    } else run = 0;
  }
  s += Math.min(points, 9) * 2.2 + bestRun * bestRun * 0.9 + blocks * 2.6 - stackPen * 1.1;
  // leaving the head early keeps the game flowing
  s -= Math.max(0, pos.at(c, 24) - 1) * 0.6;
  return s;
}

/** The list of single moves the bot plays this turn. */
function chooseTurn(game, level = 'normal', rng = Math.random) {
  const c = game.turn;
  const seqs = sequences(game.pos, c, game.left, game.ctx);
  if (!seqs.length || !seqs[0].moves.length) return [];
  if (level === 'easy' && rng() < 0.35) return seqs[Math.floor(rng() * seqs.length)].moves;
  const noise = level === 'easy' ? 14 : level === 'normal' ? 3 : 0;
  let best = null; let bestScore = -Infinity;
  for (const sq of seqs) {
    const v = evaluate(sq.pos, c) + (noise ? (rng() - 0.5) * noise : 0);
    if (v > bestScore) { bestScore = v; best = sq; }
  }
  return best.moves;
}

module.exports = { chooseTurn, evaluate };
