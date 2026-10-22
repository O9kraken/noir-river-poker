'use strict';
const crypto = require('crypto');
const { FileBackend } = require('./persist');

const START_BALANCE = 10000;
const DAILY_BONUS = 2000;
const BONUS_INTERVAL = 24 * 60 * 60 * 1000;
const TOKEN_TTL = 30 * 24 * 60 * 60 * 1000;
const NAME_RE = /^[A-Za-zА-Яа-яЁё0-9_\- ]{3,16}$/;

class StoreError extends Error {}

const AVATAR_SYMBOLS = ['', 's', 'h', 'd', 'c', 'crown', 'star', 'bolt', 'moon', 'flame'];
const RECENT_MAX = 40;
const HISTORY_DAYS = 45;

const dayKey = (t = Date.now()) => new Date(t + 3 * 3600 * 1000).toISOString().slice(0, 10); // Moscow day

function emptyStats() {
  return {
    poker: { hands: 0, won: 0, net: 0, biggestPot: 0, bestHand: -1, showdowns: 0 },
    sng: { played: 0, won: 0, itm: 0, prizes: 0, buyins: 0 },
    durak: { games: 0, wins: 0, losses: 0, draws: 0, net: 0 },
    bj: { rounds: 0, wins: 0, losses: 0, pushes: 0, blackjacks: 0, net: 0, biggestWin: 0 },
  };
}

/**
 * In-memory user store with a pluggable persistence backend:
 * a JSON file by default, PostgreSQL when DATABASE_URL is set (see persist.js).
 */
class Store {
  /**
   * @param {string|null} file JSON file (ignored when opts.backend is given)
   * @param {object} opts { adminNames, backend, initialData }
   */
  constructor(file, opts = {}) {
    this.adminNames = (opts.adminNames || []).map((n) => String(n).trim().toLowerCase()).filter(Boolean);
    this.backend = opts.backend || new FileBackend(file);
    this.data = { users: {}, sessions: {}, adminLog: [], announcement: null };
    this._saveTimer = null;
    const loaded = opts.backend ? opts.initialData : this.backend.loadSync();
    if (loaded) {
      this.data = loaded;
      this.data.users ||= {};
      this.data.sessions ||= {};
      this.data.adminLog ||= [];
      if (this.data.announcement === undefined) this.data.announcement = null;
    }
    if (!Array.isArray(this.data.sngTemplates)) this.data.sngTemplates = [];
    for (const u of Object.values(this.data.users)) this._upgrade(u);
    // Chips left on tables when the server stopped go back to balances.
    for (const u of Object.values(this.data.users)) {
      u.role ||= 'player';
      if (this.adminNames.includes(u.nameLower)) u.role = 'admin';
      const inPlay = Object.values(u.inPlay || {}).reduce((a, b) => a + b, 0);
      if (inPlay) u.balance += inPlay;
      u.inPlay = {};
    }
    const now = Date.now();
    for (const [h, sess] of Object.entries(this.data.sessions)) if (sess.expires < now) delete this.data.sessions[h];
    this.saveNow();
  }

  _hashPassword(password, salt) {
    return crypto.scryptSync(password, salt, 32).toString('hex');
  }

  _tokenKey(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
  }

  _findByName(name) {
    const lower = name.trim().toLowerCase();
    return Object.values(this.data.users).find((u) => u.nameLower === lower);
  }

  register(name, password) {
    name = String(name || '').trim().replace(/\s+/g, ' ');
    password = String(password || '');
    if (!NAME_RE.test(name)) throw new StoreError('Ник: 3–16 символов, буквы, цифры, пробел, _ или -');
    if (password.length < 6 || password.length > 100) throw new StoreError('Пароль — минимум 6 символов');
    if (this._findByName(name)) throw new StoreError('Такой ник уже занят');
    const id = crypto.randomUUID();
    const salt = crypto.randomBytes(16).toString('hex');
    // admin: listed in ADMIN_NAMES, or the very first account when no list is configured
    const lower = name.toLowerCase();
    const hasAdmin = Object.values(this.data.users).some((u) => u.role === 'admin');
    const role = this.adminNames.includes(lower) || (!this.adminNames.length && !hasAdmin) ? 'admin' : 'player';
    this.data.users[id] = {
      id, name, nameLower: lower, salt, hash: this._hashPassword(password, salt), role, banned: false, muted: false,
      balance: START_BALANCE, inPlay: {}, lastBonus: Date.now(), created: Date.now(),
      handsWon: 0, biggestPot: 0,
    };
    this._upgrade(this.data.users[id]);
    this.save();
    return this._createSession(id);
  }

