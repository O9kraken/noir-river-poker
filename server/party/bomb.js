'use strict';
/**
 * «Котобомба» — a card game of chance and nerve for 2–10 players.
 * Everyone draws from one deck; whoever draws a bomb without a sapper is out. The last one standing wins.
 * Before drawing you may play any number of cards: skip, pass the turn on, look at the top of the deck,
 * shuffle, draw from the bottom, demand a card, steal with pairs of cats. Any action can be cancelled
 * with «Ни за что!» (and that can be cancelled too) while its short window is open.
 */
const { GameError, shuffle } = require('./base');

const KINDS = {
  bomb: { name: 'Котобомба', text: 'Вытянул — взрываешься. Если нет «Сапёра», ты выбываешь.' },
  defuse: { name: 'Сапёр', text: 'Обезвреживает котобомбу. Её возвращают в колоду — куда захочешь.' },
  skip: { name: 'Смыться', text: 'Закончить ход, не беря карту.' },
  attack: { name: 'Перевести стрелки', text: 'Закончить ход без карты. Следующий ходит дважды (стрелки складываются).' },
  future: { name: 'Гадалка', text: 'Тайно посмотреть три верхние карты колоды.' },
  alter: { name: 'Подкрутить', text: 'Посмотреть три верхние карты и переложить их как угодно.' },
  shuffle: { name: 'Бардак', text: 'Перемешать колоду.' },
  bottom: { name: 'Со дна', text: 'Взять нижнюю карту вместо верхней — это и есть ваш ход.' },
  favor: { name: 'Взятка', text: 'Выбранный игрок отдаёт вам карту на свой выбор.' },
  nope: { name: 'Ни за что!', text: 'Отменить действие любой карты, кроме бомбы и сапёра. Можно в любой момент.' },
  c1: { name: 'Кот-коллектор', cat: true, text: 'Пара одинаковых котов — вытянуть случайную карту у игрока. Три — назвать карту и забрать её.' },
  c2: { name: 'Кот-гробовщик', cat: true, text: 'Пара одинаковых котов — вытянуть случайную карту у игрока. Три — назвать карту и забрать её.' },
  c3: { name: 'Кот-бухгалтер', cat: true, text: 'Пара одинаковых котов — вытянуть случайную карту у игрока. Три — назвать карту и забрать её.' },
  c4: { name: 'Кот-прокурор', cat: true, text: 'Пара одинаковых котов — вытянуть случайную карту у игрока. Три — назвать карту и забрать её.' },
  c5: { name: 'Кот-шаурмист', cat: true, text: 'Пара одинаковых котов — вытянуть случайную карту у игрока. Три — назвать карту и забрать её.' },
};
const BASE = { skip: 4, attack: 4, future: 5, alter: 2, shuffle: 4, bottom: 3, favor: 4, nope: 5, c1: 4, c2: 4, c3: 4, c4: 4, c5: 4 };
const SINGLE = new Set(['skip', 'attack', 'future', 'alter', 'shuffle', 'bottom', 'favor']);
const NEEDS_TARGET = new Set(['favor']);
const VALUE = { defuse: 100, nope: 30, attack: 25, skip: 22, future: 18, alter: 18, shuffle: 14, bottom: 14, favor: 10 }; // for bots

class BombGame {
  static get meta() { return { id: 'bomb', title: 'Котобомба', min: 2, max: 10 }; }
  static options() { return {}; }

  constructor(host, players) {
    this.host = host;
    this.rng = host.rng;
    this.order = players.map((p) => p.seat);
    this.alive = new Set(this.order);
    this.hands = new Map(this.order.map((s) => [s, []]));
    this.discard = [];
    this.pending = null;
    this.phase = 'turn'; // turn | favor | insert | alter
    this.phaseInfo = null;
    this.peek = new Map(); // seat -> { ids, top } what this seat saw
    this.seq = 0;
    this.ev = null;
    let id = 0;
    const mk = (k) => ({ id: ++id, k });
    const n = players.length;
    const mult = n > 5 ? 2 : 1;
    let deck = [];
    for (const [k, c] of Object.entries(BASE)) for (let i = 0; i < c * mult; i++) deck.push(mk(k));
    shuffle(deck, this.rng);
    for (const s of this.order) {
      const h = this.hands.get(s);
      h.push(mk('defuse'));
      for (let i = 0; i < 7; i++) h.push(deck.pop());
    }
    const extraDefuse = n <= 5 ? Math.max(1, 6 - n) : Math.max(2, 10 - n);
    for (let i = 0; i < extraDefuse; i++) deck.push(mk('defuse'));
    for (let i = 0; i < n - 1; i++) deck.push(mk('bomb'));
    this.deck = shuffle(deck, this.rng); // deck[0] is the top
    this.cur = this.order[Math.floor(this.rng() * this.order.length)];
    this.turnsLeft = 1;
    host.sys(`Котобомб в колоде: ${n - 1}. У каждого по сапёру. Последний выживший забирает ${host.pot ? 'банк' : 'победу'}.`);
    this._armTurn();
  }

