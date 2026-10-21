'use strict';
const crypto = require('crypto');
const { GameError } = require('./engine/table');

/** Blind levels shared by all Sit & Go tournaments. */
const LEVELS = [
  [10, 20], [15, 30], [25, 50], [40, 80], [60, 120], [100, 200], [150, 300],
  [200, 400], [300, 600], [500, 1000], [800, 1600], [1200, 2400], [2000, 4000], [3000, 6000],
];

/** Share of the prize pool per finishing place, by table size. */
const PAYOUT_SHARES = { 2: [1], 3: [1], 4: [0.65, 0.35], 5: [0.65, 0.35], 6: [0.65, 0.35], 9: [0.5, 0.3, 0.2] };

// levelHands: blinds go up every N hands
const TEMPLATES = [
  { id: 'turbo6', name: 'Турбо 6-max', game: 'NLH', seats: 6, buyIn: 500, startStack: 1500, levelHands: 5 },
  { id: 'duel', name: 'Дуэль 1 на 1', game: 'NLH', seats: 2, buyIn: 1000, startStack: 1500, levelHands: 5 },
  { id: 'omaha6', name: 'Омаха Sit & Go', game: 'PLO', seats: 6, buyIn: 500, startStack: 1500, levelHands: 5 },
  { id: 'big9', name: 'Большой стол', game: 'NLH', seats: 9, buyIn: 2000, startStack: 3000, levelHands: 5 },
];

/**
 * A single-table tournament: players register (buy-in leaves the balance),
 * it starts when full, blinds go up every level, busted players are ranked
 * and the top places are paid from the prize pool.
 *
 * deps: { store, makeTable(cfg, opts), onChange(sng), onStarted(sng),
 *         onFinished(sng), notify(userId, event, payload), levelHands, timers }
 */
class SitAndGo {
  constructor(tpl, deps) {
    this.id = crypto.randomBytes(4).toString('hex');
    this.templateId = tpl.id;
    this.name = tpl.name;
    this.game = tpl.game === 'PLO' ? 'PLO' : 'NLH';
    this.seats = tpl.seats;
    this.buyIn = tpl.buyIn;
    this.startStack = tpl.startStack;
    this.levelHands = deps.levelHands || tpl.levelHands || 5;
    this.deps = deps;
    this.timers = deps.timers || { set: setTimeout, clear: clearTimeout };
    this.status = 'registering'; // registering | running | finished
    this.players = []; // { userId, name, place, prize }
    this.table = null;
    this.startedAt = null;
    this.finishedAt = null;
  }

  get key() { return 'sng:' + this.id; }
  get prizePool() { return this.buyIn * this.seats; }

  payouts() {
    const shares = PAYOUT_SHARES[this.seats] || [1];
    const amounts = shares.map((p) => Math.floor(this.prizePool * p));
    amounts[0] += this.prizePool - amounts.reduce((a, b) => a + b, 0);
    return amounts;
  }

  register(userId, name) {
    if (this.status !== 'registering') throw new GameError('Регистрация закрыта');
    if (this.players.some((p) => p.userId === userId)) throw new GameError('Вы уже зарегистрированы');
    if (this.players.length >= this.seats) throw new GameError('Мест нет');
    const { store } = this.deps;
    store.withdraw(userId, this.buyIn);
    store.setInPlay(userId, this.key, this.buyIn); // refunded if the server crashes
    this.players.push({ userId, name, place: null, prize: 0 });
    if (this.players.length === this.seats) this.start();
    else this.deps.onChange(this);
  }

  unregister(userId) {
    if (this.status !== 'registering') throw new GameError('Турнир уже начался');
    const idx = this.players.findIndex((p) => p.userId === userId);
    if (idx === -1) throw new GameError('Вы не зарегистрированы');
    this.players.splice(idx, 1);
    this.deps.store.deposit(userId, this.buyIn);
    this.deps.store.setInPlay(userId, this.key, 0);
    this.deps.onChange(this);
  }

