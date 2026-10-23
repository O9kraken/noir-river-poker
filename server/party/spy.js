'use strict';
/**
 * «Шпионы» — two teams, 25 code words, 4–10 players.
 * Each team has a captain who sees whose agents are behind the words. The captain gives one word and
 * a number; the team opens words one by one. Own agent — keep going; a passer-by ends the turn;
 * the rival's agent helps the rivals; the assassin loses the game on the spot.
 */
const { GameError, shuffle } = require('./base');
const { WORDS } = require('./spy-words');

const TEAM_NAMES = { r: 'Алые', b: 'Лазурные' };
const other = (t) => (t === 'r' ? 'b' : 'r');
const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').trim();

class SpyGame {
  static get meta() { return { id: 'spy', title: 'Шпионы', min: 4, max: 10, prefs: ['team', 'captain'] }; }
  static options(o) { return { clueSec: [60, 90, 150].includes(Number(o.clueSec)) ? Number(o.clueSec) : 90 }; }

  constructor(host, players, options) {
    this.host = host;
    this.rng = host.rng;
    this.opt = options;
    this.seq = 0;
    this.ev = null;
    this._teams(players);
    const pool = shuffle(WORDS.slice(), this.rng).slice(0, 25);
    this.start = this.rng() < 0.5 ? 'r' : 'b';
    const colors = [...Array(this.start === 'r' ? 9 : 8).fill('r'), ...Array(this.start === 'b' ? 9 : 8).fill('b'), ...Array(7).fill('n'), 'x'];
    shuffle(colors, this.rng);
    this.cards = pool.map((p, i) => ({ w: p.w, tags: p.tags, color: colors[i], open: false, by: null }));
    this.turnTeam = this.start;
    this.phase = 'clue';
    this.clue = null;
    this.guesses = 0;
    this.marks = new Map(); // card index -> Set(seat)
    this.history = [];
    host.sys(`${TEAM_NAMES.r}: ${this.teams.r.map((s) => host.nameOf(s)).join(', ')} (капитан — ${host.nameOf(this.captain.r)}). ${TEAM_NAMES.b}: ${this.teams.b.map((s) => host.nameOf(s)).join(', ')} (капитан — ${host.nameOf(this.captain.b)}). Начинают ${TEAM_NAMES[this.start]}.`);
    this._armClue();
  }

  _teams(players) {
    const r = []; const b = []; const free = [];
    for (const p of shuffle(players.slice(), this.rng)) {
      const want = p.pref && p.pref.team;
      if (want === 'r' && r.length < Math.ceil(players.length / 2)) r.push(p);
      else if (want === 'b' && b.length < Math.ceil(players.length / 2)) b.push(p);
      else free.push(p);
    }
    for (const p of free) (r.length <= b.length ? r : b).push(p);
    // a team needs a captain and at least one agent
    while (r.length < 2 && b.length > 2) r.push(b.pop());
    while (b.length < 2 && r.length > 2) b.push(r.pop());
    const cap = (list) => { const wish = list.filter((p) => p.pref && p.pref.captain); const pool = wish.length ? wish : list; return pool[Math.floor(this.rng() * pool.length)].seat; };
    this.teams = { r: r.map((p) => p.seat), b: b.map((p) => p.seat) };
    this.captain = { r: cap(r), b: cap(b) };
  }

  _event(type, by, text, extra = {}) { this.seq += 1; this.ev = { seq: this.seq, type, by, text, ...extra }; if (text) this.host.addLog(text); }
  teamOf(seat) { return this.teams.r.includes(seat) ? 'r' : this.teams.b.includes(seat) ? 'b' : null; }
  _left(team) { return this.cards.filter((c) => c.color === team && !c.open).length; }
  _agents(team) { const a = this.teams[team].filter((s) => s !== this.captain[team]); return a.length ? a : [this.captain[team]]; }

  _armClue() {
    this.host.clear('guess');
    this.host.turn(this.captain[this.turnTeam], this.opt.clueSec * 1000, () => {
      this.host.sys(`Капитан ${TEAM_NAMES[this.turnTeam]} молчит — ход переходит`);
      this._pass();
    });
  }

  resume() {
    if (this.phase === 'clue') { this._armClue(); return; }
    const team = this.turnTeam;
    this.host.timer('guess', 150000, () => { this.host.sys(`${TEAM_NAMES[team]} не успели — ход переходит`); this._pass(); });
  }

  _pass() {
    this.turnTeam = other(this.turnTeam);
    this.phase = 'clue';
    this.clue = null;
    this.guesses = 0;
    this.marks.clear();
    this._armClue();
  }

