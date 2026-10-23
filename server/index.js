'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const compression = require('compression');
const { Server } = require('socket.io');
const { Table, GameError } = require('./engine/table');
const { GAMES, gameOf } = require('./engine/games');
const { Store, StoreError, AVATAR_MAX_BYTES } = require('./store');
const { SitAndGo, TEMPLATES, validateTemplate, DAY } = require('./tournament');
const { DurakTable } = require('./durak/table');
const { BlackjackTable } = require('./blackjack/table');
const { RouletteTable } = require('./roulette/table');
const { CheckersTable } = require('./checkers/table');
const { ChessTable } = require('./chess/table');
const { CapitalTable } = require('./capital/table');
const { MafiaTable } = require('./mafia/table');
const { createVoice } = require('./voice');
const { BotDriver, makeBots, isBot, LEVELS: BOT_LEVELS, LEVEL_NAMES } = require('./bots');

const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'users.json');
const ACTION_TIME = Number(process.env.ACTION_TIME_MS) || 25000;
const RECONNECT_GRACE = Number(process.env.RECONNECT_GRACE_MS) || 90000;
const MAX_TABLES = 60;

const STAKES = [[1, 2], [5, 10], [10, 20], [25, 50], [50, 100], [100, 200], [500, 1000]];
const SEAT_OPTIONS = [2, 6, 9];
const BLIND_EVERY_OPTIONS = [0, 3, 5, 10];
const DURAK_STAKES = [50, 100, 250, 500, 1000, 5000];
const RL_LIMITS = [[5, 500], [10, 2000], [100, 20000]];
const CK_STAKES = [50, 100, 250, 500, 1000, 5000];
const CK_CLOCKS = [3, 5, 10];
const CH_STAKES = [50, 100, 250, 500, 1000, 5000];
const CH_CLOCKS = [3, 5, 10, 15];
const CAP_STAKES = [100, 200, 500, 1000, 5000];
const CAP_TIMES = [30, 45, 60, 0];
const MF_STAKES = [50, 100, 250, 500, 1000];
const REACTIONS = ['👍', '😂', '😮', '😎', '🔥', '😢', '🙏', '🎉'];
const ADMIN_NAMES = (process.env.ADMIN_NAMES || '').split(',').map((x) => x.trim()).filter(Boolean);
const STARTED_AT = Date.now();

