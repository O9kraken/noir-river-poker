'use strict';
const { BlackjackRound, BlackjackError, newShoe, handValue } = require('./engine');
const { GameError } = require('../engine/table');

const DECKS = 6;
const RESHUFFLE_AT = Math.floor(DECKS * 52 * 0.25); // cut card at ~75% penetration

/**
 * A blackjack table: up to 5 boxes against the house.
 * Betting phase -> deal -> players act in turn -> dealer draws -> settle -> pause.
 * Every chip placed comes off the balance at once (deps.charge) and winnings are paid back (deps.pay).
 *
 * deps: { charge(userId, amount) -> boolean, pay(userId, amount), onUpdate(table), onInPlay(userId, amount) }
 */
class BlackjackTable {
  constructor(cfg, deps = {}, opts = {}) {
    this.id = cfg.id;
    this.kind = 'bj';
    this.name = cfg.name;
    this.minBet = cfg.minBet;
    this.maxBet = cfg.maxBet;
    this.maxSeats = cfg.maxSeats || 5;
    this.permanent = !!cfg.permanent;
    this.deps = deps;
    this.timers = opts.timers || { set: setTimeout, clear: clearTimeout };
    this.now = opts.now || Date.now;
    this.randomInt = opts.randomInt;
    this.bettingTime = opts.bettingTime ?? 12000;
    this.allInDelay = opts.allInDelay ?? 1500; // everybody bet: deal sooner
    this.actionTime = opts.actionTime ?? 20000;
    // on a slow connection the deal may reach a player late: their clock starts when their screen has it,
    // but the table never waits more than this extra time for that confirmation
    this.seenGrace = opts.seenGrace ?? Math.min(8000, Math.round(this.actionTime * 0.4));
    this.pauseMs = opts.pauseMs ?? 45000; // per round: how long to wait for a player whose connection dropped
    this.lateMs = opts.lateMs ?? (this.bettingTime >= 5000 ? 1500 : 0); // bets sent at the very end of the countdown on a slow line still make it
    this.dealerStepMs = opts.dealerStepMs ?? 750;
    this.resultPause = opts.resultPause ?? 5000;

    this.seats = Array(this.maxSeats).fill(null);
    this.status = 'betting'; // betting | playing | dealer | result
    this.round = null;
    this.roundNo = 0;
    this.shoe = newShoe(DECKS, this.randomInt);
    this.bettingEnds = 0;
    this.deadline = 0;
    this.log = [];
    this.chat = [];
    this._bet = null;
    this._turn = null;
    this._flow = null;
    this.lastActivity = this.now();
  }

  // ---------- helpers ----------
  seatOf(userId) { return this.seats.findIndex((s) => s && s.userId === userId); }
  playerCount() { return this.seats.filter(Boolean).length; }
  _log(text) { this.log.push({ t: this.now(), text }); if (this.log.length > 60) this.log.shift(); }
  _update() { this.lastActivity = this.now(); (this.deps.onUpdate || (() => {}))(this); }
  _clear(name) { if (this[name]) { this.timers.clear(this[name]); this[name] = null; } }
  _inPlay(seatObj) {
    if (!this.deps.onInPlay) return;
    const i = this.seats.indexOf(seatObj);
    const inRound = this.round ? this.round.totalBet(i) : 0;
    this.deps.onInPlay(seatObj.userId, seatObj.bet + inRound);
  }

  // ---------- seats ----------
  sit(userId, name, seatIdx) {
    if (this.seatOf(userId) !== -1) throw new GameError('Вы уже за этим столом');
    if (!Number.isInteger(seatIdx) || seatIdx < 0 || seatIdx >= this.maxSeats) throw new GameError('Нет такого места');
    if (this.seats[seatIdx]) throw new GameError('Место занято');
    this.seats[seatIdx] = { userId, name, bet: 0, lastBet: 0, connected: true, leaving: false };
    this._log(`${name} садится за стол`);
    this._update();
  }