  start() {
    this.status = 'running';
    this.startedAt = Date.now();
    const [sb, bb] = LEVELS[0];
    this.table = this.deps.makeTable(
      { id: 'sng-' + this.id, name: this.name, game: this.game, sb, bb, maxSeats: this.seats, blindsEvery: this.levelHands, levels: LEVELS },
      {
        tournament: true,
        onBust: (list) => this._onBust(list),
        onTournamentEnd: () => this._finish(),
      },
    );
    this.table.sng = this;
    this.table.extraState = (viewerId) => this.tableInfo(viewerId);

    // random seat draw
    const order = this.players.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    order.forEach((pIdx, seat) => {
      const p = this.players[pIdx];
      this.table.seatDirect(p.userId, p.name, seat, this.startStack);
    });
    this.table.start();
    for (const p of this.players) this.deps.notify(p.userId, 'sng:started', { sngId: this.id, tableId: this.table.id, name: this.name });
    this.deps.onStarted(this);
    this.deps.onChange(this);
  }

  get level() { return this.table && this.table.schedule ? this.table.schedule.level : 0; }

  alive() { return this.players.filter((p) => p.place == null); }

  _award(p, place) {
    const prize = this.payouts()[place - 1] || 0;
    p.place = place;
    p.prize = prize;
    const { store } = this.deps;
    store.setInPlay(p.userId, this.key, 0);
    if (prize) store.deposit(p.userId, prize);
    this.deps.notify(p.userId, 'sng:result', { sngId: this.id, name: this.name, place, prize, total: this.seats });
  }

  _onBust(list) {
    for (const b of list) {
      const p = this.players.find((x) => x.userId === b.userId);
      if (!p || p.place != null) continue;
      this._award(p, this.alive().length);
    }
    this.deps.onChange(this);
  }

  _finish() {
    const last = this.table.seats.find(Boolean);
    const p = last && this.players.find((x) => x.userId === last.userId);
    if (p && p.place == null) this._award(p, 1);
    this.status = 'finished';
    this.finishedAt = Date.now();
    this.deps.onChange(this);
    this.deps.onFinished(this);
  }

  /** Server stop: refund registrations, split what is left of a running pool by chip count. */
  shutdown() {
    const { store } = this.deps;
    if (this.status === 'registering') {
      for (const p of this.players) { store.deposit(p.userId, this.buyIn); store.setInPlay(p.userId, this.key, 0); }
      this.players = [];
      return;
    }
    if (this.status !== 'running') return;
    const paid = this.players.reduce((a, p) => a + p.prize, 0);
    const remaining = this.prizePool - paid;
    const t = this.table;
    const chipsOf = (userId) => {
      const s = t.seats[t.seatOf(userId)];
      if (!s) return 0;
      return s.stack + (t.hand && !t.hand.ended && s.inHand ? s.total : 0);
    };
    const alive = this.alive().map((p) => ({ p, chips: chipsOf(p.userId) }));
    const totalChips = alive.reduce((a, x) => a + x.chips, 0) || 1;
    let given = 0;
    for (const x of alive) {
      x.share = Math.floor((remaining * x.chips) / totalChips);
      given += x.share;
    }
    if (alive.length) alive.sort((a, b) => b.chips - a.chips)[0].share += remaining - given;
    for (const x of alive) {
      store.setInPlay(x.p.userId, this.key, 0);
      if (x.share) store.deposit(x.p.userId, x.share);
    }
    this.status = 'finished';
  }

  tableInfo(viewerId) {
    const t = this.table;
    const bi = t ? t.blindInfo() : null;
    const me = this.players.find((p) => p.userId === viewerId);
    return {
      sngId: this.id,
      status: this.status,
      level: this.level + 1,
      sb: t ? t.sb : LEVELS[0][0],
      bb: t ? t.bb : LEVELS[0][1],
      next: bi ? bi.next : null,
      nextAtHand: bi ? bi.nextAtHand : null,
      levelHands: this.levelHands,
      alive: this.alive().length,
      total: this.seats,
      payouts: this.payouts(),
      results: this.players.filter((p) => p.place != null).sort((a, b) => a.place - b.place)
        .map((p) => ({ place: p.place, name: p.name, prize: p.prize })),
      myPlace: me ? me.place : null,
      myPrize: me ? me.prize : 0,
    };
  }

  summary() {
    return {
      id: this.id, templateId: this.templateId, name: this.name, game: this.game, seats: this.seats,
      buyIn: this.buyIn, prizePool: this.prizePool, payouts: this.payouts(), startStack: this.startStack,
      levelHands: this.levelHands, status: this.status, tableId: this.table ? this.table.id : null,
      players: this.players.map((p) => p.name), alive: this.alive().length,
      level: this.level + 1, winner: (this.players.find((p) => p.place === 1) || {}).name || null,
    };
  }
}

module.exports = { SitAndGo, LEVELS, TEMPLATES, PAYOUT_SHARES };
