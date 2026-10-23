'use strict';
const crypto = require('crypto');
const { FileBackend } = require('./persist');

const START_BALANCE = 10000;
const DAILY_BONUS = 2000; // average-ish prize of the daily wheel, kept for old clients
// Daily fortune wheel: sectors in the order they are drawn on the wheel, weight = relative chance.
const WHEEL = [
  { amount: 1000, weight: 22 }, { amount: 3000, weight: 10 }, { amount: 500, weight: 18 }, { amount: 7500, weight: 3 },
  { amount: 1500, weight: 20 }, { amount: 2000, weight: 14 }, { amount: 25000, weight: 1 }, { amount: 5000, weight: 5 },
  { amount: 1000, weight: 22 }, { amount: 2000, weight: 14 }, { amount: 500, weight: 18 }, { amount: 3000, weight: 10 },
];
const WHEEL_TOTAL = WHEEL.reduce((a, s) => a + s.weight, 0);
const RATING_START = 1200;
const RATED = ['checkers', 'durak', 'chess', 'nardy'];
const SEASON_GAMES = ['poker', 'sng', 'durak', 'bj', 'roulette', 'checkers', 'chess', 'capital', 'mafia', 'nardy'];
const SEASON_PRIZES = [5000, 3000, 1500];
const SEASON_MIN_GAMES = 10;
const SEASON_KEEP = 12;
const BONUS_INTERVAL = 24 * 60 * 60 * 1000;
const TOKEN_TTL = 30 * 24 * 60 * 60 * 1000;
const NAME_RE = /^[A-Za-zА-Яа-яЁё0-9_\- ]{3,16}$/;

class StoreError extends Error {}

const AVATAR_SYMBOLS = ['', 's', 'h', 'd', 'c', 'crown', 'star', 'bolt', 'moon', 'flame'];
const RECENT_MAX = 40;
const HISTORY_DAYS = 45;

const dayKey = (t = Date.now()) => new Date(t + 3 * 3600 * 1000).toISOString().slice(0, 10); // Moscow day

/**
 * The club shop: looks bought with chips. Frames and titles are seen by everyone,
 * card backs and felt colour change the player's own tables.
 */
const SHOP = [
  { id: 'frame-none', cat: 'frame', name: 'Без рамки', price: 0 },
  { id: 'frame-silver', cat: 'frame', name: 'Серебро', price: 2500 },
  { id: 'frame-gold', cat: 'frame', name: 'Золото', price: 5000 },
  { id: 'frame-emerald', cat: 'frame', name: 'Изумруд', price: 7000 },
  { id: 'frame-ruby', cat: 'frame', name: 'Рубин', price: 7000 },
  { id: 'frame-neon', cat: 'frame', name: 'Неон', price: 12000, note: 'переливается' },
  { id: 'frame-crown', cat: 'frame', name: 'Корона', price: 25000, note: 'золото и корона' },
  { id: 'back-classic', cat: 'back', name: 'Бордо', price: 0 },
  { id: 'back-emerald', cat: 'back', name: 'Изумрудная', price: 1500 },
  { id: 'back-midnight', cat: 'back', name: 'Полночь', price: 2500 },
  { id: 'back-noir', cat: 'back', name: 'Нуар с золотом', price: 4000 },
  { id: 'back-river', cat: 'back', name: 'Река', price: 6000 },
  { id: 'back-aurora', cat: 'back', name: 'Северное сияние', price: 9000 },
  { id: 'felt-classic', cat: 'felt', name: 'Клубное зелёное', price: 0 },
  { id: 'felt-burgundy', cat: 'felt', name: 'Бордовое', price: 3000 },
  { id: 'felt-midnight', cat: 'felt', name: 'Полночное синее', price: 3000 },
  { id: 'felt-graphite', cat: 'felt', name: 'Графит', price: 4000 },
  { id: 'felt-royal', cat: 'felt', name: 'Королевский пурпур', price: 6000 },
  { id: 'felt-sand', cat: 'felt', name: 'Песок пустыни', price: 6000 },
  { id: 'title-none', cat: 'title', name: 'Без титула', price: 0 },
  { id: 'title-lucky', cat: 'title', name: 'Счастливчик', price: 2000 },
  { id: 'title-shark', cat: 'title', name: 'Акула', price: 4000 },
  { id: 'title-bluff', cat: 'title', name: 'Мастер блефа', price: 5000 },
  { id: 'title-tycoon', cat: 'title', name: 'Магнат', price: 8000 },
  { id: 'title-gm', cat: 'title', name: 'Гроссмейстер', price: 8000 },
  { id: 'title-don', cat: 'title', name: 'Дон', price: 10000 },
  { id: 'title-legend', cat: 'title', name: 'Легенда клуба', price: 50000 },
];
const SHOP_DEFAULT = { frame: 'frame-none', back: 'back-classic', felt: 'felt-classic', title: 'title-none' };
const titleOf = (u) => { const t = u.shop && u.shop.eq.title; const it = t && t !== 'title-none' ? SHOP.find((x) => x.id === t) : null; return it ? it.name : null; };