  // ---------- helpers ----------
  _event(type, by, text, extra = {}) { this.seq += 1; this.ev = { seq: this.seq, type, by, text, ...extra }; if (text) this.host.addLog(text); }
  _n(seat) { return this.host.nameOf(seat); }
  _hand(seat) { return this.hands.get(seat) || []; }
  _take(seat, id) {
    const h = this._hand(seat);
    const i = h.findIndex((c) => c.id === id);
    if (i === -1) throw new GameError('Нет такой карты');
    return h.splice(i, 1)[0];
  }
  _nextAlive(seat) {
    const i = this.order.indexOf(seat);
    for (let k = 1; k <= this.order.length; k++) {
      const s = this.order[(i + k) % this.order.length];
      if (this.alive.has(s)) return s;
    }
    return seat;
  }
  _armTurn() {
    this.host.clear('phase');
    this.host.turn(this.cur, 30000, () => this._autoTurn());
  }
  _backToTurn() {
    this.host.clear('phase');
    this.phase = 'turn';
    this.phaseInfo = null;
    if (!this.host.turnView()) this.host.turn(this.cur, 15000, () => this._autoTurn());
  }
  _autoTurn() {
    if (this.pending) { this._resolve(); }
    if (this.phase === 'turn') { this.host.sys(`${this._n(this.cur)} задумался — карта тянется сама`); this._draw(this.cur, false); }
  }

  _endTurn(attack = false) {
    this.peek.delete(this.cur);
    if (attack) {
      const extra = this.turnsLeft > 1 ? this.turnsLeft : 0;
      this.cur = this._nextAlive(this.cur);
      this.turnsLeft = extra + 2;
    } else {
      this.turnsLeft -= 1;
      if (this.turnsLeft <= 0) { this.cur = this._nextAlive(this.cur); this.turnsLeft = 1; }
    }
    this.phase = 'turn';
    this.phaseInfo = null;
    this._armTurn();
  }

  // ---------- moves ----------
  act(seat, type, p) {
    if (!this.alive.has(seat)) throw new GameError('Вы выбыли');
    switch (type) {
      case 'play': return this._play(seat, p);
      case 'nope': return this._nope(seat, p);
      case 'draw':
        if (seat !== this.cur || this.phase !== 'turn') throw new GameError('Сейчас не ваш ход');
        if (this.pending) throw new GameError('Дождитесь, пока сыграет карта');
        return this._draw(seat, false);
      case 'insert': return this._insert(seat, p.pos);
      case 'give': return this._give(seat, Number(p.card));
      case 'order': return this._order(seat, p.order);
      default: throw new GameError('Неизвестный ход');
    }
  }