  login(name, password) {
    const u = this._findByName(String(name || ''));
    const fail = () => new StoreError('Неверный ник или пароль');
    if (!u) { this._hashPassword(String(password || ''), 'x'.repeat(32)); throw fail(); }
    const hash = Buffer.from(this._hashPassword(String(password || ''), u.salt), 'hex');
    if (!crypto.timingSafeEqual(hash, Buffer.from(u.hash, 'hex'))) throw fail();
    if (u.banned) throw new StoreError('Аккаунт заблокирован администратором');
    return this._createSession(u.id);
  }

  _createSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    this.data.sessions[this._tokenKey(token)] = { userId, expires: Date.now() + TOKEN_TTL };
    this.save();
    return { token, user: this.profile(userId) };
  }

  logout(token) {
    delete this.data.sessions[this._tokenKey(token)];
    this.save();
  }

  userByToken(token) {
    if (!token) return null;
    const sess = this.data.sessions[this._tokenKey(token)];
    if (!sess || sess.expires < Date.now()) return null;
    const u = this.data.users[sess.userId];
    return u && !u.banned ? u : null;
  }

  get(userId) { return this.data.users[userId]; }

  profile(userId) {
    const u = this.data.users[userId];
    const inPlay = Object.values(u.inPlay || {}).reduce((a, b) => a + b, 0);
    const nextBonus = u.lastBonus + BONUS_INTERVAL;
    return {
      id: u.id, name: u.name, balance: u.balance, inPlay,
      bonusAvailable: Date.now() >= nextBonus, nextBonusIn: Math.max(0, nextBonus - Date.now()),
      bonusAmount: DAILY_BONUS, handsWon: u.stats.poker.won, biggestPot: u.stats.poker.biggestPot,
      role: u.role || 'player', muted: !!u.muted, avatar: u.avatar,
      friendRequests: u.friendReq.in.length,
    };
  }

  /** Fill in fields added in later versions. */
  _upgrade(u) {
    u.inPlay ||= {};
    const base = emptyStats();
    u.stats ||= {};
    for (const k of Object.keys(base)) u.stats[k] = { ...base[k], ...(u.stats[k] || {}) };
    u.recent ||= [];
    u.history ||= {};
    u.avatar ||= { hue: null, sym: '' };
    u.friends ||= [];
    u.friendReq ||= { in: [], out: [] };
  }

  _chips(u) { return u.balance + Object.values(u.inPlay || {}).reduce((a, b) => a + b, 0); }

  /** Daily total-chips snapshot for the profile chart. */
  snapshot(userId) {
    const u = this.data.users[userId];
    if (!u) return;
    u.history[dayKey()] = this._chips(u);
    const keys = Object.keys(u.history).sort();
    while (keys.length > HISTORY_DAYS) delete u.history[keys.shift()];
  }

  // ---------- stats ----------

  /**
   * Record one finished game for a player.
   * kind: poker | sng | durak | bj; fields depend on the kind.
   */
  recordGame(userId, kind, f) {
    const u = this.data.users[userId];
    if (!u) return;
    const st = u.stats;
    let entry = null;
    if (kind === 'poker') {
      const p = st.poker;
      p.hands += 1;
      if (f.won > 0) p.won += 1;
      if (!f.tournament) p.net += f.net;
      if (f.won > p.biggestPot) p.biggestPot = f.won;
      if (f.showdown) p.showdowns += 1;
      if (f.category != null && f.category > p.bestHand) p.bestHand = f.category;
      // cash hands are grouped into one feed entry per table session
      if (!f.tournament) {
        const last = u.recent[0];
        if (last && last.kind === 'poker' && last.table === f.table && Date.now() - last.t < 60 * 60 * 1000) {
          last.hands = (last.hands || 1) + 1;
          last.net += f.net;
          last.t = Date.now();
          if (f.category != null && f.won > 0 && f.category > (last.cat ?? -1)) { last.cat = f.category; last.best = f.handName; }
        } else {
          entry = { kind, table: f.table, net: f.net, hands: 1, text: 'Покер' };
          if (f.category != null && f.won > 0) { entry.cat = f.category; entry.best = f.handName; }
        }
      }
    } else if (kind === 'sng') {
      const p = st.sng;
      p.played += 1;
      p.buyins += f.buyIn;
      p.prizes += f.prize;
      if (f.place === 1) p.won += 1;
      if (f.prize > 0) p.itm += 1;
      entry = { kind, table: f.table, net: f.prize - f.buyIn, text: `${f.place} место из ${f.total}` };
    } else if (kind === 'durak') {
      const p = st.durak;
      p.games += 1;
      p.net += f.net;
      if (f.draw) p.draws += 1; else if (f.durak) p.losses += 1; else p.wins += 1;
      entry = { kind, table: f.table, net: f.net, text: f.draw ? 'Ничья' : f.durak ? 'Остался дураком' : 'Вышел из игры' };
    } else if (kind === 'bj') {
      const p = st.bj;
      p.rounds += 1;
      p.net += f.net;
      if (f.net > 0) p.wins += 1; else if (f.net < 0) p.losses += 1; else p.pushes += 1;
      p.blackjacks += f.blackjacks || 0;
      if (f.net > p.biggestWin) p.biggestWin = f.net;
      entry = { kind, table: f.table, net: f.net, text: f.blackjacks ? 'Блэкджек!' : f.net > 0 ? 'Выигрыш' : f.net < 0 ? 'Проигрыш' : 'Ничья' };
    }
    if (entry) {
      u.recent.unshift({ t: Date.now(), ...entry });
      if (u.recent.length > RECENT_MAX) u.recent.length = RECENT_MAX;
    }
    this.snapshot(userId);
    this.save();
  }

  setAvatar(userId, hue, sym) {
    const u = this.findUser(userId);
    const h = Number(hue);
    u.avatar = {
      hue: Number.isFinite(h) ? ((Math.round(h) % 360) + 360) % 360 : null,
      sym: AVATAR_SYMBOLS.includes(sym) ? sym : '',
    };
    this.save();
    return u.avatar;
  }

  /** Public profile, visible to anyone. */
  publicProfile(nameOrId) {
    const u = this.data.users[nameOrId] || this._findByName(String(nameOrId || ''));
    if (!u) throw new StoreError('Игрок не найден');
    const chips = this._chips(u);
    const rank = Object.values(this.data.users).filter((x) => this._chips(x) > chips).length + 1;
    return {
      id: u.id, name: u.name, avatar: u.avatar, created: u.created, role: u.role,
      chips, rank, players: Object.keys(this.data.users).length,
      stats: u.stats,
      achievements: achievements(u),
      recent: u.recent.slice(0, 25),
      history: Object.entries(u.history).sort(([a], [b]) => (a < b ? -1 : 1)).map(([d, v]) => ({ d, v })),
      friends: u.friends.length,
    };
  }

  // ---------- friends ----------

  _byName(name) {
    const u = this._findByName(String(name || ''));
    if (!u) throw new StoreError('Игрок с таким ником не найден');
    return u;
  }

  friendRequest(userId, targetName) {
    const me = this.findUser(userId);
    const other = this._byName(targetName);
    if (other.id === me.id) throw new StoreError('Нельзя добавить самого себя');
    if (me.friends.includes(other.id)) throw new StoreError('Вы уже друзья');
    if (me.friends.length >= 100) throw new StoreError('Слишком много друзей');
    // they already asked us: accept straight away
    if (me.friendReq.in.includes(other.id)) return this.friendAccept(userId, other.id);
    if (me.friendReq.out.includes(other.id)) throw new StoreError('Заявка уже отправлена');
    if (other.friendReq.in.length >= 50) throw new StoreError('У игрока слишком много заявок');
    me.friendReq.out.push(other.id);
    other.friendReq.in.push(me.id);
    this.save();
    return { status: 'sent', other };
  }

  friendAccept(userId, otherId) {
    const me = this.findUser(userId);
    const other = this.findUser(otherId);
    if (!me.friendReq.in.includes(other.id)) throw new StoreError('Заявки нет');
    me.friendReq.in = me.friendReq.in.filter((x) => x !== other.id);
    other.friendReq.out = other.friendReq.out.filter((x) => x !== me.id);
    if (!me.friends.includes(other.id)) me.friends.push(other.id);
    if (!other.friends.includes(me.id)) other.friends.push(me.id);
    this.save();
    return { status: 'friends', other };
  }

  friendDecline(userId, otherId) {
    const me = this.findUser(userId);
    const other = this.data.users[otherId];
    me.friendReq.in = me.friendReq.in.filter((x) => x !== otherId);
    me.friendReq.out = me.friendReq.out.filter((x) => x !== otherId);
    if (other) {
      other.friendReq.out = other.friendReq.out.filter((x) => x !== me.id);
      other.friendReq.in = other.friendReq.in.filter((x) => x !== me.id);
    }
    this.save();
  }

  friendRemove(userId, otherId) {
    const me = this.findUser(userId);
    const other = this.data.users[otherId];
    me.friends = me.friends.filter((x) => x !== otherId);
    if (other) other.friends = other.friends.filter((x) => x !== me.id);
    this.save();
  }

  areFriends(a, b) {
    const u = this.data.users[a];
    return !!u && u.friends.includes(b);
  }

  friendsOf(userId) { const u = this.data.users[userId]; return u ? u.friends.slice() : []; }

  brief(userId) {
    const u = this.data.users[userId];
    return u ? { id: u.id, name: u.name, avatar: u.avatar } : null;
  }

  /** Move chips from balance to a table. */
  withdraw(userId, amount) {
    const u = this.data.users[userId];
    if (!Number.isInteger(amount) || amount <= 0) throw new StoreError('Неверная сумма');
    if (u.balance < amount) throw new StoreError('Недостаточно фишек на балансе');
    u.balance -= amount;
    this.save();
  }

  deposit(userId, amount) {
    const u = this.data.users[userId];
    if (!u || amount <= 0) return;
    u.balance += amount;
    this.save();
  }

  setInPlay(userId, tableId, amount) {
    const u = this.data.users[userId];
    if (!u) return;
    if (amount > 0) u.inPlay[tableId] = amount; else delete u.inPlay[tableId];
    this.save();
  }

  claimBonus(userId) {
    const u = this.data.users[userId];
    if (Date.now() < u.lastBonus + BONUS_INTERVAL) throw new StoreError('Бонус уже получен, загляните позже');
    u.balance += DAILY_BONUS;
    u.lastBonus = Date.now();
    this.snapshot(userId);
    this.save();
    return DAILY_BONUS;
  }

  // ---------- admin ----------

  isAdmin(userId) { const u = this.data.users[userId]; return !!u && u.role === 'admin' && !u.banned; }

  findUser(userId) {
    const u = this.data.users[userId];
    if (!u) throw new StoreError('Игрок не найден');
    return u;
  }

  listUsers() {
    return Object.values(this.data.users).map((u) => ({
      id: u.id, name: u.name, balance: u.balance,
      inPlay: Object.values(u.inPlay || {}).reduce((a, b) => a + b, 0),
      role: u.role || 'player', banned: !!u.banned, muted: !!u.muted,
      created: u.created, handsWon: u.stats.poker.won,
    })).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }

  /** Add (or with a negative amount, remove) chips; never below zero. Returns the real change. */
  adjustBalance(userId, delta) {
    const u = this.findUser(userId);
    delta = Math.trunc(Number(delta));
    if (!Number.isFinite(delta) || delta === 0) throw new StoreError('Укажите сумму');
    const real = delta < 0 ? -Math.min(u.balance, -delta) : delta;
    u.balance += real;
    this.save();
    return real;
  }

  _dropSessions(userId) {
    for (const [k, sess] of Object.entries(this.data.sessions)) if (sess.userId === userId) delete this.data.sessions[k];
  }

  setBanned(userId, banned) {
    const u = this.findUser(userId);
    u.banned = !!banned;
    if (banned) this._dropSessions(userId);
    this.save();
  }

  setMuted(userId, muted) { this.findUser(userId).muted = !!muted; this.save(); }

  setRole(userId, role) { this.findUser(userId).role = role === 'admin' ? 'admin' : 'player'; this.save(); }

  /** New random password; all sessions of that player are closed. */
  resetPassword(userId) {
    const u = this.findUser(userId);
    const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    let pass = '';
    for (let i = 0; i < 8; i++) pass += alphabet[crypto.randomInt(alphabet.length)];
    u.salt = crypto.randomBytes(16).toString('hex');
    u.hash = this._hashPassword(pass, u.salt);
    this._dropSessions(userId);
    this.save();
    return pass;
  }

  logAdmin(admin, text) {
    this.data.adminLog.push({ t: Date.now(), admin, text });
    if (this.data.adminLog.length > 300) this.data.adminLog.shift();
    this.save();
  }

  setAnnouncement(text) {
    const clean = String(text || '').trim().slice(0, 300);
    this.data.announcement = clean ? { text: clean, t: Date.now() } : null;
    this.save();
    return this.data.announcement;
  }

  leaderboard(n = 10) {
    return Object.values(this.data.users)
      .map((u) => ({ name: u.name, avatar: u.avatar, chips: this._chips(u) }))
      .sort((a, b) => b.chips - a.chips)
      .slice(0, n);
  }

  save() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => { this._saveTimer = null; this.saveNow(); }, 300);
  }

  saveNow() {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    return this.backend.persist(this.data);
  }

  /** Write everything and wait for it (server shutdown). */
  async flush() {
    await this.saveNow();
    await this.backend.flush();
  }
}