  leave(userId) {
    const i = this.seatOf(userId);
    if (i === -1) return;
    const s = this.seats[i];
    if (s.bet) { this.deps.pay && this.deps.pay(s.userId, s.bet); s.bet = 0; }
    if (this.round && this.round.players.some((p) => p.seat === i) && this.status !== 'result') {
      // money in the round stays until it is settled; the hands simply stand
      s.leaving = true;
      if (this.status === 'playing') {
        const cur = this.round.current();
        this.round.standAll(i);
        if (cur && cur.seat === i) this._afterAction();
      }
      this._log(`${s.name} уходит после раздачи`);
      this._update();
      return;
    }
    this.seats[i] = null;
    this.deps.onInPlay && this.deps.onInPlay(s.userId, 0);
    this._log(`${s.name} уходит`);
    this._maybeCancelBetting();
    this._update();
  }

  setConnected(userId, connected) {
    const i = this.seatOf(userId);
    if (i === -1) return;
    this.seats[i].connected = connected;
    // their turn: wait for them (offline) or give the clock back (online again)
    const t = this._turnInfo;
    if (t && this.status === 'playing' && t.seat === i) this._armTurn(connected ? 'resume' : 'pause');
    this._update();
  }

  /** The player's screen shows their turn (sent by the client): start their clock from now. */
  seen(userId, key) {
    const t = this._turnInfo;
    const i = this.seatOf(userId);
    if (!t || t.seen || t.seat !== i || t.key !== key || this.status !== 'playing' || t.paused) return;
    t.seen = true;
    const left = Math.min(this.actionTime, t.start + this.actionTime + this.seenGrace - this.now());
    this._setTurnTimer(Math.max(1000, left));
    this._update();
  }

  // ---------- betting ----------
  bet(userId, amount) {
    const i = this.seatOf(userId);
    if (i === -1) throw new GameError('Сначала сядьте за стол');
    if (this.status !== 'betting') throw new GameError('Ставки принимаются между раздачами');
    amount = Math.floor(Number(amount));
    if (!Number.isFinite(amount) || amount <= 0) throw new GameError('Неверная сумма');
    const s = this.seats[i];
    if (s.bet + amount > this.maxBet) throw new GameError(`Максимальная ставка — ${this.maxBet}`);
    if (this.deps.charge && !this.deps.charge(s.userId, amount)) throw new GameError('Не хватает фишек на балансе');
    s.bet += amount;
    this._inPlay(s);
    this._scheduleDeal();
    this._update();
  }

  clearBet(userId) {
    const i = this.seatOf(userId);
    if (i === -1 || this.status !== 'betting') return;
    const s = this.seats[i];
    if (s.bet) { this.deps.pay && this.deps.pay(s.userId, s.bet); s.bet = 0; this._inPlay(s); }
    this._maybeCancelBetting();
    this._update();
  }

  rebet(userId) {
    const i = this.seatOf(userId);
    if (i === -1) throw new GameError('Сначала сядьте за стол');
    const s = this.seats[i];
    if (!s.lastBet) throw new GameError('Нечего повторять');
    const add = Math.min(s.lastBet, this.maxBet) - s.bet;
    if (add > 0) this.bet(userId, add);
  }

  _scheduleDeal() {
    const seated = this.seats.filter(Boolean);
    const allIn = seated.length && seated.every((s) => s.bet >= this.minBet);
    const ms = allIn ? this.allInDelay : this.bettingTime;
    if (this._bet && !(allIn && this.bettingEnds - this.now() > ms)) return;
    this._clear('_bet');
    this.bettingEnds = this.now() + ms;
    this._bet = this.timers.set(() => { this._bet = null; this._startRound(); }, ms + (allIn ? 0 : this.lateMs));
  }

  _maybeCancelBetting() {
    if (this.status !== 'betting') return;
    if (!this.seats.some((s) => s && s.bet > 0)) { this._clear('_bet'); this.bettingEnds = 0; }
  }

