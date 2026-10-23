'use strict';
const { newDeck, shuffle: secureShuffle } = require('./cards');
const { bestHand } = require('./evaluator');
const { GAMES, gameOf } = require('./games');

const STREETS = ['preflop', 'flop', 'turn', 'river'];

/** Default blind ladder (shared with tournaments). */
const LEVELS = [
  [1, 2], [2, 4], [3, 6], [5, 10], [10, 20], [15, 30], [25, 50], [40, 80], [60, 120], [100, 200], [150, 300],
  [200, 400], [300, 600], [500, 1000], [800, 1600], [1200, 2400], [2000, 4000], [3000, 6000], [5000, 10000],
];

/** Ladder that starts at the given blinds and climbs the default levels (doubling past the top). */
function ladderFrom(sb, bb, levels = LEVELS) {
  const out = [[sb, bb], ...levels.filter((l) => l[1] > bb)];
  while (out.length < 15) { const [a, b] = out[out.length - 1]; out.push([a * 2, b * 2]); }
  return out;
}
const STREET_NAMES = { preflop: 'Префлоп', flop: 'Флоп', turn: 'Тёрн', river: 'Ривер' };

class GameError extends Error {}

/**
 * One poker table: seats, chips and the hand state machine.
 * Server-authoritative: deck and hole cards never leave this object
 * except through publicState(viewerId), which hides other players' cards.
 */
class Table {
  constructor(cfg, opts = {}) {
    this.id = cfg.id;
    this.name = cfg.name;
    this.game = gameOf(cfg.game);
    this.rules = GAMES[this.game];
    this.sb = cfg.sb;
    this.bb = cfg.bb;
    this.maxSeats = Math.min(cfg.maxSeats, GAMES[gameOf(cfg.game)].maxSeats);
    this.minBuyIn = cfg.minBuyIn ?? cfg.bb * 40;
    this.maxBuyIn = cfg.maxBuyIn ?? cfg.bb * 200;
    this.permanent = !!cfg.permanent;
    this.createdBy = cfg.createdBy || null;

    this.actionTime = opts.actionTime ?? 25000;
    this.seenGrace = opts.seenGrace ?? Math.min(8000, Math.round(this.actionTime * 0.4)); // see BlackjackTable
    this.startDelay = opts.startDelay ?? 1500;
    this.pauseAfterHand = opts.pauseAfterHand ?? 4000;
    this.runoutDelay = opts.runoutDelay ?? 900;
    this.timers = opts.timers || { set: setTimeout, clear: clearTimeout };
    this.now = opts.now || Date.now;
    this.shuffle = opts.shuffle || secureShuffle;
    this.onUpdate = opts.onUpdate || (() => {});
    this.onLeave = opts.onLeave || (() => {});
    this.onHandEnd = opts.onHandEnd || (() => {});

    // Tournament mode: stacks are tournament chips, busted players are removed
    // and ranked instead of sitting out, blinds can change between hands.
    this.tournament = !!opts.tournament;
    this.autoActDelay = opts.autoActDelay ?? 1200;
    // a player who drops offline on their turn gets a pause to come back (per hand)
    this.pauseMs = opts.pauseMs ?? 60000;
    this.onBust = opts.onBust || (() => {});
    this.onTournamentEnd = opts.onTournamentEnd || (() => {});
    this.extraState = null; // () => object merged into publicState (tournament info)
    this.pendingBlinds = null;
    this.finished = false;
    this.histories = [];

    // Blinds that go up every N hands (cash tables by choice, tournaments always).
    this.baseBlinds = [this.sb, this.bb];
    this.schedule = null;
    this.setSchedule(cfg.blindsEvery || 0, cfg.levels);

    this.seats = Array(this.maxSeats).fill(null);
    this.dealer = -1;
    this.handNo = 0;
    this.hand = null;
    this.lastResult = null;
    this.log = [];
    this.chat = [];
    this._turnTimer = null;
    this._flowTimer = null;
    this.lastActivity = this.now();
  }

  // ---------- seating ----------

  seatOf(userId) {
    return this.seats.findIndex((s) => s && s.userId === userId);
  }

  playerCount() {
    return this.seats.filter(Boolean).length;
  }

  _newSeat(userId, name, stack) {
    return {
      userId, name, stack, startStack: stack,
      sittingOut: false, leaving: false, connected: true,
      inHand: false, hole: [], bet: 0, total: 0,
      folded: true, allIn: false, acted: false, revealed: false, lastAction: null,
    };
  }

