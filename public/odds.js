(() => {
  'use strict';
  const { $, h, S } = window.NR;
  const NAMES = ['Старшая карта', 'Пара', 'Две пары', 'Сет', 'Стрит', 'Флеш', 'Фулл-хаус', 'Каре', 'Стрит-флеш', 'Роял-флеш'];
  const SHORT_RANK = [0, 1, 2, 4, 3, 6, 5, 7, 8, 9];
  const O = { worker: null, key: '', pending: '', last: null, on: true, timer: null };
  try { O.on = localStorage.getItem('nr_odds') !== '0'; } catch (e) { /* ignore */ }

  function worker() {
    if (O.worker) return O.worker;
    try {
      O.worker = new Worker('/odds-worker.js');
      O.worker.onmessage = (e) => { if (e.data.key === O.pending) { O.last = e.data; draw(); } };
    } catch (e) { O.worker = null; }
    return O.worker;
  }

  const pct = (x) => (x >= 0.995 ? '>99%' : x > 0 && x < 0.005 ? '<1%' : `${Math.round(x * 100)}%`);

  function update(t) {
    const box = $('#odds');
    const btn = $('#odds-toggle');
    btn.setAttribute('aria-pressed', O.on ? 'true' : 'false');
    const me = t.mySeat >= 0 ? t.seats[t.mySeat] : null;
    const live = t.inHand && me && me.inHand && !me.folded && me.cards && me.cards.length;
    if (!O.on || !live) { box.hidden = true; O.key = ''; return; }
    const g = (window.NR.S && S.games && S.games[t.game]) || null;
    const info = g || { hole: me.cards.length, deck: t.game === 'SD' ? 'short' : 'full' };
    const game = { hole: info.hole || me.cards.length, deck: t.game === 'SD' ? 'short' : 'full', omaha: (info.hole || me.cards.length) >= 4 };
    const opponents = t.seats.filter((s, i) => s && i !== t.mySeat && s.inHand && !s.folded).length;
    const key = `${t.id}|${t.handNo}|${me.cards.join('')}|${t.board.join('')}|${opponents}`;
    box.hidden = false;
    O.game = game;
    O.short = game.deck === 'short';
    if (key === O.key) return;
    O.key = key;
    O.pending = key;
    O.last = null;
    O.meta = { opponents, street: t.board.length };
    draw();
    clearTimeout(O.timer);
    O.timer = setTimeout(() => {
      const w = worker();
      if (!w) return;
      w.postMessage({ key, game, hole: me.cards, board: t.board, opponents, iterations: game.omaha ? (game.hole >= 5 ? 500 : 800) : 4000 });
    }, 120);
  }

  function draw() {
    const box = $('#odds');
    const r = O.last;
    const meta = O.meta || { opponents: 0, street: 0 };
    if (!r) {
      box.replaceChildren(h('div', { class: 'odds-calc' }, h('span', { class: 'odds-spin', 'aria-hidden': 'true' }), 'Считаем шансы…'));
      return;
    }
    const river = meta.street >= 5;
    const order = (c) => (O.short ? SHORT_RANK[c] : c);
    // categories still possible, strongest first; merge royal into straight flush for readability
    const cats = r.cats.slice();
    cats[8] += cats[9]; cats[9] = 0;
    const rows = cats.map((p, c) => ({ c, p })).filter((x) => x.p >= 0.005 && x.c >= 1)
      .sort((a, b) => order(b.c) - order(a.c)).slice(0, 6);
    const eq = r.equity;
    box.replaceChildren(
      h('div', { class: 'odds-main' },
        h('div', { class: 'odds-now' }, h('small', null, 'Сейчас'), h('b', null, r.current != null ? NAMES[r.current] : '—')),
        meta.opponents
          ? h('div', { class: 'odds-eq' },
            h('small', null, `Шанс выиграть · против ${meta.opponents}`),
            h('div', { class: 'odds-eqrow' },
              h('b', { class: eq >= 0.5 ? 'good' : eq < 0.2 ? 'bad' : '' }, pct(eq)),
              h('span', { class: 'odds-bar', role: 'img', 'aria-label': `Шанс выиграть ${pct(eq)}` }, h('i', { style: `width:${Math.round(eq * 100)}%` }))))
          : null),
      river ? null : h('div', { class: 'odds-cats' },
        h('small', null, 'Соберёте к риверу'),
        h('ul', null, rows.map((x) => h('li', { class: x.c === r.current ? 'cur' : '' },
          h('span', { class: 'oc-name' }, NAMES[x.c]),
          h('span', { class: 'odds-bar sm', 'aria-hidden': 'true' }, h('i', { style: `width:${Math.max(2, Math.round(x.p * 100))}%` })),
          h('b', null, pct(x.p)))))),
      h('p', { class: 'odds-note' }, 'По вашим картам и борду, против случайных рук соперников. Чужие карты не учитываются.'));
  }

  $('#odds-toggle').addEventListener('click', () => {
    O.on = !O.on;
    try { localStorage.setItem('nr_odds', O.on ? '1' : '0'); } catch (e) { /* ignore */ }
    O.key = '';
    if (S.ts) update(S.ts);
  });

  window.OddsUI = { update };
})();