function emptyStats() {
  return {
    poker: { hands: 0, won: 0, net: 0, biggestPot: 0, bestHand: -1, showdowns: 0 },
    sng: { played: 0, won: 0, itm: 0, prizes: 0, buyins: 0 },
    durak: { games: 0, wins: 0, losses: 0, draws: 0, net: 0 },
    bj: { rounds: 0, wins: 0, losses: 0, pushes: 0, blackjacks: 0, net: 0, biggestWin: 0 },
    roulette: { spins: 0, wins: 0, net: 0, straight: 0, biggestWin: 0 },
    checkers: { games: 0, wins: 0, losses: 0, draws: 0, net: 0 },
    chess: { games: 0, wins: 0, losses: 0, draws: 0, net: 0 },
    capital: { games: 0, wins: 0, net: 0 },
    mafia: { games: 0, wins: 0, net: 0, asMafia: 0, mafiaWins: 0 },
    nardy: { games: 0, wins: 0, losses: 0, net: 0, mars: 0 },
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
    if (!this.data.dms || typeof this.data.dms !== 'object') this.data.dms = {};
    if (!Array.isArray(this.data.seasonHistory)) this.data.seasonHistory = [];
    if (!this.data.season || typeof this.data.season !== 'object') this.data.season = newSeason();
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
      balance: START_BALANCE, inPlay: {}, lastBonus: 0, created: Date.now(), // the wheel is free on day one
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
      bonusAmount: DAILY_BONUS, wheel: WHEEL.map((w) => w.amount), handsWon: u.stats.poker.won, biggestPot: u.stats.poker.biggestPot,
      role: u.role || 'player', muted: !!u.muted, avatar: u.avatar,
      friendRequests: u.friendReq.in.length,
      rewardsReady: this.rewardsReady(userId),
      dmUnread: this.dmUnread(userId),
      looks: { ...u.shop.eq }, title: titleOf(u),
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
    u.achClaimed ||= [];
    u.quests ||= null;
    u.rating ||= {};
    u.shop ||= { owned: [], eq: { ...SHOP_DEFAULT } };
    u.shop.eq = { ...SHOP_DEFAULT, ...u.shop.eq };
    for (const k of RATED) {
      if (!u.rating[k] || typeof u.rating[k] !== 'object') u.rating[k] = { r: RATING_START, games: 0, peak: RATING_START };
    }
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
    const q = this._quests(u);
    const bump = (m, n = 1) => { q.prog[m] = (q.prog[m] || 0) + n; };
    if (kind === 'poker') {
      bump('hands');
      if (f.won > 0) bump('pokerWins');
      if (f.won > 0 && f.category != null && f.category >= 3) bump('pokerStrong');
    } else if (kind === 'sng') {
      bump('sngPlayed');
      if (f.prize > 0) bump('sngItm');
    } else if (kind === 'durak') {
      bump('durakGames');
      if (!f.draw && !f.durak) bump('durakWins');
    } else if (kind === 'bj') {
      bump('bjRounds');
      if (f.net > 0) bump('bjWins');
    } else if (kind === 'roulette') {
      bump('rlSpins');
      if (f.net > 0) bump('rlWins');
    } else if (kind === 'checkers') {
      bump('ckGames');
      if (f.win) bump('ckWins');
    } else if (kind === 'chess') {
      bump('chGames');
      if (f.win) bump('chWins');
    } else if (kind === 'capital') {
      bump('capGames');
      if (f.win) bump('capWins');
    } else if (kind === 'mafia') {
      bump('mfGames');
      if (f.win) bump('mfWins');
    } else if (kind === 'nardy') {
      bump('bgGames');
      if (f.win) bump('bgWins');
    }
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
    } else if (kind === 'roulette') {
      const p = st.roulette;
      p.spins += 1;
      p.net += f.net;
      if (f.net > 0) p.wins += 1;
      if (f.straight) p.straight += 1;
      if (f.net > p.biggestWin) p.biggestWin = f.net;
      // spins at one table are grouped like poker hands
      const last = u.recent[0];
      if (last && last.kind === 'roulette' && last.table === f.table && Date.now() - last.t < 60 * 60 * 1000) {
        last.spins = (last.spins || 1) + 1; last.net += f.net; last.t = Date.now(); last.text = `${last.spins} спинов`;
      } else entry = { kind, table: f.table, net: f.net, spins: 1, text: `Выпало ${f.number}` };
    } else if (kind === 'checkers') {
      const p = st.checkers;
      p.games += 1;
      p.net += f.net;
      if (f.draw) p.draws += 1; else if (f.win) p.wins += 1; else p.losses += 1;
      entry = { kind, table: f.table, net: f.net, text: f.draw ? 'Ничья' : f.win ? 'Победа' : 'Поражение' };
    } else if (kind === 'chess') {
      const p = st.chess;
      p.games += 1;
      p.net += f.net;
      if (f.draw) p.draws += 1; else if (f.win) p.wins += 1; else p.losses += 1;
      entry = { kind, table: f.table, net: f.net, text: f.draw ? 'Ничья' : f.win ? 'Победа' : 'Поражение' };
    } else if (kind === 'capital') {
      const p = st.capital;
      p.games += 1;
      p.net += f.net;
      if (f.win) p.wins += 1;
      entry = { kind, table: f.table, net: f.net, text: f.win ? 'Главный магнат' : `${f.place} место из ${f.total}` };
    } else if (kind === 'mafia') {
      const p = st.mafia;
      const maf = f.role === 'maf' || f.role === 'don';
      p.games += 1;
      p.net += f.net;
      if (f.win) p.wins += 1;
      if (maf) { p.asMafia += 1; if (f.win) p.mafiaWins += 1; }
      const ROLE = { civ: 'мирный', maf: 'мафия', don: 'дон', com: 'комиссар', doc: 'доктор' };
      entry = { kind, table: f.table, net: f.net, text: `${f.win ? 'Победа' : 'Поражение'} · ${ROLE[f.role] || ''}` };
    }
    if (kind === 'nardy') {
      const p = st.nardy;
      p.games += 1;
      p.net += f.net;
      if (f.win) { p.wins += 1; if (f.mars) p.mars += 1; } else p.losses += 1;
      entry = { kind, table: f.table, net: f.net, text: f.win ? (f.mars ? 'Победа марсом' : 'Победа') : f.mars ? 'Поражение марсом' : 'Поражение' };
    }
    if (SEASON_GAMES.includes(kind)) {
      const net = kind === 'sng' ? f.prize - f.buyIn : f.tournament ? 0 : (f.net || 0);
      this._seasonAdd(userId, kind, net);
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
      ...(u.avatar && u.avatar.img ? { img: u.avatar.img } : {}),
      ...(u.avatar && u.avatar.frame ? { frame: u.avatar.frame } : {}),
    };
    this.save();
    return u.avatar;
  }

  /** Own picture as the avatar (PNG / JPEG / WebP / GIF, up to 1 MB). */
  setAvatarImage(userId, buf, mime) {
    const u = this.findUser(userId);
    if (!Buffer.isBuffer(buf) || !buf.length) throw new StoreError('Пустой файл');
    if (buf.length > AVATAR_MAX_BYTES) throw new StoreError('Картинка больше 1 МБ');
    const real = sniffImage(buf);
    if (!real) throw new StoreError('Нужна картинка PNG, JPEG, WebP или GIF');
    const v = Date.now().toString(36);
    u.avatarImg = { mime: real, data: buf.toString('base64'), v };
    u.avatar = { ...(u.avatar || { hue: null, sym: '' }), img: `/avatar/${u.id}?v=${v}` };
    this.save();
    return u.avatar;
  }

  clearAvatarImage(userId) {
    const u = this.findUser(userId);
    delete u.avatarImg;
    if (u.avatar) delete u.avatar.img;
    this.save();
    return u.avatar;
  }

  avatarImage(userId) {
    const u = this.data.users[userId];
    if (!u || !u.avatarImg) return null;
    return { mime: u.avatarImg.mime, buf: Buffer.from(u.avatarImg.data, 'base64'), v: u.avatarImg.v };
  }

  // ---------- quests & achievement rewards ----------

  _quests(u) {
    const day = dayKey();
    if (!u.quests || u.quests.day !== day) u.quests = { day, picks: pickQuests(u.id, day), prog: {}, claimed: [] };
    return u.quests;
  }

  progress(userId) {
    const u = this.findUser(userId);
    const q = this._quests(u);
    const quests = q.picks.map((id) => {
      const d = QUESTS.find((x) => x.id === id);
      const n = Math.min(q.prog[d.metric] || 0, d.target);
      return { id, title: d.title, text: d.text, reward: d.reward, progress: [n, d.target], done: n >= d.target, claimed: q.claimed.includes(id) };
    });
    const next = new Date(`${q.day}T00:00:00+03:00`).getTime() + 24 * 3600 * 1000;
    return { quests, resetIn: Math.max(0, next - Date.now()), achievements: achievements(u) };
  }

  rewardsReady(userId) {
    const u = this.data.users[userId];
    if (!u) return 0;
    const q = this._quests(u);
    const qr = q.picks.filter((id) => { const d = QUESTS.find((x) => x.id === id); return (q.prog[d.metric] || 0) >= d.target && !q.claimed.includes(id); }).length;
    return qr + achievements(u).filter((a) => a.done && !a.claimed).length;
  }

  claimQuest(userId, id) {
    const u = this.findUser(userId);
    const q = this._quests(u);
    const d = QUESTS.find((x) => x.id === id);
    if (!d || !q.picks.includes(id)) throw new StoreError('Такого задания сегодня нет');
    if ((q.prog[d.metric] || 0) < d.target) throw new StoreError('Задание ещё не выполнено');
    if (q.claimed.includes(id)) throw new StoreError('Награда уже получена');
    q.claimed.push(id);
    u.balance += d.reward;
    this.snapshot(userId);
    this.save();
    return d.reward;
  }

  claimAchievement(userId, id) {
    const u = this.findUser(userId);
    const a = achievements(u).find((x) => x.id === id);
    if (!a) throw new StoreError('Нет такого достижения');
    if (!a.done) throw new StoreError('Достижение ещё не открыто');
    if (a.claimed) throw new StoreError('Награда уже получена');
    u.achClaimed.push(id);
    u.balance += a.reward;
    this.snapshot(userId);
    this.save();
    return a.reward;
  }

  /** Public profile, visible to anyone. */
  publicProfile(nameOrId) {
    const u = this.data.users[nameOrId] || this._findByName(String(nameOrId || ''));
    if (!u) throw new StoreError('Игрок не найден');
    const chips = this._chips(u);
    const rank = Object.values(this.data.users).filter((x) => this._chips(x) > chips).length + 1;
    return {
      id: u.id, name: u.name, avatar: u.avatar, created: u.created, role: u.role, title: titleOf(u),
      chips, rank, players: Object.keys(this.data.users).length,
      stats: u.stats,
      achievements: achievements(u),
      recent: u.recent.slice(0, 25),
      history: Object.entries(u.history).sort(([a], [b]) => (a < b ? -1 : 1)).map(([d, v]) => ({ d, v })),
      friends: u.friends.length,
      ratings: Object.fromEntries(RATED.map((k) => [k, u.rating[k]])),
      seasonWins: u.seasonWins || 0,
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

  // ---------- private messages between friends ----------

  _dmKey(a, b) { return a < b ? `${a}|${b}` : `${b}|${a}`; }

  dmSend(from, to, text) {
    const me = this.findUser(from);
    if (!this.data.users[to]) throw new StoreError('Игрок не найден');
    if (!me.friends.includes(to)) throw new StoreError('Писать можно только друзьям');
    if (me.muted) throw new StoreError('Администратор запретил вам писать сообщения');
    const clean = String(text || '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 500);
    if (!clean) throw new StoreError('Пустое сообщение');
    const key = this._dmKey(from, to);
    const conv = this.data.dms[key] || (this.data.dms[key] = { msgs: [], read: {} });
    const msg = { id: crypto.randomBytes(5).toString('hex'), from, text: clean, t: Date.now() };
    conv.msgs.push(msg);
    if (conv.msgs.length > DM_KEEP) conv.msgs.splice(0, conv.msgs.length - DM_KEEP);
    conv.read[from] = msg.t;
    this.save();
    return msg;
  }

  dmHistory(userId, otherId) {
    const conv = this.data.dms[this._dmKey(userId, otherId)];
    return conv ? conv.msgs.slice() : [];
  }

  dmMarkRead(userId, otherId) {
    const conv = this.data.dms[this._dmKey(userId, otherId)];
    if (!conv || !conv.msgs.length) return false;
    const last = conv.msgs[conv.msgs.length - 1].t;
    if ((conv.read[userId] || 0) >= last) return false;
    conv.read[userId] = last;
    this.save();
    return true;
  }

  /** Conversations of a player with friends, newest first. */
  dmList(userId) {
    const out = [];
    for (const [key, conv] of Object.entries(this.data.dms)) {
      const [a, b] = key.split('|');
      if (a !== userId && b !== userId) continue;
      const other = a === userId ? b : a;
      if (!this.data.users[other] || !conv.msgs.length) continue;
      const seen = conv.read[userId] || 0;
      const last = conv.msgs[conv.msgs.length - 1];
      out.push({ id: other, last: { text: last.text, t: last.t, mine: last.from === userId }, unread: conv.msgs.filter((m) => m.from !== userId && m.t > seen).length });
    }
    return out.sort((x, y) => y.last.t - x.last.t);
  }

  dmUnread(userId) { return this.dmList(userId).reduce((a, c) => a + c.unread, 0); }

  brief(userId) {
    const u = this.data.users[userId];
    return u ? { id: u.id, name: u.name, avatar: u.avatar } : null;
  }

  /** Move chips from balance to a table. */
  // ---------- shop ----------
  shopView(userId) {
    const u = this.findUser(userId);
    const owned = new Set(u.shop.owned);
    return {
      balance: u.balance,
      items: SHOP.map((it) => ({ ...it, owned: !it.price || owned.has(it.id), equipped: u.shop.eq[it.cat] === it.id })),
    };
  }

  buy(userId, id) {
    const u = this.findUser(userId);
    const it = SHOP.find((x) => x.id === id);
    if (!it) throw new StoreError('Такого товара нет');
    if (!it.price || u.shop.owned.includes(id)) throw new StoreError('Уже у вас');
    if (u.balance < it.price) throw new StoreError('Не хватает фишек на балансе');
    u.balance -= it.price;
    u.shop.owned.push(id);
    this._equip(u, it);
    this.snapshot(userId);
    this.save();
    return this.shopView(userId);
  }

  equip(userId, id) {
    const u = this.findUser(userId);
    const it = SHOP.find((x) => x.id === id);
    if (!it) throw new StoreError('Такого товара нет');
    if (it.price && !u.shop.owned.includes(id)) throw new StoreError('Сначала купите');
    this._equip(u, it);
    this.save();
    return this.shopView(userId);
  }

  _equip(u, it) {
    u.shop.eq[it.cat] = it.id;
    // the frame travels with the avatar, so everyone at the table sees it
    if (it.cat === 'frame') {
      u.avatar = { ...(u.avatar || { hue: null, sym: '' }) };
      if (it.id === 'frame-none') delete u.avatar.frame; else u.avatar.frame = it.id.slice(6);
    }
  }

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

  /** Spin the daily wheel: the server picks the sector, the client only animates it. */
  claimBonus(userId) {
    const u = this.findUser(userId);
    if (Date.now() < u.lastBonus + BONUS_INTERVAL) throw new StoreError('Колесо уже крутили, загляните позже');
    let roll = crypto.randomInt(WHEEL_TOTAL);
    let sector = 0;
    while (roll >= WHEEL[sector].weight) { roll -= WHEEL[sector].weight; sector += 1; }
    const amount = WHEEL[sector].amount;
    u.balance += amount;
    u.lastBonus = Date.now();
    u.recent.unshift({ t: Date.now(), kind: 'wheel', net: amount, text: 'Колесо фортуны' });
    if (u.recent.length > RECENT_MAX) u.recent.length = RECENT_MAX;
    this.snapshot(userId);
    this.save();
    return { amount, sector, nextIn: BONUS_INTERVAL };
  }

  // ---------- ratings (Elo) ----------

  /**
   * Update Elo after a rated game.
   * results: [{ userId, score }] where a higher score is a better finish (equal = draw).
   * Multi-player games are scored as every pair playing each other, K split across opponents.
   */
  applyRatings(kind, results) {
    if (!RATED.includes(kind)) return [];
    const players = results.filter((r) => this.data.users[r.userId]);
    if (players.length < 2) return [];
    const before = players.map((p) => this.data.users[p.userId].rating[kind].r);
    const delta = players.map(() => 0);
    for (let i = 0; i < players.length; i++) {
      const g = this.data.users[players[i].userId].rating[kind].games;
      const K = (g < 20 ? 40 : 24) / (players.length - 1);
      for (let j = 0; j < players.length; j++) {
        if (i === j) continue;
        const expected = 1 / (1 + 10 ** ((before[j] - before[i]) / 400));
        const actual = players[i].score > players[j].score ? 1 : players[i].score < players[j].score ? 0 : 0.5;
        delta[i] += K * (actual - expected);
      }
    }
    const out = players.map((p, i) => {
      const rt = this.data.users[p.userId].rating[kind];
      const d = Math.round(delta[i]);
      rt.r = Math.max(100, rt.r + d);
      rt.games += 1;
      rt.peak = Math.max(rt.peak, rt.r);
      return { userId: p.userId, rating: rt.r, delta: d };
    });
    this.save();
    return out;
  }

  ratingTable(kind, n = 50) {
    if (!RATED.includes(kind)) throw new StoreError('Нет такого рейтинга');
    return Object.values(this.data.users)
      .filter((u) => u.rating[kind].games > 0 && !u.banned)
      .map((u) => ({ id: u.id, name: u.name, avatar: u.avatar, rating: u.rating[kind].r, games: u.rating[kind].games, peak: u.rating[kind].peak }))
      .sort((a, b) => b.rating - a.rating || b.games - a.games)
      .slice(0, n);
  }

  // ---------- weekly seasons ----------

  _seasonAdd(userId, kind, net) {
    this.seasonTick();
    const sc = this.data.season.scores;
    const row = sc[userId] || (sc[userId] = { total: 0, games: 0, by: {} });
    row.total += net;
    row.games += 1;
    const g = row.by[kind] || (row.by[kind] = { net: 0, games: 0 });
    g.net += net;
    g.games += 1;
  }

  /** Close the season when the week is over: pay the top 3 and start a new one. Returns the closed season or null. */
  seasonTick(now = Date.now()) {
    const cur = this.data.season;
    if (now < cur.end) return null;
    const standings = this._standings(cur, 'total');
    const winners = [];
    let place = 0;
    for (const row of standings) {
      if (place >= SEASON_PRIZES.length) break;
      if (row.games < SEASON_MIN_GAMES || row.net <= 0) continue;
      const u = this.data.users[row.id];
      if (!u || u.banned) continue;
      const prize = SEASON_PRIZES[place];
      u.balance += prize;
      u.seasonWins = (u.seasonWins || 0) + (place === 0 ? 1 : 0);
      u.recent.unshift({ t: now, kind: 'season', net: prize, text: `Сезон ${cur.label}: ${place + 1} место` });
      if (u.recent.length > RECENT_MAX) u.recent.length = RECENT_MAX;
      winners.push({ id: u.id, name: u.name, avatar: u.avatar, place: place + 1, net: row.net, prize });
      place += 1;
    }
    const closed = { id: cur.id, label: cur.label, start: cur.start, end: cur.end, winners, players: Object.keys(cur.scores).length };
    this.data.seasonHistory.unshift(closed);
    if (this.data.seasonHistory.length > SEASON_KEEP) this.data.seasonHistory.length = SEASON_KEEP;
    this.data.season = newSeason(now);
    this.save();
    return closed;
  }

  _standings(season, game) {
    return Object.entries(season.scores)
      .map(([id, row]) => {
        const u = this.data.users[id];
        if (!u) return null;
        const part = game === 'total' ? { net: row.total, games: row.games } : row.by[game];
        if (!part || !part.games) return null;
        return { id, name: u.name, avatar: u.avatar, net: part.net, games: part.games };
      })
      .filter(Boolean)
      .sort((a, b) => b.net - a.net || b.games - a.games);
  }

  seasonView(game = 'total', userId = null) {
    this.seasonTick();
    if (game !== 'total' && !SEASON_GAMES.includes(game)) throw new StoreError('Нет такой игры');
    const s = this.data.season;
    const all = this._standings(s, game);
    const meIdx = userId ? all.findIndex((r) => r.id === userId) : -1;
    return {
      id: s.id, label: s.label, start: s.start, end: s.end, endsIn: Math.max(0, s.end - Date.now()),
      prizes: SEASON_PRIZES, minGames: SEASON_MIN_GAMES, game,
      top: all.slice(0, 50).map((r, i) => ({ ...r, place: i + 1 })),
      me: meIdx >= 0 ? { ...all[meIdx], place: meIdx + 1 } : null,
      history: this.data.seasonHistory.slice(0, 6),
    };
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
  { id: 'first', title: 'Первая кровь', text: 'Выиграть первую раздачу в покере', reward: 500, ok: (s) => s.poker.won >= 1 },
  { id: 'grinder', title: 'Гриндер', text: 'Сыграть 100 раздач', reward: 2000, ok: (s) => s.poker.hands >= 100, progress: (s) => [s.poker.hands, 100] },
  { id: 'shark', title: 'Акула', text: 'Сыграть 1000 раздач', reward: 10000, ok: (s) => s.poker.hands >= 1000, progress: (s) => [s.poker.hands, 1000] },
  { id: 'boat', title: 'Полный дом', text: 'Выиграть с фулл-хаусом или лучше', reward: 1500, ok: (s) => s.poker.bestHand >= 6 },
  { id: 'quads', title: 'Четвёрка', text: 'Собрать каре', reward: 3000, ok: (s) => s.poker.bestHand >= 7 },
  { id: 'royal', title: 'Королевская удача', text: 'Собрать роял-флеш', reward: 25000, ok: (s) => s.poker.bestHand >= 9 },
  { id: 'bigpot', title: 'Крупный банк', text: 'Забрать банк от 10 000', reward: 2500, ok: (s) => s.poker.biggestPot >= 10000, progress: (s) => [s.poker.biggestPot, 10000] },
  { id: 'sng', title: 'Чемпион', text: 'Выиграть турнир Sit & Go', reward: 2000, ok: (s) => s.sng.won >= 1 },
  { id: 'sng5', title: 'Серийный победитель', text: 'Выиграть 5 турниров', reward: 7500, ok: (s) => s.sng.won >= 5, progress: (s) => [s.sng.won, 5] },
  { id: 'durak10', title: 'Не дурак', text: 'Выйти первым в 10 партиях дурака', reward: 3000, ok: (s) => s.durak.wins >= 10, progress: (s) => [s.durak.wins, 10] },
  { id: 'natural', title: 'Двадцать одно', text: 'Получить блэкджек', reward: 500, ok: (s) => s.bj.blackjacks >= 1 },
  { id: 'natural10', title: 'Любимец шуза', text: '10 блэкджеков', reward: 3000, ok: (s) => s.bj.blackjacks >= 10, progress: (s) => [s.bj.blackjacks, 10] },
  { id: 'straight', title: 'В яблочко', text: 'Выиграть ставку на одно число в рулетке', reward: 1000, ok: (s) => s.roulette.straight >= 1 },
  { id: 'ck10', title: 'Гроссмейстер', text: 'Выиграть 10 партий в шашки', reward: 3000, ok: (s) => s.checkers.wins >= 10, progress: (s) => [s.checkers.wins, 10] },
  { id: 'nardy10', title: 'Мастер нард', text: 'Выиграть 10 партий в нарды', reward: 3000, ok: (s) => s.nardy.wins >= 10, progress: (s) => [s.nardy.wins, 10] },
  { id: 'chess10', title: 'Шахматист', text: 'Выиграть 10 партий в шахматы', reward: 3000, ok: (s) => s.chess.wins >= 10, progress: (s) => [s.chess.wins, 10] },
  { id: 'tycoon', title: 'Магнат', text: 'Выиграть партию в «Капитал»', reward: 2000, ok: (s) => s.capital.wins >= 1 },
  { id: 'godfather', title: 'Крёстный отец', text: 'Победить в мафии, играя за мафию', reward: 1500, ok: (s) => s.mafia.mafiaWins >= 1 },
  { id: 'season1', title: 'Чемпион недели', text: 'Победить в еженедельном сезоне', reward: 5000, ok: (s, u) => (u.seasonWins || 0) >= 1 },
  { id: 'elo1400', title: 'Мастер доски', text: 'Поднять рейтинг в шашках до 1400', reward: 3000, ok: (s, u) => u.rating.checkers.peak >= 1400, progress: (s, u) => [u.rating.checkers.peak, 1400] },
  { id: 'rich', title: 'Состоятельный', text: 'Накопить 50 000 фишек', reward: 5000, ok: (s, u, chips) => chips >= 50000, progress: (s, u, chips) => [chips, 50000] },
  { id: 'social', title: 'Своя компания', text: 'Добавить 3 друзей', reward: 1500, ok: (s, u) => u.friends.length >= 3, progress: (s, u) => [u.friends.length, 3] },
];

// ---------- daily quests: 3 a day (Moscow time), one poker, one other game, one any ----------
const QUESTS = [
  { id: 'hands25', group: 'poker', title: 'Разогрев', text: 'Сыграть 25 раздач в покере', metric: 'hands', target: 25, reward: 600 },
  { id: 'pwin5', group: 'poker', title: 'Банк за банком', text: 'Выиграть 5 раздач в покере', metric: 'pokerWins', target: 5, reward: 800 },
  { id: 'strong', group: 'poker', title: 'Сильная рука', text: 'Выиграть раздачу с сетом или лучше', metric: 'pokerStrong', target: 1, reward: 1000 },
  { id: 'durak3', group: 'other', title: 'Козырная тройка', text: 'Сыграть 3 партии в дурака', metric: 'durakGames', target: 3, reward: 600 },
  { id: 'durakwin', group: 'other', title: 'Не остаться дураком', text: 'Выйти из партии в дурака первым', metric: 'durakWins', target: 1, reward: 700 },
  { id: 'bj10', group: 'other', title: 'За столом дилера', text: 'Сыграть 10 раундов блэкджека', metric: 'bjRounds', target: 10, reward: 600 },
  { id: 'bjwin3', group: 'other', title: 'Обыграть дилера', text: 'Выиграть 3 раунда в блэкджеке', metric: 'bjWins', target: 3, reward: 700 },
  { id: 'rl10', group: 'other', title: 'Колесо фортуны', text: 'Сделать ставки в 10 спинах рулетки', metric: 'rlSpins', target: 10, reward: 600 },
  { id: 'ckwin', group: 'other', title: 'Дамка в деле', text: 'Выиграть партию в шашки', metric: 'ckWins', target: 1, reward: 900 },
  { id: 'bgwin', group: 'other', title: 'Шеш-беш', text: 'Выиграть партию в нарды', metric: 'bgWins', target: 1, reward: 900 },
  { id: 'chwin', group: 'other', title: 'Шах и мат', text: 'Выиграть партию в шахматы', metric: 'chWins', target: 1, reward: 900 },
  { id: 'cap1', group: 'other', title: 'Деловой вечер', text: 'Сыграть партию в «Капитал»', metric: 'capGames', target: 1, reward: 800 },
  { id: 'mf1', group: 'other', title: 'Город засыпает', text: 'Сыграть партию в мафию', metric: 'mfGames', target: 1, reward: 700 },
  { id: 'sng1', group: 'any', title: 'Турнирный день', text: 'Сыграть турнир Sit & Go', metric: 'sngPlayed', target: 1, reward: 900 },
  { id: 'itm', group: 'any', title: 'В призах', text: 'Занять призовое место в турнире', metric: 'sngItm', target: 1, reward: 1200 },
];
function pickQuests(userId, day) {
  const h = crypto.createHash('sha256').update(userId + '|' + day).digest();
  const from = (list, k) => list[h[k] % list.length];
  const a = from(QUESTS.filter((q) => q.group === 'poker'), 0);
  const b = from(QUESTS.filter((q) => q.group === 'other'), 1);
  const c = from(QUESTS.filter((q) => q.id !== a.id && q.id !== b.id), 2);
  return [a.id, b.id, c.id];
}

const AVATAR_MAX_BYTES = 1024 * 1024;
const DM_KEEP = 200;
function sniffImage(b) {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (b.length > 6 && (b.toString('ascii', 0, 6) === 'GIF87a' || b.toString('ascii', 0, 6) === 'GIF89a')) return 'image/gif';
  return null;
}

/** Week starting on Monday 00:00 Moscow time. */
function newSeason(now = Date.now()) {
  const msk = new Date(now + 3 * 3600 * 1000);
  const dow = (msk.getUTCDay() + 6) % 7; // Monday = 0
  const startMsk = Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate() - dow);
  const start = startMsk - 3 * 3600 * 1000;
  const end = start + 7 * 24 * 3600 * 1000;
  const fmtD = (t) => new Date(t + 3 * 3600 * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' }).replace('.', '');
  return { id: dayKey(start + 1), label: `${fmtD(start)} – ${fmtD(end - 1)}`, start, end, scores: {} };
}

function achievements(u) {
  const chips = u.balance + Object.values(u.inPlay || {}).reduce((a, b) => a + b, 0);
  return ACHIEVEMENTS.map((a) => {
    const done = !!a.ok(u.stats, u, chips);
    const pr = a.progress ? a.progress(u.stats, u, chips) : null;
    return { id: a.id, title: a.title, text: a.text, reward: a.reward, done, claimed: (u.achClaimed || []).includes(a.id), progress: pr && !done ? [Math.min(pr[0], pr[1]), pr[1]] : null };
  });
}

module.exports = { SHOP, Store, StoreError, START_BALANCE, DAILY_BONUS, WHEEL, RATED, SEASON_PRIZES, SEASON_MIN_GAMES, newSeason, AVATAR_SYMBOLS, AVATAR_MAX_BYTES, QUESTS, dayKey };