  sit(userId, name, seatIdx, buyIn) {
    if (this.tournament) throw new GameError('За турнирный стол рассаживает турнир');
    if (this.seatOf(userId) !== -1) throw new GameError('Вы уже сидите за этим столом');
    if (!Number.isInteger(seatIdx) || seatIdx < 0 || seatIdx >= this.maxSeats) throw new GameError('Нет такого места');
    if (this.seats[seatIdx]) throw new GameError('Место занято');
    if (!Number.isInteger(buyIn) || buyIn < this.minBuyIn || buyIn > this.maxBuyIn) {
      throw new GameError(`Бай-ин от ${this.minBuyIn} до ${this.maxBuyIn}`);
    }
    this.seats[seatIdx] = this._newSeat(userId, name, buyIn);
    this._log(`${name} садится за стол (${buyIn})`);
    this._touch();
    this._maybeStart();
    this.onUpdate(this);
  }

  /** Tournament seating: no buy-in limits, chips are tournament chips. */
  seatDirect(userId, name, seatIdx, stack) {
    if (this.seats[seatIdx]) throw new GameError('Место занято');
    this.seats[seatIdx] = this._newSeat(userId, name, stack);
    this._log(`${name} в игре (${stack})`);
  }

  /** New blinds take effect from the next hand. */
  setBlinds(sb, bb) {
    this.pendingBlinds = { sb, bb };
    // keep climbing from the new level instead of jumping back down the old ladder
    if (this.schedule) {
      this.schedule.levels = ladderFrom(sb, bb);
      this.schedule.level = 0;
      this.schedule.handsLeft = this.schedule.every;
    }
  }

  /** Raise the blinds every `every` hands (0 turns it off). */
  setSchedule(every, levels) {
    every = Math.floor(Number(every) || 0);
    if (every <= 0) { this.schedule = null; return; }
    const cur = this.pendingBlinds ? [this.pendingBlinds.sb, this.pendingBlinds.bb] : [this.sb, this.bb];
    const ladder = levels ? levels.slice() : ladderFrom(cur[0], cur[1]);
    let level = ladder.findIndex((l) => l[1] >= cur[1]);
    if (level === -1) level = 0;
    this.schedule = { every, levels: ladder, level, handsLeft: every };
  }

  /** Blind info for the client: current level and the hand the next raise starts from. */
  blindInfo() {
    const sch = this.schedule;
    if (!sch) return null;
    const next = sch.levels[sch.level + 1] || null;
    // handsLeft = hands still to be played at this level after the last started one
    const nextAt = this.handNo + sch.handsLeft + 1;
    return { every: sch.every, level: sch.level + 1, next: next ? { sb: next[0], bb: next[1] } : null, nextAtHand: next ? nextAt : null };
  }

  start() {
    this._maybeStart();
  }

  standUp(userId) {
    const i = this.seatOf(userId);
    if (i === -1) return;
    if (this.tournament && !this.finished) throw new GameError('Из турнира нельзя выйти — включите «Пропускать раздачи»');
    const s = this.seats[i];
    if (this.hand && s.inHand) {
      // Chips already in the pot must stay until the hand is settled:
      // fold if still live, and leave the table when the hand is over.
      s.leaving = true;
      if (!this.hand.ended && !s.folded && !s.allIn) {
        if (this.hand.toAct === i) this._applyAction(i, 'fold');
        else this._foldOutOfTurn(i);
      }
      this.onUpdate(this);
      return;
    }
    this._removeSeat(i);
    this.onUpdate(this);
  }

  _removeSeat(i) {
    const s = this.seats[i];
    if (!s) return;
    this.seats[i] = null;
    this._log(`${s.name} встаёт из-за стола`);
    this.onLeave(s.userId, s.stack);
    this._touch();
    // an emptied cash table with rising blinds starts over from its base level
    if (!this.tournament && this.schedule && this.playerCount() === 0) {
      [this.sb, this.bb] = this.baseBlinds;
      this.pendingBlinds = null;
      this.setSchedule(this.schedule.every);
    }
  }

  setSittingOut(userId, value) {
    const i = this.seatOf(userId);
    if (i === -1) throw new GameError('Вы не за столом');
    const s = this.seats[i];
    if (!value && s.stack <= 0) throw new GameError('Пополните стек, чтобы вернуться в игру');
    s.sittingOut = !!value;
    if (!value) this._maybeStart();
    this.onUpdate(this);
  }

  /** Top up between hands; returns the amount actually added. */
  addChips(userId, amount) {
    if (this.tournament) throw new GameError('В турнире докупки нет');
    const i = this.seatOf(userId);
    if (i === -1) throw new GameError('Вы не за столом');
    const s = this.seats[i];
    if (this.hand && !this.hand.ended && s.inHand && !s.folded) throw new GameError('Докупка возможна между раздачами');
    if (!Number.isInteger(amount) || amount <= 0) throw new GameError('Неверная сумма');
    if (s.stack + amount > this.maxBuyIn) throw new GameError(`Максимальный стек — ${this.maxBuyIn}`);
    if (s.stack + amount < this.minBuyIn && s.stack < this.minBuyIn) {
      throw new GameError(`Стек после докупки должен быть не меньше ${this.minBuyIn}`);
    }
    s.stack += amount;
    s.sittingOut = false;
    this._log(`${s.name} докупает ${amount}`);
    this._maybeStart();
    this.onUpdate(this);
    return amount;
  }

