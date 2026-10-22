'use strict';

/**
 * Poker variants. Everything that differs between them lives here:
 * hole cards, deck, how the best hand is built, and the betting structure.
 */
const GAMES = {
  NLH: { name: 'Холдем NL', short: 'NLH', hole: 2, deck: 'full', omaha: false, limit: 'no', maxSeats: 9,
    rules: '2 карты, любая комбинация из 7. Ставки без ограничений.' },
  LHE: { name: 'Холдем Limit', short: 'LHE', hole: 2, deck: 'full', omaha: false, limit: 'fixed', maxSeats: 9,
    rules: '2 карты. Фиксированные ставки: на префлопе и флопе — большой блайнд, на тёрне и ривере — два. Не больше 4 ставок за улицу.' },
  SD: { name: 'Шорт-дек 6+', short: '6+', hole: 2, deck: 'short', omaha: false, limit: 'no', maxSeats: 9,
    rules: 'Колода 36 карт без двоек–пятёрок. Флеш старше фулл-хауса, сет старше стрита, туз-6-7-8-9 — младший стрит.' },
  PLO: { name: 'Омаха PL', short: 'PLO', hole: 4, deck: 'full', omaha: true, limit: 'pot', maxSeats: 9,
    rules: '4 карты, ровно 2 с руки и 3 с борда. Рейз не больше банка.' },
  PLO5: { name: 'Омаха-5 PL', short: 'PLO5', hole: 5, deck: 'full', omaha: true, limit: 'pot', maxSeats: 6,
    rules: '5 карт, ровно 2 с руки и 3 с борда. Рейз не больше банка. До 6 игроков.' },
};

const gameOf = (code) => (GAMES[code] ? code : 'NLH');

module.exports = { GAMES, gameOf };