  _play(seat, p) {
    if (seat !== this.cur || this.phase !== 'turn') throw new GameError('Карты действия играют в свой ход');
    if (this.pending) throw new GameError('Дождитесь, пока сыграет прошлая карта');
    const ids = (Array.isArray(p.cards) ? p.cards : []).map(Number);
    if (!ids.length || ids.length > 3 || new Set(ids).size !== ids.length) throw new GameError('Выберите карту');
    const h = this._hand(seat);
    const cards = ids.map((id) => h.find((c) => c.id === id));
    if (cards.some((c) => !c)) throw new GameError('Нет такой карты');
    const k = cards[0].k;
    let kind;
    if (cards.length === 1) {
      if (!SINGLE.has(k)) throw new GameError(KINDS[k].cat ? 'Котов играют парой' : 'Эту карту так не сыграть');
      kind = k;
    } else {
      if (!cards.every((c) => c.k === k) || k === 'defuse' || k === 'bomb') throw new GameError('Нужны одинаковые карты');
      kind = cards.length === 2 ? 'pair' : 'triple';
    }
    let target = null;
    if (NEEDS_TARGET.has(kind) || kind === 'pair' || kind === 'triple') {
      target = Number(p.target);
      if (!this.alive.has(target) || target === seat) throw new GameError('Выберите соперника');
      if (!this._hand(target).length) throw new GameError('У этого игрока нет карт');
    }
    let want = null;
    if (kind === 'triple') {
      want = String(p.want || '');
      if (!KINDS[want] || want === 'bomb') throw new GameError('Назовите карту');
    }
    for (const c of cards) { this._take(seat, c.id); this.discard.push(c); }
    const label = cards.length === 1 ? KINDS[k].name : `${cards.length} × ${KINDS[k].name}`;
    this.pending = { by: seat, kind, target, want, label, nopes: 0, card: k };
    this._event('play', seat, `${this._n(seat)}: ${label}${target != null ? ` → ${this._n(target)}` : ''}`, { card: k, count: cards.length, target });
    this._window();
  }

  _window() { this.host.timer('nope', 3500, () => this._resolve(), false); }

  /** After a restart: arm the clocks for the phase the game was in. */
  resume() {
    const pi = this.phaseInfo;
    if (this.phase === 'insert') { this.host.timer('phase', 20000, () => this._insert(pi.seat, 'random')); return; }
    this.host.turn(this.cur, 30000, () => this._autoTurn());
    if (this.phase === 'favor') this.host.timer('phase', 15000, () => { const h = this._hand(pi.from); if (h.length) this._give(pi.from, h[Math.floor(this.rng() * h.length)].id); });
    if (this.phase === 'alter') this.host.timer('phase', 20000, () => this._order(pi.seat, null));
    if (this.pending) this._window();
  }

  _nope(seat, p) {
    if (!this.pending) throw new GameError('Отменять нечего');
    const h = this._hand(seat);
    const card = p && p.card ? h.find((c) => c.id === Number(p.card) && c.k === 'nope') : h.find((c) => c.k === 'nope');
    if (!card) throw new GameError('Нет карты «Ни за что!»');
    this._take(seat, card.id);
    this.discard.push(card);
    this.pending.nopes += 1;
    this.pending.lastNope = seat;
    this._event('nope', seat, `${this._n(seat)}: «Ни за что!»${this.pending.nopes % 2 ? '' : ' — отмена отменена'}`);
    this._window();
  }

  _resolve() {
    const pd = this.pending;
    if (!pd) return;
    this.pending = null;
    this.host.clear('nope');
    if (pd.nopes % 2 === 1) { this._event('noped', pd.by, `«${pd.label}» отменено`); return; }
    const seat = pd.by;
    if (!this.alive.has(seat)) return;
    switch (pd.kind) {
      case 'skip': this._event('skip', seat, `${this._n(seat)} смывается`); this._endTurn(false); break;
      case 'attack': {
        const next = this._nextAlive(seat);
        this._event('attack', seat, `${this._n(seat)} переводит стрелки на ${this._n(next)}`, { target: next });
        this._endTurn(true);
        break;
      }
      case 'future': case 'alter': {
        const top = this.deck.slice(0, 3);
        this.peek.set(seat, { ids: top.map((c) => c.id), at: this.seq });
        if (pd.kind === 'alter' && top.length > 1) {
          this.phase = 'alter';
          this.phaseInfo = { seat };
          this.host.timer('phase', 20000, () => this._order(seat, null));
          this._event('peek', seat, `${this._n(seat)} подкручивает будущее`);
        } else this._event('peek', seat, `${this._n(seat)} смотрит в будущее`);
        break;
      }
      case 'shuffle': shuffle(this.deck, this.rng); this.peek.clear(); this._event('shuffle', seat, `${this._n(seat)} устраивает бардак в колоде`); break;
      case 'bottom': this._draw(seat, true); break;
      case 'favor': {
        if (!this.alive.has(pd.target) || !this._hand(pd.target).length) { this._event('fizzle', seat, 'Взятка не удалась: брать нечего'); break; }
        this.phase = 'favor';
        this.phaseInfo = { from: pd.target, to: seat };
        this.host.timer('phase', 15000, () => { const h = this._hand(pd.target); if (h.length) this._give(pd.target, h[Math.floor(this.rng() * h.length)].id); });
        this._event('favor', seat, `${this._n(pd.target)} выбирает, чем откупиться`, { target: pd.target });
        break;
      }
      case 'pair': {
        const h = this._hand(pd.target);
        if (!this.alive.has(pd.target) || !h.length) { this._event('fizzle', seat, 'Красть нечего'); break; }
        const c = h.splice(Math.floor(this.rng() * h.length), 1)[0];
        this._hand(seat).push(c);
        this._event('steal', seat, `${this._n(seat)} вытягивает карту у ${this._n(pd.target)}`, { target: pd.target, cardFor: [seat, pd.target], card: c.k });
        break;
      }
      case 'triple': {
        const h = this._hand(pd.target);
        const i = h.findIndex((c) => c.k === pd.want);
        if (i === -1) { this._event('fizzle', seat, `У ${this._n(pd.target)} нет карты «${KINDS[pd.want].name}»`); break; }
        const c = h.splice(i, 1)[0];
        this._hand(seat).push(c);
        this._event('steal', seat, `${this._n(seat)} забирает «${KINDS[pd.want].name}» у ${this._n(pd.target)}`, { target: pd.target, card: c.k });
        break;
      }
      default: break;
    }
  }