  // ---------- round ----------
  _startRound() {
    const entries = [];
    this.seats.forEach((s, i) => {
      if (!s || !s.bet) return;
      if (s.bet < this.minBet) {
        this.deps.pay && this.deps.pay(s.userId, s.bet);
        this._log(`${s.name}: ставка меньше минимальной (${this.minBet}) — возвращена`);
        s.bet = 0;
        this._inPlay(s);
        return;
      }
      entries.push({ seat: i, bet: s.bet });
    });
    if (!entries.length) { this.bettingEnds = 0; this._update(); return; }
    if (this.shoe.length < RESHUFFLE_AT) { this.shoe = newShoe(DECKS, this.randomInt); this._log('Новый шуз: 6 колод перемешаны'); }
    for (const e of entries) { const s = this.seats[e.seat]; s.lastBet = s.bet; s.bet = 0; }
    this.roundNo += 1;
    this._log(`— Раздача #${this.roundNo} —`);
    try {
      this.round = new BlackjackRound(entries, this.shoe);
    } catch (e) {
      // the shoe ran dry mid-deal: refund and start over with a fresh shoe
      for (const en of entries) this.deps.pay && this.deps.pay(this.seats[en.seat].userId, en.bet);
      this.shoe = newShoe(DECKS, this.randomInt);
      this.round = null;
      this._update();
      return;
    }
    this._userBySeat = new Map(entries.map((e) => [e.seat, this.seats[e.seat].userId]));
    this._nameBySeat = new Map(entries.map((e) => [e.seat, this.seats[e.seat].name]));
    for (const e of entries) this._inPlay(this.seats[e.seat]);
    this.status = 'playing';
    this._pauseLeft = new Map();
    if (this.round.dealerBlackjack) this._log('У дилера блэкджек');
    this._afterAction();
  }

  _name(seat) { return (this._nameBySeat && this._nameBySeat.get(seat)) || (this.seats[seat] ? this.seats[seat].name : `Бокс ${seat + 1}`); }

  act(userId, type) {
    if (this.status !== 'playing' || !this.round) throw new GameError('Сейчас не ваш ход');
    const i = this.seatOf(userId);
    const r = this.round;
    const cur = r.current();
    if (!cur || cur.seat !== i) throw new GameError('Сейчас не ваш ход');
    const s = this.seats[i];
    try {
      switch (type) {
        case 'hit': r.hit(i); this._log(`${s.name}: ещё — ${handValue(cur.hand.cards).total}`); break;
        case 'stand': r.stand(i); this._log(`${s.name}: хватит на ${handValue(cur.hand.cards).total}`); break;
        case 'double': {
          if (!r.canDouble()) throw new GameError('Удвоить нельзя');
          if (this.deps.charge && !this.deps.charge(userId, cur.hand.bet)) throw new GameError('Не хватает фишек, чтобы удвоить');
          r.double(i);
          this._log(`${s.name}: удваивает — ${handValue(cur.hand.cards).total}`);
          break;
        }
        case 'split': {
          if (!r.canSplit()) throw new GameError('Разделить нельзя');
          if (this.deps.charge && !this.deps.charge(userId, cur.hand.bet)) throw new GameError('Не хватает фишек, чтобы разделить');
          r.split(i);
          this._log(`${s.name}: делит пару`);
          break;
        }
        default: throw new GameError('Неизвестное действие');
      }
    } catch (e) {
      if (e instanceof BlackjackError) throw new GameError(e.message);
      throw e;
    }
    this._inPlay(s);
    this._afterAction();
  }

  _afterAction() {
    this._clear('_turn');
    const r = this.round;
    if (r.phase === 'player') {
      const cur = r.current();
      this._turnInfo = { seat: cur.seat, key: `${this.roundNo}:${cur.seat}:${cur.handIndex}:${cur.hand.cards.length}`, start: this.now(), seen: false, paused: null };
      this._armTurn('start');
      this._update();
      return;
    }
    this._turnInfo = null;
    if (r.phase === 'dealer') {
      this.status = 'dealer';
      this._update();
      this._flow = this.timers.set(() => { this._flow = null; this._dealerStep(); }, this.dealerStepMs);
      return;
    }
    this._settle();
  }

