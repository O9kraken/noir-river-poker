'use strict';
const crypto = require('crypto');
const { GameError } = require('../engine/table');
const { GROUPS, CELLS, streetRent, PIER_RENT, LUCK, FUND } = require('./board');

const START_CASH = 1500;
const GO_BONUS = 200;
const BAIL = 50;
const PLAYER_COLORS = ['#D9B65E', '#E06A72', '#5FB7E8', '#7FD6A8', '#B48CF0', '#F0A35E'];

function shuffled(list, randomInt) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/**
 * "Капитал" — a property-trading board game for 2–6 players.
 * Everyone puts the stake in the pot; the last player standing (or the richest when time runs out) takes it.
 * Inside the game everyone plays with 1 500 game credits that have nothing to do with chips.
 *
 * deps: { charge(userId, amount) -> boolean, pay(userId, amount), onUpdate(table), onInPlay(userId, amount), onGameEnd(table, results) }
 */
class CapitalTable {
  constructor(cfg, deps = {}, opts = {}) {
    this.id = cfg.id;
    this.kind = 'cap';
    this.name = cfg.name;
    this.stake = cfg.stake;
    this.maxSeats = Math.min(6, Math.max(2, cfg.maxPlayers || 4));
    this.timeLimitMin = cfg.timeLimitMin ?? 45;
    this.permanent = !!cfg.permanent;
    this.deps = deps;
    this.timers = opts.timers || { set: setTimeout, clear: clearTimeout };
    this.now = opts.now || Date.now;
    this.randomInt = opts.randomInt || crypto.randomInt;
    this.turnMs = opts.turnMs ?? 30000;
    this.awayMs = opts.awayMs ?? 4000;
    this.countdownMs = opts.countdown ?? 3000;
    this.resultPause = opts.resultPause ?? 9000;
    this.seats = Array(this.maxSeats).fill(null);
    this.status = 'waiting'; // waiting | countdown | playing | result
    this.g = null;
    this.gameNo = 0;
    this.pot = 0;
    this.result = null;
    this.log = [];
    this.chat = [];
    this._timer = null;
    this._flow = null;
    this.lastActivity = this.now();
  }

  // ---------- seats ----------
  seatOf(userId) { return this.seats.findIndex((s) => s && s.userId === userId); }
  playerCount() { return this.seats.filter(Boolean).length; }
  _update() { this.lastActivity = this.now(); (this.deps.onUpdate || (() => {}))(this); }
  _log(text) { this.log.push({ t: this.now(), text }); if (this.log.length > 120) this.log.shift(); }
  _clear(n) { if (this[n]) { this.timers.clear(this[n]); this[n] = null; } }

  sit(userId, name, seat) {
    if (this.seatOf(userId) !== -1) throw new GameError('Вы уже за этим столом');
    if (!Number.isInteger(seat) || seat < 0 || seat >= this.maxSeats) throw new GameError('Нет такого места');
    if (this.seats[seat]) throw new GameError('Место занято');
    if (this.status === 'playing' && this.g.players.some((p) => p.seat === seat && !p.out)) throw new GameError('Место занято до конца партии');
    this.seats[seat] = { userId, name, ready: false, connected: true };
    this._log(`${name} садится за стол`);
    this._update();
  }
  freeSeat() { return this.seats.findIndex((s, i) => !s && !(this.status === 'playing' && this.g.players.some((p) => p.seat === i && !p.out))); }

  leave(userId) {
    const i = this.seatOf(userId);
    if (i === -1) return;
    const s = this.seats[i];
    const p = this.g && this.status === 'playing' ? this._player(i) : null;
    if (p && !p.out) { this._log(`${s.name} покидает игру`); this._bankrupt(p, null); }
    this.seats[i] = null;
    this._maybeCountdown();
    this._update();
  }

  setConnected(userId, connected) {
    const i = this.seatOf(userId);
    if (i === -1) return;
    this.seats[i].connected = connected;
    if (this.status === 'playing') this._arm();
    this._update();
  }

  setReady(userId, ready) {
    const i = this.seatOf(userId);
    if (i === -1) throw new GameError('Сначала сядьте за стол');
    if (this.status === 'playing' || this.status === 'result') throw new GameError('Дождитесь конца партии');
    this.seats[i].ready = !!ready;
    this._maybeCountdown();
    this._update();
  }

