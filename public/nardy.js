/* Long nardy screen: the board seen from your side, dice, moves by tapping a checker and then its target. */
(() => {
  'use strict';
  const { $, $$, h, fmt, call, Sound, S } = window.NR;
  const NR = window.NR;
  const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  const REASON_ME = { oin: 'Все шашки выброшены', mars: 'Марс! Соперник не успел выбросить ни одной шашки', time: 'Соперник трижды не успел сходить', resign: 'Соперник сдался', left: 'Соперник ушёл' };
  const abs = (c, p) => (c === 'w' ? p - 1 : (p + 11) % 24);
  const other = (c) => (c === 'w' ? 'b' : 'w');
  const ownOf = (c, i) => (c === 'w' ? i + 1 : ((i + 12) % 24) + 1);
  /** Moves come in the mover's own point numbers; the board is drawn in the viewer's. 0 = borne off. */
  const toView = (color, p) => (p === 0 ? 0 : ownOf(C.view, abs(color, p)));
  const C = { id: null, st: null, prev: null, at: 0, sel: null, view: 'w', points: [], rollUntil: 0 };
  const send = (ev, extra = {}) => call(ev, { tableId: C.id, ...extra });

  async function open(id) {
    if (C.id === id) return;
    if (C.id) call('bg:unwatch', { tableId: C.id }, true);
    C.id = id; C.st = null; C.prev = null; C.sel = null;
    build();
    const res = await call('bg:watch', { tableId: id });
    if (!res) { location.hash = '#/'; return; }
    onState(res.state);
  }
  function close() { if (C.id) call('bg:unwatch', { tableId: C.id }, true); C.id = null; C.st = null; }

  function onState(st) {
    if (st.id !== C.id) return;
    C.prev = C.st;
    C.st = st;
    C.at = performance.now();
    if (st.mySeat >= 0) (S.myBg ||= new Set()).add(st.id); else if (S.myBg) S.myBg.delete(st.id);
    const view = st.myColor || (st.mySeat === 1 ? 'b' : 'w');
    if (view !== C.view) { C.view = view; build(); }
    const n = st.nardy; const pn = C.prev && C.prev.nardy;
    if (n && n.dice && (!pn || !pn.dice || pn.turnNo !== n.turnNo) && !REDUCE) C.rollUntil = performance.now() + 600;
    if (!n || !n.legal.length || !n.legal.some((m) => m.from === C.sel)) C.sel = null;
    // a checker has just moved: note where it was on screen before the board is redrawn
    let flight = null;
    if (n && pn && !REDUCE && n.played.length > (pn.turnNo === n.turnNo ? pn.played.length : 0)) {
      const m = n.played[n.played.length - 1];
      const color = st.turn;
      const from = toView(color, m.from);
      flight = { color, from, to: toView(color, m.to), rect: checkerRect(from, color) };
    }
    render();
    if (flight) fly(flight);
    effects();
    // my turn is on screen: the server starts my clock from here
    if (n && n.turnKey && n.turnKey !== C.seenKey) { C.seenKey = n.turnKey; requestAnimationFrame(() => call('bg:seen', { tableId: C.id, key: n.turnKey }, true)); }
  }

  // ---------- the board ----------
  // From your side: the top row runs 13 → 24 (your head is top right), the bottom row 12 → 1 (your home is bottom right).
  // The opponent's checkers are drawn on the same absolute points.
  const layout = () => ({ top: [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24], bottom: [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1] });
  function build() {
    const board = $('#bg-board');
    C.points = [];
    const L = layout();
    const row = (list, side) => h('div', { class: `bg-row ${side}` }, ...list.map((p, k) => {
      const el = h('button', { type: 'button', class: `bg-pt ${side} ${k % 2 ? 'odd' : 'even'}${k === 6 ? ' after-bar' : ''}`, 'data-p': p, 'aria-label': `Пункт ${p}`, onclick: () => clickPoint(p) },
        h('i', { class: 'bg-tri', 'aria-hidden': 'true' }), h('span', { class: 'bg-stack' }), h('small', { class: 'bg-num', 'aria-hidden': 'true' }, p));
      C.points[p] = el;
      return el;
    }));
    const tray = h('button', { type: 'button', class: 'bg-tray', id: 'bg-tray', 'aria-label': 'Выбросить шашку', onclick: () => clickPoint(0) },
      h('span', { class: 'bg-off them' }), h('span', { class: 'bg-off me' }));
    board.replaceChildren(h('div', { class: 'bg-field' }, row(L.top, 'top'), h('div', { class: 'bg-mid', id: 'bg-mid' }), row(L.bottom, 'bottom')), tray, h('div', { class: 'bg-layer', id: 'bg-layer' }));
  }

  /** Checkers on my own point p (any colour), seen from C.view. */
  function at(p) {
    const n = C.st && C.st.nardy;
    if (!n) return null;
    return n.points[abs(C.view, p)];
  }

  function render() {
    const st = C.st;
    const n = st.nardy;
    document.title = `${st.name} — нарды — NOIR RIVER`;
    $('#bg-name').textContent = st.name;
    $('#bg-meta').textContent = st.practice ? `Нарды · с компьютером · ${st.turnSec} с на ход` : `Длинные нарды · ставка ${fmt(st.stake)} · ${st.turnSec} с на ход`;
    $('#bg-game').textContent = st.gameNo ? `Партия #${st.gameNo}` : '';
    const mine = n && st.myColor && st.status === 'playing' && st.turn === st.myColor;
    const fromSet = new Set(mine ? n.legal.map((m) => m.from) : []);
    const targets = new Map();
    if (mine && C.sel != null) for (const m of n.legal) if (m.from === C.sel) targets.set(m.to, m);
    const lt = n && n.lastTurn;
    const recent = new Set(n && n.played ? n.played.map((m) => toView(st.turn, m.to)) : []);
    for (let p = 1; p <= 24; p++) {
      const el = C.points[p];
      const x = at(p);
      const stack = el.querySelector('.bg-stack');
      const count = x ? x.n : 0;
      const shown = Math.min(count, 5);
      const want = x ? `${x.c}${count}` : '';
      if (stack.dataset.k !== want) {
        stack.dataset.k = want;
        stack.replaceChildren(...Array.from({ length: shown }, (_, i) => h('i', { class: `bg-ck ${x.c}`, style: `--i:${i}` }, i === shown - 1 && count > 5 ? h('b', null, count) : null)));
      }
      el.classList.toggle('can', fromSet.has(p));
      el.classList.toggle('sel', C.sel === p);
      el.classList.toggle('target', targets.has(p));
      el.classList.toggle('fresh', recent.has(p));
      el.disabled = !(fromSet.has(p) || targets.has(p) || C.sel === p);
      el.setAttribute('aria-label', `Пункт ${p}${count ? `: ${count} ${x.c === C.view ? 'ваших' : 'соперника'}` : ''}`);
    }
    // off trays
    const tray = $('#bg-tray');
    const offMe = n ? n.off[C.view] : 0; const offThem = n ? n.off[other(C.view)] : 0;
    tray.querySelector('.me').replaceChildren(...Array.from({ length: offMe }, () => h('i', { class: `bg-offck ${C.view}` })));
    tray.querySelector('.them').replaceChildren(...Array.from({ length: offThem }, () => h('i', { class: `bg-offck ${other(C.view)}` })));
    tray.classList.toggle('target', targets.has(0));
    tray.disabled = !targets.has(0);
    tray.title = targets.has(0) ? 'Выбросить шашку' : `Выброшено: ваших ${offMe}, соперника ${offThem}`;
    renderMid();
    renderPlayers();
    renderBanner();
    renderStatus();
    renderCtrl();
    renderSide();
    void lt;
  }

  function dieEl(v, used, k) {
    const rolling = performance.now() < C.rollUntil;
    const d = h('span', { class: 'bg-die' + (used ? ' used' : '') + (rolling ? ' rolling' : ''), style: rolling ? `--spin:${k % 2 ? -1 : 1};animation-delay:${-(600 - (C.rollUntil - performance.now()))}ms` : '' },
      ...Array.from({ length: 9 }, (_, i) => h('i', { class: PIPS[v].includes(i) ? 'on' : '' })));
    return d;
  }
  function renderMid() {
    const st = C.st; const n = st.nardy;
    const mid = $('#bg-mid');
    if (!n) { mid.replaceChildren(h('span', { class: 'bg-hint' }, st.status === 'waiting' ? 'Ждём игроков' : '')); return; }
    const parts = [];
    if (n.dice) {
      const all = n.dice[0] === n.dice[1] ? [n.dice[0], n.dice[0], n.dice[0], n.dice[0]] : n.dice.slice();
      const left = n.left.slice();
      const used = all.map((v) => { const k = left.indexOf(v); if (k === -1) return true; left.splice(k, 1); return false; });
      parts.push(h('span', { class: 'bg-dice' + (st.turn === C.view ? ' mine' : '') }, ...all.map((v, k) => dieEl(v, used[k], k))));
    }
    const mine = st.myColor && st.turn === st.myColor && st.status === 'playing';
    if (mine && n.phase === 'roll') parts.push(h('button', { type: 'button', class: 'btn btn-gold bg-roll', onclick: () => send('bg:roll') }, 'Бросить кубики'));
    else if (n.phase === 'move' && mine) parts.push(h('span', { class: 'bg-hint' }, C.sel != null ? 'Куда? Подсвечены доступные пункты' : 'Выберите шашку'));
    else if (n.phase === 'done' && n.dice && !n.played.length && !n.legal.length) parts.push(h('span', { class: 'bg-hint' }, 'Хода нет'));
    else if (st.status === 'playing' && !mine) parts.push(h('span', { class: 'bg-hint muted' }, n.phase === 'roll' ? 'Соперник бросает кубики…' : 'Ходит соперник'));
    mid.replaceChildren(...parts);
  }

  function renderPlayers() {
    const st = C.st; const n = st.nardy;
    const mineSeat = st.mySeat >= 0 ? st.mySeat : (st.seats[1] && st.seats[1].color === C.view ? 1 : 0);
    for (const pos of ['top', 'bottom']) {
      const i = pos === 'bottom' ? mineSeat : 1 - mineSeat;
      const s = st.seats[i];
      const box = $(`#bg-${pos}`);
      if (!s) {
        box.replaceChildren(h('div', { class: 'ck-pl empty' }, h('span', { class: 'ck-pl-name muted' }, 'Свободное место'),
          st.mySeat < 0 ? h('button', { type: 'button', class: 'btn btn-gold btn-sm', onclick: () => send('bg:sit', { seat: i }) }, st.stake ? `Сесть · ставка ${fmt(st.stake)}` : 'Сесть') : null));
        continue;
      }
      const color = s.color;
      const turn = st.status === 'playing' && st.turn === color;
      box.replaceChildren(h('div', { class: 'ck-pl' + (turn ? ' turn' : '') + (s.connected ? '' : ' off'), 'data-seat': i },
        NR.avatarEl(s.name, s.avatar, 'sm'),
        h('div', { class: 'ck-pl-main' },
          h('b', { class: 'ck-pl-name' }, s.name, i === st.mySeat ? h('span', { class: 'muted' }, ' · вы') : null),
          color && n ? h('small', { class: 'muted' }, `Пипсы ${n.pips[color]} · выброшено ${n.off[color]}`) : h('small', { class: 'muted' }, s.ready ? 'готов к партии' : 'ещё не готов')),
        color ? h('i', { class: `bg-ck mini ${color}`, 'aria-hidden': 'true' }) : (s.ready ? h('span', { class: 'status running' }, 'готов') : null),
        turn ? h('span', { class: 'ck-clock on', 'data-bg-timer': '' }, '') : null));
    }
  }

  function renderBanner() {
    const st = C.st;
    const ban = $('#bg-banner');
    if (st.status === 'result' && st.result) {
      const myWin = st.myColor && st.result.winner === st.myColor;
      const myLoss = st.myColor && st.result.winner && st.result.winner !== st.myColor;
      ban.hidden = false;
      ban.className = 'ck-banner ' + (myWin ? 'win' : myLoss ? 'lose' : 'draw');
      ban.replaceChildren(
        h('b', null, myWin ? (st.result.reason === 'mars' ? 'Марс!' : 'Победа!') : myLoss ? 'Поражение' : `Победа ${st.result.winnerName || ''}`),
        h('span', null, myWin || !st.myColor ? (REASON_ME[st.result.reason] || '') : st.result.text ? st.result.text[0].toUpperCase() + st.result.text.slice(1) : ''),
        myWin && st.stake ? h('small', null, `+${fmt(st.stake)} фишек`) : '');
    } else ban.hidden = true;
  }

  function renderStatus() {
    const st = C.st; const n = st.nardy;
    const el = $('#bg-status');
    if (st.status === 'waiting') {
      const k = st.seats.filter(Boolean).length;
      el.textContent = k < 2 ? 'Ждём соперника — позовите друга кнопкой «Пригласить»' : st.mySeat >= 0 ? (st.practice ? 'Нажмите «Готов» — компьютер уже ждёт' : `Нажмите «Готов» — ставка ${fmt(st.stake)} спишется, когда готовы оба`) : 'Игроки готовятся к партии';
      return;
    }
    if (st.status === 'result') { el.textContent = 'Следующая партия — когда оба нажмут «Готов»'; return; }
    if (!n) { el.textContent = ''; return; }
    const mine = st.myColor && st.turn === st.myColor;
    if (n.waiting) { el.textContent = n.waiting.seat === st.mySeat ? 'Связь восстановлена — ваш ход' : `${n.waiting.name}: связь прервалась, ждём…`; return; }
    el.textContent = mine ? (n.phase === 'roll' ? 'Ваш ход — бросайте кубики' : n.phase === 'done' ? 'Ход сделан' : 'Ваш ход') : st.myColor ? 'Ход соперника' : `Ход ${st.turn === 'w' ? 'белых' : 'чёрных'}`;
  }

  function renderCtrl() {
    const st = C.st; const n = st.nardy;
    const box = $('#bg-ctrl');
    const btns = [];
    const me = st.mySeat >= 0 ? st.seats[st.mySeat] : null;
    if (me && st.status === 'waiting') {
      btns.push(h('button', { type: 'button', class: 'btn ' + (me.ready ? 'btn-ghost' : 'btn-gold'), onclick: () => send('bg:ready', { value: !me.ready }) }, me.ready ? 'Не готов' : st.stake ? `Готов · ставка ${fmt(st.stake)}` : 'Готов'));
      btns.push(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => send('bg:leave') }, 'Встать из-за доски'));
    }
    if (me && st.status === 'playing') {
      if (n && n.canUndo) btns.push(h('button', { type: 'button', class: 'btn btn-dark', onclick: () => { C.sel = null; send('bg:undo'); } }, 'Отменить ход'));
      btns.push(h('button', { type: 'button', class: 'btn btn-red', onclick: () => { if (confirm(st.stake ? `Сдаться? Ставка ${fmt(st.stake)} уйдёт сопернику.` : 'Сдаться?')) send('bg:resign'); } }, 'Сдаться'));
    }
    if (me && st.status === 'result') btns.push(h('button', { type: 'button', class: 'btn btn-gold', onclick: () => send('bg:ready', { value: true }) }, 'Ещё партию'));
    box.replaceChildren(...btns);
  }

  // ---------- moving ----------
  async function clickPoint(p) {
    const st = C.st; const n = st && st.nardy;
    if (!n || !st.myColor || st.turn !== st.myColor) return;
    if (C.sel != null) {
      const m = n.legal.find((x) => x.from === C.sel && x.to === p);
      if (m) { C.sel = null; render(); await send('bg:move', { from: m.from, die: m.die }); return; }
    }
    if (n.legal.some((x) => x.from === p)) {
      C.sel = C.sel === p ? null : p;
      // a single possible target: move straight away
      const opts = n.legal.filter((x) => x.from === C.sel);
      if (opts.length === 1 && new Set(n.legal.map((x) => x.from)).size === 1) { C.sel = null; render(); await send('bg:move', { from: opts[0].from, die: opts[0].die }); return; }
      render();
    } else if (C.sel != null) { C.sel = null; render(); }
  }

  // ---------- motion & sound ----------
  /** Screen box of the top checker on a point (or of the point itself / the tray when empty). */
  function checkerRect(p, color) {
    if (p === 0) return $(`#bg-tray .${color === C.view ? 'me' : 'them'}`).getBoundingClientRect();
    const stack = C.points[p].querySelector('.bg-stack');
    const top = stack.querySelector('.bg-ck:last-child');
    return (top || stack).getBoundingClientRect();
  }
  let flightChain = Promise.resolve();
  /** The moved checker flies from its old place to its new one in an arc that stays over the board. */
  function fly(f) {
    const board = $('#bg-board').getBoundingClientRect();
    const sample = $('#bg-board .bg-stack .bg-ck');
    const size = sample ? sample.getBoundingClientRect().width : 28;
    const dest = f.to ? C.points[f.to].querySelector('.bg-stack .bg-ck:last-child') : null;
    const toRect = dest ? dest.getBoundingClientRect() : checkerRect(f.to, f.color);
    const c = (r) => ({ x: r.left + r.width / 2 - board.left, y: r.top + r.height / 2 - board.top });
    const a = c(f.rect); const b = c(toRect);
    const midY = board.height / 2;
    const m = { x: (a.x + b.x) / 2, y: ((a.y + b.y) / 2) * 0.55 + midY * 0.45 };
    if (dest) dest.style.visibility = 'hidden';
    const run = () => new Promise((resolve) => {
      const layer = $('#bg-layer');
      if (!layer) { resolve(); return; }
      const ghost = h('i', { class: `bg-ck ${f.color} flying`, style: `width:${size}px;height:${size}px;margin:${-size / 2}px 0 0 ${-size / 2}px` });
      layer.append(ghost);
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const anim = ghost.animate([
        { transform: `translate(${a.x}px, ${a.y}px) scale(1)` },
        { transform: `translate(${m.x}px, ${m.y}px) scale(1.18)`, offset: 0.5 },
        { transform: `translate(${b.x}px, ${b.y}px) scale(1)` },
      ], { duration: Math.min(520, 260 + dist * 0.5), easing: 'cubic-bezier(.4,.1,.25,1)' });
      const done = () => { ghost.remove(); if (dest) dest.style.visibility = ''; resolve(); };
      anim.onfinish = done; anim.oncancel = done;
    });
    // quick successive moves (the computer's) fly one after another
    flightChain = flightChain.then(run, run);
  }

  function effects() {
    const st = C.st; const prev = C.prev;
    const n = st.nardy; const pn = prev && prev.nardy;
    if (!prev) return;
    if (prev.status !== 'playing' && st.status === 'playing') Sound.play('deal');
    if (n && n.dice && (!pn || !pn.dice || pn.turnNo !== n.turnNo)) Sound.play('dice');
    if (n && pn && n.played.length > (pn.turnNo === n.turnNo ? pn.played.length : 0)) {
      const m = n.played[n.played.length - 1];
      Sound.play(m.to === 0 ? 'chips' : 'move', 0.05);
    }
    if (st.myColor && st.turn === st.myColor && prev.turn !== st.myColor && st.status === 'playing') Sound.play('turn', 0.15);
    if (prev.status === 'playing' && st.status === 'result' && st.result && st.myColor) Sound.play(st.result.winner === st.myColor ? 'bigwin' : 'fold', 0.1);
  }

  // ---------- side panel ----------
  $$('[data-bg-tab]').forEach((tab) => tab.addEventListener('click', () => {
    const which = tab.dataset.bgTab;
    $$('[data-bg-tab]').forEach((x) => { x.classList.toggle('is-active', x === tab); x.setAttribute('aria-selected', x === tab); });
    for (const k of ['chat', 'log', 'rules']) $(`#bg-${k}-pane`).hidden = which !== k;
  }));
  function fill(el, items, mk) {
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    el.replaceChildren(...items.map(mk));
    if (atBottom) el.scrollTop = el.scrollHeight;
  }
  function renderSide() {
    const st = C.st;
    if (!st.chat.length) $('#bg-chat').replaceChildren(h('li', { class: 'sys' }, 'Здесь пока тихо.'));
    else fill($('#bg-chat'), st.chat, (m) => h('li', null, NR.chatNick(m), m.text));
    fill($('#bg-log'), st.log.slice(-40), (l) => h('li', null, l.text));
  }
  $('#bg-chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#bg-chat-input');
    const text = input.value.trim();
    if (!text || !C.id) return;
    if (await send('bg:chat', { text })) input.value = '';
  });

  function tick() {
    const st = C.st;
    if (st && st.nardy && st.status === 'playing' && !$('#bg-view').hidden) {
      const left = Math.max(0, st.nardy.turnLeft - (performance.now() - C.at));
      const el = $('[data-bg-timer]');
      if (el) { const s = Math.ceil(left / 1000); el.textContent = `0:${String(s).padStart(2, '0')}`; el.classList.toggle('low', left < 10000); }
      const rolling = $$('#bg-mid .bg-die.rolling');
      if (rolling.length && performance.now() >= C.rollUntil) renderMid();
      else if (rolling.length && (tick.n = (tick.n || 0) + 1) % 4 === 0) rolling.forEach((d) => { const f = 1 + Math.floor(Math.random() * 6); [...d.children].forEach((pip, i) => pip.classList.toggle('on', PIPS[f].includes(i))); });
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  window.NardyUI = { open, close, onState };
})();
