'use strict';
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const { Table, GameError } = require('./engine/table');
const { Store, StoreError } = require('./store');
const { SitAndGo, TEMPLATES } = require('./tournament');

const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'users.json');
const ACTION_TIME = Number(process.env.ACTION_TIME_MS) || 25000;
const RECONNECT_GRACE = Number(process.env.RECONNECT_GRACE_MS) || 90000;
const MAX_TABLES = 60;

const STAKES = [[1, 2], [5, 10], [10, 20], [25, 50], [50, 100], [100, 200], [500, 1000]];
const SEAT_OPTIONS = [2, 6, 9];

function createServer({
  dataFile = DATA_FILE, actionTime = ACTION_TIME, tableOpts = {},
  sngTemplates = TEMPLATES, levelMs = Number(process.env.SNG_LEVEL_MS) || 0, sngLinger = 120000,
} = {}) {
  const store = new Store(dataFile);
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
    levelMs,
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
  }, 60000);

  // --- sockets ---
  io.use((socket, next) => {
    const user = store.userByToken(socket.handshake.auth?.token);
    if (!user) return next(new Error('unauthorized'));
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
      sngs: sngList(),
      leaderboard: store.leaderboard(),
    }));

    on('bonus:claim', () => {
      const amount = store.claimBonus(userId);
      pushProfile(userId);
      return { amount };
    });

    on('table:create', ({ name, game, stakes, seats }) => {
      if (tables.size >= MAX_TABLES) throw new GameError('Слишком много столов, попробуйте позже');
      const st = STAKES[Number(stakes)];
      const maxSeats = Number(seats);
      if (!st || !SEAT_OPTIONS.includes(maxSeats)) throw new GameError('Неверные параметры стола');
      const own = [...tables.values()].filter((t) => t.createdBy === userId).length;
      if (own >= 3) throw new GameError('Можно создать не больше 3 столов');
      const clean = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 24) || `Стол ${socket.data.name}`;
      const t = makeTable({ name: clean, game: game === 'PLO' ? 'PLO' : 'NLH', sb: st[0], bb: st[1], maxSeats, createdBy: userId });
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

    on('table:chat', ({ tableId, text }) => {
      const t = getTable(tableId);
      const now = Date.now();
      if (now - lastChat < 800) throw new GameError('Не так быстро');
      const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (!clean) return;
      lastChat = now;
      t.addChat(socket.data.name, clean);
    });

    socket.on('disconnect', () => {
      const room = io.sockets.adapter.rooms.get('user:' + userId);
      if (room && room.size > 0) return; // another tab is still open
      const seated = [...tables.values()].filter((t) => t.seatOf(userId) !== -1);
      if (!seated.length) return;
      seated.forEach((t) => t.setConnected(userId, false));
      disconnectTimers.set(userId, setTimeout(() => {
        disconnectTimers.delete(userId);
        for (const t of tables.values()) {
          // tournament seats stay: the player is auto-folded until back
          if (t.seatOf(userId) !== -1 && !t.tournament) t.standUp(userId);
        }
      }, RECONNECT_GRACE));
    });
  });

  function shutdown() {
    clearInterval(cleanup);
    for (const x of sngs.values()) x.shutdown();
    for (const t of tables.values()) t.destroy();
    for (const timer of disconnectTimers.values()) clearTimeout(timer);
    store.saveNow();
    io.close();
    server.close();
  }

  return { app, server, io, store, tables, sngs, shutdown };
}

if (require.main === module) {
  const { server, shutdown } = createServer();
  server.listen(PORT, () => console.log(`NOIR RIVER Poker: http://localhost:${PORT}`));
  const stop = () => { console.log('\nОстанавливаю сервер, возвращаю фишки на балансы…'); shutdown(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

module.exports = { createServer };
