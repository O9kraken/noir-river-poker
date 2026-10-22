(() => {
  'use strict';
  const NR = window.NR;
  const { $, $$, h, fmt, toast, call, Sound, S } = NR;

  const KIND = { poker: 'Покер', durak: 'Дурак', bj: 'Блэкджек', sng: 'Sit & Go', roulette: 'Рулетка', checkers: 'Шашки' };
  const HAND_NAMES = ['Старшая карта', 'Пара', 'Две пары', 'Сет', 'Стрит', 'Флеш', 'Фулл-хаус', 'Каре', 'Стрит-флеш', 'Роял-флеш'];
  const SYMBOLS = ['', 's', 'h', 'd', 'c', 'crown', 'star', 'bolt', 'moon', 'flame'];
  const HUES = [0, 25, 45, 90, 150, 185, 210, 250, 285, 320];
  const F = { friends: [], incoming: [], outgoing: [], loaded: false };

  // ================= friends =================
  async function loadFriends() {
    const res = await call('friends:list', {}, true);
    if (!res) return;
    setFriends(res);
  }
  function setFriends(res) {
    F.friends = res.friends || [];
    F.incoming = res.incoming || [];
    F.outgoing = res.outgoing || [];
    F.loaded = true;
    renderFriends();
    if ($('#modal-invite').open) renderInviteList();
  }

  const profileHref = (name) => `#/profile/${encodeURIComponent(name)}`;

  function whereText(w) {
    if (!w || !w.length) return null;
    const x = w[0];
    return `${KIND[x.kind] || ''} · ${x.name}${w.length > 1 ? ` и ещё ${w.length - 1}` : ''}`;
  }

  function renderFriends() {
    const online = F.friends.filter((f) => f.online).length;
    $('#friends-online').textContent = F.friends.length ? `${online} из ${F.friends.length} онлайн` : '';
    const req = $('#friend-requests');
    req.replaceChildren(...F.incoming.map((u) => h('div', { class: 'friend-req' },
      NR.avatarEl(u.name, u.avatar, 'xs'),
      h('a', { href: profileHref(u.name), class: 'fr-name' }, u.name),
      h('span', { class: 'muted small' }, 'хочет дружить'),
      h('button', { type: 'button', class: 'btn btn-gold btn-sm', onclick: () => act('friends:accept', u.id, `${u.name} теперь ваш друг`) }, 'Принять'),
      h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': `Отклонить заявку ${u.name}`, onclick: () => act('friends:decline', u.id) }, '×'))));
    const list = $('#friend-list');
    if (!F.friends.length && !F.outgoing.length) {
      list.replaceChildren(h('li', { class: 'muted small' }, 'Добавьте друзей по нику — увидите, кто онлайн и где играет, и сможете звать за свой стол.'));
      return;
    }
    list.replaceChildren(
      ...F.friends.map((f) => {
        const w = f.where && f.where[0];
        return h('li', { class: 'friend' + (f.online ? ' on' : '') },
          h('a', { href: profileHref(f.name), class: 'friend-main' },
            h('span', { class: 'av-wrap' }, NR.avatarEl(f.name, f.avatar, 'sm'), h('i', { class: 'dot', 'aria-label': f.online ? 'онлайн' : 'не в сети' })),
            h('span', { class: 'friend-txt' }, h('b', null, f.name), h('small', null, f.online ? (whereText(f.where) || 'в лобби') : 'не в сети'))),
          w ? h('a', { class: 'btn btn-dark btn-sm', href: w.href, title: `Открыть стол «${w.name}»` }, 'К столу') : null);
      }),
      ...F.outgoing.map((u) => h('li', { class: 'friend pending' },
        h('a', { href: profileHref(u.name), class: 'friend-main' }, NR.avatarEl(u.name, u.avatar, 'sm'), h('span', { class: 'friend-txt' }, h('b', null, u.name), h('small', null, 'заявка отправлена'))),
        h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': `Отменить заявку ${u.name}`, onclick: () => act('friends:decline', u.id) }, '×'))));
  }

  async function act(event, id, okText) {
    const res = await call(event, { id });
    if (!res) return null;
    if (res.friends) setFriends(res);
    if (okText) toast(okText);
    return res;
  }

  $('#friend-add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#friend-name');
    const name = input.value.trim();
    if (!name) return;
    const res = await call('friends:add', { name });
    if (!res) return;
    input.value = '';
    setFriends(res);
    toast(res.status === 'friends' ? `${name} теперь ваш друг` : `Заявка отправлена: ${name}`);
  });

  // ================= invites =================
  function showInvite(inv) {
    const box = $('#invites');
    const card = h('div', { class: 'invite-card', role: 'alertdialog', 'aria-label': `Приглашение от ${inv.from.name}` },
      NR.avatarEl(inv.from.name, inv.from.avatar, 'sm'),
      h('div', { class: 'invite-txt' }, h('b', null, inv.from.name), h('span', null, `зовёт в «${inv.title}» · ${inv.game}`)),
      h('a', { class: 'btn btn-gold btn-sm', href: inv.href, onclick: () => card.remove() }, 'Присоединиться'),
      h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'Закрыть', onclick: () => card.remove() }, '×'));
    box.append(card);
    NR.Sound.play('turn');
    setTimeout(() => card.remove(), 25000);
  }

  function currentTable() {
    const m = location.hash.match(/^#\/(table|durak|bj)\/([\w-]+)/);
    if (!m) return null;
    const name = m[1] === 'table' ? $('#t-name').textContent : m[1] === 'durak' ? $('#dk-name').textContent : $('#bj-name').textContent;
    return { href: `#/${m[1]}/${m[2]}`, name };
  }

  function openInvite() {
    const t = currentTable();
    if (!t) return;
    $('#invite-sub').textContent = `«${t.name}» — отправьте ссылку или позовите друга, он получит приглашение прямо в игре.`;
    $('#invite-url').value = `${location.origin}/play${t.href}`;
    renderInviteList();
    $('#modal-invite').showModal();
    loadFriends();
  }
  function renderInviteList() {
    const t = currentTable();
    const ul = $('#invite-friends');
    const online = F.friends.filter((f) => f.online);
    if (!online.length) { ul.replaceChildren(h('li', { class: 'muted small' }, F.friends.length ? 'Никого из друзей нет в сети.' : 'У вас пока нет друзей — добавьте их в лобби.')); return; }
    ul.replaceChildren(...online.map((f) => {
      const here = t && f.where.some((w) => w.href === t.href);
      return h('li', { class: 'friend on' },
        h('span', { class: 'friend-main' }, NR.avatarEl(f.name, f.avatar, 'sm'), h('span', { class: 'friend-txt' }, h('b', null, f.name), h('small', null, here ? 'уже за этим столом' : whereText(f.where) || 'в лобби'))),
        here ? null : h('button', {
          type: 'button', class: 'btn btn-gold btn-sm',
          onclick: async (e) => {
            const b = e.currentTarget;
            if (await call('friends:invite', { id: f.id, href: t.href })) { b.textContent = 'Позвали'; b.disabled = true; }
          },
        }, 'Позвать'));
    }));
  }
  $$('[data-invite]').forEach((b) => b.addEventListener('click', openInvite));
  $('#invite-copy').addEventListener('click', async () => {
    const input = $('#invite-url');
    try { await navigator.clipboard.writeText(input.value); } catch (e) { input.select(); document.execCommand('copy'); }
    toast('Ссылка скопирована');
  });

  // ================= profile =================
  const P = { name: null, data: null };

  async function openProfile(name) {
    P.name = name;
    const view = $('#profile-view');
    if (!P.data || (name && P.data.name.toLowerCase() !== name.toLowerCase()) || (!name && !P.data.me)) view.replaceChildren(h('div', { class: 'empty' }, 'Загружаем профиль…'));
    const res = await call('profile:get', { name: name || '' });
    if (!res) { view.replaceChildren(h('div', { class: 'empty' }, 'Игрок не найден. ', h('a', { href: '#/' }, 'В лобби'))); return; }
    P.data = res.profile;
    document.title = `${P.data.name} — NOIR RIVER`;
    renderProfile();
  }

  function stat(label, value, sub) {
    return h('div', { class: 'pstat' }, h('small', null, label), h('b', null, value), sub ? h('span', null, sub) : null);
  }
  const plural = (n, one, few, many) => {
    const m10 = n % 10; const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  };
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
  const signed = (n) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '0');

  function renderProfile() {
    const p = P.data;
    const s = p.stats;
    const view = $('#profile-view');
    const since = new Date(p.created).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

    let relation = null;
    if (!p.me) {
      if (p.friend) relation = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: async () => { if (confirm(`Удалить ${p.name} из друзей?`)) { await act('friends:remove', p.id); openProfile(p.name); } } }, 'Удалить из друзей');
      else if (p.incoming) relation = h('button', { type: 'button', class: 'btn btn-gold btn-sm', onclick: async () => { await act('friends:accept', p.id, `${p.name} теперь ваш друг`); openProfile(p.name); } }, 'Принять заявку');
      else if (p.requested) relation = h('span', { class: 'status registering' }, 'Заявка отправлена');
      else relation = h('button', { type: 'button', class: 'btn btn-gold btn-sm', onclick: async () => { const r = await call('friends:add', { name: p.name }); if (r) { setFriends(r); toast('Заявка отправлена'); openProfile(p.name); } } }, 'Добавить в друзья');
    }
    const where = p.where && p.where[0];

    const head = h('section', { class: 'phead' },
      h('div', { class: 'phead-av' }, NR.avatarEl(p.name, p.avatar, 'xl'), p.online ? h('i', { class: 'dot', 'aria-label': 'онлайн' }) : null),
      h('div', { class: 'phead-main' },
        h('p', { class: 'eyebrow' }, p.me ? 'Мой профиль' : p.online ? 'Онлайн' : 'Профиль игрока'),
        h('h1', { class: 'h1' }, p.name, p.role === 'admin' ? h('span', { class: 'status registering' }, 'админ') : null),
        h('p', { class: 'muted' }, `В клубе с ${since} · друзей: ${p.friends}`),
        h('div', { class: 'phead-act' },
          relation,
          where ? h('a', { class: 'btn btn-dark btn-sm', href: where.href }, `Сейчас: ${where.name}`) : null,
          p.me ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: toggleEditor }, 'Сменить аватар') : null)),
      h('div', { class: 'phead-chips' },
        h('small', null, 'Фишек'), h('b', null, fmt(p.chips)), h('span', null, `${p.rank} место из ${p.players}`)));

    const editor = p.me ? avatarEditor(p) : null;

    const games = h('section', { class: 'pgrid' },
      h('article', { class: 'pcard' },
        h('h2', { class: 'h3' }, 'Покер'),
        h('div', { class: 'pstats' },
          stat('Раздач', fmt(s.poker.hands)),
          stat('Выиграно', fmt(s.poker.won), pct(s.poker.won, s.poker.hands)),
          stat('Итог за кэш', signed(s.poker.net)),
          stat('Крупнейший банк', fmt(s.poker.biggestPot)),
          stat('Лучшая рука', s.poker.bestHand >= 0 ? HAND_NAMES[s.poker.bestHand] : '—'),
          stat('Вскрытий', fmt(s.poker.showdowns)))),
      h('article', { class: 'pcard' },
        h('h2', { class: 'h3' }, 'Турниры Sit & Go'),
        h('div', { class: 'pstats' },
          stat('Сыграно', fmt(s.sng.played)),
          stat('Победы', fmt(s.sng.won), pct(s.sng.won, s.sng.played)),
          stat('В призах', fmt(s.sng.itm), pct(s.sng.itm, s.sng.played)),
          stat('Итог', signed(s.sng.prizes - s.sng.buyins)))),
      h('article', { class: 'pcard' },
        h('h2', { class: 'h3' }, 'Дурак'),
        h('div', { class: 'pstats' },
          stat('Партий', fmt(s.durak.games)),
          stat('Вышел первым', fmt(s.durak.wins), pct(s.durak.wins, s.durak.games)),
          stat('Остался дураком', fmt(s.durak.losses)),
          stat('Итог', signed(s.durak.net)))),
      h('article', { class: 'pcard' },
        h('h2', { class: 'h3' }, 'Блэкджек'),
        h('div', { class: 'pstats' },
          stat('Раундов', fmt(s.bj.rounds)),
          stat('Выигрыши', fmt(s.bj.wins), pct(s.bj.wins, s.bj.rounds)),
          stat('Блэкджеков', fmt(s.bj.blackjacks)),
          stat('Итог', signed(s.bj.net)))),
      s.roulette ? h('article', { class: 'pcard' },
        h('h2', { class: 'h3' }, 'Рулетка'),
        h('div', { class: 'pstats' },
          stat('Спинов', fmt(s.roulette.spins)),
          stat('В плюс', fmt(s.roulette.wins), pct(s.roulette.wins, s.roulette.spins)),
          stat('Ставок на число', fmt(s.roulette.straight), 'выиграло'),
          stat('Итог', signed(s.roulette.net)))) : null,
      s.checkers ? h('article', { class: 'pcard' },
        h('h2', { class: 'h3' }, 'Шашки'),
        h('div', { class: 'pstats' },
          stat('Партий', fmt(s.checkers.games)),
          stat('Победы', fmt(s.checkers.wins), pct(s.checkers.wins, s.checkers.games)),
          stat('Ничьи', fmt(s.checkers.draws)),
          stat('Итог', signed(s.checkers.net)))) : null);

    const ach = p.achievements;
    const doneN = ach.filter((a) => a.done).length;
    const achievements = h('section', { class: 'pcard' },
      h('div', { class: 'panel-head' }, h('h2', { class: 'h3' }, 'Достижения'), h('span', { class: 'muted small' }, `${doneN} из ${ach.length}`)),
      h('div', { class: 'ach-grid' }, ach.map((a) => h('div', { class: 'ach' + (a.done ? ' done' : '') },
        h('span', { class: 'ach-ico', 'aria-hidden': 'true' }, a.done ? '★' : '☆'),
        h('span', { class: 'ach-txt' }, h('b', null, a.title), h('small', null, a.text),
          a.progress ? h('span', { class: 'ach-bar', role: 'progressbar', 'aria-valuenow': a.progress[0], 'aria-valuemax': a.progress[1], 'aria-label': a.title },
            h('i', { style: `width:${Math.round((a.progress[0] / a.progress[1]) * 100)}%` })) : null,
          a.progress ? h('small', { class: 'ach-num' }, `${fmt(a.progress[0])} / ${fmt(a.progress[1])}`) : null),
        p.me && a.done && !a.claimed
          ? h('button', { type: 'button', class: 'btn btn-gold btn-sm ach-claim', onclick: async () => { const r = await call('ach:claim', { id: a.id }); if (!r) return; toast(`«${a.title}»: +${fmt(r.reward)} фишек`); Sound.play('win'); if (window.Progress) window.Progress.refresh(); openProfile(P.name); } }, `+${fmt(a.reward)}`)
          : h('span', { class: 'ach-reward' + (a.claimed ? ' got' : '') }, a.claimed ? 'получено' : `+${fmt(a.reward)}`)))));

    const chart = h('section', { class: 'pcard' },
      h('div', { class: 'panel-head' }, h('h2', { class: 'h3' }, 'Фишки по дням'), h('span', { class: 'muted small' }, p.history.length ? `последние ${p.history.length} дн.` : '')),
      chipsChart(p.history));

    const recent = h('section', { class: 'pcard' },
      h('h2', { class: 'h3' }, 'Последние игры'),
      p.recent.length
        ? h('ul', { class: 'recent' }, p.recent.map((r) => h('li', null,
          h('span', { class: 'rk' }, KIND[r.kind]),
          h('span', { class: 'rt' }, h('b', null, r.kind === 'roulette' && r.spins > 1 ? `${r.spins} ${plural(r.spins, 'спин', 'спина', 'спинов')}` : r.kind === 'poker' && r.hands ? `${r.hands} ${plural(r.hands, 'раздача', 'раздачи', 'раздач')}${r.best ? ` · лучшая рука: ${r.best}` : ''}` : r.text), h('small', null, `${r.table} · ${new Date(r.t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`)),
          h('span', { class: 'rn ' + (r.net > 0 ? 'plus' : r.net < 0 ? 'minus' : '') }, signed(r.net)))))
        : h('p', { class: 'muted' }, 'Пока пусто — сыграйте партию в любой из игр.'));

    view.replaceChildren(...[
      h('div', { class: 'profile-top' }, h('a', { href: '#/', class: 'btn btn-ghost btn-sm' }, '← Лобби')),
      head, editor, games, h('div', { class: 'pgrid pgrid-2' }, chart, recent), achievements].filter(Boolean));
  }

  // ---------- avatar editor ----------
  let editorOpen = false;
  function toggleEditor() { editorOpen = !editorOpen; renderProfile(); }

  /** Crop to a square, shrink to 256 px and upload; the original may be up to 1 MB. */
  async function uploadAvatar(f) {
    if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) { toast('Нужна картинка PNG, JPEG, WebP или GIF', true); return; }
    if (f.size > 1024 * 1024) { toast('Картинка больше 1 МБ — выберите файл поменьше', true); return; }
    let blob = f;
    try {
      const bmp = await createImageBitmap(f);
      const side = Math.min(bmp.width, bmp.height);
      const size = Math.min(256, side);
      const c = document.createElement('canvas'); c.width = c.height = size;
      c.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
      const out = await new Promise((r) => c.toBlob(r, 'image/webp', 0.9));
      if (out && out.type === 'image/webp' && out.size < f.size) blob = out;
    } catch (e) { /* keep the original file */ }
    const res = await fetch('/api/avatar', { method: 'POST', headers: { Authorization: 'Bearer ' + S.token, 'Content-Type': blob.type }, body: blob })
      .then((r) => r.json()).catch(() => ({ error: 'Не удалось загрузить картинку' }));
    if (!res || res.error) { toast(res && res.error ? res.error : 'Не удалось загрузить картинку', true); return; }
    editorOpen = false;
    toast('Аватар обновлён');
    openProfile(P.name);
  }
  async function removeAvatarImage() {
    const res = await fetch('/api/avatar', { method: 'DELETE', headers: { Authorization: 'Bearer ' + S.token } }).then((r) => r.json()).catch(() => null);
    if (!res || res.error) { toast('Не получилось', true); return; }
    toast('Картинка убрана');
    openProfile(P.name);
  }
  function avatarEditor(p) {
    if (!editorOpen) return null;
    const cur = { hue: p.avatar && p.avatar.hue != null ? p.avatar.hue : NR.hueOf(p.name), sym: (p.avatar && p.avatar.sym) || '', img: (p.avatar && p.avatar.img) || undefined };
    const preview = NR.avatarEl(p.name, cur, 'xl');
    const redraw = () => NR.fillAvatar(preview, p.name, cur);
    const hues = h('div', { class: 'av-hues', role: 'radiogroup', 'aria-label': 'Цвет' }, HUES.map((hu) => h('button', {
      type: 'button', class: 'av-hue', role: 'radio', style: `--hue:${hu}`, 'aria-label': `Оттенок ${hu}`, 'aria-checked': hu === cur.hue ? 'true' : 'false',
      onclick: (e) => { cur.hue = hu; $$('.av-hue').forEach((b) => b.setAttribute('aria-checked', b === e.currentTarget ? 'true' : 'false')); redraw(); },
    })));
    const syms = h('div', { class: 'av-syms', role: 'radiogroup', 'aria-label': 'Значок' }, SYMBOLS.map((sy) => h('button', {
      type: 'button', class: 'av-symbtn', role: 'radio', 'aria-label': sy ? `Значок ${sy}` : 'Инициалы', 'aria-checked': sy === cur.sym ? 'true' : 'false',
      onclick: (e) => { cur.sym = sy; $$('.av-symbtn').forEach((b) => b.setAttribute('aria-checked', b === e.currentTarget ? 'true' : 'false')); redraw(); },
    }, NR.avatarEl(p.name, { hue: 40, sym: sy }, 'sm'))));
    const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', class: 'sr-only', id: 'av-file' });
    file.addEventListener('change', () => { const f = file.files && file.files[0]; file.value = ''; if (f) uploadAvatar(f); });
    const hasImg = !!(p.avatar && p.avatar.img);
    return h('section', { class: 'pcard av-editor' },
      preview,
      h('div', { class: 'av-controls' },
        h('h2', { class: 'h3' }, 'Своя картинка'),
        h('div', { class: 'av-upload' },
          file,
          h('label', { class: 'btn btn-gold btn-sm', for: 'av-file' }, hasImg ? 'Заменить картинку' : 'Загрузить картинку'),
          hasImg ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: removeAvatarImage }, 'Убрать картинку') : null,
          h('small', { class: 'muted' }, 'PNG, JPEG, WebP или GIF до 1 МБ. Картинка обрежется в круг.')),
        h('h2', { class: 'h3' }, hasImg ? 'Цвет ника и фона (без картинки)' : 'Цвет'), hues,
        h('h2', { class: 'h3' }, 'Значок'), syms,
        h('div', { class: 'modal-actions' },
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: toggleEditor }, 'Отмена'),
          h('button', {
            type: 'button', class: 'btn btn-gold btn-sm',
            onclick: async () => {
              const r = await call('profile:avatar', cur);
              if (!r) return;
              editorOpen = false;
              toast('Аватар обновлён');
              openProfile(P.name);
            },
          }, 'Сохранить'))));
  }

  // ---------- chips chart: one series, line + area, hover tooltip ----------
  function chipsChart(rows) {
    const wrap = h('div', { class: 'chart' });
    if (rows.length < 2) {
      wrap.append(h('p', { class: 'muted' }, rows.length ? `Сегодня: ${fmt(rows[0].v)} фишек. График появится со второго дня игры.` : 'Данных пока нет.'));
      return wrap;
    }
    const W = 640; const H = 220; const L = 56; const R = 12; const T = 14; const B = 28;
    const vs = rows.map((r) => r.v);
    let lo = Math.min(...vs); let hi = Math.max(...vs);
    if (hi === lo) { hi += 1; lo = Math.max(0, lo - 1); }
    const pad = (hi - lo) * 0.1;
    lo = Math.max(0, lo - pad); hi += pad;
    const x = (i) => L + (i * (W - L - R)) / (rows.length - 1);
    const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const NS = 'http://www.w3.org/2000/svg';
    const el = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img', 'aria-label': `Фишки по дням: от ${fmt(vs[0])} до ${fmt(vs[vs.length - 1])}` });
    // grid: 3 recessive lines with labels
    for (let k = 0; k <= 2; k++) {
      const v = lo + ((hi - lo) * k) / 2;
      svg.append(el('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'grid' }));
      const t = el('text', { x: L - 8, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' });
      t.textContent = v >= 1000 ? `${(v / 1000).toFixed(v >= 100000 ? 0 : 1).replace('.', ',')}K` : fmt(Math.round(v));
      svg.append(t);
    }
    const dfmt = (d) => { const [, m, dd] = d.split('-'); return `${dd}.${m}`; };
    for (const i of [0, rows.length - 1]) {
      const t = el('text', { x: x(i), y: H - 8, class: 'axis', 'text-anchor': i ? 'end' : 'start' });
      t.textContent = dfmt(rows[i].d);
      svg.append(t);
    }
    const pts = rows.map((r, i) => `${x(i).toFixed(1)},${y(r.v).toFixed(1)}`);
    svg.append(el('path', { d: `M${pts[0]} L${pts.join(' L')} L${x(rows.length - 1)},${H - B} L${L},${H - B} Z`, class: 'area' }));
    svg.append(el('path', { d: `M${pts.join(' L')}`, class: 'line' }));
    const last = rows.length - 1;
    svg.append(el('circle', { cx: x(last), cy: y(rows[last].v), r: 4, class: 'end' }));
    // hover: crosshair + dot + tooltip
    const cross = el('line', { y1: T, y2: H - B, class: 'cross', visibility: 'hidden' });
    const dot = el('circle', { r: 5, class: 'hover', visibility: 'hidden' });
    svg.append(cross, dot);
    const tip = h('div', { class: 'chart-tip', hidden: true });
    const hit = el('rect', { x: L, y: 0, width: W - L - R, height: H, fill: 'transparent' });
    svg.append(hit);
    const move = (ev) => {
      const rect = svg.getBoundingClientRect();
      const px = ((ev.clientX - rect.left) / rect.width) * W;
      const i = Math.max(0, Math.min(last, Math.round(((px - L) / (W - L - R)) * last)));
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(rows[i].v)); dot.setAttribute('visibility', 'visible');
      const prev = i ? rows[i].v - rows[i - 1].v : 0;
      tip.replaceChildren(h('small', null, dfmt(rows[i].d)), h('b', null, fmt(rows[i].v)), i ? h('span', { class: prev > 0 ? 'plus' : prev < 0 ? 'minus' : '' }, `за день ${signed(prev)}`) : null);
      tip.hidden = false;
      const left = (x(i) / W) * rect.width;
      tip.style.left = `${Math.min(rect.width - 120, Math.max(0, left - 60))}px`;
      tip.style.top = `${(y(rows[i].v) / H) * rect.height - 64}px`;
    };
    const leave = () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tip.hidden = true; };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerleave', leave);
    wrap.append(svg, tip);
    const change = vs[last] - vs[0];
    wrap.append(h('p', { class: 'muted small chart-sum' }, `С ${dfmt(rows[0].d)}: ${signed(change)} фишек`));
    return wrap;
  }

  // ================= wiring =================
  let dirtyTimer = null;
  let bound = null;
  function bind(socket) {
    if (!socket || bound === socket) return;
    bound = socket;
    socket.on('connect', () => loadFriends());
    if (socket.connected) loadFriends();
    socket.on('friends:dirty', () => { clearTimeout(dirtyTimer); dirtyTimer = setTimeout(loadFriends, 300); });
    socket.on('friends:request', (e) => { toast(`${e.from.name} хочет добавить вас в друзья`); Sound.play('turn'); loadFriends(); });
    socket.on('invite', showInvite);
  }
  setInterval(() => { if (S.socket && S.socket.connected && !document.hidden) loadFriends(); }, 30000);

  window.SocialUI = { bind, openProfile, loadFriends };
  // play.js may already have connected before this file loaded
  if (S.socket) bind(S.socket);
  if (/^#\/profile/.test(location.hash)) NR.route();
})();
