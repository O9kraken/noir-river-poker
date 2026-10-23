/* Ratings page: the weekly season (by game) and Elo ratings for chess, nardy, checkers and durak. */
(() => {
  'use strict';
  const NR = window.NR;
  const { $, $$, h, fmt, call, S } = NR;
  const GAMES = [
    ['total', 'Все игры'], ['poker', 'Покер'], ['sng', 'Турниры'], ['durak', 'Дурак'],
    ['bj', 'Блэкджек'], ['roulette', 'Рулетка'], ['checkers', 'Шашки'], ['chess', 'Шахматы'], ['nardy', 'Нарды'], ['capital', 'Капитал'], ['mafia', 'Мафия'],
  ];
  const R = { tab: 'season', game: 'total', elo: 'checkers', timer: null, season: null, gotAt: 0 };

  const signed = (n) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '0');
  const medal = (p) => (p === 1 ? '🥇' : p === 2 ? '🥈' : p === 3 ? '🥉' : String(p));
  function left(ms) {
    const d = Math.floor(ms / 86400000);
    const hh = Math.floor((ms % 86400000) / 3600000);
    const mm = Math.floor((ms % 3600000) / 60000);
    return d ? `${d} д ${hh} ч` : hh ? `${hh} ч ${mm} мин` : `${mm} мин`;
  }
  const profileLink = (p, extra) => h('a', { class: 'rt-who', href: `#/profile/${encodeURIComponent(p.name)}` }, NR.avatarEl(p.name, p.avatar, 'xs'), h('span', null, p.name), extra || null);

  async function open() {
    renderShell();
    await load();
    clearInterval(R.timer);
    R.timer = setInterval(() => { if (R.season) $('#rt-ends').textContent = `до конца ${left(Math.max(0, R.season.endsIn - (Date.now() - R.gotAt)))}`; }, 30000);
  }
  function close() { clearInterval(R.timer); R.timer = null; }

  function renderShell() {
    $$('[data-rt-tab]').forEach((b) => { const on = b.dataset.rtTab === R.tab; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', on); });
    $('#rt-season').hidden = R.tab !== 'season';
    $('#rt-elo').hidden = R.tab !== 'elo';
    $('#rt-games').replaceChildren(...GAMES.map(([id, name]) => h('button', { type: 'button', class: 'pill' + (R.game === id ? ' is-active' : ''), onclick: () => { R.game = id; renderShell(); load(); } }, name)));
    $('#rt-elo-games').replaceChildren(...[['chess', 'Шахматы'], ['nardy', 'Нарды'], ['checkers', 'Шашки'], ['durak', 'Дурак']].map(([id, name]) => h('button', { type: 'button', class: 'pill' + (R.elo === id ? ' is-active' : ''), onclick: () => { R.elo = id; renderShell(); load(); } }, name)));
  }

  async function load() {
    if (R.tab === 'season') {
      const res = await call('season:get', { game: R.game }, true);
      if (!res) return;
      R.season = res.season;
      R.gotAt = Date.now();
      renderSeason();
    } else {
      const res = await call('ratings:get', { kind: R.elo }, true);
      if (!res) return;
      renderElo(res);
    }
  }

  function renderSeason() {
    const s = R.season;
    $('#rt-label').textContent = `Сезон ${s.label}`;
    $('#rt-ends').textContent = `до конца ${left(s.endsIn)}`;
    $('#rt-prizes').replaceChildren(...s.prizes.map((p, i) => h('span', { class: 'rt-prize p' + (i + 1) }, h('i', null, medal(i + 1)), h('b', null, fmt(p)))));
    $('#rt-rule').textContent = `Призы по итогам недели во всех играх вместе — тем, кто в плюсе и сыграл не меньше ${s.minGames} раз. Подсчёт — с понедельника по воскресенье (МСК).`;
    const rows = s.top.map((r) => h('tr', { class: S.me && r.id === S.me.id ? 'me' : '' },
      h('td', { class: 'rt-place' }, medal(r.place)),
      h('td', null, profileLink(r)),
      h('td', { class: 'num muted' }, fmt(r.games)),
      h('td', { class: 'num ' + (r.net > 0 ? 'plus' : r.net < 0 ? 'minus' : '') }, signed(r.net))));
    if (s.me && !s.top.some((r) => r.id === s.me.id)) {
      rows.push(h('tr', { class: 'gap' }, h('td', { colspan: 4 }, '…')));
      rows.push(h('tr', { class: 'me' }, h('td', { class: 'rt-place' }, s.me.place), h('td', null, profileLink(s.me)), h('td', { class: 'num muted' }, fmt(s.me.games)), h('td', { class: 'num' }, signed(s.me.net))));
    }
    $('#rt-table').replaceChildren(
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, '#'), h('th', { scope: 'col' }, 'Игрок'), h('th', { scope: 'col', class: 'num' }, 'Игр'), h('th', { scope: 'col', class: 'num' }, 'Итог'))),
      h('tbody', null, ...(rows.length ? rows : [h('tr', null, h('td', { colspan: 4, class: 'muted rt-empty' }, 'На этой неделе здесь ещё никто не играл — станьте первым.'))])));
    $('#rt-mine').textContent = s.me ? `Вы на ${s.me.place} месте: ${signed(s.me.net)} за ${fmt(s.me.games)} игр` : 'Вы ещё не играли в этом сезоне';
    const hist = s.history.filter((x) => x.winners.length);
    $('#rt-history').replaceChildren(...(hist.length ? hist.map((x) => h('li', null,
      h('small', { class: 'muted' }, x.label),
      h('span', { class: 'rt-hist-w' }, ...x.winners.map((w) => h('span', null, medal(w.place), ' ', h('a', { href: `#/profile/${encodeURIComponent(w.name)}` }, w.name)))))) : [h('li', { class: 'muted small' }, 'Прошлых сезонов с призёрами пока нет.')]));
  }

  function renderElo(res) {
    const mine = res.me;
    $('#rt-elo-me').replaceChildren(
      h('div', { class: 'rt-elo-card' }, h('small', null, 'Ваш рейтинг'), h('b', null, mine ? mine.r : 1200), h('span', { class: 'muted small' }, mine && mine.games ? `${mine.games} рейтинговых партий · пик ${mine.peak}` : 'Сыграйте на фишки — рейтинг появится после первой партии')));
    const rows = res.list.map((r, i) => h('tr', { class: S.me && r.id === S.me.id ? 'me' : '' },
      h('td', { class: 'rt-place' }, medal(i + 1)), h('td', null, profileLink(r)), h('td', { class: 'num muted' }, fmt(r.games)), h('td', { class: 'num' }, h('b', null, r.rating))));
    $('#rt-elo-table').replaceChildren(
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, '#'), h('th', { scope: 'col' }, 'Игрок'), h('th', { scope: 'col', class: 'num' }, 'Партий'), h('th', { scope: 'col', class: 'num' }, 'Эло'))),
      h('tbody', null, ...(rows.length ? rows : [h('tr', null, h('td', { colspan: 4, class: 'muted rt-empty' }, 'Рейтинговых партий ещё не было.'))])));
  }

  $$('[data-rt-tab]').forEach((b) => b.addEventListener('click', () => { R.tab = b.dataset.rtTab; renderShell(); load(); }));

  function bind(socket) {
    if (bind.done === socket) return;
    bind.done = socket;
    socket.on('rating', (e) => NR.toast(`Рейтинг (${({ durak: 'дурак', chess: 'шахматы', checkers: 'шашки', nardy: 'нарды' })[e.kind] || e.kind}): ${e.rating} (${e.delta >= 0 ? '+' : '−'}${Math.abs(e.delta)})`));
    socket.on('season:closed', () => { if (!$('#ratings-view').hidden) load(); });
  }
  if (S.socket) bind(S.socket);
  setInterval(() => { if (S.socket && bind.done !== S.socket) bind(S.socket); }, 1000);

  window.RatingsUI = { open, close };
})();
