(() => {
  'use strict';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const fmt = (n) => Number(n || 0).toLocaleString('ru-RU');

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  let toastTimer = null;
  function toast(text, isError = false) {
    const el = $('#toast');
    el.textContent = text;
    el.className = 'toast' + (isError ? ' err' : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
  }
  $$('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

  const GAME = { NLH: 'Холдем NL', PLO: 'Омаха PL' };
  const VARIANT = { podkidnoy: 'Подкидной', perevodnoy: 'Переводной' };
  const STATUS = { registering: 'Регистрация', running: 'Идёт', finished: 'Завершён', waiting: 'Ждут', countdown: 'Старт', playing: 'Партия', result: 'Итоги' };

  let token = null;
  try { token = localStorage.getItem('nr_token'); } catch (e) { /* ignore */ }
  const A = { data: null, tab: 'overview', search: '' };

  function deny(text) {
    $('#adm-body').hidden = true;
    const d = $('#adm-denied');
    d.hidden = false;
    d.replaceChildren(h('p', null, text), h('a', { class: 'btn btn-gold', href: '/play' }, 'Войти в игру'));
  }
  if (!token) { deny('Сначала войдите в игру под аккаунтом администратора.'); return; }

  const socket = io({ auth: { token } });
  function call(event, payload = {}) {
    return new Promise((resolve) => {
      socket.timeout(8000).emit(event, payload, (err, res) => {
        if (err) { toast('Сервер не ответил', true); return resolve(null); }
        if (res && res.error) { toast(res.error, true); return resolve(null); }
        resolve(res);
      });
    });
  }
  socket.on('connect', () => { $('#adm-live').textContent = 'онлайн'; $('#adm-live').className = 'status running'; load(true); });
  socket.on('disconnect', () => { $('#adm-live').textContent = 'нет связи'; $('#adm-live').className = 'status finished'; });
  socket.on('connect_error', (e) => { if (e.message === 'unauthorized' || e.message === 'banned') deny('Сессия истекла — войдите в игру заново.'); });

  async function load(force = false) {
    const res = await call('admin:overview');
    if (!res) { if (!A.data) deny('У этого аккаунта нет прав администратора.'); return; }
    A.data = res;
    $('#adm-denied').hidden = true;
    $('#adm-body').hidden = false;
    $('#adm-updated').textContent = `Обновлено в ${new Date().toLocaleTimeString('ru-RU')}`;
    // don't wipe a form the admin is typing in
    const active = document.activeElement;
    const typing = active && $('#adm-main').contains(active) && /INPUT|SELECT|TEXTAREA/.test(active.tagName);
    if (force || !typing) render();
  }
  setInterval(() => { if (!document.hidden && socket.connected) load(); }, 4000);

  async function run(event, payload, okText) {
    const res = await call(event, payload);
    if (res && okText) toast(okText);
    await load(true);
    return res;
  }

  $$('[data-adm-tab]').forEach((tab) => tab.addEventListener('click', () => {
    A.tab = tab.dataset.admTab;
    $$('[data-adm-tab]').forEach((x) => { x.classList.toggle('is-active', x === tab); x.setAttribute('aria-selected', x === tab); });
    render();
  }));

  function render() {
    const main = $('#adm-main');
    const d = A.data;
    if (!d) return;
    const view = { overview, users, tables, sng, durak, announce }[A.tab];
    main.replaceChildren(...[view(d)].flat());
  }

  // ---------- sections ----------
  function tile(label, value, sub) {
    return h('div', { class: 'adm-tile' }, h('small', null, label), h('b', null, value), sub ? h('span', { class: 'muted small' }, sub) : null);
  }
  function uptime(ms) {
    const m = Math.floor(ms / 60000);
    return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${m % 60} мин`;
  }

  function overview(d) {
    const s = d.stats;
    return [
      h('div', { class: 'adm-tiles' },
        tile('Онлайн', s.online, `из ${s.users} аккаунтов`),
        tile('На балансах', fmt(s.balances)),
        tile('В игре', fmt(s.inPlay), 'за столами и в ставках'),
        tile('Раздач идёт', s.activeHands, `${s.cashTables} кэш-столов`),
        tile('Турниры', s.sngRunning, `в регистрации: ${s.sngRegistering} игр.`),
        tile('Дурак', s.durakGames, `партий на ${s.durakTables} столах`),
        tile('Работает', uptime(s.uptimeMs)),
        tile('Память', `${s.memoryMb} МБ`)),
      h('h2', { class: 'h3 adm-h' }, 'Кто онлайн'),
      h('div', { class: 'adm-chips' }, d.users.filter((u) => u.online).map((u) => h('span', { class: 'pill' }, u.name)),
        d.users.some((u) => u.online) ? null : h('span', { class: 'muted' }, 'Никого')),
      h('h2', { class: 'h3 adm-h' }, 'Журнал действий администраторов'),
      d.log.length
        ? h('ul', { class: 'adm-log' }, d.log.map((l) => h('li', null,
          h('span', { class: 'muted small' }, new Date(l.t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })),
          h('b', null, l.admin), l.text)))
        : h('p', { class: 'muted' }, 'Пока пусто.'),
    ];
  }

  function users(d) {
    const search = h('input', { class: 'adm-input', type: 'search', placeholder: 'Поиск по нику', value: A.search, 'aria-label': 'Поиск по нику' });
    const list = h('div', { class: 'adm-list' });
    const draw = () => {
      const q = A.search.trim().toLowerCase();
      list.replaceChildren(...d.users.filter((u) => !q || u.name.toLowerCase().includes(q)).map(userRow));
    };
    search.addEventListener('input', () => { A.search = search.value; draw(); });
    draw();
    return [h('div', { class: 'adm-toolbar' }, search, h('span', { class: 'muted small' }, `Всего: ${d.users.length}`)), list];
  }

  function userRow(u) {
    const me = u.id === A.data.me;
    const amount = h('input', { class: 'adm-input adm-num', type: 'number', placeholder: 'Сумма', 'aria-label': `Сумма для ${u.name}` });
    const chips = (sign) => {
      const n = Math.abs(Math.floor(Number(amount.value)));
      if (!n) { toast('Введите сумму', true); return; }
      run('admin:user', { userId: u.id, action: 'chips', amount: sign * n }, sign > 0 ? 'Фишки начислены' : 'Фишки списаны');
    };
    return h('div', { class: 'adm-row' },
      h('div', { class: 'adm-row-main' },
        h('b', null, u.name),
        u.online ? h('span', { class: 'status running' }, 'онлайн') : null,
        u.role === 'admin' ? h('span', { class: 'status registering' }, 'админ') : null,
        u.banned ? h('span', { class: 'status adm-bad' }, 'заблокирован') : null,
        u.muted ? h('span', { class: 'status finished' }, 'без чата') : null,
        h('span', { class: 'muted small' }, `Баланс ${fmt(u.balance)} · в игре ${fmt(u.inPlay)} · выиграно раздач ${u.handsWon} · с ${new Date(u.created).toLocaleDateString('ru-RU')}`)),
      h('div', { class: 'adm-actions' },
        amount,
        h('button', { type: 'button', class: 'btn btn-gold btn-sm', onclick: () => chips(1) }, 'Начислить'),
        h('button', { type: 'button', class: 'btn btn-dark btn-sm', onclick: () => chips(-1) }, 'Списать'),
        h('button', { type: 'button', class: 'btn btn-dark btn-sm', onclick: () => run('admin:user', { userId: u.id, action: u.muted ? 'unmute' : 'mute' }) }, u.muted ? 'Вернуть чат' : 'Запретить чат'),
        h('button', {
          type: 'button', class: 'btn btn-dark btn-sm',
          onclick: async () => {
            if (!confirm(`Сбросить пароль игроку ${u.name}?`)) return;
            const res = await run('admin:user', { userId: u.id, action: 'resetPassword' });
            if (res) { $('#adm-pass-text').textContent = `Игрок: ${u.name}`; $('#adm-pass-value').textContent = res.password; $('#adm-pass').showModal(); }
          },
        }, 'Сбросить пароль'),
        me ? null : h('button', { type: 'button', class: 'btn btn-dark btn-sm', onclick: () => run('admin:user', { userId: u.id, action: u.role === 'admin' ? 'removeAdmin' : 'makeAdmin' }) }, u.role === 'admin' ? 'Снять админа' : 'Сделать админом'),
        me ? null : h('button', {
          type: 'button', class: 'btn btn-sm ' + (u.banned ? 'btn-ghost' : 'btn-red'),
          onclick: () => { if (u.banned || confirm(`Заблокировать ${u.name}? Его уберут со всех столов.`)) run('admin:user', { userId: u.id, action: u.banned ? 'unban' : 'ban' }); },
        }, u.banned ? 'Разблокировать' : 'Заблокировать')));
  }

  function select(name, options, value, label) {
    const s = h('select', { class: 'adm-input', name, 'aria-label': label });
    for (const [v, text] of options) s.append(h('option', { value: v }, text));
    if (value != null) s.value = String(value);
    return s;
  }

  function tables(d) {
    const o = d.options;
    const form = h('form', { class: 'adm-form' },
      h('input', { class: 'adm-input', name: 'name', placeholder: 'Название', maxlength: 24, 'aria-label': 'Название' }),
      select('game', [['NLH', 'Холдем NL'], ['PLO', 'Омаха PL']], 'NLH', 'Игра'),
      select('stakes', o.stakes.map(([a, b], i) => [i, `${fmt(a)}/${fmt(b)}`]), 2, 'Блайнды'),
      select('seats', o.seats.map((n) => [n, `${n} мест`]), 6, 'Мест'),
      select('blindsEvery', o.blindEvery.map((n) => [n, n ? `Рост каждые ${n}` : 'Без роста']), 5, 'Рост блайндов'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'permanent' }), 'Постоянный'),
      h('button', { type: 'submit', class: 'btn btn-gold btn-sm' }, 'Создать стол'));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      run('admin:createTable', { name: f.name.value, game: f.game.value, stakes: Number(f.stakes.value), seats: Number(f.seats.value), blindsEvery: Number(f.blindsEvery.value), permanent: f.permanent.checked }, 'Стол создан');
    });
    return [form, h('div', { class: 'adm-list' }, d.cash.map((t) => {
      const sb = h('input', { class: 'adm-input adm-num', type: 'number', value: t.sb, 'aria-label': 'Малый блайнд' });
      const bb = h('input', { class: 'adm-input adm-num', type: 'number', value: t.bb, 'aria-label': 'Большой блайнд' });
      const every = select('every', [0, 3, 5, 10, 15, 20].map((n) => [n, n ? `Каждые ${n}` : 'Без роста']), t.blindsEvery, 'Рост блайндов');
      every.addEventListener('change', () => run('admin:table', { tableId: t.id, action: 'schedule', every: Number(every.value) }, 'Сохранено'));
      return h('div', { class: 'adm-row' },
        h('div', { class: 'adm-row-main' },
          h('b', null, t.name),
          t.permanent ? h('span', { class: 'status registering' }, 'постоянный') : null,
          t.inHand ? h('span', { class: 'status running' }, `раздача #${t.handNo}`) : null,
          h('span', { class: 'muted small' }, `${GAME[t.game]} · ${fmt(t.sb)}/${fmt(t.bb)} · ${t.players}/${t.maxSeats} · сообщений в чате ${t.chat}`),
          h('div', { class: 'adm-chips' }, t.seats.filter(Boolean).map((s) => h('span', { class: 'pill adm-seat' },
            `${s.name} · ${fmt(s.stack)}${s.connected ? '' : ' · офлайн'}`,
            h('button', { type: 'button', class: 'adm-x', 'aria-label': `Убрать ${s.name} из-за стола`, onclick: () => { if (confirm(`Убрать ${s.name} из-за стола? Фишки вернутся на баланс.`)) run('admin:table', { tableId: t.id, action: 'kick', target: s.userId }, 'Игрок убран'); } }, '×'))))),
        h('div', { class: 'adm-actions' },
          sb, bb,
          h('button', { type: 'button', class: 'btn btn-gold btn-sm', onclick: () => run('admin:table', { tableId: t.id, action: 'blinds', sb: Number(sb.value), bb: Number(bb.value) }, 'Блайнды сменятся со следующей раздачи') }, 'Блайнды'),
          every,
          h('button', { type: 'button', class: 'btn btn-dark btn-sm', onclick: () => run('admin:table', { tableId: t.id, action: 'clearChat' }, 'Чат очищен') }, 'Очистить чат'),
          h('button', { type: 'button', class: 'btn btn-dark btn-sm', onclick: () => run('admin:table', { tableId: t.id, action: 'permanent' }) }, t.permanent ? 'Открепить' : 'Закрепить'),
          h('button', { type: 'button', class: 'btn btn-red btn-sm', onclick: () => { if (confirm(`Закрыть «${t.name}»? Все фишки вернутся игрокам.`)) run('admin:table', { tableId: t.id, action: 'close' }, 'Стол закрыт'); } }, 'Закрыть')));
    }))];
  }

  function sng(d) {
    const tpl = select('tpl', d.templates.map((t) => [t.id, t.name]), null, 'Формат');
    return [
      h('div', { class: 'adm-form' }, tpl,
        h('button', { type: 'button', class: 'btn btn-gold btn-sm', onclick: () => run('admin:sngSpawn', { templateId: tpl.value }, 'Регистрация открыта') }, 'Открыть ещё один турнир')),
      h('div', { class: 'adm-list' }, d.sngs.map((x) => h('div', { class: 'adm-row' },
        h('div', { class: 'adm-row-main' },
          h('b', null, x.name),
          h('span', { class: 'status ' + x.status }, x.status === 'running' ? `уровень ${x.level}` : STATUS[x.status]),
          h('span', { class: 'muted small' }, `${GAME[x.game]} · бай-ин ${fmt(x.buyIn)} · фонд ${fmt(x.prizePool)} · ${x.status === 'running' ? `в игре ${x.alive}/${x.seats}` : `игроков ${x.players.length}/${x.seats}`}${x.winner ? ` · победитель ${x.winner}` : ''}`),
          x.players.length ? h('span', { class: 'muted small' }, x.players.join(', ')) : null),
        h('div', { class: 'adm-actions' },
          x.tableId ? h('a', { class: 'btn btn-dark btn-sm', href: `/play#/table/${x.tableId}`, target: '_blank', rel: 'noopener' }, 'Смотреть') : null,
          x.status !== 'finished' ? h('button', {
            type: 'button', class: 'btn btn-red btn-sm',
            onclick: () => { if (confirm(x.status === 'registering' ? 'Отменить турнир? Бай-ины вернутся.' : 'Остановить турнир? Остаток фонда разделится по фишкам.')) run('admin:sng', { sngId: x.id, action: 'cancel' }, 'Турнир отменён'); },
          }, 'Отменить') : null)))),
    ];
  }

  function durak(d) {
    const o = d.options;
    const form = h('form', { class: 'adm-form' },
      h('input', { class: 'adm-input', name: 'name', placeholder: 'Название', maxlength: 24, 'aria-label': 'Название' }),
      select('variant', [['podkidnoy', 'Подкидной'], ['perevodnoy', 'Переводной']], 'podkidnoy', 'Вариант'),
      select('stake', o.durakStakes.map((n) => [n, `Ставка ${fmt(n)}`]), 100, 'Ставка'),
      select('maxPlayers', [2, 3, 4, 5, 6].map((n) => [n, `${n} игроков`]), 4, 'Игроков'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'permanent' }), 'Постоянный'),
      h('button', { type: 'submit', class: 'btn btn-gold btn-sm' }, 'Создать стол'));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      run('admin:createDurak', { name: f.name.value, variant: f.variant.value, stake: Number(f.stake.value), maxPlayers: Number(f.maxPlayers.value), permanent: f.permanent.checked }, 'Стол создан');
    });
    return [form, h('div', { class: 'adm-list' }, d.durak.map((t) => h('div', { class: 'adm-row' },
      h('div', { class: 'adm-row-main' },
        h('b', null, t.name),
        h('span', { class: 'status ' + (t.status === 'playing' ? 'running' : 'registering') }, STATUS[t.status]),
        h('span', { class: 'muted small' }, `${VARIANT[t.variant]} · ставка ${fmt(t.stake)} · ${t.players}/${t.maxPlayers} · партий сыграно ${t.gameNo}${t.pot ? ` · банк ${fmt(t.pot)}` : ''}`),
        h('div', { class: 'adm-chips' }, t.seats.filter(Boolean).map((s) => h('span', { class: 'pill adm-seat' },
          `${s.name}${s.ready ? ' · готов' : ''}${s.connected ? '' : ' · офлайн'}`,
          h('button', { type: 'button', class: 'adm-x', 'aria-label': `Убрать ${s.name}`, onclick: () => { if (confirm(`Убрать ${s.name}? Если идёт партия — ему засчитают поражение.`)) run('admin:durak', { tableId: t.id, action: 'kick', target: s.userId }, 'Игрок убран'); } }, '×'))))),
      h('div', { class: 'adm-actions' },
        h('a', { class: 'btn btn-dark btn-sm', href: `/play#/durak/${t.id}`, target: '_blank', rel: 'noopener' }, 'Смотреть'),
        h('button', { type: 'button', class: 'btn btn-dark btn-sm', onclick: () => run('admin:durak', { tableId: t.id, action: 'clearChat' }, 'Чат очищен') }, 'Очистить чат'),
        h('button', { type: 'button', class: 'btn btn-red btn-sm', onclick: () => { if (confirm(`Закрыть «${t.name}»? Ставки текущей партии вернутся.`)) run('admin:durak', { tableId: t.id, action: 'close' }, 'Стол закрыт'); } }, 'Закрыть')))))];
  }

  function announce(d) {
    const ta = h('textarea', { class: 'adm-input adm-textarea', maxlength: 300, rows: 3, placeholder: 'Например: в 21:00 турнир «Большой стол», регистрируйтесь!', 'aria-label': 'Текст объявления' });
    if (d.announcement) ta.value = d.announcement.text;
    return [
      h('p', { class: 'muted' }, 'Объявление показывается всем игрокам полосой под шапкой. Каждый может скрыть его у себя; новое объявление появится снова.'),
      ta,
      h('div', { class: 'adm-form' },
        h('button', { type: 'button', class: 'btn btn-gold', onclick: () => { if (ta.value.trim()) run('admin:announce', { text: ta.value }, 'Объявление опубликовано'); } }, 'Опубликовать'),
        d.announcement ? h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => run('admin:announce', { text: '' }, 'Объявление убрано') }, 'Убрать объявление') : null),
      h('p', { class: 'muted small' }, 'Модерация чата: «Запретить чат» — во вкладке «Игроки», «Очистить чат» — у каждого стола.'),
    ];
  }
})();
