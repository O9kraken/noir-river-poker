'use strict';
const crypto = require('crypto');

const RANKS = '23456789TJQKA';
const SUITS = 'shdc'; // spades, hearts, diamonds, clubs

function newDeck() {
  const deck = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(r + s);
  return deck;
}

/** Fisher–Yates with a cryptographically secure RNG. */
function shuffle(deck, randomInt = crypto.randomInt) {
  const d = deck.slice();
  for (let i = d.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function rankValue(card) {
  return RANKS.indexOf(card[0]) + 2; // 2..14
}

function isValidCard(c) {
  return typeof c === 'string' && c.length === 2 && RANKS.includes(c[0]) && SUITS.includes(c[1]);
}

module.exports = { RANKS, SUITS, newDeck, shuffle, rankValue, isValidCard };