  /**
   * The clock of the player to act.
   *  start  — a new decision: full time, plus a grace for the deal to reach a slow connection;
   *  pause  — the player's connection dropped: wait for them, up to pauseMs per round;
   *  resume — they are back: the full time again.
   */
  _armTurn(mode) {
    const t = this._turnInfo;
    const seat = this.seats[t.seat];
    this._pauseLeft ||= new Map();
    if (!this._pauseLeft.has(t.seat)) this._pauseLeft.set(t.seat, this.pauseMs);
    if (t.paused) { // close the running pause
      this._pauseLeft.set(t.seat, Math.max(0, this._pauseLeft.get(t.seat) - (this.now() - t.paused)));
      t.paused = null;
    }
    if (!seat || seat.leaving) { this._setTurnTimer(1500); return; }
    if (mode === 'pause' || !seat.connected) {
      const budget = this._pauseLeft.get(t.seat);
      if (budget > 500) {
        t.paused = this.now();
        if (mode === 'pause') this._log(`${seat.name} не в сети — ждём до ${Math.round(budget / 1000)} с`);
        this._setTurnTimer(budget, true);
        return;
      }
      this._setTurnTimer(1500);
      return;
    }
    if (mode === 'resume') { t.seen = false; t.start = this.now(); this._log(`${seat.name} вернулся`); }
    this._setTurnTimer(this.actionTime + (t.seen ? 0 : this.seenGrace));
  }

  _setTurnTimer(ms, paused = false) {
    this._clear('_turn');
    const t = this._turnInfo;
    const key = t.key;
    this.deadline = this.now() + ms;
    this.deadlineMs = paused ? ms : this.actionTime;
    this._turn = this.timers.set(() => {
      this._turn = null;
      const c = this.round && this.round.current();
      if (!c || !this._turnInfo || this._turnInfo.key !== key) return;
      this._log(`${this._name(c.seat)}: время вышло — хватит`);
      this._turnInfo = null;
      this.round.stand(c.seat);
      this._afterAction();
    }, ms);
  }

  _dealerStep() {
    const r = this.round;
    const drew = r.dealerStep();
    if (drew) {
      this._update();
      this._flow = this.timers.set(() => { this._flow = null; this._dealerStep(); }, this.dealerStepMs);
      return;
    }
    this._settle();
  }

  _settle() {
    const r = this.round;
    const d = handValue(r.dealer.cards).total;
    this._log(r.dealerBlackjack ? 'Дилер: блэкджек' : d > 21 ? `Дилер: перебор (${d})` : `Дилер: ${d}`);
    const results = [];
    for (const p of r.players) {
      const userId = this._userBySeat.get(p.seat);
      const pay = r.totalPayout(p.seat);
      const bet = r.totalBet(p.seat);
      if (pay) this.deps.pay && this.deps.pay(userId, pay);
      const net = pay - bet;
      results.push({ userId, net, blackjacks: p.hands.filter((hd) => hd.result === 'blackjack').length });
      this._log(`${this._name(p.seat)}: ${net > 0 ? `выигрыш +${net}` : net < 0 ? `проигрыш ${net}` : 'ничья'}`);
    }
    for (const s of this.seats) if (s) this.deps.onInPlay && this.deps.onInPlay(s.userId, s.bet);
    this.deps.onRoundEnd && this.deps.onRoundEnd(this, results);
    this.status = 'result';
    this.deadline = 0;
    this._update();
    this._flow = this.timers.set(() => { this._flow = null; this._reset(); }, this.resultPause);
  }

  _reset() {
    this.round = null;
    this.status = 'betting';
    this.bettingEnds = 0;
    this.seats.forEach((s, i) => {
      if (!s) return;
      if (s.leaving) {
        if (s.bet) { this.deps.pay && this.deps.pay(s.userId, s.bet); }
        this.deps.onInPlay && this.deps.onInPlay(s.userId, 0);
        this.seats[i] = null;
      } else if (!s.connected && s.bet) {
        // offline between rounds: keep the seat for when they come back, but don't play their chips blind
        this.deps.pay && this.deps.pay(s.userId, s.bet);
        s.bet = 0;
        this._inPlay(s);
      }
    });
    // chips put down during the result pause start the countdown now
    if (this.seats.some((s) => s && s.bet > 0)) this._scheduleDeal();
    this._update();
  }

