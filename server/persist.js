'use strict';
const fs = require('fs');
const path = require('path');

/**
 * Where the store keeps its data.
 * FileBackend: one JSON file (local play, VPS with a disk).
 * PgBackend:   PostgreSQL (Neon, Supabase, Render Postgres...) — survives restarts on free hosting.
 * Both get the whole in-memory data object; the Postgres one writes only the rows that changed.
 */

class FileBackend {
  constructor(file) { this.file = file; this.kind = 'file'; }

  loadSync() {
    if (!fs.existsSync(this.file)) return null;
    return JSON.parse(fs.readFileSync(this.file, 'utf8'));
  }

  persist(data) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, this.file);
    this.lastOk = Date.now();
  }

  status() { return { kind: 'file', lastOk: this.lastOk || null, error: null }; }

  flush() { return Promise.resolve(); }
}

const META_KEYS = ['adminLog', 'announcement', 'sngTemplates', 'dms', 'season', 'seasonHistory', 'reports', 'tables'];

class PgBackend {
  /** @param {import('pg').Pool} pool */
  constructor(pool) {
    this.pool = pool;
    this.kind = 'postgres';
    this.saved = { users: new Map(), sessions: new Map(), meta: new Map() };
    this.chain = Promise.resolve();
    this.pending = null;
    this.failures = 0;
  }

  static fromUrl(url) {
    const { Pool } = require('pg');
    const local = /localhost|127\.0\.0\.1/.test(url);
    const ssl = local || /sslmode=disable/.test(url) ? false : { rejectUnauthorized: false };
    // Neon and other serverless databases close idle connections when they fall asleep:
    // drop such connections quietly (an unhandled pool error would crash the server) and reconnect on demand
    const pool = new Pool({ connectionString: url, ssl, max: 4, idleTimeoutMillis: 20000, connectionTimeoutMillis: 20000, keepAlive: true });
    pool.on('error', (e) => console.error('[db] соединение закрыто базой:', e.message));
    return new PgBackend(pool);
  }

  status() { return { kind: 'postgres', lastOk: this.lastOk || null, error: this.failures ? this.lastError : null, failures: this.failures }; }

  async init() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS nr_users (id TEXT PRIMARY KEY, data JSONB NOT NULL)`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS nr_sessions (key TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires BIGINT NOT NULL)`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS nr_meta (key TEXT PRIMARY KEY, data JSONB NOT NULL)`);
  }

  /** Read everything into the store's shape; null when the database is empty. */
  async load() {
    // a sleeping database may need a few seconds to wake up
    for (let k = 1; ; k++) {
      try { await this.init(); break; } catch (e) {
        if (k >= 6) throw e;
        console.error(`[db] база не отвечает (${e.message}), попытка ${k} из 6…`);
        await new Promise((r) => setTimeout(r, 2000 * k));
      }
    }
    const users = await this.pool.query('SELECT id, data FROM nr_users');
    const sessions = await this.pool.query('SELECT key, user_id, expires FROM nr_sessions');
    const meta = await this.pool.query('SELECT key, data FROM nr_meta');
    const data = { users: {}, sessions: {}, adminLog: [], announcement: null };
    for (const r of users.rows) {
      const u = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
      data.users[r.id] = u;
      this.saved.users.set(r.id, JSON.stringify(u));
    }
    for (const r of sessions.rows) {
      data.sessions[r.key] = { userId: r.user_id, expires: Number(r.expires) };
      this.saved.sessions.set(r.key, `${r.user_id}:${r.expires}`);
    }
    for (const r of meta.rows) {
      const v = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
      data[r.key] = v && Object.prototype.hasOwnProperty.call(v, 'v') ? v.v : v;
      this.saved.meta.set(r.key, JSON.stringify(data[r.key]));
    }
    return users.rows.length || meta.rows.length ? data : null;
  }

  /** Queue a diffed write of the current data. Writes never overlap; bursts collapse into one. */
  persist(data) {
    this.pending = data;
    if (this.running) return this.chain;
    this.running = true;
    this.chain = this.chain.then(async () => {
      while (this.pending) {
        const d = this.pending;
        this.pending = null;
        try {
          await this._write(d);
          this.failures = 0;
          this.lastOk = Date.now();
        } catch (e) {
          this.failures += 1;
          this.lastError = e.message;
          console.error('[db] не удалось сохранить:', e.message);
          // keep the data and retry a bit later
          await new Promise((r) => setTimeout(r, Math.min(30000, 1000 * this.failures)));
          if (!this.pending) this.pending = d;
          if (this.failures > 20) { console.error('[db] слишком много ошибок, жду следующего сохранения'); break; }
        }
      }
      this.running = false;
    });
    return this.chain;
  }

  async _write(data) {
    const userRows = [];
    const seenUsers = new Set();
    for (const [id, u] of Object.entries(data.users)) {
      seenUsers.add(id);
      const json = JSON.stringify(u);
      if (this.saved.users.get(id) !== json) userRows.push([id, json]);
    }
    const goneUsers = [...this.saved.users.keys()].filter((id) => !seenUsers.has(id));

    const sessRows = [];
    const seenSess = new Set();
    for (const [key, s] of Object.entries(data.sessions)) {
      seenSess.add(key);
      const sig = `${s.userId}:${s.expires}`;
      if (this.saved.sessions.get(key) !== sig) sessRows.push([key, s.userId, s.expires, sig]);
    }
    const goneSess = [...this.saved.sessions.keys()].filter((k) => !seenSess.has(k));

    const metaRows = [];
    for (const key of META_KEYS) {
      const json = JSON.stringify(data[key] === undefined ? null : data[key]);
      if (this.saved.meta.get(key) !== json) metaRows.push([key, json]);
    }

    if (!userRows.length && !goneUsers.length && !sessRows.length && !goneSess.length && !metaRows.length) return;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const [id, json] of userRows) {
        await client.query('INSERT INTO nr_users (id, data) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data', [id, json]);
      }
      for (const id of goneUsers) await client.query('DELETE FROM nr_users WHERE id = $1', [id]);
      for (const [key, userId, expires] of sessRows) {
        await client.query('INSERT INTO nr_sessions (key, user_id, expires) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET user_id = EXCLUDED.user_id, expires = EXCLUDED.expires', [key, userId, expires]);
      }
      for (const key of goneSess) await client.query('DELETE FROM nr_sessions WHERE key = $1', [key]);
      for (const [key, json] of metaRows) {
        await client.query('INSERT INTO nr_meta (key, data) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data', [key, JSON.stringify({ v: JSON.parse(json) })]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    // remember what is now in the database
    for (const [id, json] of userRows) this.saved.users.set(id, json);
    for (const id of goneUsers) this.saved.users.delete(id);
    for (const [key, , , sig] of sessRows) this.saved.sessions.set(key, sig);
    for (const key of goneSess) this.saved.sessions.delete(key);
    for (const [key, json] of metaRows) this.saved.meta.set(key, json);
  }

  async flush() { await this.chain; }

  async close() { await this.flush(); await this.pool.end(); }
}

module.exports = { FileBackend, PgBackend };
