/* Mafia: players around the table, night actions, day talk and the open vote. */
(() => {
  'use strict';
  const { $, $$, h, fmt, toast, call, Sound, S } = window.NR;
  const NR = window.NR;
  const ROLE = {
    civ: { name: 'Мирный житель', icon: '☺', text: 'Днём ищите мафию в обсуждении и голосуйте. Ночью вы спите.' },
    maf: { name: 'Мафия', icon: '♠', text: 'Ночью вместе с семьёй выберите жертву. Днём не выдайте себя.' },
    don: { name: 'Дон мафии', icon: '♛', text: 'Ваш голос решает при равенстве. Каждую ночь ищите комиссара.' },
    com: { name: 'Комиссар', icon: '★', text: 'Каждую ночь проверяйте одного игрока — узнаете, мафия ли он.' },
    doc: { name: 'Доктор', icon: '✚', text: 'Каждую ночь спасайте одного игрока. Одного и того же — не две ночи подряд.' },
  };
  const MAFIA = new Set(['maf', 'don']);
  const PHASE = { intro: 'Знакомство', night: 'Ночь', morning: 'Утро', day: 'День · обсуждение', vote: 'Голосование', verdict: 'Приговор', result: 'Финал' };
  const C = { id: null, st: null, prev: null, at: 0, nightPick: null, roleShown: null };
  const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const send = (ev, extra = {}) => call(ev, { tableId: C.id, ...extra });

  async function open(id) {
    if (C.id === id) return;
    if (C.id) call('mf:unwatch', { tableId: C.id }, true);
    C.id = id; C.st = null; C.prev = null; C.dying = new Map();
    const res = await call('mf:watch', { tableId: id });
    if (!res) { location.hash = '#/'; return; }
    onState(res.state);
  }
  function close() { if (C.id) call('mf:unwatch', { tableId: C.id }, true); C.id = null; C.st = null; if (window.Music) window.Music.setMood('lounge'); }

  function onState(st) {
    if (st.id !== C.id) return;
    C.prev = C.st;
    C.st = st;
    C.at = performance.now();
    if (st.mySeat >= 0) S.myMf.add(st.id); else S.myMf.delete(st.id);
    render();
    effects();
  }

  /** What clicking a player does right now, for me. */
  function myAction() {
    const st = C.st; const g = st.game; const me = st.me;
    if (!g || !me || !me.alive || st.status !== 'playing') return null;
    if (g.phase === 'night') {
      const a = me.acted || {};
      if (MAFIA.has(me.role) && a.kill == null) return { kind: 'kill', label: 'Выберите жертву' };
      if (me.role === 'don' && a.don == null) return { kind: 'don', label: 'Кого проверить на комиссара?' };
      if (me.role === 'com' && a.check == null) return { kind: 'check', label: 'Кого проверить?' };
      if (me.role === 'doc' && a.heal == null) return { kind: 'heal', label: 'Кого спасти этой ночью?' };
      return null;
    }
    if (g.phase === 'vote' && !me.hasVoted) return { kind: 'vote', label: 'За кого голосуете?' };
    return null;
  }

  async function clickPlayer(seat) {
    const act = myAction();
    if (!act) return;
    const st = C.st;
    if (act.kind === 'vote') {
      if (seat === st.mySeat) { toast('За себя голосовать нельзя', true); return; }
      await send('mf:vote', { target: seat });
      return;
    }
    await send('mf:night', { kind: act.kind, target: seat });
  }

  /** The night sky over the table: stars and a moon, built once. */
  function sky(stage) {
    if (stage.querySelector('.mf-sky')) return;
    const stars = Array.from({ length: 46 }, (_, i) => {
      const x = (i * 37.7) % 100; const y = (i * 53.3) % 62;
      return h('i', { style: `left:${x}%;top:${y}%;--d:${(i % 7) * 0.45}s;--s:${1 + (i % 3)}px` });
    });
    stage.prepend(h('div', { class: 'mf-sky', 'aria-hidden': 'true' }, h('span', { class: 'mf-moon' }), ...stars));
  }

  /** A full-width title card when the phase changes: «Ночь 2», «Утро», «Голосование». */
  function curtain(g) {
    const stage = $('#mf-stage');
    stage.querySelectorAll('.mf-curtain').forEach((x) => x.remove());
    const title = g.phase === 'night' ? `Ночь ${g.day}` : g.phase === 'morning' ? `Утро ${g.day}` : PHASE[g.phase];
    const sub = { intro: 'Роли розданы. Запомните свою.', night: 'Город засыпает. Просыпается мафия…', morning: g.news || 'Город просыпается', day: 'Обсуждайте и ищите мафию', vote: 'Решает большинство', verdict: g.news || '' }[g.phase] || '';
    const el = h('div', { class: 'mf-curtain ' + g.phase, 'aria-hidden': 'true' }, h('b', null, title), sub ? h('span', null, sub) : null);
    stage.append(el);
    setTimeout(() => el.remove(), 2400);
  }

  function render() {
    const st = C.st;
    const g = st.game;
    sky($('#mf-stage'));
    document.title = `${st.name} — мафия — NOIR RIVER`;
    $('#mf-name').textContent = st.name;
    $('#mf-meta').textContent = st.practice ? 'Мафия · с ботами, без ставки' : `Мафия · ставка ${fmt(st.stake)} · ${st.minPlayers}–${st.maxSeats} игроков`;
    $('#mf-game').textContent = st.gameNo ? `Партия #${st.gameNo}` : '';
    const stage = $('#mf-stage');
    stage.classList.toggle('night', !!(g && g.phase === 'night'));
    stage.classList.toggle('vote', !!(g && g.phase === 'vote'));
    stage.classList.toggle('day', !!(g && ['morning', 'day', 'vote', 'verdict'].includes(g.phase) && st.status === 'playing'));
    renderRing();
    renderCenter();
    renderPanel();
    renderSide();
  }

  function renderRing() {
    const st = C.st;
    const g = st.game;
    const ring = $('#mf-ring');
    const center = $('#mf-center');
    const act = myAction();
    // in a game: the players of this game; otherwise the seats
    const people = g ? g.players.map((p) => ({ ...p, avatar: st.seats[p.seat] && st.seats[p.seat].avatar, connected: st.seats[p.seat] ? st.seats[p.seat].connected : false }))
      : st.seats.map((s, i) => s && { seat: i, name: s.name, alive: true, ready: s.ready, avatar: s.avatar, connected: s.connected, waiting: true }).filter(Boolean);
    const n = Math.max(people.length, 1);
    const tally = {};
    if (g && g.votes) for (const t of Object.values(g.votes)) if (t != null) tally[t] = (tally[t] || 0) + 1;
    const me = st.me;
    const kills = me && me.kills ? Object.values(me.kills) : [];
    const myChecks = me && (me.checks || me.donChecks) ? (me.checks || me.donChecks) : [];
    const pg = C.prev && C.prev.game;
    const prevTally = {};
    if (pg && pg.votes) for (const t of Object.values(pg.votes)) if (t != null) prevTally[t] = (prevTally[t] || 0) + 1;
    const wasAlive = (seat) => { const q = pg && pg.players.find((x) => x.seat === seat); return q ? q.alive : null; };
    const pos = {};
    const items = people.map((p, k) => {
      const ang = Math.PI / 2 + (k / n) * Math.PI * 2;
      const x = 50 + 42 * Math.cos(ang);
      const y = 50 + 40 * Math.sin(ang);
      pos[p.seat] = { x, y };
      const dyingFor = dying(p, wasAlive(p.seat));
      const role = p.role ? ROLE[p.role] : null;
      const targetable = act && p.alive && !(act.kind === 'vote' && p.seat === st.mySeat) && !(act.kind === 'kill' && p.role && MAFIA.has(p.role)) && !(act.kind === 'check' && p.seat === st.mySeat) && !(act.kind === 'heal' && me.lastHeal === p.seat);
      const check = myChecks.find((c) => c.seat === p.seat);
      const myPick = me && me.acted && Object.values(me.acted).includes(p.seat);
      const myVote = g && g.votes && g.votes[st.mySeat] === p.seat;
      const cls = ['mf-p', !p.alive && 'dead', p.seat === st.mySeat && 'me', targetable && 'can', (myPick || myVote) && 'picked', kills.includes(p.seat) && 'marked', !p.connected && !p.waiting && 'off', dyingFor !== false && 'dying'].filter(Boolean).join(' ');
      const el = h('button', { type: 'button', class: cls, style: `left:${x}%;top:${y}%` + (dyingFor !== false ? `;--dt:${-Math.round(dyingFor)}ms` : ''), 'data-seat': p.seat, disabled: !targetable, onclick: () => clickPlayer(p.seat), 'aria-label': `${p.name}${p.alive ? '' : ', выбыл'}${role ? `, ${role.name}` : ''}` },
        h('span', { class: 'mf-av' }, NR.avatarEl(p.name, p.avatar, 'sm'), !p.alive ? h('i', { class: 'mf-x', 'aria-hidden': 'true' }) : null),
        h('b', { class: 'mf-pname' }, p.name),
        role ? h('small', { class: 'mf-role r-' + p.role }, role.icon + ' ' + role.name) : p.waiting ? h('small', { class: 'mf-role' }, p.ready ? 'готов' : 'ждёт') : null,
        check ? h('small', { class: 'mf-check ' + ((check.mafia || check.com) ? 'bad' : 'ok') }, me.checks ? (check.mafia ? 'мафия!' : 'не мафия') : (check.com ? 'комиссар!' : 'не комиссар')) : null,
        tally[p.seat] ? h('span', { class: 'mf-votes' + ((tally[p.seat] || 0) > (prevTally[p.seat] || 0) ? ' bump' : '') }, tally[p.seat]) : null,
        g && g.phase === 'day' && p.ready ? h('span', { class: 'mf-ready', title: 'Готов голосовать' }, '✓') : null);
      return el;
    });
    ring.replaceChildren(voteLines(g, pg, pos), ...items, center);
  }

  /** Lines from each voter to their choice; fresh votes are drawn in. */
  function voteLines(g, pg, pos) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'mf-lines');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    if (!g || !g.votes || !['vote', 'verdict'].includes(g.phase)) return svg;
    for (const [from, to] of Object.entries(g.votes)) {
      const a = pos[from]; const b = pos[to];
      if (to == null || !a || !b) continue;
      const fresh = !(pg && pg.votes && pg.votes[from] === to);
      const dx = b.x - a.x; const dy = b.y - a.y; const len = Math.hypot(dx, dy) || 1;
      const cut = Math.min(9, len / 3);
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', a.x + (dx / len) * cut); line.setAttribute('y1', a.y + (dy / len) * cut);
      line.setAttribute('x2', b.x - (dx / len) * cut); line.setAttribute('y2', b.y - (dy / len) * cut);
      line.setAttribute('pathLength', '1');
      line.setAttribute('vector-effect', 'non-scaling-stroke');
      if (fresh && !REDUCE) line.setAttribute('class', 'fresh');
      if (C.st && Number(from) === C.st.mySeat) line.classList.add('mine');
      svg.append(line);
    }
    return svg;
  }

  /** A player who has just died plays the death animation; keep the class through re-renders until it ends. */
  C.dying = new Map();
  function dying(p, was) {
    if (p.alive) { C.dying.delete(p.seat); return false; }
    if (REDUCE) return false;
    const now = performance.now();
    if (was === true && !C.dying.has(p.seat)) C.dying.set(p.seat, now + 2200);
    const until = C.dying.get(p.seat);
    return until != null && now < until ? now - (until - 2200) : false;
  }

  const replace = (el, ...kids) => el.replaceChildren(...kids.filter(Boolean));
  function renderCenter() {
    const st = C.st;
    const g = st.game;
    const box = $('#mf-center');
    if (!g || st.status === 'waiting' || st.status === 'countdown') {
      const seated = st.seats.filter(Boolean).length;
      replace(box,
        h('p', { class: 'mf-phase' }, 'Город ждёт'),
        h('p', { class: 'mf-news' }, st.status === 'countdown' ? 'Раздаём роли…' : seated < st.minPlayers ? `За столом ${seated} из ${st.minPlayers} нужных. Позовите друзей!` : 'Когда все нажмут «Готов», начнётся ночь.'),
        st.result ? resultBox() : null);
      return;
    }
    if (st.status === 'result') { box.replaceChildren(h('p', { class: 'mf-phase' }, PHASE.result), resultBox()); return; }
    const alive = g.players.filter((p) => p.alive).length;
    replace(box,
      h('p', { class: 'mf-phase' }, g.phase === 'night' ? `Ночь ${g.day}` : g.phase === 'morning' ? `Утро ${g.day}` : PHASE[g.phase]),
      h('p', { class: 'mf-timer', 'data-mf-timer': '' }),
      g.phaseMs ? h('span', { class: 'mf-bar ' + g.phase }, h('i', { 'data-mf-bar': '' })) : null,
      g.news && (g.phase === 'morning' || g.phase === 'day') ? h('p', { class: 'mf-news' }, g.news) : null,
      g.phase === 'night' ? h('p', { class: 'mf-news muted' }, 'Город спит. Мафия, комиссар и доктор делают свой выбор.') : null,
      g.phase === 'intro' ? h('p', { class: 'mf-news' }, 'Посмотрите на свою роль внизу. Скоро наступит ночь.') : null,
      h('p', { class: 'mf-count muted small' }, `В игре ${alive} · мафии осталось ${g.mafiaCount}`));
  }

  function resultBox() {
    const st = C.st; const r = st.result;
    const mine = st.me;
    const iWon = mine && r.winners.includes(mine.seat);
    return h('div', { class: 'mf-result ' + (r.side === 'mafia' ? 'maf' : 'town') },
      h('b', null, r.side === 'mafia' ? 'Победила мафия' : 'Победил город'),
      mine ? h('span', null, iWon ? `Вы в команде победителей${r.share ? ` · +${fmt(r.share)}` : ''}` : 'Ваша команда проиграла') : null);
  }

  function renderPanel() {
    const st = C.st;
    const g = st.game;
    const box = $('#mf-panel');
    const parts = [];
    const me = st.me;
    if (me && g && st.status !== 'waiting') {
      const R = ROLE[me.role];
      const key = `${st.gameNo}:${me.role}`;
      if (C.roleShown !== key) { C.roleShown = key; C.roleAt = performance.now(); }
      const since = performance.now() - C.roleAt;
      const reveal = !REDUCE && since < 1700;
      parts.push(h('div', { class: 'mf-card r-' + me.role + (me.alive ? '' : ' dead') + (reveal ? ' reveal' : ''), style: reveal ? `--dt:${-Math.round(since)}ms` : '' },
        h('span', { class: 'mf-card-ico', 'aria-hidden': 'true' }, R.icon),
        h('div', null, h('small', null, 'Ваша роль'), h('b', null, R.name), h('p', null, me.alive ? R.text : 'Вы выбыли — наблюдайте и молчите до конца партии.'))));
      if (MAFIA.has(me.role) && st.status === 'playing') {
        const team = g.players.filter((p) => p.role && MAFIA.has(p.role) && p.seat !== me.seat).map((p) => p.name);
        if (team.length) parts.push(h('p', { class: 'mf-hint' }, `Ваша семья: ${team.join(', ')}`));
      }
    }
    const act = myAction();
    const btns = [];
    if (act) parts.push(h('p', { class: 'mf-hint strong' }, `${act.label} — нажмите на игрока`));
    else if (me && me.alive && g && g.phase === 'night' && st.status === 'playing') parts.push(h('p', { class: 'mf-hint' }, MAFIA.has(me.role) || ['com', 'doc'].includes(me.role) ? 'Выбор сделан. Ждём остальных…' : 'Вы спите. Ночью пишет только мафия.'));
    if (me && me.alive && g && g.phase === 'day' && st.status === 'playing') {
      const ready = g.players.find((p) => p.seat === me.seat).ready;
      btns.push(h('button', { type: 'button', class: 'btn ' + (ready ? 'btn-ghost' : 'btn-gold'), disabled: ready, onclick: () => send('mf:readyVote') }, ready ? 'Ждём остальных…' : 'Готов голосовать'));
    }
    if (me && me.alive && g && g.phase === 'vote' && !me.hasVoted) btns.push(h('button', { type: 'button', class: 'btn btn-dark', onclick: () => send('mf:vote', { target: 'skip' }) }, 'Воздержаться'));
    const mySeat = st.mySeat >= 0 ? st.seats[st.mySeat] : null;
    if (mySeat && (st.status === 'waiting' || st.status === 'countdown')) {
      btns.push(h('button', { type: 'button', class: 'btn ' + (mySeat.ready ? 'btn-ghost' : 'btn-gold'), onclick: () => send('mf:ready', { value: !mySeat.ready }) }, mySeat.ready ? 'Не готов' : st.stake ? `Готов · ${fmt(st.stake)}` : 'Готов'));
      btns.push(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => send('mf:leave') }, 'Встать'));
    }
    if (st.mySeat < 0 && st.status !== 'playing' && st.seats.some((s) => !s)) btns.push(h('button', { type: 'button', class: 'btn btn-gold', onclick: () => send('mf:sit', {}) }, `Сесть за стол${st.stake ? ` · ставка ${fmt(st.stake)}` : ''}`));
    if (mySeat && st.status === 'result') btns.push(h('button', { type: 'button', class: 'btn btn-gold', onclick: () => send('mf:ready', { value: true }) }, 'Ещё партию'));
    if (btns.length) parts.push(h('div', { class: 'mf-actions' }, ...btns));
    box.replaceChildren(...parts);
  }

  // ---------- chat ----------
  $$('[data-mf-tab]').forEach((tab) => tab.addEventListener('click', () => {
    const which = tab.dataset.mfTab;
    $$('[data-mf-tab]').forEach((x) => { x.classList.toggle('is-active', x === tab); x.setAttribute('aria-selected', x === tab); });
    for (const k of ['chat', 'log', 'rules']) $(`#mf-${k}-pane`).hidden = which !== k;
  }));
  function fill(el, items, mk) {
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    el.replaceChildren(...items.map(mk));
    if (atBottom) el.scrollTop = el.scrollHeight;
  }
  function renderSide() {
    const st = C.st;
    const g = st.game;
    const me = st.me;
    if (!st.chat.length) $('#mf-chat').replaceChildren(h('li', { class: 'sys' }, 'Здесь пока тихо.'));
    else fill($('#mf-chat'), st.chat, (m) => (m.sys ? h('li', { class: 'sys mf-sys' + (m.channel === 'maf' ? ' maf' : '') }, m.text) : h('li', { class: m.channel === 'maf' ? 'mf-maf' : '' }, m.channel === 'maf' ? h('span', { class: 'mf-tag' }, 'мафия') : null, NR.chatNick(m), m.text)));
    fill($('#mf-log'), st.log, (l) => h('li', null, l.text));
    const ch = $('#mf-channel');
    const input = $('#mf-chat-input');
    let note = '';
    let can = true;
    if (st.status === 'playing' && g) {
      if (!me) { note = 'Во время партии пишут только игроки'; can = false; }
      else if (!me.alive) { note = 'Выбывшие молчат до конца партии'; can = false; }
      else if (g.phase === 'night') { if (MAFIA.has(me.role)) note = 'Ночь: вас слышит только мафия'; else { note = 'Ночь: город спит'; can = false; } }
    }
    ch.hidden = !note;
    ch.textContent = note;
    ch.classList.toggle('maf', note.startsWith('Ночь: вас'));
    input.disabled = !can;
    input.placeholder = can ? (note ? 'Сообщение семье…' : 'Сообщение городу…') : 'Сейчас писать нельзя';
  }
  $('#mf-chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#mf-chat-input');
    const text = input.value.trim();
    if (!text || !C.id) return;
    if (await send('mf:chat', { text })) input.value = '';
  });

  function effects() {
    const st = C.st; const prev = C.prev;
    if (!prev || !st.game) return;
    const ph = st.game.phase; const pph = prev.game && prev.game.phase;
    if (window.Music) window.Music.setMood(ph === 'night' && st.status === 'playing' ? 'night' : 'lounge');
    const fell = st.game.players.filter((p) => !p.alive && prev.game && prev.game.players.some((q) => q.seat === p.seat && q.alive));
    if (fell.length) Sound.play('death', ph === 'morning' ? 1.2 : 0.3);
    if (st.game.votes && prev.game && prev.game.votes && Object.keys(st.game.votes).length > Object.keys(prev.game.votes).length) Sound.play('check');
    if (ph !== pph && !REDUCE && st.status === 'playing' && !$('#mf-view').hidden) curtain(st.game);
    if (ph !== pph) {
      if (ph === 'intro') Sound.play('deal');
      else if (ph === 'night') Sound.play('night');
      else if (ph === 'morning') Sound.play('morning');
      else if (ph === 'verdict') Sound.play('check');
      else if (ph === 'vote') Sound.play('turn');
      else if (ph === 'result' && st.me && st.result) Sound.play(st.result.winners.includes(st.me.seat) ? 'bigwin' : 'fold');
    }
  }

  function tick() {
    const st = C.st;
    if (st && st.game && st.status === 'playing' && !$('#mf-view').hidden) {
      const el = $('[data-mf-timer]');
      if (el) {
        const left = Math.max(0, st.game.deadlineIn - (performance.now() - C.at));
        const s = Math.ceil(left / 1000);
        el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
        el.classList.toggle('low', left < 10000);
        const bar = $('[data-mf-bar]');
        if (bar && st.game.phaseMs) bar.style.transform = `scaleX(${Math.min(1, left / st.game.phaseMs)})`;
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  window.MafiaUI = { open, close, onState };
})();