  _maybeCountdown() {
    if (this.status !== 'waiting' && this.status !== 'countdown') return;
    const seated = this.seats.filter(Boolean);
    const go = seated.length >= 2 && seated.every((s) => s.ready);
    if (go && this.status === 'waiting') {
      this.status = 'countdown';
      this.countdownEnds = this.now() + this.countdownMs;
      this._flow = this.timers.set(() => { this._flow = null; this._start(); }, this.countdownMs);
    } else if (!go && this.status === 'countdown') {
      this._clear('_flow');
      this.status = 'waiting';
    }
  }

  // ---------- game ----------
  _start() {
    const seats = [];
    this.seats.forEach((s, i) => { if (s && s.ready) seats.push(i); });
    if (seats.length < 2) { this.status = 'waiting'; this._update(); return; }
    const paid = [];
    for (const i of seats) {
      const s = this.seats[i];
      if (this.deps.charge && !this.deps.charge(s.userId, this.stake)) {
        for (const j of paid) this.deps.pay && this.deps.pay(this.seats[j].userId, this.stake);
        s.ready = false;
        this._log(`${s.name}: не хватает фишек на ставку`);
        this.status = 'waiting';
        this._update();
        return;
      }
      paid.push(i);
    }
    this.gameNo += 1;
    this.pot = this.stake * seats.length;
    const order = shuffled(seats, this.randomInt);
    this.g = {
      players: order.map((seat, k) => ({ seat, userId: this.seats[seat].userId, name: this.seats[seat].name, color: PLAYER_COLORS[k], cash: START_CASH, pos: 0, jail: 0, jailCards: 0, out: false, place: null })),
      cells: CELLS.map(() => ({ owner: null, houses: 0, mortgaged: false })),
      turn: 0, phase: 'roll', dice: null, doubles: 0, pending: null, card: null, trade: null,
      luck: shuffled(LUCK.map((_, i) => i), this.randomInt), fund: shuffled(FUND.map((_, i) => i), this.randomInt),
      startedAt: this.now(), endsAt: this.timeLimitMin ? this.now() + this.timeLimitMin * 60000 : 0, outOrder: [], moveNo: 0,
    };
    for (const i of seats) { this.seats[i].ready = false; this.deps.onInPlay && this.deps.onInPlay(this.seats[i].userId, this.stake); }
    this.status = 'playing';
    this.result = null;
    this._log(`— Партия №${this.gameNo}: ${order.length} игрока, банк ${this.pot} фишек. Первым ходит ${this.g.players[0].name} —`);
    this._arm();
    this._update();
  }

  _player(seat) { return this.g.players.find((p) => p.seat === seat); }
  _current() { return this.g.players[this.g.turn]; }
  _alive() { return this.g.players.filter((p) => !p.out); }
  _mine(userId) {
    if (this.status !== 'playing') throw new GameError('Партия не идёт');
    const i = this.seatOf(userId);
    const p = i === -1 ? null : this._player(i);
    if (!p || p.out) throw new GameError('Вы не в этой партии');
    return p;
  }
  _myTurn(userId) {
    const p = this._mine(userId);
    if (this._current() !== p) throw new GameError('Сейчас не ваш ход');
    if (this.g.trade) throw new GameError('Дождитесь ответа на обмен');
    return p;
  }

  _arm() {
    this._clear('_timer');
    if (this.status !== 'playing') return;
    const g = this.g;
    let who = g.trade ? this._player(g.trade.to) : this._current();
    const seat = who && this.seats[who.seat];
    const away = !seat || !seat.connected;
    const ms = away ? this.awayMs : this.turnMs;
    g.deadline = this.now() + ms;
    g.deadlineMs = ms;
    this._timer = this.timers.set(() => { this._timer = null; this._timeout(); }, ms);
  }

  _timeout() {
    if (this.status !== 'playing') return;
    const g = this.g;
    try {
      if (g.trade) { this._log(`${this._player(g.trade.to).name} не ответил на обмен`); g.trade = null; }
      else if (g.phase === 'roll') this._roll(this._current());
      else if (g.phase === 'buy') this._decline(this._current());
      else this._endTurn();
    } catch (e) { this._endTurn(); }
    this._arm();
    this._update();
  }