  _draw(seat, fromBottom) {
    const card = fromBottom ? this.deck.pop() : this.deck.shift();
    if (!card) { this._endTurn(false); return; }
    for (const [s, pk] of this.peek) { if (!fromBottom || pk.ids.includes(card.id)) this.peek.delete(s); }
    if (card.k === 'bomb') {
      const h = this._hand(seat);
      const d = h.find((c) => c.k === 'defuse');
      if (d) {
        this._take(seat, d.id);
        this.discard.push(d);
        this.phase = 'insert';
        this.phaseInfo = { seat, card };
        this.host.stopTurn();
        this.host.timer('phase', 20000, () => this._insert(seat, 'random'));
        this._event('defused', seat, `${this._n(seat)} тянет котобомбу… и обезвреживает её!`);
        return;
      }
      this.discard.push(card);
      this._eliminate(seat, `${this._n(seat)} взрывается! 💥`);
      return;
    }
    this._hand(seat).push(card);
    this._event('draw', seat, null, { fromBottom, card: card.k, cardFor: [seat] });
    this._endTurn(false);
  }

  _insert(seat, pos) {
    if (this.phase !== 'insert' || this.phaseInfo.seat !== seat) throw new GameError('Сейчас не нужно прятать бомбу');
    const n = this.deck.length;
    let at;
    if (pos === 'random' || pos == null) at = Math.floor(this.rng() * (n + 1));
    else if (pos === 'bottom') at = n;
    else { at = Math.floor(Number(pos)); if (!(at >= 0)) throw new GameError('Куда положить бомбу?'); at = Math.min(at, n); }
    this.deck.splice(at, 0, this.phaseInfo.card);
    this.peek.clear();
    this.host.clear('phase');
    this._event('insert', seat, `${this._n(seat)} прячет котобомбу обратно в колоду`);
    this._endTurn(false);
  }

  _give(seat, id) {
    if (this.phase !== 'favor' || this.phaseInfo.from !== seat) throw new GameError('От вас ничего не ждут');
    const c = this._take(seat, id);
    const to = this.phaseInfo.to;
    this._hand(to).push(c);
    this._backToTurn();
    this._event('gave', seat, `${this._n(seat)} откупается картой`, { target: to, card: c.k, cardFor: [seat, to] });
  }

  _order(seat, order) {
    if (this.phase !== 'alter' || this.phaseInfo.seat !== seat) throw new GameError('Сейчас нечего подкручивать');
    const top = this.deck.slice(0, 3);
    if (Array.isArray(order)) {
      const ids = order.map(Number);
      if (ids.length !== top.length || !top.every((c) => ids.includes(c.id))) throw new GameError('Неверный порядок');
      const next = ids.map((id) => top.find((c) => c.id === id));
      this.deck.splice(0, top.length, ...next);
    }
    this.peek.set(seat, { ids: this.deck.slice(0, 3).map((c) => c.id), at: this.seq });
    for (const s of [...this.peek.keys()]) if (s !== seat) this.peek.delete(s);
    this._backToTurn();
    this._event('altered', seat, `${this._n(seat)} подкрутил будущее`);
  }

