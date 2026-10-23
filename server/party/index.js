'use strict';
const { PartyTable } = require('./base');
const { BombGame } = require('./bomb');
const { SpyGame } = require('./spy');
const { DungeonGame } = require('./dungeon');
const { DarkGame } = require('./dark');

const GAMES = { bomb: BombGame, spy: SpyGame, dungeon: DungeonGame, dark: DarkGame };
const { KINDS: BOMB_KINDS } = require('./bomb');
const { CARDS: DUNGEON_CARDS } = require('./dungeon-cards');
/** The decks for the rules page: every card once. */
const decks = () => ({ bomb: BOMB_KINDS, dungeon: DUNGEON_CARDS });
const meta = () => Object.fromEntries(Object.entries(GAMES).map(([k, G]) => [k, G.meta]));

module.exports = { GAMES, PartyTable, meta, decks };
