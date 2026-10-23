'use strict';
/**
 * «Подземелье» — a comic dungeon crawl for 3–6 players, in the spirit of the classic party card games.
 * Kick the door, fight what's behind it, grab the loot, and be the first to reach the target level
 * (it can only be reached by winning a fight). Everyone else may help you — or make your life harder.
 */
const { GameError, shuffle } = require('./base');
const { CARDS, CARDS_MAT, CLASS_NAMES, BAD_TEXT } = require('./dungeon-cards');

const HAND_LIMIT = 5;
const SLOTS = ['head', 'body', 'feet'];

class DungeonGame {
  static get meta() { return { id: 'dungeon', title: 'Подземелье', min: 3, max: 6 }; }
  // the classic: up to level 10; «Без цензуры» swaps the card jokes for saltier ones
  static options(o) { return { goal: 10, mat: o.mat === true || o.mat === 1 || o.mat === '1' }; }

  constructor(host, players, options) {
    this.host = host;
    this.rng = host.rng;
    this.goal = options.goal;
    this.mat = !!options.mat;
    this.seq = 0;
    this.ev = null;
    this.order = players.map((p) => p.seat);
    this.ps = new Map(this.order.map((s) => [s, { seat: s, level: 1, cls: null, eq: { head: null, body: null, feet: null, hands: [], misc: [] }, hand: [], dead: false }]));
    let id = 0;
    const build = (deck) => {
      const out = [];
      for (const c of Object.values(CARDS)) if (c.deck === deck) for (let i = 0; i < (c.copies || 1); i++) out.push({ id: ++id, k: c.k });
      return shuffle(out, this.rng);
    };
    this.doors = build('door');
    this.treasures = build('treasure');
    this.doorDiscard = [];
    this.trDiscard = [];
    for (const s of this.order) this._deal(s, 4, 4);
    this.cur = this.order[Math.floor(this.rng() * this.order.length)];
    this.phase = 'start'; // start | after | fight | over
    this.fight = null;
    host.sys(`Цель — ${this.goal} уровень. Последний уровень можно взять только победой над монстром.`);
    this._armTurn();
  }

  // ---------- helpers ----------
  _event(type, by, text, extra = {}) { this.seq += 1; this.ev = { seq: this.seq, type, by, text, ...extra }; if (text) this.host.addLog(text); }
  _n(seat) { return this.host.nameOf(seat); }
  p(seat) { const p = this.ps.get(seat); if (!p) throw new GameError('Вы не в игре'); return p; }
  def(card) { return CARDS[card.k]; }
  _drawDoor() { if (!this.doors.length) { this.doors = shuffle(this.doorDiscard, this.rng); this.doorDiscard = []; } return this.doors.shift() || null; }
  _drawTreasure() { if (!this.treasures.length) { this.treasures = shuffle(this.trDiscard, this.rng); this.trDiscard = []; } return this.treasures.shift() || null; }
  _discard(card) { if (!card) return; (this.def(card).deck === 'door' ? this.doorDiscard : this.trDiscard).push(card); }
  _deal(seat, d, t) {
    const p = this.p(seat);
    for (let i = 0; i < d; i++) { const c = this._drawDoor(); if (c) p.hand.push(c); }
    for (let i = 0; i < t; i++) { const c = this._drawTreasure(); if (c) p.hand.push(c); }
  }
  _fromHand(p, id) {
    const i = p.hand.findIndex((c) => c.id === Number(id));
    if (i === -1) throw new GameError('Нет такой карты');
    return p.hand.splice(i, 1)[0];
  }
  _peekHand(p, id) { const c = p.hand.find((x) => x.id === Number(id)); if (!c) throw new GameError('Нет такой карты'); return c; }
  _items(p) { return [p.eq.head, p.eq.body, p.eq.feet, ...p.eq.hands, ...p.eq.misc].filter(Boolean); }

  strength(seat, undead = false) {
    const p = this.p(seat);
    let s = p.level;
    for (const c of this._items(p)) { const d = this.def(c); s += d.bonus || 0; if (undead && d.vsUndead) s += d.vsUndead; }
    if (p.cls === 'brute') s += 1;
    if (p.cls === 'healer' && undead) s += 3;
    return s;
  }
  escapeBonus(seat) {
    const p = this.p(seat);
    let b = p.cls === 'thief' ? 1 : 0;
    for (const c of this._items(p)) b += this.def(c).escape || 0;
    return b;
  }

