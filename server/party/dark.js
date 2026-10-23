'use strict';
/**
 * «Без тормозов» — a black-humour party game for 3–10 adults.
 * Each round one player is the host: they read a prompt with a gap, the others secretly put in their
 * funniest (or worst) answer, and the host picks the winner without knowing whose it is.
 * Every round a player may also write their own answer instead of playing a card. Written cards go
 * into the club's shared pool and turn up in later games (host hook 'darkAdd' / 'darkPool').
 */
const { GameError, shuffle } = require('./base');
const { PROMPTS, ANSWERS, PROMPTS_MAT, ANSWERS_MAT, gaps } = require('./dark-cards');

const HAND = 10;
/** Up to this share (of the printed deck's size) of a new deck comes from the players' pool. */
const CUSTOM_SHARE = 0.4;

class DarkGame {
  static get meta() { return { id: 'dark', title: 'Без тормозов', min: 3, max: 10 }; }
  static options(o) { return { goal: [5, 7, 10].includes(Number(o.goal)) ? Number(o.goal) : 7, mat: o.mat !== false && o.mat !== 0 && o.mat !== '0' }; }

  constructor(host, players, options) {
    this.host = host;
    this.rng = host.rng;
    this.goal = options.goal;
    this.mat = !!options.mat;
    this.allPrompts = this.mat ? PROMPTS.concat(PROMPTS_MAT) : PROMPTS;
    this.seq = 0;
    this.ev = null;
    this.order = players.map((p) => p.seat);
    this.score = new Map(this.order.map((s) => [s, 0]));
    let id = 0;
    const base = (this.mat ? ANSWERS.concat(ANSWERS_MAT) : ANSWERS).map((t) => ({ id: ++id, t }));
    // the players' own cards: a random share of the pool, so the printed deck still dominates
    const pool = shuffle((host.hook && host.hook('darkPool', { mat: this.mat })) || [], this.rng);
    const seen = new Set(base.map((c) => c.t.toLowerCase()));
    const custom = [];
    for (const c of pool) {
      if (custom.length >= Math.round(base.length * CUSTOM_SHARE)) break;
      if (!c || !c.t || seen.has(c.t.toLowerCase())) continue;
      seen.add(c.t.toLowerCase());
      custom.push({ id: ++id, t: c.t, cid: c.id, by: c.byName || null });
    }
    this.nextId = id;
    this.customIn = custom.length;
    this.answers = shuffle(base.concat(custom), this.rng);
    this.used = [];
    this.prompts = shuffle(this.allPrompts.slice(), this.rng);
    this.hands = new Map(this.order.map((s) => [s, []]));
    for (const s of this.order) this._refill(s);
    this.judge = this.order[Math.floor(this.rng() * this.order.length)];
    this.round = 0;
    this.history = [];
    host.sys(`Играем до ${this.goal} очков. Свою карту можно вписать в любом раунде — она останется в колоде клуба${this.customIn ? ` (сейчас в колоде ${this.customIn} карт от игроков)` : ''}. 18+${this.mat ? ', без цензуры' : ''}.`);
    this._newRound();
  }

  _event(type, by, text, extra = {}) { this.seq += 1; this.ev = { seq: this.seq, type, by, text, ...extra }; if (text) this.host.addLog(text); }
  _n(s) { return this.host.nameOf(s); }
  _draw() {
    if (!this.answers.length) { this.answers = shuffle(this.used, this.rng); this.used = []; }
    return this.answers.shift() || null;
  }
  _refill(seat) { const h = this.hands.get(seat); while (h.length < HAND) { const c = this._draw(); if (!c) break; h.push(c); } }

  _newRound() {
    this.round += 1;
    if (!this.prompts.length) this.prompts = shuffle(this.allPrompts.slice(), this.rng);
    this.prompt = this.prompts.shift();
    this.pick = Math.max(1, gaps(this.prompt));
    this.subs = new Map(); // seat -> [{ id, t, blank }]
    this.reveal = null;
    this.phase = 'answer';
    this.host.stopTurn();
    this.host.timer('answer', 75000, () => this._toJudge());
    this._event('round', this.judge, `Раунд ${this.round}. Ведущий — ${this._n(this.judge)}`);
  }

  resume() {
    if (this.phase === 'answer') this.host.timer('answer', 75000, () => this._toJudge());
    else if (this.phase === 'judge') this.host.turn(this.judge, 60000, () => this._choose(this.judge, Math.floor(this.rng() * this.reveal.length), true));
    else if (this.phase === 'show') this.host.timer('show', 4000, () => this._nextJudge(), false);
  }

  _players() { return this.order.filter((s) => s !== this.judge); }

