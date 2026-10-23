/* «Котобомба»: deck, discard, the «Ни за что!» window, my hand. */
(() => {
  'use strict';
  const { h } = window.NR;
  const ICON = {
    bomb: '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="30" cy="38" r="20" fill="currentColor"/><rect x="25" y="14" width="10" height="8" rx="2" fill="currentColor"/><path d="M30 14c4-8 12-8 16-4" stroke="#E9B44C" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="48" cy="9" r="5" fill="#FFB13A"/><circle cx="23" cy="31" r="5" fill="#fff" opacity=".18"/></svg>',
    cat: '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M14 26 18 8l10 10h8l10-10 4 18c3 4 4 8 4 12 0 12-10 20-22 20S10 50 10 38c0-4 1-8 4-12z" fill="currentColor"/><ellipse cx="25" cy="34" rx="3.5" ry="5" fill="#F0D48A"/><ellipse cx="39" cy="34" rx="3.5" ry="5" fill="#F0D48A"/><path d="M29 42h6l-3 3z" fill="#F0D48A"/></svg>',
  };
  const GLYPH = { defuse: '✂', skip: '↷', attack: '⇉', future: '◉', alter: '⟲', shuffle: '⤨', bottom: '⤓', favor: '₽', nope: '✕' };
  const TONE = { bomb: 'boom', defuse: 'blue', skip: 'green', attack: 'red', future: 'violet', alter: 'violet', shuffle: 'amber', bottom: 'amber', favor: 'teal', nope: 'red', c1: 'cat1', c2: 'cat2', c3: 'cat3', c4: 'cat4', c5: 'cat5' };

  function cardEl(k, kinds, { id, sel, onclick, small, tilt = 0, back = false, dim } = {}) {
    if (back) return h('div', { class: 'bk-card back' + (small ? ' sm' : '') }, h('span', { 'aria-hidden': 'true' }, '✶'));
    const K = kinds[k] || { name: k };
    const art = h('span', { class: 'bk-art', 'aria-hidden': 'true' });
    if (k === 'bomb') art.innerHTML = ICON.bomb; else if (K.cat) art.innerHTML = ICON.cat; else art.textContent = GLYPH[k] || '?';
    const tag = onclick ? 'button' : 'div';
    return h(tag, {
      ...(onclick ? { type: 'button', onclick, 'aria-pressed': !!sel } : {}),
      class: `bk-card t-${TONE[k] || 'plain'}${sel ? ' sel' : ''}${small ? ' sm' : ''}${dim ? ' dim' : ''}`,
      style: tilt ? `--tilt:${tilt}deg` : '',
      'data-id': id != null ? id : '',
      title: K.text || '',
    }, art, h('b', null, K.name), small ? null : h('small', null, K.text));
  }

  function render(board, dock, ctx) {
    const { g, st, seat, ui, send } = ctx;
    const K = g.kinds;
    const me = g.players.find((p) => p.seat === seat);
    const myTurn = seat === g.cur && me && me.alive && st.status === 'playing';
    ui.sel ||= [];
    const hand = g.hand || [];
    ui.sel = ui.sel.filter((id) => hand.some((c) => c.id === id));
    const selCards = ui.sel.map((id) => hand.find((c) => c.id === id));
    const selKind = selCards.length ? selCards[0].k : null;
    const needsTarget = selCards.length && (selKind === 'favor' || selCards.length >= 2);
    const playable = myTurn && g.phase === 'turn' && !g.pending;

    // ---------- players ----------
    const strip = window.PartyKit.strip(ctx, g.players, {
      active: [g.cur],
      cls: (p) => (p.alive ? '' : 'dead'),
      extra: (p) => h('span', { class: 'bk-pl-meta' }, p.alive ? `${p.cards} ${p.cards === 1 ? 'карта' : p.cards < 5 ? 'карты' : 'карт'}` : '💥 выбыл', p.seat === g.cur && g.turnsLeft > 1 ? h('em', { class: 'bk-x2' }, `×${g.turnsLeft}`) : null),
      onPick: needsTarget && playable ? (s) => { ui.target = s; ctx.rerender(); } : null,
      pickable: (p) => p.alive && p.seat !== seat && p.cards > 0,
    });
    if (ui.target != null) strip.querySelectorAll(`[data-seat="${ui.target}"]`).forEach((x) => x.classList.add('picked'));

    // ---------- table centre ----------
    const pd = g.pending;
    const deck = h('div', { class: 'bk-deck', id: 'bk-deck' },
      h('div', { class: 'bk-stack', style: `--n:${Math.min(8, Math.ceil(g.deck / 6))}` }, cardEl('x', K, { back: true })),
      h('span', { class: 'bk-deck-n' }, `${g.deck} в колоде`),
      h('span', { class: 'bk-bombs' + (g.deck && g.bombs / g.deck > 0.25 ? ' hot' : '') }, `бомб: ${g.bombs}`, g.deck ? ` · шанс ${Math.round((g.bombs / g.deck) * 100)}%` : ''));
    const pile = h('div', { class: 'bk-pile', id: 'bk-pile' }, ...(g.discard.length ? g.discard.map((k, i) => cardEl(k, K, { small: true, tilt: (i - 1.5) * 7 })) : [h('span', { class: 'muted small' }, 'Сброс')]));
    let center;
    const nope = hand.find((c) => c.k === 'nope');
    if (pd) {
      center = h('div', { class: 'bk-pending' + (pd.nopes % 2 ? ' noped' : '') },
        h('p', { class: 'small muted' }, `${ctx.nameOf(pd.by)} играет`),
        h('b', null, pd.label, pd.target != null ? ` → ${ctx.nameOf(pd.target)}` : ''),
        pd.nopes ? h('span', { class: 'bk-nopes' }, pd.nopes % 2 ? `Отменено (${pd.nopes})` : `Отмена отменена (${pd.nopes})`) : null,
        ctx.timer(pd.left, 2600, 'bar'),
        nope && me && me.alive ? h('button', { type: 'button', class: 'btn btn-red bk-nope-btn', onclick: () => send('nope', { card: nope.id }) }, pd.nopes % 2 ? 'Ни за что! (вернуть)' : 'Ни за что!') : null);
    } else if (g.phase === 'insert') {
      const mine = g.phaseInfo.seat === seat;
      center = h('div', { class: 'bk-pending insert' },
        h('b', null, mine ? 'Котобомба обезврежена! Куда её спрятать?' : `${ctx.nameOf(g.phaseInfo.seat)} прячет бомбу обратно…`),
        ctx.timer(g.phaseInfo.left, 20000, 'bar'),
        mine ? h('div', { class: 'bk-insert' },
          ...[[0, 'Сверху'], [1, '2-й'], [2, '3-й'], [4, '5-й'], ['bottom', 'На дно'], ['random', 'Наугад']].map(([v, l]) => h('button', { type: 'button', class: 'btn btn-dark btn-sm', onclick: () => send('insert', { pos: v }) }, l))) : null);
    } else if (g.phase === 'favor') {
      const mine = g.phaseInfo.from === seat;
      center = h('div', { class: 'bk-pending' },
        h('b', null, mine ? `Взятка для ${ctx.nameOf(g.phaseInfo.to)}: выберите карту, которую отдадите` : `${ctx.nameOf(g.phaseInfo.from)} выбирает, чем откупиться`),
        ctx.timer(g.phaseInfo.left, 15000, 'bar'));
    } else if (g.phase === 'alter' && g.phaseInfo.seat === seat) {
      ui.order = ui.order && ui.order.length === (g.peek || []).length && ui.order.every((id) => (g.peek || []).some((c) => c.id === id)) ? ui.order : (g.peek || []).map((c) => c.id);
      const move = (i, d) => { const o = ui.order.slice(); const j = i + d; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; ui.order = o; ctx.rerender(); };
      center = h('div', { class: 'bk-pending alter' },
        h('b', null, 'Подкрутите будущее: слева — верхняя карта'),
        h('div', { class: 'bk-peek' }, ...ui.order.map((id, i) => { const c = g.peek.find((x) => x.id === id); return h('div', { class: 'bk-alter' }, cardEl(c.k, K, { small: true }), h('span', null, h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Левее', disabled: i === 0, onclick: () => move(i, -1) }, '←'), h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Правее', disabled: i === ui.order.length - 1, onclick: () => move(i, 1) }, '→'))); })),
        ctx.timer(g.phaseInfo.left, 20000, 'bar'),
        h('button', { type: 'button', class: 'btn btn-gold btn-sm', onclick: () => send('order', { order: ui.order }) }, 'Готово'));
    } else if (g.peek && myTurn) {
      center = h('div', { class: 'bk-pending peek' }, h('b', null, 'Будущее (слева — верх колоды):'), h('div', { class: 'bk-peek' }, ...g.peek.map((c) => cardEl(c.k, K, { small: true }))));
    } else {
      center = h('div', { class: 'bk-turn' + (myTurn ? ' mine' : '') },
        h('b', null, myTurn ? (g.turnsLeft > 1 ? `Ваш ход (ещё ×${g.turnsLeft})` : 'Ваш ход') : `Ходит ${ctx.nameOf(g.cur)}`),
        h('small', { class: 'muted' }, myTurn ? 'Сыграйте карты или сразу тяните из колоды' : 'Держите «Ни за что!» наготове'));
    }
    const drawBtn = playable ? h('button', { type: 'button', class: 'btn btn-gold bk-draw', onclick: () => { ui.sel = []; ui.target = null; send('draw'); } }, 'Взять карту') : null;
    board.replaceChildren(strip, h('div', { class: 'bk-table' }, deck, h('div', { class: 'bk-center' }, center, drawBtn), pile));

    // ---------- my hand ----------
    if (!me) { dock.replaceChildren(g.allHands ? h('p', { class: 'muted' }, 'Партия окончена') : h('p', { class: 'muted small' }, 'Вы смотрите партию.')); fx(ctx); return; }
    if (!me.alive) { dock.replaceChildren(h('p', { class: 'bk-dead' }, '💥 Вы взорвались. Смотрите, кто выживет.')); fx(ctx); return; }
    const favorMine = g.phase === 'favor' && g.phaseInfo.from === seat;
    const toggle = (c) => {
      if (favorMine) { send('give', { card: c.id }); return; }
      if (!playable) { if (c.k === 'nope' && pd) send('nope', { card: c.id }); return; }
      const i = ui.sel.indexOf(c.id);
      if (i !== -1) ui.sel.splice(i, 1);
      else if (ui.sel.length && hand.find((x) => x.id === ui.sel[0]).k !== c.k) ui.sel = [c.id];
      else ui.sel.push(c.id);
      if (ui.sel.length > 3) ui.sel = ui.sel.slice(-3);
      ctx.rerender();
    };
    const order = ['defuse', 'nope', 'attack', 'skip', 'future', 'alter', 'shuffle', 'bottom', 'favor', 'c1', 'c2', 'c3', 'c4', 'c5'];
    const sorted = [...hand].sort((a, b) => order.indexOf(a.k) - order.indexOf(b.k));
    const handEl = h('div', { class: 'bk-hand', style: `--n:${sorted.length}` }, ...sorted.map((c, i) => cardEl(c.k, K, { id: c.id, sel: ui.sel.includes(c.id), onclick: () => toggle(c), tilt: (i - (sorted.length - 1) / 2) * 2.2, dim: playable && (c.k === 'defuse' || (c.k === 'nope')) })));
    // what the selection does
    let hint = null;
    let play = null;
    if (favorMine) hint = h('p', { class: 'bk-hint strong' }, 'Нажмите на карту, которую отдадите');
    else if (playable && selCards.length) {
      const k = selKind;
      const cat = K[k] && K[k].cat;
      const okSingle = selCards.length === 1 && ['skip', 'attack', 'future', 'alter', 'shuffle', 'bottom', 'favor'].includes(k);
      const okMulti = selCards.length >= 2 && k !== 'defuse' && k !== 'nope';
      if (!okSingle && !okMulti) hint = h('p', { class: 'bk-hint' }, cat ? 'Котов играют парой (или тройкой)' : k === 'nope' ? '«Ни за что!» играют против чужой карты' : k === 'defuse' ? 'Сапёр сработает сам, если вытянете бомбу' : 'Эту карту так не сыграть');
      else {
        const label = selCards.length === 3 ? 'Тройка: назовите карту и заберите' : selCards.length === 2 ? 'Пара: вытянуть карту у соперника' : K[k].text;
        let wantSel = null;
        if (selCards.length === 3) {
          ui.want ||= 'defuse';
          wantSel = h('select', { class: 'bk-want', 'aria-label': 'Какую карту забрать', onchange: (e) => { ui.want = e.target.value; } }, ...Object.entries(K).filter(([key]) => key !== 'bomb').map(([key, v]) => h('option', { value: key, selected: ui.want === key }, v.name)));
        }
        const needT = needsTarget;
        play = h('div', { class: 'bk-play' },
          h('p', { class: 'bk-hint' }, label, needT ? (ui.target != null ? ` · цель: ${ctx.nameOf(ui.target)}` : ' · выберите соперника вверху') : ''),
          wantSel,
          h('button', { type: 'button', class: 'btn btn-gold btn-sm', disabled: needT && ui.target == null, onclick: async () => { const res = await send('play', { cards: ui.sel, target: ui.target, want: ui.want }); if (res) { ui.sel = []; ui.target = null; ctx.rerender(); } } }, 'Сыграть'),
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { ui.sel = []; ui.target = null; ctx.rerender(); } }, 'Отмена'));
      }
    } else if (playable) hint = h('p', { class: 'bk-hint muted' }, 'Выберите карту, чтобы сыграть, или возьмите карту из колоды');
    dock.replaceChildren(h('div', { class: 'bk-dock' }, hint, play, handEl));
    fx(ctx);
  }

  function fx(ctx) {
    const ev = ctx.fresh;
    if (!ev) return;
    const K = ctx.g.kinds;
    const from = (s) => document.querySelector(`#pt-stage .pt-pl[data-seat="${s}"]`);
    if (ev.type === 'play' || ev.type === 'nope') window.PartyKit.fly(from(ev.by), '#bk-pile', cardEl(ev.type === 'nope' ? 'nope' : ev.card, K, { small: true }));
    if (ev.type === 'draw') window.PartyKit.fly('#bk-deck', from(ev.by), cardEl(ev.card || 'x', K, { small: true, back: !ev.card }));
    if (ev.type === 'steal' || ev.type === 'gave') { const a = ev.type === 'steal' ? ev.target : ev.by; const b = ev.type === 'steal' ? ev.by : ev.target; window.PartyKit.fly(from(a), from(b), cardEl(ev.card || 'x', K, { small: true, back: !ev.card })); }
    if (ev.type === 'boom' || ev.type === 'defused') {
      const el = from(ev.by);
      if (el && !window.PartyKit.REDUCE) { const b = h('span', { class: 'bk-boom' + (ev.type === 'defused' ? ' calm' : '') }); el.append(b); setTimeout(() => b.remove(), 1400); }
    }
    if (ev.type === 'shuffle') { const d = document.querySelector('#bk-deck .bk-stack'); if (d) { d.classList.remove('shuf'); void d.offsetWidth; d.classList.add('shuf'); } }
  }

  (window.PartyGames ||= {}).bomb = { render };
})();