  _armTurn() {
    this.host.clear('fight');
    const ms = this.phase === 'fight' ? 75000 : this.phase === 'charity' ? 30000 : 45000;
    this.host.turn(this.cur, ms, () => this._auto());
  }
  resume() {
    this._armTurn();
    if (this.fight && this.fight.final) this.host.timer('fight', 6000, () => this._resolveFight(), false);
  }
  _auto() {
    if (this.phase === 'start') { this._kick(this.cur); return; }
    if (this.phase === 'after') { this._loot(this.cur); return; }
    if (this.phase === 'fight') { this._resolveFight(); return; }
    if (this.phase === 'charity') this._give(this.cur, this._cheapest(this.p(this.cur), this.p(this.cur).hand.length - HAND_LIMIT).map((c) => c.id), true);
  }

  // ---------- turns ----------
  _beginTurn() {
    const p = this.p(this.cur);
    if (p.dead) { p.dead = false; this._deal(this.cur, 2, 2); this.host.sys(`${this._n(this.cur)} возвращается из мёртвых с новыми картами`); }
    this.phase = 'start';
    this.fight = null;
    this._armTurn();
  }
  _next() {
    const i = this.order.indexOf(this.cur);
    this.cur = this.order[(i + 1) % this.order.length];
    this._beginTurn();
  }
  /**
   * End of turn: more than five cards in hand — the player chooses which ones to give away
   * (to the lowest-level player, or to the discard if that is them). Until then they may still
   * put on gear, sell or use levels to shrink the hand. On timeout the cheapest cards go.
   */
  _charity() {
    const p = this.p(this.cur);
    if (p.hand.length > HAND_LIMIT) {
      this.phase = 'charity';
      this._event('charity', this.cur, `${this._n(this.cur)}: в руке ${p.hand.length} карт при лимите ${HAND_LIMIT} — выбирает, что отдать`);
      this._armTurn();
      return;
    }
    this._next();
  }
  _cardVal(c) { const d = this.def(c); return d.type === 'level' ? 100 : d.type === 'oneshot' ? 50 : d.gold || 10; }
  _cheapest(p, n) { return [...p.hand].sort((a, b) => this._cardVal(a) - this._cardVal(b)).slice(0, Math.max(0, n)); }
  _charityTo() {
    const p = this.p(this.cur);
    const others = this.order.filter((s) => s !== this.cur);
    const low = Math.min(...others.map((s) => this.p(s).level));
    const lowest = others.filter((s) => this.p(s).level === low);
    return p.level <= low || !lowest.length ? null : lowest[0];
  }
  /** Give away exactly the extra cards. */
  _give(seat, ids, auto = false) {
    const p = this._mine(seat, ['charity']);
    const need = p.hand.length - HAND_LIMIT;
    const list = [...new Set((Array.isArray(ids) ? ids : []).map(Number))];
    if (list.length !== need) throw new GameError(`Выберите ровно ${need} ${need === 1 ? 'карту' : need < 5 ? 'карты' : 'карт'}`);
    const give = list.map((id) => this._peekHand(p, id));
    p.hand = p.hand.filter((c) => !give.includes(c));
    const to = this._charityTo();
    const names = give.map((c) => this.def(c).name).join(', ');
    if (to == null) { give.forEach((c) => this._discard(c)); this._event('gave', seat, `${this._n(seat)}${auto ? ' не успел выбрать и' : ''} сбрасывает лишнее: ${names}`); }
    else { this.p(to).hand.push(...give); this._event('gave', seat, `${this._n(seat)}${auto ? ' не успел выбрать и' : ''} отдаёт лишнее ${this._n(to)}: ${names}`, { to }); }
    this._next();
  }
  /** After gear/sale/level during the charity phase: maybe the hand already fits. */
  _charityCheck() { if (this.phase === 'charity' && this.p(this.cur).hand.length <= HAND_LIMIT) this._next(); }

