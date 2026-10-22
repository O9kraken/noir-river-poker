'use strict';
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const { Table, GameError } = require('./engine/table');
const { Store, StoreError } = require('./store');
const { SitAndGo, TEMPLATES } = require('./tournament');
const { DurakTable } = require('./durak/table');
const { BlackjackTable } = require('./blackjack/table');

const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'users.json');
const ACTION_TIME = Number(process.env.ACTION_TIME_MS) || 25000;
const RECONNECT_GRACE = Number(process.env.RECONNECT_GRACE_MS) || 90000;
const MAX_TABLES = 60;

const STAKES = [[1, 2], [5, 10], [10, 20], [25, 50], [50, 100], [100, 200], [500, 1000]];
const SEAT_OPTIONS = [2, 6, 9];
const BLIND_EVERY_OPTIONS = [0, 3, 5, 10];
const DURAK_STAKES = [50, 100, 250, 500, 1000, 5000];
const ADMIN_NAMES = (process.env.ADMIN_NAMES || '').split(',').map((x) => x.trim()).filter(Boolean);
const STARTED_AT = Date.now();

function createServer({
  dataFile = DATA_FILE, actionTime = ACTION_TIME, tableOpts = {},
  sngTemplates = TEMPLATES, levelHands = Number(process.env.SNG_LEVEL_HANDS) || 0, sngLinger = 120000,
  durakOpts = {}, bjOpts = {}, adminNames = ADMIN_NAMES,
} = {}) {
  const store = new Store(dataFile, { adminNames });
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { maxHttpBufferSize: 1e5 });

  app.disable('x-powered-by');
  // Real client IP from X-Forwarded-For: nginx on the same machine by default,
  // TRUST_PROXY=true on platforms like Render where the proxy is remote.
  const tp = process.env.TRUST_PROXY;
  app.set('trust proxy', tp === 'true' ? true : tp && !Number.isNaN(Number(tp)) ? Number(tp) : 'loopback');
  app.use(express.json({ limit: '10kb' }));
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    next();
  });
  const pub = path.join(__dirname, '..', 'public');
  app.use(express.static(pub, { extensions: ['html'] }));
  app.get('/play', (req, res) => res.sendFile(path.join(pub, 'play.html')));
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
  function authError(res, e) {
    if (e instanceof StoreError) return res.status(400).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }

  // --- tables ---
  const tables = new Map();
  const disconnectTimers = new Map(); // userId -> timer

  function makeTable(cfg, extra = {}) {
    const id = cfg.id || crypto.randomBytes(4).toString('hex');
    const tourney = !!extra.tournament;
    const table = new Table({ ...cfg, id }, {
      actionTime,
      ...tableOpts,
      ...extra,
      onUpdate: (t) => scheduleBroadcast(t),
      // tournament chips are not real chips: they never go back to balances
      onLeave: tourney ? () => {} : (userId, stack) => {
        store.deposit(userId, stack);
        store.setInPlay(userId, id, 0);
        pushProfile(userId);
        broadcastLobby();
      },
      onHandEnd: (t) => {
        if (!tourney) for (const s of t.seats) if (s) store.setInPlay(s.userId, id, s.stack);
        if (t.lastResult) {
          for (const p of t.lastResult.players) {
            const s = t.seats[p.seat];
            if (s && p.won > 0) store.recordWin(s.userId, p.won);
          }
        }
      },
    });
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
    });
  }

  let lobbyPending = false;
  function lobbyList() {
    return [...tables.values()].filter((t) => !t.tournament).map((t) => t.summary());
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
    notify: (userId, event, payload) => { io.to('user:' + userId).emit(event, payload); pushProfile(userId); },
    onChange: () => broadcastSngs(),
    onStarted: (sng) => spawnSng(sngTemplates.find((t) => t.id === sng.templateId)), // keep registration open
    onFinished: (sng) => {
      setTimeout(() => {
        sngs.delete(sng.id);
        const t = tables.get(sng.table.id);
        if (t) { t.destroy(); tables.delete(t.id); }
        broadcastSngs();
      }, sngLinger).unref();
    },
  };
  function spawnSng(tpl) {
    if (!tpl) return;
    const sng = new SitAndGo(tpl, sngDeps);
    sngs.set(sng.id, sng);
    broadcastSngs();
    return sng;
  }
  sngTemplates.forEach(spawnSng);
  function sngList() {
    const order = { running: 0, registering: 1, finished: 2 };
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
    const id = cfg.id || 'd' + crypto.randomBytes(4).toString('hex');
    const key = 'durak:' + id;
    const t = new DurakTable({ ...cfg, id }, {
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
      },
    }, durakOpts);
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
  function durakList() { return [...durakTables.values()].map((t) => t.summary()); }
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
    const id = cfg.id || 'bj' + crypto.randomBytes(4).toString('hex');
    const key = 'bj:' + id;
    const t = new BlackjackTable({ ...cfg, id }, {
      charge: (u, a) => { try { store.withdraw(u, a); } catch (e) { return false; } pushProfile(u); return true; },
      pay: (u, a) => { if (!u || !a) return; store.deposit(u, a); pushProfile(u); },
      onInPlay: (u, a) => { store.setInPlay(u, key, a); },
      onUpdate: (tt) => scheduleBjBroadcast(tt),
    }, bjOpts);
    bjTables.set(id, t);
    broadcastBjLobby();
    return t;
  }
  function getBj(id) {
    const t = bjTables.get(String(id));
    if (!t) throw new GameError('Стол не найден');
    return t;
  }
  function bjList() { return [...bjTables.values()].map((t) => t.summary()); }
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
    });
  }
  function broadcastBjLobby() {
    if (bjLobbyPending) return;
    bjLobbyPending = true;
    setTimeout(() => { bjLobbyPending = false; io.to('lobby').emit('lobby:bj', bjList()); }, 250);
  }
  BJ_DEFAULTS.forEach((d) => makeBj({ ...d, permanent: true }));

  // remove idle player-created tables
  const cleanup = setInterval(() => {
    const now = Date.now();
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
  }, 60000);

  /** Take a player off every table and out of pending registrations (ban / admin kick). */
  function removeEverywhere(target) {
    for (const t of tables.values()) {
      if (!t.tournament && t.seatOf(target) !== -1) t.standUp(target);
    }
    for (const t of durakTables.values()) if (t.seatOf(target) !== -1) t.leave(target);
    for (const t of bjTables.values()) if (t.seatOf(target) !== -1) t.leave(target);
    for (const x of sngs.values()) {
      if (x.status === 'registering' && x.players.some((p) => p.userId === target)) x.unregister(target);
    }
  }
  function notice(userId, text, extra = {}) { io.to('user:' + userId).emit('notice', { text, ...extra }); }

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

    on('hello', () => ({
      me: store.profile(userId),
      tables: lobbyList(),
      myTables: [...tables.values()].filter((t) => t.seatOf(userId) !== -1).map((t) => t.id),
      stakes: STAKES,
      seatOptions: SEAT_OPTIONS,
      blindEveryOptions: BLIND_EVERY_OPTIONS,
      sngs: sngList(),
      durak: durakList(),
      myDurak: [...durakTables.values()].filter((t) => t.seatOf(userId) !== -1).map((t) => t.id),
      durakStakes: DURAK_STAKES,
      bj: bjList(),
      myBj: [...bjTables.values()].filter((t) => t.seatOf(userId) !== -1).map((t) => t.id),
      announcement: store.data.announcement,
      leaderboard: store.leaderboard(),
    }));

    on('bonus:claim', () => {
      const amount = store.claimBonus(userId);
      pushProfile(userId);
      return { amount };
    });

    on('table:create', ({ name, game, stakes, seats, blindsEvery }) => {
      if (tables.size >= MAX_TABLES) throw new GameError('Слишком много столов, попробуйте позже');
      const st = STAKES[Number(stakes)];
      const maxSeats = Number(seats);
      if (!st || !SEAT_OPTIONS.includes(maxSeats)) throw new GameError('Неверные параметры стола');
      const own = [...tables.values()].filter((t) => t.createdBy === userId).length;
      if (own >= 3) throw new GameError('Можно создать не больше 3 столов');
      const clean = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 24) || `Стол ${socket.data.name}`;
      const every = BLIND_EVERY_OPTIONS.includes(Number(blindsEvery)) ? Number(blindsEvery) : 0;
      const t = makeTable({ name: clean, game: game === 'PLO' ? 'PLO' : 'NLH', sb: st[0], bb: st[1], maxSeats, createdBy: userId, blindsEvery: every });
      return { tableId: t.id };
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
      const t = getTable(tableId);
      buyIn = Math.floor(Number(buyIn));
      seat = Math.floor(Number(seat));
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
      getTable(tableId).standUp(userId);
    });

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
    on('durak:create', ({ name, variant, stake, maxPlayers }) => {
      if (durakTables.size >= MAX_TABLES) throw new GameError('Слишком много столов');
      const st = Number(stake);
      const mp = Number(maxPlayers);
      if (!DURAK_STAKES.includes(st) || !(mp >= 2 && mp <= 6)) throw new GameError('Неверные параметры стола');
      const own = [...durakTables.values()].filter((t) => t.createdBy === userId).length;
      if (own >= 3) throw new GameError('Можно создать не больше 3 столов');
      const clean = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 24) || `Дурак у ${socket.data.name}`;
      const t = makeDurak({ name: clean, variant, stake: st, maxPlayers: mp, createdBy: userId });
      return { tableId: t.id };
    });
    on('durak:watch', ({ tableId }) => {
      const t = getDurak(tableId);
      socket.join('durak:' + t.id);
      return { state: t.publicState(userId) };
    });
    on('durak:unwatch', ({ tableId }) => { socket.leave('durak:' + String(tableId)); });
    on('durak:sit', ({ tableId, seat }) => {
      const t = getDurak(tableId);
      t.sit(userId, socket.data.name, Math.floor(Number(seat)));
      socket.join('durak:' + t.id);
    });
    on('durak:leave', ({ tableId }) => { getDurak(tableId).leave(userId); });
    on('durak:ready', ({ tableId, value }) => { getDurak(tableId).setReady(userId, !!value); });
    on('durak:act', ({ tableId, type, card, index }) => {
      if (!['attack', 'defend', 'transfer', 'take', 'pass'].includes(type)) throw new GameError('Неизвестное действие');
      getDurak(tableId).act(userId, type, card, index);
    });
    on('durak:chat', ({ tableId, text }) => {
      const t = getDurak(tableId);
      const clean = chatText(text);
      if (clean) t.addChat(socket.data.name, clean);
    });

    // ----- blackjack -----
    on('bj:watch', ({ tableId }) => {
      const t = getBj(tableId);
      socket.join('bj:' + t.id);
      return { state: t.publicState(userId) };
    });
    on('bj:unwatch', ({ tableId }) => { socket.leave('bj:' + String(tableId)); });
    on('bj:sit', ({ tableId, seat }) => {
      const t = getBj(tableId);
      t.sit(userId, socket.data.name, Math.floor(Number(seat)));
      socket.join('bj:' + t.id);
    });
    on('bj:leave', ({ tableId }) => { getBj(tableId).leave(userId); });
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
      if (clean) t.addChat(socket.data.name, clean);
    });

    on('table:chat', ({ tableId, text }) => {
      const t = getTable(tableId);
      const clean = chatText(text);
      if (clean) t.addChat(socket.data.name, clean);
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
        templates: sngTemplates.map((x) => ({ id: x.id, name: x.name })),
        durak: [...durakTables.values()].map((t) => ({
          ...t.summary(), gameNo: t.gameNo, pot: t.pot, chat: t.chat.length,
          seats: t.seats.map((x) => x && { userId: x.userId, name: x.name, ready: x.ready, connected: x.connected }),
        })),
        bj: [...bjTables.values()].map((t) => ({
          ...t.summary(), roundNo: t.roundNo, chat: t.chat.length,
          seats: t.seats.map((x) => x && { userId: x.userId, name: x.name, bet: x.bet, connected: x.connected }),
        })),
        announcement: store.data.announcement,
        log: store.data.adminLog.slice(-100).reverse(),
        options: { stakes: STAKES, seats: SEAT_OPTIONS, blindEvery: BLIND_EVERY_OPTIONS, durakStakes: DURAK_STAKES, bjLimits: BJ_LIMITS },
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
        name: clean, game: game === 'PLO' ? 'PLO' : 'NLH', sb: st[0], bb: st[1], maxSeats,
        blindsEvery: BLIND_EVERY_OPTIONS.includes(Number(blindsEvery)) ? Number(blindsEvery) : 0, permanent: !!permanent,
      });
      audit(`Создал стол «${clean}» (${st[0]}/${st[1]}${permanent ? ', постоянный' : ''})`);
      return { tableId: t.id };
    });

    admin('admin:sng', ({ sngId, action }) => {
      const x = getSng(sngId);
      if (action !== 'cancel') throw new GameError('Неизвестное действие');
      if (x.status === 'finished') throw new GameError('Турнир уже завершён');
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
      if (wasRegistering) spawnSng(sngTemplates.find((t) => t.id === x.templateId));
      broadcastSngs();
      audit(`Отменил турнир «${x.name}»`);
    });

    admin('admin:sngSpawn', ({ templateId }) => {
      const tpl = sngTemplates.find((t) => t.id === templateId);
      if (!tpl) throw new GameError('Нет такого формата');
      spawnSng(tpl);
      audit(`Открыл регистрацию: «${tpl.name}»`);
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
      const seated = [...tables.values(), ...durakTables.values(), ...bjTables.values()].filter((t) => t.seatOf(userId) !== -1);
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
      }, RECONNECT_GRACE));
    });
  });

  function shutdown() {
    clearInterval(cleanup);
    for (const x of sngs.values()) x.shutdown();
    for (const t of tables.values()) t.destroy();
    for (const t of durakTables.values()) t.destroy();
    for (const t of bjTables.values()) t.destroy();
    for (const timer of disconnectTimers.values()) clearTimeout(timer);
    store.saveNow();
    io.close();
    server.close();
  }

  return { app, server, io, store, tables, sngs, durakTables, bjTables, shutdown };
}

if (require.main === module) {
  const { server, shutdown } = createServer();
  server.listen(PORT, () => console.log(`NOIR RIVER Poker: http://localhost:${PORT}`));
  const stop = () => { console.log('\nОстанавливаю сервер, возвращаю фишки на балансы…'); shutdown(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

module.exports = { createServer };