  act(seat, type, p) {
    if (type === 'answer') return this._answer(seat, p);
    if (type === 'take') return this._take(seat);
    if (type === 'choose') return this._choose(seat, Number(p.i));
    if (type === 'swap') return this._swap(seat);
    if (type === 'flag') return this._flag(seat, Number(p.id));
    throw new GameError('Неизвестный ход');
  }

  _answer(seat, p) {
    if (this.phase !== 'answer') throw new GameError('Ответы уже собраны');
    if (seat === this.judge) throw new GameError('Ведущий не отвечает');
    if (this.subs.has(seat)) throw new GameError('Вы уже ответили');
    const ids = Array.isArray(p.cards) ? p.cards : [];
    if (ids.length !== this.pick) throw new GameError(this.pick === 2 ? 'Нужно два ответа — по порядку' : 'Выберите ответ');
    const h = this.hands.get(seat);
    const out = [];
    let blanks = 0;
    for (const x of ids) {
      if (x === 'blank') {
        const text = String((p.text || '')).replace(/\s+/g, ' ').trim().slice(0, 80);
        if (!text) throw new GameError('Напишите свой ответ');
        blanks += 1;
        out.push({ id: 0, t: text, blank: true });
      } else {
        const c = h.find((y) => y.id === Number(x));
        if (!c || out.includes(c)) throw new GameError('Нет такой карты');
        out.push(c);
      }
    }
    if (blanks > 1) throw new GameError('Своя карта — одна на ответ');
    for (const c of out) if (!c.blank) h.splice(h.indexOf(c), 1);
    for (const c of out) {
      if (!c.blank) continue;
      const u = this.host.userOf ? this.host.userOf(seat) : null;
      const saved = u && this.host.hook ? this.host.hook('darkAdd', c.t, { userId: u.userId, name: u.name, mat: this.mat }) : null;
      if (saved && saved.id) c.cid = saved.id;
      c.by = u ? u.name : null;
      this.written = (this.written || 0) + 1;
    }
    this.subs.set(seat, out);
    this._event('answered', seat, null);
    if (this._players().every((s) => this.subs.has(s))) this._toJudge();
  }

  _toJudge() {
    this.host.clear('answer');
    if (!this.subs.size) {
      this.host.sys('Никто не ответил — следующий раунд');
      this._nextJudge();
      return;
    }
    this.phase = 'judge';
    this.reveal = shuffle([...this.subs.entries()].map(([seat, cards]) => ({ seat, cards })), this.rng);
    this.host.turn(this.judge, 60000, () => this._choose(this.judge, Math.floor(this.rng() * this.reveal.length), true));
    this._event('judge', this.judge, `${this._n(this.judge)} читает ответы…`);
  }

  _choose(seat, i, auto = false) {
    if (this.phase !== 'judge') throw new GameError('Ещё рано выбирать');
    if (seat !== this.judge) throw new GameError('Выбирает ведущий');
    const r = this.reveal[i];
    if (!r) throw new GameError('Нет такого ответа');
    this.host.stopTurn();
    const sc = this.score.get(r.seat) + 1;
    this.score.set(r.seat, sc);
    this.winner = r.seat;
    this.phase = 'show';
    const filled = this.fill(this.prompt, r.cards.map((c) => c.t));
    this.history.unshift({ prompt: this.prompt, filled, seat: r.seat, name: this._n(r.seat), judge: this.judge });
    if (this.history.length > 8) this.history.length = 8;
    this._event('won', r.seat, `${auto ? 'Ведущий задумался — выбрано наугад. ' : ''}Очко получает ${this._n(r.seat)}: «${filled}»`, { i });
    for (const c of r.cards) if (c.cid && this.host.hook) this.host.hook('darkWin', c.cid);
    this._recycle();
    if (sc >= this.goal) {
      this.phase = 'over';
      this.host.finish({ winners: [r.seat], text: `${this._n(r.seat)} набирает ${sc} очков и побеждает. Стыдно должно быть всем.`, scores: Object.fromEntries(this.score) });
      return;
    }
    this.host.timer('show', 7000, () => this._nextJudge());
  }

  _nextJudge() {
    for (const s of this.order) this._refill(s);
    const i = this.order.indexOf(this.judge);
    this.judge = this.order[(i + 1) % this.order.length];
    this._newRound();
  }

  /** Swap the whole hand for a fresh one, once per game, at the cost of a point. */
  _swap(seat) {
    if (this.phase !== 'answer' || seat === this.judge || this.subs.has(seat)) throw new GameError('Сейчас нельзя');
    if (this.swapped && this.swapped.has(seat)) throw new GameError('Карты меняют один раз за партию');
    if (this.score.get(seat) < 1) throw new GameError('Нужно хотя бы одно очко');
    (this.swapped ||= new Set()).add(seat);
    this.score.set(seat, this.score.get(seat) - 1);
    const h = this.hands.get(seat);
    this.used.push(...h.splice(0));
    this._refill(seat);
    this._event('swap', seat, `${this._n(seat)} меняет все карты за одно очко`);
  }
  _take() { throw new GameError('Неизвестный ход'); }