  act(seat, type, x) {
    if (this.phase === 'over') throw new GameError('Партия окончена');
    switch (type) {
      case 'kick': return this._kick(seat);
      case 'trouble': return this._trouble(seat, x.card);
      case 'loot': return this._loot(seat);
      case 'equip': return this._equip(seat, x.card);
      case 'unequip': return this._unequip(seat, x.card);
      case 'class': return this._class(seat, x.card);
      case 'level': return this._level(seat, x.card);
      case 'sell': return this._sell(seat, x.cards);
      case 'curse': return this._curse(seat, x.card, Number(x.target));
      case 'oneshot': return this._oneshot(seat, x.card, x.side);
      case 'mod': return this._mod(seat, x.card, Number(x.monster || 0));
      case 'wander': return this._wander(seat, x.card, x.monster);
      case 'offer': return this._offer(seat);
      case 'accept': return this._accept(seat, Number(x.helper));
      case 'burn': return this._burn(seat, x.card);
      case 'go': return this._go(seat);
      case 'run': return this._run(seat);
      case 'give': return this._give(seat, x.cards);
      default: throw new GameError('Неизвестный ход');
    }
  }

  _mine(seat, phases) {
    if (seat !== this.cur) throw new GameError('Сейчас не ваш ход');
    if (phases && !phases.includes(this.phase)) throw new GameError('Сейчас так нельзя');
    return this.p(seat);
  }

  _kick(seat) {
    this._mine(seat, ['start']);
    const c = this._drawDoor();
    if (!c) { this.phase = 'after'; return; }
    const d = this.def(c);
    if (d.type === 'monster') { this._event('door', seat, `${this._n(seat)} выбивает дверь: ${d.name} (${d.level} ур.)`, { card: c.k }); this._startFight(seat, c); return; }
    if (d.type === 'curse') {
      this._event('door', seat, `${this._n(seat)} выбивает дверь… и ловит проклятие «${d.name}»`, { card: c.k });
      this._applyBad(seat, d.effect);
      this._discard(c);
    } else {
      this.p(seat).hand.push(c);
      this._event('door', seat, `${this._n(seat)} выбивает дверь и забирает карту`, { card: c.k, cardFor: [seat] });
    }
    this.phase = 'after';
    this._armTurn();
  }

  _trouble(seat, cardId) {
    const p = this._mine(seat, ['after']);
    const c = this._peekHand(p, cardId);
    if (this.def(c).type !== 'monster') throw new GameError('Нужна карта монстра');
    this._fromHand(p, cardId);
    this._event('trouble', seat, `${this._n(seat)} ищет неприятности: ${this.def(c).name}`, { card: c.k });
    this._startFight(seat, c);
  }

  _loot(seat) {
    const p = this._mine(seat, ['after']);
    const c = this._drawDoor();
    if (c) p.hand.push(c);
    this._event('loot', seat, `${this._n(seat)} шарит по углам`, { card: c && c.k, cardFor: [seat] });
    this._charity();
  }

  _equip(seat, cardId) {
    const p = this._mine(seat, ['start', 'after', 'charity']);
    const c = this._peekHand(p, cardId);
    const d = this.def(c);
    if (d.type !== 'gear') throw new GameError('Это не снаряжение');
    if (d.only && p.cls !== d.only) throw new GameError(`Только для класса «${CLASS_NAMES[d.only]}»`);
    this._fromHand(p, cardId);
    const back = [];
    if (SLOTS.includes(d.slot)) { if (p.eq[d.slot]) back.push(p.eq[d.slot]); p.eq[d.slot] = c; }
    else if (d.slot === 'hand' || d.slot === 'two') {
      const need = d.slot === 'two' ? 2 : 1;
      const units = (arr) => arr.reduce((a, x) => a + (this.def(x).slot === 'two' ? 2 : 1), 0);
      while (p.eq.hands.length && units(p.eq.hands) + need > 2) back.push(p.eq.hands.shift());
      p.eq.hands.push(c);
    } else { if (p.eq.misc.length >= 2) back.push(p.eq.misc.shift()); p.eq.misc.push(c); }
    p.hand.push(...back);
    this._event('equip', seat, null, { card: c.k });
    this._charityCheck();
  }

  _unequip(seat, cardId) {
    const p = this._mine(seat, ['start', 'after', 'charity']);
    const id = Number(cardId);
    for (const s of SLOTS) if (p.eq[s] && p.eq[s].id === id) { p.hand.push(p.eq[s]); p.eq[s] = null; return; }
    for (const k of ['hands', 'misc']) { const i = p.eq[k].findIndex((x) => x.id === id); if (i !== -1) { p.hand.push(p.eq[k].splice(i, 1)[0]); return; } }
    throw new GameError('Это не надето');
  }

