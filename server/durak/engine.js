'use strict';
const crypto = require('crypto');

/**
 * Durak (подкидной / переводной) for 2–6 players, 36-card deck.
 * Pure game logic, no timers or networking: the table drives it.
 *
 * Seats are table seat indices; `order` keeps them clockwise.
 */

const RANKS = '6789TJQKA';
const SUITS = 'shdc';
const HAND_SIZE = 6;

class DurakError extends Error {}

const rv = (c) => RANKS.indexOf(c[0]);

function newDeck36() {
  const d = [];
  for (const r of RANKS) for (const s of SUITS) d.push(r + s);
  return d;
}

function shuffle(deck, randomInt = crypto.randomInt) {
  const d = deck.slice();
  for (let i = d.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

/** Does `def` beat `att` with the given trump suit? */
function beats(def, att, trump) {
  if (def[1] === att[1]) return rv(def) > rv(att);
  return def[1] === trump && att[1] !== trump;
}

class DurakGame {
  /**
   * @param {number[]} seats clockwise seat indices of the players
   * @param {object} opts { variant: 'podkidnoy'|'perevodnoy', deck?: string[] (top = end), firstAttacker? }
   */
  constructor(seats, opts = {}) {
    if (seats.length < 2 || seats.length > 6) throw new DurakError('Нужно от 2 до 6 игроков');
    this.variant = opts.variant === 'perevodnoy' ? 'perevodnoy' : 'podkidnoy';
    this.order = seats.slice();
    this.deck = opts.deck ? opts.deck.slice() : shuffle(newDeck36(), opts.randomInt);
    this.trumpCard = this.deck[0]; // bottom card, drawn last
    this.trump = this.trumpCard[1];
    this.hands = new Map(seats.map((s) => [s, []]));
    this.out = []; // seats that got rid of all cards, in finishing order
    this.table = []; // [{ a: attackCard, d: defenceCard|null }]
    this.discard = 0;
    this.taking = false;
    this.passed = new Set();
    this.over = false;
    this.durak = null; // seat of the loser (null on a draw)
    this.firstRound = true;
    this.log = [];

    for (let k = 0; k < HAND_SIZE; k++) for (const s of seats) this.hands.get(s).push(this.deck.pop());

    // the lowest trump leads; nobody holds a trump -> first seat
    let lead = seats[0];
    let low = 99;
    for (const s of seats) {
      for (const c of this.hands.get(s)) if (c[1] === this.trump && rv(c) < low) { low = rv(c); lead = s; }
    }
    if (opts.firstAttacker != null && seats.includes(opts.firstAttacker)) lead = opts.firstAttacker;
    this.leadTrump = low < 99 ? RANKS[low] + this.trump : null;
    this._newRound(lead);
  }

  // ---------- helpers ----------

  active() { return this.order.filter((s) => !this.out.includes(s)); }

  nextActive(seat) {
    const i = this.order.indexOf(seat);
    for (let k = 1; k <= this.order.length; k++) {
      const s = this.order[(i + k) % this.order.length];
      if (!this.out.includes(s)) return s;
    }
    return null;
  }

  hand(seat) { return this.hands.get(seat) || []; }

  /** Everyone who may throw cards in this round: all active players except the defender. */
  attackers() { return this.active().filter((s) => s !== this.defender); }

  uncovered() { return this.table.filter((p) => !p.d).length; }

  ranksOnTable() {
    const r = new Set();
    for (const p of this.table) { r.add(p.a[0]); if (p.d) r.add(p.d[0]); }
    return r;
  }

  /** Cap on attack cards this round. */
  limit() { return this.roundLimit; }

  _newRound(attacker) {
    this.attacker = attacker;
    this.roundAttacker = attacker;
    this.defender = this.nextActive(attacker);
    this.table = [];
    this.taking = false;
    this.passed = new Set();
    this.roundLimit = Math.min(this.firstRound ? 5 : HAND_SIZE, this.hand(this.defender).length);
  }

  _remove(seat, card) {
    const h = this.hand(seat);
    const i = h.indexOf(card);
    if (i === -1) throw new DurakError('Такой карты у вас нет');
    h.splice(i, 1);
  }

  // ---------- what a seat may do ----------

  canThrow(seat, card) {
    if (this.over || seat === this.defender || this.out.includes(seat)) return false;
    if (!this.hand(seat).includes(card)) return false;
    if (this.table.length === 0) return seat === this.attacker;
    if (this.table.length >= this.roundLimit) return false;
    if (this.uncovered() + 1 > this.hand(this.defender).length) return false;
    return this.ranksOnTable().has(card[0]);
  }

  canDefend(seat, card, idx) {
    if (this.over || seat !== this.defender || this.taking) return false;
    const pair = this.table[idx];
    if (!pair || pair.d) return false;
    return this.hand(seat).includes(card) && beats(card, pair.a, this.trump);
  }

  canTransfer(seat, card) {
    if (this.over || this.variant !== 'perevodnoy' || seat !== this.defender || this.taking) return false;
    if (!this.table.length || this.table.some((p) => p.d)) return false;
    if (!this.hand(seat).includes(card)) return false;
    if (!this.table.every((p) => p.a[0] === card[0])) return false;
    const next = this.nextActive(seat);
    if (next == null || next === seat) return false;
    // the new defender must be able to cover every card
    return this.hand(next).length >= this.table.length + 1;
  }

  canTake(seat) {
    return !this.over && seat === this.defender && !this.taking && this.uncovered() > 0;
  }

  /** "Бито" / "Пас": only when there is nothing to beat right now (or the defender is taking). */
  canPass(seat) {
    if (this.over || seat === this.defender || this.out.includes(seat) || !this.table.length) return false;
    if (this.passed.has(seat)) return false;
    return this.taking || this.uncovered() === 0;
  }

  // ---------- actions ----------

  attack(seat, card) {
    if (!this.canThrow(seat, card)) throw new DurakError('Эту карту сейчас нельзя подкинуть');
    this._remove(seat, card);
    this.table.push({ a: card, d: null });
    this.passed.clear();
    this._afterChange();
  }

  defend(seat, card, idx) {
    if (!this.canDefend(seat, card, idx)) throw new DurakError('Этой картой не побить');
    this._remove(seat, card);
    this.table[idx].d = card;
    this.passed.clear();
    this._afterChange();
  }

  transfer(seat, card) {
    if (!this.canTransfer(seat, card)) throw new DurakError('Перевести нельзя');
    this._remove(seat, card);
    this.table.push({ a: card, d: null });
    this.attacker = seat;
    this.defender = this.nextActive(seat);
    this.roundLimit = Math.min(this.firstRound ? 5 : HAND_SIZE, Math.max(this.table.length, this.hand(this.defender).length));
    this.passed.clear();
    this._afterChange();
  }

  take(seat) {
    if (!this.canTake(seat)) throw new DurakError('Сейчас нельзя взять');
    this.taking = true;
    this.passed.clear();
    this._afterChange();
  }

  pass(seat) {
    if (!this.canPass(seat)) throw new DurakError('Сейчас нельзя пасовать');
    this.passed.add(seat);
    this._afterChange();
  }

  /** Can this attacker still add anything at all? */
  _canAddAny(seat) {
    return this.hand(seat).some((c) => this.canThrow(seat, c));
  }

  /** End the round as soon as nobody can or wants to add more. */
  _afterChange() {
    if (this.over || !this.table.length) return;
    const allBeaten = this.uncovered() === 0;
    if (!allBeaten && !this.taking) {
      // defender ran out of cards but still has to beat: impossible, so taking is the only option
      return;
    }
    const waiting = this.attackers().filter((s) => !this.passed.has(s) && this._canAddAny(s));
    if (waiting.length === 0) this._endRound();
  }

  _endRound() {
    const took = this.taking;
    const defender = this.defender;
    if (took) {
      const h = this.hand(defender);
      for (const p of this.table) { h.push(p.a); if (p.d) h.push(p.d); }
    } else {
      this.discard += this.table.reduce((n, p) => n + (p.d ? 2 : 1), 0);
    }
    this.lastRound = { took, defender, cards: this.table.length };
    this.table = [];

    // refill: round attacker first, then clockwise, defender last
    const seq = [];
    let s = this.roundAttacker;
    for (let k = 0; k < this.order.length; k++) {
      if (!this.out.includes(s) && s !== defender) seq.push(s);
      s = this.order[(this.order.indexOf(s) + 1) % this.order.length];
    }
    if (!this.out.includes(defender)) seq.push(defender);
    for (const p of seq) {
      const h = this.hand(p);
      while (h.length < HAND_SIZE && this.deck.length) h.push(this.deck.pop());
    }

    // whoever is out of cards with an empty deck has finished
    if (!this.deck.length) {
      for (const p of this.active()) if (this.hand(p).length === 0) this.out.push(p);
    }
    this.firstRound = false;

    const left = this.active();
    if (left.length <= 1) {
      this.over = true;
      this.durak = left.length === 1 ? left[0] : null;
      return;
    }
    let next = took ? this.nextActive(defender) : defender;
    if (this.out.includes(next)) next = this.nextActive(next);
    this._newRound(next);
    if (this.defender === this.attacker) { this.over = true; this.durak = null; }
  }

  /** Lowest card the main attacker can lead with (used on timeout). */
  autoLead() {
    const h = this.hand(this.attacker).slice();
    h.sort((x, y) => (x[1] === this.trump) - (y[1] === this.trump) || rv(x) - rv(y));
    return h[0];
  }

  /** Who the game is waiting for right now. */
  waitingFor() {
    if (this.over) return { kind: 'none', seats: [] };
    if (!this.table.length) return { kind: 'lead', seats: [this.attacker] };
    if (this.uncovered() > 0 && !this.taking) return { kind: 'defend', seats: [this.defender] };
    return { kind: 'throw', seats: this.attackers().filter((s) => !this.passed.has(s) && this._canAddAny(s)) };
  }

  totalCards() {
    let n = this.deck.length + this.discard;
    for (const h of this.hands.values()) n += h.length;
    for (const p of this.table) n += p.d ? 2 : 1;
    return n;
  }
}

function sortHand(cards, trump) {
  return cards.slice().sort((x, y) => (x[1] === trump) - (y[1] === trump) || SUITS.indexOf(x[1]) - SUITS.indexOf(y[1]) || rv(x) - rv(y));
}

module.exports = { DurakGame, DurakError, beats, newDeck36, sortHand, RANKS, SUITS };