  _eliminate(seat, text) {
    this.alive.delete(seat);
    for (const c of this._hand(seat)) this.discard.push(c);
    this.hands.set(seat, []);
    this.peek.delete(seat);
    this._event('boom', seat, text);
    if (this.pending && this.pending.by === seat) { this.pending = null; this.host.clear('nope'); }
    if (this.phase === 'favor' && (this.phaseInfo.from === seat || this.phaseInfo.to === seat)) { this.host.clear('phase'); this.phase = 'turn'; this.phaseInfo = null; }
    if (this.alive.size <= 1) {
      const [w] = [...this.alive];
      this.host.finish({ winners: w != null ? [w] : [], text: w != null ? `${this._n(w)} — последний выживший!` : 'Взорвались все' });
      return;
    }
    if (this.cur === seat) {
      this.cur = this._nextAlive(seat);
      this.turnsLeft = 1;
      this.phase = 'turn';
      this.phaseInfo = null;
      this._armTurn();
    }
  }

  leave(seat) {
    if (!this.alive.has(seat)) return;
    if (this.phase === 'insert' && this.phaseInfo.seat === seat) {
      this.deck.splice(Math.floor(this.rng() * (this.deck.length + 1)), 0, this.phaseInfo.card);
      this.phase = 'turn';
      this.phaseInfo = null;
      this.host.clear('phase');
    }
    if (this.phase === 'alter' && this.phaseInfo.seat === seat) { this.phase = 'turn'; this.phaseInfo = null; this.host.clear('phase'); }
    this._eliminate(seat, `${this._n(seat)} покидает игру`);
  }

  // ---------- view ----------
  view(seat, over) {
    const pd = this.pending;
    const pk = this.peek.get(seat);
    const top = pk ? pk.ids.map((id) => this.deck.find((c) => c.id === id)).filter(Boolean) : null;
    return {
      type: 'bomb',
      order: this.order,
      players: this.order.map((s) => ({ seat: s, name: this._n(s), alive: this.alive.has(s), cards: this._hand(s).length })),
      cur: this.cur, turnsLeft: this.turnsLeft,
      deck: this.deck.length,
      bombs: this.deck.filter((c) => c.k === 'bomb').length,
      discard: this.discard.slice(-4).map((c) => c.k),
      pending: pd ? { by: pd.by, kind: pd.kind, card: pd.card, label: pd.label, target: pd.target, nopes: pd.nopes, left: this.host.timerLeft('nope') } : null,
      phase: this.phase,
      phaseInfo: this.phaseInfo ? { seat: this.phaseInfo.seat, from: this.phaseInfo.from, to: this.phaseInfo.to, left: this.host.timerLeft('phase') } : null,
      hand: seat >= 0 ? this._hand(seat).map((c) => ({ id: c.id, k: c.k })) : null,
      allHands: over ? Object.fromEntries(this.order.map((s) => [s, this._hand(s).map((c) => c.k)])) : null,
      peek: top && (this.phase !== 'alter' || this.phaseInfo.seat === seat) ? top.map((c) => ({ id: c.id, k: c.k })) : null,
      ev: this.ev ? { ...this.ev, card: this.ev.cardFor && !this.ev.cardFor.includes(seat) ? null : this.ev.card } : null,
      kinds: KINDS,
    };
  }

  // ---------- computer players ----------
  _knownTop(seat) { const pk = this.peek.get(seat); if (!pk) return null; return pk.ids.map((id) => this.deck.find((c) => c.id === id)).filter(Boolean); }