  _class(seat, cardId) {
    const p = this._mine(seat, ['start', 'after', 'charity']);
    const c = this._peekHand(p, cardId);
    const d = this.def(c);
    if (d.type !== 'class') throw new GameError('Это не класс');
    this._fromHand(p, cardId);
    if (p.clsCard) this._discard(p.clsCard);
    p.cls = d.cls;
    p.clsCard = c;
    // gear for another class falls off
    for (const it of this._items(p)) if (this.def(it).only && this.def(it).only !== p.cls) this._unequip(seat, it.id);
    this._event('class', seat, `${this._n(seat)} теперь ${d.name}`, { card: c.k });
    this._charityCheck();
  }

  _level(seat, cardId) {
    const p = this.p(seat);
    if (this.phase === 'fight') throw new GameError('Не во время боя');
    const c = this._peekHand(p, cardId);
    if (this.def(c).type !== 'level') throw new GameError('Это не карта уровня');
    if (p.level >= this.goal - 1) throw new GameError(`${this.goal} уровень берут только в бою`);
    this._fromHand(p, cardId);
    this._discard(c);
    p.level += 1;
    this._event('level', seat, `${this._n(seat)}: «${this.def(c).name}» — ${p.level} уровень`, { card: c.k });
    this._charityCheck();
  }

  _sell(seat, ids) {
    const p = this._mine(seat, ['start', 'after', 'charity']);
    const list = (Array.isArray(ids) ? ids : []).map(Number);
    if (!list.length) throw new GameError('Выберите вещи');
    const all = [...p.hand, ...this._items(p)];
    const cards = list.map((id) => all.find((c) => c.id === id));
    if (cards.some((c) => !c || !this.def(c).gold)) throw new GameError('Продать можно только сокровища');
    const gold = cards.reduce((a, c) => a + this.def(c).gold, 0);
    const lv = Math.floor(gold / 1000);
    if (!lv) throw new GameError(`Набрано ${gold} — нужно 1000 за уровень`);
    if (p.level + lv > this.goal - 1) throw new GameError(`${this.goal} уровень куплен быть не может`);
    for (const c of cards) {
      const hi = p.hand.findIndex((x) => x.id === c.id);
      if (hi !== -1) p.hand.splice(hi, 1);
      else this._unequip(seat, c.id) || p.hand.splice(p.hand.findIndex((x) => x.id === c.id), 1);
      this._discard(c);
    }
    p.level += lv;
    this._event('sell', seat, `${this._n(seat)} сдаёт барахло скупщику: +${lv} ур. (${p.level})`);
    this._charityCheck();
  }

  _curse(seat, cardId, target) {
    const p = this.p(seat);
    const c = this._peekHand(p, cardId);
    const d = this.def(c);
    if (d.type !== 'curse') throw new GameError('Это не проклятие');
    if (!this.ps.has(target)) throw new GameError('Выберите жертву');
    this._fromHand(p, cardId);
    this._discard(c);
    this._event('curse', seat, `${this._n(seat)} проклинает ${this._n(target)}: «${d.name}»`, { card: c.k, target });
    this._applyBad(target, d.effect);
    if (seat === this.cur) this._charityCheck();
  }

  _applyBad(seat, bad) {
    const p = this.p(seat);
    const lost = [];
    const drop = (c) => { if (c) { this._discard(c); lost.push(this.def(c).name); } return c; };
    this._applyBadInner(p, bad, drop);
    if (bad === 'death') this.host.sys(`${this._n(seat)} погибает и теряет все карты${lost.length ? ` (${lost.length})` : ''}. Уровень и класс остаются.`);
    else if (lost.length) this.host.sys(`${this._n(seat)} теряет: ${lost.join(', ')}`);
  }
  _applyBadInner(p, bad, drop) {
    if (bad === 'lvl1' || bad === 'lvl2' || bad === 'lvl3') p.level = Math.max(1, p.level - Number(bad[3]));
    else if (SLOTS.includes(bad)) { drop(p.eq[bad]); p.eq[bad] = null; }
    else if (bad === 'hand') { if (p.eq.hands.length) drop(p.eq.hands.splice(Math.floor(this.rng() * p.eq.hands.length), 1)[0]); }
    else if (bad === 'item') {
      const items = this._items(p).sort((a, b) => (this.def(b).gold || 0) - (this.def(a).gold || 0));
      if (items[0]) { const id = items[0].id; this._unequipAny(p, id); drop(items[0]); }
    } else if (bad === 'cards2') { for (let i = 0; i < 2 && p.hand.length; i++) drop(p.hand.splice(Math.floor(this.rng() * p.hand.length), 1)[0]); }
    else if (bad === 'death') {
      for (const c of [...this._items(p), ...p.hand]) drop(c);
      p.eq = { head: null, body: null, feet: null, hands: [], misc: [] };
      p.hand = [];
      p.dead = true;
    }
  }
  _unequipAny(p, id) {
    for (const s of SLOTS) if (p.eq[s] && p.eq[s].id === id) { p.eq[s] = null; return; }
    for (const k of ['hands', 'misc']) { const i = p.eq[k].findIndex((x) => x.id === id); if (i !== -1) { p.eq[k].splice(i, 1); return; } }
  }