  setConnected(userId, connected) {
    const i = this.seatOf(userId);
    if (i === -1) return;
    this.seats[i].connected = connected;
    const h = this.hand;
    if (h && !h.ended && h.toAct === i) {
      if (!connected) this._pauseTurn(i);
      else this._resumeTurn(i);
    }
    this.onUpdate(this);
  }

  /** The player to act went offline: stop their clock and wait for them a while. */
  _pauseTurn(i) {
    const h = this.hand;
    const s = this.seats[i];
    if (!h || h.paused || this.tournament && s.sittingOut) return;
    h.pauseUsed ||= {};
    const budget = this.pauseMs - (h.pauseUsed[i] || 0);
    if (budget <= 500) return;
    this._clearTurnTimer();
    const remaining = Math.max(1000, h.turnLimit - (this.now() - h.turnStarted));
    h.paused = { seat: i, since: this.now(), until: this.now() + budget, remaining };
    this._log(`${s.name} не в сети — пауза до ${Math.round(budget / 1000)} с`);
    const handNo = h.no;
    this._turnTimer = this.timers.set(() => {
      this._turnTimer = null;
      if (!this.hand || this.hand.no !== handNo || !this.hand.paused) return;
      this._endPause();
      this._onTimeout(i, handNo);
    }, budget);
  }
  _endPause() {
    const h = this.hand;
    if (!h || !h.paused) return null;
    const p = h.paused;
    h.pauseUsed[p.seat] = (h.pauseUsed[p.seat] || 0) + (this.now() - p.since);
    h.paused = null;
    return p;
  }
  _resumeTurn(i) {
    const h = this.hand;
    if (!h || !h.paused || h.paused.seat !== i) return;
    const p = this._endPause();
    this._clearTurnTimer();
    h.turnStarted = this.now() - (h.turnLimit - p.remaining);
    const handNo = h.no;
    this._turnTimer = this.timers.set(() => this._onTimeout(i, handNo), p.remaining);
    this._log(`${this.seats[i].name} вернулся — игра продолжается`);
  }

  // ---------- hand flow ----------

  _eligible() {
    const out = [];
    this.seats.forEach((s, i) => {
      // in a tournament absent players are still dealt in (and blinded off)
      if (s && s.stack > 0 && !s.leaving && (this.tournament || !s.sittingOut)) out.push(i);
    });
    return out;
  }

  _maybeStart() {
    if (this.hand || this._flowTimer || this.finished) return;
    if (this._eligible().length < 2) return;
    this._flowTimer = this.timers.set(() => { this._flowTimer = null; this._startHand(); }, this.startDelay);
  }

  _next(from, pred) {
    for (let k = 1; k <= this.maxSeats; k++) {
      const i = (from + k + this.maxSeats) % this.maxSeats;
      const s = this.seats[i];
      if (s && pred(s, i)) return i;
    }
    return -1;
  }

  _startHand() {
    const eligible = this._eligible();
    if (this.hand || eligible.length < 2) return;
    this.handNo += 1;
    this.lastResult = null;
    const sch = this.schedule;
    if (sch) {
      if (sch.handsLeft <= 0) {
        if (sch.level < sch.levels.length - 1) {
          sch.level += 1;
          const [nsb, nbb] = sch.levels[sch.level];
          this.pendingBlinds = { sb: nsb, bb: nbb };
        }
        sch.handsLeft = sch.every;
      }
      sch.handsLeft -= 1;
    }
    if (this.pendingBlinds) {
      const up = this.pendingBlinds.bb > this.bb;
      this.sb = this.pendingBlinds.sb;
      this.bb = this.pendingBlinds.bb;
      this.pendingBlinds = null;
      this._log(`Блайнды ${up ? 'повышены' : 'изменены'}: ${this.sb}/${this.bb}`);
    }
    const set = new Set(eligible);
    this.dealer = this._next(this.dealer, (s, i) => set.has(i));

    for (let i = 0; i < this.maxSeats; i++) {
      const s = this.seats[i];
      if (!s) continue;
      Object.assign(s, {
        startStack: s.stack,
        inHand: set.has(i), hole: [], bet: 0, total: 0, folded: !set.has(i),
        allIn: false, acted: false, revealed: false, lastAction: null,
      });
    }

    this.hand = {
      no: this.handNo, deck: this.shuffle(newDeck(this.rules.deck === 'short')), board: [], street: 'preflop',
      currentBet: 0, minRaise: this.bb, toAct: -1, turnStarted: 0, ended: false,
      sbIdx: -1, bbIdx: -1, turnLimit: this.actionTime,
      participants: eligible, events: [],
    };
    const h = this.hand;
    const inHand = (s, i) => set.has(i);
    if (eligible.length === 2) {
      h.sbIdx = this.dealer;
      h.bbIdx = this._next(this.dealer, inHand);
    } else {
      h.sbIdx = this._next(this.dealer, inHand);
      h.bbIdx = this._next(h.sbIdx, inHand);
    }
    this._log(`— Раздача #${this.handNo} —`);
    this._post(h.sbIdx, this.sb, 'SB');
    this._post(h.bbIdx, this.bb, 'BB');
    h.currentBet = this.bb;
    h.minRaise = this.bb;
    h.raises = 1; // the big blind counts as the first bet: an open is a 2-bet, a re-raise a 3-bet

    const holeCount = this.rules.hole;
    for (let r = 0; r < holeCount; r++) {
      let i = this.dealer;
      for (let k = 0; k < eligible.length; k++) {
        i = this._next(i, inHand);
        this.seats[i].hole.push(h.deck.pop());
      }
    }
    this._snap(`Раздача #${this.handNo}: блайнды ${this.sb}/${this.bb}, карты розданы`);
    this._touch();
    this._continueFrom(h.bbIdx);
  }

