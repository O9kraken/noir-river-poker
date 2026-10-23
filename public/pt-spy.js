/* «Шпионы»: the 5×5 board, team panels, the captain's clue and the agents' guesses. */
(() => {
  'use strict';
  const { h } = window.NR;
  const COLOR_NAME = { r: 'агент Алых', b: 'агент Лазурных', n: 'мирный прохожий', x: 'ликвидатор' };

  function teamPanel(ctx, t) {
    const { g } = ctx;
    const on = g.turnTeam === t && ctx.st.status === 'playing';
    return h('div', { class: `sp-team sp-${t}${on ? ' on' : ''}` },
      h('div', { class: 'sp-team-head' }, h('b', null, g.names[t]), h('span', { class: 'sp-left' }, String(g.left[t])), h('small', null, 'осталось')),
      h('ul', null, ...g.teams[t].map((s) => h('li', { class: (s === ctx.seat ? 'me ' : '') + (g.captain[t] === s ? 'cap' : ''), 'data-seat': s },
        ctx.avatarOf(s, 'xs'), h('span', null, ctx.nameOf(s)), g.captain[t] === s ? h('em', null, 'капитан') : null))));
  }

  function render(board, dock, ctx) {
    const { g, st, seat, ui, send } = ctx;
    const over = st.status === 'result';
    const myTeam = g.myTeam;
    const canGuess = g.canGuess && !over;
    // ---------- the turn banner ----------
    let banner;
    if (over) banner = h('div', { class: 'sp-banner' }, h('b', null, st.result ? st.result.text : 'Партия окончена'));
    else if (g.phase === 'clue') {
      banner = h('div', { class: `sp-banner sp-${g.turnTeam}` },
        h('b', null, `Капитан ${g.names[g.turnTeam]} думает над подсказкой`),
        st.turn ? ctx.timer(st.turn.left, null, 'bar') : null);
    } else {
      banner = h('div', { class: `sp-banner sp-${g.turnTeam}` },
        h('span', { class: 'sp-clue' }, h('small', null, `Подсказка ${g.names[g.turnTeam]}`), h('b', null, g.clue.word.toUpperCase()), h('em', null, g.clue.n || '∞')),
        h('small', { class: 'muted' }, `открыто: ${g.guesses}${g.limit ? ` из ${g.limit}` : ''}`),
        ctx.timer(g.guessLeft, 150000, 'bar'));
    }
    // ---------- cards ----------
    const cards = g.cards.map((c, i) => {
      const marks = (g.marks[i] || []);
      const mineMark = marks.includes(seat);
      const cls = ['sp-card', c.open ? `open c-${c.color}` : c.color ? `key c-${c.color}` : '', mineMark ? 'marked' : '', canGuess && !c.open ? 'can' : ''].filter(Boolean).join(' ');
      const tag = canGuess && !c.open ? 'button' : 'div';
      return h(tag, {
        ...(tag === 'button' ? { type: 'button', onclick: () => send('mark', { i }, true) } : {}),
        class: cls, 'data-i': i,
        'aria-label': `${c.w}${c.open ? `, ${COLOR_NAME[c.color]}` : c.color ? `, ${COLOR_NAME[c.color]} (видит капитан)` : ''}`,
      },
      h('span', { class: 'sp-word' }, c.w),
      c.color === 'x' ? h('span', { class: 'sp-skull', 'aria-hidden': 'true' }, '☠') : null,
      marks.length ? h('span', { class: 'sp-marks' }, ...marks.map((s) => ctx.avatarOf(s, 'xs'))) : null,
      canGuess && mineMark && !c.open ? h('span', { class: 'sp-open', role: 'button', tabindex: '0', onclick: (e) => { e.stopPropagation(); send('open', { i }); }, onkeydown: (e) => { if (e.key === 'Enter') { e.stopPropagation(); send('open', { i }); } } }, 'Открыть') : null);
    });
    board.replaceChildren(h('div', { class: 'sp-wrap' },
      teamPanel(ctx, 'r'),
      h('div', { class: 'sp-mid' }, banner, h('div', { class: 'sp-grid' + (g.amCaptain ? ' captain' : '') }, ...cards)),
      teamPanel(ctx, 'b')));

    // ---------- my controls ----------
    const parts = [];
    if (!myTeam) parts.push(h('p', { class: 'muted small' }, 'Вы смотрите партию.'));
    else if (!over && g.phase === 'clue' && g.amCaptain && g.turnTeam === myTeam) {
      if (!ui.clueForm) {
        const word = h('input', { name: 'word', maxlength: '20', autocomplete: 'off', placeholder: 'Одно слово', 'aria-label': 'Слово-подсказка', required: true });
        const num = h('select', { name: 'n', 'aria-label': 'Сколько слов' }, ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((n) => h('option', { value: n }, n ? String(n) : '∞')));
        ui.clueForm = h('form', { class: 'sp-clue-form', onsubmit: async (e) => { e.preventDefault(); const res = await send('clue', { word: word.value.trim(), n: Number(num.value) }); if (res) { word.value = ''; ui.clueForm = null; } } },
          h('b', null, 'Ваша подсказка'), word, num, h('button', { type: 'submit', class: 'btn btn-gold btn-sm' }, 'Дать подсказку'));
        setTimeout(() => word.focus(), 30);
      }
      parts.push(ui.clueForm, h('p', { class: 'muted small' }, 'Подсвечены слова вашей команды. Число — сколько слов связано с подсказкой. Слова с поля и однокоренные нельзя.'));
    } else {
      ui.clueForm = null;
      if (!over && g.phase === 'guess' && canGuess) parts.push(h('div', { class: 'sp-guess' }, h('p', { class: 'bk-hint strong' }, 'Нажмите на слово, чтобы отметить, затем «Открыть». Обсуждайте с командой!'), g.guesses ? h('button', { type: 'button', class: 'btn btn-dark btn-sm', onclick: () => send('stop') }, 'Закончить ход') : null));
      else if (!over && g.amCaptain) parts.push(h('p', { class: 'muted small' }, g.turnTeam === myTeam ? 'Ваша команда отгадывает. Молчите и не подсказывайте лицом!' : 'Ход соперников. Вы видите, где чьи агенты.'));
      else if (!over) parts.push(h('p', { class: 'muted small' }, g.turnTeam === myTeam ? 'Ждём подсказку вашего капитана' : 'Ход соперников'));
    }
    if (g.history.length) parts.push(h('div', { class: 'sp-history' }, h('small', { class: 'muted' }, 'Подсказки'), ...g.history.slice().reverse().map((x) => h('span', { class: `sp-h sp-${x.team}` }, h('b', null, `${x.word} ${x.n || '∞'}`), x.opened.length ? ' → ' + x.opened.map((o) => o.w).join(', ') : ''))));
    dock.replaceChildren(h('div', { class: 'sp-dock' }, ...parts));
    if (ctx.fresh && ctx.fresh.type === 'open') {
      const el = board.querySelector(`.sp-card[data-i="${ctx.fresh.i}"]`);
      if (el && !window.PartyKit.REDUCE) el.classList.add('flip');
      if (ctx.fresh.color === 'x') ctx.Sound.play('boom');
    }
  }

  (window.PartyGames ||= {}).spy = { render };
})();