  act(seat, type, p) {
    const team = this.teamOf(seat);
    if (!team) throw new GameError('Вы не в команде');
    if (type === 'clue') return this._clue(seat, team, p);
    if (type === 'mark') return this._mark(seat, team, Number(p.i));
    if (type === 'open') return this._open(seat, team, Number(p.i));
    if (type === 'stop') return this._stop(seat, team);
    throw new GameError('Неизвестный ход');
  }

  validClue(word) {
    const w = norm(word);
    if (!/^[а-яa-z][а-яa-z-]{1,19}$/.test(w)) return 'Подсказка — одно слово, только буквы';
    for (const c of this.cards) {
      if (c.open) continue;
      const cw = norm(c.w);
      if (cw === w) return 'Это слово лежит на столе';
      const stem = Math.min(5, cw.length - 1, w.length - 1);
      if (stem >= 4 && cw.slice(0, stem) === w.slice(0, stem)) return `Слишком похоже на «${c.w}»`;
    }
    return null;
  }

  _clue(seat, team, p) {
    if (this.phase !== 'clue' || team !== this.turnTeam || seat !== this.captain[team]) throw new GameError('Сейчас подсказку даёт не вы');
    const err = this.validClue(p.word);
    if (err) throw new GameError(err);
    const n = Math.floor(Number(p.n));
    if (!(n >= 0 && n <= 9)) throw new GameError('Число от 0 до 9 (0 — без ограничения)');
    const word = norm(p.word);
    this.clue = { word, n, team };
    this.history.push({ team, word, n, opened: [] });
    this.phase = 'guess';
    this.guesses = 0;
    this.host.stopTurn();
    this.host.timer('guess', 150000, () => { this.host.sys(`${TEAM_NAMES[team]} не успели — ход переходит`); this._pass(); });
    this._event('clue', seat, `Капитан ${TEAM_NAMES[team]}: «${word.toUpperCase()}» — ${n || '∞'}`, { team });
  }

  _mark(seat, team, i) {
    if (this.phase !== 'guess' || team !== this.turnTeam) throw new GameError('Сейчас не ваш ход');
    const c = this.cards[i];
    if (!c || c.open) throw new GameError('Нет такой карты');
    const m = this.marks.get(i) || new Set();
    if (m.has(seat)) m.delete(seat); else m.add(seat);
    if (m.size) this.marks.set(i, m); else this.marks.delete(i);
  }

  _open(seat, team, i) {
    if (this.phase !== 'guess' || team !== this.turnTeam) throw new GameError('Сейчас не ваш ход');
    if (seat === this.captain[team] && this._agents(team)[0] !== seat) throw new GameError('Капитан не открывает слова');
    const c = this.cards[i];
    if (!c || c.open) throw new GameError('Это слово уже открыто');
    c.open = true;
    c.by = team;
    this.marks.delete(i);
    this.guesses += 1;
    const h = this.history[this.history.length - 1];
    if (h) h.opened.push({ w: c.w, color: c.color });
    const who = this.host.nameOf(seat);
    if (c.color === 'x') {
      this._event('open', seat, `${who} открывает «${c.w}» — это ликвидатор!`, { i, color: c.color });
      this.host.finish({ winners: this.teams[other(team)], text: `${TEAM_NAMES[team]} нарвались на ликвидатора. Победа: ${TEAM_NAMES[other(team)]}!`, extra: { team: other(team) } });
      return;
    }
    const label = c.color === team ? 'свой агент' : c.color === 'n' ? 'мирный прохожий' : 'агент соперников';
    this._event('open', seat, `${who} открывает «${c.w}» — ${label}`, { i, color: c.color });
    for (const t of ['r', 'b']) {
      if (!this._left(t)) { this.host.finish({ winners: this.teams[t], text: `Все агенты найдены. Победа: ${TEAM_NAMES[t]}!`, extra: { team: t } }); return; }
    }
    if (c.color !== team) { this._pass(); return; }
    const limit = this.clue.n === 0 ? Infinity : this.clue.n + 1;
    if (this.guesses >= limit) this._pass();
  }

  _stop(seat, team) {
    if (this.phase !== 'guess' || team !== this.turnTeam) throw new GameError('Сейчас не ваш ход');
    if (!this.guesses) throw new GameError('Откройте хотя бы одно слово');
    this._event('stop', seat, `${TEAM_NAMES[team]} останавливаются`);
    this._pass();
  }

