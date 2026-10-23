'use strict';
/**
 * Voice chat at the tables: the server only introduces the players to each other (WebRTC signalling);
 * the sound itself goes directly between browsers. Only seated players may join a table's voice.
 * Games with secrets (mafia) also get a policy: who may speak now and whom each player hears.
 */
const KINDS = /^(table|durak|bj|rl|ck|ch|cap|mf|bg|pt)$/;
const MAX_PEERS = 10;

const STUN = { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] };
let fetched = { at: 0, list: null };

/**
 * Where browsers look for a route to each other. STUN is enough on most home networks;
 * strict mobile and office networks need a TURN relay:
 *  - TURN_URL / TURN_USER / TURN_PASS — your own relay (coturn) or any provider's static credentials;
 *  - METERED_TURN_URL — a credentials link like https://APP.metered.live/api/v1/turn/credentials?apiKey=KEY
 *    (Metered's free plan); the list is fetched and kept for an hour.
 */
function iceServers() {
  const list = [STUN];
  if (process.env.TURN_URL) {
    list.push({ urls: process.env.TURN_URL.split(',').map((x) => x.trim()), username: process.env.TURN_USER || '', credential: process.env.TURN_PASS || '' });
  }
  if (fetched.list) list.push(...fetched.list);
  return list;
}
async function refreshTurn() {
  const url = process.env.METERED_TURN_URL;
  if (!url || Date.now() - fetched.at < 3600 * 1000) return;
  fetched.at = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    if (Array.isArray(data) && data.length) fetched.list = data.filter((x) => x && x.urls);
  } catch (e) { fetched.at = Date.now() - 3300 * 1000; /* try again in five minutes */ }
}
const hasTurn = () => !!(process.env.TURN_URL || fetched.list);

function createVoice(io, { findTable, nameOf, avatarOf }) {
  const rooms = new Map(); // key -> Map(socketId -> { userId, name, muted })
  const lastPolicy = new Map(); // socketId -> json

  const roomOf = (sid) => { for (const [key, m] of rooms) if (m.has(sid)) return key; return null; };
  const list = (key) => [...(rooms.get(key) || new Map())].map(([sid, p]) => ({ sid, userId: p.userId, name: p.name, avatar: avatarOf(p.userId), muted: p.muted }));

  function leave(sid, why) {
    const key = roomOf(sid);
    if (!key) return;
    const m = rooms.get(key);
    m.delete(sid);
    lastPolicy.delete(sid);
    if (!m.size) rooms.delete(key);
    for (const other of m.keys()) io.to(other).emit('voice:left', { sid });
    if (why) io.to(sid).emit('voice:kicked', { reason: why });
  }

  function policyFor(key, userId) {
    const [kind, id] = key.split(/:(.+)/);
    const t = findTable(kind, id);
    if (t && typeof t.voicePolicy === 'function') return t.voicePolicy(userId);
    return { speak: true, hear: null, note: '' };
  }

  /** Drop anyone who no longer sits at the table; send changed policies. */
  function sweep() {
    for (const [key, m] of [...rooms]) {
      const [kind, id] = key.split(/:(.+)/);
      const t = findTable(kind, id);
      for (const [sid, p] of [...m]) {
        if (!io.sockets.sockets.get(sid)) { leave(sid); continue; }
        if (!t || t.seatOf(p.userId) === -1) { leave(sid, t ? 'Вы встали из-за стола' : 'Стол закрыт'); continue; }
        const pol = JSON.stringify(policyFor(key, p.userId));
        if (lastPolicy.get(sid) !== pol) { lastPolicy.set(sid, pol); io.to(sid).emit('voice:policy', JSON.parse(pol)); }
      }
    }
  }
  refreshTurn();
  const timer = setInterval(sweep, 700);
  if (timer.unref) timer.unref();

  function attach(socket, on, GameError) {
    const userId = socket.data.userId;
    on('voice:join', ({ kind, id }) => {
      if (!KINDS.test(String(kind)) || !/^[\w-]{1,64}$/.test(String(id))) throw new GameError('Неверный стол');
      const t = findTable(kind, String(id));
      if (!t) throw new GameError('Стол не найден');
      if (t.seatOf(userId) === -1) throw new GameError('Голосовой чат — для тех, кто сидит за столом');
      const key = `${kind}:${id}`;
      leave(socket.id);
      const m = rooms.get(key) || new Map();
      // the same player from another tab replaces the old connection
      for (const [sid, p] of [...m]) if (p.userId === userId) leave(sid, 'Голос открыт в другой вкладке');
      if (m.size >= MAX_PEERS) throw new GameError(`В голосе уже ${MAX_PEERS} человек`);
      const peers = list(key);
      m.set(socket.id, { userId, name: nameOf(userId), muted: false });
      rooms.set(key, m);
      const me = list(key).find((p) => p.sid === socket.id);
      for (const p of peers) io.to(p.sid).emit('voice:joined', me);
      const pol = policyFor(key, userId);
      lastPolicy.set(socket.id, JSON.stringify(pol));
      refreshTurn();
      return { sid: socket.id, peers, policy: pol, iceServers: iceServers(), relay: hasTurn() };
    });
    on('voice:leave', () => { leave(socket.id); });
    on('voice:signal', ({ to, data }) => {
      const key = roomOf(socket.id);
      if (!key || !rooms.get(key).has(String(to))) return;
      const size = JSON.stringify(data || {}).length;
      if (size > 20000) throw new GameError('Слишком большое сообщение');
      io.to(String(to)).emit('voice:signal', { from: socket.id, data });
    });
    on('voice:mute', ({ muted }) => {
      const key = roomOf(socket.id);
      if (!key) return;
      const p = rooms.get(key).get(socket.id);
      p.muted = !!muted;
      for (const other of rooms.get(key).keys()) if (other !== socket.id) io.to(other).emit('voice:muted', { sid: socket.id, muted: p.muted });
    });
    socket.on('disconnect', () => leave(socket.id));
  }

  return { attach, sweep, rooms, iceServers, stop: () => clearInterval(timer) };
}

module.exports = { createVoice };