  _dice() { return [this.randomInt(6) + 1, this.randomInt(6) + 1]; }

  roll(userId) { const p = this._myTurn(userId); if (this.g.phase !== 'roll') throw new GameError('Кубики уже брошены'); this._roll(p); this._arm(); this._update(); }

  _roll(p) {
    const g = this.g;
    const d = this._dice();
    g.dice = d;
    g.moveNo += 1;
    g.card = null;
    const dbl = d[0] === d[1];
    if (p.jail) {
      if (dbl) { p.jail = 0; this._log(`${p.name}: дубль ${d[0]}+${d[1]} — выходит из Участка`); this._move(p, d[0] + d[1]); this._afterLand(p, false); return; }
      p.jail -= 1;
      if (p.jail <= 0) {
        this._log(`${p.name}: третья попытка — платит ${BAIL} и выходит`);
        if (!this._pay(p, null, BAIL)) return;
        this._move(p, d[0] + d[1]);
        this._afterLand(p, false);
        return;
      }
      this._log(`${p.name}: ${d[0]}+${d[1]}, остаётся в Участке`);
      g.phase = 'end';
      return;
    }
    if (dbl) {
      g.doubles += 1;
      if (g.doubles >= 3) { this._log(`${p.name}: третий дубль подряд — в Участок`); this._toJail(p); g.phase = 'end'; return; }
    }
    this._log(`${p.name}: ${d[0]}+${d[1]}`);
    this._move(p, d[0] + d[1]);
    this._afterLand(p, dbl);
  }

  _move(p, steps) {
    const to = (p.pos + steps + 40) % 40;
    if (steps > 0 && to < p.pos) { p.cash += GO_BONUS; this._log(`${p.name} проходит Старт: +${GO_BONUS}`); }
    p.pos = to;
  }
  _moveTo(p, to, collect = true) {
    if (collect && to < p.pos) { p.cash += GO_BONUS; this._log(`${p.name} проходит Старт: +${GO_BONUS}`); }
    p.pos = to;
  }
  _toJail(p) { p.pos = 10; p.jail = 3; this.g.doubles = 0; }

  /** Resolve the cell the player stands on, then decide the next phase. */
  _afterLand(p, rolledDouble) {
    const g = this.g;
    this._land(p);
    if (p.out || this.status !== 'playing') return;
    if (g.pending) { g.phase = 'buy'; g.again = rolledDouble && !p.jail; return; }
    g.phase = rolledDouble && !p.jail ? 'roll' : 'end';
  }

  _land(p, fromCard = false) {
    const g = this.g;
    const cell = CELLS[p.pos];
    const st = g.cells[p.pos];
    switch (cell.kind) {
      case 'street': case 'pier': case 'util': {
        if (st.owner == null) { g.pending = { cell: p.pos }; return; }
        if (st.owner === p.seat || st.mortgaged) return;
        const owner = this._player(st.owner);
        if (!owner || owner.out) return;
        const rent = this.rentOf(p.pos, g.dice ? g.dice[0] + g.dice[1] : 7);
        this._log(`${p.name} платит ${owner.name} аренду ${rent} за «${cell.name}»`);
        this._pay(p, owner, rent);
        return;
      }
      case 'tax': this._log(`${p.name}: ${cell.name} −${cell.amount}`); this._pay(p, null, cell.amount); return;
      case 'arrest': this._log(`${p.name} арестован — в Участок`); this._toJail(p); return;
      case 'luck': case 'fund': if (!fromCard) this._card(p, cell.kind); return;
      default:
    }
  }

