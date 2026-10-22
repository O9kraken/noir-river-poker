/* Checkers (русские шашки) screen: board, clocks, moves. */
(() => {
  'use strict';
  const { $, $$, h, fmt, toast, call, Sound, S } = window.NR;
  const NR = window.NR;
  const FILES = 'abcdefgh';
  const sqName = (sq) => FILES[sq % 8] + (8 - Math.floor(sq / 8));
  const REASON_ME = {
    captured: 'Все шашки соперника сбиты', blocked: 'Соперник заперт — ходов нет', time: 'Время соперника вышло', resign: 'Соперник сдался',
    left: 'Соперник ушёл', quiet: '15 ходов дамками без взятий', repetition: 'Позиция повторилась трижды', agreed: 'Ничья по соглашению',
  };

  const START = Array.from({ length: 64 }, (_, sq) => {
    const r = Math.floor(sq / 8);
    if ((r + (sq % 8)) % 2 !== 1) return '';
    return r < 3 ? 'b' : r > 4 ? 'w' : '';
  });
  const C = { id: null, st: null, prev: null, at: 0, sel: [], squares: [], flipped: false };

  async function open(id) {
    if (C.id === id) return;
    if (C.id) call('ck:unwatch', { tableId: C.id }, true);
    C.id = id;
    C.st = null;
    C.prev = null;
    C.sel = [];
    buildBoard();
    const res = await call('ck:watch', { tableId: id });
    if (!res) { location.hash = '#/'; return; }
    onState(res.state);
  }
  function close() { if (C.id) call('ck:unwatch', { tableId: C.id }, true); C.id = null; C.st = null; }
  const send = (ev, extra = {}) => call(ev, { tableId: C.id, ...extra });

  function onState(st) {
    if (st.id !== C.id) return;
    C.prev = C.st;
    C.st = st;
    C.at = performance.now();
    if (st.mySeat >= 0) S.myCk.add(st.id); else S.myCk.delete(st.id);
    const flip = st.myColor === 'b' || (st.myColor == null && st.mySeat === 1 && !st.board);
    if (flip !== C.flipped) { C.flipped = flip; buildBoard(); }
    if (!st.legal.length || (C.prev && C.prev.moves.length !== st.moves.length)) C.sel = [];
    const moved = C.prev && st.lastMove && (!C.prev.lastMove || C.prev.moves.length !== st.moves.length) ? st.lastMove : null;
    render(moved);
    effects();
  }

  // ---------- board ----------
  function buildBoard() {
    const board = $('#ck-board');
    C.squares = [];
    const cells = [];
    for (let i = 0; i < 64; i++) {
      const sq = C.flipped ? 63 - i : i;
      const dark = (Math.floor(sq / 8) + (sq % 8)) % 2 === 1;
      const cell = h('div', { class: 'ck-sq ' + (dark ? 'dark' : 'light'), 'data-sq': sq, role: 'gridcell', 'aria-label': sqName(sq) });
      if (dark) cell.addEventListener('click', () => clickSquare(sq));
      const r = Math.floor(i / 8); const c = i % 8;
      if (c === 0) cell.append(h('span', { class: 'ck-coord row' }, 8 - Math.floor(sq / 8)));
      if (r === 7) cell.append(h('span', { class: 'ck-coord col' }, FILES[sq % 8]));
      C.squares[sq] = cell;
      cells.push(cell);
    }
    board.replaceChildren(...cells, h('div', { class: 'ck-layer', id: 'ck-layer' }));
  }

  const candidates = () => (C.st ? C.st.legal.filter((p) => C.sel.every((x, i) => p[i] === x)) : []);

  async function clickSquare(sq) {
    const st = C.st;
    if (!st || !st.legal.length) return;
    const starts = new Set(st.legal.map((p) => p[0]));
    if (starts.has(sq) && (C.sel.length <= 1)) { C.sel = [sq]; render(); return; }
    if (!C.sel.length) { if (st.board[sq] && st.board[sq].toLowerCase() === st.myColor) toast(st.mustCapture ? 'Бить обязательно — выберите шашку, которая бьёт' : 'Этой шашкой ходить некуда', true); return; }
    const next = candidates().filter((p) => p[C.sel.length] === sq);
    if (!next.length) { C.sel = []; render(); return; }
    C.sel = C.sel.concat(sq);
    const done = next.filter((p) => p.length === C.sel.length);
    const more = next.filter((p) => p.length > C.sel.length);
    if (done.length && !more.length) {
      const path = C.sel;
      C.sel = [];
      const res = await send('ck:move', { path });
      if (!res) render();
      return;
    }
    render();
  }

  // pixel centre of a square inside the board
  function centre(sq) {
    const el = C.squares[sq];
    return { x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop + el.offsetHeight / 2, size: el.offsetWidth };
  }

  function pieceEl(code, sq) {
    const color = code.toLowerCase();
    const king = code !== color;
    return h('div', { class: `ck-piece ${color}${king ? ' king' : ''}`, 'data-sq': sq, 'aria-label': `${color === 'w' ? 'белая' : 'чёрная'} ${king ? 'дамка' : 'шашка'} ${sqName(sq)}` },
      king ? h('span', { class: 'ck-crown', 'aria-hidden': 'true' }, '♛︎') : null);
  }

  function render(moved) {
    const st = C.st;
    if (!st) return;
    document.title = `${st.name} — шашки — NOIR RIVER`;
    $('#ck-name').textContent = st.name;
    $('#ck-meta').textContent = `Русские шашки · ${st.practice ? 'против компьютера, без ставки' : `ставка ${fmt(st.stake)}`} · ${st.clockMin}\u00a0мин\u00a0+\u00a03\u00a0с`;
    $('#ck-game').textContent = st.gameNo ? `Партия #${st.gameNo}` : '';

    // squares: highlights
    const cand = candidates();
    const nextSq = new Set(cand.map((p) => p[C.sel.length]).filter((x) => x != null));
    const starts = new Set(st.legal.map((p) => p[0]));
    const lm = st.lastMove;
    for (let sq = 0; sq < 64; sq++) {
      const el = C.squares[sq];
      if (!el || !el.classList.contains('dark')) continue;
      el.classList.toggle('sel', C.sel.includes(sq));
      el.classList.toggle('target', C.sel.length > 0 && nextSq.has(sq));
      el.classList.toggle('can', !C.sel.length && starts.has(sq));
      el.classList.toggle('last', !!lm && (lm.path[0] === sq || lm.path[lm.path.length - 1] === sq));
    }

    // pieces layer (before the first game: the starting position, dimmed)
    const layer = $('#ck-layer');
    const kids = [];
    const board = st.board || START;
    layer.classList.toggle('preview', !st.board);
    {
      board.forEach((code, sq) => {
        if (!code) return;
        const el = pieceEl(code, sq);
        const c = centre(sq);
        el.style.setProperty('--x', `${c.x}px`);
        el.style.setProperty('--y', `${c.y}px`);
        el.style.setProperty('--s', `${c.size}px`);
        if (C.sel[0] === sq) el.classList.add('lift');
        kids.push(el);
      });
    }
    // taken pieces of the last move fade out
    if (moved && C.prev && C.prev.board) {
      for (const sq of moved.captures) {
        const code = C.prev.board[sq];
        if (!code) continue;
        const el = pieceEl(code, sq);
        const c = centre(sq);
        el.classList.add('taken');
        el.style.setProperty('--x', `${c.x}px`); el.style.setProperty('--y', `${c.y}px`); el.style.setProperty('--s', `${c.size}px`);
        kids.push(el);
      }
    }
    layer.replaceChildren(...kids);
    // slide the moved piece along its path
    if (moved) {
      const to = moved.path[moved.path.length - 1];
      const el = layer.querySelector(`.ck-piece[data-sq="${to}"]:not(.taken)`);
      if (el && el.animate) {
        const end = centre(to);
        const frames = moved.path.map((sq) => { const c = centre(sq); return { transform: `translate(${c.x - end.x}px, ${c.y - end.y}px)` }; });
        el.animate(frames, { duration: 220 * (moved.path.length - 1) + 60, easing: 'ease-in-out' });
      }
    }

    // players
    const seatFor = (pos) => {
      // bottom: me (or white when watching), top: the other side
      const mine = st.mySeat >= 0 ? st.mySeat : (st.seats[0] && st.seats[0].color === 'b' ? 1 : 0);
      return pos === 'bottom' ? mine : 1 - mine;
    };
    for (const pos of ['top', 'bottom']) {
      const i = seatFor(pos);
      const s = st.seats[i];
      const box = $(`#ck-${pos}`);
      if (!s) {
        box.replaceChildren(h('div', { class: 'ck-pl empty' },
          h('span', { class: 'ck-pl-name muted' }, 'Свободное место'),
          st.mySeat < 0 ? h('button', { type: 'button', class: 'btn btn-gold btn-sm', onclick: () => send('ck:sit', { seat: i }) }, `Сесть · ставка ${fmt(st.stake)}`) : null));
        continue;
      }
      const color = s.color;
      const clockMs = st.clock && color ? st.clock[color] : null;
      const running = st.clock && st.clock.running && st.clock.running === color;
      const cnt = st.counts && color ? st.counts[color] : null;
      box.replaceChildren(h('div', { class: 'ck-pl' + (running ? ' turn' : '') + (s.connected ? '' : ' off'), 'data-seat': i },
        NR.avatarEl(s.name, s.avatar, 'sm'),
        h('div', { class: 'ck-pl-main' },
          h('b', { class: 'ck-pl-name' }, s.name, i === st.mySeat ? h('span', { class: 'muted' }, ' · вы') : null),
          h('small', { class: 'muted' }, color ? `${color === 'w' ? 'белые' : 'чёрные'} · шашек ${cnt}${st.counts && st.counts[color + 'k'] ? `, дамок ${st.counts[color + 'k']}` : ''}` : s.ready ? 'готов к партии' : 'ещё не готов')),
        color ? h('i', { class: `ck-mini ${color}`, 'aria-hidden': 'true' }) : (s.ready ? h('span', { class: 'status running' }, 'готов') : null),
        clockMs != null ? h('span', { class: 'ck-clock' + (running ? ' on' : '') + (clockMs < 20000 ? ' low' : ''), 'data-color': color }, clockText(clockMs)) : null));
    }

    // banner with the result
    const ban = $('#ck-banner');
    if (st.status === 'result' && st.result) {
      const myWin = st.myColor && st.result.winner === st.myColor;
      const myLoss = st.myColor && st.result.winner && st.result.winner !== st.myColor;
      ban.hidden = false;
      ban.className = 'ck-banner ' + (myWin ? 'win' : myLoss ? 'lose' : 'draw');
      ban.replaceChildren(
        h('b', null, st.result.winner ? (myWin ? 'Победа!' : myLoss ? 'Поражение' : `Победа ${st.result.winner === 'w' ? 'белых' : 'чёрных'}`) : 'Ничья'),
        h('span', null, myWin || !st.myColor ? (REASON_ME[st.result.reason] || '') : st.result.text ? st.result.text[0].toUpperCase() + st.result.text.slice(1) : ''),
        myWin && st.stake ? h('small', null, `+${fmt(st.stake)} фишек`) : null);
    } else ban.hidden = true;

    renderStatus();
    renderCtrl();
    renderSide(st);
  }

  const clockText = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  function renderStatus() {
    const st = C.st;
    const el = $('#ck-status');
    if (st.status === 'waiting') {
      const n = st.seats.filter(Boolean).length;
      el.textContent = n < 2 ? 'Ждём соперника — позовите друга кнопкой «Пригласить»' : st.mySeat >= 0 ? (st.practice ? 'Нажмите «Готов» — компьютер уже ждёт' : `Нажмите «Готов» — ставка ${fmt(st.stake)} спишется, когда готовы оба`) : 'Игроки готовятся к партии';
      return;
    }
    if (st.status === 'result') { el.textContent = 'Следующая партия — когда оба нажмут «Готов»'; return; }
    if (st.myColor && st.turn === st.myColor) el.textContent = st.mustCapture ? 'Ваш ход — бить обязательно' : 'Ваш ход';
    else if (st.myColor) el.textContent = 'Ход соперника';
    else el.textContent = `Ход ${st.turn === 'w' ? 'белых' : 'чёрных'}`;
    if (st.drawOffer && st.myColor && st.drawOffer !== st.myColor) el.textContent = 'Соперник предлагает ничью';
  }

  function renderCtrl() {
    const st = C.st;
    const box = $('#ck-ctrl');
    const btns = [];
    const me = st.mySeat >= 0 ? st.seats[st.mySeat] : null;
    if (me && st.status === 'waiting') {
      btns.push(h('button', { type: 'button', class: 'btn ' + (me.ready ? 'btn-ghost' : 'btn-gold'), onclick: () => send('ck:ready', { value: !me.ready }) }, me.ready ? 'Не готов' : st.stake ? `Готов · ставка ${fmt(st.stake)}` : 'Готов'));
      btns.push(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => send('ck:leave') }, 'Встать из-за доски'));
    }
    if (me && st.status === 'playing') {
      if (st.drawOffer && st.drawOffer !== st.myColor) {
        btns.push(h('button', { type: 'button', class: 'btn btn-gold', onclick: () => send('ck:draw') }, 'Согласиться на ничью'));
        btns.push(h('button', { type: 'button', class: 'btn btn-dark', onclick: () => send('ck:declineDraw') }, 'Играть дальше'));
      } else {
        btns.push(h('button', { type: 'button', class: 'btn btn-dark', disabled: st.drawOffer === st.myColor, onclick: () => send('ck:draw') }, st.drawOffer === st.myColor ? 'Ничья предложена' : 'Предложить ничью'));
      }
      btns.push(h('button', { type: 'button', class: 'btn btn-red', onclick: () => { if (confirm(st.stake ? `Сдаться? Ставка ${fmt(st.stake)} уйдёт сопернику.` : 'Сдаться?')) send('ck:resign'); } }, 'Сдаться'));
    }
    if (me && st.status === 'result') btns.push(h('button', { type: 'button', class: 'btn btn-gold', onclick: () => send('ck:ready', { value: true }) }, 'Ещё партию'));
    box.replaceChildren(...btns);
  }

  // ---------- effects ----------
  function effects() {
    const st = C.st; const prev = C.prev;
    if (!prev) return;
    if (st.moves.length > prev.moves.length && st.lastMove) Sound.play(st.lastMove.captures.length ? 'chips' : 'card');
    if (prev.status !== 'playing' && st.status === 'playing') Sound.play('deal');
    if (st.myColor && st.turn === st.myColor && prev.turn !== st.myColor && st.status === 'playing') Sound.play('turn', 0.15);
    if (prev.status === 'playing' && st.status === 'result' && st.result && st.myColor) Sound.play(st.result.winner === st.myColor ? 'bigwin' : st.result.winner ? 'fold' : 'check', 0.1);
  }

  // ---------- side ----------
  $$('[data-ck-tab]').forEach((tab) => tab.addEventListener('click', () => {
    const which = tab.dataset.ckTab;
    $$('[data-ck-tab]').forEach((x) => { x.classList.toggle('is-active', x === tab); x.setAttribute('aria-selected', x === tab); });
    $('#ck-chat-pane').hidden = which !== 'chat';
    $('#ck-log-pane').hidden = which !== 'log';
    $('#ck-rules-pane').hidden = which !== 'rules';
  }));
  function fill(el, items, mk) {
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    el.replaceChildren(...items.map(mk));
    if (atBottom) el.scrollTop = el.scrollHeight;
  }
  function renderSide(st) {
    if (!st.chat.length) $('#ck-chat').replaceChildren(h('li', { class: 'sys' }, 'Здесь пока тихо.'));
    else fill($('#ck-chat'), st.chat, (m) => h('li', null, NR.chatNick(m), m.text));
    const pairs = [];
    for (let i = 0; i < st.moves.length; i += 2) pairs.push([st.moves[i], st.moves[i + 1]]);
    fill($('#ck-log'), pairs.length ? pairs : [], ([w, b], k) => h('li', { class: 'ck-move' }, h('span', { class: 'muted' }, `${k + 1}.`), h('b', null, w), h('b', null, b || '')));
    if (!pairs.length) $('#ck-log').replaceChildren(...st.log.slice(-12).map((l) => h('li', null, l.text)));
  }
  $('#ck-chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#ck-chat-input');
    const text = input.value.trim();
    if (!text || !C.id) return;
    if (await send('ck:chat', { text })) input.value = '';
  });

  // keep pieces in place when the board is resized
  window.addEventListener('resize', () => { if (C.st && !$('#ck-view').hidden) render(); });

  // ---------- clocks ----------
  function tick() {
    const st = C.st;
    if (st && st.clock && st.clock.running && !$('#ck-view').hidden) {
      const el = $(`.ck-clock[data-color="${st.clock.running}"]`);
      if (el) {
        const left = st.clock[st.clock.running] - (performance.now() - C.at);
        el.textContent = clockText(left);
        el.classList.toggle('low', left < 20000);
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  window.CheckersUI = { open, close, onState };
})();