  /** Played cards go to the discard; written ones become ordinary cards of this game's deck too. */
  _recycle() {
    if (this.recycled === this.round) return;
    this.recycled = this.round;
    for (const [, cards] of this.subs || []) for (const c of cards) {
      if (!c.blank) { this.used.push(c); continue; }
      this.nextId = (this.nextId || 1000) + 1;
      this.used.push({ id: this.nextId, t: c.t, cid: c.cid || null, by: c.by || null });
    }
  }

  /** Complain about a players' card in your hand: it leaves the hand, and after a few complaints the pool. */
  _flag(seat, id) {
    const h = this.hands.get(seat);
    const i = h ? h.findIndex((c) => c.id === id) : -1;
    if (i === -1) throw new GameError('Нет такой карты');
    const c = h[i];
    if (!c.cid) throw new GameError('Это карта из основной колоды');
    const u = this.host.userOf ? this.host.userOf(seat) : null;
    if (u && this.host.hook) this.host.hook('darkFlag', c.cid, u.userId);
    h.splice(i, 1);
    this._refill(seat);
    this.host.sys('Карта игроков убрана из руки — спасибо, модераторы посмотрят');
  }

  fill(prompt, texts) {
    let k = 0;
    const lc = (t, first) => (first ? t : t.charAt(0).toLowerCase() + t.slice(1));
    let out = prompt.replace(/____/g, (m, off) => { const t = texts[k++] || '…'; return lc(t, off === 0 || /[.?!]\s*$/.test(prompt.slice(0, off))); });
    out = out.replace(/\.\.$/, '.');
    return out;
  }

  leave(seat) {
    this.order = this.order.filter((s) => s !== seat);
    this.subs && this.subs.delete(seat);
    if (this.order.length < 2) {
      const [w] = this.order;
      this.phase = 'over';
      this.host.finish({ winners: w != null ? [w] : [], text: 'Все разбежались от стыда', scores: Object.fromEntries(this.score) });
      return;
    }
    if (seat === this.judge) {
      this.host.sys('Ведущий сбежал — раунд переигрываем');
      this._recycle();
      this.host.clear('answer'); this.host.clear('show'); this.host.stopTurn();
      this.judge = this.order[0];
      this._newRound();
      return;
    }
    if (this.phase === 'judge') this.reveal = this.reveal.filter((r) => r.seat !== seat);
    if (this.phase === 'judge' && !this.reveal.length) { this._nextJudge(); return; }
    if (this.phase === 'answer' && this._players().every((s) => this.subs.has(s))) this._toJudge();
  }

  view(seat, over) {
    const showNames = this.phase === 'show' || this.phase === 'over' || over;
    return {
      type: 'dark',
      goal: this.goal, round: this.round, phase: this.phase,
      order: this.order, judge: this.judge,
      players: this.order.map((s) => ({ seat: s, name: this._n(s), score: this.score.get(s), answered: this.subs.has(s) })),
      prompt: this.prompt, pick: this.pick,
      hand: seat >= 0 && this.hands.has(seat) ? this.hands.get(seat).map((c) => ({ id: c.id, t: c.t, custom: !!(c.cid || c.by), by: c.by || null })) : null,
      blank: seat >= 0 && this.hands.has(seat) ? 1 : 0,
      written: this.written || 0,
      mine: seat >= 0 && this.subs.has(seat) ? this.subs.get(seat).map((c) => c.t) : null,
      reveal: this.reveal ? this.reveal.map((r) => ({ texts: r.cards.map((c) => c.t), blank: r.cards.some((c) => c.blank), seat: showNames ? r.seat : null })) : null,
      winner: showNames ? this.winner : null,
      answerLeft: this.host.timerLeft('answer'),
      canSwap: seat >= 0 && !(this.swapped && this.swapped.has(seat)) && (this.score.get(seat) || 0) >= 1,
      history: this.history,
      ev: this.ev,
    };
  }

  // ---------- computer players ----------
  botDelay(seat) {
    if (this.phase === 'answer' && seat !== this.judge && !this.subs.has(seat)) return 1500 + (seat % 4) * 400;
    if (this.phase === 'judge' && seat === this.judge) return 3500;
    return null;
  }
  botAct(seat, level, rng) {
    if (this.phase === 'answer') {
      const h = this.hands.get(seat);
      const pick = shuffle(h.slice(), () => rng()).slice(0, this.pick).map((c) => c.id);
      this._answer(seat, { cards: pick });
      return;
    }
    if (this.phase === 'judge') this._choose(seat, Math.floor(rng() * this.reveal.length));
  }
}

module.exports = { DarkGame };
