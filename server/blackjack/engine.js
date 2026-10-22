'use strict';
const crypto = require('crypto');

/**
 * Blackjack round vs. the dealer.
 * Rules: 6-deck shoe, dealer stands on all 17s (S17), dealer peeks for blackjack,
 * blackjack pays 3:2, double on any first two cards (also after a split),
 * split pairs of equal value up to 4 hands, split aces get one card each.
 * Pure logic: money is handled by the table (it charges doubles/splits first).
 */

const RANKS = '23456789TJQKA';
const SUITS = 'shdc';
const MAX_HANDS = 4;

class BlackjackError extends Error {}

function newShoe(decks = 6, randomInt = crypto.randomInt) {
  const d = [];
  for (let k = 0; k < decks; k++) for (const r of RANKS) for (const s of SUITS) d.push(r + s);
  for (let i = d.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function cardValue(c) {
  const r = c[0];
  if (r === 'A') return 11;
  if ('TJQK'.includes(r)) return 10;
  return Number(r);
}

/** Best total and whether an ace still counts as 11. */
function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) { total += cardValue(c); if (c[0] === 'A') aces += 1; }
  while (total > 21 && aces > 0) { total -= 10; aces -= 1; }
  return { total, soft: aces > 0 };
}

const isBlackjack = (cards) => cards.length === 2 && handValue(cards).total === 21;

class BlackjackRound {
  /**
   * @param {Array<{seat:number, bet:number}>} entries players in dealing order (seat order)
   * @param {string[]} shoe cards; dealt from the end (pop). The caller keeps the shoe between rounds.
   */
  constructor(entries, shoe) {
    if (!entries.length) throw new BlackjackError('Нет ставок');
    this.shoe = shoe;
    this.players = entries.map((e) => ({ seat: e.seat, hands: [this._hand(e.bet)] }));
    this.dealer = { cards: [], revealed: false };
    this.phase = 'player'; // player | dealer | done
    this.turn = null; // { p, h } indices into players / hands

    // two rounds of dealing, dealer gets the upcard first and the hole card second
    for (let r = 0; r < 2; r++) {
      for (const p of this.players) p.hands[0].cards.push(this._draw());
      this.dealer.cards.push(this._draw());
    }
    for (const p of this.players) {
      const hd = p.hands[0];
      if (isBlackjack(hd.cards)) { hd.done = true; hd.natural = true; }
    }
    // dealer peeks with an ace or a ten up: a dealer blackjack ends the round at once
    const up = this.dealer.cards[0];
    if ((up[0] === 'A' || cardValue(up) === 10) && isBlackjack(this.dealer.cards)) {
      this.dealer.revealed = true;
      this.dealerBlackjack = true;
      this.phase = 'done';
      this._settle();
      return;
    }
    this._advance();
  }

  _hand(bet) {
    return { cards: [], bet, doubled: false, done: false, busted: false, fromSplit: false, splitAces: false, natural: false, result: null, payout: 0 };
  }

  _draw() {
    if (!this.shoe.length) throw new BlackjackError('Шуз закончился');
    return this.shoe.pop();
  }

  /** Move the turn to the first unfinished hand; when none is left the dealer plays. */
  _advance() {
    for (let p = 0; p < this.players.length; p++) {
      const hands = this.players[p].hands;
      for (let h = 0; h < hands.length; h++) {
        if (!hands[h].done) { this.turn = { p, h }; return; }
      }
    }
    this.turn = null;
    this.phase = 'dealer';
    this.dealer.revealed = true;
  }

  current() {
    if (this.phase !== 'player' || !this.turn) return null;
    const pl = this.players[this.turn.p];
    return { seat: pl.seat, handIndex: this.turn.h, hand: pl.hands[this.turn.h], player: pl };
  }

  canHit() { const c = this.current(); return !!c && !c.hand.splitAces && handValue(c.hand.cards).total < 21; }
  canStand() { return !!this.current(); }
  canDouble() {
    const c = this.current();
    return !!c && c.hand.cards.length === 2 && !c.hand.splitAces && !c.hand.doubled;
  }
  canSplit() {
    const c = this.current();
    if (!c || c.hand.cards.length !== 2 || c.player.hands.length >= MAX_HANDS) return false;
    if (c.hand.splitAces) return false;
    return cardValue(c.hand.cards[0]) === cardValue(c.hand.cards[1]);
  }

