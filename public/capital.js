/* «Капитал»: the property board game screen. */
(() => {
  'use strict';
  const { $, $$, h, fmt, toast, call, Sound, S } = window.NR;
  const NR = window.NR;

  // the board (mirrors server/capital/board.js; only names, groups and prices are needed here)
  const GROUPS = {
    brown: ['Уличная еда', '#8B5A3C', 50], sky: ['Кофейни', '#7EC8E3', 50], pink: ['Мода', '#D46A9F', 100], orange: ['Доставка', '#E8913A', 100],
    red: ['Кино и сериалы', '#C8323C', 150], yellow: ['Гаджеты', '#E6C34A', 150], green: ['Финтех и маркет', '#2E9E6A', 200], navy: ['Премиум', '#2F4FA8', 200],
  };
  const st_ = (name, group, price) => ({ kind: 'street', name, group, price });
  const CELLS = [
    { kind: 'start', name: 'Старт' }, st_('Шаурмастер', 'brown', 60), { kind: 'fund', name: 'Фонд' }, st_('Пончик-Ок', 'brown', 60),
    { kind: 'tax', name: 'Подоходный налог', amount: 200 }, { kind: 'pier', name: 'Такси «Шашечка»', price: 200 }, st_('Бобы и Ко', 'sky', 100),
    { kind: 'luck', name: 'Удача' }, st_('Кофекот', 'sky', 100), st_('Лунный латте', 'sky', 120), { kind: 'jail', name: 'Участок' },
    st_('Нитка', 'pink', 140), { kind: 'util', name: 'Ток-Энерго', price: 150 }, st_('Кедики', 'pink', 140), st_('Бархат', 'pink', 160),
    { kind: 'pier', name: 'Рельс-Экспресс', price: 200 }, st_('Корзинкин', 'orange', 180), { kind: 'fund', name: 'Фонд' }, st_('Грядкин', 'orange', 180),
    st_('Ланчбокс', 'orange', 200), { kind: 'rest', name: 'Перерыв' }, st_('Попкорн+', 'red', 220), { kind: 'luck', name: 'Удача' },
    st_('Киноволна', 'red', 220), st_('Сериалити', 'red', 240), { kind: 'pier', name: 'Паром «Нуар»', price: 200 }, st_('Пиксельлаб', 'yellow', 260),
    st_('Зарядкин', 'yellow', 260), { kind: 'util', name: 'Сигналыч', price: 150 }, st_('Квантум', 'yellow', 280), { kind: 'arrest', name: 'Арест' },
    st_('Стеллажкин', 'green', 300), st_('Оборот Банк', 'green', 300), { kind: 'fund', name: 'Фонд' }, st_('Базарчик', 'green', 320),
    { kind: 'pier', name: 'Велопрокат «Педаль»', price: 200 }, { kind: 'luck', name: 'Удача' }, st_('Аэро Нуар', 'navy', 350),
    { kind: 'tax', name: 'Налог на роскошь', amount: 100 }, st_('Ривер Люкс', 'navy', 400),
  ];
  const ICON = { start: '➜', fund: '◆', luck: '?', tax: '%', pier: '⇄', util: '⚡︎', jail: '▦', rest: '☕︎', arrest: '⚑' };
  const round10 = (x) => Math.max(10, Math.round(x / 10) * 10);
  const rentTable = (price) => { const b = Math.max(2, Math.round((price * 0.08) / 2) * 2); return [b, round10(b * 5), round10(b * 14), round10(b * 36), round10(b * 46), round10(b * 58)]; };
  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

  /** Grid position of a cell on the 11×11 board. */
  function place(i) {
    if (i <= 10) return { r: 11, c: 11 - i, side: 'b' };
    if (i <= 19) return { r: 21 - i, c: 1, side: 'l' };
    if (i <= 30) return { r: 1, c: i - 19, side: 't' };
    return { r: i - 29, c: 11, side: 'r' };
  }

  const C = { id: null, st: null, prev: null, at: 0, cells: [], tokens: new Map(), detail: null, tradeWith: null, rollUntil: 0, lastRoll: null, cardKey: null };
  const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ROLL_MS = 650;
  const STEP_MS = 170;
  const send = (ev, extra = {}) => call(ev, { tableId: C.id, ...extra });

  async function open(id) {
    if (C.id === id) return;
    if (C.id) call('cap:unwatch', { tableId: C.id }, true);
    C.id = id; C.st = null; C.prev = null; C.detail = null;
    build();
    const res = await call('cap:watch', { tableId: id });
    if (!res) { location.hash = '#/'; return; }
    onState(res.state);
  }
  function close() { if (C.id) call('cap:unwatch', { tableId: C.id }, true); C.id = null; C.st = null; }

  function build() {
    const board = $('#cap-board');
    const center = $('#cap-center');
    C.cells = CELLS.map((cell, i) => {
      const p = place(i);
      const corner = [0, 10, 20, 30].includes(i);
      const el = h('button', { type: 'button', class: `cap-cell side-${p.side}${corner ? ' corner' : ''} k-${cell.kind}`, style: `grid-row:${p.r};grid-column:${p.c}`, 'data-cell': i, 'aria-label': cell.name, onclick: () => { C.detail = i; renderCenter(); } });
      if (cell.group) el.append(h('i', { class: 'cap-strip', style: `background:${GROUPS[cell.group][1]}` }));
      const mark = window.CapitalBrands && window.CapitalBrands.logo(i);
      if (mark) el.append(mark);
      else if (!cell.group) el.append(h('i', { class: 'cap-ico', 'aria-hidden': 'true' }, ICON[cell.kind] || ''));
      el.append(h('span', { class: 'cap-cname' }, cell.name));
      if (cell.price) el.append(h('small', { class: 'cap-price' }, fmt(cell.price)));
      else if (cell.amount) el.append(h('small', { class: 'cap-price' }, `−${cell.amount}`));
      el.append(h('span', { class: 'cap-houses' }));
      return el;
    });
    board.replaceChildren(...C.cells, center, h('div', { class: 'cap-tokens', id: 'cap-tokens' }));
    C.tokens = new Map();
  }

  function onState(st) {
    if (st.id !== C.id) return;
    C.prev = C.st;
    C.st = st;
    C.at = performance.now();
    if (st.mySeat >= 0) S.myCap.add(st.id); else S.myCap.delete(st.id);
    const g = st.game; const pg = C.prev && C.prev.game;
    if (g && pg && g.moveNo !== pg.moveNo && g.dice && !REDUCE) { C.rollUntil = performance.now() + ROLL_MS; C.lastRoll = g.moveNo; }
    render();
    animateChanges();
    effects();
    // my turn is on screen: my clock starts now (fair on a slow line)
    if (g && g.turnKey && g.turnKey !== C.seenKey) { C.seenKey = g.turnKey; requestAnimationFrame(() => call('cap:seen', { tableId: C.id, key: g.turnKey }, true)); }
  }

  const me = () => { const st = C.st; return st && st.game ? st.game.players.find((p) => p.seat === st.mySeat) : null; };
  const playerBySeat = (seat) => C.st.game && C.st.game.players.find((p) => p.seat === seat);

  function render() {
    const st = C.st;
    document.title = `${st.name} — Капитал — NOIR RIVER`;
    $('#cap-name').textContent = st.name;
    $('#cap-meta').textContent = st.practice ? 'Капитал · против компьютера, без ставки' : `Капитал · ставка ${fmt(st.stake)} · до ${st.maxSeats} игроков${st.timeLimitMin ? ` · ${st.timeLimitMin} мин` : ''}`;
    $('#cap-game').textContent = st.gameNo ? `Партия #${st.gameNo}` : '';
    const g = st.game;
    // cells: owner, houses, mortgage
    CELLS.forEach((cell, i) => {
      const el = C.cells[i];
      const c = g ? g.cells[i] : null;
      const owner = c && c.owner != null ? playerBySeat(c.owner) : null;
      el.style.setProperty('--owner', owner ? owner.color : 'transparent');
      el.classList.toggle('owned', !!owner);
      el.classList.toggle('mortgaged', !!(c && c.mortgaged));
      el.classList.toggle('pending', !!(g && g.pending && g.pending.cell === i));
      el.classList.toggle('picked', C.detail === i);
      const hs = el.querySelector('.cap-houses');
      const n = c ? c.houses : 0;
      if (hs.dataset.n !== String(n)) { hs.dataset.n = n; hs.replaceChildren(...(n === 5 ? [h('b', { class: 'hotel' })] : Array.from({ length: n }, () => h('b')))); }
    });
    renderTokens();
    renderCenter();
    renderPlayers();
    renderSide();
  }

  function cellCenter(i, k = 0, n = 1) {
    const el = C.cells[i];
    const x = el.offsetLeft + el.offsetWidth / 2;
    const y = el.offsetTop + el.offsetHeight / 2;
    const spread = Math.min(el.offsetWidth, el.offsetHeight) * 0.22;
    const ang = n > 1 ? (k / n) * Math.PI * 2 : 0;
    return { x: x + (n > 1 ? Math.cos(ang) * spread : 0), y: y + (n > 1 ? Math.sin(ang) * spread : 0) };
  }

  function renderTokens() {
    const st = C.st;
    const layer = $('#cap-tokens');
    const g = st.game;
    if (!g) { layer.replaceChildren(); C.tokens = new Map(); return; }
    const byCell = {};
    g.players.filter((p) => !p.out).forEach((p) => { (byCell[p.pos] ||= []).push(p.seat); });
    const prevG = C.prev && C.prev.game;
    for (const p of g.players) {
      let el = C.tokens.get(p.seat);
      if (p.out) { if (el) { el.remove(); C.tokens.delete(p.seat); } continue; }
      const list = byCell[p.pos];
      const pt = cellCenter(p.pos, list.indexOf(p.seat), list.length);
      if (!el) {
        el = h('i', { class: 'cap-token', style: `--c:${p.color}`, title: p.name });
        el.append(h('span', null, (p.name || '?').trim()[0].toUpperCase()));
        layer.append(el);
        C.tokens.set(p.seat, el);
        el.style.transform = `translate(${pt.x}px, ${pt.y}px)`;
        continue;
      }
      el.classList.toggle('turn', g.turn === p.seat && st.status === 'playing');
      const old = prevG && prevG.players.find((x) => x.seat === p.seat);
      const target = `translate(${pt.x}px, ${pt.y}px)`;
      if (old && old.pos !== p.pos && el.animate && !REDUCE) {
        // hop cell by cell after the dice land; long jumps (cards, arrest) fly in one arc
        const steps = (p.pos - old.pos + 40) % 40;
        const path = [];
        if (steps > 0 && steps <= 12) for (let k = 0; k <= steps; k++) path.push(cellCenter((old.pos + k) % 40));
        else path.push(cellCenter(old.pos));
        path.push(pt);
        const frames = [];
        const hop = Math.max(10, C.cells[0].offsetWidth * 0.35);
        for (let k = 0; k < path.length - 1; k++) {
          const a = path[k]; const b = path[k + 1];
          const big = path.length === 2;
          frames.push({ transform: `translate(${a.x}px, ${a.y}px) scale(1)`, offset: k / (path.length - 1), easing: 'ease-out' });
          frames.push({ transform: `translate(${(a.x + b.x) / 2}px, ${(a.y + b.y) / 2 - (big ? hop * 3 : hop)}px) scale(${big ? 1.4 : 1.18})`, offset: (k + 0.5) / (path.length - 1), easing: 'ease-in' });
        }
        frames.push({ transform: `${target} scale(1)`, offset: 1 });
        const delay = Math.max(0, C.rollUntil - performance.now());
        const dur = path.length === 2 ? 700 : STEP_MS * (path.length - 1);
        el.animate(frames, { duration: dur, delay, fill: 'backwards' });
        el.animate([{ transform: `${target} scale(1.25, .8)` }, { transform: `${target} scale(1)` }], { duration: 220, delay: delay + dur, easing: 'cubic-bezier(.3,1.6,.5,1)' });
        p._arrive = delay + dur;
      }
      el.style.transform = target;
    }
  }

  function dieEl(n, k = 0) {
    const rolling = performance.now() < C.rollUntil;
    const el = h('span', { class: 'cap-die' + (rolling ? ' rolling' : ''), style: rolling ? `animation-delay:${-(ROLL_MS - (C.rollUntil - performance.now()))}ms;--spin:${k ? -1 : 1}` : '' },
      ...Array.from({ length: 9 }, (_, i) => h('i', { class: PIPS[rolling ? 1 + Math.floor(Math.random() * 6) : n].includes(i) ? 'on' : '' })));
    el.dataset.face = n;
    return el;
  }

  function detailCard(i) {
    const st = C.st;
    const cell = CELLS[i];
    const g = st.game;
    const c = g ? g.cells[i] : null;
    const owner = c && c.owner != null ? playerBySeat(c.owner) : null;
    const mine = owner && owner.seat === st.mySeat;
    const myTurn = g && g.turn === st.mySeat && st.status === 'playing';
    const rows = [];
    if (cell.kind === 'street') {
      const r = rentTable(cell.price);
      rows.push(h('table', { class: 'cap-rent' }, h('tbody', null,
        ...['Аренда', 'Вся отрасль', '1 филиал', '2 филиала', '3 филиала', '4 филиала', 'Флагман'].map((label, k) => {
          const v = k === 0 ? r[0] : k === 1 ? r[0] * 2 : r[k - 1];
          return h('tr', { class: c && ((k >= 2 && c.houses === k - 1) || (k < 2 && !c.houses && owner)) ? 'on' : '' }, h('td', null, label), h('td', null, fmt(v)));
        }))));
      rows.push(h('p', { class: 'muted small' }, `Филиал — ${fmt(GROUPS[cell.group][2])}, залог — ${fmt(cell.price / 2)}`));
    } else if (cell.kind === 'pier') rows.push(h('p', { class: 'muted small' }, 'Аренда: 25 / 50 / 100 / 200 — смотря сколько транспортных компаний у владельца.'));
    else if (cell.kind === 'util') rows.push(h('p', { class: 'muted small' }, 'Аренда: сумма кубиков ×4, если у владельца оба сервиса — ×10.'));
    else if (cell.kind === 'tax') rows.push(h('p', { class: 'muted small' }, `Заплатите банку ${fmt(cell.amount)}.`));
    else rows.push(h('p', { class: 'muted small' }, { start: 'Каждый проход — +200.', fund: 'Возьмите карточку Фонда.', luck: 'Возьмите карточку Удачи.', jail: 'Если просто проходите — вы в гостях.', rest: 'Отдых: ничего не происходит.', arrest: 'Прямиком в Участок.' }[cell.kind] || ''));
    const btns = [];
    if (mine && st.status === 'playing') {
      if (cell.kind === 'street' && myTurn) btns.push(h('button', { type: 'button', class: 'btn btn-gold btn-sm', onclick: () => send('cap:build', { cell: i }) }, c.houses === 4 ? 'Флагман' : 'Филиал +'));
      if (c.houses) btns.push(h('button', { type: 'button', class: 'btn btn-dark btn-sm', onclick: () => send('cap:sell', { cell: i }) }, 'Закрыть филиал'));
      else btns.push(h('button', { type: 'button', class: 'btn btn-dark btn-sm', onclick: () => send('cap:mortgage', { cell: i }) }, c.mortgaged ? `Выкупить · ${fmt(Math.ceil(cell.price * 0.55))}` : `Заложить · +${fmt(cell.price / 2)}`));
    }
    return h('div', { class: 'cap-detail' },
      h('div', { class: 'cap-detail-head', style: cell.group ? `--g:${GROUPS[cell.group][1]}` : '' },
        h('small', null, cell.group ? GROUPS[cell.group][0] : { pier: 'Транспорт', util: 'Сервис' }[cell.kind] || ''),
        h('b', null, cell.name),
        window.CapitalBrands && window.CapitalBrands.TAGS[i] ? h('em', { class: 'cap-tag' }, `«${window.CapitalBrands.TAGS[i]}»`) : null,
        window.CapitalBrands ? window.CapitalBrands.logo(i, 'cap-mark big') : null,
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Закрыть', onclick: () => { C.detail = null; renderCenter(); render(); } }, '×')),
      cell.price ? h('p', { class: 'small' }, `Цена ${fmt(cell.price)} · `, owner ? h('span', { style: `color:${owner.color}` }, `владелец ${owner.name}${c.mortgaged ? ' (заложено)' : ''}`) : 'свободно') : null,
      ...rows,
      btns.length ? h('div', { class: 'cap-actions' }, ...btns) : null);
  }

  function renderCenter() {
    const st = C.st;
    if (!st) return;
    const box = $('#cap-center');
    const g = st.game;
    const parts = [h('div', { class: 'cap-logo', 'aria-hidden': 'true' }, h('b', null, 'КАПИТАЛ'), h('small', null, 'биржа брендов'))];
    if (C.detail != null) { box.replaceChildren(...parts, detailCard(C.detail)); return; }

    if (st.status === 'waiting' || st.status === 'countdown' || !g) {
      const seated = st.seats.filter(Boolean).length;
      const mySeat = st.mySeat >= 0 ? st.seats[st.mySeat] : null;
      const list = h('div', { class: 'cap-seats' }, ...st.seats.map((s, i) => (s
        ? h('span', { class: 'cap-seat' + (s.ready ? ' ready' : '') }, NR.avatarEl(s.name, s.avatar, 'xs'), s.name, s.ready ? h('em', null, '✓') : null)
        : st.mySeat < 0 ? h('button', { type: 'button', class: 'cap-seat free', onclick: () => send('cap:sit', { seat: i }) }, '+ Сесть') : h('span', { class: 'cap-seat free' }, 'свободно'))));
      parts.push(h('p', { class: 'cap-msg' }, st.status === 'countdown' ? 'Партия начинается…' : seated < 2 ? 'Нужно хотя бы двое — позовите друзей' : 'Ждём, когда все нажмут «Готов»'), list);
      const act = [];
      if (mySeat) {
        act.push(h('button', { type: 'button', class: 'btn ' + (mySeat.ready ? 'btn-ghost' : 'btn-gold'), onclick: () => send('cap:ready', { value: !mySeat.ready }) }, mySeat.ready ? 'Не готов' : st.stake ? `Готов · ${fmt(st.stake)}` : 'Готов'));
        act.push(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => send('cap:leave') }, 'Встать'));
      } else if (st.seats.some((s) => !s)) act.push(h('button', { type: 'button', class: 'btn btn-gold', onclick: () => send('cap:sit', {}) }, `Сесть за стол${st.stake ? ` · ставка ${fmt(st.stake)}` : ''}`));
      if (st.result) parts.unshift(resultBox(st.result));
      parts.push(h('div', { class: 'cap-actions' }, ...act));
      box.replaceChildren(...parts);
      return;
    }

    if (st.status === 'result' && st.result) { parts.push(resultBox(st.result)); box.replaceChildren(...parts); return; }

    const cur = playerBySeat(g.turn);
    const mine = me();
    const myTurn = mine && !mine.out && g.turn === mine.seat;
    parts.push(h('div', { class: 'cap-dice' }, ...(g.dice ? g.dice.map((n, k) => dieEl(n, k)) : [dieEl(1), dieEl(1)].map((d) => { d.classList.add('idle'); return d; }))));
    if (g.card) {
      const key = `${g.moveNo}:${g.card.text}`;
      // the card turns over once the token has arrived; the timing survives re-renders
      if (C.cardKey !== key) { C.cardKey = key; C.cardAt = Math.max(performance.now(), C.rollUntil) + 450; }
      const since = performance.now() - C.cardAt;
      const flip = !REDUCE && since < 700;
      parts.push(h('div', { class: `cap-card ${g.card.deck}` + (flip ? ' flip' : ''), style: flip ? `--dt:${-Math.round(since)}ms` : '' }, h('small', null, g.card.deck === 'luck' ? 'Удача' : 'Фонд'), h('span', null, g.card.text)));
    }
    const who = h('p', { class: 'cap-msg' }, h('i', { class: 'cap-dot', style: `background:${cur ? cur.color : '#888'}` }), g.waiting ? `${g.waiting.name}: связь прервалась, ждём…` : myTurn ? 'Ваш ход' : `Ходит ${cur ? cur.name : '…'}`, h('span', { class: 'cap-timer', 'data-cap-timer': '' }));
    parts.push(who);
    if (g.trade) {
      const from = playerBySeat(g.trade.from); const to = playerBySeat(g.trade.to);
      const list = (side) => [...side.cells.map((i) => CELLS[i].name), side.cash ? `${fmt(side.cash)} кредитов` : null].filter(Boolean).join(', ') || 'ничего';
      const t = g.trade;
      parts.push(h('div', { class: 'cap-trade' }, h('b', null, `${from.name} → ${to.name}: обмен`), h('span', null, `Отдаёт: ${list(t.give)}`), h('span', null, `Просит: ${list(t.get)}`),
        to.seat === st.mySeat ? h('div', { class: 'cap-actions' }, h('button', { type: 'button', class: 'btn btn-gold btn-sm', onclick: () => send('cap:tradeAnswer', { accept: true }) }, 'Принять'), h('button', { type: 'button', class: 'btn btn-dark btn-sm', onclick: () => send('cap:tradeAnswer', { accept: false }) }, 'Отказаться'))
          : from.seat === st.mySeat ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => send('cap:tradeAnswer', { accept: false }) }, 'Отозвать') : null));
    }
    const act = [];
    if (myTurn && !g.trade) {
      if (g.phase === 'roll') {
        if (mine.jail) act.push(h('button', { type: 'button', class: 'btn btn-dark', onclick: () => send('cap:bail') }, mine.jailCards ? 'Выйти по карточке' : 'Залог 50'));
        act.push(h('button', { type: 'button', class: 'btn btn-gold', onclick: () => send('cap:roll') }, mine.jail ? 'Бросить на дубль' : 'Бросить кубики'));
      } else if (g.phase === 'buy' && g.pending) {
        const cell = CELLS[g.pending.cell];
        act.push(h('button', { type: 'button', class: 'btn btn-gold', disabled: mine.cash < cell.price, onclick: () => send('cap:buy') }, `Купить за ${fmt(cell.price)}`));
        act.push(h('button', { type: 'button', class: 'btn btn-dark', onclick: () => send('cap:decline') }, 'Не покупать'));
      } else if (g.phase === 'end') act.push(h('button', { type: 'button', class: 'btn btn-gold', onclick: () => send('cap:end') }, 'Завершить ход'));
    }
    if (g.phase === 'buy' && g.pending && !myTurn) parts.push(h('p', { class: 'muted small' }, `${cur.name} думает, покупать ли «${CELLS[g.pending.cell].name}»`));
    if (myTurn && !g.trade) parts.push(h('p', { class: 'muted small cap-hint' }, 'Нажмите на свою компанию, чтобы открыть филиал или заложить; на соперника справа — чтобы предложить обмен.'));
    parts.push(h('div', { class: 'cap-actions' }, ...act));
    box.replaceChildren(...parts);
  }

  function resultBox(r) {
    const mine = C.st.mySeat >= 0 && r.winner.seat === C.st.mySeat;
    return h('div', { class: 'cap-result' + (mine ? ' win' : '') },
      h('b', null, mine ? 'Вы — главный магнат!' : `Победил ${r.winner.name}`),
      h('small', null, r.reason === 'time' ? 'Время вышло — побеждает самый богатый' : 'Остальные обанкротились'),
      h('ol', null, ...r.ranking.map((p) => h('li', null, `${p.name} — ${fmt(p.worth)}`))),
      r.pot ? h('span', null, `Банк: ${fmt(r.pot)} фишек`) : null);
  }

  function renderPlayers() {
    const st = C.st;
    const box = $('#cap-players');
    const g = st.game;
    if (!g) { box.replaceChildren(h('p', { class: 'muted small' }, 'Партия ещё не началась.')); return; }
    const mine = me();
    const canTrade = mine && !mine.out && g.turn === mine.seat && st.status === 'playing' && !g.trade && g.phase !== 'buy';
    box.replaceChildren(...g.players.map((p) => {
      const own = g.cells.map((c, i) => ({ c, i })).filter((x) => x.c.owner === p.seat);
      return h('div', { class: 'cap-pl' + (g.turn === p.seat ? ' turn' : '') + (p.out ? ' out' : ''), style: `--c:${p.color}`, 'data-seat': p.seat },
        h('div', { class: 'cap-pl-head' },
          h('i', { class: 'cap-dot', style: `background:${p.color}` }),
          h('b', null, p.name, p.seat === st.mySeat ? h('span', { class: 'muted' }, ' · вы') : null),
          h('span', { class: 'cap-cash' }, p.out ? 'банкрот' : fmt(p.cash))),
        p.out ? null : h('small', { class: 'muted' }, `Капитал ${fmt(p.worth)}${p.jail ? ' · в Участке' : ''}${p.jailCards ? ' · карточка выхода' : ''}`),
        own.length ? h('div', { class: 'cap-own' }, ...own.map(({ c, i }) => h('button', {
          type: 'button', class: 'cap-own-chip' + (c.mortgaged ? ' mort' : ''), title: CELLS[i].name, style: `--g:${CELLS[i].group ? GROUPS[CELLS[i].group][1] : '#9aa'}`,
          onclick: () => { C.detail = i; render(); },
        }, window.CapitalBrands ? window.CapitalBrands.logo(i, 'cap-mark chip') : null, c.houses ? h('em', null, c.houses === 5 ? '★' : String(c.houses)) : null))) : null,
        canTrade && p.seat !== mine.seat && !p.out ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => openTrade(p) }, 'Предложить обмен') : null);
    }));
  }

  // ---------- trade ----------
  function openTrade(other) {
    const st = C.st;
    const g = st.game;
    const mine = me();
    C.tradeWith = other.seat;
    $('#cap-trade-title').textContent = `Обмен с ${other.name}`;
    $('#cap-trade-get-label').textContent = `${other.name} отдаёт`;
    const tradable = (seat) => g.cells.map((c, i) => ({ c, i })).filter((x) => x.c.owner === seat && !(CELLS[x.i].group && g.cells.some((y, j) => CELLS[j].group === CELLS[x.i].group && y.houses)));
    const boxes = (seat, name) => {
      const list = tradable(seat);
      if (!list.length) return [h('p', { class: 'muted small' }, 'Нечего предложить')];
      return list.map(({ c, i }) => h('label', { class: 'check cap-trade-item' }, h('input', { type: 'checkbox', name, value: i }), h('i', { class: 'cap-dot', style: `background:${CELLS[i].group ? GROUPS[CELLS[i].group][1] : '#9aa'}` }), `${CELLS[i].name}${c.mortgaged ? ' (заложено)' : ''}`));
    };
    $('#cap-trade-give').replaceChildren(...boxes(mine.seat, 'give'));
    $('#cap-trade-get').replaceChildren(...boxes(other.seat, 'get'));
    const f = $('#cap-trade-form');
    f.giveCash.value = 0; f.getCash.value = 0;
    f.giveCash.max = mine.cash; f.getCash.max = other.cash;
    $('#modal-cap-trade').showModal();
  }
  $('#cap-trade-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const pick = (name) => $$(`#cap-trade-form input[name="${name}"]:checked`).map((x) => Number(x.value));
    const res = await send('cap:trade', { offer: { to: C.tradeWith, give: { cells: pick('give'), cash: Number(f.giveCash.value) || 0 }, get: { cells: pick('get'), cash: Number(f.getCash.value) || 0 } } });
    if (res) $('#modal-cap-trade').close();
  });

  // ---------- side ----------
  $$('[data-cap-tab]').forEach((tab) => tab.addEventListener('click', () => {
    const which = tab.dataset.capTab;
    $$('[data-cap-tab]').forEach((x) => { x.classList.toggle('is-active', x === tab); x.setAttribute('aria-selected', x === tab); });
    for (const k of ['players', 'chat', 'log', 'rules']) $(`#cap-${k}-pane`).hidden = which !== k;
  }));
  function fill(el, items, mk) {
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    el.replaceChildren(...items.map(mk));
    if (atBottom) el.scrollTop = el.scrollHeight;
  }
  function renderSide() {
    const st = C.st;
    if (!st.chat.length) $('#cap-chat').replaceChildren(h('li', { class: 'sys' }, 'Здесь пока тихо.'));
    else fill($('#cap-chat'), st.chat, (m) => h('li', null, NR.chatNick(m), m.text));
    fill($('#cap-log'), st.log, (l) => h('li', null, l.text));
  }
  $('#cap-chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#cap-chat-input');
    const text = input.value.trim();
    if (!text || !C.id) return;
    if (await send('cap:chat', { text })) input.value = '';
  });

  /** Money flying up from tokens, fresh ownership flashing, new houses popping up. */
  function animateChanges() {
    const st = C.st; const prev = C.prev;
    if (REDUCE || !prev || !st.game || !prev.game || $('#cap-view').hidden) return;
    const g = st.game; const pg = prev.game;
    const layer = $('#cap-tokens');
    const wait = Math.max(0, C.rollUntil - performance.now());
    for (const p of g.players) {
      const was = pg.players.find((x) => x.seat === p.seat);
      if (!was || was.cash === p.cash || p.out) continue;
      const d = p.cash - was.cash;
      const pt = cellCenter(p.pos);
      const el = h('span', { class: 'cap-money ' + (d > 0 ? 'plus' : 'minus'), style: `left:${pt.x}px;top:${pt.y}px` }, `${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}`);
      layer.append(el);
      const delay = (p._arrive || wait) + 150;
      const a = el.animate([{ transform: 'translate(-50%, -20%) scale(.6)', opacity: 0 }, { transform: 'translate(-50%, -120%) scale(1.1)', opacity: 1, offset: 0.2 }, { transform: 'translate(-50%, -180%) scale(1)', opacity: 1, offset: 0.7 }, { transform: 'translate(-50%, -240%) scale(.95)', opacity: 0 }], { duration: 1500, delay, easing: 'ease-out', fill: 'both' });
      a.onfinish = () => el.remove();
      const row = $(`#cap-players .cap-pl[data-seat="${p.seat}"] .cap-cash`);
      if (row) row.animate([{ color: d > 0 ? '#7FD6A8' : '#E06A72', transform: 'scale(1.25)' }, { color: '', transform: 'scale(1)' }], { duration: 900, delay });
    }
    g.cells.forEach((c, i) => {
      const o = pg.cells[i];
      const el = C.cells[i];
      if (c.owner != null && o.owner !== c.owner) {
        const owner = g.players.find((p) => p.seat === c.owner);
        el.animate([{ boxShadow: `inset 0 0 0 2px ${owner.color}, 0 0 0 0 ${owner.color}` }, { boxShadow: `inset 0 0 0 4px ${owner.color}, 0 0 22px 6px ${owner.color}`, offset: 0.35 }, { boxShadow: `inset 0 0 0 2px ${owner.color}, 0 0 0 0 transparent` }], { duration: 1100, delay: wait });
      }
      if (c.houses > o.houses) {
        const hs = el.querySelectorAll('.cap-houses b');
        const nb = hs[hs.length - 1];
        if (nb) nb.animate([{ transform: 'translateY(-160%) scale(0)', opacity: 0 }, { transform: 'translateY(10%) scale(1.4)', opacity: 1, offset: 0.65 }, { transform: 'none', opacity: 1 }], { duration: 520, easing: 'cubic-bezier(.3,1.4,.5,1)' });
        el.animate([{ filter: 'brightness(1.4)' }, { filter: 'none' }], { duration: 600 });
      }
      if (c.mortgaged !== o.mortgaged) el.animate([{ transform: 'scale(1)' }, { transform: 'scale(.9) rotate(-2deg)' }, { transform: 'scale(1)' }], { duration: 380 });
    });
  }

  function effects() {
    const st = C.st; const prev = C.prev;
    if (!prev || !st.game) return;
    const g = st.game; const pg = prev.game;
    if (!pg || prev.status !== 'playing') { if (st.status === 'playing') Sound.play('deal'); return; }
    if (g.moveNo !== pg.moveNo) Sound.play('dice');
    const mine = me();
    const was = pg.players.find((p) => mine && p.seat === mine.seat);
    const late = Math.max(0, C.rollUntil - performance.now()) / 1000 + 0.4;
    if (mine && was && mine.cash > was.cash) Sound.play('coin', late);
    else if (mine && was && mine.cash < was.cash) Sound.play('pay', late);
    if (g.cells.some((c, i) => c.houses > pg.cells[i].houses)) Sound.play('chips');
    if (mine && g.turn === mine.seat && pg.turn !== mine.seat) Sound.play('turn', 0.2);
    if (st.status === 'result' && prev.status === 'playing' && st.result) Sound.play(st.result.winner.seat === st.mySeat ? 'bigwin' : 'fold');
  }

  window.addEventListener('resize', () => { if (C.st && !$('#cap-view').hidden) renderTokens(); });

  function tick() {
    const st = C.st;
    const rolling = $$('#cap-center .cap-die.rolling');
    if (rolling.length) {
      if (performance.now() >= C.rollUntil) renderCenter();
      else if ((tick.n = (tick.n || 0) + 1) % 4 === 0) rolling.forEach((d) => { const f = 1 + Math.floor(Math.random() * 6); [...d.children].forEach((pip, i) => pip.classList.toggle('on', PIPS[f].includes(i))); });
    }
    if (st && st.game && st.status === 'playing' && !$('#cap-view').hidden) {
      const el = $('[data-cap-timer]');
      if (el) {
        const left = Math.max(0, st.game.deadlineIn - (performance.now() - C.at));
        el.textContent = ` · ${Math.ceil(left / 1000)} с`;
        el.classList.toggle('low', left < 8000);
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  window.CapitalUI = { open, close, onState };
})();