  _post(i, amount, label) {
    const s = this.seats[i];
    const amt = Math.min(amount, s.stack);
    this._put(s, amt);
    s.lastAction = label;
    this._log(`${s.name}: ${label} ${amt}${s.allIn ? ' (олл-ин)' : ''}`);
  }

  _put(s, amt) {
    s.stack -= amt;
    s.bet += amt;
    s.total += amt;
    if (s.stack === 0) s.allIn = true;
  }

  _canAct(s) { return s.inHand && !s.folded && !s.allIn; }

  _othersCanAct(i) {
    return this.seats.some((s, j) => s && j !== i && this._canAct(s));
  }

  _needsAction(s, i) {
    if (!this._canAct(s)) return false;
    if (s.bet < this.hand.currentBet) return true;
    return !s.acted && this._othersCanAct(i);
  }

  _contenders() {
    return this.seats.filter((s) => s && s.inHand && !s.folded);
  }

  _continueFrom(fromIdx) {
    if (this._contenders().length === 1) return this._finishUncontested();
    const next = this._next(fromIdx, (s, i) => this._needsAction(s, i));
    if (next !== -1) return this._setTurn(next);
    return this._endStreet();
  }

  _setTurn(i) {
    const h = this.hand;
    h.toAct = i;
    h.turnStarted = this.now();
    this._clearTurnTimer();
    const handNo = h.no;
    // an absent tournament player acts automatically after a short pause
    h.turnLimit = this.tournament && this.seats[i].sittingOut ? this.autoActDelay : this.actionTime;
    h.turnSeq = (h.turnSeq || 0) + 1;
    h.turnSeen = h.turnLimit !== this.actionTime; // auto-acting seats need no confirmation
    // until the player's screen confirms their turn, allow a little extra for a slow connection
    this._turnTimer = this.timers.set(() => this._onTimeout(i, handNo), h.turnLimit + (h.turnSeen ? 0 : this.seenGrace));
    if (!this.seats[i].connected && !(this.tournament && this.seats[i].sittingOut)) this._pauseTurn(i);
    this.onUpdate(this);
  }

  /** The client of the player to act has their turn on screen: the full time counts from now. */
  seen(userId, key) {
    const h = this.hand;
    if (!h || h.ended || h.paused || h.turnSeen || h.toAct === -1) return;
    const i = this.seats.findIndex((s) => s && s.userId === userId);
    if (i !== h.toAct || key !== `${h.no}:${h.turnSeq}`) return;
    h.turnSeen = true;
    const left = Math.max(1000, Math.min(h.turnLimit, h.turnLimit + this.seenGrace - (this.now() - h.turnStarted)));
    if (this._turnTimer) { this.timers.clear(this._turnTimer); this._turnTimer = null; }
    h.turnStarted = this.now() - (h.turnLimit - left);
    const handNo = h.no;
    this._turnTimer = this.timers.set(() => this._onTimeout(i, handNo), left);
    this.onUpdate(this);
  }

  _clearTurnTimer() {
    if (this.hand && this.hand.paused) this._endPause();
    if (this._turnTimer) { this.timers.clear(this._turnTimer); this._turnTimer = null; }
  }

  _onTimeout(i, handNo) {
    this._turnTimer = null;
    const h = this.hand;
    if (!h || h.ended || h.no !== handNo || h.toAct !== i) return;
    const s = this.seats[i];
    if (!s.sittingOut) this._log(`${s.name}: время вышло`);
    s.sittingOut = true; // don't hold the table up next hand
    this._applyAction(i, s.bet >= h.currentBet ? 'check' : 'fold');
  }