  _card(p, deck) {
    const g = this.g;
    const list = deck === 'luck' ? LUCK : FUND;
    const pile = g[deck];
    const idx = pile.shift();
    pile.push(idx);
    const c = list[idx];
    g.card = { deck, text: c.text, seat: p.seat };
    this._log(`${p.name} — ${deck === 'luck' ? 'Удача' : 'Фонд'}: ${c.text}`);
    if (c.money > 0) p.cash += c.money;
    else if (c.money < 0) this._pay(p, null, -c.money);
    else if (c.jail) this._toJail(p);
    else if (c.jailCard) p.jailCards += 1;
    else if (c.move != null) { this._moveTo(p, c.move); this._land(p, true); }
    else if (c.back) { p.pos = (p.pos - c.back + 40) % 40; this._land(p, true); }
    else if (c.nearest) {
      let k = p.pos;
      do { k = (k + 1) % 40; } while (CELLS[k].kind !== c.nearest);
      this._moveTo(p, k);
      this._land(p, true);
    } else if (c.repairs) {
      let sum = 0;
      g.cells.forEach((st) => { if (st.owner === p.seat) sum += st.houses === 5 ? c.repairs[1] : st.houses * c.repairs[0]; });
      if (sum) this._pay(p, null, sum);
    } else if (c.each) {
      for (const o of this._alive()) {
        if (o === p || p.out) continue;
        if (c.each > 0) this._pay(o, p, c.each); else this._pay(p, o, -c.each);
      }
    }
  }

  rentOf(cellIdx, diceSum = 7) {
    const g = this.g;
    const cell = CELLS[cellIdx];
    const st = g.cells[cellIdx];
    if (st.owner == null || st.mortgaged) return 0;
    if (cell.kind === 'pier') return PIER_RENT[this._count(st.owner, 'pier')];
    if (cell.kind === 'util') return diceSum * (this._count(st.owner, 'util') === 2 ? 10 : 4);
    if (st.houses) return streetRent(cell.price, st.houses);
    const base = streetRent(cell.price, 0);
    return this._hasSet(st.owner, cell.group) ? base * 2 : base;
  }
  _count(seat, kind) { return CELLS.filter((c, i) => c.kind === kind && this.g.cells[i].owner === seat).length; }
  _groupCells(group) { return CELLS.map((c, i) => (c.group === group ? i : -1)).filter((i) => i !== -1); }
  _hasSet(seat, group) { return this._groupCells(group).every((i) => this.g.cells[i].owner === seat); }

  /** Pay money; sells houses and mortgages automatically when cash runs short. Returns false if the payer went bankrupt. */
  _pay(p, to, amount) {
    if (amount <= 0) return true;
    if (p.cash < amount) this._raise(p, amount);
    if (p.cash < amount) {
      if (to) { to.cash += p.cash; }
      p.cash = 0;
      this._log(`${p.name} не может заплатить ${amount} — банкрот`);
      this._bankrupt(p, to);
      return false;
    }
    p.cash -= amount;
    if (to) to.cash += amount;
    return true;
  }

  /** Sell houses, then mortgage the cheapest properties until `need` is covered. */
  _raise(p, need) {
    const g = this.g;
    const mine = () => g.cells.map((st, i) => ({ st, i })).filter((x) => x.st.owner === p.seat);
    let guard = 0;
    while (p.cash < need && guard++ < 200) {
      const withHouses = mine().filter((x) => x.st.houses > 0).sort((a, b) => b.st.houses - a.st.houses);
      if (!withHouses.length) break;
      const { st, i } = withHouses[0];
      st.houses -= 1;
      p.cash += GROUPS[CELLS[i].group].house / 2;
    }
    const plain = mine().filter((x) => !x.st.mortgaged && !x.st.houses).sort((a, b) => CELLS[a.i].price - CELLS[b.i].price);
    for (const { st, i } of plain) {
      if (p.cash >= need) break;
      st.mortgaged = true;
      p.cash += CELLS[i].price / 2;
      this._log(`${p.name} закладывает «${CELLS[i].name}»`);
    }
  }

  _bankrupt(p, creditor) {
    const g = this.g;
    if (p.out) return;
    p.out = true;
    g.outOrder.push(p.seat);
    g.cells.forEach((st) => {
      if (st.owner !== p.seat) return;
      if (creditor && !creditor.out) { st.owner = creditor.seat; st.houses = 0; } else { st.owner = null; st.houses = 0; st.mortgaged = false; }
    });
    if (creditor && !creditor.out) { creditor.jailCards += p.jailCards; }
    p.jailCards = 0;
    if (g.trade && (g.trade.from === p.seat || g.trade.to === p.seat)) g.trade = null;
    if (this._alive().length <= 1) { this._finish('last'); return; }
    if (this._current() === p) {
      g.pending = null;
      this._advance();
    }
  }