  // ---------- admin / shutdown ----------
  destroy() {
    this._clear('_bet'); this._clear('_turn'); this._clear('_flow');
    if (this.round && this.status !== 'result') {
      for (const p of this.round.players) {
        const u = this._userBySeat.get(p.seat);
        if (u) this.deps.pay && this.deps.pay(u, this.round.totalBet(p.seat));
      }
    }
    for (const s of this.seats) {
      if (!s) continue;
      if (s.bet) this.deps.pay && this.deps.pay(s.userId, s.bet);
      this.deps.onInPlay && this.deps.onInPlay(s.userId, 0);
    }
    this.round = null;
    this.seats = this.seats.map(() => null);
  }

  addChat(name, text, hue = null) {
    this.chat.push({ t: this.now(), name, text, hue });
    if (this.chat.length > 50) this.chat.shift();
    this._update();
  }

  // ---------- views ----------
  summary() {
    return {
      id: this.id, kind: 'bj', name: this.name, minBet: this.minBet, maxBet: this.maxBet,
      maxSeats: this.maxSeats, players: this.playerCount(), status: this.status, permanent: this.permanent, private: !!this.private, owner: this.ownerName || null,
    };
  }

  publicState(viewerId) {
    const r = this.round;
    const me = this.seatOf(viewerId);
    const cur = r && this.status === 'playing' ? r.current() : null;
    const handsOf = (i) => {
      if (!r) return [];
      const p = r.players.find((x) => x.seat === i);
      if (!p) return [];
      return p.hands.map((hd, k) => {
        const v = handValue(hd.cards);
        return {
          cards: hd.cards, total: v.total, soft: v.soft && v.total < 21, bet: hd.bet, doubled: hd.doubled,
          busted: hd.busted, natural: hd.natural && !hd.fromSplit, done: hd.done,
          active: !!cur && cur.seat === i && cur.handIndex === k,
          result: this.status === 'result' ? hd.result : null, payout: this.status === 'result' ? hd.payout : 0,
        };
      });
    };
    const dealerCards = r ? (r.dealer.revealed ? r.dealer.cards : [r.dealer.cards[0], null]) : [];
    const dv = r ? handValue(r.dealer.revealed ? r.dealer.cards : [r.dealer.cards[0]]) : null;
    const st = {
      ...this.summary(),
      roundNo: this.roundNo,
      bettingIn: this.status === 'betting' && this._bet ? Math.max(0, this.bettingEnds - this.now()) : 0,
      seats: this.seats.map((s, i) => s && {
        avatar: this.avatarOf ? this.avatarOf(s.userId) : null,
        name: s.name, connected: s.connected, leaving: s.leaving, bet: s.bet, lastBet: s.lastBet,
        hands: handsOf(i),
        net: r && this.status === 'result' && r.players.some((p) => p.seat === i) ? r.totalPayout(i) - r.totalBet(i) : null,
      }),
      dealer: { cards: dealerCards, total: dv ? dv.total : 0, soft: dv ? dv.soft && dv.total < 21 : false, blackjack: !!(r && r.dealerBlackjack), revealed: !!(r && r.dealer.revealed) },
      turn: cur ? { seat: cur.seat, hand: cur.handIndex } : null,
      // before the player's screen confirms the deal, show them (and everyone) the plain full time
      deadlineIn: cur ? (this._turnInfo && !this._turnInfo.seen && !this._turnInfo.paused ? Math.min(this.actionTime, Math.max(0, this.deadline - this.now())) : Math.max(0, this.deadline - this.now())) : 0,
      waiting: cur && this._turnInfo && this._turnInfo.paused ? { seat: cur.seat, name: this._name(cur.seat) } : null,
      actionTime: this.deadlineMs || this.actionTime,
      shoeLeft: this.shoe.length,
      mySeat: me,
      log: this.log.slice(-30),
      chat: this.chat.slice(-30),
      you: null,
    };
    if (me !== -1) {
      const mine = cur && cur.seat === me;
      st.you = {
        bet: this.seats[me].bet,
        lastBet: this.seats[me].lastBet,
        canBet: this.status === 'betting',
        turn: mine ? { hit: r.canHit(), stand: true, double: r.canDouble(), split: r.canSplit(), bet: cur.hand.bet, key: this._turnInfo ? this._turnInfo.key : null } : null,
      };
    }
    return st;
  }
}

module.exports = { BlackjackTable };
