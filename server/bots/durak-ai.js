'use strict';
/**
 * Durak opponent: cheap-card-first heuristics.
 * Returns one action for `seat` or null when the game isn't waiting for it.
 */
const { beats, RANKS } = require('../durak/engine');

const rv = (c) => RANKS.indexOf(c[0]);

function decide(g, seat, level = 'normal', random = Math.random) {
  if (!g || g.over) return null;
  const w = g.waitingFor();
  if (!w.seats.includes(seat)) return null;
  const trump = g.trump;
  const cost = (c) => rv(c) + (c[1] === trump ? 10 : 0);
  const byCost = (a, b) => cost(a) - cost(b);
  const hand = g.hand(seat).slice();
  const careless = level === 'easy' && random() < 0.25;

  if (w.kind === 'lead') {
    const sorted = hand.slice().sort(byCost);
    if (careless) return { type: 'attack', card: sorted[Math.floor(random() * sorted.length)] };
    // lead the cheapest card; with an empty deck prefer a rank we hold several of
    let lead = sorted[0];
    if (!g.deck.length && level !== 'easy') {
      const counts = {};
      for (const c of hand) counts[c[0]] = (counts[c[0]] || 0) + 1;
      const pair = sorted.find((c) => counts[c[0]] > 1 && c[1] !== trump);
      if (pair) lead = pair;
    }
    return { type: 'attack', card: lead };
  }

  if (w.kind === 'defend') {
    // transfer with a cheap non-trump card when possible
    if (g.variant === 'perevodnoy') {
      const tr = hand.filter((c) => g.canTransfer(seat, c)).sort(byCost);
      if (tr.length && (tr[0][1] !== trump || !g.deck.length) && random() < (level === 'easy' ? 0.5 : 0.85)) return { type: 'transfer', card: tr[0] };
    }
    // plan a cover for every open card, the most expensive attack first
    const open = g.table.map((p, idx) => ({ p, idx })).filter((x) => !x.p.d).sort((a, b) => cost(b.p.a) - cost(a.p.a));
    const used = new Set();
    const plan = [];
    for (const { p, idx } of open) {
      const c = hand.filter((x) => !used.has(x) && beats(x, p.a, trump)).sort(byCost)[0];
      if (!c) return g.canTake(seat) ? { type: 'take' } : null;
      used.add(c);
      plan.push({ card: c, idx });
    }
    // early in the game, don't burn high trumps on small cards
    if (level !== 'easy' && g.deck.length > 8 && plan.some((x) => x.card[1] === trump && rv(x.card) >= 6) && g.canTake(seat)) return { type: 'take' };
    const first = plan[0];
    return first ? { type: 'defend', card: first.card, index: first.idx } : null;
  }

  if (w.kind === 'throw') {
    const can = hand.filter((c) => g.canThrow(seat, c)).sort(byCost);
    if (can.length) {
      const c = can[0];
      const late = !g.deck.length;
      const ok = g.taking ? (c[1] !== trump || late) : (late || (c[1] !== trump && rv(c) <= (level === 'hard' ? 5 : 4)));
      if (ok || careless) return { type: 'attack', card: c };
    }
    if (g.canPass(seat)) return { type: 'pass' };
    return null;
  }
  return null;
}

module.exports = { decide };
