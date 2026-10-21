(() => {
  'use strict';

  // older Safari (iOS < 14) has no replaceChildren: without it the table would not render at all
  if (!Element.prototype.replaceChildren) {
    Element.prototype.replaceChildren = function replaceChildren(...nodes) {
      while (this.firstChild) this.removeChild(this.firstChild);
      this.append(...nodes);
    };
  }

  // ================= helpers =================
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const fmt = (n) => Number(n || 0).toLocaleString('ru-RU');
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Tiny DOM builder: text always goes through text nodes, never innerHTML. */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style') el.setAttribute('style', v);
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  function anim(el, frames, opts) {
    if (reduceMotion || !el || !el.animate) return null;
    try { return el.animate(frames, opts); } catch (e) { return null; }
  }

  const SUITS = { s: '♠︎', h: '♥︎', d: '♦︎', c: '♣︎' };
  const SUIT_NAMES = { s: 'пики', h: 'черви', d: 'бубны', c: 'трефы' };
  const GAME_NAMES = { NLH: 'Холдем NL', PLO: 'Омаха PL' };
  const STREET_NAMES = { preflop: 'Префлоп', flop: 'Флоп', turn: 'Тёрн', river: 'Ривер' };

  function cardEl(code, extra = '') {
    if (!code) return h('div', { class: 'card back ' + extra, 'aria-label': 'Закрытая карта' });
    const r = code[0] === 'T' ? '10' : code[0];
    const s = code[1];
    return h('div', { class: `card ${s === 'h' || s === 'd' ? 'red' : ''} ${extra}`, 'aria-label': `${r} ${SUIT_NAMES[s]}` },
      h('span', { class: 'r' }, r), h('span', { class: 's' }, SUITS[s]));
  }

  /** Replace cards only when they changed; returns the newly added card elements. */
  function setCards(container, list) {
    const sig = list.map((c) => (c.code || '#') + '.' + (c.cls || '')).join(',');
    if (container._sig === sig) return [];
    const prevCodes = container._codes || [];
    const prevBacks = prevCodes.filter((c) => !c).length;
    let backs = 0;
    const fresh = [];
    const els = list.map((c) => {
      const el = cardEl(c.code, c.cls || '');
      if (c.code) { if (!prevCodes.includes(c.code)) fresh.push(el); } else if (++backs > prevBacks) fresh.push(el);
      return el;
    });
    container.replaceChildren(...els);
    container._sig = sig;
    container._codes = list.map((c) => c.code);
    return fresh;
  }

  function hueOf(name) {
    let x = 0;
    for (const ch of name) x = (x * 31 + ch.codePointAt(0)) % 360;
    return x;
  }
  function initials(name) {
    const parts = name.trim().split(/[\s_-]+/).filter(Boolean);
    return ((parts[0] || '?')[0] + (parts[1] ? parts[1][0] : (parts[0] || '')[1] || '')).toUpperCase();
  }

  function mmss(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  let toastTimer = null;
  function toast(text, isError = false) {
    const el = $('#toast');
    el.textContent = text;
    el.className = 'toast' + (isError ? ' err' : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3400);
  }

  // ================= sound (synthesised, no files) =================
  const Sound = {
    ctx: null,
    muted: false,
    init() {
      try { this.muted = localStorage.getItem('nr_muted') === '1'; } catch (e) { /* ignore */ }
      this.renderBtn();
      const unlock = () => { this.ensure(); };
      window.addEventListener('pointerdown', unlock, { once: true });
      window.addEventListener('keydown', unlock, { once: true });
    },
    ensure() {
      try {
        if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (this.ctx.state === 'suspended') this.ctx.resume();
      } catch (e) { this.ctx = null; }
      return this.ctx;
    },
    toggle() {
      this.muted = !this.muted;
      try { localStorage.setItem('nr_muted', this.muted ? '1' : '0'); } catch (e) { /* ignore */ }
      this.renderBtn();
      if (!this.muted) this.play('chips');
    },
    renderBtn() {
      const b = $('#sound-btn');
      b.setAttribute('aria-pressed', this.muted ? 'true' : 'false');
      b.setAttribute('aria-label', this.muted ? 'Включить звук' : 'Выключить звук');
    },
    tone(freq, dur, type, vol, when) {
      const c = this.ctx;
      const t0 = c.currentTime + when;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(c.destination);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    },
    noise(dur, vol, freq, when, sweepTo) {
      const c = this.ctx;
      const t0 = c.currentTime + when;
      const len = Math.max(1, Math.floor(c.sampleRate * dur));
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = c.createBufferSource();
      src.buffer = buf;
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.setValueAtTime(freq, t0);
      if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f).connect(g).connect(c.destination);
      src.start(t0);
    },
    play(name, delay = 0) {
      if (this.muted || document.hidden) return;
      const c = this.ensure();
      if (!c) return;
      try {
        switch (name) {
          case 'card': this.noise(0.07, 0.35, 3800, delay); break;
          case 'deal': for (let k = 0; k < 4; k++) this.noise(0.06, 0.3, 3600, delay + k * 0.08); break;
          case 'chips':
            this.tone(2600, 0.05, 'triangle', 0.05, delay);
            this.tone(3300, 0.05, 'triangle', 0.04, delay + 0.05);
            this.tone(2900, 0.07, 'triangle', 0.035, delay + 0.1);
            break;
          case 'check':
            this.tone(180, 0.09, 'sine', 0.22, delay);
            this.tone(170, 0.09, 'sine', 0.18, delay + 0.13);
            break;
          case 'fold': this.noise(0.25, 0.2, 2200, delay, 500); break;
          case 'turn':
            this.tone(660, 0.18, 'sine', 0.07, delay);
            this.tone(990, 0.25, 'sine', 0.06, delay + 0.12);
            break;
          case 'tick': this.tone(1400, 0.04, 'square', 0.025, delay); break;
          case 'win': [523, 659, 784, 1047].forEach((f, k) => this.tone(f, 0.4, 'sine', 0.06, delay + k * 0.09)); break;
          case 'bigwin': [523, 659, 784, 1047, 1319].forEach((f, k) => this.tone(f, 0.55, 'triangle', 0.07, delay + k * 0.1)); break;
          default: break;
        }
      } catch (e) { /* audio unavailable */ }
    },
  };
  $('#sound-btn').addEventListener('click', () => Sound.toggle());
  Sound.init();

  // ================= state =================
  const S = {
    token: null,
    socket: null,
    me: null,
    tables: [],
    sngs: [],
    stakes: [],
    seatOptions: [],
    myTables: new Set(),
    durak: [],
    myDurak: new Set(),
    durakStakes: [],
    announcement: null,
    filter: 'all',
    freeOnly: false,
    lobbyTab: 'cash',
    tableId: null,
    ts: null,
    prevTs: null,
    tsAt: 0,
    raiseKey: '',
    raiseVal: 0,
    lastTurnKey: '',
    pre: null, // pre-selected action while waiting
    sideTab: 'chat',
    leaderboard: [],
    tickedAt: 0,
  };
  try { S.token = localStorage.getItem('nr_token'); } catch (e) { /* storage blocked */ }

  // ================= auth =================
  let authMode = 'login';
  $$('[data-auth-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      authMode = tab.dataset.authTab;
      $$('[data-auth-tab]').forEach((t) => {
        t.classList.toggle('is-active', t === tab);
        t.setAttribute('aria-selected', t === tab);
      });
      $('#auth-submit').textContent = authMode === 'login' ? 'Войти' : 'Создать аккаунт';
      $('#auth-form').password.autocomplete = authMode === 'login' ? 'current-password' : 'new-password';
      $('#auth-error').textContent = '';
    });
  });

  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const btn = $('#auth-submit');
    btn.disabled = true;
    $('#auth-error').textContent = '';
    try {
      const res = await fetch(`/api/${authMode === 'login' ? 'login' : 'register'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: f.name.value, password: f.password.value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка');
      S.token = data.token;
      try { localStorage.setItem('nr_token', data.token); } catch (err) { /* ignore */ }
      f.password.value = '';
      startApp();
    } catch (err) {
      $('#auth-error').textContent = err.message === 'Failed to fetch' ? 'Сервер недоступен' : err.message;
    } finally {
      btn.disabled = false;
    }
  });

  function showAuth() {
    $('#view-app').hidden = true;
    $('#view-auth').hidden = false;
    setTimeout(() => $('#auth-form').name.focus(), 50);
  }

  $('#logout-btn').addEventListener('click', () => {
    fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: S.token }) }).catch(() => {});
    logout();
  });

  function logout() {
    try { localStorage.removeItem('nr_token'); } catch (e) { /* ignore */ }
    S.token = null;
    if (S.socket) { S.socket.removeAllListeners(); S.socket.disconnect(); S.socket = null; }
    S.tableId = null;
    S.ts = null;
    showAuth();
  }

  // ================= socket =================
  function call(event, payload = {}, quiet = false) {
    return new Promise((resolve) => {
      if (!S.socket || !S.socket.connected) { if (!quiet) toast('Нет соединения с сервером', true); return resolve(null); }
      S.socket.timeout(8000).emit(event, payload, (err, res) => {
        if (err) { if (!quiet) toast('Сервер не ответил', true); return resolve(null); }
        if (res && res.error) { if (!quiet) toast(res.error, true); return resolve(null); }
        resolve(res);
      });
    });
  }

  function startApp() {
    $('#view-auth').hidden = true;
    $('#view-app').hidden = false;
    const socket = io({ auth: { token: S.token } });
    S.socket = socket;

    socket.on('connect', async () => {
      $('#conn-banner').hidden = true;
      const res = await call('hello');
      if (!res) return;
      S.me = res.me;
      S.tables = res.tables;
      S.sngs = res.sngs || [];
      S.stakes = res.stakes;
      S.seatOptions = res.seatOptions;
      S.blindEveryOptions = res.blindEveryOptions || [0, 5];
      S.myTables = new Set(res.myTables);
      S.leaderboard = res.leaderboard;
      S.durak = res.durak || [];
      S.myDurak = new Set(res.myDurak || []);
      S.durakStakes = res.durakStakes || [];
      setAnnouncement(res.announcement);
      fillDurakForm();
      renderMe();
      renderLeaderboard();
      fillCreateForm();
      S.tableId = null; // force re-watch after reconnect
      if (window.DurakUI) window.DurakUI.reset();
      route();
    });
    socket.on('connect_error', (err) => {
      if (err && (err.message === 'unauthorized' || err.message === 'banned')) {
        logout();
        if (err.message === 'banned') $('#auth-error').textContent = 'Аккаунт заблокирован администратором';
      } else $('#conn-banner').hidden = false;
    });
    socket.on('disconnect', () => { $('#conn-banner').hidden = false; });
    socket.on('me', (me) => { S.me = me; renderMe(); });
    socket.on('lobby:tables', (tables) => { S.tables = tables; renderLobby(); });
    socket.on('lobby:sngs', (sngs) => { S.sngs = sngs; renderLobby(); });
    socket.on('table:state', (ts) => {
      if (ts.id !== S.tableId) return;
      setTableState(ts);
    });
    socket.on('sng:started', (e) => {
      S.myTables.add(e.tableId);
      toast(`Турнир «${e.name}» начался — удачи!`);
      Sound.play('deal');
      location.hash = `#/table/${e.tableId}`;
    });
    socket.on('sng:result', (e) => showSngResult(e));
    socket.on('lobby:durak', (list) => { S.durak = list; renderLobby(); });
    socket.on('durak:state', (st) => { if (window.DurakUI) window.DurakUI.onState(st); });
    socket.on('announce', (a) => setAnnouncement(a));
    socket.on('notice', (n) => {
      toast(n.text);
      if (n.type === 'closed' && n.tableId && location.hash.includes(n.tableId)) location.hash = '#/';
    });
  }

  // ================= routing =================
  window.addEventListener('hashchange', route);

  async function route() {
    if (!S.socket) return;
    const dm = location.hash.match(/^#\/durak\/([\w-]+)/);
    if (dm) {
      if (S.tableId) call('table:unwatch', { tableId: S.tableId }, true);
      S.tableId = null;
      S.ts = null;
      $('#lobby').hidden = true;
      $('#table-view').hidden = true;
      $('#durak-view').hidden = false;
      if (window.DurakUI) window.DurakUI.open(dm[1]);
      return;
    }
    $('#durak-view').hidden = true;
    if (window.DurakUI) window.DurakUI.close();
    const m = location.hash.match(/^#\/table\/([\w-]+)/);
    if (m) {
      const id = m[1];
      if (S.tableId !== id) {
        if (S.tableId) call('table:unwatch', { tableId: S.tableId }, true);
        S.tableId = id;
        S.ts = null;
        S.prevTs = null;
        S.pre = null;
        T.key = null;
        const res = await call('table:watch', { tableId: id });
        if (!res) { location.hash = '#/'; return; }
        setTableState(res.state);
        if (S.sideTab === 'hands') loadHands();
      }
      $('#lobby').hidden = true;
      $('#table-view').hidden = false;
    } else {
      if (S.tableId) call('table:unwatch', { tableId: S.tableId }, true);
      S.tableId = null;
      S.ts = null;
      S.prevTs = null;
      $('#table-view').hidden = true;
      $('#lobby').hidden = false;
      renderLobby();
      document.title = 'NOIR RIVER — лобби';
    }
  }

  // ================= header =================
  function renderMe() {
    if (!S.me) return;
    $('#me-balance').textContent = fmt(S.me.balance);
    $('#me-inplay').textContent = S.me.inPlay ? `+ ${fmt(S.me.inPlay)} в игре` : 'на балансе';
    $('#me-name').textContent = S.me.name;
    $('#bonus-btn').hidden = !S.me.bonusAvailable;
    $('#admin-link').hidden = S.me.role !== 'admin';
    $('#bonus-amount').textContent = fmt(S.me.bonusAmount);
  }

  $('#bonus-btn').addEventListener('click', async () => {
    const res = await call('bonus:claim');
    if (res) { toast(`Начислено ${fmt(res.amount)} фишек`); Sound.play('win'); }
  });

  // ================= lobby =================
  $$('[data-filter]').forEach((b) => b.addEventListener('click', () => {
    S.filter = b.dataset.filter;
    $$('[data-filter]').forEach((x) => x.classList.toggle('is-active', x === b));
    renderLobby();
  }));
  $('#filter-free').addEventListener('change', (e) => { S.freeOnly = e.target.checked; renderLobby(); });
  $$('[data-lobby-tab]').forEach((tab) => tab.addEventListener('click', () => {
    S.lobbyTab = tab.dataset.lobbyTab;
    $$('[data-lobby-tab]').forEach((x) => { x.classList.toggle('is-active', x === tab); x.setAttribute('aria-selected', x === tab); });
    renderLobby();
  }));

  function dots(n, on) {
    return h('div', { class: 'seats-dots', 'aria-hidden': 'true' }, Array.from({ length: n }, (_, i) => h('i', { class: i < on ? 'on' : '' })));
  }

  function renderLobby() {
    const tab = S.lobbyTab;
    $('#table-list').hidden = tab !== 'cash';
    $('#cash-filters').hidden = tab !== 'cash';
    $('#create-btn').hidden = tab === 'sng';
    $('#sng-list').hidden = tab !== 'sng';
    $('#durak-list').hidden = tab !== 'durak';
    $('#lobby-title').textContent = { cash: 'Выберите стол', sng: 'Турниры Sit & Go', durak: 'Дурак на фишки' }[tab];
    if (tab === 'cash') renderCashList();
    else if (tab === 'sng') renderSngList();
    else renderDurakList();
    renderMyTables();
  }

  const DURAK_VARIANTS = { podkidnoy: 'Подкидной', perevodnoy: 'Переводной' };
  const DURAK_STATUS = { waiting: 'Ждут игроков', countdown: 'Старт…', playing: 'Идёт партия', result: 'Итоги' };
  function renderDurakList() {
    const list = $('#durak-list');
    list.replaceChildren();
    if (!S.durak.length) { list.append(h('div', { class: 'empty' }, 'Столов нет — создайте свой.')); return; }
    const rows = S.durak.slice().sort((a, b) => a.stake - b.stake || b.players - a.players);
    for (const t of rows) {
      const mine = S.myDurak.has(t.id);
      list.append(h('div', { class: 'trow' },
        h('div', { class: 'trow-game dk-badge' }, 'Д', h('small', null, `${t.maxPlayers} игр.`)),
        h('div', { class: 'trow-name' },
          h('b', null, t.name, ' ', h('span', { class: 'status ' + (t.status === 'playing' ? 'running' : 'registering') }, DURAK_STATUS[t.status])),
          h('span', null, `${DURAK_VARIANTS[t.variant]} · колода 36 · банк делят выигравшие`)),
        h('div', { class: 'trow-stat' }, h('small', null, 'Ставка'), h('b', null, fmt(t.stake))),
        h('div', { class: 'trow-stat' }, h('small', null, 'Игроки'), h('b', null, `${t.players} / ${t.maxPlayers}`), dots(t.maxPlayers, t.players)),
        h('a', { class: 'btn ' + (mine ? 'btn-gold' : 'btn-dark'), href: `#/durak/${t.id}` }, mine ? 'Вернуться' : 'Открыть'),
      ));
    }
  }

  function fillDurakForm() {
    const sel = $('#durak-stake');
    sel.replaceChildren(...S.durakStakes.map((x) => h('option', { value: x }, `${fmt(x)} фишек`)));
    sel.value = S.durakStakes.includes(100) ? '100' : String(S.durakStakes[0] || '');
  }
  $('#durak-create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const res = await call('durak:create', { name: f.name.value, variant: f.variant.value, stake: Number(f.stake.value), maxPlayers: Number(f.maxPlayers.value) });
    if (!res) return;
    $('#modal-durak-create').close();
    f.name.value = '';
    location.hash = `#/durak/${res.tableId}`;
  });

  function setAnnouncement(a) {
    S.announcement = a;
    let hiddenText = '';
    try { hiddenText = localStorage.getItem('nr_ann_hidden') || ''; } catch (e) { /* ignore */ }
    const show = !!(a && a.text && hiddenText !== String(a.t));
    $('#announce').hidden = !show;
    if (a) $('#announce-text').textContent = a.text;
  }
  $('#announce-close').addEventListener('click', () => {
    try { if (S.announcement) localStorage.setItem('nr_ann_hidden', String(S.announcement.t)); } catch (e) { /* ignore */ }
    $('#announce').hidden = true;
  });

  function renderCashList() {
    const list = $('#table-list');
    const rows = S.tables
      .filter((t) => S.filter === 'all' || t.game === S.filter)
      .filter((t) => !S.freeOnly || t.players < t.maxSeats)
      .sort((a, b) => a.bb - b.bb || b.players - a.players);
    list.replaceChildren();
    if (!rows.length) list.append(h('div', { class: 'empty' }, 'Подходящих столов нет — создайте свой.'));
    for (const t of rows) {
      const mine = S.myTables.has(t.id);
      list.append(h('div', { class: 'trow' },
        h('div', { class: 'trow-game' }, t.game === 'PLO' ? 'PLO' : 'NLH', h('small', null, `${t.maxSeats}-max`)),
        h('div', { class: 'trow-name' }, h('b', null, t.name),
          h('span', null, GAME_NAMES[t.game], t.blindsEvery ? ` · блайнды растут каждые ${t.blindsEvery} раздач` : '')),
        h('div', { class: 'trow-stat' }, h('small', null, 'Блайнды'), h('b', null, `${fmt(t.sb)} / ${fmt(t.bb)}`)),
        h('div', { class: 'trow-stat' }, h('small', null, 'Бай-ин'), h('b', null, `${fmt(t.minBuyIn)}–${fmt(t.maxBuyIn)}`)),
        h('div', { class: 'trow-stat' }, h('small', null, 'Игроки'), h('b', null, `${t.players} / ${t.maxSeats}`), dots(t.maxSeats, t.players)),
        h('a', { class: 'btn ' + (mine ? 'btn-gold' : 'btn-dark'), href: `#/table/${t.id}` }, mine ? 'Вернуться' : 'Открыть'),
      ));
    }
  }

  const STATUS_NAMES = { registering: 'Регистрация', running: 'Идёт', finished: 'Завершён' };

  function renderSngList() {
    const list = $('#sng-list');
    list.replaceChildren();
    if (!S.sngs.length) { list.append(h('div', { class: 'empty' }, 'Турниров пока нет.')); return; }
    const myName = S.me ? S.me.name : '';
    for (const x of S.sngs) {
      const registered = x.players.includes(myName);
      const count = x.status === 'registering' ? x.players.length : x.alive;
      let action;
      if (x.status === 'registering') {
        action = registered
          ? h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => sngAction('sng:unregister', x) }, 'Отменить')
          : h('button', { type: 'button', class: 'btn btn-gold', onclick: () => sngAction('sng:register', x) }, `Играть · ${fmt(x.buyIn)}`);
      } else if (x.status === 'running') {
        const mine = registered || S.myTables.has(x.tableId);
        action = h('a', { class: 'btn ' + (mine ? 'btn-gold' : 'btn-dark'), href: `#/table/${x.tableId}` }, mine ? 'К столу' : 'Смотреть');
      } else {
        action = h('span', { class: 'muted' }, x.winner ? `Победитель: ${x.winner}` : 'Завершён');
      }
      const prizes = x.payouts.map((p, i) => `${i + 1} — ${fmt(p)}`).join(' · ');
      list.append(h('div', { class: 'trow' },
        h('div', { class: 'trow-game' }, x.game === 'PLO' ? 'PLO' : 'NLH', h('small', null, `${x.seats}-max`)),
        h('div', { class: 'trow-name' },
          h('b', null, x.name, ' ', h('span', { class: 'status ' + x.status }, x.status === 'running' ? `Уровень ${x.level}` : STATUS_NAMES[x.status])),
          h('span', null, `${GAME_NAMES[x.game]} · стек ${fmt(x.startStack)} · блайнды растут каждые ${x.levelHands} раздач`),
          x.players.length ? h('span', { class: 'reg-names', title: x.players.join(', ') }, x.players.join(', ')) : null),
        h('div', { class: 'trow-stat' }, h('small', null, 'Бай-ин'), h('b', null, fmt(x.buyIn))),
        h('div', { class: 'trow-stat' }, h('small', null, 'Призовые'), h('b', { title: prizes }, fmt(x.prizePool)), h('span', { class: 'muted small' }, prizes)),
        h('div', { class: 'trow-stat' },
          h('small', null, x.status === 'running' ? 'В игре' : 'Игроки'),
          h('b', null, `${count} / ${x.seats}`), dots(x.seats, count)),
        action,
      ));
    }
  }

  async function sngAction(event, x) {
    const res = await call(event, { sngId: x.id });
    if (!res) return;
    if (event === 'sng:register') {
      if (res.tableId) { S.myTables.add(res.tableId); location.hash = `#/table/${res.tableId}`; }
      else toast(`Вы в турнире «${x.name}». Старт — когда соберутся ${x.seats} игроков.`);
    } else {
      toast('Регистрация отменена, бай-ин вернулся на баланс');
    }
  }

  function renderMyTables() {
    const mine = $('#my-tables');
    mine.replaceChildren();
    const cash = S.tables.filter((t) => S.myTables.has(t.id)).map((t) => ({ id: t.id, name: t.name, meta: `${fmt(t.sb)}/${fmt(t.bb)}` }));
    const sng = S.sngs.filter((x) => x.tableId && x.status === 'running' && S.myTables.has(x.tableId))
      .map((x) => ({ id: x.tableId, name: x.name, meta: `Sit & Go · ур. ${x.level}` }));
    const dk = S.durak.filter((t) => S.myDurak.has(t.id)).map((t) => ({ id: t.id, href: `#/durak/${t.id}`, name: t.name, meta: `Дурак · ${fmt(t.stake)}` }));
    const all = cash.concat(sng).concat(dk);
    if (!all.length) mine.append(h('p', { class: 'muted' }, 'Вы пока не сидите за столом.'));
    for (const t of all) mine.append(h('a', { href: t.href || `#/table/${t.id}` }, h('span', null, t.name), h('span', { class: 'muted' }, t.meta)));
  }

  function renderLeaderboard() {
    const ol = $('#leaderboard');
    ol.replaceChildren();
    if (!S.leaderboard.length) ol.append(h('li', null, h('span', { class: 'muted' }, 'Пока пусто')));
    for (const p of S.leaderboard) ol.append(h('li', null, h('span', null, p.name), h('b', null, fmt(p.chips))));
  }
  setInterval(() => {
    if (!S.token || $('#lobby').hidden) return;
    fetch('/api/leaderboard').then((r) => r.json()).then((lb) => { S.leaderboard = lb; renderLeaderboard(); }).catch(() => {});
  }, 30000);

  // ================= create table =================
  function fillCreateForm() {
    const sel = $('#stakes-select');
    sel.replaceChildren(...S.stakes.map(([sb, bb], i) => h('option', { value: i }, `${fmt(sb)} / ${fmt(bb)} — бай-ин ${fmt(bb * 40)}–${fmt(bb * 200)}`)));
    sel.value = '2';
    const seg = $('#seats-seg');
    seg.replaceChildren(...S.seatOptions.map((n) => h('label', null,
      h('input', { type: 'radio', name: 'seats', value: n, checked: n === 6 }),
      h('span', null, n === 2 ? '2 (хедз-ап)' : String(n)))));
    const be = $('#blinds-every');
    be.replaceChildren(...S.blindEveryOptions.map((n) => h('option', { value: n }, n ? `Каждые ${n} раздач` : 'Не повышать')));
    be.value = S.blindEveryOptions.includes(5) ? '5' : '0';
  }

  $('#create-btn').addEventListener('click', () => {
    if (S.lobbyTab === 'durak') { $('#modal-durak-create').showModal(); return; }
    $('#create-error').textContent = '';
    $('#modal-create').showModal();
  });
  $('#create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const res = await call('table:create', {
      name: f.name.value, game: f.game.value, stakes: Number(f.stakes.value), seats: Number(f.seats.value),
      blindsEvery: Number(f.blindsEvery.value),
    });
    if (!res) return;
    $('#modal-create').close();
    f.name.value = '';
    location.hash = `#/table/${res.tableId}`;
  });
  $$('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

  // ================= buy-in / add chips =================
  let buyinCtx = null;
  function openBuyin(mode, seat) {
    const t = S.ts;
    if (!t || !S.me) return;
    let min;
    let max;
    if (mode === 'sit') {
      min = t.minBuyIn;
      max = Math.min(t.maxBuyIn, S.me.balance);
    } else {
      const stack = t.you ? t.you.stack : 0;
      min = stack < t.minBuyIn ? t.minBuyIn - stack : 1;
      max = Math.min(t.maxBuyIn - stack, S.me.balance);
    }
    if (max < min) {
      toast(S.me.bonusAvailable ? 'Не хватает фишек — заберите ежедневный бонус' : 'Не хватает фишек на балансе', true);
      return;
    }
    buyinCtx = { mode, seat };
    const range = $('#buyin-range-input');
    range.min = min;
    range.max = max;
    range.step = 1;
    range.value = mode === 'sit' ? clamp(t.bb * 100, min, max) : max;
    $('#buyin-title').textContent = mode === 'sit' ? `Место ${seat + 1}: бай-ин` : 'Докупить фишки';
    $('#buyin-range').textContent = `${GAME_NAMES[t.game]} · блайнды ${fmt(t.sb)}/${fmt(t.bb)} · от ${fmt(min)} до ${fmt(max)}`;
    $('#buyin-balance').textContent = `На балансе: ${fmt(S.me.balance)}`;
    $('#buyin-submit').textContent = mode === 'sit' ? 'Сесть за стол' : 'Докупить';
    $('#buyin-error').textContent = '';
    updateBuyinOut();
    $('#modal-buyin').showModal();
  }
  function updateBuyinOut() { $('#buyin-out').textContent = fmt($('#buyin-range-input').value); }
  $('#buyin-range-input').addEventListener('input', updateBuyinOut);
  $('#buyin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!buyinCtx || !S.ts) return;
    const amount = Number($('#buyin-range-input').value);
    const res = buyinCtx.mode === 'sit'
      ? await call('table:sit', { tableId: S.ts.id, seat: buyinCtx.seat, buyIn: amount })
      : await call('table:addchips', { tableId: S.ts.id, amount });
    if (!res) return;
    if (buyinCtx.mode === 'sit') S.myTables.add(S.ts.id);
    Sound.play('chips');
    $('#modal-buyin').close();
  });

  // ================= table: DOM =================
  const T = { key: null, seats: [], dealerEl: null };

  function seatGeometry(i, t) {
    const base = t.mySeat >= 0 ? t.mySeat : 0;
    const k = (i - base + t.maxSeats) % t.maxSeats;
    const ang = (Math.PI / 2) + (k * 2 * Math.PI) / t.maxSeats;
    const pos = (r, a = ang) => ({ x: 50 + r * 50 * Math.cos(a), y: 50 + r * 50 * Math.sin(a) });
    return { seat: pos(1.02), bet: pos(0.6), dealer: pos(0.74, ang + 0.33) };
  }

  /** Build seat elements once per table/seat layout; later renders only update them. */
  function ensureTableDom(t) {
    const key = `${t.id}|${t.maxSeats}|${t.mySeat}`;
    if (T.key === key) return false;
    T.key = key;
    const layer = $('#seats');
    layer.replaceChildren();
    $('#fx').replaceChildren();
    $('#board')._sig = null;
    $('#board')._codes = [];
    T.seats = [];
    for (let i = 0; i < t.maxSeats; i++) {
      const g = seatGeometry(i, t);
      const r = {};
      r.g = g;
      r.root = h('div', { class: 'seat', style: `left:${g.seat.x}%;top:${g.seat.y}%` });
      r.cards = h('div', { class: 'seat-cards' + (t.game === 'PLO' ? ' plo' : '') });
      r.avatar = h('div', { class: 'avatar', 'aria-hidden': 'true' });
      r.name = h('div', { class: 'seat-name' });
      r.stack = h('div', { class: 'seat-stack' });
      r.hand = h('div', { class: 'seat-hand' });
      r.offline = h('div', { class: 'offline' }, 'не в сети');
      r.tag = h('span', { class: 'seat-tag' });
      r.timerBar = h('i', { 'data-timer': '' });
      r.timer = h('div', { class: 'timer', 'aria-hidden': 'true' }, r.timerBar);
      r.box = h('div', { class: 'seat-box' }, r.tag, r.avatar, h('div', { class: 'seat-info' }, r.name, r.stack, r.hand, r.offline), r.timer);
      r.sit = h('button', { type: 'button', class: 'empty-seat', onclick: () => openBuyin('sit', i), 'aria-label': `Сесть на место ${i + 1}` }, 'Сесть');
      r.emptyLabel = h('span', { class: 'empty-seat static', 'aria-hidden': 'true' }, 'Свободно');
      r.root.append(r.cards, r.box, r.sit, r.emptyLabel);
      r.bet = h('div', { class: 'bet', style: `left:${g.bet.x}%;top:${g.bet.y}%` }, h('span', { class: 'chip-icon', 'aria-hidden': 'true' }), h('span'));
      layer.append(r.root, r.bet);
      T.seats.push(r);
    }
    T.dealerEl = h('div', { class: 'dealer-btn', title: 'Дилер' }, 'D');
    layer.append(T.dealerEl);
    return true;
  }

  function show(el, on) { el.hidden = !on; }
  function setText(el, text) { if (el.textContent !== text) el.textContent = text; }

  // positions inside the felt, in px
  function feltSize() { const f = $('#felt'); return { w: f.clientWidth, hgt: f.clientHeight, rect: f.getBoundingClientRect() }; }
  function pctToPx(p) { const f = feltSize(); return { x: (p.x / 100) * f.w, y: (p.y / 100) * f.hgt }; }
  function potPoint() {
    const f = feltSize();
    const pot = $('#pot');
    const ref = !pot.hidden ? pot : $('#board');
    const r = ref.getBoundingClientRect();
    if (!r.width) return { x: f.w / 2, y: f.hgt * 0.42 };
    return { x: r.left + r.width / 2 - f.rect.left, y: r.top + r.height / 2 - f.rect.top };
  }

  function flyChip(from, to, delay = 0, red = false) {
    if (reduceMotion) return;
    const el = h('div', { class: 'fx-chip' + (red ? ' red' : ''), style: `left:${from.x}px;top:${from.y}px` });
    $('#fx').append(el);
    const a = anim(el, [
      { transform: 'translate(0,0) scale(1)', opacity: 1 },
      { transform: `translate(${to.x - from.x}px,${to.y - from.y}px) scale(.85)`, opacity: 0.95 },
    ], { duration: 520, delay, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'both' });
    if (a) a.onfinish = () => el.remove(); else el.remove();
  }

  /** Clone the seat's cards and slide them to the middle, as a fold. */
  function foldGhosts(container) {
    if (reduceMotion) return;
    const f = feltSize();
    const center = { x: f.w / 2, y: f.hgt * 0.42 };
    [...container.children].forEach((card, k) => {
      const r = card.getBoundingClientRect();
      if (!r.width) return;
      const ghost = card.cloneNode(true);
      ghost.classList.add('fx-card');
      const x = r.left - f.rect.left;
      const y = r.top - f.rect.top;
      ghost.style.cssText = `left:${x}px;top:${y}px;width:${r.width}px;height:${r.height}px;--cw:${r.width}px`;
      $('#fx').append(ghost);
      const a = anim(ghost, [
        { transform: 'translate(0,0) rotate(0)', opacity: 1 },
        { transform: `translate(${center.x - x - r.width / 2}px,${center.y - y - r.height / 2}px) rotate(${k ? 25 : -25}deg) scale(.6)`, opacity: 0 },
      ], { duration: 420, easing: 'ease-in', fill: 'both' });
      if (a) a.onfinish = () => ghost.remove(); else ghost.remove();
    });
  }

  function dealAnim(el, delay) {
    const f = feltSize();
    const r = el.getBoundingClientRect();
    const dx = f.rect.left + f.w / 2 - (r.left + r.width / 2);
    const dy = f.rect.top + f.hgt * 0.42 - (r.top + r.height / 2);
    anim(el, [
      { transform: `translate(${dx}px,${dy}px) rotate(-30deg) scale(.5)`, opacity: 0 },
      { transform: 'translate(0,0) rotate(0) scale(1)', opacity: 1 },
    ], { duration: 380, delay, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
  }

  function flipAnim(el, delay) {
    anim(el, [
      { transform: 'perspective(400px) rotateY(90deg) translateY(-6px)', opacity: 0.4 },
      { transform: 'perspective(400px) rotateY(0) translateY(0)', opacity: 1 },
    ], { duration: 320, delay, easing: 'ease-out', fill: 'backwards' });
  }

  // ================= table: state & render =================
  function setTableState(ts) {
    S.prevTs = S.ts && S.ts.id === ts.id ? S.ts : null;
    S.ts = ts;
    S.tsAt = performance.now();
    if (ts.mySeat >= 0) S.myTables.add(ts.id); else S.myTables.delete(ts.id);
    renderTable();
    maybeRunPreAction();
    if (S.sideTab === 'hands' && S.prevTs && S.prevTs.result == null && ts.result) loadHands();
  }

  function renderTable() {
    const t = S.ts;
    if (!t) return;
    const prev = S.prevTs;
    const rebuilt = ensureTableDom(t);
    const animate = !rebuilt && !!prev && !document.hidden;
    const newHand = animate && t.handNo !== prev.handNo && t.inHand;

    document.title = `${t.name} — NOIR RIVER`;
    setText($('#t-name'), t.name);
    setText($('#t-meta'), t.tournament
      ? `Sit & Go · ${GAME_NAMES[t.game]}`
      : `${GAME_NAMES[t.game]} · ${fmt(t.sb)}/${fmt(t.bb)} · бай-ин ${fmt(t.minBuyIn)}–${fmt(t.maxBuyIn)}`);
    setText($('#t-hand'), t.handNo ? `Раздача #${t.handNo}` : '');
    renderTourneyBar();

    const result = t.result;
    const winners = new Map();
    if (result) for (const p of result.players) if (p.won > 0) winners.set(p.seat, p);
    const shown = new Map();
    if (result) for (const p of result.players) shown.set(p.seat, p);
    const winCards = new Set();
    if (result && result.showdown) for (const p of winners.values()) (p.best || []).forEach((c) => winCards.add(c));

    // folds: animate the cards away before they disappear
    if (animate && !newHand && prev.handNo === t.handNo) {
      t.seats.forEach((s, i) => {
        const ps = prev.seats[i];
        if (s && ps && i !== t.mySeat && ps.cardCount > 0 && s.cardCount === 0 && s.folded) foldGhosts(T.seats[i].cards);
      });
    }
    // bets swept into the pot at the end of a street
    const swept = [];
    if (animate && prev.handNo === t.handNo) {
      prev.seats.forEach((ps, i) => { if (ps && ps.bet > 0 && (!t.seats[i] || t.seats[i].bet === 0)) swept.push(i); });
    }
    // a new hand starts with a clean slate of cards
    if (newHand || (prev && t.handNo !== prev.handNo)) {
      T.seats.forEach((r) => { r.cards._codes = []; });
      $('#board')._codes = [];
    }

    // board & pot
    const freshBoard = setCards($('#board'), t.board.map((c) => ({ code: c, cls: winCards.size ? (winCards.has(c) ? 'win' : 'dim') : '' })));
    const potShown = t.inHand ? t.potBehind : 0;
    show($('#pot'), potShown > 0);
    setText($('#pot-amount'), `Банк ${fmt(potShown)}`);

    const res = $('#result');
    if (result) {
      res.replaceChildren(...result.pots.map((p) => h('div', null,
        result.pots.length > 1 ? `${p.name}: ` : '',
        h('b', null, p.winners.map((w) => w.name).join(', ')),
        p.winners.length > 1 ? ' делят ' : ' забирает ',
        h('b', null, fmt(p.amount)),
        p.winners[0].hand ? ` — ${p.winners[0].hand}` : '')));
      res.hidden = false;
    } else if (t.finished) {
      const info = t.tournamentInfo;
      const w = info && info.results.find((r) => r.place === 1);
      res.replaceChildren(h('div', null, 'Турнир завершён', w ? ' · победитель ' : '', w ? h('b', null, w.name) : ''));
      res.hidden = false;
    } else if (!t.inHand) {
      const seated = t.seats.filter(Boolean).length;
      res.replaceChildren(seated < 2 ? 'Ждём второго игрока…' : 'Новая раздача через пару секунд…');
      res.hidden = false;
    } else {
      res.hidden = true;
    }

    // seats
    const freshDeal = [];
    const freshReveal = [];
    t.seats.forEach((s, i) => {
      const r = T.seats[i];
      const isTurn = t.toAct === i;
      show(r.sit, !s && t.mySeat === -1 && !t.tournament);
      show(r.emptyLabel, !s && (t.mySeat !== -1 || t.tournament));
      show(r.box, !!s);
      show(r.bet, !!s && s.bet > 0);
      if (!s) {
        r.root.className = 'seat';
        setCards(r.cards, []);
        return;
      }
      const win = winners.get(i);
      r.root.className = ['seat', i === t.mySeat && 'me', isTurn && 'turn', s.folded && s.inHand && 'folded',
        (s.sittingOut || !s.inHand) && !isTurn && 'out', win && 'winner'].filter(Boolean).join(' ');

      let list = [];
      if (s.cards) {
        const best = win && result.showdown ? new Set(win.best || []) : null;
        list = s.cards.map((c) => ({ code: c, cls: s.folded ? 'dim' : best ? (best.has(c) ? 'win' : '') : '' }));
      } else if (s.cardCount) {
        list = Array.from({ length: s.cardCount }, () => ({ code: null }));
      }
      const fresh = setCards(r.cards, list);
      if (newHand) freshDeal.push(...fresh.map((el) => ({ el, i })));
      else if (animate && fresh.length && s.cards) freshReveal.push(...fresh);

      setText(r.name, s.name);
      r.name.title = s.name;
      setText(r.stack, fmt(s.stack));
      setText(r.avatar, initials(s.name));
      r.avatar.style.setProperty('--hue', hueOf(s.name));
      const sh = shown.get(i);
      setText(r.hand, sh && sh.hand && result.showdown ? sh.hand : '');
      show(r.hand, !!(sh && sh.hand && result.showdown));
      show(r.offline, !s.connected);
      show(r.timer, isTurn);

      let tagText = '';
      let tagCls = 'seat-tag';
      if (win) { tagText = `+${fmt(win.won)}`; tagCls += ' win'; }
      else if (s.allIn && s.inHand) { tagText = 'Олл-ин'; tagCls += ' allin'; }
      else if (s.lastAction && s.inHand) tagText = s.lastAction;
      else if (s.leaving) tagText = 'Уходит';
      else if (s.sittingOut) tagText = 'Отошёл';
      else if (t.inHand && !s.inHand) tagText = 'Ждёт раздачи';
      const tagChanged = r.tag.textContent !== tagText;
      r.tag.className = tagCls;
      setText(r.tag, tagText);
      show(r.tag, !!tagText);
      if (animate && tagChanged && tagText) {
        anim(r.tag, [{ transform: 'translateX(-50%) scale(.5)', opacity: 0 }, { transform: 'translateX(-50%) scale(1)', opacity: 1 }], { duration: 240, easing: 'cubic-bezier(.2,1.4,.4,1)' });
      }
      setText(r.bet.lastChild, fmt(s.bet));
    });

    // dealer button (slides between seats via CSS transition)
    const showDealer = t.dealer >= 0 && t.seats[t.dealer] && (t.inHand || result);
    show(T.dealerEl, !!showDealer);
    if (showDealer) {
      const g = T.seats[t.dealer].g;
      T.dealerEl.style.left = `${g.dealer.x}%`;
      T.dealerEl.style.top = `${g.dealer.y}%`;
    }

    // ---- animations & sounds ----
    if (animate) {
      if (swept.length) {
        const to = potPoint();
        swept.forEach((i, k) => flyChip(pctToPx(T.seats[i].g.bet), to, k * 40));
        Sound.play('chips', 0.05);
      }
      if (newHand) {
        // deal order: left of the button, one card per player per round
        const order = (i) => (i - t.dealer - 1 + t.maxSeats) % t.maxSeats;
        const bySeat = new Map();
        freshDeal.forEach(({ el, i }) => { if (!bySeat.has(i)) bySeat.set(i, []); bySeat.get(i).push(el); });
        const seatsSorted = [...bySeat.keys()].sort((a, b) => order(a) - order(b));
        seatsSorted.forEach((i, pos) => bySeat.get(i).forEach((el, round) => dealAnim(el, (round * seatsSorted.length + pos) * 75)));
        Sound.play('deal');
      }
      freshBoard.forEach((el, k) => flipAnim(el, k * 120));
      if (freshBoard.length) Sound.play('card');
      freshReveal.forEach((el, k) => flipAnim(el, k * 60));

      // action sounds
      if (!newHand && prev.handNo === t.handNo) {
        let snd = null;
        t.seats.forEach((s, i) => {
          const ps = prev.seats[i];
          if (!s || !ps || s.lastAction === ps.lastAction || !s.lastAction) return;
          const a = s.lastAction;
          if (a === 'Фолд') snd = snd || 'fold';
          else if (a === 'Чек') snd = snd || 'check';
          else if (a !== 'SB' && a !== 'BB') snd = 'chips';
        });
        if (snd) Sound.play(snd);
      }

      // pot to the winners
      if (result && !prev.result) {
        const from = potPoint();
        for (const [seat, p] of winners) {
          const to = pctToPx(T.seats[seat].g.seat);
          const n = clamp(Math.round(Math.log10(p.won + 1) * 2), 3, 9);
          for (let k = 0; k < n; k++) flyChip({ x: from.x + (k % 3 - 1) * 8, y: from.y }, to, 250 + k * 55, k % 4 === 3);
        }
        const iWon = winners.has(t.mySeat);
        Sound.play(iWon ? 'bigwin' : 'win', 0.25);
      }
    }

    renderControls();
    renderSide();

    // my turn
    const turnKey = t.you && t.you.turn ? `${t.handNo}-${t.street}-${t.currentBet}` : '';
    if (turnKey && turnKey !== S.lastTurnKey && !(S.pre && S.pre.hand === t.handNo)) Sound.play('turn');
    S.lastTurnKey = turnKey;
  }

  function renderTourneyBar() {
    const t = S.ts;
    const bar = $('#t-tourney');
    const info = t.tournamentInfo;
    const sep = () => h('span', { class: 'tb-sep', 'aria-hidden': 'true' });
    if (!t.tournament && t.blinds) {
      // cash table with rising blinds
      const b = t.blinds;
      bar.hidden = false;
      bar.replaceChildren(
        h('span', null, h('span', { class: 'tb-label' }, 'Блайнды '), h('b', null, `${fmt(t.sb)}/${fmt(t.bb)}`)),
        sep(),
        h('span', null, h('span', { class: 'tb-label' }, 'Уровень '), h('b', null, b.level)),
        b.next ? sep() : null,
        b.next ? h('span', null, h('span', { class: 'tb-label' }, `Далее ${fmt(b.next.sb)}/${fmt(b.next.bb)} с раздачи `), h('b', null, `#${b.nextAtHand}`)) : null,
        sep(),
        h('span', { class: 'tb-label' }, `Растут каждые ${b.every} раздач`),
      );
      return;
    }
    if (!t.tournament || !info) { bar.hidden = true; return; }
    bar.hidden = false;
    const prizes = info.payouts.map((p, i) => `${i + 1} — ${fmt(p)}`).join(' · ');
    bar.replaceChildren(
      h('span', null, h('span', { class: 'tb-label' }, 'Уровень '), h('b', null, info.level)),
      sep(),
      h('span', null, h('span', { class: 'tb-label' }, 'Блайнды '), h('b', null, `${fmt(info.sb)}/${fmt(info.bb)}`)),
      info.next && info.status === 'running' ? sep() : null,
      info.next && info.status === 'running'
        ? h('span', null, h('span', { class: 'tb-label' }, `Далее ${fmt(info.next.sb)}/${fmt(info.next.bb)} с раздачи `), h('b', null, `#${info.nextAtHand}`))
        : null,
      sep(),
      h('span', null, h('span', { class: 'tb-label' }, 'Игроков '), h('b', null, `${info.alive} / ${info.total}`)),
      sep(),
      h('span', null, h('span', { class: 'tb-label' }, 'Призы: '), h('b', null, prizes)),
    );
  }

  // ================= controls =================
  function myToCall(t) {
    const me = t.seats[t.mySeat];
    return me ? Math.max(0, Math.min(t.currentBet - me.bet, me.stack)) : 0;
  }

  function renderControls() {
    const t = S.ts;
    const box = $('#controls');
    box.replaceChildren();
    const info = t.tournamentInfo;

    if (t.mySeat === -1) {
      let msg;
      if (t.tournament && info && info.myPlace) {
        msg = `Вы заняли ${info.myPlace} место${info.myPrize ? ` и выиграли ${fmt(info.myPrize)}` : ''}. Можно досмотреть турнир.`;
      } else if (t.tournament) msg = 'Вы наблюдаете за турниром.';
      else msg = t.seats.some((s) => !s) ? 'Вы наблюдаете за столом. Нажмите «Сесть» на свободном месте.' : 'Свободных мест нет — можно наблюдать.';
      box.append(h('div', { class: 'ctrl' }, h('span', { class: 'ctrl-msg' }, msg),
        t.tournament ? h('a', { class: 'btn btn-ghost btn-sm', href: '#/' }, 'В лобби') : null));
      return;
    }

    const you = t.you;
    if (you.turn) { box.append(actionPanel(t, you.turn, you)); return; }

    const seat = t.seats[t.mySeat];
    let msg = 'Ждём своего хода…';
    if (t.finished) msg = info && info.myPlace === 1 ? `Победа в турнире! Приз ${fmt(info.myPrize)}` : 'Турнир завершён';
    else if (!t.inHand) msg = 'Ожидание раздачи';
    else if (!seat.inHand) msg = 'Вы сыграете со следующей раздачи';
    else if (seat.folded) msg = 'Вы сбросили карты';
    else if (seat.allIn) msg = 'Вы олл-ин';
    if (you.sittingOut && !t.finished) msg = you.stack > 0 ? (t.tournament ? 'Вы отошли — карты сбрасываются автоматически' : 'Вы пропускаете раздачи') : 'Стек пуст — докупите фишки';

    const waitingInHand = t.inHand && seat.inHand && !seat.folded && !seat.allIn && !you.sittingOut;
    // not dealt in: make the reason impossible to miss
    const notDealt = !t.finished && ((t.inHand && !seat.inHand) || you.sittingOut);
    const ctrl = h('div', { class: 'ctrl' });
    if (waitingInHand) ctrl.append(preActions(t));
    else ctrl.append(h('span', { class: 'ctrl-msg' + (notDealt ? ' ctrl-note' : '') }, msg));

    if (you.canShow) ctrl.append(h('button', { type: 'button', class: 'btn btn-gold btn-sm', onclick: () => call('table:show', { tableId: t.id }) }, 'Показать карты'));
    if (!t.finished) {
      ctrl.append(you.sittingOut && you.stack > 0
        ? h('button', { type: 'button', class: 'btn btn-gold btn-sm', onclick: () => call('table:sitout', { tableId: t.id, value: false }) }, 'Вернуться в игру')
        : h('button', { type: 'button', class: 'btn btn-dark btn-sm', onclick: () => call('table:sitout', { tableId: t.id, value: true }) }, t.tournament ? 'Отойти' : 'Пропускать раздачи'));
    }
    if (you.canRebuy) ctrl.append(h('button', { type: 'button', class: 'btn btn-dark btn-sm', onclick: () => openBuyin('add') }, 'Докупить'));
    if (!t.tournament || t.finished) ctrl.append(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: standUp }, t.finished ? 'Покинуть стол' : 'Встать из-за стола'));
    box.append(ctrl);
  }

  /** Checkboxes that act for you as soon as your turn comes. */
  function preActions(t) {
    const toCall = myToCall(t);
    const p = S.pre && S.pre.hand === t.handNo ? S.pre : null;
    // a fixed "call N" / "check" pre-action is void once the bet changes
    if (p && (p.type === 'call' || p.type === 'check') && p.amount !== toCall) S.pre = null;
    const cur = S.pre && S.pre.hand === t.handNo ? S.pre.type : null;
    const opt = (type, label, amount) => h('button', {
      type: 'button', class: 'pill', 'aria-pressed': cur === type ? 'true' : 'false',
      onclick: () => { S.pre = cur === type ? null : { type, amount, hand: t.handNo }; renderControls(); },
    }, label);
    return h('div', { class: 'pre', role: 'group', 'aria-label': 'Действие заранее' },
      h('span', { class: 'muted small' }, 'Заранее:'),
      opt('checkfold', toCall ? 'Фолд' : 'Чек/Фолд', toCall),
      toCall ? opt('call', `Колл ${fmt(toCall)}`, toCall) : opt('check', 'Чек', 0),
      opt('callany', 'Колл любую', null));
  }

  function maybeRunPreAction() {
    const t = S.ts;
    const p = S.pre;
    if (!p || !t || !t.you || !t.you.turn) return;
    if (p.hand !== t.handNo) { S.pre = null; return; }
    const turn = t.you.turn;
    let type = null;
    if (p.type === 'checkfold') type = turn.canCheck ? 'check' : 'fold';
    else if (p.type === 'check') type = turn.canCheck ? 'check' : null;
    else if (p.type === 'call') type = !turn.canCheck && turn.toCall === p.amount ? 'call' : null;
    else if (p.type === 'callany') type = turn.canCheck ? 'check' : 'call';
    S.pre = null;
    if (!type) { renderControls(); Sound.play('turn'); return; }
    setTimeout(() => call('table:act', { tableId: t.id, type }), 350);
  }

  async function standUp() {
    const t = S.ts;
    const me = t.seats[t.mySeat];
    const live = t.inHand && me && me.inHand && !me.folded;
    if (live && !confirm('Вы в раздаче. Сбросить карты и встать из-за стола?')) return;
    await call('table:stand', { tableId: t.id });
  }

  let raiseClick = null;
  function actionPanel(t, turn, you) {
    const act = (type, amount) => call('table:act', { tableId: t.id, type, amount });
    const kbd = (k) => h('kbd', { 'aria-hidden': 'true' }, k);
    const actions = h('div', { class: 'ctrl-actions' });
    actions.append(h('button', { type: 'button', class: 'btn btn-red', 'data-key': 'fold', onclick: () => act('fold') }, 'Фолд ', kbd('F')));
    if (turn.canCheck) actions.append(h('button', { type: 'button', class: 'btn btn-dark', 'data-key': 'call', onclick: () => act('check') }, 'Чек ', kbd('C')));
    else {
      const allInCall = turn.toCall >= you.stack;
      actions.append(h('button', { type: 'button', class: 'btn btn-dark', 'data-key': 'call', onclick: () => act('call') },
        allInCall ? `Олл-ин ${fmt(turn.toCall)} ` : `Колл ${fmt(turn.toCall)} `, kbd('C')));
    }

    raiseClick = null;
    if (!turn.canRaise) return h('div', { class: 'ctrl' }, actions);

    const key = `${t.handNo}-${t.street}-${t.currentBet}`;
    if (S.raiseKey !== key) { S.raiseKey = key; S.raiseVal = turn.minTo; }
    S.raiseVal = clamp(S.raiseVal, turn.minTo, turn.maxTo);

    const verb = turn.isBet ? 'Бет' : 'Рейз до';
    const label = h('span');
    const raiseBtn = h('button', {
      type: 'button', class: 'btn btn-gold', 'data-key': 'raise',
      onclick: () => act(S.raiseVal >= you.stack + turn.myBet ? 'allin' : 'raise', S.raiseVal),
    }, label, ' ', kbd('R'));
    raiseClick = () => raiseBtn.click();
    const num = h('input', { type: 'number', min: turn.minTo, max: turn.maxTo, step: 1, value: S.raiseVal, 'aria-label': 'Сумма ставки' });
    const slider = h('input', { type: 'range', class: 'range', min: turn.minTo, max: turn.maxTo, step: 1, value: S.raiseVal, 'aria-label': 'Размер ставки' });
    const setVal = (v, from) => {
      S.raiseVal = clamp(Math.round(Number(v) || turn.minTo), turn.minTo, turn.maxTo);
      if (from !== 'num') num.value = S.raiseVal;
      if (from !== 'slider') slider.value = S.raiseVal;
      const isAllIn = S.raiseVal >= you.stack + turn.myBet;
      label.textContent = isAllIn ? `Олл-ин ${fmt(S.raiseVal)}` : `${verb} ${fmt(S.raiseVal)}`;
    };
    slider.addEventListener('input', () => setVal(slider.value, 'slider'));
    num.addEventListener('input', () => setVal(num.value, 'num'));
    num.addEventListener('blur', () => { num.value = S.raiseVal; });
    num.addEventListener('keydown', (e) => { if (e.key === 'Enter') raiseBtn.click(); });
    setVal(S.raiseVal);
    actions.append(raiseBtn);

    const potAfterCall = t.pot + turn.toCall;
    const preset = (lbl, v) => h('button', { type: 'button', class: 'pill', onclick: () => setVal(v) }, lbl);
    const presets = h('div', { class: 'presets' },
      preset('Мин', turn.minTo),
      preset('½ банка', t.currentBet + Math.round(potAfterCall / 2)),
      preset('¾ банка', t.currentBet + Math.round(potAfterCall * 0.75)),
      preset('Банк', t.currentBet + potAfterCall),
      preset(t.game === 'PLO' ? 'Макс' : 'Олл-ин', turn.maxTo));

    return h('div', { class: 'ctrl' },
      h('div', { class: 'raise' }, h('div', { class: 'raise-row' }, num, slider), presets),
      actions);
  }

  // hotkeys: F — fold, C — check/call, R — bet/raise (layout-independent)
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const tag = (e.target && e.target.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag) && e.target.type !== 'range') return;
    if (document.querySelector('dialog[open]')) return;
    if (!S.ts || !S.ts.you || !S.ts.you.turn || $('#table-view').hidden) return;
    const map = { KeyF: 'fold', KeyC: 'call', KeyR: 'raise' };
    const which = map[e.code];
    if (!which) return;
    e.preventDefault();
    if (which === 'raise') { if (raiseClick) raiseClick(); return; }
    const btn = $(`#controls [data-key="${which}"]`);
    if (btn) btn.click();
  });

  // ================= side: chat, hands, log =================
  $$('[data-side-tab]').forEach((tab) => tab.addEventListener('click', () => {
    S.sideTab = tab.dataset.sideTab;
    $$('[data-side-tab]').forEach((x) => { x.classList.toggle('is-active', x === tab); x.setAttribute('aria-selected', x === tab); });
    $('#chat-pane').hidden = S.sideTab !== 'chat';
    $('#hands-pane').hidden = S.sideTab !== 'hands';
    $('#log-pane').hidden = S.sideTab !== 'log';
    if (S.sideTab === 'log') { const l = $('#log'); l.scrollTop = l.scrollHeight; }
    if (S.sideTab === 'hands') loadHands();
  }));

  function renderList(el, items, mk) {
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    el.replaceChildren(...items.map(mk));
    if (atBottom) el.scrollTop = el.scrollHeight;
  }

  let lastChatSig = '';
  let lastLogSig = '';
  function renderSide() {
    const t = S.ts;
    const chatSig = t.chat.length ? t.chat[t.chat.length - 1].t + t.chat.length : '0';
    if (chatSig !== lastChatSig) {
      lastChatSig = chatSig;
      const chat = $('#chat');
      if (!t.chat.length) chat.replaceChildren(h('li', { class: 'sys' }, 'Здесь пока тихо. Поздоровайтесь со столом.'));
      else renderList(chat, t.chat, (m) => h('li', null, h('b', null, m.name), m.text));
    }
    const logSig = t.log.length ? t.log[t.log.length - 1].t + t.log[t.log.length - 1].text : '0';
    if (logSig !== lastLogSig) {
      lastLogSig = logSig;
      renderList($('#log'), t.log, (l) => h('li', { class: l.text.startsWith('—') ? 'sep' : '' }, l.text));
    }
  }

  $('#chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#chat-input');
    const text = input.value.trim();
    if (!text || !S.ts) return;
    const res = await call('table:chat', { tableId: S.ts.id, text });
    if (res) input.value = '';
  });

  async function loadHands() {
    if (!S.ts) return;
    const res = await call('table:history', { tableId: S.ts.id }, true);
    const ul = $('#hands');
    if (!res) return;
    if (!res.hands.length) { ul.replaceChildren(h('li', { class: 'muted small' }, 'Сыгранные раздачи появятся здесь — с пошаговым повтором.')); return; }
    ul.replaceChildren(...res.hands.map((x) => {
      const net = x.myNet;
      return h('li', null, h('button', { type: 'button', class: 'hand-item', onclick: () => openReplay(x.handNo) },
        h('span', { class: 'hn' }, `#${x.handNo}`),
        h('span', { class: 'hw' }, x.winners.join(', ') || '—', x.hand ? ` · ${x.hand}` : ''),
        net == null ? h('span') : h('span', { class: 'net ' + (net > 0 ? 'plus' : net < 0 ? 'minus' : '') }, net > 0 ? `+${fmt(net)}` : fmt(net)),
        h('span', { class: 'hp' }, `Банк ${fmt(x.pot)} · ${fmt(x.sb)}/${fmt(x.bb)}`)));
    }));
  }

  // ================= replay =================
  const R = { data: null, idx: 0, timer: null };

  async function openReplay(handNo) {
    const res = await call('table:replay', { tableId: S.ts.id, handNo });
    if (!res) return;
    R.data = res.replay;
    R.idx = 0;
    stopReplay();
    renderReplay();
    $('#modal-replay').showModal();
  }

  function stopReplay() {
    clearInterval(R.timer);
    R.timer = null;
    $('#rp-play').textContent = 'Воспроизвести';
  }

  function stepReplay(to) {
    if (!R.data) return;
    R.idx = clamp(to, 0, R.data.events.length - 1);
    renderReplay();
  }

  function renderReplay() {
    const d = R.data;
    const e = d.events[R.idx];
    $('#rp-title').textContent = `Раздача #${d.handNo}`;
    $('#rp-sub').textContent = `${GAME_NAMES[d.game]} · блайнды ${fmt(d.sb)}/${fmt(d.bb)} · ${new Date(d.time).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
    $('#rp-street').textContent = STREET_NAMES[e.street] || '';
    const isLast = R.idx === d.events.length - 1;
    const winCards = new Set();
    if (isLast && d.result && d.result.showdown) d.result.players.filter((p) => p.won > 0).forEach((p) => (p.best || []).forEach((c) => winCards.add(c)));
    $('#rp-board').replaceChildren(...e.board.map((c) => cardEl(c, winCards.size ? (winCards.has(c) ? 'win' : 'dim') : '')));
    $('#rp-pot-amount').textContent = `Банк ${fmt(e.pot)}`;

    const winners = new Map();
    if (isLast && d.result) d.result.players.forEach((p) => { if (p.won > 0) winners.set(p.seat, p); });
    $('#rp-players').replaceChildren(...e.players.map((p) => {
      const cards = p.cards ? p.cards.map((c) => cardEl(c, p.folded ? 'dim' : '')) : (p.folded ? [] : Array.from({ length: p.cardCount }, () => cardEl(null)));
      const w = winners.get(p.seat);
      return h('li', { class: [p.folded && 'folded', w && 'active'].filter(Boolean).join(' ') },
        h('span', { class: 'rp-name' },
          h('span', { class: 'avatar', style: `--hue:${hueOf(p.name)};width:28px;height:28px;font-size:11px`, 'aria-hidden': 'true' }, initials(p.name)),
          p.name,
          p.seat === d.dealer ? h('small', null, 'D') : null,
          p.seat === d.mySeat ? h('small', null, 'вы') : null),
        h('span', { class: 'rp-cards' }, cards),
        h('span', { class: 'rp-num' },
          h('b', null, fmt(p.stack)),
          h('span', { class: 'rp-act' }, w ? `+${fmt(w.won)}` : p.bet ? `ставка ${fmt(p.bet)}` : (p.action || ''))));
    }));

    const steps = $('#rp-steps');
    steps.replaceChildren(...d.events.map((ev, k) => h('li', { class: k === R.idx ? 'current' : '' },
      h('button', { type: 'button', onclick: () => { stopReplay(); stepReplay(k); } }, ev.text))));
    const cur = steps.children[R.idx];
    if (cur) cur.scrollIntoView({ block: 'nearest' });
    $('#rp-step').textContent = `Шаг ${R.idx + 1} из ${d.events.length}`;
    $('#rp-first').disabled = $('#rp-prev').disabled = R.idx === 0;
    $('#rp-next').disabled = $('#rp-last').disabled = isLast;
  }

  $('#rp-first').addEventListener('click', () => { stopReplay(); stepReplay(0); });
  $('#rp-prev').addEventListener('click', () => { stopReplay(); stepReplay(R.idx - 1); });
  $('#rp-next').addEventListener('click', () => { stopReplay(); stepReplay(R.idx + 1); });
  $('#rp-last').addEventListener('click', () => { stopReplay(); stepReplay(R.data.events.length - 1); });
  $('#rp-play').addEventListener('click', () => {
    if (R.timer) { stopReplay(); return; }
    if (R.idx >= R.data.events.length - 1) R.idx = 0;
    $('#rp-play').textContent = 'Пауза';
    renderReplay();
    R.timer = setInterval(() => {
      if (R.idx >= R.data.events.length - 1) { stopReplay(); return; }
      stepReplay(R.idx + 1);
    }, 1100);
  });
  $('#modal-replay').addEventListener('close', stopReplay);

  // ================= tournament result =================
  function showSngResult(e) {
    const win = e.place === 1;
    const medal = $('#sng-medal');
    medal.textContent = e.place;
    medal.className = 'sng-medal' + (e.prize ? '' : ' out');
    $('#sng-title').textContent = win ? 'Победа!' : e.prize ? `${e.place} место — в призах!` : `${e.place} место`;
    $('#sng-text').textContent = e.prize
      ? `«${e.name}»: ${e.place} из ${e.total}. Приз ${fmt(e.prize)} фишек уже на балансе.`
      : `«${e.name}»: ${e.place} из ${e.total}. В этот раз без приза — реванш в лобби.`;
    Sound.play(e.prize ? 'bigwin' : 'fold', 0.2);
    setTimeout(() => { if (!$('#modal-sng').open) $('#modal-sng').showModal(); }, 1200);
  }
  $('#sng-lobby').addEventListener('click', () => { $('#modal-sng').close(); S.lobbyTab = 'sng'; $$('[data-lobby-tab]').forEach((x) => { const on = x.dataset.lobbyTab === 'sng'; x.classList.toggle('is-active', on); x.setAttribute('aria-selected', on); }); });

  // ================= timers =================
  function tick() {
    const t = S.ts;
    if (t) {
      const elapsed = performance.now() - S.tsAt;
      if (t.toAct !== -1) {
        const left = Math.max(0, t.turnRemaining - elapsed);
        const frac = left / t.actionTime;
        $$('[data-timer]').forEach((bar) => {
          if (bar.offsetParent === null) return;
          bar.style.transform = `scaleX(${frac})`;
          bar.classList.toggle('low', frac < 0.3);
        });
        // soft ticking during my last 5 seconds
        if (t.you && t.you.turn && left < 5000 && left > 0) {
          const sec = Math.ceil(left / 1000);
          if (sec !== S.tickedAt) { S.tickedAt = sec; Sound.play('tick'); }
        }
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // shared helpers for durak.js
  window.NR = { $, $$, h, fmt, clamp, anim, cardEl, toast, call, Sound, S, hueOf, initials, renderMyTables: () => renderLobby() };

  // ================= boot =================
  if (S.token) startApp(); else showAuth();
})();