  // ---------- actions ----------
  buy(userId) {
    const p = this._myTurn(userId);
    const g = this.g;
    if (g.phase !== 'buy' || !g.pending) throw new GameError('Покупать нечего');
    const cell = CELLS[g.pending.cell];
    if (p.cash < cell.price) throw new GameError('Не хватает денег — заложите что-нибудь или откажитесь');
    p.cash -= cell.price;
    g.cells[g.pending.cell].owner = p.seat;
    this._log(`${p.name} покупает «${cell.name}» за ${cell.price}`);
    g.pending = null;
    g.phase = g.again ? 'roll' : 'end';
    this._arm();
    this._update();
  }
  decline(userId) { const p = this._myTurn(userId); if (this.g.phase !== 'buy') throw new GameError('Нечего пропускать'); this._decline(p); this._arm(); this._update(); }
  _decline(p) {
    const g = this.g;
    this._log(`${p.name} не покупает «${CELLS[g.pending.cell].name}»`);
    g.pending = null;
    g.phase = g.again ? 'roll' : 'end';
  }

  payBail(userId) {
    const p = this._myTurn(userId);
    if (!p.jail || this.g.phase !== 'roll') throw new GameError('Вы не в Участке');
    if (p.jailCards) { p.jailCards -= 1; this._log(`${p.name} выходит из Участка по карточке`); } else {
      if (p.cash < BAIL) throw new GameError('Не хватает денег на залог');
      p.cash -= BAIL;
      this._log(`${p.name} платит залог ${BAIL}`);
    }
    p.jail = 0;
    this._update();
  }

  build(userId, cellIdx) {
    const p = this._mine(userId);
    const g = this.g;
    if (this._current() !== p) throw new GameError('Строить можно в свой ход');
    const cell = CELLS[cellIdx];
    if (!cell || cell.kind !== 'street') throw new GameError('Здесь строить нельзя');
    const st = g.cells[cellIdx];
    if (st.owner !== p.seat) throw new GameError('Это не ваша компания');
    if (!this._hasSet(p.seat, cell.group)) throw new GameError('Сначала соберите всю отрасль');
    const group = this._groupCells(cell.group);
    if (group.some((i) => g.cells[i].mortgaged)) throw new GameError('В отрасли есть заложенные компании');
    if (st.houses >= 5) throw new GameError('Здесь уже флагман');
    if (group.some((i) => g.cells[i].houses < st.houses)) throw new GameError('Открывайте филиалы равномерно по всей отрасли');
    const cost = GROUPS[cell.group].house;
    if (p.cash < cost) throw new GameError('Не хватает денег');
    p.cash -= cost;
    st.houses += 1;
    this._log(`${p.name} открывает ${st.houses === 5 ? 'флагман' : 'филиал'} в «${cell.name}»`);
    this._update();
  }

  sell(userId, cellIdx) {
    const p = this._mine(userId);
    const g = this.g;
    const cell = CELLS[cellIdx];
    const st = g.cells[cellIdx];
    if (!cell || st.owner !== p.seat || !st.houses) throw new GameError('Продавать нечего');
    const group = this._groupCells(cell.group);
    if (group.some((i) => g.cells[i].houses > st.houses)) throw new GameError('Продавайте равномерно');
    st.houses -= 1;
    p.cash += GROUPS[cell.group].house / 2;
    this._log(`${p.name} закрывает филиал в «${cell.name}»`);
    this._update();
  }

  mortgage(userId, cellIdx) {
    const p = this._mine(userId);
    const g = this.g;
    const cell = CELLS[cellIdx];
    const st = g.cells[cellIdx];
    if (!cell || st.owner !== p.seat) throw new GameError('Это не ваша собственность');
    if (st.mortgaged) {
      const cost = Math.ceil(cell.price * 0.55);
      if (p.cash < cost) throw new GameError(`Чтобы выкупить, нужно ${cost}`);
      p.cash -= cost;
      st.mortgaged = false;
      this._log(`${p.name} выкупает «${cell.name}» за ${cost}`);
    } else {
      if (cell.group && this._groupCells(cell.group).some((i) => g.cells[i].houses)) throw new GameError('Сначала закройте филиалы в отрасли');
      st.mortgaged = true;
      p.cash += cell.price / 2;
      this._log(`${p.name} закладывает «${cell.name}» и получает ${cell.price / 2}`);
    }
    this._update();
  }