  // ---------- fights ----------
  _startFight(seat, card) {
    this.phase = 'fight';
    this.fight = { seat, monsters: [{ card, mods: [] }], helper: null, offers: [], pfx: 0, mfx: 0, burnt: 0, plays: [], final: false, rolls: null };
    this._armTurn();
  }
  _undead() { return this.fight.monsters.some((m) => this.def(m.card).undead); }
  monsterPower() {
    const f = this.fight;
    let s = f.mfx;
    for (const m of f.monsters) {
      const d = this.def(m.card);
      s += Math.max(1, d.level + m.mods.reduce((a, x) => a + this.def(x).mod, 0));
    }
    return s;
  }
  playerPower() {
    const f = this.fight;
    const und = this._undead();
    return this.strength(f.seat, und) + (f.helper != null ? this.strength(f.helper, und) : 0) + f.pfx + f.burnt;
  }
  _fightOnly() { if (this.phase !== 'fight' || !this.fight) throw new GameError('Сейчас нет боя'); return this.fight; }
  /** Anything played into a fight gives everyone a few seconds to answer before the final blow. */
  _touch() { if (this.fight.final) this.host.timer('fight', 6000, () => this._resolveFight()); }

  _oneshot(seat, cardId, side) {
    const f = this._fightOnly();
    const p = this.p(seat);
    const c = this._peekHand(p, cardId);
    const d = this.def(c);
    if (d.type !== 'oneshot') throw new GameError('Это не разовая карта');
    if (side !== 'p' && side !== 'm') throw new GameError('За кого играете?');
    this._fromHand(p, cardId);
    this._discard(c);
    const pow = this._undead() && d.undeadPower ? d.undeadPower : d.power;
    if (side === 'p') f.pfx += pow; else f.mfx += pow;
    f.plays.push({ seat, k: c.k, side, pow });
    this._event('oneshot', seat, `${this._n(seat)}: «${d.name}» — +${pow} ${side === 'p' ? 'герою' : 'монстру'}`, { card: c.k, side });
    this._touch();
  }

  _mod(seat, cardId, mi) {
    const f = this._fightOnly();
    const p = this.p(seat);
    const c = this._peekHand(p, cardId);
    if (this.def(c).type !== 'mod') throw new GameError('Это не усилитель монстра');
    const m = f.monsters[mi];
    if (!m) throw new GameError('Нет такого монстра');
    this._fromHand(p, cardId);
    m.mods.push(c);
    this._event('mod', seat, `${this._n(seat)}: «${this.def(c).name}» на ${this.def(m.card).name}`, { card: c.k });
    this._touch();
  }

  _wander(seat, cardId, monsterId) {
    const f = this._fightOnly();
    const p = this.p(seat);
    const w = this._peekHand(p, cardId);
    if (this.def(w).type !== 'wander') throw new GameError('Нужна «Бродячая тварь»');
    const m = this._peekHand(p, monsterId);
    if (this.def(m).type !== 'monster') throw new GameError('И карта монстра к ней');
    if (f.monsters.length >= 3) throw new GameError('Монстров и так хватает');
    this._fromHand(p, cardId);
    this._fromHand(p, monsterId);
    this._discard(w);
    f.monsters.push({ card: m, mods: [] });
    this._event('wander', seat, `${this._n(seat)} подкидывает в бой: ${this.def(m).name} (${this.def(m).level} ур.)`, { card: m.k });
    this._touch();
  }

