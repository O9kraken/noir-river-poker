'use strict';
/**
 * Computer opponents for practice tables (no chips at stake, nothing goes to stats).
 * A driver is attached to a table; the table's onUpdate pokes it, and when one of the bots
 * has something to do it acts after a short, human-looking pause.
 */
const checkersAI = require('./checkers-ai');
const durakAI = require('./durak-ai');
const pokerAI = require('./poker-ai');
const chessAI = require('./chess-ai');
const nardyAI = require('./nardy-ai');
const { CELLS: CAP_CELLS, GROUPS: CAP_GROUPS } = require('../capital/board');
const MAFIA_ROLES = new Set(['maf', 'don']);

const BOT_PREFIX = 'bot:';
const isBot = (userId) => typeof userId === 'string' && userId.startsWith(BOT_PREFIX);
const LEVELS = ['easy', 'normal', 'hard'];
const LEVEL_NAMES = { easy: 'Новичок', normal: 'Любитель', hard: 'Мастер' };
const NAMES = ['Аркадий', 'Вера', 'Гоша', 'Дина', 'Лев', 'Мира', 'Савва', 'Тоня', 'Борис', 'Ника'];
// fixed looks for bots: hue + symbol, like players' generated avatars
const LOOKS = [
  { hue: 200, sym: 'bolt' }, { hue: 320, sym: 'moon' }, { hue: 40, sym: 'star' }, { hue: 140, sym: 'flame' },
  { hue: 260, sym: 'crown' }, { hue: 10, sym: 's' }, { hue: 90, sym: 'd' }, { hue: 180, sym: 'c' },
  { hue: 30, sym: 'h' }, { hue: 290, sym: 'star' },
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
    if (this.kind === 'cap') return this._capPending();
    if (this.kind === 'pt') { const d = t.botDelay(this.ids); return d == null ? null : this._pause(d * 0.8, d * 1.3); }
    if (this.kind === 'mf') return this._mfPending();
    if (this.kind === 'bg') {
      const bi = t.seats.findIndex((s) => s && this.ids.has(s.userId));
      if (bi === -1) return null;
      if (t.status === 'waiting' && !t.seats[bi].ready) return this._pause(300, 700);
      if (t.status !== 'playing' || !t.game || t.game.turn !== t.colorOf(bi) || t.game.result) return null;
      if (!t.game.dice) return this._pause(600, 1100);
      return t.game.done() ? null : this._pause(380, 700);
    }
    if (this.kind === 'ck' || this.kind === 'ch') {
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
    if (this.kind === 'cap') { this._capStep(); return; }
    if (this.kind === 'pt') { t.botStep(this.ids, this.level, this.random); return; }
    if (this.kind === 'mf') { this._mfStep(); return; }
    if (this.kind === 'bg') {
      const bi = t.seats.findIndex((s) => s && this.ids.has(s.userId));
      const bot = t.seats[bi];
      if (t.status === 'waiting') { if (!bot.ready) t.setReady(bot.userId, true); return; }
      const g = t.game;
      if (t.status !== 'playing' || g.turn !== t.colorOf(bi)) return;
      if (!g.dice) { t.roll(bot.userId); this.bgPlan = g.need ? nardyAI.chooseTurn(g, this.level, this.random) : []; return; }
      if (!this.bgPlan || !this.bgPlan.length) this.bgPlan = nardyAI.chooseTurn(g, this.level, this.random);
      const m = this.bgPlan.shift();
      if (!m) return;
      try { t.move(bot.userId, { from: m.from, die: m.die }); } catch (e) { this.bgPlan = null; throw e; }
      return;
    }
    if (this.kind === 'ch') {
      const bi = t.seats.findIndex((s) => s && this.ids.has(s.userId));
      const bot = t.seats[bi];
      if (t.status === 'waiting') { if (!bot.ready) t.setReady(bot.userId, true); return; }
      if (t.status !== 'playing') return;
      const color = t.colorOf(bi);
      const pos = t.game.pos;
      if (t.drawOffer && t.drawOffer !== color) {
        const mine = chessAI.evaluate(pos) * (pos.turn === color ? 1 : -1);
        if (mine <= 50) t.offerDraw(bot.userId); else t.declineDraw(bot.userId);
        return;
      }
      if (t.game.turn !== color) return;
      const mv = chessAI.chooseMove(pos, this.level, this.random);
      if (mv) t.move(bot.userId, { from: mv.from, to: mv.to, promo: mv.promo });
      return;
    }
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
  // ---------- Капитал ----------
  _capBotTurn() {
    const t = this.table;
    if (t.status !== 'playing') return null;
    const g = t.g;
    if (g.trade) { const p = t._player(g.trade.to); return p && this.ids.has(p.userId) ? { p, trade: true } : null; }
    const p = t._current();
    return p && this.ids.has(p.userId) ? { p } : null;
  }
  _capPending() {
    const t = this.table;
    if (t.status === 'waiting' || t.status === 'countdown') return t.seats.some((s) => s && this.ids.has(s.userId) && !s.ready) ? this._pause(300, 800) : null;
    return this._capBotTurn() ? this._pause(650, 1300) : null;
  }
  _reserve() { return { easy: 40, normal: 120, hard: 180 }[this.level]; }
  _capValue(cells, cash) { return cash + cells.reduce((a, i) => a + (CAP_CELLS[i].price || 0), 0); }
  _capStep() {
    const t = this.table;
    if (t.status === 'waiting' || t.status === 'countdown') {
      for (const s of t.seats) if (s && this.ids.has(s.userId) && !s.ready) t.setReady(s.userId, true);
      return;
    }
    const who = this._capBotTurn();
    if (!who) return;
    const { p } = who;
    const g = t.g;
    if (who.trade) {
      const tr = g.trade;
      const gain = this._capValue(tr.give.cells, tr.give.cash);
      const loss = this._capValue(tr.get.cells, tr.get.cash);
      // never give away a street that completes or belongs to a set we hold
      const breaksSet = tr.get.cells.some((i) => CAP_CELLS[i].group && t._hasSet(p.seat, CAP_CELLS[i].group));
      t.answerTrade(p.userId, !breaksSet && gain >= loss * (this.level === 'easy' ? 1 : 1.25));
      return;
    }
    const reserve = this._reserve();
    if (g.phase === 'buy' && g.pending) {
      const cell = CAP_CELLS[g.pending.cell];
      const completes = cell.group && t._groupCells(cell.group).every((i) => i === g.pending.cell || g.cells[i].owner === p.seat);
      if (p.cash - cell.price >= (completes ? 0 : reserve)) t.buy(p.userId); else t.decline(p.userId);
      return;
    }
    if (g.phase === 'roll' && p.jail && (p.jailCards || (p.cash > 600 && this.level !== 'easy'))) { t.payBail(p.userId); return; }
    // try to buy the one street that would complete a quarter (once in a while)
    if (g.phase === 'roll' && this.level !== 'easy' && !g.trade) {
      this.capAsked ||= {};
      for (const group of Object.keys(CAP_GROUPS)) {
        const cells = t._groupCells(group);
        const mine = cells.filter((i) => g.cells[i].owner === p.seat);
        const missing = cells.filter((i) => g.cells[i].owner !== p.seat);
        if (mine.length < cells.length - 1 || missing.length !== 1) continue;
        const i = missing[0];
        const owner = g.cells[i].owner;
        if (owner == null || g.cells[i].houses || cells.some((j) => g.cells[j].houses)) continue;
        const key = `${p.seat}:${i}`;
        if (this.capAsked[key] && g.moveNo - this.capAsked[key] < 12) continue;
        const offer = Math.min(p.cash - 50, Math.round(CAP_CELLS[i].price * (1.4 + this.random() * 0.4)));
        if (offer < CAP_CELLS[i].price) continue;
        this.capAsked[key] = g.moveNo;
        try { t.offerTrade(p.userId, { to: owner, give: { cells: [], cash: offer }, get: { cells: [i], cash: 0 } }); return; } catch (e) { /* not possible right now */ }
      }
    }
    // build one house where it is cheapest and allowed; buy back mortgaged streets when rich
    if (g.phase !== 'buy') {
      const own = g.cells.map((st, i) => ({ st, i })).filter((x) => x.st.owner === p.seat);
      const mort = own.find((x) => x.st.mortgaged && p.cash > 600 + CAP_CELLS[x.i].price);
      if (mort) { t.mortgage(p.userId, mort.i); return; }
      const buildable = own.filter((x) => {
        const c = CAP_CELLS[x.i];
        if (c.kind !== 'street' || x.st.houses >= 5 || !t._hasSet(p.seat, c.group)) return false;
        const grp = t._groupCells(c.group);
        if (grp.some((i) => g.cells[i].mortgaged || g.cells[i].houses < x.st.houses)) return false;
        return p.cash - CAP_GROUPS[c.group].house >= reserve + 60;
      }).sort((a, b) => a.st.houses - b.st.houses);
      if (buildable.length && this.level !== 'easy') { t.build(p.userId, buildable[0].i); return; }
    }
    if (g.phase === 'roll') t.roll(p.userId);
    else if (g.phase === 'end') t.endTurn(p.userId);
  }

  // ---------- Мафия ----------
  _mfMem() {
    const t = this.table;
    if (!this.mf || this.mf.game !== t.gameNo) this.mf = { game: t.gameNo, said: new Set(), found: {}, voteAt: {} };
    return this.mf;
  }
  _mfBots() { const t = this.table; return t.g ? t.g.players.filter((p) => p.alive && this.ids.has(p.userId)) : []; }
  _mfPending() {
    const t = this.table;
    if (t.status === 'waiting' || t.status === 'countdown') return t.seats.some((s) => s && this.ids.has(s.userId) && !s.ready) ? this._pause(300, 800) : null;
    if (t.status !== 'playing') return null;
    const g = t.g;
    const mem = this._mfMem();
    const bots = this._mfBots();
    if (g.phase === 'night') return bots.some((b) => this._mfNightTodo(b)) ? this._pause(1500, 3500) : null;
    if (g.phase === 'vote') return bots.some((b) => g.votes[b.seat] === undefined) ? this._pause(1500, 4000) : null;
    if (g.phase === 'day') return bots.some((b) => !mem.said.has(`${g.day}:${b.seat}`)) ? this._pause(2500, 6000) : null;
    return null;
  }
  _mfNightTodo(b) {
    const n = this.table.g.night;
    if (!n) return null;
    if (MAFIA_ROLES.has(b.role) && n.kills[b.seat] == null) return 'kill';
    if (b.role === 'don' && n.donCheck == null) return 'don';
    if (b.role === 'com' && n.check == null) return 'check';
    if (b.role === 'doc' && n.heal == null) return 'heal';
    return null;
  }
  _pick(list) { return list.length ? list[Math.floor(this.random() * list.length)] : null; }
  _mfStep() {
    const t = this.table;
    if (t.status === 'waiting' || t.status === 'countdown') {
      for (const s of t.seats) if (s && this.ids.has(s.userId) && !s.ready) t.setReady(s.userId, true);
      return;
    }
    if (t.status !== 'playing') return;
    const g = t.g;
    const mem = this._mfMem();
    const alive = t._alive();
    const bots = this._mfBots();
    if (g.phase === 'night') {
      for (const b of bots) {
        const todo = this._mfNightTodo(b);
        if (!todo) continue;
        let target;
        if (todo === 'kill') {
          // follow a teammate's choice, or hunt a revealed commissar
          const team = Object.values(g.night.kills);
          const claimed = alive.find((p) => mem.found[p.seat] === 'com');
          target = team.length ? team[0] : claimed ? claimed.seat : (this._pick(alive.filter((p) => !MAFIA_ROLES.has(p.role))) || {}).seat;
        } else if (todo === 'check') {
          const done = new Set((g.checks[b.seat] || []).map((c) => c.seat));
          target = (this._pick(alive.filter((p) => p !== b && !done.has(p.seat))) || this._pick(alive.filter((p) => p !== b)) || {}).seat;
        } else if (todo === 'don') {
          const done = new Set((g.donChecks[b.seat] || []).map((c) => c.seat));
          target = (this._pick(alive.filter((p) => !MAFIA_ROLES.has(p.role) && !done.has(p.seat))) || {}).seat;
        } else {
          const pool = alive.filter((p) => p.seat !== g.lastHeal);
          target = (this.random() < 0.35 && b.seat !== g.lastHeal ? b : this._pick(pool) || {}).seat;
        }
        if (target != null) { t.nightAction(b.userId, todo, target); return; }
      }
      return;
    }
    if (g.phase === 'day') {
      for (const b of bots) {
        const key = `${g.day}:${b.seat}`;
        if (mem.said.has(key)) continue;
        mem.said.add(key);
        const found = b.role === 'com' && (g.checks[b.seat] || []).find((c) => c.mafia && t._p(c.seat).alive);
        const others = alive.filter((p) => p !== b);
        let line = null;
        if (found && this.level !== 'easy') { line = `Я комиссар. ${t._p(found.seat).name} — мафия, голосуйте!`; mem.found[found.seat] = 'maf'; mem.found[b.seat] = 'com'; }
        else if (this.random() < 0.7) {
          const x = this._pick(others);
          line = this._pick([`Я мирный, честно.`, `${x.name}, а ты что молчишь?`, `Мне не нравится, как ведёт себя ${x.name}.`, 'Давайте не торопиться с голосованием.', `Ночью было тихо… подозрительно тихо.`, `${x.name} точно не мафия, я уверен.`]);
        }
        if (line) t.say(b.userId, t.seats[b.seat].name, line);
        return;
      }
      return;
    }
    if (g.phase === 'vote') {
      for (const b of bots) {
        if (g.votes[b.seat] !== undefined) continue;
        const others = alive.filter((p) => p !== b);
        let target;
        const accused = others.find((p) => mem.found[p.seat] === 'maf');
        if (MAFIA_ROLES.has(b.role)) {
          // mafia votes against the loudest accuser or a random townsperson
          const accuser = others.find((p) => mem.found[p.seat] === 'com');
          target = accuser || this._pick(others.filter((p) => !MAFIA_ROLES.has(p.role)));
        } else if (accused) target = accused;
        else if (this.random() < { easy: 0.08, normal: 0.22, hard: 0.35 }[this.level]) {
          // a hunch: townspeople sometimes read the mafia right
          target = this._pick(others.filter((p) => MAFIA_ROLES.has(p.role)));
        } else {
          // otherwise follow the current leader of the vote, or pick someone
          const tally = {};
          for (const v of Object.values(g.votes)) if (v != null) tally[v] = (tally[v] || 0) + 1;
          const lead = Object.entries(tally).sort((a, c) => c[1] - a[1])[0];
          const leader = lead && t._p(Number(lead[0]));
          target = leader && leader !== b && leader.alive && this.random() < 0.6 ? leader : this.random() < 0.15 ? null : this._pick(others);
        }
        t.vote(b.userId, target ? target.seat : 'skip');
        return;
      }
    }
  }

}

module.exports = { BotDriver, makeBots, isBot, LEVELS, LEVEL_NAMES, BOT_PREFIX };