  _checkSeat(seat) {
    const c = this.current();
    if (!c || c.seat !== seat) throw new BlackjackError('Сейчас не ваш ход');
    return c;
  }

  hit(seat) {
    const c = this._checkSeat(seat);
    if (!this.canHit()) throw new BlackjackError('Брать нельзя');
    c.hand.cards.push(this._draw());
    const v = handValue(c.hand.cards).total;
    if (v > 21) { c.hand.busted = true; c.hand.done = true; }
    else if (v === 21) c.hand.done = true;
    if (c.hand.done) this._advance();
  }

  stand(seat) {
    const c = this._checkSeat(seat);
    c.hand.done = true;
    this._advance();
  }

  /** The table must have charged an extra `hand.bet` already. */
  double(seat) {
    const c = this._checkSeat(seat);
    if (!this.canDouble()) throw new BlackjackError('Удвоить нельзя');
    c.hand.bet *= 2;
    c.hand.doubled = true;
    c.hand.cards.push(this._draw());
    if (handValue(c.hand.cards).total > 21) c.hand.busted = true;
    c.hand.done = true;
    this._advance();
  }

  /** The table must have charged an extra `hand.bet` already. */
  split(seat) {
    const c = this._checkSeat(seat);
    if (!this.canSplit()) throw new BlackjackError('Разделить нельзя');
    const hd = c.hand;
    const second = this._hand(hd.bet);
    second.cards.push(hd.cards.pop());
    hd.fromSplit = true;
    second.fromSplit = true;
    const aces = hd.cards[0][0] === 'A';
    hd.splitAces = aces;
    second.splitAces = aces;
    hd.cards.push(this._draw());
    second.cards.push(this._draw());
    c.player.hands.splice(this.turn.h + 1, 0, second);
    // split aces: one card each and done; 21 after a split is not a blackjack
    if (aces) { hd.done = true; second.done = true; }
    else {
      if (handValue(hd.cards).total === 21) hd.done = true;
      if (handValue(second.cards).total === 21) second.done = true;
    }
    if (hd.done) this._advance();
  }

  /** Every unfinished hand of a seat stands (player left / timed out on all of them). */
  standAll(seat) {
    for (const p of this.players) if (p.seat === seat) for (const hd of p.hands) hd.done = true;
    if (this.phase === 'player') this._advance();
  }

  /** Does the dealer still need cards? Stands on all 17s; no draws if every hand is already decided. */
  dealerNeedsCard() {
    if (this.phase !== 'dealer') return false;
    const live = this.players.some((p) => p.hands.some((hd) => !hd.busted && !hd.natural));
    if (!live) return false;
    return handValue(this.dealer.cards).total < 17;
  }

  dealerStep() {
    if (this.dealerNeedsCard()) { this.dealer.cards.push(this._draw()); return true; }
    if (this.phase === 'dealer') { this.phase = 'done'; this._settle(); }
    return false;
  }

  _settle() {
    const d = handValue(this.dealer.cards).total;
    const dealerBJ = isBlackjack(this.dealer.cards);
    const dealerBust = d > 21;
    for (const p of this.players) {
      for (const hd of p.hands) {
        const v = handValue(hd.cards).total;
        if (hd.natural && !hd.fromSplit) {
          if (dealerBJ) { hd.result = 'push'; hd.payout = hd.bet; } else { hd.result = 'blackjack'; hd.payout = Math.floor(hd.bet * 2.5); }
        } else if (hd.busted) { hd.result = 'bust'; hd.payout = 0; }
        else if (dealerBJ) { hd.result = 'lose'; hd.payout = 0; }
        else if (dealerBust || v > d) { hd.result = 'win'; hd.payout = hd.bet * 2; }
        else if (v === d) { hd.result = 'push'; hd.payout = hd.bet; }
        else { hd.result = 'lose'; hd.payout = 0; }
      }
    }
  }

  totalBet(seat) {
    const p = this.players.find((x) => x.seat === seat);
    return p ? p.hands.reduce((a, hd) => a + hd.bet, 0) : 0;
  }

  totalPayout(seat) {
    const p = this.players.find((x) => x.seat === seat);
    return p ? p.hands.reduce((a, hd) => a + hd.payout, 0) : 0;
  }
}

module.exports = { BlackjackRound, BlackjackError, newShoe, handValue, cardValue, isBlackjack };