  _offer(seat) {
    const f = this._fightOnly();
    if (seat === f.seat) throw new GameError('Это ваш бой');
    if (f.helper != null) throw new GameError('Помощник уже есть');
    if (!f.offers.includes(seat)) f.offers.push(seat);
    this._event('offer', seat, `${this._n(seat)} предлагает помощь`);
  }

  _accept(seat, helper) {
    const f = this._fightOnly();
    if (seat !== f.seat) throw new GameError('Помощника выбирает тот, кто дерётся');
    if (!f.offers.includes(helper)) throw new GameError('Этот игрок не предлагал помощь');
    f.helper = helper;
    this._event('help', seat, `${this._n(helper)} вписывается в бой за ${this._n(seat)} — за половину добычи`);
    this._touch();
  }

  _burn(seat, cardId) {
    const f = this._fightOnly();
    const p = this.p(seat);
    if (seat !== f.seat || p.cls !== 'mage') throw new GameError('Только Колдун в своём бою');
    if (f.burnt >= 3) throw new GameError('Не больше трёх карт');
    const c = this._fromHand(p, cardId);
    this._discard(c);
    f.burnt += 1;
    this._event('burn', seat, `${this._n(seat)} сжигает карту в ритуале: +1`);
    this._touch();
  }

  _go(seat) {
    const f = this._fightOnly();
    if (seat !== f.seat) throw new GameError('Это не ваш бой');
    if (this.playerPower() <= this.monsterPower()) throw new GameError('Сил не хватает — нужно больше, чем у монстра');
    if (f.final) return;
    f.final = true;
    this._event('final', seat, `${this._n(seat)} замахивается… у остальных последний шанс вмешаться`);
    this.host.timer('fight', 6000, () => this._resolveFight());
  }

  _run(seat) {
    const f = this._fightOnly();
    if (seat !== f.seat) throw new GameError('Это не ваш бой');
    this._flee();
  }

  _resolveFight() {
    if (this.phase !== 'fight') return;
    if (this.playerPower() > this.monsterPower()) this._win(); else this._flee();
  }

  _endFight() {
    const f = this.fight;
    for (const m of f.monsters) { this._discard(m.card); m.mods.forEach((x) => this._discard(x)); }
    this.host.clear('fight');
    this.fight = null;
  }

  _win() {
    const f = this.fight;
    const p = this.p(f.seat);
    let lv = 0; let tr = 0;
    for (const m of f.monsters) { const d = this.def(m.card); lv += d.levels; tr += Math.max(0, d.treasures + m.mods.reduce((a, x) => a + (this.def(x).tr || 0), 0)); }
    p.level = Math.min(this.goal, p.level + lv);
    const helperGets = f.helper != null ? Math.floor(tr / 2) : 0;
    for (let i = 0; i < tr - helperGets; i++) { const c = this._drawTreasure(); if (c) p.hand.push(c); }
    if (f.helper != null) for (let i = 0; i < helperGets; i++) { const c = this._drawTreasure(); if (c) this.p(f.helper).hand.push(c); }
    const names = f.monsters.map((m) => this.def(m.card).name).join(' и ');
    this._event('win', f.seat, `${this._n(f.seat)} побеждает: ${names}! +${lv} ур. (${p.level}), сокровищ: ${tr}`, { pp: this.playerPower(), mp: this.monsterPower() });
    this._endFight();
    if (p.level >= this.goal) {
      this.phase = 'over';
      this.host.finish({ winners: [f.seat], text: `${this._n(f.seat)} достигает ${this.goal} уровня и выходит из Подземелья победителем!`, scores: this._levels() });
      return;
    }
    this._charity();
  }

  _flee() {
    const f = this.fight;
    const rolls = [];
    const fighters = [f.seat, ...(f.helper != null ? [f.helper] : [])];
    for (const m of f.monsters) {
      const d = this.def(m.card);
      for (const s of fighters) {
        const die = 1 + Math.floor(this.rng() * 6);
        const ok = die + this.escapeBonus(s) >= 5;
        rolls.push({ seat: s, die, ok, monster: d.name });
        if (!ok) this._applyBad(s, d.bad);
        this.host.addLog(`${this._n(s)} убегает от «${d.name}»: на кубике ${die} — ${ok ? 'удрал' : `не удрал (${BAD_TEXT[d.bad]})`}`);
      }
    }
    this.seq += 1;
    this.ev = { seq: this.seq, type: 'flee', by: f.seat, rolls, text: `${this._n(f.seat)} пытается сбежать` };
    this._endFight();
    this._charity();
  }