  /** Limits for a raise, as "raise to" totals for the current street. */
  raiseLimits(i) {
    const h = this.hand;
    const s = this.seats[i];
    const toCall = Math.max(0, h.currentBet - s.bet);
    const maxTotal = s.bet + s.stack;
    if (s.stack <= toCall || !this._othersCanAct(i)) return null;
    // A player who already acted may only re-raise if facing a full raise (acted reset).
    if (s.acted) return null;
    if (this.rules.limit === 'fixed') {
      // Limit: one fixed step, small bet on preflop/flop, big bet on turn/river, cap of 4 bets
      if ((h.raises || 0) >= 4) return null;
      const unit = h.street === 'preflop' || h.street === 'flop' ? this.bb : this.bb * 2;
      const to = Math.min(h.currentBet + unit, maxTotal);
      return { minTo: to, maxTo: to };
    }
    let maxTo = maxTotal;
    if (this.rules.limit === 'pot') {
      const pot = this.seats.reduce((sum, p) => sum + (p ? p.total : 0), 0);
      maxTo = Math.min(maxTotal, h.currentBet + pot + toCall);
    }
    const minTo = Math.min(h.currentBet + h.minRaise, maxTotal);
    return { minTo, maxTo: Math.max(minTo, maxTo) };
  }

  act(userId, type, amount) {
    const h = this.hand;
    if (!h || h.ended) throw new GameError('Раздача не идёт');
    const i = this.seatOf(userId);
    if (i === -1 || h.toAct !== i) throw new GameError('Сейчас не ваш ход');
    const s = this.seats[i];
    if (s.sittingOut) s.sittingOut = false; // acting means you're back
    this._applyAction(i, type, amount);
  }

  _applyAction(i, type, amount) {
    const h = this.hand;
    const s = this.seats[i];
    const toCall = Math.max(0, h.currentBet - s.bet);

    if (type === 'allin') {
      const lim = this.raiseLimits(i);
      if (lim) { type = 'raise'; amount = lim.maxTo; } else { type = toCall > 0 ? 'call' : 'check'; }
    }

    switch (type) {
      case 'fold':
        s.folded = true;
        s.lastAction = 'Фолд';
        break;
      case 'check':
        if (toCall > 0) throw new GameError('Нельзя чекнуть: нужно уравнять ставку');
        s.lastAction = 'Чек';
        break;
      case 'call': {
        if (toCall <= 0) throw new GameError('Нечего уравнивать');
        this._put(s, Math.min(toCall, s.stack));
        s.lastAction = s.allIn ? 'Олл-ин' : 'Колл';
        break;
      }
      case 'bet':
      case 'raise': {
        const lim = this.raiseLimits(i);
        if (!lim) throw new GameError('Рейз сейчас недоступен');
        if (!Number.isInteger(amount)) throw new GameError('Неверная сумма');
        if (amount < lim.minTo || amount > lim.maxTo) throw new GameError(`Ставка от ${lim.minTo} до ${lim.maxTo}`);
        if (amount <= h.currentBet) throw new GameError('Ставка должна быть больше текущей');
        const raiseSize = amount - h.currentBet;
        const wasBet = h.currentBet === 0;
        this._put(s, amount - s.bet);
        if (raiseSize >= h.minRaise) {
          h.minRaise = raiseSize;
          h.raises = (h.raises || 0) + 1;
          // a full raise reopens the action for everyone else
          this.seats.forEach((p, j) => { if (p && j !== i && this._canAct(p)) p.acted = false; });
        }
        h.currentBet = amount;
        s.lastAction = s.allIn ? 'Олл-ин' : wasBet ? 'Бет' : 'Рейз';
        break;
      }
      default:
        throw new GameError('Неизвестное действие');
    }

    s.acted = true;
    this._clearTurnTimer();
    const amt = type === 'call' || type === 'bet' || type === 'raise' ? ` ${s.bet}` : '';
    this._log(`${s.name}: ${s.lastAction.toLowerCase()}${amt}`);
    this._snap(`${s.name}: ${s.lastAction.toLowerCase()}${amt}`);
    this._touch();
    this._continueFrom(i);
  }

  _foldOutOfTurn(i) {
    const s = this.seats[i];
    s.folded = true;
    s.lastAction = 'Фолд';
    this._log(`${s.name}: фолд`);
    this._snap(`${s.name}: фолд`);
    if (this._contenders().length === 1) this._finishUncontested();
  }

  _endStreet() {
    const h = this.hand;
    this._clearTurnTimer();
    h.toAct = -1;
    for (const s of this.seats) {
      if (!s) continue;
      s.bet = 0;
      s.acted = false;
      if (s.inHand && !s.folded && !s.allIn) s.lastAction = null;
    }
    h.currentBet = 0;
    h.minRaise = this.bb;
    h.raises = 0;

    const idx = STREETS.indexOf(h.street);
    if (idx === STREETS.length - 1) return this._showdown();

    h.street = STREETS[idx + 1];
    h.deck.pop(); // burn
    const n = h.street === 'flop' ? 3 : 1;
    for (let k = 0; k < n; k++) h.board.push(h.deck.pop());
    this._log(`${STREET_NAMES[h.street]}: ${h.board.join(' ')}`);
    this._snap(STREET_NAMES[h.street]);

    const actors = this.seats.filter((s) => s && this._canAct(s)).length;
    if (actors <= 1) {
      // everyone is all-in: reveal and run the board out
      this._contenders().forEach((s) => { s.revealed = true; });
      this.onUpdate(this);
      this._flowTimer = this.timers.set(() => { this._flowTimer = null; this._endStreet(); }, this.runoutDelay);
      return;
    }
    this._continueFrom(this.dealer);
  }

