/* Chess screen: board, clocks, moves list, promotion picker. Reuses the checkers styles. */
(() => {
  'use strict';
  const { $, $$, h, fmt, toast, call, Sound, S } = window.NR;
  const NR = window.NR;
  const FILES = 'abcdefgh';
  const sqName = (sq) => FILES[sq % 8] + (8 - Math.floor(sq / 8));
  const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
  const NAMES = { k: 'король', q: 'ферзь', r: 'ладья', b: 'слон', n: 'конь', p: 'пешка' };
  const REASON_ME = {
    mate: 'Мат!', stalemate: 'Пат', material: 'Не хватает фигур для мата', fifty: '50 ходов без взятий', repetition: 'Позиция повторилась трижды',
    time: 'Время соперника вышло', resign: 'Соперник сдался', left: 'Соперник ушёл', agreed: 'Ничья по соглашению',
  };
  const START = 'rnbqkbnrpppppppp' + ''.padEnd(32, '.') + 'PPPPPPPPRNBQKBNR';
  const C = { id: null, st: null, prev: null, at: 0, sel: null, squares: [], flipped: false, promo: null };

  async function open(id) {
    if (C.id === id) return;
    if (C.id) call('ch:unwatch', { tableId: C.id }, true);
    C.id = id; C.st = null; C.prev = null; C.sel = null; C.promo = null;
    buildBoard();
    const res = await call('ch:watch', { tableId: id });
    if (!res) { location.hash = '#/'; return; }
    onState(res.state);
  }
  function close() { if (C.id) call('ch:unwatch', { tableId: C.id }, true); C.id = null; C.st = null; }
  const send = (ev, extra = {}) => call(ev, { tableId: C.id, ...extra });

  function onState(st) {
    if (st.id !== C.id) return;
    C.prev = C.st;
    C.st = st;
    C.at = performance.now();
    if (st.mySeat >= 0) (S.myCh ||= new Set()).add(st.id); else if (S.myCh) S.myCh.delete(st.id);
    const flip = st.myColor === 'b' || (st.myColor == null && st.mySeat === 1 && !st.board);
    if (flip !== C.flipped) { C.flipped = flip; buildBoard(); }
    if (!st.legal.length || (C.prev && C.prev.moves.length !== st.moves.length)) { C.sel = null; hidePromo(); }
    const moved = C.prev && st.lastMove && C.prev.moves.length !== st.moves.length ? st.lastMove : null;
    render(moved);
    effects();
  }

  function buildBoard() {
    const board = $('#ch-board');
    C.squares = [];
    const cells = [];
    for (let i = 0; i < 64; i++) {
      const sq = C.flipped ? 63 - i : i;
      const dark = (Math.floor(sq / 8) + (sq % 8)) % 2 === 1;
      const cell = h('div', { class: 'ck-sq ' + (dark ? 'dark' : 'light'), 'data-sq': sq, role: 'button', 'aria-label': sqName(sq) });
      cell.addEventListener('click', () => clickSquare(sq));
      const r = Math.floor(i / 8); const c = i % 8;
      if (c === 0) cell.append(h('span', { class: 'ck-coord row' }, 8 - Math.floor(sq / 8)));
      if (r === 7) cell.append(h('span', { class: 'ck-coord col' }, FILES[sq % 8]));
      C.squares[sq] = cell;
      cells.push(cell);
    }
    board.replaceChildren(...cells, h('div', { class: 'ck-layer', id: 'ch-layer' }));
    NR.boardKeys(board, cells);
  }

  const isMine = (code) => code && C.st && C.st.myColor && ((code === code.toUpperCase()) === (C.st.myColor === 'w'));

  async function clickSquare(sq) {
    const st = C.st;
    if (!st || !st.legal.length) return;
    const from = new Set(st.legal.map((m) => m.from));
    if (C.sel != null) {
      const m = st.legal.find((x) => x.from === C.sel && x.to === sq);
      if (m) {
        if (m.promo) { showPromo(m.from, m.to); return; }
        const f = C.sel;
        C.sel = null;
        render();
        if (!(await send('ch:move', { from: f, to: sq }))) render();
        return;
      }
    }
    if (from.has(sq)) { C.sel = C.sel === sq ? null : sq; hidePromo(); render(); return; }
    if (st.board && isMine(st.board[sq])) toast(st.check === st.myColor ? 'Шах! Этой фигурой его не закрыть' : 'Этой фигурой ходить некуда', true);
    C.sel = null;
    render();
  }

  function showPromo(from, to) {
    const box = $('#ch-promo');
    const white = C.st.myColor === 'w';
    box.replaceChildren(h('span', null, 'Превратить в:'), ...['q', 'r', 'b', 'n'].map((p) => h('button', {
      type: 'button', class: `ch-promo-btn ${white ? 'w' : 'b'}`, 'aria-label': NAMES[p],
      onclick: async () => { hidePromo(); C.sel = null; render(); if (!(await send('ch:move', { from, to, promo: p }))) render(); },
    }, GLYPH[p] + '︎')), h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { hidePromo(); } }, 'Отмена'));
    box.hidden = false;
    C.promo = { from, to };
  }
  function hidePromo() { const b = $('#ch-promo'); if (b) b.hidden = true; C.promo = null; }

  function centre(sq) {
    const el = C.squares[sq];
    return { x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop + el.offsetHeight / 2, size: el.offsetWidth };
  }
  function pieceEl(code, sq) {
    const white = code === code.toUpperCase();
    const t = code.toLowerCase();
    return h('div', { class: `ch-piece ${white ? 'w' : 'b'}`, 'data-sq': sq, 'aria-label': `${white ? 'белый' : 'чёрный'} ${NAMES[t]} ${sqName(sq)}` }, GLYPH[t] + '︎');
  }

  const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** Slide a piece in an arc: lifted in the middle, a soft landing. */
  function glide(layer, from, to, delay) {
    const el = layer.querySelector(`.ch-piece:not(.taken)[data-sq="${to}"]`);
    if (!el || !el.animate) return;
    const a = centre(from); const b = centre(to);
    const dx = a.x - b.x; const dy = a.y - b.y;
    const dist = Math.hypot(dx, dy);
    const lift = Math.min(0.35, 0.12 + dist / (b.size * 20)) * b.size;
    el.animate([
      { transform: `translate(${dx}px, ${dy}px) scale(1)`, filter: 'drop-shadow(0 2px 2px rgba(0,0,0,.4))' },
      { transform: `translate(${dx / 2}px, ${dy / 2 - lift}px) scale(1.14)`, filter: 'drop-shadow(0 14px 10px rgba(0,0,0,.45))', offset: 0.5 },
      { transform: 'translate(0,0) scale(1)', filter: 'drop-shadow(0 2px 2px rgba(0,0,0,.4))' },
    ], { duration: Math.min(520, 260 + dist * 0.6), delay, easing: 'cubic-bezier(.35,.1,.25,1)', fill: 'backwards' });
  }

  function render(moved) {
    const st = C.st;
    if (!st) return;
    document.title = `${st.name} — шахматы — NOIR RIVER`;
    $('#ch-name').textContent = st.name;
    $('#ch-meta').textContent = `Шахматы · ${st.practice ? 'против компьютера, без ставки' : `ставка ${fmt(st.stake)}`} · ${st.clockMin} мин + 2 с`;
    $('#ch-game').textContent = st.gameNo ? `Партия #${st.gameNo}` : '';
    const targets = new Set(C.sel != null ? st.legal.filter((m) => m.from === C.sel).map((m) => m.to) : []);
    const from = new Set(st.legal.map((m) => m.from));
    const lm = st.lastMove;
    const board = st.board || START.split('').map((c) => (c === '.' ? '' : c));
    const kingInCheck = st.check ? board.findIndex((c) => c === (st.check === 'w' ? 'K' : 'k')) : -1;
    for (let sq = 0; sq < 64; sq++) {
      const el = C.squares[sq];
      el.classList.toggle('sel', C.sel === sq);
      el.classList.toggle('target', targets.has(sq));
      el.classList.toggle('capture', targets.has(sq) && !!board[sq]);
      el.classList.toggle('can', C.sel == null && from.has(sq));
      el.classList.toggle('last', !!lm && (lm.from === sq || lm.to === sq));
      el.classList.toggle('check', sq === kingInCheck);
    }
    const layer = $('#ch-layer');
    layer.classList.toggle('preview', !st.board);
    const kids = [];
    board.forEach((code, sq) => {
      if (!code) return;
      const el = pieceEl(code, sq);
      const c = centre(sq);
      el.style.setProperty('--x', `${c.x}px`); el.style.setProperty('--y', `${c.y}px`); el.style.setProperty('--s', `${c.size}px`);
      if (C.sel === sq) el.classList.add('lift');
      kids.push(el);
    });
    // the piece taken by the last move stays for a moment and falls away
    const prevBoard = C.prev && C.prev.board;
    let takenSq = -1;
    if (moved && prevBoard && moved.captured) takenSq = moved.flag === 'ep' ? moved.to + (moved.color === 'w' ? 8 : -8) : moved.to;
    if (takenSq >= 0 && prevBoard[takenSq] && !REDUCE) {
      const ghost = pieceEl(prevBoard[takenSq], takenSq);
      const c = centre(takenSq);
      ghost.style.setProperty('--x', `${c.x}px`); ghost.style.setProperty('--y', `${c.y}px`); ghost.style.setProperty('--s', `${c.size}px`);
      ghost.classList.add('taken');
      kids.unshift(ghost);
    }
    layer.replaceChildren(...kids);
    if (moved && !REDUCE) {
      glide(layer, moved.from, moved.to, 0);
      // castling: the rook follows the king
      if (moved.flag === 'castle') {
        const kingSide = moved.to > moved.from;
        glide(layer, kingSide ? moved.to + 1 : moved.to - 2, kingSide ? moved.to - 1 : moved.to + 1, 120);
      }
      const sqEl = C.squares[moved.to];
      if (sqEl) { sqEl.classList.remove('land'); void sqEl.offsetWidth; sqEl.classList.add('land'); }
      if (st.check && st.check !== moved.color) { const k = C.squares[board.findIndex((x) => x === (st.check === 'w' ? 'K' : 'k'))]; if (k) k.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { duration: 400, delay: 300 }); }
    } else if (!REDUCE && st.board && C.prev && (!C.prev.board || C.prev.gameNo !== st.gameNo) && !st.moves.length) {
      // a new game: the pieces drop onto the board rank by rank
      layer.querySelectorAll('.ch-piece').forEach((el) => {
        const sq = Number(el.dataset.sq);
        const row = Math.floor(sq / 8);
        const order = row < 4 ? row : 7 - row;
        el.animate([{ transform: 'translateY(-40%) scale(1.15)', opacity: 0 }, { transform: 'translateY(4%) scale(.98)', opacity: 1, offset: 0.75 }, { transform: 'none', opacity: 1 }],
          { duration: 420, delay: order * 90 + (sq % 8) * 25, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'backwards' });
      });
    }

    // players
    const mine = st.mySeat >= 0 ? st.mySeat : (st.seats[0] && st.seats[0].color === 'b' ? 1 : 0);
    for (const pos of ['top', 'bottom']) {
      const i = pos === 'bottom' ? mine : 1 - mine;
      const s = st.seats[i];
      const box = $(`#ch-${pos}`);
      if (!s) {
        box.replaceChildren(h('div', { class: 'ck-pl empty' }, h('span', { class: 'ck-pl-name muted' }, 'Свободное место'),
          st.mySeat < 0 ? h('button', { type: 'button', class: 'btn btn-gold btn-sm', onclick: () => send('ch:sit', { seat: i }) }, `Сесть · ставка ${fmt(st.stake)}`) : null));
        continue;
      }
      const color = s.color;
      const clockMs = st.clock && color ? st.clock[color] : null;
      const running = st.clock && st.clock.running && st.clock.running === color;
      const lost = st.captured && color ? st.captured[color === 'w' ? 'b' : 'w'] : []; // what this side has taken
      const diff = st.counts && color ? st.counts[color] - st.counts[color === 'w' ? 'b' : 'w'] : 0;
      box.replaceChildren(h('div', { class: 'ck-pl' + (running ? ' turn' : '') + (s.connected ? '' : ' off'), 'data-seat': i },
        NR.avatarEl(s.name, s.avatar, 'sm'),
        h('div', { class: 'ck-pl-main' },
          h('b', { class: 'ck-pl-name' }, s.name, i === st.mySeat ? h('span', { class: 'muted' }, ' · вы') : null),
          color ? h('small', { class: `ch-taken ${color === 'w' ? 'of-b' : 'of-w'}` }, lost.map((t) => GLYPH[t] + '︎').join(''), diff > 0 ? h('em', null, ` +${diff}`) : null)
            : h('small', { class: 'muted' }, s.ready ? 'готов к партии' : 'ещё не готов')),
        color ? h('i', { class: `ck-mini ${color}`, 'aria-hidden': 'true' }) : (s.ready ? h('span', { class: 'status running' }, 'готов') : null),
        clockMs != null ? h('span', { class: 'ck-clock' + (running ? ' on' : '') + (clockMs < 20000 ? ' low' : ''), 'data-color': color }, clockText(clockMs)) : null));
    }

    const ban = $('#ch-banner');
    if (st.status === 'result' && st.result) {
      const myWin = st.myColor && st.result.winner === st.myColor;
      const myLoss = st.myColor && st.result.winner && st.result.winner !== st.myColor;
      ban.hidden = false;
      ban.className = 'ck-banner ' + (myWin ? 'win' : myLoss ? 'lose' : 'draw');
      ban.replaceChildren(
        h('b', null, st.result.winner ? (myWin ? 'Победа!' : myLoss ? 'Поражение' : `Победа ${st.result.winner === 'w' ? 'белых' : 'чёрных'}`) : 'Ничья'),
        h('span', null, myWin || !st.myColor ? (REASON_ME[st.result.reason] || '') : st.result.text ? st.result.text[0].toUpperCase() + st.result.text.slice(1) : ''),
        myWin && st.stake ? h('small', null, `+${fmt(st.stake)} фишек`) : '');
    } else ban.hidden = true;

    renderStatus();
    renderCtrl();
    renderSide(st);
  }

  const clockText = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  function renderStatus() {
    const st = C.st;
    const el = $('#ch-status');
    if (st.status === 'waiting') {
      const n = st.seats.filter(Boolean).length;
      el.textContent = n < 2 ? 'Ждём соперника — позовите друга кнопкой «Пригласить»' : st.mySeat >= 0 ? (st.practice ? 'Нажмите «Готов» — компьютер уже ждёт' : `Нажмите «Готов» — ставка ${fmt(st.stake)} спишется, когда готовы оба`) : 'Игроки готовятся к партии';
      return;
    }
    if (st.status === 'result') { el.textContent = 'Следующая партия — когда оба нажмут «Готов»'; return; }
    const check = st.check ? ' · шах!' : '';
    if (st.myColor && st.turn === st.myColor) el.textContent = `Ваш ход${check}`;
    else if (st.myColor) el.textContent = `Ход соперника${check}`;
    else el.textContent = `Ход ${st.turn === 'w' ? 'белых' : 'чёрных'}${check}`;
    if (st.drawOffer && st.myColor && st.drawOffer !== st.myColor) el.textContent = 'Соперник предлагает ничью';
  }

  function renderCtrl() {
    const st = C.st;
    const box = $('#ch-ctrl');
    const btns = [];
    const me = st.mySeat >= 0 ? st.seats[st.mySeat] : null;
    if (me && st.status === 'waiting') {
      btns.push(h('button', { type: 'button', class: 'btn ' + (me.ready ? 'btn-ghost' : 'btn-gold'), onclick: () => send('ch:ready', { value: !me.ready }) }, me.ready ? 'Не готов' : st.stake ? `Готов · ставка ${fmt(st.stake)}` : 'Готов'));
      btns.push(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => send('ch:leave') }, 'Встать из-за доски'));
    }
    if (me && st.status === 'playing') {
      if (st.drawOffer && st.drawOffer !== st.myColor) {
        btns.push(h('button', { type: 'button', class: 'btn btn-gold', onclick: () => send('ch:draw') }, 'Согласиться на ничью'));
        btns.push(h('button', { type: 'button', class: 'btn btn-dark', onclick: () => send('ch:declineDraw') }, 'Играть дальше'));
      } else btns.push(h('button', { type: 'button', class: 'btn btn-dark', disabled: st.drawOffer === st.myColor, onclick: () => send('ch:draw') }, st.drawOffer === st.myColor ? 'Ничья предложена' : 'Предложить ничью'));
      btns.push(h('button', { type: 'button', class: 'btn btn-red', onclick: () => { if (confirm(st.stake ? `Сдаться? Ставка ${fmt(st.stake)} уйдёт сопернику.` : 'Сдаться?')) send('ch:resign'); } }, 'Сдаться'));
    }
    if (me && st.status === 'result') btns.push(h('button', { type: 'button', class: 'btn btn-gold', onclick: () => send('ch:ready', { value: true }) }, 'Ещё партию'));
    box.replaceChildren(...btns);
  }

  function effects() {
    const st = C.st; const prev = C.prev;
    if (!prev) return;
    if (st.moves.length > prev.moves.length && st.lastMove) Sound.play(st.lastMove.captured ? 'capture' : 'move');
    if (prev.status !== 'playing' && st.status === 'playing') Sound.play('deal');
    if (st.myColor && st.turn === st.myColor && prev.turn !== st.myColor && st.status === 'playing') Sound.play('turn', 0.15);
    if (prev.status === 'playing' && st.status === 'result' && st.result && st.myColor) Sound.play(st.result.winner === st.myColor ? 'bigwin' : st.result.winner ? 'fold' : 'check', 0.1);
  }

  $$('[data-ch-tab]').forEach((tab) => tab.addEventListener('click', () => {
    const which = tab.dataset.chTab;
    $$('[data-ch-tab]').forEach((x) => { x.classList.toggle('is-active', x === tab); x.setAttribute('aria-selected', x === tab); });
    $('#ch-chat-pane').hidden = which !== 'chat';
    $('#ch-log-pane').hidden = which !== 'log';
    $('#ch-rules-pane').hidden = which !== 'rules';
  }));
  function fill(el, items, mk) {
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    el.replaceChildren(...items.map(mk));
    if (atBottom) el.scrollTop = el.scrollHeight;
  }
  function renderSide(st) {
    if (!st.chat.length) $('#ch-chat').replaceChildren(h('li', { class: 'sys' }, 'Здесь пока тихо.'));
    else fill($('#ch-chat'), st.chat, (m) => h('li', null, NR.chatNick(m), m.text));
    const pairs = [];
    for (let i = 0; i < st.moves.length; i += 2) pairs.push([st.moves[i], st.moves[i + 1]]);
    if (pairs.length) fill($('#ch-log'), pairs, ([w, b], k) => h('li', { class: 'ck-move' }, h('span', { class: 'muted' }, `${k + 1}.`), h('b', null, w), h('b', null, b || '')));
    else $('#ch-log').replaceChildren(...st.log.slice(-12).map((l) => h('li', null, l.text)));
  }
  $('#ch-chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#ch-chat-input');
    const text = input.value.trim();
    if (!text || !C.id) return;
    if (await send('ch:chat', { text })) input.value = '';
  });
  window.addEventListener('resize', () => { if (C.st && !$('#ch-view').hidden) render(); });

  function tick() {
    const st = C.st;
    if (st && st.clock && st.clock.running && !$('#ch-view').hidden) {
      const el = $(`#ch-view .ck-clock[data-color="${st.clock.running}"]`);
      if (el) {
        const left = st.clock[st.clock.running] - (performance.now() - C.at);
        el.textContent = clockText(left);
        el.classList.toggle('low', left < 20000);
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  window.ChessUI = { open, close, onState };
})();
