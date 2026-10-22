/* Lobby panel: daily quests and achievements with chip rewards. */
(() => {
  'use strict';
  const NR = window.NR;
  const { $, h, fmt, toast, call, Sound, S } = NR;
  const P = { data: null, loading: false, lastReady: -1, timer: null };

  const left = (ms) => {
    const m = Math.max(1, Math.round(ms / 60000));
    return m >= 60 ? `${Math.floor(m / 60)} ч ${m % 60} м` : `${m} мин`;
  };
  const bar = (n, max, label) => h('span', { class: 'q-bar', role: 'progressbar', 'aria-valuenow': n, 'aria-valuemin': 0, 'aria-valuemax': max, 'aria-label': label },
    h('i', { style: `width:${Math.round((Math.min(n, max) / max) * 100)}%` }));

  async function claim(event, id, title) {
    const res = await call(event, { id });
    if (!res) return;
    P.data = res.progress;
    render();
    toast(`«${title}»: +${fmt(res.reward)} фишек`);
    Sound.play('win');
  }

  function row(item, kind) {
    const [n, max] = item.progress || [item.done ? 1 : 0, 1];
    const ready = item.done && !item.claimed;
    let tail;
    if (item.claimed) tail = h('span', { class: 'q-got', title: 'Награда получена' }, '✓');
    else if (ready) tail = h('button', { type: 'button', class: 'btn btn-gold btn-sm q-claim', onclick: () => claim(kind === 'q' ? 'quest:claim' : 'ach:claim', item.id, item.title) }, `+${fmt(item.reward)}`);
    else tail = h('span', { class: 'q-reward' }, `+${fmt(item.reward)}`);
    return h('li', { class: 'q-row' + (ready ? ' ready' : '') + (item.claimed ? ' claimed' : '') },
      h('span', { class: 'q-ico', 'aria-hidden': 'true' }, kind === 'q' ? (item.done ? '★' : '◆') : (item.done ? '★' : '☆')),
      h('span', { class: 'q-main' },
        h('b', null, item.title),
        h('small', null, item.text),
        !item.claimed && max > 1 ? h('span', { class: 'q-prog' }, bar(n, max, item.title), h('small', null, `${fmt(n)} / ${fmt(max)}`)) : null),
      tail);
  }

  function render() {
    const d = P.data;
    if (!d) return;
    $('#quests-reset').textContent = `↻ ${left(d.resetIn)}`; $('#quests-reset').title = 'Новые задания через это время';
    $('#quest-list').replaceChildren(...d.quests.map((q) => row(q, 'q')));
    const ach = d.achievements;
    const ready = ach.filter((a) => a.done && !a.claimed);
    const open = ach.filter((a) => !a.done)
      .sort((a, b) => (b.progress ? b.progress[0] / b.progress[1] : 0) - (a.progress ? a.progress[0] / a.progress[1] : 0));
    const show = ready.concat(open).slice(0, Math.max(3, ready.length));
    $('#ach-count').textContent = `${ach.filter((a) => a.done).length} из ${ach.length} · все`;
    $('#ach-list').replaceChildren(...(show.length ? show.map((a) => row(a, 'a')) : [h('li', { class: 'muted small' }, 'Все достижения открыты!')]));
  }

  async function refresh() {
    if (P.loading || !S.socket) return;
    P.loading = true;
    const res = await new Promise((resolve) => S.socket.timeout(8000).emit('progress:get', {}, (err, r) => resolve(err ? null : r)));
    P.loading = false;
    if (!res || res.error) return;
    P.data = res;
    render();
  }

  function onMe(me) {
    // rewards appeared (or were claimed elsewhere): reload the panel
    if (me && me.rewardsReady !== P.lastReady) { P.lastReady = me.rewardsReady; refresh(); }
  }

  // keep the quest timer and progress fresh while the lobby is open
  P.timer = setInterval(() => {
    const lobby = document.getElementById('lobby');
    if (!document.hidden && lobby && !lobby.hidden) refresh();
  }, 60000);
  window.addEventListener('hashchange', () => { if (/^#\/?$/.test(location.hash) || !location.hash) setTimeout(refresh, 300); });

  window.Progress = { refresh, onMe };
})();