  leave(seat) {
    const team = this.teamOf(seat);
    if (!team) return;
    this.teams[team] = this.teams[team].filter((s) => s !== seat);
    if (!this.teams[team].length) {
      this.host.finish({ winners: this.teams[other(team)], text: `В команде ${TEAM_NAMES[team]} никого не осталось. Победа: ${TEAM_NAMES[other(team)]}!`, extra: { team: other(team) } });
      return;
    }
    if (this.captain[team] === seat) {
      this.captain[team] = this.teams[team][0];
      this.host.sys(`Новый капитан ${TEAM_NAMES[team]}: ${this.host.nameOf(this.captain[team])}`);
      if (this.phase === 'clue' && this.turnTeam === team) this._armClue();
    }
  }

  view(seat, over) {
    const team = seat >= 0 ? this.teamOf(seat) : null;
    const captain = team && this.captain[team] === seat;
    const marks = {};
    if (team === this.turnTeam || over) for (const [i, m] of this.marks) marks[i] = [...m];
    const tv = this.host.timerLeft('guess');
    return {
      type: 'spy',
      cards: this.cards.map((c) => ({ w: c.w, open: c.open, color: c.open || captain || over ? c.color : null })),
      teams: this.teams, captain: this.captain, names: TEAM_NAMES,
      start: this.start, turnTeam: this.turnTeam, phase: this.phase, clue: this.clue,
      guesses: this.guesses, limit: this.clue ? (this.clue.n === 0 ? null : this.clue.n + 1) : null,
      left: { r: this._left('r'), b: this._left('b') },
      marks, history: this.history.slice(-12),
      myTeam: team, amCaptain: !!captain,
      canGuess: !!(team && team === this.turnTeam && this.phase === 'guess' && (!captain || this._agents(team)[0] === seat)),
      guessLeft: tv,
      ev: this.ev,
    };
  }

  // ---------- computer players ----------
  botDelay(seat) {
    const team = this.teamOf(seat);
    if (!team || team !== this.turnTeam) return null;
    if (this.phase === 'clue' && this.captain[team] === seat) return 2600;
    if (this.phase === 'guess') {
      const agents = this._agents(team);
      // one computer agent acts for the team; people on the team get time to think too
      const botAgent = agents.find((s) => this._isBot(s));
      const humans = agents.some((s) => !this._isBot(s));
      if (botAgent === seat) return humans ? 9000 : 2000;
    }
    return null;
  }
  _isBot(seat) { const s = this.host.seats[seat]; return !!(s && String(s.userId).startsWith('bot:')); }

  botAct(seat, level, rng) {
    const team = this.teamOf(seat);
    if (this.phase === 'clue') {
      const mine = this.cards.filter((c) => !c.open && c.color === team);
      const bad = this.cards.filter((c) => !c.open && c.color !== team);
      const score = new Map();
      for (const c of mine) for (const t of c.tags) score.set(t, (score.get(t) || 0) + 1);
      let best = null;
      for (const [t, n] of score) {
        if (this.validClue(t)) continue;
        const risk = bad.filter((c) => c.tags.includes(t));
        const deadly = risk.some((c) => c.color === 'x' || c.color === other(team));
        const val = n - (deadly ? 10 : risk.length * 0.6) + rng() * 0.3;
        const cap = level === 'easy' ? 1 : level === 'normal' ? 2 : 3;
        if (!best || val > best.val) best = { t, n: Math.min(n, cap), val };
      }
      if (!best) {
        const any = mine[0];
        const word = any ? (any.tags.find((t) => !this.validClue(t)) || 'агент') : 'агент';
        this._clue(seat, team, { word, n: 1 });
        return;
      }
      this._clue(seat, team, { word: best.t, n: Math.max(1, best.n) });
      return;
    }
    const clue = this.clue ? this.clue.word : '';
    const closed = this.cards.map((c, i) => ({ c, i })).filter((x) => !x.c.open);
    let cands = closed.filter((x) => x.c.tags.some((t) => norm(t) === clue));
    // a clue a person gave: words that share its beginning, then anything
    if (!cands.length) cands = closed.filter((x) => norm(x.c.w).slice(0, 3) === clue.slice(0, 3));
    const limit = this.clue.n || 9;
    if (this.guesses >= limit || (!cands.length && this.guesses)) { this._stop(seat, team); return; }
    if (level === 'easy' && rng() < 0.25) cands = [];
    const pick = cands.length ? cands[Math.floor(rng() * cands.length)] : closed[Math.floor(rng() * closed.length)];
    this._open(seat, team, pick.i);
  }
}

module.exports = { SpyGame, TEAM_NAMES };