// ---------- achievements ----------
const ACHIEVEMENTS = [
  { id: 'first', title: 'Первая кровь', text: 'Выиграть первую раздачу в покере', ok: (s) => s.poker.won >= 1 },
  { id: 'grinder', title: 'Гриндер', text: 'Сыграть 100 раздач', ok: (s) => s.poker.hands >= 100, progress: (s) => [s.poker.hands, 100] },
  { id: 'shark', title: 'Акула', text: 'Сыграть 1000 раздач', ok: (s) => s.poker.hands >= 1000, progress: (s) => [s.poker.hands, 1000] },
  { id: 'boat', title: 'Полный дом', text: 'Выиграть с фулл-хаусом или лучше', ok: (s) => s.poker.bestHand >= 6 },
  { id: 'quads', title: 'Четвёрка', text: 'Собрать каре', ok: (s) => s.poker.bestHand >= 7 },
  { id: 'royal', title: 'Королевская удача', text: 'Собрать роял-флеш', ok: (s) => s.poker.bestHand >= 9 },
  { id: 'bigpot', title: 'Крупный банк', text: 'Забрать банк от 10 000', ok: (s) => s.poker.biggestPot >= 10000, progress: (s) => [s.poker.biggestPot, 10000] },
  { id: 'sng', title: 'Чемпион', text: 'Выиграть турнир Sit & Go', ok: (s) => s.sng.won >= 1 },
  { id: 'sng5', title: 'Серийный победитель', text: 'Выиграть 5 турниров', ok: (s) => s.sng.won >= 5, progress: (s) => [s.sng.won, 5] },
  { id: 'durak10', title: 'Не дурак', text: 'Выйти первым в 10 партиях дурака', ok: (s) => s.durak.wins >= 10, progress: (s) => [s.durak.wins, 10] },
  { id: 'natural', title: 'Двадцать одно', text: 'Получить блэкджек', ok: (s) => s.bj.blackjacks >= 1 },
  { id: 'natural10', title: 'Любимец шуза', text: '10 блэкджеков', ok: (s) => s.bj.blackjacks >= 10, progress: (s) => [s.bj.blackjacks, 10] },
  { id: 'rich', title: 'Состоятельный', text: 'Накопить 50 000 фишек', ok: (s, u, chips) => chips >= 50000, progress: (s, u, chips) => [chips, 50000] },
  { id: 'social', title: 'Своя компания', text: 'Добавить 3 друзей', ok: (s, u) => u.friends.length >= 3, progress: (s, u) => [u.friends.length, 3] },
];

function achievements(u) {
  const chips = u.balance + Object.values(u.inPlay || {}).reduce((a, b) => a + b, 0);
  return ACHIEVEMENTS.map((a) => {
    const done = !!a.ok(u.stats, u, chips);
    const pr = a.progress ? a.progress(u.stats, u, chips) : null;
    return { id: a.id, title: a.title, text: a.text, done, progress: pr && !done ? [Math.min(pr[0], pr[1]), pr[1]] : null };
  });
}

module.exports = { Store, StoreError, START_BALANCE, DAILY_BONUS, AVATAR_SYMBOLS, dayKey };
