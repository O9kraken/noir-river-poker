'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const START_BALANCE = 10000;
const DAILY_BONUS = 2000;
const BONUS_INTERVAL = 24 * 60 * 60 * 1000;
const TOKEN_TTL = 30 * 24 * 60 * 60 * 1000;
const NAME_RE = /^[A-Za-zА-Яа-яЁё0-9_\- ]{3,16}$/;

class StoreError extends Error {}

/**
 * Tiny JSON-file user store. Fine for one server process and
 * hundreds of players; swap for PostgreSQL/Redis when scaling out.
 */
class Store {
  /** opts.adminNames: nicknames that always get the admin role (case-insensitive). */
  constructor(file, opts = {}) {
    this.file = file;
    this.adminNames = (opts.adminNames || []).map((n) => String(n).trim().toLowerCase()).filter(Boolean);
    this.data = { users: {}, sessions: {}, adminLog: [], announcement: null };
    this._saveTimer = null;
    if (fs.existsSync(file)) {
      this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.data.users ||= {};
      this.data.sessions ||= {};
      this.data.adminLog ||= [];
      if (this.data.announcement === undefined) this.data.announcement = null;
    }
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
      bonusAmount: DAILY_BONUS, handsWon: u.handsWon || 0, biggestPot: u.biggestPot || 0,
      role: u.role || 'player', muted: !!u.muted,
    };
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

  recordWin(userId, amount) {
    const u = this.data.users[userId];
    if (!u) return;
    u.handsWon = (u.handsWon || 0) + 1;
    u.biggestPot = Math.max(u.biggestPot || 0, amount);
  }

  claimBonus(userId) {
    const u = this.data.users[userId];
    if (Date.now() < u.lastBonus + BONUS_INTERVAL) throw new StoreError('Бонус уже получен, загляните позже');
    u.balance += DAILY_BONUS;
    u.lastBonus = Date.now();
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
      created: u.created, handsWon: u.handsWon || 0,
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
      .map((u) => ({ name: u.name, chips: u.balance + Object.values(u.inPlay || {}).reduce((a, b) => a + b, 0) }))
      .sort((a, b) => b.chips - a.chips)
      .slice(0, n);
  }

  save() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => { this._saveTimer = null; this.saveNow(); }, 300);
  }

  saveNow() {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { Store, StoreError, START_BALANCE, DAILY_BONUS };