function createServer({
  dataFile = DATA_FILE, actionTime = ACTION_TIME, tableOpts = {},
  sngTemplates = TEMPLATES, levelHands = Number(process.env.SNG_LEVEL_HANDS) || 0, sngLinger = 120000,
  durakOpts = {}, bjOpts = {}, rlOpts = {}, ckOpts = {}, chOpts = {}, capOpts = {}, mfOpts = {}, adminNames = ADMIN_NAMES, store: givenStore = null, botOpts = {},
} = {}) {
  const store = givenStore || new Store(dataFile, { adminNames });
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { maxHttpBufferSize: 1e5 });

  app.disable('x-powered-by');
  // Real client IP from X-Forwarded-For: nginx on the same machine by default,
  // TRUST_PROXY=true on platforms like Render where the proxy is remote.
  const tp = process.env.TRUST_PROXY;
  app.set('trust proxy', tp === 'true' ? true : tp && !Number.isNaN(Number(tp)) ? Number(tp) : 'loopback');
  let avatarChangedHook = null;
  app.use(express.json({ limit: '10kb' }));
  app.use(compression({ threshold: 1024 }));
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.set('X-Frame-Options', 'SAMEORIGIN');
    res.set('Permissions-Policy', 'camera=(), microphone=(self), geolocation=(), payment=()');
    next();
  });
  const pub = path.join(__dirname, '..', 'public');
  // the site's public address for share previews and the sitemap: PUBLIC_URL, or whatever host the visitor used
  const origin = (req) => (process.env.PUBLIC_URL || `${String(req.get('x-forwarded-proto') || req.protocol).split(',')[0].trim()}://${req.get('host')}`).replace(/\/+$/, '');
  // pages with share previews carry %ORIGIN% placeholders, filled in per request
  const page = (file) => {
    const html = fs.readFileSync(path.join(pub, file), 'utf8');
    return (req, res) => { res.set('Cache-Control', 'no-cache'); res.type('html').send(html.replaceAll('%ORIGIN%', origin(req))); };
  };
  app.get(['/', '/index.html'], page('index.html'));
  app.get(['/play', '/play.html'], page('play.html'));
  app.get('/robots.txt', (req, res) => res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /avatar/\n\nSitemap: ${origin(req)}/sitemap.xml\n`));
  app.get('/sitemap.xml', (req, res) => {
    const day = new Date(STARTED_AT).toISOString().slice(0, 10);
    const urls = [['/', '1.0'], ['/play', '0.8']].map(([u, pr]) => `  <url><loc>${origin(req)}${u}</loc><lastmod>${day}</lastmod><priority>${pr}</priority></url>`).join('\n');
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
  });
  // art, fonts and icons rarely change: cache them for a month; pages, scripts and styles revalidate every time
  app.use(express.static(pub, {
    extensions: ['html'],
    index: false,
    setHeaders: (res, file) => {
      const rel = path.relative(pub, file).replace(/\\/g, '/');
      if (/^(art|fonts|brand)\//.test(rel) || /\.(ico|png|webp|woff2)$/.test(rel)) res.set('Cache-Control', 'public, max-age=2592000');
      else res.set('Cache-Control', 'no-cache');
    },
  }));
  app.get('/admin', (req, res) => res.sendFile(path.join(pub, 'admin.html')));

  // --- simple per-IP rate limit for auth endpoints ---
  const hits = new Map();
  function limited(ip) {
    const now = Date.now();
    const arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
    arr.push(now);
    hits.set(ip, arr);
    return arr.length > 20;
  }

  app.post('/api/register', (req, res) => {
    if (limited(req.ip)) return res.status(429).json({ error: 'Слишком много попыток, подождите минуту' });
    try { res.json(store.register(req.body?.name, req.body?.password)); } catch (e) { authError(res, e); }
  });
  app.post('/api/login', (req, res) => {
    if (limited(req.ip)) return res.status(429).json({ error: 'Слишком много попыток, подождите минуту' });
    try { res.json(store.login(req.body?.name, req.body?.password)); } catch (e) { authError(res, e); }
  });
  app.post('/api/logout', (req, res) => { store.logout(req.body?.token); res.json({ ok: true }); });
  app.get('/api/leaderboard', (req, res) => res.json(store.leaderboard()));
  // own picture as the avatar: raw image body, up to 1 MB
  const bearer = (req) => { const m = /^Bearer\s+(.+)$/.exec(req.get('authorization') || ''); return m && store.userByToken(m[1]); };
  app.post('/api/avatar', express.raw({ type: () => true, limit: AVATAR_MAX_BYTES }), (req, res) => {
    const u = bearer(req);
    if (!u) return res.status(401).json({ error: 'Войдите в аккаунт' });
    try {
      const avatar = store.setAvatarImage(u.id, req.body, req.get('content-type'));
      if (avatarChangedHook) avatarChangedHook(u.id);
      res.json({ avatar });
    } catch (e) { authError(res, e); }
  });
  app.delete('/api/avatar', (req, res) => {
    const u = bearer(req);
    if (!u) return res.status(401).json({ error: 'Войдите в аккаунт' });
    const avatar = store.clearAvatarImage(u.id);
    if (avatarChangedHook) avatarChangedHook(u.id);
    res.json({ avatar });
  });
  app.get('/avatar/:id', (req, res) => {
    const img = store.avatarImage(String(req.params.id));
    if (!img) return res.status(404).end();
    res.set('Content-Type', img.mime);
    res.set('Cache-Control', req.query.v === img.v ? 'public, max-age=31536000, immutable' : 'no-cache');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Security-Policy', "default-src 'none'");
    res.send(img.buf);
  });
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Картинка больше 1 МБ' });
    return next(err);
  });
  // who is signed in (the landing page shows the account in its header)
  app.get('/api/me', (req, res) => {
    const m = /^Bearer\s+(.+)$/.exec(req.get('authorization') || '');
    const u = m && store.userByToken(m[1]);
    res.set('Cache-Control', 'no-store');
    if (!u) return res.status(401).json({ error: 'unauthorized' });
    const p = store.profile(u.id);
    res.json({ name: p.name, balance: p.balance, inPlay: p.inPlay, avatar: p.avatar, role: p.role });
  });
  // everything else: a friendly 404 page (JSON for the API)
  app.use((req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not found' });
    res.status(404).sendFile(path.join(pub, '404.html'));
  });
  function authError(res, e) {
    if (e instanceof StoreError) return res.status(400).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }

  // --- tables ---
  const tables = new Map();
  const disconnectTimers = new Map(); // userId -> timer

  const newId = (prefix, priv) => prefix + crypto.randomBytes(priv ? 9 : 4).toString('hex');

  /** Things every table of any game needs from the server. */
  function decorate(t, cfg) {
    t.avatarOf = (uid) => {
      if (isBot(uid)) return t.bots ? t.bots.avatarOf(uid) : null;
      const u = store.get(uid);
      return u ? u.avatar : null;
    };
    t.practice = !!cfg.practice;
    if (t.practice) {
      const base = t.summary.bind(t);
      t.summary = () => ({ ...base(), practice: true, level: cfg.level || null });
    }
    t.private = !!cfg.private;
    t.createdBy = cfg.createdBy || t.createdBy || null;
    t.ownerName = t.createdBy && store.get(t.createdBy) ? store.get(t.createdBy).name : null;
    return t;
  }

  function makeTable(cfg, extra = {}) {
    const id = cfg.id || newId('', cfg.private);
    const tourney = !!extra.tournament;
    const practice = !!cfg.practice;
    const table = new Table({ ...cfg, id }, {
      actionTime,
      ...tableOpts,
      ...extra,
      onUpdate: (t) => { scheduleBroadcast(t); if (t.bots) t.bots.poke(); },
      // tournament and practice chips are not real chips: they never go back to balances
      onLeave: practice ? (userId) => { if (!isBot(userId)) practiceLeft(table); } : tourney ? () => {} : (userId, stack) => {
        store.deposit(userId, stack);
        store.setInPlay(userId, id, 0);
        pushProfile(userId);
        broadcastLobby();
      },
      onHandEnd: (t) => {
        if (t.lastResult) fx('table:' + id, t.lastResult.players.filter((p) => p.won > 0).map((p) => ({ seat: p.seat, amount: p.won })), t);
        if (practice) return;
        if (!tourney) for (const s of t.seats) if (s) store.setInPlay(s.userId, id, s.stack);
        const hh = t.histories[t.histories.length - 1];
        if (hh) {
          for (const pl of hh.players) {
            const rp = t.lastResult && t.lastResult.players.find((x) => x.seat === pl.seat);
            store.recordGame(pl.userId, 'poker', {
              tournament: tourney, table: t.name, bb: hh.bb,
              net: pl.endStack - pl.startStack, won: rp ? rp.won : 0,
              showdown: !!(t.lastResult && t.lastResult.showdown && rp),
              category: rp && t.lastResult.showdown ? rp.category : null,
              handName: rp && t.lastResult.showdown ? rp.hand : null,
            });
          }
        }
      },
    });
    decorate(table, cfg);
    tables.set(id, table);
    broadcastLobby();
    return table;
  }

  const DEFAULTS = [
    { id: 'holdem-micro', name: 'Изумруд', game: 'NLH', sb: 5, bb: 10, maxSeats: 6 },
    { id: 'holdem-mid', name: 'Чёрный бархат', game: 'NLH', sb: 25, bb: 50, maxSeats: 9 },
    { id: 'holdem-hu', name: 'Дуэль', game: 'NLH', sb: 10, bb: 20, maxSeats: 2 },
    { id: 'omaha-mid', name: 'Омаха Ривер', game: 'PLO', sb: 10, bb: 20, maxSeats: 6 },
    { id: 'holdem-high', name: 'Золотой зал', game: 'NLH', sb: 100, bb: 200, maxSeats: 6 },
    { id: 'holdem-turbo', name: 'Разгон', game: 'NLH', sb: 5, bb: 10, maxSeats: 6, blindsEvery: 5 },
    { id: 'shortdeck', name: 'Шорт-дек', game: 'SD', sb: 10, bb: 20, maxSeats: 6 },
    { id: 'plo5', name: 'Пять карт', game: 'PLO5', sb: 10, bb: 20, maxSeats: 6 },
    { id: 'limit', name: 'Лимит', game: 'LHE', sb: 10, bb: 20, maxSeats: 6 },
  ];

  const pendingBroadcast = new Set();
  function scheduleBroadcast(table) {
    if (pendingBroadcast.has(table.id)) return;
    pendingBroadcast.add(table.id);
    setImmediate(() => {
      pendingBroadcast.delete(table.id);
      if (!tables.has(table.id)) return;
      const room = io.sockets.adapter.rooms.get('table:' + table.id);
      if (room) {
        for (const sid of room) {
          const sock = io.sockets.sockets.get(sid);
          if (sock) sock.emit('table:state', table.publicState(sock.data.userId));
        }
      }
      broadcastLobby();
      if (table.private) schedulePrivate(table);
    });
  }

  let lobbyPending = false;
  function lobbyList() {
    return [...tables.values()].filter((t) => !t.tournament && !t.private).map((t) => t.summary());
  }
  function broadcastLobby() {
    if (lobbyPending) return;
    lobbyPending = true;
    setTimeout(() => { lobbyPending = false; io.to('lobby').emit('lobby:tables', lobbyList()); }, 250);
  }

  function pushProfile(userId) {
    if (!store.get(userId)) return;
    io.to('user:' + userId).emit('me', store.profile(userId));
  }

  function getTable(id) {
    const t = tables.get(String(id));
    if (!t) throw new GameError('Стол не найден');
    return t;
  }

  DEFAULTS.forEach((d) => makeTable({ ...d, permanent: true }));

  // --- Sit & Go tournaments ---
  const sngs = new Map();
  let sngPending = false;
  const sngDeps = {
    store,
    levelHands,
    makeTable,
    notify: (userId, event, payload) => {
      if (event === 'sng:result') store.recordGame(userId, 'sng', { table: payload.name, place: payload.place, total: payload.total, prize: payload.prize, buyIn: payload.buyIn });
      io.to('user:' + userId).emit(event, payload);
      pushProfile(userId);
    },
    onChange: () => broadcastSngs(),
    onStarted: (sng) => { if (sng.tpl.owner) releaseOwned(sng.tpl, false); else next(sng); }, // keep registration open
    onCancelled: (sng) => {
      if (sng.tpl.owner) releaseOwned(sng.tpl, true); else next(sng);
      setTimeout(() => { sngs.delete(sng.id); broadcastSngs(); }, sngLinger).unref();
    },
    onFinished: (sng) => {
      setTimeout(() => {
        sngs.delete(sng.id);
        const t = tables.get(sng.table.id);
        if (t) { t.destroy(); tables.delete(t.id); }
        broadcastSngs();
      }, sngLinger).unref();
    },
  };
  /** A player-made tournament that never started: give the organiser's chips back and forget it. */
  function releaseOwned(tpl, refund) {
    if (!tpl || !tpl.owner) return;
    if (refund && tpl.sponsor && !tpl.sponsorDone) { store.deposit(tpl.owner, tpl.sponsor); pushProfile(tpl.owner); }
    tpl.sponsorDone = true;
    const i = store.data.sngTemplates.indexOf(tpl);
    if (i !== -1) store.data.sngTemplates.splice(i, 1);
    store.save();
  }
  const allTemplates = () => sngTemplates.concat(store.data.sngTemplates);
  const tplById = (id) => allTemplates().find((t) => t.id === id);
  function spawnSng(tpl) {
    if (!tpl) return;
    const sng = new SitAndGo(tpl, sngDeps);
    sngs.set(sng.id, sng);
    broadcastSngs();
    return sng;
  }
  /** After a tournament starts (or a scheduled one is cancelled) open the next one of the same kind. */
  function next(sng) {
    const tpl = tplById(sng.templateId);
    if (!tpl) return;
    if (tpl.custom && !tpl.recurring) { tpl.spent = true; store.save(); return; }
    if (tpl.startAt) {
      while (tpl.startAt <= Date.now() + 30000) tpl.startAt += DAY;
      store.save();
    }
    if (![...sngs.values()].some((x) => x.templateId === tpl.id && x.status === 'registering')) spawnSng(tpl);
  }
  sngTemplates.forEach(spawnSng);
  // custom (admin-made) tournaments survive restarts; a missed daily start moves to the next day
  for (const tpl of store.data.sngTemplates.slice()) {
    if (tpl.spent) continue;
    if (tpl.startAt && tpl.startAt <= Date.now() + 30000) {
      if (tpl.owner) { releaseOwned(tpl, true); continue; }
      if (!tpl.recurring) { tpl.spent = true; continue; }
      while (tpl.startAt <= Date.now() + 30000) tpl.startAt += DAY;
    }
    spawnSng(tpl);
  }
  function sngList() {
    const order = { running: 0, registering: 1, finished: 2, cancelled: 3 };
    return [...sngs.values()].map((x) => x.summary())
      .sort((a, b) => order[a.status] - order[b.status] || a.buyIn - b.buyIn);
  }
  function broadcastSngs() {
    if (sngPending) return;
    sngPending = true;
    setTimeout(() => { sngPending = false; io.to('lobby').emit('lobby:sngs', sngList()); }, 150);
  }
  function getSng(id) {
    const x = sngs.get(String(id));
    if (!x) throw new GameError('Турнир не найден');
    return x;
  }

  // --- Durak ---
  const durakTables = new Map();
  let durakLobbyPending = false;
  const DURAK_DEFAULTS = [
    { id: 'durak-classic', name: 'Подкидной', variant: 'podkidnoy', stake: 100, maxPlayers: 4 },
    { id: 'durak-transfer', name: 'Переводной', variant: 'perevodnoy', stake: 100, maxPlayers: 4 },
    { id: 'durak-duel', name: 'Дурак на двоих', variant: 'podkidnoy', stake: 250, maxPlayers: 2 },
    { id: 'durak-big', name: 'Большая компания', variant: 'perevodnoy', stake: 500, maxPlayers: 6 },
  ];

  function makeDurak(cfg) {
    const id = cfg.id || newId('d', cfg.private);
    const key = 'durak:' + id;
    const free = cfg.practice ? {
      canAfford: () => true, charge: () => true, pay: () => {},
      onUpdate: (tt) => { scheduleDurakBroadcast(tt); if (tt.bots) tt.bots.poke(); },
      onGameEnd: (tt) => {
        const r = tt.result;
        if (r && !r.draw) fx(key, r.payouts.filter((x) => !(r.durak && r.durak.seat === x.seat)).map((x) => ({ seat: x.seat, amount: 0, text: 'Не дурак!' })), tt);
      },
    } : null;
    const t = new DurakTable({ ...cfg, id }, free || {
      canAfford: (u, a) => ((store.get(u) || {}).balance || 0) >= a,
      charge: (u, a) => {
        try { store.withdraw(u, a); } catch (e) { return false; }
        store.setInPlay(u, key, a); // refunded on restart if the server dies mid-game
        pushProfile(u);
        return true;
      },
      pay: (u, a) => { if (!u) return; store.deposit(u, a); store.setInPlay(u, key, 0); pushProfile(u); },
      onUpdate: (tt) => scheduleDurakBroadcast(tt),
      onGameEnd: (tt) => {
        for (const i of tt.players) { const u = tt._userOf(i); if (u) { store.setInPlay(u, key, 0); pushProfile(u); } }
        const r = tt.result;
        if (r) {
          for (const pay of r.payouts) {
            const u = tt._userOf(pay.seat);
            if (u) store.recordGame(u, 'durak', { table: tt.name, net: pay.net, draw: r.draw, durak: !!(r.durak && r.durak.seat === pay.seat) });
          }
          fx(key, r.payouts.filter((x) => x.net > 0).map((x) => ({ seat: x.seat, amount: x.net })), tt);
          rate('durak', r.payouts.map((x) => ({ userId: tt._userOf(x.seat), score: r.draw ? 1 : r.durak && r.durak.seat === x.seat ? 0 : 1 })));
        }
      },
    }, durakOpts);
    decorate(t, cfg);
    durakTables.set(id, t);
    broadcastDurakLobby();
    return t;
  }
  DURAK_DEFAULTS.forEach((d) => makeDurak({ ...d, permanent: true }));

  function getDurak(id) {
    const t = durakTables.get(String(id));
    if (!t) throw new GameError('Стол не найден');
    return t;
  }
  function durakList() { return [...durakTables.values()].filter((t) => !t.private).map((t) => t.summary()); }
  const pendingDurak = new Set();
  function scheduleDurakBroadcast(t) {
    if (pendingDurak.has(t.id)) return;
    pendingDurak.add(t.id);
    setImmediate(() => {
      pendingDurak.delete(t.id);
      if (!durakTables.has(t.id)) return;
      const room = io.sockets.adapter.rooms.get('durak:' + t.id);
      if (room) {
        for (const sid of room) {
          const sock = io.sockets.sockets.get(sid);
          if (sock) sock.emit('durak:state', t.publicState(sock.data.userId));
        }
      }
      broadcastDurakLobby();
      if (t.private) schedulePrivate(t);
    });
  }
  function broadcastDurakLobby() {
    if (durakLobbyPending) return;
    durakLobbyPending = true;
    setTimeout(() => { durakLobbyPending = false; io.to('lobby').emit('lobby:durak', durakList()); }, 250);
  }

  // --- Blackjack ---
  const bjTables = new Map();
  let bjLobbyPending = false;
  const BJ_LIMITS = [[5, 250], [10, 1000], [100, 10000], [500, 50000]];
  const BJ_DEFAULTS = [
    { id: 'bj-start', name: 'Новичок', minBet: 5, maxBet: 250 },
    { id: 'bj-classic', name: 'Классика', minBet: 10, maxBet: 1000 },
    { id: 'bj-vip', name: 'VIP-зал', minBet: 100, maxBet: 10000 },
  ];
  function makeBj(cfg) {
    const id = cfg.id || newId('bj', cfg.private);
    const key = 'bj:' + id;
    const t = new BlackjackTable({ ...cfg, id }, {
      charge: (u, a) => { try { store.withdraw(u, a); } catch (e) { return false; } pushProfile(u); return true; },
      pay: (u, a) => { if (!u || !a) return; store.deposit(u, a); pushProfile(u); },
      onInPlay: (u, a) => { store.setInPlay(u, key, a); },
      onUpdate: (tt) => scheduleBjBroadcast(tt),
      onRoundEnd: (tt, results) => {
        for (const r of results) if (r.userId) store.recordGame(r.userId, 'bj', { table: tt.name, net: r.net, blackjacks: r.blackjacks });
        fx(key, results.filter((r) => r.net > 0).map((r) => ({ seat: tt.seatOf(r.userId), amount: r.net, userId: r.userId })));
      },
    }, bjOpts);
    decorate(t, cfg);
    bjTables.set(id, t);
    broadcastBjLobby();
    return t;
  }
  function getBj(id) {
    const t = bjTables.get(String(id));
    if (!t) throw new GameError('Стол не найден');
    return t;
  }
  function bjList() { return [...bjTables.values()].filter((t) => !t.private).map((t) => t.summary()); }
  const pendingBj = new Set();
  function scheduleBjBroadcast(t) {
    if (pendingBj.has(t.id)) return;
    pendingBj.add(t.id);
    setImmediate(() => {
      pendingBj.delete(t.id);
      if (!bjTables.has(t.id)) return;
      const room = io.sockets.adapter.rooms.get('bj:' + t.id);
      if (room) {
        for (const sid of room) {
          const sock = io.sockets.sockets.get(sid);
          if (sock) sock.emit('bj:state', t.publicState(sock.data.userId));
        }
      }
      broadcastBjLobby();
      if (t.private) schedulePrivate(t);
    });
  }
  function broadcastBjLobby() {
    if (bjLobbyPending) return;
    bjLobbyPending = true;
    setTimeout(() => { bjLobbyPending = false; io.to('lobby').emit('lobby:bj', bjList()); }, 250);
  }
  BJ_DEFAULTS.forEach((d) => makeBj({ ...d, permanent: true }));

  // --- roulette & checkers share the same plumbing ---
  const extra = {}; // kind -> { map, make, get, list, broadcastLobby, title }
  function registerKind(kind, Ctor, title, opts, onEnd) {
    const map = new Map();
    let lobbyPending = false;
    const pend = new Set();
    const list = () => [...map.values()].filter((t) => !t.private).map((t) => t.summary());
    function broadcastLobby() {
      if (lobbyPending) return;
      lobbyPending = true;
      setTimeout(() => { lobbyPending = false; io.to('lobby').emit('lobby:' + kind, list()); }, 250);
    }
    function schedule(t) {
      if (pend.has(t.id)) return;
      pend.add(t.id);
      setImmediate(() => {
        pend.delete(t.id);
        if (!map.has(t.id)) return;
        const room = io.sockets.adapter.rooms.get(kind + ':' + t.id);
        if (room) {
          for (const sid of room) {
            const sock = io.sockets.sockets.get(sid);
            if (sock) sock.emit(kind + ':state', t.publicState(sock.data.userId));
          }
        }
        broadcastLobby();
        if (t.private) schedulePrivate(t);
      });
    }
    function make(cfg) {
      const id = cfg.id || newId(kind, cfg.private);
      const key = kind + ':' + id;
      const ended = (tt, r) => {
        fx(key, r.filter((x) => x.userId && x.net > 0).map((x) => ({ seat: tt.seatOf(x.userId), amount: x.net, userId: x.userId })));
        if (cfg.practice) {
          fx(key, r.filter((x) => x.win).map((w) => ({ seat: tt.seatOf(w.userId), amount: 0, text: 'Победа', userId: w.userId })));
          return;
        }
        onEnd(tt, r);
        r.forEach((x) => x.userId && pushProfile(x.userId));
      };
      const t = new Ctor({ ...cfg, id }, cfg.practice ? {
        charge: () => true, pay: () => {}, onInPlay: () => {},
        onUpdate: (tt) => { schedule(tt); if (tt.bots) tt.bots.poke(); },
        onRoundEnd: ended, onGameEnd: ended,
      } : {
        charge: (u, a) => { try { store.withdraw(u, a); } catch (e) { return false; } pushProfile(u); return true; },
        pay: (u, a) => { if (!u || !a) return; store.deposit(u, a); pushProfile(u); },
        onInPlay: (u, a) => { store.setInPlay(u, key, a); },
        onUpdate: schedule,
        onRoundEnd: ended,
        onGameEnd: ended,
      }, cfg.practice ? { ...opts, clockMs: cfg.clockMs } : opts);
      decorate(t, cfg);
      map.set(id, t);
      broadcastLobby();
      return t;
    }
    const get = (id) => { const t = map.get(String(id)); if (!t) throw new GameError('Стол не найден'); return t; };
    extra[kind] = { map, make, get, list, broadcastLobby, title };
    return extra[kind];
  }
  const RL = registerKind('rl', RouletteTable, 'Рулетка', rlOpts, (tt, results) => {
    for (const r of results) if (r.userId) store.recordGame(r.userId, 'roulette', { table: tt.name, net: r.net, number: tt.result, straight: r.straight && r.net > 0 });
  });
  const CK = registerKind('ck', CheckersTable, 'Шашки', ckOpts, (tt, results) => {
    for (const r of results) if (r.userId) store.recordGame(r.userId, 'checkers', { table: tt.name, net: r.net, win: r.win, draw: r.draw });
    rate('checkers', results.map((r) => ({ userId: r.userId, score: r.win ? 1 : r.draw ? 0.5 : 0 })));
  });
  const CH = registerKind('ch', ChessTable, 'Шахматы', chOpts, (tt, results) => {
    for (const r of results) if (r.userId) store.recordGame(r.userId, 'chess', { table: tt.name, net: r.net, win: r.win, draw: r.draw });
    rate('chess', results.map((r) => ({ userId: r.userId, score: r.win ? 1 : r.draw ? 0.5 : 0 })));
  });
  const CAP = registerKind('cap', CapitalTable, 'Капитал', capOpts, (tt, results) => {
    for (const r of results) if (r.userId) store.recordGame(r.userId, 'capital', { table: tt.name, net: r.net, win: r.win, place: r.place, total: results.length });
  });
  const MF = registerKind('mf', MafiaTable, 'Мафия', mfOpts, (tt, results) => {
    for (const r of results) if (r.userId) store.recordGame(r.userId, 'mafia', { table: tt.name, net: r.net, win: r.win, role: r.role });
  });
  [
    { id: 'ch-club', name: 'Шахматный клуб', stake: 100, clockMs: 10 * 60000 },
    { id: 'ch-blitz', name: 'Блиц', stake: 250, clockMs: 5 * 60000 },
    { id: 'ch-big', name: 'Гроссмейстерская', stake: 1000, clockMs: 15 * 60000 },
  ].forEach((d) => CH.make({ ...d, permanent: true }));
  [
    { id: 'cap-club', name: 'Капитал на четверых', stake: 200, maxPlayers: 4, timeLimitMin: 45 },
    { id: 'cap-big', name: 'Большой капитал', stake: 1000, maxPlayers: 6, timeLimitMin: 60 },
  ].forEach((d) => CAP.make({ ...d, permanent: true }));
  [
    { id: 'mf-club', name: 'Вечер мафии', stake: 100, maxPlayers: 10 },
    { id: 'mf-don', name: 'Дон Ривер', stake: 500, maxPlayers: 8 },
  ].forEach((d) => MF.make({ ...d, permanent: true }));
  [
    { id: 'rl-club', name: 'Для своих', minBet: 5, maxBet: 500 },
    { id: 'rl-euro', name: 'Монте-Карло', minBet: 10, maxBet: 2000 },
    { id: 'rl-vip', name: 'Высокие ставки', minBet: 100, maxBet: 20000 },
  ].forEach((d) => RL.make({ ...d, permanent: true }));
  [
    { id: 'ck-club', name: 'Клубная доска', stake: 100, clockMs: 5 * 60000 },
    { id: 'ck-blitz', name: 'Блиц', stake: 250, clockMs: 3 * 60000 },
    { id: 'ck-big', name: 'На интерес', stake: 1000, clockMs: 10 * 60000 },
  ].forEach((d) => CK.make({ ...d, permanent: true }));
  const extraTables = () => Object.values(extra).flatMap((k) => [...k.map.values()]);

  // remove idle player-created tables
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const t of allTables()) if (t.practice && !humansAt(t)) dropPractice(t);
    const closed = store.seasonTick();
    if (closed) {
      io.emit('season:closed', closed);
      closed.winners.forEach((w) => { pushProfile(w.id); notice(w.id, `Сезон ${closed.label}: вы заняли ${w.place} место и получили ${w.prize} фишек!`, { type: 'season' }); });
    }
    for (const t of tables.values()) {
      if (!t.permanent && !t.tournament && t.playerCount() === 0 && now - t.lastActivity > 10 * 60 * 1000) {
        t.destroy();
        tables.delete(t.id);
        broadcastLobby();
      }
    }
    for (const t of bjTables.values()) {
      if (!t.permanent && t.playerCount() === 0 && now - t.lastActivity > 10 * 60 * 1000) {
        t.destroy();
        bjTables.delete(t.id);
        broadcastBjLobby();
      }
    }
    for (const t of durakTables.values()) {
      if (!t.permanent && t.playerCount() === 0 && now - t.lastActivity > 10 * 60 * 1000) {
        t.destroy();
        durakTables.delete(t.id);
        broadcastDurakLobby();
      }
    }
    for (const k of Object.values(extra)) {
      for (const t of k.map.values()) {
        if (!t.permanent && t.playerCount() === 0 && now - t.lastActivity > 10 * 60 * 1000) { t.destroy(); k.map.delete(t.id); k.broadcastLobby(); }
      }
    }
  }, 60000);

  // --- private tables & friends ---
  const KIND_OF = (t) => (t.kind === 'durak' || t.kind === 'bj' || extra[t.kind] ? t.kind : 'poker');
  const HREF_OF = (t) => (KIND_OF(t) === 'poker' ? `#/table/${t.id}` : `#/${t.kind}/${t.id}`);
  const allTables = () => [...tables.values(), ...durakTables.values(), ...bjTables.values(), ...extraTables()];
  const findTable = (kind, id) => (kind === 'table' ? tables.get(id) : kind === 'durak' ? durakTables.get(id) : kind === 'bj' ? bjTables.get(id) : extra[kind] ? extra[kind].map.get(id) : null) || null;
  const voice = createVoice(io, {
    findTable,
    nameOf: (uid) => (store.brief(uid) || { name: '?' }).name,
    avatarOf: (uid) => (store.brief(uid) || {}).avatar || null,
  });

  /** Private tables a player may see in the lobby: own, friends', or where they sit. */
  function privateList(uid) {
    return allTables()
      .filter((t) => t.private && (t.practice ? t.seatOf(uid) !== -1 : t.createdBy === uid || store.areFriends(t.createdBy, uid) || t.seatOf(uid) !== -1))
      .map((t) => ({ ...t.summary(), kind: KIND_OF(t), href: HREF_OF(t) }));
  }
  function pushPrivate(uid) { io.to('user:' + uid).emit('lobby:private', privateList(uid)); }
  const privPending = new Set();
  function schedulePrivate(t) {
    if (privPending.has(t.id)) return;
    privPending.add(t.id);
    setTimeout(() => {
      privPending.delete(t.id);
      const audience = new Set([t.createdBy, ...store.friendsOf(t.createdBy)]);
      t.seats.forEach((x) => { if (x) audience.add(x.userId); });
      for (const uid of audience) if (uid) pushPrivate(uid);
    }, 250);
  }

  const isOnline = (uid) => { const r = io.sockets.adapter.rooms.get('user:' + uid); return !!(r && r.size); };
  /** Where a player sits right now (any game). */
  function whereIs(uid) {
    return allTables().filter((t) => t.seatOf(uid) !== -1)
      .map((t) => ({ kind: KIND_OF(t), id: t.id, name: t.name, href: HREF_OF(t), private: !!t.private }));
  }
  function friendsPayload(uid) {
    const u = store.get(uid);
    if (!u) return { friends: [], incoming: [], outgoing: [] };
    const friends = u.friends.map((fid) => {
      const b = store.brief(fid);
      return b && { ...b, online: isOnline(fid), where: whereIs(fid) };
    }).filter(Boolean).sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name, 'ru'));
    return {
      friends,
      incoming: u.friendReq.in.map((x) => store.brief(x)).filter(Boolean),
      outgoing: u.friendReq.out.map((x) => store.brief(x)).filter(Boolean),
    };
  }
  /** Tell a player's friends that something about them changed (online, seat). */
  const presencePending = new Set();
  function presenceChanged(uid) {
    if (presencePending.has(uid)) return;
    presencePending.add(uid);
    setTimeout(() => {
      presencePending.delete(uid);
      for (const f of store.friendsOf(uid)) io.to('user:' + f).emit('friends:dirty');
    }, 400);
  }

  /** Avatar changed: refresh the profile, the tables the player sits at and friends' lists. */
  function refreshAvatar(uid) {
    pushProfile(uid);
    for (const t of allTables()) {
      if (t.seatOf(uid) === -1) continue;
      if (t.kind === 'durak' || t.kind === 'bj' || extra[t.kind]) t._update(); else t.onUpdate(t);
    }
    presenceChanged(uid);
  }
  avatarChangedHook = refreshAvatar;
  const hueOf = (uid) => { const u = store.get(uid); return u && u.avatar && u.avatar.hue != null ? u.avatar.hue : null; };

  /** Take a player off every table and out of pending registrations (ban / admin kick). */
  function removeEverywhere(target) {
    for (const t of tables.values()) {
      if (!t.tournament && t.seatOf(target) !== -1) t.standUp(target);
    }
    for (const t of durakTables.values()) if (t.seatOf(target) !== -1) t.leave(target);
    for (const t of bjTables.values()) if (t.seatOf(target) !== -1) t.leave(target);
    for (const t of extraTables()) if (t.seatOf(target) !== -1) t.leave(target);
    for (const x of sngs.values()) {
      if (x.status === 'registering' && x.players.some((p) => p.userId === target)) x.unregister(target);
    }
  }
  function notice(userId, text, extra = {}) { io.to('user:' + userId).emit('notice', { text, ...extra }); }

  /** Win amounts and labels that float over the seats. */
  function fx(room, items, t = null) {
    const owner = (seat) => (t && t._userOf ? t._userOf(seat) : t && t.seats[seat] ? t.seats[seat].userId : null);
    const list = items.filter((x) => x.seat >= 0).map((x) => ({ ...x, userId: x.userId || owner(x.seat) }));
    if (list.length) io.to(room).emit('fx', { room, items: list });
  }
  /** Elo after a rated game; each player hears about their own change. */
  function rate(kind, results) {
    const real = results.filter((r) => r.userId && !isBot(r.userId));
    if (real.length < 2) return;
    for (const r of store.applyRatings(kind, real)) io.to('user:' + r.userId).emit('rating', { kind, rating: r.rating, delta: r.delta });
  }

  // --- practice tables against the computer ---
  const humansAt = (t) => t.seats.filter((x) => x && !isBot(x.userId)).length;
  const roomOf = (t) => (KIND_OF(t) === 'poker' ? 'table:' : KIND_OF(t) + ':') + t.id;
  function mapOf(t) {
    const k = KIND_OF(t);
    return k === 'poker' ? tables : k === 'durak' ? durakTables : k === 'bj' ? bjTables : extra[k].map;
  }
  function dropPractice(t) {
    if (t.bots) t.bots.stop();
    const map = mapOf(t);
    if (map.get(t.id) !== t) return;
    map.delete(t.id);
    t.destroy();
    io.to(roomOf(t)).emit('notice', { type: 'closed', tableId: t.id, text: 'Тренировочный стол закрыт' });
  }
  function practiceLeft(t) {
    setImmediate(() => { if (!humansAt(t)) dropPractice(t); });
  }
  /** A table for one player against bots: no chips, no stats. */
  function createPractice(uid, name, { game, level, bots, variant, clock }) {
    level = BOT_LEVELS.includes(level) ? level : 'normal';
    // one practice table per player and game
    for (const t of allTables()) if (t.practice && t.createdBy === uid && KIND_OF(t) === game) dropPractice(t);
    const tag = LEVEL_NAMES[level];
    if (game === 'ck') {
      const [bot] = makeBots(1, crypto.randomInt(8));
      const cl = CK_CLOCKS.includes(Number(clock)) ? Number(clock) : 10;
      const t = CK.make({ level, name: `Тренировка · ${tag}`, stake: 0, clockMs: cl * 60000, createdBy: uid, private: true, practice: true });
      t.bots = new BotDriver(t, 'ck', [bot], level, botOpts);
      t.sit(uid, name, 0);
      t.sit(bot.userId, bot.name, 1);
      return { kind: 'ck', id: t.id, href: `#/ck/${t.id}` };
    }
    if (game === 'ch') {
      const [bot] = makeBots(1, crypto.randomInt(10));
      const cl = CH_CLOCKS.includes(Number(clock)) ? Number(clock) : 15;
      const t = CH.make({ level, name: `Тренировка · ${tag}`, stake: 0, clockMs: cl * 60000, createdBy: uid, private: true, practice: true });
      t.bots = new BotDriver(t, 'ch', [bot], level, botOpts);
      t.sit(uid, name, 0);
      t.sit(bot.userId, bot.name, 1);
      return { kind: 'ch', id: t.id, href: `#/ch/${t.id}` };
    }
    if (game === 'cap') {
      const n = Math.min(5, Math.max(1, Math.floor(Number(bots)) || 2));
      const list = makeBots(n, crypto.randomInt(10));
      const t = CAP.make({ level, name: `Тренировка · ${tag}`, stake: 0, maxPlayers: n + 1, timeLimitMin: 60, createdBy: uid, private: true, practice: true });
      t.bots = new BotDriver(t, 'cap', list, level, botOpts);
      t.sit(uid, name, 0);
      list.forEach((b, k) => t.sit(b.userId, b.name, k + 1));
      return { kind: 'cap', id: t.id, href: `#/cap/${t.id}` };
    }
    if (game === 'mf') {
      const n = Math.min(9, Math.max(4, Math.floor(Number(bots)) || 6));
      const list = makeBots(n, crypto.randomInt(10));
      const t = MF.make({ level, name: `Тренировка · ${tag}`, stake: 0, maxPlayers: n + 1, createdBy: uid, private: true, practice: true });
      t.bots = new BotDriver(t, 'mf', list, level, botOpts);
      t.sit(uid, name, 0);
      list.forEach((b, k) => t.sit(b.userId, b.name, k + 1));
      return { kind: 'mf', id: t.id, href: `#/mf/${t.id}` };
    }
    if (game === 'durak') {
      const n = Math.min(5, Math.max(1, Math.floor(Number(bots)) || 2));
      const list = makeBots(n, crypto.randomInt(8));
      const t = makeDurak({ level, name: `Тренировка · ${tag}`, variant, stake: 0, maxPlayers: n + 1, createdBy: uid, private: true, practice: true });
      t.bots = new BotDriver(t, 'durak', list, level, botOpts);
      t.sit(uid, name, 0);
      list.forEach((b, k) => t.sit(b.userId, b.name, k + 1));
      return { kind: 'durak', id: t.id, href: `#/durak/${t.id}` };
    }
    if (game === 'poker') {
      const n = Math.min(5, Math.max(1, Math.floor(Number(bots)) || 3));
      const list = makeBots(n, crypto.randomInt(8));
      const g = ['NLH', 'PLO', 'SD', 'LHE'].includes(variant) ? variant : 'NLH';
      const t = makeTable({ level, name: `Тренировка · ${tag}`, game: g, sb: 10, bb: 20, maxSeats: 6, createdBy: uid, private: true, practice: true });
      t.bots = new BotDriver(t, 'poker', list, level, { ...botOpts, botStack: 2000 });
      list.forEach((b, k) => t.seatDirect(b.userId, b.name, k + 1, 2000));
      t.sit(uid, name, 0, 2000);
      return { kind: 'poker', id: t.id, href: `#/table/${t.id}` };
    }
    throw new GameError('Нет такой игры');
  }

  // --- sockets ---
  io.use((socket, next) => {
    const user = store.userByToken(socket.handshake.auth?.token);
    if (!user) return next(new Error('unauthorized'));
    if (user.banned) return next(new Error('banned'));
    socket.data.userId = user.id;
    socket.data.name = user.name;
    next();
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId;
    socket.join('user:' + userId);
    socket.join('lobby');

    // reconnected: cancel the pending stand-up and mark seats online
    if (disconnectTimers.has(userId)) {
      clearTimeout(disconnectTimers.get(userId));
      disconnectTimers.delete(userId);
    }
    for (const t of tables.values()) if (t.seatOf(userId) !== -1) t.setConnected(userId, true);
    for (const t of durakTables.values()) if (t.seatOf(userId) !== -1) t.setConnected(userId, true);
    for (const t of bjTables.values()) if (t.seatOf(userId) !== -1) t.setConnected(userId, true);
    for (const t of extraTables()) if (t.seatOf(userId) !== -1) t.setConnected(userId, true);
    presenceChanged(userId);

    let lastChat = 0;
    const on = (event, handler) => {
      socket.on(event, (payload, cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        try {
          const res = handler(payload || {});
          reply({ ok: true, ...(res || {}) });
        } catch (e) {
          if (e instanceof GameError || e instanceof StoreError) reply({ error: e.message });
          else { console.error(e); reply({ error: 'Ошибка сервера' }); }
        }
      });
    };

    voice.attach(socket, on, GameError);

    on('hello', () => ({
      me: store.profile(userId),
      tables: lobbyList(),
      myTables: [...tables.values()].filter((t) => t.seatOf(userId) !== -1).map((t) => t.id),
      stakes: STAKES,
      seatOptions: SEAT_OPTIONS,
      games: Object.fromEntries(Object.entries(GAMES).map(([k, g]) => [k, { name: g.name, short: g.short, hole: g.hole, maxSeats: g.maxSeats, limit: g.limit, rules: g.rules }])),
      blindEveryOptions: BLIND_EVERY_OPTIONS,
      sngs: sngList(),
      durak: durakList(),
      myDurak: [...durakTables.values()].filter((t) => t.seatOf(userId) !== -1).map((t) => t.id),
      durakStakes: DURAK_STAKES,
      bj: bjList(),
      myBj: [...bjTables.values()].filter((t) => t.seatOf(userId) !== -1).map((t) => t.id),
      announcement: store.data.announcement,
      leaderboard: store.leaderboard(),
      private: privateList(userId),
      bjLimits: BJ_LIMITS,
      rl: RL.list(),
      myRl: [...RL.map.values()].filter((t) => t.seatOf(userId) !== -1).map((t) => t.id),
      rlLimits: RL_LIMITS,
      ck: CK.list(),
      myCk: [...CK.map.values()].filter((t) => t.seatOf(userId) !== -1).map((t) => t.id),
      ckStakes: CK_STAKES,
      ch: CH.list(), myCh: [...CH.map.values()].filter((t) => t.seatOf(userId) !== -1).map((t) => t.id), chStakes: CH_STAKES, chClocks: CH_CLOCKS,
      cap: CAP.list(), myCap: [...CAP.map.values()].filter((t) => t.seatOf(userId) !== -1).map((t) => t.id), capStakes: CAP_STAKES, capTimes: CAP_TIMES,
      mf: MF.list(), myMf: [...MF.map.values()].filter((t) => t.seatOf(userId) !== -1).map((t) => t.id), mfStakes: MF_STAKES,
      ckClocks: CK_CLOCKS,
      reactions: REACTIONS,
      botLevels: BOT_LEVELS.map((k) => ({ id: k, name: LEVEL_NAMES[k] })),
    }));

    // ----- profile -----
    on('profile:get', ({ name }) => {
      const p = store.publicProfile(name || userId);
      const me = store.get(userId);
      p.me = p.id === userId;
      p.friend = me.friends.includes(p.id);
      p.requested = me.friendReq.out.includes(p.id);
      p.incoming = me.friendReq.in.includes(p.id);
      p.online = isOnline(p.id);
      p.where = p.me || p.friend ? whereIs(p.id) : [];
      return { profile: p };
    });
    // ----- private messages -----
    let lastDm = 0;
    on('dm:list', () => ({ list: store.dmList(userId).map((c) => ({ ...c, friend: store.brief(c.id), online: isOnline(c.id) })) }));
    on('dm:history', ({ id }) => {
      const fid = String(id || '');
      const friend = store.brief(fid);
      if (!friend) throw new GameError('Игрок не найден');
      if (store.dmMarkRead(userId, fid)) pushProfile(userId);
      return { friend: { ...friend, online: isOnline(fid), isFriend: store.areFriends(userId, fid) }, messages: store.dmHistory(userId, fid) };
    });
    on('dm:send', ({ id, text }) => {
      const fid = String(id || '');
      if (Date.now() - lastDm < 400) throw new GameError('Не так быстро');
      const msg = store.dmSend(userId, fid, text);
      lastDm = Date.now();
      io.to('user:' + fid).emit('dm:new', { with: userId, from: store.brief(userId), msg });
      io.to('user:' + userId).emit('dm:new', { with: fid, msg });
      pushProfile(fid);
      return { msg };
    });
    on('dm:read', ({ id }) => { if (store.dmMarkRead(userId, String(id || ''))) pushProfile(userId); });
    on('dm:typing', ({ id }) => {
      const fid = String(id || '');
      if (store.areFriends(userId, fid)) io.to('user:' + fid).emit('dm:typing', { with: userId });
    });

    on('progress:get', () => store.progress(userId));
    on('quest:claim', ({ id }) => {
      const reward = store.claimQuest(userId, String(id));
      pushProfile(userId);
      return { reward, progress: store.progress(userId) };
    });
    on('ach:claim', ({ id }) => {
      const reward = store.claimAchievement(userId, String(id));
      pushProfile(userId);
      return { reward, progress: store.progress(userId) };
    });

    on('profile:avatar', ({ hue, sym }) => {
      const avatar = store.setAvatar(userId, hue, sym);
      refreshAvatar(userId);
      return { avatar };
    });

    // ----- friends -----
    on('friends:list', () => friendsPayload(userId));
    on('friends:add', ({ name }) => {
      const res = store.friendRequest(userId, name);
      const other = res.other.id;
      if (res.status === 'sent') io.to('user:' + other).emit('friends:request', { from: store.brief(userId) });
      else { io.to('user:' + other).emit('notice', { text: `${socket.data.name} теперь ваш друг` }); pushPrivate(other); pushPrivate(userId); }
      io.to('user:' + other).emit('friends:dirty');
      pushProfile(other);
      pushProfile(userId);
      return { status: res.status, ...friendsPayload(userId) };
    });
    on('friends:accept', ({ id }) => {
      const res = store.friendAccept(userId, String(id));
      io.to('user:' + res.other.id).emit('notice', { text: `${socket.data.name} принял(а) заявку в друзья` });
      io.to('user:' + res.other.id).emit('friends:dirty');
      pushPrivate(res.other.id); pushPrivate(userId); pushProfile(userId);
      return friendsPayload(userId);
    });
    on('friends:decline', ({ id }) => {
      store.friendDecline(userId, String(id));
      io.to('user:' + String(id)).emit('friends:dirty');
      pushProfile(userId); pushProfile(String(id));
      return friendsPayload(userId);
    });
    on('friends:remove', ({ id }) => {
      store.friendRemove(userId, String(id));
      io.to('user:' + String(id)).emit('friends:dirty');
      pushPrivate(String(id)); pushPrivate(userId);
      return friendsPayload(userId);
    });
    let lastInvite = 0;
    on('friends:invite', ({ id, href }) => {
      const fid = String(id);
      if (!store.areFriends(userId, fid)) throw new GameError('Приглашать можно только друзей');
      const m = /^#\/(table|durak|bj|rl|ck|ch|cap|mf)\/([\w-]+)$/.exec(String(href || ''));
      if (!m) throw new GameError('Неверная ссылка');
      const t = m[1] === 'table' ? tables.get(m[2]) : m[1] === 'durak' ? durakTables.get(m[2]) : m[1] === 'bj' ? bjTables.get(m[2]) : extra[m[1]].map.get(m[2]);
      if (!t) throw new GameError('Стол не найден');
      if (Date.now() - lastInvite < 1500) throw new GameError('Не так быстро');
      lastInvite = Date.now();
      if (!isOnline(fid)) throw new GameError('Друг сейчас не в сети');
      const game = { poker: t.tournament ? 'Sit & Go' : 'Покер', durak: 'Дурак', bj: 'Блэкджек', rl: 'Рулетка', ck: 'Шашки', ch: 'Шахматы', cap: 'Капитал', mf: 'Мафия' }[KIND_OF(t)];
      io.to('user:' + fid).emit('invite', { from: store.brief(userId), href, title: t.name, game });
    });

    on('bonus:claim', () => {
      const res = store.claimBonus(userId);
      pushProfile(userId);
      return res;
    });

    on('table:create', ({ name, game, stakes, seats, blindsEvery, private: priv }) => {
      if (tables.size >= MAX_TABLES) throw new GameError('Слишком много столов, попробуйте позже');
      const st = STAKES[Number(stakes)];
      const maxSeats = Number(seats);
      if (!st || !SEAT_OPTIONS.includes(maxSeats)) throw new GameError('Неверные параметры стола');
      const own = [...tables.values()].filter((t) => t.createdBy === userId).length;
      if (own >= 3) throw new GameError('Можно создать не больше 3 столов');
      const clean = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 24) || `Стол ${socket.data.name}`;
      const every = BLIND_EVERY_OPTIONS.includes(Number(blindsEvery)) ? Number(blindsEvery) : 0;
      if (maxSeats > GAMES[gameOf(game)].maxSeats) throw new GameError(`В ${GAMES[gameOf(game)].name} играют до ${GAMES[gameOf(game)].maxSeats} человек`);
      const t = makeTable({ name: clean, game: gameOf(game), sb: st[0], bb: st[1], maxSeats, createdBy: userId, blindsEvery: every, private: !!priv });
      if (t.private) schedulePrivate(t);
      return { tableId: t.id };
    });

    on('sng:create', (raw) => {
      raw = raw || {};
      const mine = store.data.sngTemplates.filter((t) => t.owner === userId && !t.sponsorDone);
      if (mine.length >= 2) throw new GameError('У вас уже 2 открытых турнира — дождитесь их старта');
      if (raw.startAt && Number(raw.startAt) > Date.now() + 7 * DAY) throw new GameError('Старт — не позже чем через неделю');
      const v = validateTemplate({ ...raw, guarantee: 0, recurring: false, owner: userId });
      if (v.buyIn && v.buyIn < 10) throw new GameError('Бай-ин — от 10 фишек');
      if (v.sponsor) store.withdraw(userId, v.sponsor);
      const tpl = { id: 'p' + crypto.randomBytes(4).toString('hex'), custom: true, createdAt: Date.now(), ...v, owner: userId, ownerName: socket.data.name };
      store.data.sngTemplates.push(tpl);
      store.save();
      pushProfile(userId);
      const sng = spawnSng(tpl);
      if (raw.register) {
        try { sng.register(userId, socket.data.name); pushProfile(userId); } catch (e) { /* not enough chips: stays open */ }
      }
      return { sngId: sng.id };
    });

    on('sng:cancelOwn', ({ sngId }) => {
      const x = getSng(sngId);
      if (x.owner !== userId) throw new GameError('Отменить может только организатор');
      if (x.status !== 'registering') throw new GameError('Турнир уже начался');
      const players = x.players.map((p) => p.userId);
      x.cancel(`Организатор отменил турнир «${x.name}», бай-ин возвращён`);
      players.forEach(pushProfile);
      pushProfile(userId);
    });

    on('sng:register', ({ sngId }) => {
      const sng = getSng(sngId);
      sng.register(userId, socket.data.name);
      pushProfile(userId);
      return { tableId: sng.table ? sng.table.id : null };
    });

    on('sng:unregister', ({ sngId }) => {
      getSng(sngId).unregister(userId);
      pushProfile(userId);
    });

    on('table:history', ({ tableId }) => ({ hands: getTable(tableId).historyList(userId) }));

    on('table:replay', ({ tableId, handNo }) => ({ replay: getTable(tableId).replay(userId, Number(handNo)) }));

    on('table:show', ({ tableId }) => { getTable(tableId).showCards(userId); });

    on('table:watch', ({ tableId }) => {
      const t = getTable(tableId);
      socket.join('table:' + t.id);
      return { state: t.publicState(userId) };
    });

    on('table:unwatch', ({ tableId }) => {
      socket.leave('table:' + String(tableId));
    });

    on('table:sit', ({ tableId, seat, buyIn }) => {
      presenceChanged(userId);
      const t = getTable(tableId);
      buyIn = Math.floor(Number(buyIn));
      seat = Math.floor(Number(seat));
      if (t.practice) { t.sit(userId, socket.data.name, seat, buyIn); socket.join('table:' + t.id); return; }
      store.withdraw(userId, buyIn);
      try {
        t.sit(userId, socket.data.name, seat, buyIn);
      } catch (e) {
        store.deposit(userId, buyIn);
        throw e;
      }
      store.setInPlay(userId, t.id, buyIn);
      socket.join('table:' + t.id);
      pushProfile(userId);
    });

    on('table:stand', ({ tableId }) => {
      presenceChanged(userId);
      getTable(tableId).standUp(userId);
    });

    on('practice:create', (opts) => {
      const res = createPractice(userId, socket.data.name, opts || {});
      socket.join((res.kind === 'poker' ? 'table:' : res.kind + ':') + res.id);
      if (res.kind === 'poker') pushPrivate(userId);
      presenceChanged(userId);
      return res;
    });

    let lastReact = 0;
    on('react', ({ room, emoji }) => {
      if (!REACTIONS.includes(emoji)) throw new GameError('Нет такой реакции');
      const m = /^(table|durak|bj|rl|ck|ch|cap|mf):([\w-]+)$/.exec(String(room || ''));
      if (!m) throw new GameError('Стол не найден');
      const t = m[1] === 'table' ? tables.get(m[2]) : m[1] === 'durak' ? durakTables.get(m[2]) : m[1] === 'bj' ? bjTables.get(m[2]) : extra[m[1]].map.get(m[2]);
      if (!t) throw new GameError('Стол не найден');
      const seat = t.seatOf(userId);
      if (seat === -1) throw new GameError('Реакции — для игроков за столом');
      if (Date.now() - lastReact < 1200) throw new GameError('Не так быстро');
      lastReact = Date.now();
      io.to(room).emit('react', { room, seat, emoji, name: socket.data.name });
    });

    on('ratings:get', ({ kind }) => {
      const k = ['durak', 'chess'].includes(kind) ? kind : 'checkers';
      return { list: store.ratingTable(k), me: (store.get(userId).rating || {})[k] };
    });
    on('season:get', ({ game }) => ({ season: store.seasonView(String(game || 'total'), userId) }));

    on('table:act', ({ tableId, type, amount }) => {
      const allowed = ['fold', 'check', 'call', 'bet', 'raise', 'allin'];
      if (!allowed.includes(type)) throw new GameError('Неизвестное действие');
      getTable(tableId).act(userId, type, amount == null ? undefined : Math.floor(Number(amount)));
    });

    on('table:sitout', ({ tableId, value }) => {
      getTable(tableId).setSittingOut(userId, !!value);
    });

    on('table:addchips', ({ tableId, amount }) => {
      const t = getTable(tableId);
      amount = Math.floor(Number(amount));
      if (t.practice) { t.addChips(userId, amount); return; }
      store.withdraw(userId, amount);
      try {
        t.addChips(userId, amount);
      } catch (e) {
        store.deposit(userId, amount);
        throw e;
      }
      const s = t.seats[t.seatOf(userId)];
      store.setInPlay(userId, t.id, s.stack);
      pushProfile(userId);
    });

    const chatText = (text) => {
      if (store.get(userId).muted) throw new GameError('Администратор запретил вам писать в чат');
      const now = Date.now();
      if (now - lastChat < 800) throw new GameError('Не так быстро');
      lastChat = now;
      return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    };

    // ----- durak -----
    on('durak:create', ({ name, variant, stake, maxPlayers, private: priv }) => {
      if (durakTables.size >= MAX_TABLES) throw new GameError('Слишком много столов');
      const st = Number(stake);
      const mp = Number(maxPlayers);
      if (!DURAK_STAKES.includes(st) || !(mp >= 2 && mp <= 6)) throw new GameError('Неверные параметры стола');
      const own = [...durakTables.values()].filter((t) => t.createdBy === userId).length;
      if (own >= 3) throw new GameError('Можно создать не больше 3 столов');
      const clean = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 24) || `Дурак у ${socket.data.name}`;
      const t = makeDurak({ name: clean, variant, stake: st, maxPlayers: mp, createdBy: userId, private: !!priv });
      if (t.private) schedulePrivate(t);
      return { tableId: t.id };
    });
    on('durak:watch', ({ tableId }) => {
      const t = getDurak(tableId);
      socket.join('durak:' + t.id);
      return { state: t.publicState(userId) };
    });
    on('durak:unwatch', ({ tableId }) => { socket.leave('durak:' + String(tableId)); });
    on('durak:sit', ({ tableId, seat }) => {
      presenceChanged(userId);
      const t = getDurak(tableId);
      t.sit(userId, socket.data.name, Math.floor(Number(seat)));
      socket.join('durak:' + t.id);
    });
    on('durak:leave', ({ tableId }) => {
      presenceChanged(userId);
      const t = getDurak(tableId);
      t.leave(userId);
      if (t.practice) practiceLeft(t);
    });
    on('durak:ready', ({ tableId, value }) => { getDurak(tableId).setReady(userId, !!value); });
    on('durak:act', ({ tableId, type, card, index }) => {
      if (!['attack', 'defend', 'transfer', 'take', 'pass'].includes(type)) throw new GameError('Неизвестное действие');
      getDurak(tableId).act(userId, type, card, index);
    });
    on('durak:chat', ({ tableId, text }) => {
      const t = getDurak(tableId);
      const clean = chatText(text);
      if (clean) t.addChat(socket.data.name, clean, hueOf(userId));
    });

    // ----- blackjack -----
    on('bj:create', ({ name, limits, private: priv }) => {
      if (bjTables.size >= MAX_TABLES) throw new GameError('Слишком много столов');
      const lim = BJ_LIMITS[Number(limits)];
      if (!lim) throw new GameError('Неверные лимиты');
      const own = [...bjTables.values()].filter((t) => t.createdBy === userId).length;
      if (own >= 3) throw new GameError('Можно создать не больше 3 столов');
      const clean = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 24) || `Блэкджек у ${socket.data.name}`;
      const t = makeBj({ name: clean, minBet: lim[0], maxBet: lim[1], createdBy: userId, private: !!priv });
      if (t.private) schedulePrivate(t);
      return { tableId: t.id };
    });
    on('bj:watch', ({ tableId }) => {
      const t = getBj(tableId);
      socket.join('bj:' + t.id);
      return { state: t.publicState(userId) };
    });
    on('bj:unwatch', ({ tableId }) => { socket.leave('bj:' + String(tableId)); });
    on('bj:sit', ({ tableId, seat }) => {
      presenceChanged(userId);
      const t = getBj(tableId);
      t.sit(userId, socket.data.name, Math.floor(Number(seat)));
      socket.join('bj:' + t.id);
    });
    on('bj:leave', ({ tableId }) => {
      presenceChanged(userId); getBj(tableId).leave(userId); });
    on('bj:bet', ({ tableId, amount }) => { getBj(tableId).bet(userId, amount); });
    on('bj:clear', ({ tableId }) => { getBj(tableId).clearBet(userId); });
    on('bj:rebet', ({ tableId }) => { getBj(tableId).rebet(userId); });
    on('bj:act', ({ tableId, type }) => {
      if (!['hit', 'stand', 'double', 'split'].includes(type)) throw new GameError('Неизвестное действие');
      getBj(tableId).act(userId, type);
    });
    on('bj:chat', ({ tableId, text }) => {
      const t = getBj(tableId);
      const clean = chatText(text);
      if (clean) t.addChat(socket.data.name, clean, hueOf(userId));
    });

    // ----- roulette & checkers -----
    for (const [kind, K] of Object.entries(extra)) {
      on(kind + ':watch', ({ tableId }) => {
        const t = K.get(tableId);
        socket.join(kind + ':' + t.id);
        return { state: t.publicState(userId) };
      });
      on(kind + ':unwatch', ({ tableId }) => { socket.leave(kind + ':' + String(tableId)); });
      on(kind + ':sit', ({ tableId, seat }) => {
        const t = K.get(tableId);
        let idx = Math.floor(Number(seat));
        if ((kind === 'rl' || kind === 'cap' || kind === 'mf') && !(idx >= 0)) idx = t.freeSeat();
        if (idx === -1) throw new GameError('Все места заняты');
        t.sit(userId, socket.data.name, idx);
        socket.join(kind + ':' + t.id);
        presenceChanged(userId);
      });
      on(kind + ':leave', ({ tableId }) => {
        const t = K.get(tableId);
        t.leave(userId);
        if (t.practice) practiceLeft(t);
        presenceChanged(userId);
      });
      on(kind + ':chat', ({ tableId, text }) => {
        const t = K.get(tableId);
        const clean = chatText(text);
        if (!clean) return;
        if (kind === 'mf') t.say(userId, socket.data.name, clean, hueOf(userId));
        else t.addChat(socket.data.name, clean, hueOf(userId));
      });
    }
    const ownCount = (K) => [...K.map.values()].filter((t) => t.createdBy === userId).length;
    on('rl:create', ({ name, limits, private: priv }) => {
      if (RL.map.size >= MAX_TABLES) throw new GameError('Слишком много столов');
      const lim = RL_LIMITS[Number(limits)];
      if (!lim) throw new GameError('Неверные лимиты');
      if (ownCount(RL) >= 3) throw new GameError('Можно создать не больше 3 столов');
      const clean = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 24) || `Рулетка у ${socket.data.name}`;
      const t = RL.make({ name: clean, minBet: lim[0], maxBet: lim[1], createdBy: userId, private: !!priv });
      if (t.private) schedulePrivate(t);
      return { tableId: t.id };
    });
    on('rl:bet', ({ tableId, spot, amount }) => { RL.get(tableId).bet(userId, String(spot), amount); });
    on('rl:undo', ({ tableId }) => { RL.get(tableId).undo(userId); });
    on('rl:clear', ({ tableId }) => { RL.get(tableId).clear(userId); });
    on('rl:rebet', ({ tableId, double }) => { RL.get(tableId).rebet(userId, !!double); });
    on('ck:create', ({ name, stake, clock, private: priv }) => {
      if (CK.map.size >= MAX_TABLES) throw new GameError('Слишком много столов');
      const st = Number(stake);
      const cl = Number(clock);
      if (!CK_STAKES.includes(st) || !CK_CLOCKS.includes(cl)) throw new GameError('Неверные параметры стола');
      if (ownCount(CK) >= 3) throw new GameError('Можно создать не больше 3 столов');
      const clean = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 24) || `Шашки у ${socket.data.name}`;
      const t = CK.make({ name: clean, stake: st, clockMs: cl * 60000, createdBy: userId, private: !!priv });
      if (t.private) schedulePrivate(t);
      return { tableId: t.id };
    });
    on('ck:ready', ({ tableId, value }) => { CK.get(tableId).setReady(userId, !!value); });
    // ----- chess -----
    on('ch:create', ({ name, stake, clock, private: priv }) => {
      if (CH.map.size >= MAX_TABLES) throw new GameError('Слишком много столов');
      const st = Number(stake);
      const cl = Number(clock);
      if (!CH_STAKES.includes(st) || !CH_CLOCKS.includes(cl)) throw new GameError('Неверные параметры стола');
      if (ownCount(CH) >= 3) throw new GameError('Можно создать не больше 3 столов');
      const clean = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 24) || `Шахматы у ${socket.data.name}`;
      const t = CH.make({ name: clean, stake: st, clockMs: cl * 60000, createdBy: userId, private: !!priv });
      if (t.private) schedulePrivate(t);
      return { tableId: t.id };
    });
    on('ch:ready', ({ tableId, value }) => { CH.get(tableId).setReady(userId, !!value); });
    on('ch:move', ({ tableId, from, to, promo }) => { CH.get(tableId).move(userId, { from, to, promo }); });
    on('ch:resign', ({ tableId }) => { CH.get(tableId).resign(userId); });
    on('ch:draw', ({ tableId }) => { CH.get(tableId).offerDraw(userId); });
    on('ch:declineDraw', ({ tableId }) => { CH.get(tableId).declineDraw(userId); });
    // ----- Капитал -----
    on('cap:create', ({ name, stake, maxPlayers, time, private: priv }) => {
      if (CAP.map.size >= MAX_TABLES) throw new GameError('Слишком много столов');
      const st = Number(stake);
      const mp = Number(maxPlayers);
      const tm = Number(time);
      if (!CAP_STAKES.includes(st) || !(mp >= 2 && mp <= 6) || !CAP_TIMES.includes(tm)) throw new GameError('Неверные параметры стола');
      if (ownCount(CAP) >= 3) throw new GameError('Можно создать не больше 3 столов');
      const clean = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 24) || `Капитал у ${socket.data.name}`;
      const t = CAP.make({ name: clean, stake: st, maxPlayers: mp, timeLimitMin: tm, createdBy: userId, private: !!priv });
      if (t.private) schedulePrivate(t);
      return { tableId: t.id };
    });
    on('cap:ready', ({ tableId, value }) => { CAP.get(tableId).setReady(userId, !!value); });
    on('cap:roll', ({ tableId }) => { CAP.get(tableId).roll(userId); });
    on('cap:buy', ({ tableId }) => { CAP.get(tableId).buy(userId); });
    on('cap:decline', ({ tableId }) => { CAP.get(tableId).decline(userId); });
    on('cap:bail', ({ tableId }) => { CAP.get(tableId).payBail(userId); });
    on('cap:build', ({ tableId, cell }) => { CAP.get(tableId).build(userId, Number(cell)); });
    on('cap:sell', ({ tableId, cell }) => { CAP.get(tableId).sell(userId, Number(cell)); });
    on('cap:mortgage', ({ tableId, cell }) => { CAP.get(tableId).mortgage(userId, Number(cell)); });
    on('cap:end', ({ tableId }) => { CAP.get(tableId).endTurn(userId); });
    on('cap:trade', ({ tableId, offer }) => { CAP.get(tableId).offerTrade(userId, offer || {}); });
    on('cap:tradeAnswer', ({ tableId, accept }) => { CAP.get(tableId).answerTrade(userId, !!accept); });
    on('cap:resign', ({ tableId }) => { CAP.get(tableId).resign(userId); });
    // ----- Мафия -----
    on('mf:create', ({ name, stake, maxPlayers, private: priv }) => {
      if (MF.map.size >= MAX_TABLES) throw new GameError('Слишком много столов');
      const st = Number(stake);
      const mp = Number(maxPlayers);
      if (!MF_STAKES.includes(st) || !(mp >= 5 && mp <= 10)) throw new GameError('Неверные параметры стола');
      if (ownCount(MF) >= 3) throw new GameError('Можно создать не больше 3 столов');
      const clean = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 24) || `Мафия у ${socket.data.name}`;
      const t = MF.make({ name: clean, stake: st, maxPlayers: mp, createdBy: userId, private: !!priv });
      if (t.private) schedulePrivate(t);
      return { tableId: t.id };
    });
    on('mf:ready', ({ tableId, value }) => { MF.get(tableId).setReady(userId, !!value); });
    on('mf:night', ({ tableId, kind, target }) => { MF.get(tableId).nightAction(userId, String(kind), target); });
    on('mf:readyVote', ({ tableId }) => { MF.get(tableId).readyToVote(userId); });
    on('mf:vote', ({ tableId, target }) => { MF.get(tableId).vote(userId, target); });
    on('ck:move', ({ tableId, path }) => { CK.get(tableId).move(userId, Array.isArray(path) ? path.slice(0, 20).map(Number) : []); });
    on('ck:resign', ({ tableId }) => { CK.get(tableId).resign(userId); });
    on('ck:draw', ({ tableId }) => { CK.get(tableId).offerDraw(userId); });
    on('ck:declineDraw', ({ tableId }) => { CK.get(tableId).declineDraw(userId); });

    on('table:chat', ({ tableId, text }) => {
      const t = getTable(tableId);
      const clean = chatText(text);
      if (clean) t.addChat(socket.data.name, clean, hueOf(userId));
    });


    // ----- admin -----
    const admin = (event, handler) => on(event, (payload) => {
      if (!store.isAdmin(userId)) throw new GameError('Нет прав администратора');
      return handler(payload);
    });
    const audit = (text) => store.logAdmin(socket.data.name, text);
    const int = (v, min, max, label) => {
      const n = Math.floor(Number(v));
      if (!Number.isFinite(n) || n < min || n > max) throw new GameError(`${label}: от ${min} до ${max}`);
      return n;
    };

    admin('admin:overview', () => {
      const online = new Set();
      for (const sock of io.sockets.sockets.values()) online.add(sock.data.userId);
      const users = store.listUsers().map((u) => ({ ...u, online: online.has(u.id) }));
      const cash = [...tables.values()].filter((t) => !t.tournament);
      return {
        me: userId,
        stats: {
          online: online.size,
          users: users.length,
          balances: users.reduce((a, u) => a + u.balance, 0),
          inPlay: users.reduce((a, u) => a + u.inPlay, 0),
          cashTables: cash.length,
          activeHands: [...tables.values()].filter((t) => t.hand && !t.hand.ended).length,
          sngRunning: [...sngs.values()].filter((x) => x.status === 'running').length,
          sngRegistering: [...sngs.values()].filter((x) => x.status === 'registering').reduce((a, x) => a + x.players.length, 0),
          durakTables: durakTables.size,
          durakGames: [...durakTables.values()].filter((t) => t.status === 'playing').length,
          bjTables: bjTables.size,
          bjPlayers: [...bjTables.values()].reduce((a, t) => a + t.playerCount(), 0),
          uptimeMs: Date.now() - STARTED_AT,
          memoryMb: Math.round(process.memoryUsage().rss / 1048576),
        },
        users,
        cash: cash.map((t) => ({
          ...t.summary(), handNo: t.handNo, inHand: !!(t.hand && !t.hand.ended), chat: t.chat.length,
          seats: t.seats.map((x) => x && { userId: x.userId, name: x.name, stack: x.stack, sittingOut: x.sittingOut, connected: x.connected }),
        })),
        sngs: [...sngs.values()].map((x) => x.summary()),
        templates: allTemplates().map((x) => ({ ...x })),
        durak: [...durakTables.values()].map((t) => ({
          ...t.summary(), gameNo: t.gameNo, pot: t.pot, chat: t.chat.length,
          seats: t.seats.map((x) => x && { userId: x.userId, name: x.name, ready: x.ready, connected: x.connected }),
        })),
        bj: [...bjTables.values()].map((t) => ({
          ...t.summary(), roundNo: t.roundNo, chat: t.chat.length,
          seats: t.seats.map((x) => x && { userId: x.userId, name: x.name, bet: x.bet, connected: x.connected }),
        })),
        extra: extraTables().map((t) => ({
          ...t.summary(), title: extra[t.kind].title, chat: t.chat.length,
          seats: t.seats.map((x) => x && { userId: x.userId, name: x.name, connected: x.connected }),
        })),
        announcement: store.data.announcement,
        log: store.data.adminLog.slice(-100).reverse(),
        options: {
          stakes: STAKES, seats: SEAT_OPTIONS, blindEvery: BLIND_EVERY_OPTIONS, durakStakes: DURAK_STAKES, bjLimits: BJ_LIMITS,
          games: Object.fromEntries(Object.entries(GAMES).map(([k, g]) => [k, g.name])),
          gameSeats: Object.fromEntries(Object.entries(GAMES).map(([k, g]) => [k, g.maxSeats])),
        },
      };
    });

    admin('admin:user', ({ userId: target, action, amount }) => {
      const u = store.findUser(String(target));
      switch (action) {
        case 'chips': {
          const real = store.adjustBalance(u.id, int(amount, -1e9, 1e9, 'Сумма'));
          pushProfile(u.id);
          notice(u.id, real > 0 ? `Администратор начислил вам ${real} фишек` : `Администратор списал ${-real} фишек`);
          audit(`${real > 0 ? 'Начислил' : 'Списал'} ${Math.abs(real)} фишек: ${u.name}`);
          return { real };
        }
        case 'ban':
          if (u.id === userId) throw new GameError('Нельзя заблокировать себя');
          removeEverywhere(u.id);
          store.setBanned(u.id, true);
          notice(u.id, 'Ваш аккаунт заблокирован администратором');
          io.in('user:' + u.id).disconnectSockets(true);
          audit(`Заблокировал ${u.name}`);
          break;
        case 'unban': store.setBanned(u.id, false); audit(`Разблокировал ${u.name}`); break;
        case 'mute': store.setMuted(u.id, true); pushProfile(u.id); audit(`Запретил чат: ${u.name}`); break;
        case 'unmute': store.setMuted(u.id, false); pushProfile(u.id); audit(`Разрешил чат: ${u.name}`); break;
        case 'resetPassword': {
          const password = store.resetPassword(u.id);
          io.in('user:' + u.id).disconnectSockets(true);
          audit(`Сбросил пароль: ${u.name}`);
          return { password };
        }
        case 'makeAdmin': store.setRole(u.id, 'admin'); pushProfile(u.id); audit(`Назначил админом: ${u.name}`); break;
        case 'removeAdmin':
          if (u.id === userId) throw new GameError('Нельзя снять права с себя');
          store.setRole(u.id, 'player'); pushProfile(u.id); audit(`Снял права админа: ${u.name}`); break;
        default: throw new GameError('Неизвестное действие');
      }
    });

    admin('admin:table', ({ tableId, action, sb, bb, every, target }) => {
      const t = getTable(tableId);
      switch (action) {
        case 'close':
          if (t.tournament) throw new GameError('Турнирный стол закрывается отменой турнира');
          io.to('table:' + t.id).emit('notice', { type: 'closed', tableId: t.id, text: `Стол «${t.name}» закрыт администратором, фишки возвращены` });
          t.destroy();
          tables.delete(t.id);
          broadcastLobby();
          audit(`Закрыл стол «${t.name}»`);
          break;
        case 'blinds': {
          const nsb = int(sb, 1, 1e6, 'Малый блайнд');
          const nbb = int(bb, nsb, 2e6, 'Большой блайнд');
          t.setBlinds(nsb, nbb);
          t.onUpdate(t);
          audit(`Блайнды ${nsb}/${nbb} со следующей раздачи: «${t.name}»`);
          break;
        }
        case 'schedule':
          t.setSchedule(int(every, 0, 100, 'Раздач на уровень'));
          t.onUpdate(t);
          audit(`Рост блайндов ${Number(every) ? `каждые ${every} раздач` : 'выключен'}: «${t.name}»`);
          break;
        case 'kick': {
          if (t.tournament) throw new GameError('Из турнира выгнать нельзя');
          const name = (store.get(target) || {}).name || '?';
          t.standUp(String(target));
          notice(String(target), `Администратор убрал вас из-за стола «${t.name}»`);
          audit(`Убрал ${name} из-за стола «${t.name}»`);
          break;
        }
        case 'clearChat': t.chat = []; t.onUpdate(t); audit(`Очистил чат стола «${t.name}»`); break;
        case 'permanent': t.permanent = !t.permanent; audit(`${t.permanent ? 'Закрепил' : 'Открепил'} стол «${t.name}»`); break;
        default: throw new GameError('Неизвестное действие');
      }
    });

    admin('admin:createTable', ({ name, game, stakes, seats, blindsEvery, permanent }) => {
      const st = STAKES[Number(stakes)];
      const maxSeats = Number(seats);
      if (!st || !SEAT_OPTIONS.includes(maxSeats)) throw new GameError('Неверные параметры стола');
      const clean = String(name || '').trim().slice(0, 24) || 'Новый стол';
      const t = makeTable({
        name: clean, game: gameOf(game), sb: st[0], bb: st[1], maxSeats: Math.min(maxSeats, GAMES[gameOf(game)].maxSeats),
        blindsEvery: BLIND_EVERY_OPTIONS.includes(Number(blindsEvery)) ? Number(blindsEvery) : 0, permanent: !!permanent,
      });
      audit(`Создал стол «${clean}» (${st[0]}/${st[1]}${permanent ? ', постоянный' : ''})`);
      return { tableId: t.id };
    });

    admin('admin:sng', ({ sngId, action }) => {
      const x = getSng(sngId);
      if (action === 'start') {
        x.forceStart();
        audit(`Запустил турнир «${x.name}» (${x.entrants} игроков)`);
        return;
      }
      if (action !== 'cancel') throw new GameError('Неизвестное действие');
      if (x.status === 'finished' || x.status === 'cancelled') throw new GameError('Турнир уже завершён');
      const wasRegistering = x.status === 'registering';
      const players = x.players.map((p) => p.userId);
      x.shutdown();
      if (x.table && tables.has(x.table.id)) {
        io.to('table:' + x.table.id).emit('notice', { type: 'closed', tableId: x.table.id, text: `Турнир «${x.name}» отменён администратором` });
        x.table.destroy();
        tables.delete(x.table.id);
      }
      sngs.delete(x.id);
      for (const u of players) { pushProfile(u); notice(u, wasRegistering ? `Турнир «${x.name}» отменён, бай-ин возвращён` : `Турнир «${x.name}» отменён, призовой фонд разделён по фишкам`); }
      if (wasRegistering && x.tpl.owner) releaseOwned(x.tpl, true);
      else if (wasRegistering && !(x.tpl.custom && !x.tpl.recurring) && !x.tpl.startAt) spawnSng(tplById(x.templateId));
      else if (wasRegistering) next(x);
      broadcastSngs();
      audit(`Отменил турнир «${x.name}»`);
    });

    admin('admin:sngSpawn', ({ templateId }) => {
      const tpl = tplById(templateId);
      if (!tpl) throw new GameError('Нет такого формата');
      if (tpl.startAt && tpl.startAt <= Date.now() + 30000) throw new GameError('Время старта этого турнира прошло — создайте новый');
      tpl.spent = false;
      spawnSng(tpl);
      audit(`Открыл регистрацию: «${tpl.name}»`);
    });

    admin('admin:sngCreate', (raw) => {
      const v = validateTemplate(raw || {});
      if (store.data.sngTemplates.length >= 50) throw new GameError('Слишком много своих турниров — удалите старые');
      const tpl = { id: 'c' + crypto.randomBytes(4).toString('hex'), custom: true, createdAt: Date.now(), ...v };
      store.data.sngTemplates.push(tpl);
      store.save();
      const sng = spawnSng(tpl);
      audit(`Создал турнир «${tpl.name}»: ${GAMES[tpl.game].name}, ${tpl.seats} мест, бай-ин ${tpl.buyIn}${tpl.guarantee ? `, гарантия ${tpl.guarantee}` : ''}${tpl.startAt ? `, старт ${new Date(tpl.startAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} МСК` : ''}`);
      return { sngId: sng.id, templateId: tpl.id };
    });

    admin('admin:sngTemplateDelete', ({ templateId }) => {
      const idx = store.data.sngTemplates.findIndex((t) => t.id === templateId);
      if (idx === -1) throw new GameError('Можно удалять только свои турниры');
      const [tpl] = store.data.sngTemplates.splice(idx, 1);
      store.save();
      // registration still open: refund and close it
      for (const x of [...sngs.values()]) {
        if (x.templateId === tpl.id && x.status === 'registering') {
          const players = x.players.map((p) => p.userId);
          x.cancel(`Турнир «${x.name}» отменён администратором, бай-ин возвращён`);
          players.forEach(pushProfile);
          sngs.delete(x.id);
        }
      }
      broadcastSngs();
      audit(`Удалил турнир «${tpl.name}»`);
    });

    admin('admin:durak', ({ tableId, action, target }) => {
      const t = getDurak(tableId);
      switch (action) {
        case 'close':
          io.to('durak:' + t.id).emit('notice', { type: 'closed', tableId: t.id, text: `Стол «${t.name}» закрыт администратором, ставки возвращены` });
          t.destroy();
          durakTables.delete(t.id);
          broadcastDurakLobby();
          audit(`Закрыл стол дурака «${t.name}»`);
          break;
        case 'kick': {
          const name = (store.get(target) || {}).name || '?';
          t.leave(String(target));
          notice(String(target), `Администратор убрал вас из-за стола «${t.name}»`);
          audit(`Убрал ${name} из-за стола дурака «${t.name}»`);
          break;
        }
        case 'clearChat': t.chat = []; t._update(); audit(`Очистил чат стола дурака «${t.name}»`); break;
        default: throw new GameError('Неизвестное действие');
      }
    });

    admin('admin:createDurak', ({ name, variant, stake, maxPlayers, permanent }) => {
      const st = Number(stake);
      const mp = Number(maxPlayers);
      if (!DURAK_STAKES.includes(st) || !(mp >= 2 && mp <= 6)) throw new GameError('Неверные параметры стола');
      const clean = String(name || '').trim().slice(0, 24) || 'Дурак';
      const t = makeDurak({ name: clean, variant, stake: st, maxPlayers: mp, permanent: !!permanent });
      audit(`Создал стол дурака «${clean}» (ставка ${st})`);
      return { tableId: t.id };
    });

    admin('admin:extra', ({ kind, tableId, action, target }) => {
      const K = extra[kind];
      if (!K) throw new GameError('Нет такой игры');
      const t = K.get(tableId);
      switch (action) {
        case 'close':
          io.to(kind + ':' + t.id).emit('notice', { type: 'closed', tableId: t.id, text: `Стол «${t.name}» закрыт администратором, ставки возвращены` });
          t.destroy();
          K.map.delete(t.id);
          K.broadcastLobby();
          audit(`Закрыл стол «${t.name}» (${K.title})`);
          break;
        case 'kick': {
          const s = t.seats.find((x) => x && x.userId === target);
          if (!s) throw new GameError('Игрока нет за столом');
          t.leave(s.userId);
          notice(s.userId, `Администратор убрал вас со стола «${t.name}»`);
          audit(`Убрал ${s.name} со стола «${t.name}» (${K.title})`);
          break;
        }
        case 'clearChat': t.chat = []; t._update(); audit(`Очистил чат стола «${t.name}» (${K.title})`); break;
        default: throw new GameError('Неизвестное действие');
      }
    });

    admin('admin:bj', ({ tableId, action, target }) => {
      const t = getBj(tableId);
      switch (action) {
        case 'close':
          io.to('bj:' + t.id).emit('notice', { type: 'closed', tableId: t.id, text: `Стол «${t.name}» закрыт администратором, ставки возвращены` });
          t.destroy();
          bjTables.delete(t.id);
          broadcastBjLobby();
          audit(`Закрыл стол блэкджека «${t.name}»`);
          break;
        case 'kick': {
          const name = (store.get(target) || {}).name || '?';
          t.leave(String(target));
          notice(String(target), `Администратор убрал вас из-за стола «${t.name}»`);
          audit(`Убрал ${name} из-за стола блэкджека «${t.name}»`);
          break;
        }
        case 'clearChat': t.chat = []; t._update(); audit(`Очистил чат стола блэкджека «${t.name}»`); break;
        default: throw new GameError('Неизвестное действие');
      }
    });

    admin('admin:createBj', ({ name, limits, permanent }) => {
      const lim = BJ_LIMITS[Number(limits)];
      if (!lim) throw new GameError('Неверные лимиты');
      const clean = String(name || '').trim().slice(0, 24) || 'Блэкджек';
      const t = makeBj({ name: clean, minBet: lim[0], maxBet: lim[1], permanent: !!permanent });
      audit(`Создал стол блэкджека «${clean}» (${lim[0]}–${lim[1]})`);
      return { tableId: t.id };
    });

    admin('admin:announce', ({ text }) => {
      const a = store.setAnnouncement(text);
      io.emit('announce', a);
      audit(a ? `Объявление: «${a.text}»` : 'Убрал объявление');
    });

    socket.on('disconnect', () => {
      const room = io.sockets.adapter.rooms.get('user:' + userId);
      if (room && room.size > 0) return; // another tab is still open
      presenceChanged(userId);
      const seated = allTables().filter((t) => t.seatOf(userId) !== -1);
      if (!seated.length) return;
      seated.forEach((t) => t.setConnected(userId, false));
      disconnectTimers.set(userId, setTimeout(() => {
        disconnectTimers.delete(userId);
        for (const t of tables.values()) {
          // tournament seats stay: the player is auto-folded until back
          if (t.seatOf(userId) !== -1 && !t.tournament) t.standUp(userId);
        }
        for (const t of durakTables.values()) if (t.seatOf(userId) !== -1) t.leave(userId);
        for (const t of bjTables.values()) if (t.seatOf(userId) !== -1) t.leave(userId);
        for (const t of extraTables()) if (t.seatOf(userId) !== -1) t.leave(userId);
        for (const t of allTables()) if (t.practice && !humansAt(t)) dropPractice(t);
      }, RECONNECT_GRACE));
    });
  });

  function shutdown() {
    clearInterval(cleanup);
    voice.stop();
    for (const t of allTables()) if (t.bots) t.bots.stop();
    for (const x of sngs.values()) x.shutdown();
    for (const t of tables.values()) t.destroy();
    for (const t of durakTables.values()) t.destroy();
    for (const t of bjTables.values()) t.destroy();
    for (const t of extraTables()) t.destroy();
    for (const timer of disconnectTimers.values()) clearTimeout(timer);
    const done = store.flush();
    io.close();
    server.close();
    return done;
  }

  return { app, server, io, store, tables, sngs, durakTables, bjTables, extra, shutdown };
}

/** Production start: PostgreSQL when DATABASE_URL is set, otherwise the JSON file. */
async function start() {
  let store = null;
  let backend = null;
  const url = process.env.DATABASE_URL;
  if (url) {
    const { PgBackend } = require('./persist');
    backend = PgBackend.fromUrl(url);
    const data = await backend.load();
    store = new Store(null, { adminNames: ADMIN_NAMES, backend, initialData: data });
    await store.flush();
    console.log(`База данных: PostgreSQL, игроков — ${Object.keys(store.data.users).length}`);
  } else {
    console.log(`База данных: файл ${DATA_FILE}`);
  }
  const { server, shutdown } = createServer({ store });
  server.listen(PORT, () => console.log(`NOIR RIVER Poker: http://localhost:${PORT}`));
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    console.log('\nОстанавливаю сервер, возвращаю фишки на балансы…');
    const force = setTimeout(() => process.exit(1), 8000);
    try { await shutdown(); if (backend) await backend.close(); } catch (e) { console.error(e); }
    clearTimeout(force);
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (require.main === module) {
  start().catch((e) => { console.error('Не удалось запустить сервер:', e.message); process.exit(1); });
}

module.exports = { createServer };
