'use strict';
/**
 * A fair clock for "your move" timers on a shaky connection.
 *
 *  - The time starts when the player's screen shows the turn: the client confirms with `seen(key)`.
 *    Until then the table allows up to `grace` ms extra, so a slow delivery doesn't eat the turn.
 *  - If the player's connection drops on their turn, the clock stops and the table waits for them,
 *    up to `pauseMs` per player per game (budget). When they are back, the full time starts again.
 *  - When the budget is spent (or the player left), the turn times out after a short `awayMs`.
 */
class TurnClock {
  constructor({ timers, now, grace = 8000, pauseMs = 45000, awayMs = 1500 }) {
    this.timers = timers;
    this.now = now;
    this.grace = grace;
    this.pauseMs = pauseMs;
    this.awayMs = awayMs;
    this.cur = null;
    this.budget = new Map();
    this._t = null;
    this._seq = Math.floor(Math.random() * 1e6); // keys stay unique across restarts
  }

  /** New game: everyone's pause budget is full again. */
  resetBudgets() { this.budget = new Map(); }

  /**
   * A turn for `seat`: ms is the normal time, onTimeout runs when it is up.
   * connected: is the player online; present: false when the seat is empty / leaving.
   */
  start({ seat, ms, connected = true, present = true, onTimeout, noGrace = false }) {
    this.stop();
    this._seq += 1;
    this.cur = { seat, ms, onTimeout, key: `t${this._seq}`, start: this.now(), seen: noGrace, paused: null, present };
    this._arm(connected ? 'start' : 'pause');
    return this.cur.key;
  }

  stop() {
    if (this._t) { this.timers.clear(this._t); this._t = null; }
    if (this.cur && this.cur.paused) this._spend();
    this.cur = null;
  }

  /** The client of `seat` has the turn on screen. */
  seen(seat, key) {
    const c = this.cur;
    if (!c || c.seen || c.paused || c.held != null || c.seat !== seat || c.key !== key) return false;
    c.seen = true;
    const left = Math.max(1000, Math.min(c.ms, c.start + c.ms + this.grace - this.now()));
    this._set(left);
    return true;
  }

  /** A player's connection changed. */
  connection(seat, connected) {
    const c = this.cur;
    if (!c || c.seat !== seat || c.held != null) return false;
    if (!connected && !c.paused) { this._arm('pause'); return true; }
    if (connected && c.paused) { this._arm('resume'); return true; }
    return false;
  }

  _spend() {
    const c = this.cur;
    const left = this.budget.has(c.seat) ? this.budget.get(c.seat) : this.pauseMs;
    this.budget.set(c.seat, Math.max(0, left - (this.now() - c.paused)));
    c.paused = null;
  }

  _arm(mode) {
    const c = this.cur;
    if (c.paused) this._spend();
    if (!c.present) { this._set(this.awayMs); return; }
    if (mode === 'pause') {
      const left = this.budget.has(c.seat) ? this.budget.get(c.seat) : this.pauseMs;
      if (left > 500) { c.paused = this.now(); this._set(left); return; }
      this._set(this.awayMs);
      return;
    }
    if (mode === 'resume') { c.seen = false; c.start = this.now(); }
    this._set(c.ms + (c.seen ? 0 : this.grace));
  }

  _set(ms) {
    if (this._t) this.timers.clear(this._t);
    const c = this.cur;
    c.deadline = this.now() + ms;
    const key = c.key;
    this._t = this.timers.set(() => {
      this._t = null;
      if (!this.cur || this.cur.key !== key) return;
      const cb = this.cur.onTimeout;
      if (this.cur.paused) this._spend();
      this.cur = null;
      cb();
    }, ms);
  }

  /** The whole table is paused: freeze the turn where it is. */
  hold() {
    const c = this.cur;
    if (!c || c.held != null) return;
    c.held = Math.max(0, (c.deadline || this.now()) - this.now());
    if (this._t) { this.timers.clear(this._t); this._t = null; }
  }
  release() {
    const c = this.cur;
    if (!c || c.held == null) return;
    const left = Math.max(1000, c.held);
    c.held = null;
    if (c.paused) c.paused = this.now(); // the offline budget is not spent during a table pause
    this._set(left);
  }

  /** For the table's public state. */
  view() {
    const c = this.cur;
    if (!c) return { key: null, left: 0, ms: 0, paused: null };
    const raw = c.held != null ? c.held : Math.max(0, c.deadline - this.now());
    return {
      key: c.key, seat: c.seat, ms: c.ms,
      // before the confirmation, show the plain full time rather than the grace-padded one
      left: c.paused ? raw : c.seen ? raw : Math.min(c.ms, raw),
      paused: c.paused ? { seat: c.seat, left: raw } : null,
    };
  }
}

module.exports = { TurnClock };