  _levels() { return Object.fromEntries(this.order.map((s) => [s, this.p(s).level])); }

  leave(seat) {
    const p = this.ps.get(seat);
    if (!p) return;
    for (const c of [...this._items(p), ...p.hand, p.clsCard]) this._discard(c);
    this.ps.delete(seat);
    this.order = this.order.filter((s) => s !== seat);
    if (this.order.length < 2) {
      const [w] = this.order;
      this.phase = 'over';
      this.host.finish({ winners: w != null ? [w] : [], text: w != null ? `${this._n(w)} остаётся в Подземелье один — победа!` : 'Все разбежались' });
      return;
    }
    if (this.fight && this.fight.helper === seat) this.fight.helper = null;
    if (this.fight) this.fight.offers = this.fight.offers.filter((s) => s !== seat);
    if (this.cur === seat) {
      if (this.fight) this._endFight();
      this.cur = this.order[0];
      this._beginTurn();
    }
  }

  // ---------- view ----------
  _card(c) { return c ? { id: c.id, k: c.k } : null; }
  view(seat, over) {
    const f = this.fight;
    const me = this.ps.get(seat);
    return {
      type: 'dungeon',
      goal: this.goal,
      order: this.order, cur: this.cur, phase: this.phase, handLimit: HAND_LIMIT,
      charity: this.phase === 'charity' ? { need: Math.max(0, this.p(this.cur).hand.length - HAND_LIMIT), to: this._charityTo() } : null,
      players: this.order.map((s) => {
        const p = this.p(s);
        return {
          seat: s, name: this._n(s), level: p.level, cls: p.cls, dead: p.dead, cards: p.hand.length,
          power: this.strength(s), escape: this.escapeBonus(s),
          eq: { head: this._card(p.eq.head), body: this._card(p.eq.body), feet: this._card(p.eq.feet), hands: p.eq.hands.map((c) => this._card(c)), misc: p.eq.misc.map((c) => this._card(c)) },
        };
      }),
      hand: me ? me.hand.map((c) => this._card(c)) : null,
      fight: f ? {
        seat: f.seat, helper: f.helper, offers: f.offers, final: f.final,
        monsters: f.monsters.map((m) => ({ ...this._card(m.card), mods: m.mods.map((x) => x.k), power: Math.max(1, this.def(m.card).level + m.mods.reduce((a, x) => a + this.def(x).mod, 0)) })),
        pp: this.playerPower(), mp: this.monsterPower(), pfx: f.pfx, mfx: f.mfx, burnt: f.burnt, plays: f.plays.slice(-6),
        left: this.host.timerLeft('fight'), undead: this._undead(),
      } : null,
      decks: { doors: this.doors.length, treasures: this.treasures.length, doorTop: (this.doorDiscard[this.doorDiscard.length - 1] || {}).k || null, trTop: (this.trDiscard[this.trDiscard.length - 1] || {}).k || null },
      ev: this.ev ? { ...this.ev, card: this.ev.cardFor && !this.ev.cardFor.includes(seat) && !over ? null : this.ev.card } : null,
      cards: this.mat ? CARDS_MAT : CARDS, classes: CLASS_NAMES, badText: BAD_TEXT,
    };
  }

  // ---------- computer players ----------
  botDelay(seat) {
    if (this.phase === 'over' || !this.ps.has(seat)) return null;
    const f = this.fight;
    const bs = this._botState(seat);
    if (f) {
      if (f.seat === seat) return f.final ? null : bs.waited ? 3500 : 1400;
      if (bs.fightSeen !== this._fightKey()) return 1600;
      return null;
    }
    if (seat === this.cur) return this.phase === 'charity' ? 900 : 1300;
    return null;
  }
  _fightKey() { const f = this.fight; return f ? `${this.seq}:${f.monsters.length}:${f.pfx}:${f.mfx}:${f.helper}:${f.offers.length}` : ''; }
  _botState(seat) { this._bots ||= new Map(); if (!this._bots.has(seat)) this._bots.set(seat, {}); return this._bots.get(seat); }

