'use strict';
/**
 * Computer opponents for practice tables (no chips at stake, nothing goes to stats).
 * A driver is attached to a table; the table's onUpdate pokes it, and when one of the bots
 * has something to do it acts after a short, human-looking pause.
 */
const checkersAI = require('./checkers-ai');
const durakAI = require('./durak-ai');
const pokerAI = require('./poker-ai');

const BOT_PREFIX = 'bot:';
const isBot = (userId) => typeof userId === 'string' && userId.startsWith(BOT_PREFIX);
const LEVELS = ['easy', 'normal', 'hard'];
const LEVEL_NAMES = { easy: 'Новичок', normal: 'Любитель', hard: 'Мастер' };
const NAMES = ['Аркадий', 'Вера', 'Гоша', 'Дина', 'Лев', 'Мира', 'Савва', 'Тоня'];
// fixed looks for bots: hue + symbol, like players' generated avatars
const LOOKS = [
  { hue: 200, sym: 'bolt' }, { hue: 320, sym: 'moon' }, { hue: 40, sym: 'star' }, { hue: 140, sym: 'flame' },
  { hue: 260, sym: 'crown' }, { hue: 10, sym: 's' }, { hue: 90, sym: 'd' }, { hue: 180, sym: 'c' },
];

function makeBots(n, salt = 0) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const j = (k + salt) % NAMES.length;
    out.push({ userId: `${BOT_PREFIX}${j}`, name: `${NAMES[j]} · бот`, avatar: { ...LOOKS[j], bot: true } });
  }
  return out;
}

class BotDriver {
  /**
   * @param {object} table   CheckersTable | DurakTable | Table (poker)
   * @param {string} kind    'ck' | 'durak' | 'poker'
   * @param {object[]} bots  [{ userId, name, avatar }]
   * @param {string} level   easy | normal | hard
   */
  constructor(table, kind, bots, level, opts = {}) {
    this.table = table;
    this.kind = kind;
    this.bots = bots;
    this.ids = new Set(bots.map((b) => b.userId));
    this.level = LEVELS.includes(level) ? level : 'normal';
    this.timers = opts.timers || { set: setTimeout, clear: clearTimeout };
    this.fast = !!opts.fast; // tests: no thinking pauses
    this.random = opts.random || Math.random;
    this.timer = null;
    this.stopped = false;
    this.botStack = opts.botStack || 0;
  }

  avatarOf(userId) { const b = this.bots.find((x) => x.userId === userId); return b ? b.avatar : null; }

  stop() { this.stopped = true; if (this.timer) { this.timers.clear(this.timer); this.timer = null; } }

  /** Called on every table update. */
  poke() {
    if (this.stopped || this.timer) return;
    const delay = this._pending();
    if (delay == null) return;
    this.timer = this.timers.set(() => {
      this.timer = null;
      if (this.stopped) return;
      try { this._step(); } catch (e) { /* a stale decision: the next update pokes again */ }
      this.poke();
    }, this.fast ? 0 : delay);
  }

  _humanActive() {
    return this.table.seats.some((s) => s && !this.ids.has(s.userId) && !s.sittingOut && !s.leaving && s.stack > 0);
  }

  _pause(min, max) { return Math.round(min + this.random() * (max - min)); }

  /** ms to wait before the next bot action, or null if no bot has anything to do. */
  _pending() {
    const t = this.table;
    if (this.kind === 'ck') {
      const bi = t.seats.findIndex((s) => s && this.ids.has(s.userId));
      if (bi === -1) return null;
      if (t.status === 'waiting' && !t.seats[bi].ready) return this._pause(300, 700);
      if (t.status !== 'playing' || !t.game) return null;
      const color = t.colorOf(bi);
      if (t.drawOffer && t.drawOffer !== color) return this._pause(800, 1500);
      if (t.game.turn === color) return this._pause(450, 1100);
      return null;
    }
    if (this.kind === 'durak') {
      if (t.status === 'waiting' || t.status === 'countdown') {
        return t.seats.some((s) => s && this.ids.has(s.userId) && !s.ready) ? this._pause(300, 800) : null;
      }
      if (t.status !== 'playing' || !t.game || t.game.over) return null;
      const w = t.game.waitingFor();
      return w.seats.some((i) => t.seats[i] && this.ids.has(t.seats[i].userId)) ? this._pause(650, 1400) : null;
    }
    if (this.kind === 'poker') {
      const h = t.hand;
      if (!h) {
        // between hands: top bots up, and let them sit out while no person is playing
        const active = this._humanActive();
        return t.seats.some((s) => s && this.ids.has(s.userId) && (s.stack < t.bb * 10 || s.sittingOut === active)) ? 200 : null;
      }
      if (h.ended || h.toAct === -1) return null;
      const s = t.seats[h.toAct];
      return s && this.ids.has(s.userId) ? this._pause(700, 1900) : null;
    }
    return null;
  }

  _step() {
    const t = this.table;
    if (this.kind === 'ck') {
      const bi = t.seats.findIndex((s) => s && this.ids.has(s.userId));
      const bot = t.seats[bi];
      if (t.status === 'waiting') { if (!bot.ready) t.setReady(bot.userId, true); return; }
      if (t.status !== 'playing') return;
      const color = t.colorOf(bi);
      if (t.drawOffer && t.drawOffer !== color) {
        if (checkersAI.acceptsDraw(t.game.board, color)) t.offerDraw(bot.userId); else t.declineDraw(bot.userId);
        return;
      }
      if (t.game.turn !== color) return;
      const mv = checkersAI.chooseMove(t.game.board, color, this.level, this.random);
      if (mv) t.move(bot.userId, mv.path);
      return;
    }
    if (this.kind === 'durak') {
      if (t.status === 'waiting' || t.status === 'countdown') {
        for (const s of t.seats) if (s && this.ids.has(s.userId) && !s.ready) t.setReady(s.userId, true);
        return;
      }
      const g = t.game;
      const w = g.waitingFor();
      for (const seat of w.seats) {
        const s = t.seats[seat];
        if (!s || !this.ids.has(s.userId)) continue;
        const a = durakAI.decide(g, seat, this.level, this.random);
        if (a) { t.act(s.userId, a.type, a.card, a.index); return; }
      }
      return;
    }
    if (this.kind === 'poker') {
      const h = t.hand;
      if (!h) {
        const active = this._humanActive();
        for (const s of t.seats) {
          if (!s || !this.ids.has(s.userId)) continue;
          if (s.stack < t.bb * 10) { s.stack = this.botStack || t.bb * 100; s.startStack = s.stack; }
          s.sittingOut = !active;
        }
        if (active) t.start();
        t.onUpdate(t);
        return;
      }
      const i = h.toAct;
      const s = t.seats[i];
      if (!s || !this.ids.has(s.userId)) return;
      const d = pokerAI.decide(t, i, this.level, this.random);
      try { t.act(s.userId, d.type, d.amount); } catch (e) { t.act(s.userId, h.currentBet > s.bet ? 'fold' : 'check'); }
    }
  }
}

module.exports = { BotDriver, makeBots, isBot, LEVELS, LEVEL_NAMES, BOT_PREFIX };