  /** Return the part of the biggest contribution nobody matched. */
  _returnUncalled() {
    const inHand = this.seats.filter((s) => s && s.inHand);
    const sorted = inHand.slice().sort((a, b) => b.total - a.total);
    if (sorted.length < 2) return;
    const excess = sorted[0].total - sorted[1].total;
    if (excess > 0) {
      sorted[0].total -= excess;
      sorted[0].stack += excess;
      if (sorted[0].bet >= excess) sorted[0].bet -= excess;
      this._log(`${sorted[0].name}: возврат ${excess}`);
    }
  }

  /** Main pot and side pots from each player's total contribution. */
  computePots() {
    const all = this.seats.filter((s) => s && s.inHand);
    const contenders = all.filter((s) => !s.folded);
    const levels = [...new Set(contenders.map((s) => s.total))].sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const level of levels) {
      let amount = 0;
      for (const s of all) amount += Math.min(s.total, level) - Math.min(s.total, prev);
      const eligible = contenders.filter((s) => s.total >= level);
      const last = pots[pots.length - 1];
      if (last && last.eligible.length === eligible.length) last.amount += amount;
      else if (amount > 0) pots.push({ amount, eligible });
      prev = level;
    }
    const total = all.reduce((sum, s) => sum + s.total, 0);
    const counted = pots.reduce((sum, p) => sum + p.amount, 0);
    if (pots.length && total > counted) pots[pots.length - 1].amount += total - counted; // dead money
    return pots;
  }

  _showdown() {
    const h = this.hand;
    this._returnUncalled();
    const contenders = this._contenders();
    const hands = new Map();
    for (const s of contenders) {
      s.revealed = true;
      hands.set(s, bestHand(this.game, s.hole, h.board));
    }
    const pots = this.computePots();
    const winnings = new Map();
    const potResults = [];
    pots.forEach((pot, potIdx) => {
      let best = -1;
      let winners = [];
      for (const s of pot.eligible) {
        const sc = hands.get(s).score;
        if (sc > best) { best = sc; winners = [s]; } else if (sc === best) winners.push(s);
      }
      // odd chips go to the first winner left of the dealer
      winners.sort((a, b) => this._distFromDealer(a) - this._distFromDealer(b));
      const share = Math.floor(pot.amount / winners.length);
      let rest = pot.amount - share * winners.length;
      for (const w of winners) {
        const won = share + (rest-- > 0 ? 1 : 0);
        w.stack += won;
        winnings.set(w, (winnings.get(w) || 0) + won);
      }
      potResults.push({
        name: potIdx === 0 ? 'Основной банк' : `Побочный банк ${potIdx}`,
        amount: pot.amount,
        winners: winners.map((w) => ({ seat: this.seats.indexOf(w), name: w.name, hand: hands.get(w).name })),
      });
      this._log(`${winners.map((w) => w.name).join(', ')} ${winners.length > 1 ? 'делят' : 'забирает'} ${pot.amount} — ${hands.get(winners[0]).name}`);
    });

    this.lastResult = {
      handNo: h.no,
      showdown: true,
      pots: potResults,
      players: contenders.map((s) => ({
        seat: this.seats.indexOf(s), name: s.name, hand: hands.get(s).name, category: hands.get(s).category,
        best: hands.get(s).cards, won: winnings.get(s) || 0,
      })),
    };
    this._finishHand();
  }

  _finishUncontested() {
    this._clearTurnTimer();
    this._returnUncalled();
    const winner = this._contenders()[0];
    const pot = this.seats.reduce((sum, s) => sum + (s && s.inHand ? s.total : 0), 0);
    winner.stack += pot;
    this._log(`${winner.name} забирает ${pot}`);
    this.lastResult = {
      handNo: this.hand.no,
      showdown: false,
      pots: [{ name: 'Банк', amount: pot, winners: [{ seat: this.seats.indexOf(winner), name: winner.name, hand: null }] }],
      players: [{ seat: this.seats.indexOf(winner), name: winner.name, hand: null, won: pot }],
    };
    this._finishHand();
  }

  _distFromDealer(s) {
    const i = this.seats.indexOf(s);
    return (i - this.dealer - 1 + this.maxSeats) % this.maxSeats;
  }

  _finishHand() {
    const h = this.hand;
    h.ended = true;
    h.toAct = -1;
    this._clearTurnTimer();
    for (const s of this.seats) if (s) { s.bet = 0; }
    this._recordHistory();
    if (this._flowTimer) { this.timers.clear(this._flowTimer); this._flowTimer = null; }
    this.onHandEnd(this);
    this.onUpdate(this);
    this._flowTimer = this.timers.set(() => {
      this._flowTimer = null;
      this._cleanupAfterHand();
    }, this.pauseAfterHand);
  }

  _cleanupAfterHand() {
    const busted = [];
    for (let i = 0; i < this.maxSeats; i++) {
      const s = this.seats[i];
      if (!s) continue;
      if (s.leaving) { this._removeSeat(i); continue; }
      if (this.tournament && s.stack <= 0) {
        busted.push({ seat: i, userId: s.userId, name: s.name, startStack: s.startStack || 0 });
        this.seats[i] = null;
        continue;
      }
      Object.assign(s, { inHand: false, hole: [], total: 0, folded: true, allIn: false, revealed: false, lastAction: null });
      if (s.stack <= 0) s.sittingOut = true;
    }
    this.hand = null;
    if (busted.length) {
      // several players out in one hand: the bigger starting stack places higher
      busted.sort((a, b) => a.startStack - b.startStack);
      busted.forEach((b) => this._log(`${b.name} выбывает из турнира`));
      this.onBust(busted);
    }
    if (this.tournament && this.playerCount() <= 1) {
      this.finished = true;
      this.onTournamentEnd(this);
      this.onUpdate(this);
      return;
    }
    this._maybeStart();
    this.onUpdate(this);
  }

  // ---------- hand history ----------

  _snap(text) {
    const h = this.hand;
    if (!h) return;
    const pot = this.seats.reduce((sum, s) => sum + (s && s.inHand ? s.total : 0), 0);
    h.events.push({
      text, street: h.street, board: h.board.slice(), pot,
      players: h.participants.map((i) => {
        const s = this.seats[i];
        return { seat: i, name: s.name, stack: s.stack, bet: s.bet, folded: s.folded, allIn: s.allIn, action: s.lastAction, cards: s.hole.slice() };
      }),
    });
  }

  _recordHistory() {
    const h = this.hand;
    const r = this.lastResult;
    if (r) {
      const text = r.pots.map((p) => `${p.winners.map((w) => w.name).join(', ')} ${p.winners.length > 1 ? 'делят' : 'забирает'} ${p.amount}${p.winners[0].hand ? ` — ${p.winners[0].hand}` : ''}`).join('; ');
      this._snap(text);
    }
    this.histories.push({
      handNo: h.no, time: this.now(), game: this.game, sb: this.sb, bb: this.bb, dealer: this.dealer,
      players: h.participants.map((i) => {
        const s = this.seats[i];
        return { seat: i, userId: s.userId, name: s.name, startStack: s.startStack, endStack: s.stack };
      }),
      revealed: new Set(h.participants.filter((i) => this.seats[i].revealed)),
      events: h.events,
      result: r,
    });
    if (this.histories.length > 20) this.histories.shift();
  }

  /** After the hand: a player may show the cards nobody had to show. */
  showCards(userId) {
    const i = this.seatOf(userId);
    const h = this.hand;
    if (i === -1 || !h || !h.ended) throw new GameError('Показать карты можно после окончания раздачи');
    const s = this.seats[i];
    if (!s.inHand || !s.hole.length) throw new GameError('Вы не участвовали в раздаче');
    if (s.revealed) return;
    s.revealed = true;
    const hist = this.histories[this.histories.length - 1];
    if (hist && hist.handNo === h.no) hist.revealed.add(i);
    this._log(`${s.name} показывает: ${s.hole.join(' ')}`);
    this.onUpdate(this);
  }

  historyList(viewerId) {
    return this.histories.slice().reverse().map((hh) => {
      const me = hh.players.find((p) => p.userId === viewerId);
      const pots = hh.result ? hh.result.pots : [];
      return {
        handNo: hh.handNo, time: hh.time, sb: hh.sb, bb: hh.bb,
        pot: pots.reduce((a, p) => a + p.amount, 0),
        winners: pots.length ? pots[0].winners.map((w) => w.name) : [],
        hand: pots.length ? pots[0].winners[0].hand : null,
        myNet: me ? me.endStack - me.startStack : null,
      };
    });
  }

  replay(viewerId, handNo) {
    const hh = this.histories.find((x) => x.handNo === handNo);
    if (!hh) throw new GameError('Раздача не найдена');
    const mine = hh.players.find((p) => p.userId === viewerId);
    const mySeat = mine ? mine.seat : -1;
    const visible = (seat) => seat === mySeat || hh.revealed.has(seat);
    return {
      handNo: hh.handNo, time: hh.time, game: hh.game, sb: hh.sb, bb: hh.bb, dealer: hh.dealer, mySeat,
      maxSeats: this.maxSeats,
      players: hh.players.map(({ userId, ...p }) => p),
      result: hh.result,
      events: hh.events.map((e) => ({
        ...e,
        players: e.players.map((p) => ({ ...p, cards: visible(p.seat) ? p.cards : null, cardCount: p.cards.length })),
      })),
    };
  }

  // ---------- chat / log ----------

  _log(text) {
    this.log.push({ t: this.now(), text });
    if (this.log.length > 60) this.log.shift();
  }

  addChat(name, text, hue = null) {
    this.chat.push({ t: this.now(), name, text, hue });
    if (this.chat.length > 50) this.chat.shift();
    this.onUpdate(this);
  }

  _touch() { this.lastActivity = this.now(); }

  /** Total chips owned by this table (stacks + money in the pot). */
  chipsOnTable() {
    return this.seats.reduce((sum, s) => sum + (s ? s.stack + (this.hand && !this.hand.ended && s.inHand ? s.total : 0) : 0), 0);
  }

  destroy() {
    this._clearTurnTimer();
    if (this._flowTimer) { this.timers.clear(this._flowTimer); this._flowTimer = null; }
    for (let i = 0; i < this.maxSeats; i++) {
      const s = this.seats[i];
      if (!s) continue;
      // refund money in an unfinished hand
      const refund = s.stack + (this.hand && !this.hand.ended && s.inHand ? s.total : 0);
      this.seats[i] = null;
      this.onLeave(s.userId, refund);
    }
    this.hand = null;
  }

  // ---------- views ----------

  summary() {
    return {
      id: this.id, name: this.name, game: this.game, sb: this.sb, bb: this.bb,
      maxSeats: this.maxSeats, players: this.playerCount(),
      minBuyIn: this.minBuyIn, maxBuyIn: this.maxBuyIn, permanent: this.permanent, private: !!this.private, owner: this.ownerName || null,
      tournament: this.tournament,
      blindsEvery: this.schedule ? this.schedule.every : 0,
    };
  }

  publicState(viewerId) {
    const h = this.hand;
    const me = this.seatOf(viewerId);
    const pot = this.seats.reduce((sum, s) => sum + (s && h && s.inHand ? s.total : 0), 0);
    const potBehind = this.seats.reduce((sum, s) => sum + (s && h && s.inHand ? s.total - s.bet : 0), 0);

    const state = {
      ...this.summary(),
      handNo: this.handNo,
      inHand: !!(h && !h.ended),
      street: h ? h.street : null,
      board: h ? h.board : [],
      pot,
      potBehind,
      dealer: this.dealer,
      sbIdx: h ? h.sbIdx : -1,
      bbIdx: h ? h.bbIdx : -1,
      toAct: h && !h.ended ? h.toAct : -1,
      turnRemaining: h && !h.ended && h.toAct !== -1 ? (h.paused ? h.paused.remaining : Math.max(0, h.turnLimit - (this.now() - h.turnStarted))) : 0,
      turnKey: h && !h.ended && h.toAct !== -1 ? `${h.no}:${h.turnSeq}` : null,
      paused: h && !h.ended && h.paused ? { seat: h.paused.seat, name: this.seats[h.paused.seat] ? this.seats[h.paused.seat].name : '', left: Math.max(0, h.paused.until - this.now()) } : null,
      actionTime: h && h.toAct !== -1 ? h.turnLimit : this.actionTime,
      currentBet: h ? h.currentBet : 0,
      raises: h && !h.ended ? h.raises || 0 : 0,
      mySeat: me,
      seats: this.seats.map((s, i) => s && {
        avatar: this.avatarOf ? this.avatarOf(s.userId) : null,
        name: s.name,
        stack: s.stack,
        bet: s.bet,
        inHand: s.inHand,
        folded: s.folded,
        allIn: s.allIn,
        sittingOut: s.sittingOut,
        connected: s.connected,
        leaving: s.leaving,
        lastAction: s.lastAction,
        cards: s.inHand && (i === me || s.revealed) ? s.hole : null,
        cardCount: s.inHand && !s.folded ? s.hole.length : 0,
      }),
      result: h && h.ended ? this.lastResult : null,
      finished: this.finished,
      blinds: this.blindInfo(),
      tournamentInfo: this.extraState ? this.extraState(viewerId) : null,
      log: this.log.slice(-30),
      chat: this.chat.slice(-30),
      you: null,
    };

    if (me !== -1) {
      const s = this.seats[me];
      state.you = {
        stack: s.stack,
        sittingOut: s.sittingOut,
        canRebuy: !this.tournament && s.stack < this.maxBuyIn,
        canShow: !!(h && h.ended && s.inHand && s.hole.length && !s.revealed),
      };
      if (h && !h.ended && h.toAct === me) {
        const toCall = Math.max(0, h.currentBet - s.bet);
        const lim = this.raiseLimits(me);
        state.you.turn = {
          toCall: Math.min(toCall, s.stack),
          canCheck: toCall === 0,
          canRaise: !!lim,
          minTo: lim ? lim.minTo : 0,
          maxTo: lim ? lim.maxTo : 0,
          myBet: s.bet,
          isBet: h.currentBet === 0,
        };
      }
    }
    return state;
  }
}

module.exports = { Table, GameError, LEVELS, ladderFrom };