  endTurn(userId) {
    this._myTurn(userId);
    if (this.g.phase !== 'end') throw new GameError(this.g.phase === 'roll' ? 'Сначала бросьте кубики' : 'Решите, покупать ли');
    this._endTurn();
    this._arm();
    this._update();
  }

  _endTurn() {
    const g = this.g;
    if (g.endsAt && this.now() >= g.endsAt) { this._finish('time'); return; }
    this._advance();
  }
  _advance() {
    const g = this.g;
    g.doubles = 0;
    g.pending = null;
    g.card = null;
    const n = g.players.length;
    for (let k = 1; k <= n; k++) {
      const idx = (g.turn + k) % n;
      if (!g.players[idx].out) { g.turn = idx; break; }
    }
    g.phase = 'roll';
    g.dice = null;
  }

  /** Offer a swap: { to: seat, give: { cells, cash }, get: { cells, cash } }. */
  offerTrade(userId, offer) {
    const p = this._myTurn(userId);
    const g = this.g;
    const to = this._player(Number(offer && offer.to));
    if (!to || to.out || to === p) throw new GameError('Выберите соперника');
    const clean = (side, owner) => {
      const cells = [...new Set((side && side.cells) || [])].map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < 40);
      for (const i of cells) {
        if (g.cells[i].owner !== owner.seat) throw new GameError('Можно обменивать только свою собственность');
        const c = CELLS[i];
        if (c.group && this._groupCells(c.group).some((j) => g.cells[j].houses)) throw new GameError(`Сначала закройте филиалы в отрасли «${GROUPS[c.group].name}»`);
      }
      const cash = Math.max(0, Math.floor(Number(side && side.cash) || 0));
      if (cash > owner.cash) throw new GameError(`У ${owner === p ? 'вас' : owner.name} нет ${cash}`);
      return { cells, cash };
    };
    const give = clean(offer.give, p);
    const get = clean(offer.get, to);
    if (!give.cells.length && !get.cells.length) throw new GameError('В обмене должна быть хотя бы одна компания');
    g.trade = { from: p.seat, to: to.seat, give, get };
    this._log(`${p.name} предлагает обмен игроку ${to.name}`);
    this._arm();
    this._update();
  }
  answerTrade(userId, accept) {
    const me = this._mine(userId);
    const g = this.g;
    const t = g.trade;
    if (!t) throw new GameError('Предложений нет');
    if (t.to !== me.seat && !(t.from === me.seat && !accept)) throw new GameError('Это предложение не вам');
    g.trade = null;
    if (!accept) { this._log(t.from === me.seat ? `${me.name} отзывает предложение` : `${me.name} отказывается от обмена`); this._arm(); this._update(); return; }
    const from = this._player(t.from);
    // re-check: things may have changed
    if (t.give.cash > from.cash || t.get.cash > me.cash) throw new GameError('Обмен устарел — не хватает денег');
    for (const i of t.give.cells) if (g.cells[i].owner !== from.seat) throw new GameError('Обмен устарел');
    for (const i of t.get.cells) if (g.cells[i].owner !== me.seat) throw new GameError('Обмен устарел');
    t.give.cells.forEach((i) => { g.cells[i].owner = me.seat; });
    t.get.cells.forEach((i) => { g.cells[i].owner = from.seat; });
    from.cash += t.get.cash - t.give.cash;
    me.cash += t.give.cash - t.get.cash;
    this._log(`${me.name} принимает обмен с ${from.name}`);
    this._arm();
    this._update();
  }

  resign(userId) {
    const p = this._mine(userId);
    this._log(`${p.name} сдаётся`);
    this._bankrupt(p, null);
    this._arm();
    this._update();
  }

  worth(p) {
    let w = p.cash;
    this.g.cells.forEach((st, i) => {
      if (st.owner !== p.seat) return;
      const c = CELLS[i];
      w += st.mortgaged ? c.price / 2 : c.price;
      if (st.houses) w += st.houses * GROUPS[c.group].house;
    });
    return w;
  }

  _finish(reason) {
    if (this.status !== 'playing') return;
    const g = this.g;
    this._clear('_timer');
    const alive = this._alive().sort((a, b) => this.worth(b) - this.worth(a));
    const ranking = alive.concat(g.outOrder.slice().reverse().map((s) => this._player(s)));
    ranking.forEach((p, k) => { p.place = k + 1; });
    const winner = ranking[0];
    const results = [];
    for (const p of g.players) {
      const back = p === winner ? this.pot : 0;
      if (back && this.deps.pay) this.deps.pay(p.userId, back);
      this.deps.onInPlay && this.deps.onInPlay(p.userId, 0);
      results.push({ userId: p.userId, seat: p.seat, net: back - this.stake, win: p === winner, place: p.place, worth: this.worth(p) });
    }
    this.status = 'result';
    this.result = { reason, winner: { seat: winner.seat, name: winner.name }, ranking: ranking.map((p) => ({ seat: p.seat, name: p.name, place: p.place, worth: this.worth(p), out: p.out })), pot: this.pot };
    this._log(reason === 'time' ? `Время вышло. Богаче всех — ${winner.name}, забирает ${this.pot} фишек` : `${winner.name} остаётся единственным магнатом и забирает ${this.pot} фишек`);
    this.deps.onGameEnd && this.deps.onGameEnd(this, results);
    this.pot = 0;
    this._update();
    this._flow = this.timers.set(() => {
      this._flow = null;
      this.status = 'waiting';
      this.seats.forEach((s, i) => { if (s) { s.ready = false; if (!s.connected) this.seats[i] = null; } });
      this._update();
    }, this.resultPause);
  }

  destroy() {
    this._clear('_timer');
    this._clear('_flow');
    if (this.status === 'playing') for (const p of this.g.players) { if (this.deps.pay) this.deps.pay(p.userId, this.stake); this.deps.onInPlay && this.deps.onInPlay(p.userId, 0); }
    this.status = 'waiting';
  }

  addChat(name, text, hue = null) {
    this.chat.push({ t: this.now(), name, text, hue });
    if (this.chat.length > 60) this.chat.shift();
    this._update();
  }

  summary() {
    return { id: this.id, kind: 'cap', name: this.name, stake: this.stake, maxSeats: this.maxSeats, timeLimitMin: this.timeLimitMin, players: this.playerCount(), status: this.status, permanent: this.permanent, private: !!this.private, owner: this.ownerName || null };
  }

  publicState(viewerId) {
    const me = this.seatOf(viewerId);
    const g = this.g;
    const st = {
      ...this.summary(),
      gameNo: this.gameNo, pot: this.pot, mySeat: me,
      countdownIn: this.status === 'countdown' ? Math.max(0, this.countdownEnds - this.now()) : 0,
      seats: this.seats.map((s) => s && { name: s.name, ready: s.ready, connected: s.connected, avatar: this.avatarOf ? this.avatarOf(s.userId) : null }),
      log: this.log.slice(-40), chat: this.chat.slice(-30), result: this.status === 'result' ? this.result : null,
      game: null,
    };
    if (g && (this.status === 'playing' || this.status === 'result')) {
      const cur = this._current();
      st.game = {
        players: g.players.map((p) => ({ seat: p.seat, name: p.name, color: p.color, cash: p.cash, pos: p.pos, jail: p.jail, jailCards: p.jailCards, out: p.out, worth: this.worth(p), avatar: this.avatarOf ? this.avatarOf(p.userId) : null })),
        cells: g.cells.map((c, i) => ({ owner: c.owner, houses: c.houses, mortgaged: c.mortgaged, rent: c.owner != null ? this.rentOf(i) : 0 })),
        turn: cur ? cur.seat : null, phase: g.phase, dice: g.dice, pending: g.pending, card: g.card, trade: g.trade, moveNo: g.moveNo,
        deadlineIn: this._timer ? Math.max(0, g.deadline - this.now()) : 0, turnMs: g.deadlineMs || this.turnMs,
        endsIn: g.endsAt ? Math.max(0, g.endsAt - this.now()) : null,
      };
    }
    return st;
  }
}

module.exports = { CapitalTable, CELLS, GROUPS, START_CASH };