  botAct(seat, level, rng) {
    const p = this.p(seat);
    const f = this.fight;
    const has = (type) => p.hand.filter((c) => this.def(c).type === type);
    if (f) {
      const bs = this._botState(seat);
      if (f.seat !== seat) {
        bs.fightSeen = this._fightKey();
        const fighterLevel = this.p(f.seat).level;
        const leader = Math.max(...this.order.filter((s) => s !== seat).map((s) => this.p(s).level));
        const winning = this.playerPower() > this.monsterPower();
        const dangerous = fighterLevel >= leader && fighterLevel >= this.goal - 3;
        if (winning && dangerous && level !== 'easy') {
          const os = has('oneshot')[0];
          if (os && rng() < 0.7) { this._oneshot(seat, os.id, 'm'); return; }
          const md = has('mod').find((c) => this.def(c).mod > 0);
          if (md && rng() < 0.7) { this._mod(seat, md.id, 0); return; }
          const w = has('wander')[0]; const mon = has('monster')[0];
          if (w && mon && rng() < 0.5) { this._wander(seat, w.id, mon.id); return; }
        }
        if (!winning && !dangerous && f.helper == null && !f.offers.includes(seat) && p.level < this.goal - 1 && rng() < 0.6) { this._offer(seat); return; }
        return;
      }
      // my own fight
      if (this.playerPower() > this.monsterPower()) { this._go(seat); return; }
      if (p.cls === 'mage' && f.burnt < 3 && p.hand.length) {
        const junk = [...p.hand].sort((a, b) => (this.def(a).gold || 0) - (this.def(b).gold || 0))[0];
        this._burn(seat, junk.id); return;
      }
      const gap = this.monsterPower() - this.playerPower() + 1;
      const os = has('oneshot').sort((a, b) => this.def(b).power - this.def(a).power);
      if (os.length && os.reduce((a, c) => a + this.def(c).power, 0) >= gap) { this._oneshot(seat, os[0].id, 'p'); return; }
      const minus = has('mod').find((c) => this.def(c).mod < 0);
      if (minus) { this._mod(seat, minus.id, 0); return; }
      if (f.helper == null && f.offers.length) { this._accept(seat, f.offers[0]); return; }
      if (f.helper == null && !bs.waited && this.order.length > 1) { bs.waited = true; return; }
      bs.waited = false;
      this._run(seat);
      return;
    }
    if (seat !== this.cur) return;
    if (this.phase === 'charity') { this._give(seat, this._cheapest(p, p.hand.length - HAND_LIMIT).map((c) => c.id)); return; }
    // housekeeping first: class, gear, levels, selling
    const cls = has('class')[0];
    if (cls && !p.cls) { this._class(seat, cls.id); return; }
    for (const c of has('gear')) {
      const d = this.def(c);
      if (d.only && d.only !== p.cls) continue;
      const cur = d.slot === 'head' || d.slot === 'body' || d.slot === 'feet' ? p.eq[d.slot] : null;
      const better = cur ? (this.def(cur).bonus || 0) < (d.bonus || 0) : d.slot === 'misc' ? p.eq.misc.length < 2 : (d.slot === 'hand' || d.slot === 'two') ? (d.slot === 'two' ? p.eq.hands.reduce((a, x) => a + (this.def(x).bonus || 0), 0) < d.bonus : p.eq.hands.reduce((a, x) => a + (this.def(x).slot === 'two' ? 2 : 1), 0) < 2) : true;
      if (better) { this._equip(seat, c.id); return; }
    }
    const lvl = has('level')[0];
    if (lvl && p.level < this.goal - 1) { this._level(seat, lvl.id); return; }
    const spare = p.hand.filter((c) => this.def(c).type === 'gear');
    const gold = spare.reduce((a, c) => a + this.def(c).gold, 0);
    if (gold >= 1000 && p.level + 1 < this.goal) { this._sell(seat, spare.map((c) => c.id)); return; }
    // curse the leader now and then
    const curse = has('curse')[0];
    if (curse && level !== 'easy' && rng() < 0.5) {
      const others = this.order.filter((s) => s !== seat).sort((a, b) => this.p(b).level - this.p(a).level);
      if (this.p(others[0]).level >= p.level) { this._curse(seat, curse.id, others[0]); return; }
    }
    if (this.phase === 'start') { this._kick(seat); return; }
    if (this.phase === 'after') {
      const weak = has('monster').filter((c) => this.def(c).level < this.strength(seat)).sort((a, b) => this.def(b).level - this.def(a).level)[0];
      if (weak && level !== 'easy') { this._trouble(seat, weak.id); return; }
      this._loot(seat);
    }
  }
}

module.exports = { DungeonGame };
