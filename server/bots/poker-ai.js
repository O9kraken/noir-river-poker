'use strict';
/**
 * Poker opponent for practice tables: Monte-Carlo equity against the live opponents,
 * then a pot-odds decision with a bit of aggression and the odd bluff.
 */
const { newDeck } = require('../engine/cards');
const { bestHand } = require('../engine/evaluator');
const { GAMES } = require('../engine/games');

function equity(game, hole, board, opponents, iterations, random = Math.random) {
  const g = GAMES[game] || GAMES.NLH;
  const known = new Set([...hole, ...board]);
  const deck = newDeck(g.deck === 'short').filter((c) => !known.has(c));
  const need = 5 - board.length;
  let score = 0;
  for (let it = 0; it < iterations; it++) {
    // partial Fisher–Yates: only as many cards as this run needs
    const d = deck.slice();
    const take = need + opponents * g.hole;
    for (let k = 0; k < take; k++) {
      const j = k + Math.floor(random() * (d.length - k));
      [d[k], d[j]] = [d[j], d[k]];
    }
    const full = board.concat(d.slice(0, need));
    const mine = bestHand(game, hole, full).score;
    let best = true;
    let ties = 0;
    for (let o = 0; o < opponents; o++) {
      const oh = d.slice(need + o * g.hole, need + (o + 1) * g.hole);
      const s = bestHand(game, oh, full).score;
      if (s > mine) { best = false; break; }
      if (s === mine) ties += 1;
    }
    if (best) score += 1 / (ties + 1);
  }
  return score / iterations;
}

const STYLE = {
  easy: { noise: 0.18, bluff: 0.04, aggression: 0.6, loose: 0.12 },
  normal: { noise: 0.08, bluff: 0.08, aggression: 1, loose: 0.04 },
  hard: { noise: 0.04, bluff: 0.1, aggression: 1.2, loose: 0 },
};

/**
 * Decide for seat `i` of `table` (it must be that seat's turn).
 * Returns { type, amount? } ready for table.act().
 */
function decide(table, i, level = 'normal', random = Math.random) {
  const h = table.hand;
  const s = table.seats[i];
  const st = STYLE[level] || STYLE.normal;
  const g = GAMES[table.game] || GAMES.NLH;
  const opponents = table.seats.filter((p, j) => p && j !== i && p.inHand && !p.folded).length;
  const its = g.omaha ? 70 : 140;
  let eq = equity(table.game, s.hole, h.board, Math.max(1, opponents), its, random);
  eq = Math.min(1, Math.max(0, eq + (random() * 2 - 1) * st.noise));
  const toCall = Math.max(0, h.currentBet - s.bet);
  const pot = table.seats.reduce((sum, p) => sum + (p && p.inHand ? p.total : 0), 0);
  const lim = table.raiseLimits(i);
  // a "fair share" equity: what this hand would win on average against this many players
  const fair = 1 / (opponents + 1);
  const strong = eq > fair * 1.9 || eq > 0.72;
  const good = eq > fair * 1.35;

  const raiseTo = (frac) => {
    if (!lim) return null;
    if (lim.minTo === lim.maxTo) return lim.minTo;
    const target = h.currentBet + Math.round((pot + toCall) * frac * st.aggression);
    const step = table.bb;
    const rounded = Math.round(target / step) * step;
    return Math.min(lim.maxTo, Math.max(lim.minTo, rounded));
  };

  if (toCall === 0) {
    if (strong && lim) return { type: h.currentBet === 0 ? 'bet' : 'raise', amount: raiseTo(0.55 + random() * 0.4) };
    if (good && lim && random() < 0.45) return { type: h.currentBet === 0 ? 'bet' : 'raise', amount: raiseTo(0.4 + random() * 0.25) };
    if (lim && random() < st.bluff) return { type: h.currentBet === 0 ? 'bet' : 'raise', amount: raiseTo(0.5) };
    return { type: 'check' };
  }
  const odds = toCall / (pot + toCall);
  if (strong && lim && random() < 0.7) return { type: 'raise', amount: raiseTo(0.7 + random() * 0.5) };
  if (eq + st.loose > odds + 0.04) {
    // don't call off the whole stack with a merely decent hand
    if (toCall >= s.stack * 0.6 && !strong && eq < 0.55 && level !== 'easy') return { type: 'fold' };
    return { type: 'call' };
  }
  if (lim && random() < st.bluff * 0.4 && h.street !== 'river') return { type: 'raise', amount: raiseTo(0.8) };
  return { type: 'fold' };
}

module.exports = { decide, equity };
