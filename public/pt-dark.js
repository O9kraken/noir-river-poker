/* «Без тормозов»: the black prompt, white answers, the host's choice. */
(() => {
  'use strict';
  const { h } = window.NR;

  function promptEl(text, fills) {
    let k = 0;
    const parts = text.split('____');
    const out = [];
    parts.forEach((p, i) => {
      out.push(p);
      if (i < parts.length - 1) {
        const before = parts.slice(0, i + 1).join('').trim();
        const start = !before || /[.?!]$/.test(before);
        const t = fills && fills[k] ? fills[k++] : null;
        out.push(h('span', { class: 'dk-gap' + (t ? ' filled' : '') }, t ? (start ? t : t.charAt(0).toLowerCase() + t.slice(1)) : '\u00a0'.repeat(8)));
      }
    });
    return out;
  }

  function render(board, dock, ctx) {
    const { g, st, seat, ui, send } = ctx;
    const amJudge = seat === g.judge;
    const me = g.players.find((p) => p.seat === seat);
    const strip = window.PartyKit.strip(ctx, g.players, {
      active: [g.judge],
      cls: (p) => (g.phase === 'answer' && p.answered ? 'done' : ''),
      extra: (p) => h('span', { class: 'dt-pl-meta' }, h('em', { class: 'dt-score' }, String(p.score)), p.seat === g.judge ? h('span', { class: 'dt-judge' }, 'ведущий') : g.phase === 'answer' ? h('span', { class: p.answered ? 'ok' : 'muted' }, p.answered ? 'ответил' : 'думает…') : null),
    });
    const goal = h('div', { class: 'dg-goal' }, h('span', null, `Раунд ${g.round} · до ${g.goal} очков`), h('span', { class: 'muted' }, '18+ · чёрный юмор'));
    // ---------- the black card ----------
    const picked = (ui.pick || []).map((x) => (x === 'blank' ? (ui.blankText || '…') : ((g.hand || []).find((c) => c.id === x) || {}).t)).filter(Boolean);
    const winnerReveal = g.phase === 'show' || g.phase === 'over' ? g.reveal && g.reveal.find((r) => r.seat === g.winner) : null;
    const black = h('div', { class: 'dt-black' + (winnerReveal ? ' done' : '') },
      h('p', null, ...promptEl(g.prompt, winnerReveal ? winnerReveal.texts : g.phase === 'answer' && !amJudge ? picked : null)),
      h('small', null, g.pick === 2 ? 'Нужно два ответа — по порядку' : 'БЕЗ ТОРМОЗОВ · 18+'),
      g.phase === 'answer' ? ctx.timer(g.answerLeft, 75000, 'bar') : g.phase === 'judge' && st.turn ? ctx.timer(st.turn.left, null, 'bar') : null);
    let center;
    if (g.phase === 'answer') {
      const done = g.players.filter((p) => p.answered).length;
      center = h('div', { class: 'dt-status' }, h('b', null, amJudge ? 'Вы ведущий. Ждём ответы…' : g.mine ? 'Ответ отправлен — ждём остальных' : 'Выберите ответ из своих карт'), h('small', { class: 'muted' }, `ответили ${done} из ${g.players.length - 1}`));
    } else {
      center = h('div', { class: 'dt-answers' }, ...(g.reveal || []).map((r, i) => {
        const win = winnerReveal && r === winnerReveal;
        const can = amJudge && g.phase === 'judge';
        const tag = can ? 'button' : 'div';
        return h(tag, { ...(can ? { type: 'button', onclick: () => send('choose', { i }) } : {}), class: 'dt-white' + (win ? ' win' : '') + (can ? ' can' : '') + (winnerReveal && !win ? ' lost' : ''), style: `--d:${i * 70}ms` },
          ...r.texts.map((t, k) => h('p', null, r.texts.length > 1 ? h('i', null, `${k + 1}.`) : null, t)),
          r.blank ? h('small', { class: 'dt-own' }, 'своя карта') : null,
          r.seat != null ? h('span', { class: 'dt-who' }, ctx.nameOf(r.seat)) : null);
      }));
      if (g.phase === 'judge') center = h('div', null, h('p', { class: 'dt-status' }, h('b', null, amJudge ? 'Выберите лучший (или худший) ответ' : `${ctx.nameOf(g.judge)} выбирает…`)), center);
    }
    const hist = g.history.length ? h('details', { class: 'dt-hist' }, h('summary', null, 'Лучшее за партию'), h('ul', null, ...g.history.map((x) => h('li', null, h('b', null, x.name), ': ', x.filled)))) : null;
    board.replaceChildren(...[strip, goal, h('div', { class: 'dt-table' }, black, center), hist].filter(Boolean));

    // ---------- my hand ----------
    if (!me) { dock.replaceChildren(h('p', { class: 'muted small' }, 'Вы смотрите партию.')); return; }
    if (amJudge || g.phase !== 'answer' || g.mine) {
      ui.pick = [];
      dock.replaceChildren(h('div', { class: 'dt-dock' },
        g.mine ? h('p', { class: 'bk-hint' }, 'Ваш ответ: ', h('b', null, g.mine.join(' / '))) : null,
        h('div', { class: 'dt-hand dim' }, ...(g.hand || []).map((c) => h('div', { class: 'dt-wcard' }, c.t)))));
      return;
    }
    ui.pick ||= [];
    const toggle = (id) => {
      const i = ui.pick.indexOf(id);
      if (i !== -1) ui.pick.splice(i, 1);
      else { ui.pick.push(id); if (ui.pick.length > g.pick) ui.pick.shift(); }
      ctx.rerender();
    };
    if (!ui.blankInput) ui.blankInput = h('input', { maxlength: '80', placeholder: 'Свой вариант…', 'aria-label': 'Своя карта', oninput: (e) => { ui.blankText = e.target.value; const p = document.querySelector('.dt-black .dk-gap'); if (p && ui.pick.includes('blank')) p.textContent = e.target.value || '…'; } });
    const blank = g.blank ? h('div', { class: 'dt-wcard blank' + (ui.pick.includes('blank') ? ' sel' : '') },
      h('button', { type: 'button', class: 'dt-blank-btn', 'aria-pressed': ui.pick.includes('blank'), onclick: () => toggle('blank') }, ui.pick.includes('blank') ? '✓ Своя карта' : '✎ Своя карта'),
      ui.blankInput) : null;
    const cards = (g.hand || []).map((c) => h('button', { type: 'button', class: 'dt-wcard' + (ui.pick.includes(c.id) ? ' sel' : ''), 'aria-pressed': ui.pick.includes(c.id), onclick: () => toggle(c.id) }, ui.pick.includes(c.id) && g.pick > 1 ? h('i', null, `${ui.pick.indexOf(c.id) + 1}`) : null, c.t));
    const ready = ui.pick.length === g.pick && (!ui.pick.includes('blank') || (ui.blankText || '').trim());
    dock.replaceChildren(h('div', { class: 'dt-dock' },
      h('div', { class: 'dt-acts' },
        h('span', { class: 'bk-hint' }, g.pick === 2 ? 'Выберите два ответа по порядку' : 'Выберите ответ'),
        h('button', { type: 'button', class: 'btn btn-gold btn-sm', disabled: !ready, onclick: async () => { const usedBlank = ui.pick.includes('blank'); const res = await send('answer', { cards: ui.pick, text: ui.blankText }); if (res) { ui.pick = []; if (usedBlank) { ui.blankText = ''; ui.blankInput = null; } } } }, 'Отправить'),
        g.canSwap ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { if (confirm('Поменять все карты за одно очко? Можно один раз за партию.')) send('swap'); } }, 'Сменить карты (−1 очко)') : null),
      h('div', { class: 'dt-hand' }, blank, ...cards)));
  }

  (window.PartyGames ||= {}).dark = { render };
})();