  botDelay(seat) {
    if (!this.alive.has(seat)) return null;
    const h = this._hand(seat);
    if (this.pending && this.pending.by !== seat && h.some((c) => c.k === 'nope')) {
      const pd = this.pending;
      const hurtsMe = (pd.target === seat) || (pd.kind === 'attack' && this._nextAlive(pd.by) === seat);
      if (hurtsMe && pd.nopes % 2 === 0 && pd.decided !== `${seat}:${pd.nopes}`) return 700;
    }
    if (this.pending && this.pending.by === seat && this.pending.nopes % 2 === 1 && pd2(this, seat)) return 700;
    if (this.phase === 'favor' && this.phaseInfo.from === seat) return 1000;
    if (this.phase === 'insert' && this.phaseInfo.seat === seat) return 1100;
    if (this.phase === 'alter' && this.phaseInfo.seat === seat) return 1100;
    if (this.phase === 'turn' && this.cur === seat && !this.pending) return 1200;
    return null;
  }

  botAct(seat, level, rng) {
    const h = this._hand(seat);
    const pd = this.pending;
    if (pd && pd.by !== seat) {
      pd.decided = `${seat}:${pd.nopes}`;
      const worth = pd.kind === 'attack' || pd.kind === 'pair' || pd.kind === 'triple' || (pd.kind === 'favor' && rng() < 0.5);
      if (worth && (level !== 'easy' || rng() < 0.5)) this._nope(seat, {});
      return;
    }
    if (pd && pd.by === seat && pd.nopes % 2 === 1) { pd.reNoped = true; if (h.some((c) => c.k === 'nope') && level === 'hard') this._nope(seat, {}); return; }
    if (this.phase === 'favor') {
      const worst = [...h].sort((a, b) => (VALUE[a.k] || 1) - (VALUE[b.k] || 1))[0];
      this._give(seat, worst.id);
      return;
    }
    if (this.phase === 'insert') {
      // hard bots put the bomb right on top for the next player; others hide it randomly
      const pos = level === 'hard' ? (this.turnsLeft > 1 ? 1 : 0) : level === 'normal' && rng() < 0.5 ? Math.floor(rng() * 3) : 'random';
      this._insert(seat, pos);
      return;
    }
    if (this.phase === 'alter') {
      const top = this.deck.slice(0, 3);
      const bombs = top.filter((c) => c.k === 'bomb');
      const safe = top.filter((c) => c.k !== 'bomb');
      // keep the safe card for myself if I still have to draw, the bomb next for the opponent
      this._order(seat, [...safe.slice(0, 1), ...bombs, ...safe.slice(1)].map((c) => c.id));
      return;
    }
    if (this.phase !== 'turn' || this.cur !== seat) return;
    const has = (k) => h.find((c) => c.k === k);
    const known = this._knownTop(seat);
    const bombOnTop = known && known[0] && known[0].k === 'bomb';
    const risk = this.deck.length ? this.deck.filter((c) => c.k === 'bomb').length / this.deck.length : 0;
    const playOne = (k, target) => this._play(seat, { cards: [has(k).id], target });
    const others = this.order.filter((s) => s !== seat && this.alive.has(s) && this._hand(s).length);
    const richest = others.sort((a, b) => this._hand(b).length - this._hand(a).length)[0];
    if (bombOnTop) {
      if (has('attack')) return playOne('attack');
      if (has('skip')) return playOne('skip');
      if (has('bottom')) return playOne('bottom');
      if (has('shuffle')) return playOne('shuffle');
    }
    if (!known && level !== 'easy' && risk > 0.15 && rng() < 0.6) {
      if (has('future')) return playOne('future');
      if (has('alter')) return playOne('alter');
    }
    if (!has('defuse') && level !== 'easy' && risk > 0.2) {
      if (has('attack')) return playOne('attack');
      if (has('skip')) return playOne('skip');
    }
    if (richest != null && rng() < (level === 'easy' ? 0.15 : 0.45)) {
      const byKind = {};
      for (const c of h) if (KINDS[c.k].cat) (byKind[c.k] ||= []).push(c);
      const pair = Object.values(byKind).find((v) => v.length >= 2);
      if (pair) return this._play(seat, { cards: pair.slice(0, 2).map((c) => c.id), target: richest });
      if (has('favor')) return playOne('favor', richest);
    }
    this._draw(seat, false);
  }
}

function pd2(g, seat) { const pd = g.pending; return pd && !pd.reNoped && g._hand(seat).some((c) => c.k === 'nope'); }

module.exports = { BombGame, KINDS };
