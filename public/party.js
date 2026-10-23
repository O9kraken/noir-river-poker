/* Party board games: the «Настолки» hub, table shell (seats, ready, chat, timers) and the game plug-ins. */
(() => {
  'use strict';
  const { $, $$, h, fmt, toast, call, Sound, S } = window.NR;
  const NR = window.NR;
  const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const GAMES = {
    bomb: { title: 'Котобомба', players: '2–10', time: '10–15 мин', art: '/art/pt-bomb.webp', tag: 'Тяни карту и молись. Вытянул бомбу без сапёра — взорвался. Последний выживший забирает всё.', accent: 'bomb' },
    spy: { title: 'Шпионы', players: '4–10', time: '15–25 мин', art: '/art/pt-spy.webp', tag: 'Две команды, 25 слов. Капитан говорит одно слово — команда ищет своих агентов и молится не открыть ликвидатора.', accent: 'spy' },
    dungeon: { title: 'Подземелье', players: '3–6', time: '30–50 мин', art: '/art/pt-dungeon.webp', tag: 'Выбивай двери, бей монстров сковородкой, подставляй друзей. Первый, кто дорастёт до нужного уровня, побеждает.', accent: 'dungeon' },
    dark: { title: 'Без тормозов', players: '3–10', time: '20–30 мин', art: '/art/pt-dark.webp', tag: 'Чёрный юмор 18+. Ведущий читает вопрос с пропуском, остальные вставляют самый ужасный ответ. Стыдно должно быть всем.', accent: 'dark' },
  };
  const OPTIONS = {
    dark: { key: 'goal', label: 'До скольких очков', items: [[5, 'До 5 очков'], [7, 'До 7 очков'], [10, 'До 10 очков']], def: 7 },
    spy: { key: 'clueSec', label: 'Время капитану', items: [[60, '60 секунд на подсказку'], [90, '90 секунд на подсказку'], [150, '150 секунд — без спешки']], def: 90 },
  };
  // «Без цензуры»: where the game is built on text, the table can turn on the version with swearing
  const MAT = {
    dark: { def: true, label: 'Без цензуры — с матом', note: 'Добавляет в колоду вопросы и ответы с русским матом' },
    dungeon: { def: false, label: 'Тексты карт с матом', note: 'Те же карты, но шутки на картах — покрепче' },
  };
  // the rules shown in the waiting room and in the «Правила» tab: [title, text, list?]
  const RULES = {
    bomb: [
      ['Цель', 'Не взорваться. В колоде лежат котобомбы — на одну меньше, чем игроков. Кто вытянул бомбу и не смог её обезвредить, выбывает. Последний выживший забирает банк (или просто победу, если стол на интерес).'],
      ['Раздача', 'Каждый получает «Сапёра» и 7 карт. Ещё несколько сапёров и все бомбы замешиваются в колоду. На столе видно, сколько бомб осталось и какой шанс вытянуть бомбу прямо сейчас.'],
      ['Ваш ход', 'Сначала сыграйте сколько угодно карт — по одной или парами/тройками котов. Затем обязательно возьмите верхнюю карту колоды: это конец хода. «Смыться» и «Перевести стрелки» заканчивают ход без взятия карты.'],
      ['Котобомба', 'Вытянули бомбу и есть «Сапёр» — бомба обезврежена, и вы сами тайно кладёте её обратно в колоду: сверху, вторым, на дно или наугад. Нет сапёра — бум, вы выбыли, ваши карты уходят в сброс.'],
      ['Ни за что!', 'Отменяет действие любой карты, кроме бомбы и сапёра. Играется в любой момент, даже не в свой ход, пока на столе горит таймер отмены. Отмену можно отменить ещё одним «Ни за что!» — и так до бесконечности.'],
      ['Коты', 'Коты сами ничего не делают. Пара одинаковых котов — вытяните случайную карту у выбранного соперника. Тройка — назовите карту и заберите её, если она у него есть.'],
      ['Совет', 'Держите сапёра до конца, «Гадалку» играйте, когда бомб в колоде много, а «Перевести стрелки» — когда видите бомбу сверху. И не забывайте: соседи слышат, как вы нервничаете в голосовом чате.'],
    ],
    spy: [
      ['Команды', 'Игроки делятся на Алых и Лазурных. В каждой команде один капитан, остальные — агенты. Перед стартом можно выбрать команду и попроситься в капитаны. Капитан видит раскраску поля, агенты — только слова.'],
      ['Поле', '25 слов: 9 агентов команды, которая ходит первой, 8 агентов другой, 7 мирных прохожих и 1 ликвидатор. Каждая партия — новое поле из словаря на 240+ слов.'],
      ['Подсказка', 'Капитан называет одно слово и число — сколько слов на поле с ним связано. Нельзя называть слово с поля, однокоренное с ним или несколько слов. «0» — без ограничения.'],
      ['Отгадки', 'Агенты обсуждают (лучше в голосовом чате!), отмечают слова и открывают по одному. Свой агент — можно продолжать, всего на одно слово больше числа подсказки. Прохожий или чужой агент — ход переходит к соперникам. Можно остановиться самим.'],
      ['Ликвидатор', 'Открыли ликвидатора — ваша команда тут же проиграла, сколько бы агентов ни нашла до этого.'],
      ['Победа', 'Первая команда, нашедшая всех своих агентов, побеждает. Банк делят все её игроки, включая капитана.'],
      ['Совет', 'Капитан, не жадничайте: подсказка на 2 надёжнее, чем на 4. Агенты, следите за подсказками соперников — по ним видно, где их слова.'],
    ],
    dungeon: [
      ['Цель', 'Первым дорасти до 10 уровня. Все начинают с 1-го. Десятый уровень можно взять только победой над монстром — купить или вымолить его нельзя.'],
      ['Ход', '1) Выбейте дверь. Монстр — сразу бой. Проклятие — срабатывает на вас. Любая другая карта — в руку. 2) Если боя не было: найдите неприятности (выставьте монстра с руки и деритесь) или пошарьте по углам (ещё карта двери в руку). 3) В конце хода больше 5 карт быть не может — лишнее уходит самому слабому игроку.'],
      ['Бой', 'Ваша сила — уровень плюс бонусы снаряжения и класса. Нужно строго больше, чем у монстра. Победили — получаете уровень (за больших монстров — два) и сокровища. После «Бить!» у остальных есть 6 секунд, чтобы вмешаться.'],
      ['Помощь и подставы', 'Не хватает сил — примите помощь: помощник складывает свою силу с вашей и получает половину сокровищ. Остальные могут подыграть монстру: разовые карты, усилители («Матёрый», «Голодный и злой»), «Бродячая тварь» с ещё одним монстром.'],
      ['Бегство', 'Не можете победить — бегите. На кубике 5–6 — удрали (Ловкач и некоторые вещи дают +1). Не удрали — монстр делает с вами своё «непотребство»: отнимает уровни, вещи или убивает. Мёртвый теряет всё и возвращается в свой ход с новыми картами.'],
      ['Снаряжение', 'Слоты: голова, броня, обувь, две руки (или одна двуручная вещь) и два «прочих». Надевать и снимать можно в свой ход вне боя. Вещи на 1000 золотых можно сдать скупщику за уровень. Нажмите на игрока сверху — увидите, что на нём надето.'],
      ['Классы', 'Громила: +1 в любом бою. Ловкач: +1 к побегу. Колдун: в своём бою сжигает до трёх карт с руки, +1 за каждую. Знахарь: +3 против нежити. Некоторые вещи носит только свой класс.'],
      ['Проклятия', 'Проклятие можно сыграть на любого игрока в любой момент вне боя: минус уровень, потеря вещи или карт. Отличный способ притормозить лидера.'],
    ],
    dark: [
      ['Раунд', 'Ведущий открывает чёрную карту — вопрос или фразу с пропуском. Остальные выбирают из своих 10 белых карт самый смешной, жёсткий или абсурдный ответ. На некоторые чёрные карты нужно два ответа — по порядку.'],
      ['Выбор', 'Когда все ответили, карты открываются вперемешку: ведущий не знает, кто что положил. Он выбирает лучший ответ, его автор получает очко. Ведущий меняется по кругу.'],
      ['Своя карта', 'У каждого есть одна пустая карта: впишите любой ответ — это ваш козырь. Ещё раз в партию можно сменить всю руку, заплатив одно очко.'],
      ['Победа', 'Первый, кто наберёт нужное число очков, побеждает и забирает банк.'],
      ['Без цензуры', 'Стол можно создать с колодой «без цензуры» — там вопросы и ответы с русским матом. На столе это видно в названии игры.'],
      ['18+', 'Здесь чёрный юмор для взрослых. Если чья-то вписанная карта перешла грань — нажмите на ник в чате и пожалуйтесь, администраторы разберутся.'],
    ],
  };

  const C = { id: null, st: null, prev: null, at: 0, ui: {}, seenKey: null, evSeq: 0, filter: 'all' };
  const send = (type, data = {}, quiet) => call('pt:act', { tableId: C.id, type, data }, quiet);
  const evt = (ev, extra = {}) => call(ev, { tableId: C.id, ...extra });

  // ================= the hub =================
  function hubOpen() {
    document.title = 'Настолки — NOIR RIVER';
    renderHub();
  }
  function hubRefresh() { if (!$('#party-view').hidden) renderHub(); }
  const STATUS = { waiting: 'Ждут игроков', countdown: 'Старт…', playing: 'Идёт партия', result: 'Итоги' };

  function renderHub() {
    const grid = $('#pt-games');
    grid.replaceChildren(...Object.entries(GAMES).map(([k, g]) => {
      const live = (S.pt || []).filter((t) => t.game === k);
      const players = live.reduce((a, t) => a + t.players, 0);
      return h('article', { class: 'pt-game pt-' + g.accent },
        h('button', { type: 'button', class: 'pt-game-art', onclick: () => { C.filter = k; renderHub(); $('#pt-tables').scrollIntoView({ behavior: REDUCE ? 'auto' : 'smooth', block: 'start' }); }, 'aria-label': `Столы: ${g.title}` },
          h('img', { src: g.art, alt: '', width: 1600, height: 1000, loading: 'lazy', decoding: 'async' }),
          h('span', { class: 'pt-game-live' }, players ? `${players} ${NR.plural ? NR.plural(players, 'игрок', 'игрока', 'игроков') : 'игр.'} за столами` : `${live.length} ${live.length === 1 ? 'стол' : 'стола'}`)),
        h('div', { class: 'pt-game-body' },
          h('div', { class: 'pt-game-head' }, h('h2', { class: 'h3' }, g.title), h('span', { class: 'pt-chip' }, g.players), h('span', { class: 'pt-chip ghost' }, g.time)),
          h('p', { class: 'muted' }, g.tag),
          h('div', { class: 'pt-game-acts' },
            h('button', { type: 'button', class: 'btn btn-gold btn-sm', onclick: () => openCreate(k) }, 'Создать стол'),
            h('button', { type: 'button', class: 'btn btn-dark btn-sm', onclick: () => openPractice(k) }, 'С ботами'))));
    }));
    // tables
    const chips = $('#pt-filter');
    chips.replaceChildren(...[['all', 'Все'], ...Object.entries(GAMES).map(([k, g]) => [k, g.title])].map(([k, label]) =>
      h('button', { type: 'button', class: 'pt-fchip' + (C.filter === k ? ' on' : ''), 'aria-pressed': C.filter === k, onclick: () => { C.filter = k; renderHub(); } }, label)));
    const rows = (S.pt || []).concat((S.private || []).filter((t) => t.kind === 'pt' && !t.practice))
      .filter((t) => C.filter === 'all' || t.game === C.filter)
      .sort((a, b) => (S.myPt.has(b.id) - S.myPt.has(a.id)) || (b.private - a.private) || (b.players - a.players) || a.stake - b.stake);
    const list = $('#pt-list');
    if (!rows.length) { list.replaceChildren(h('div', { class: 'empty' }, 'Столов нет — создайте свой и позовите друзей.')); return; }
    list.replaceChildren(...rows.map((t) => {
      const mine = S.myPt.has(t.id);
      const g = GAMES[t.game] || {};
      return h('a', { class: 'pt-row pt-' + (g.accent || '') + (mine ? ' mine' : ''), href: `#/pt/${t.id}` },
        h('span', { class: 'pt-row-badge', 'aria-hidden': 'true' }, BADGE[t.game] || '◆'),
        h('span', { class: 'pt-row-main' },
          h('b', null, t.name, t.private ? h('span', { class: 'pt-priv' }, `приватный · ${t.owner || ''}`) : null),
          h('small', null, `${g.title || t.gameTitle} · ${t.stake ? `ставка ${fmt(t.stake)}` : 'на интерес'}`)),
        h('span', { class: 'pt-row-seats' }, h('b', null, `${t.players}/${t.maxSeats}`), h('small', null, t.players < t.minPlayers ? `нужно от ${t.minPlayers}` : STATUS[t.status])),
        h('span', { class: 'btn btn-sm ' + (mine ? 'btn-gold' : 'btn-dark') }, mine ? 'Вернуться' : t.status === 'playing' ? 'Смотреть' : 'Открыть'));
    }));
  }
  const BADGE = { bomb: '✶', spy: '◉', dungeon: '⚔', dark: '18+' };

  // ----- create & practice dialogs -----
  function openCreate(game) {
    const d = $('#modal-pt-create');
    const f = $('#pt-create-form');
    f.game.value = game;
    fillCreate(game);
    d.showModal();
  }
  function fillCreate(game) {
    const f = $('#pt-create-form');
    const G = (S.ptGames || {})[game] || { min: 2, max: 10 };
    $$('[data-pt-game]').forEach((b) => { b.classList.toggle('on', b.dataset.ptGame === game); b.setAttribute('aria-pressed', b.dataset.ptGame === game); });
    f.game.value = game;
    const pl = f.players;
    pl.replaceChildren(...Array.from({ length: G.max - G.min + 1 }, (_, i) => G.min + i).map((n) => h('option', { value: n }, `до ${n} игроков`)));
    pl.value = String(Math.min(G.max, game === 'dungeon' ? 5 : game === 'bomb' ? 6 : 8));
    const st = f.stake;
    st.replaceChildren(...(S.ptStakes || [0]).map((x) => h('option', { value: x }, x ? `${fmt(x)} фишек с каждого — банк победителям` : 'На интерес — без ставки')));
    st.value = '0';
    const o = OPTIONS[game];
    const wrap = $('#pt-opt');
    wrap.hidden = !o;
    if (o) {
      $('#pt-opt-label').textContent = o.label;
      f.option.replaceChildren(...o.items.map(([v, l]) => h('option', { value: v }, l)));
      f.option.value = String(o.def);
    }
    $('#pt-create-desc').textContent = GAMES[game].tag;
    matBox($('#pt-mat'), game);
  }
  /** The «без цензуры» checkbox, shown only for the games built on text. */
  function matBox(box, game) {
    const m = MAT[game];
    box.hidden = !m;
    if (!m) return;
    box.querySelector('input').checked = m.def;
    box.querySelector('b').textContent = m.label;
    box.querySelector('small').textContent = m.note;
  }
  const matOf = (form, game) => (MAT[game] ? { mat: form.mat.checked } : {});
  $$('[data-pt-game]').forEach((b) => b.addEventListener('click', () => fillCreate(b.dataset.ptGame)));
  $('#pt-create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const game = f.game.value;
    const o = OPTIONS[game];
    const res = await call('pt:create', { game, name: f.name.value, stake: Number(f.stake.value), maxPlayers: Number(f.players.value), options: { ...(o ? { [o.key]: Number(f.option.value) } : {}), ...matOf(f, game) }, private: f.private.checked });
    if (!res) return;
    $('#modal-pt-create').close();
    f.name.value = '';
    location.hash = `#/pt/${res.tableId}`;
  });

  function openPractice(game) {
    const f = $('#pt-practice-form');
    const G = (S.ptGames || {})[game] || { min: 2, max: 10 };
    f.game.value = game;
    $('#pt-practice-title').textContent = `${GAMES[game].title} с ботами`;
    const n = f.bots;
    n.replaceChildren(...Array.from({ length: G.max - Math.max(1, G.min - 1) }, (_, i) => Math.max(1, G.min - 1) + i).filter((k) => k <= G.max - 1).map((k) => h('option', { value: k }, `${k + 1} игроков: вы и ${k} ${k === 1 ? 'бот' : k < 5 ? 'бота' : 'ботов'}`)));
    n.value = String(Math.min(G.max - 1, game === 'spy' ? 5 : 3));
    const lv = f.level;
    lv.replaceChildren(...(S.botLevels || [{ id: 'normal', name: 'Любитель' }]).map((l) => h('option', { value: l.id }, l.name)));
    lv.value = 'normal';
    $('#pt-practice-note').textContent = game === 'spy' ? 'Боты-капитаны дают подсказки по темам слов, а агенты-боты ждут, пока вы подумаете.' : game === 'dark' ? 'Боты отвечают наугад — иногда это смешнее, чем кажется.' : 'Без фишек и статистики — просто разобраться в правилах.';
    matBox($('#pt-practice-mat'), game);
    $('#modal-pt-practice').showModal();
  }
  $('#pt-practice-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const res = await call('practice:create', { game: 'pt', variant: f.game.value, level: f.level.value, bots: Number(f.bots.value), options: matOf(f, f.game.value) });
    if (!res) return;
    $('#modal-pt-practice').close();
    location.hash = res.href;
  });

  // ================= the table =================
  async function open(id) {
    if (C.id === id) return;
    if (C.id) call('pt:unwatch', { tableId: C.id }, true);
    C.id = id; C.st = null; C.prev = null; C.ui = {}; C.evSeq = 0; C.seenKey = null;
    const res = await call('pt:watch', { tableId: id });
    if (!res) { location.hash = '#/party'; return; }
    onState(res.state);
  }
  function close() { if (C.id) call('pt:unwatch', { tableId: C.id }, true); C.id = null; C.st = null; }

  function onState(st) {
    if (st.id !== C.id) return;
    C.prev = C.st;
    C.st = st;
    C.at = performance.now();
    if (st.mySeat >= 0) S.myPt.add(st.id); else S.myPt.delete(st.id);
    if (st.turn && st.turn.key && st.turn.key !== C.seenKey) { C.seenKey = st.turn.key; evt('pt:seen', { key: st.turn.key }); }
    if (C.prev && C.prev.gameNo !== st.gameNo) C.ui = {};
    render();
  }

  const nameOf = (seat) => { const s = C.st.seats[seat]; return s ? s.name : '—'; };
  const avatarOf = (seat, cls = 'sm') => { const s = C.st.seats[seat]; return NR.avatarEl(s ? s.name : '?', s ? s.avatar : null, cls); };
  /** A countdown that the frame loop keeps fresh. */
  /**
   * A countdown that the frame loop keeps fresh. Without the full length known, the first time
   * this deadline was seen gives it, so the ring does not refill on every update.
   */
  C.tmax = new Map();
  function timer(left, total, cls = '') {
    if (!left) return null;
    const until = C.at + left;
    const key = cls + ':' + Math.round(until / 1500);
    if (!C.tmax.has(key)) { C.tmax.set(key, Math.max(left, total || 0)); if (C.tmax.size > 60) C.tmax.delete(C.tmax.keys().next().value); }
    const full = Math.max(total || 0, C.tmax.get(key));
    return h('span', { class: 'pt-timer ' + cls, 'data-until': String(until), 'data-total': String(full) }, h('i', null), h('b', null, ''));
  }

  function render() {
    const st = C.st;
    const G = GAMES[st.game] || {};
    document.title = `${st.name} — ${G.title || 'Настолки'} — NOIR RIVER`;
    $('#pt-view').className = 'table-view pt-view pt-' + (G.accent || '');
    $('#pt-name').textContent = st.name;
    $('#pt-meta').textContent = `${G.title} · ${st.practice ? 'с ботами' : st.stake ? `ставка ${fmt(st.stake)}` : 'на интерес'} · ${st.minPlayers}–${st.maxSeats} игроков`;
    $('#pt-game').textContent = st.gameNo ? `Партия #${st.gameNo}` : '';
    const stage = $('#pt-stage');
    const playing = st.g && (st.status === 'playing' || st.status === 'result');
    stage.classList.toggle('waiting', !playing);
    const ctx = { st, g: st.g, prev: C.prev && C.prev.g, seat: st.inGame ? st.mySeat : -1, ui: C.ui, send, nameOf, avatarOf, timer, h, fmt, toast, Sound, NR, rerender: render };
    if (playing && window.PartyGames && window.PartyGames[st.game]) {
      const ev = st.g.ev;
      ctx.fresh = ev && ev.seq !== C.evSeq ? ev : null;
      if (ev) C.evSeq = ev.seq;
      if (!stage.querySelector('.pt-board')) stage.replaceChildren(h('div', { class: 'pt-board' }), h('div', { class: 'pt-dock' }));
      window.PartyGames[st.game].render(stage.querySelector('.pt-board'), stage.querySelector('.pt-dock'), ctx);
      if (ctx.fresh) sounds(ctx.fresh);
    } else {
      renderWaiting(stage);
    }
    renderResult();
    renderSide();
  }

  function sounds(ev) {
    const map = { boom: 'boom', defused: 'whoosh', play: 'card', nope: 'check', draw: 'card', shuffle: 'deal', steal: 'card', clue: 'turn', open: 'move', won: 'win', door: 'whoosh', win: 'win', flee: 'dice', oneshot: 'card', curse: 'fold', level: 'coin', round: 'deal' };
    if (map[ev.type]) Sound.play(map[ev.type]);
    if (ev.type === 'boom' && !REDUCE) { const s = $('#pt-stage'); s.classList.remove('shake'); void s.offsetWidth; s.classList.add('shake'); }
  }

  // ----- waiting room -----
  function renderWaiting(stage) {
    const st = C.st;
    const G = GAMES[st.game] || {};
    const seated = st.seats.filter(Boolean).length;
    const mine = st.mySeat >= 0 ? st.seats[st.mySeat] : null;
    const seats = st.seats.map((s, i) => h('div', { class: 'pt-seat' + (s ? '' : ' free') + (s && s.ready ? ' ready' : '') + (i === st.mySeat ? ' me' : '') },
      s ? avatarOf(i) : h('span', { class: 'pt-seat-free', 'aria-hidden': 'true' }, '+'),
      h('b', null, s ? s.name : 'Свободно'),
      s ? h('small', null, [s.ready ? 'готов' : 'ждёт', s.pref && s.pref.team ? (s.pref.team === 'r' ? ' · за Алых' : ' · за Лазурных') : '', s.pref && s.pref.captain ? ' · капитан?' : '', s.connected ? '' : ' · не в сети'].join('')) : null));
    const btns = [];
    if (mine) {
      btns.push(h('button', { type: 'button', class: 'btn ' + (mine.ready ? 'btn-ghost' : 'btn-gold'), onclick: () => evt('pt:ready', { value: !mine.ready }) }, mine.ready ? 'Не готов' : st.stake ? `Готов · ${fmt(st.stake)}` : 'Готов'));
      btns.push(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => evt('pt:leave') }, 'Встать'));
    } else if (st.seats.some((s) => !s) && st.status !== 'playing') btns.push(h('button', { type: 'button', class: 'btn btn-gold', onclick: () => evt('pt:sit', {}) }, `Сесть за стол${st.stake ? ` · ставка ${fmt(st.stake)}` : ''}`));
    else if (st.status === 'playing') btns.push(h('span', { class: 'muted' }, 'Идёт партия — можно смотреть. Сесть получится, когда она закончится.'));
    const prefs = [];
    if (mine && st.game === 'spy') {
      const p = mine.pref || {};
      prefs.push(h('div', { class: 'pt-prefs' },
        h('span', { class: 'muted small' }, 'Команда:'),
        ...[['r', 'Алые'], ['b', 'Лазурные'], [null, 'Всё равно']].map(([v, l]) => h('button', { type: 'button', class: 'pt-fchip ' + (v === 'r' ? 'red ' : v === 'b' ? 'blue ' : '') + ((p.team || null) === v ? 'on' : ''), onclick: () => evt('pt:pref', { pref: { team: v } }) }, l)),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!p.captain, onchange: (e) => evt('pt:pref', { pref: { captain: e.target.checked } }) }), h('span', null, 'Хочу быть капитаном'))));
    }
    const note = st.status === 'countdown' ? 'Раздаём карты…' : seated < st.minPlayers ? `За столом ${seated}, нужно минимум ${st.minPlayers}. Позовите друзей — кнопка «Пригласить» сверху.` : 'Когда все нажмут «Готов», партия начнётся.';
    stage.replaceChildren(h('div', { class: 'pt-wait' },
      h('img', { class: 'pt-wait-art', src: G.art, alt: '', width: 1600, height: 1000 }),
      h('div', { class: 'pt-wait-body' },
        h('p', { class: 'eyebrow' }, G.title),
        h('h2', { class: 'h2' }, st.status === 'countdown' ? 'Начинаем!' : 'Собираем компанию'),
        h('p', { class: 'muted' }, note),
        h('div', { class: 'pt-seats' }, ...seats),
        ...prefs,
        btns.length ? h('div', { class: 'pt-actions' }, ...btns) : null,
        h('p', { class: 'muted small' }, G.tag)),
      rulesBlock(st.game, st.options)));
  }

  /** The full rules and the deck, for the time while the company gathers. */
  function rulesBlock(game, options = {}) {
    const items = RULES[game] || [];
    const deck = deckGallery(game);
    return h('section', { class: 'pt-rules' },
      h('h3', null, 'Как играть'),
      h('div', { class: 'pt-rules-grid' }, ...items.map(([t, p], i) => h('article', { class: 'pt-rule' }, h('h4', null, h('i', null, String(i + 1)), t), h('p', null, p)))),
      MAT[game] ? h('p', { class: 'pt-deck-note' }, options.mat ? 'За этим столом: без цензуры.' : 'За этим столом: без мата.') : null,
      deck ? h('h3', null, 'Карты') : null,
      deck ? h('p', { class: 'pt-deck-note' }, 'Наведите на карту (на телефоне — подержите палец), чтобы прочитать её целиком.') : null,
      deck);
  }
  function deckGallery(game) {
    const D = (S.ptDecks || {})[game];
    const R = window.PartyGames && window.PartyGames[game];
    if (!D || !R || !R.cardEl) return null;
    const keys = Object.keys(D).filter((k) => !D[k].hidden);
    return h('div', { class: 'pt-deck' }, ...keys.map((k) => R.cardEl(k, D)));
  }

  function renderResult() {
    const st = C.st;
    const box = $('#pt-result');
    if (st.status !== 'result' || !st.result) { box.hidden = true; return; }
    const r = st.result;
    const won = r.winners.includes(st.mySeat);
    const key = `${st.gameNo}`;
    if (C.resultShown !== key) { C.resultShown = key; Sound.play(won ? 'bigwin' : st.inGame ? 'fold' : 'win'); }
    const mine = st.mySeat >= 0 ? st.seats[st.mySeat] : null;
    box.hidden = false;
    box.replaceChildren(h('div', { class: 'pt-result-card' + (won ? ' won' : '') },
      h('p', { class: 'eyebrow' }, won ? 'Победа' : 'Партия окончена'),
      h('b', null, r.text || `Победа: ${r.names.join(', ')}`),
      r.share && won ? h('span', { class: 'pt-win-chips' }, `+${fmt(r.share)} фишек`) : null,
      r.scores ? h('ol', { class: 'pt-scores' }, ...Object.entries(r.scores).sort((a, b) => b[1] - a[1]).map(([s, v]) => h('li', { class: r.winners.includes(Number(s)) ? 'win' : '' }, h('span', null, nameOf(Number(s))), h('b', null, v)))) : null,
      h('div', { class: 'pt-actions' },
        mine ? h('button', { type: 'button', class: 'btn btn-gold', onclick: () => evt('pt:ready', { value: true }) }, 'Ещё партию') : null,
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { box.hidden = true; } }, 'Посмотреть стол'))));
  }

  // ----- side: chat, log, rules -----
  $$('[data-pt-tab]').forEach((tab) => tab.addEventListener('click', () => {
    const which = tab.dataset.ptTab;
    $$('[data-pt-tab]').forEach((x) => { x.classList.toggle('is-active', x === tab); x.setAttribute('aria-selected', x === tab); });
    for (const k of ['chat', 'log', 'rules']) $(`#pt-${k}-pane`).hidden = which !== k;
  }));
  function fill(el, items, mk) {
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    el.replaceChildren(...items.map(mk));
    if (atBottom) el.scrollTop = el.scrollHeight;
  }
  function renderSide() {
    const st = C.st;
    if (!st.chat.length) $('#pt-chat').replaceChildren(h('li', { class: 'sys' }, 'Здесь пока тихо. Поздоровайтесь!'));
    else fill($('#pt-chat'), st.chat, (m) => (m.sys ? h('li', { class: 'sys' }, m.text) : h('li', null, NR.chatNick(m), m.text)));
    fill($('#pt-log'), st.log, (l) => h('li', null, l.text));
    if (C.rulesFor !== st.game) {
      C.rulesFor = st.game;
      $('#pt-rules-pane').replaceChildren(...(RULES[st.game] || []).map(([t, p]) => h('p', null, h('b', null, t + '. '), p)), deckGallery(st.game) || '');
    }
  }
  $('#pt-chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#pt-chat-input');
    const text = input.value.trim();
    if (!text || !C.id) return;
    if (await evt('pt:chat', { text })) input.value = '';
  });

  // ----- timers -----
  function tick() {
    if (C.st && !$('#pt-view').hidden) {
      const now = performance.now();
      for (const el of $$('#pt-view .pt-timer[data-until]')) {
        const left = Math.max(0, Number(el.dataset.until) - now);
        const total = Number(el.dataset.total) || 1;
        const s = Math.ceil(left / 1000);
        const b = el.querySelector('b');
        const txt = s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : String(s);
        if (b.textContent !== txt) b.textContent = txt;
        el.style.setProperty('--p', String(Math.min(1, left / total)));
        el.classList.toggle('low', left < 6000);
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ----- shared bits for the games -----
  /** Players around the top of the board. extra(p) returns badges for each. */
  function strip(ctx, players, { active = [], extra = () => null, cls = () => '', onPick = null, pickable = () => false, quiet = false } = {}) {
    const st = ctx.st;
    return h('div', { class: 'pt-strip' }, ...players.map((p) => {
      const s = st.seats[p.seat];
      const can = onPick && pickable(p);
      const tag = can ? 'button' : 'div';
      return h(tag, {
        ...(can ? { type: 'button', onclick: () => onPick(p.seat) } : {}),
        class: ['pt-pl', active.includes(p.seat) && 'active', p.seat === ctx.seat && 'me', s && !s.connected && 'off', can && (quiet ? 'click' : 'can'), cls(p)].filter(Boolean).join(' '),
        'data-seat': p.seat,
      },
      h('span', { class: 'pt-pl-av' }, ctx.avatarOf(p.seat, 'sm'), st.turn && st.turn.seat === p.seat ? ctx.timer(st.turn.left, st.turn.ms, 'ring') : null),
      h('b', { class: 'pt-pl-name' }, p.name || ctx.nameOf(p.seat)),
      extra(p));
    }));
  }
  function fly(fromSel, toSel, html, opts = {}) {
    if (REDUCE) return;
    const a = typeof fromSel === 'string' ? $(fromSel) : fromSel;
    const b = typeof toSel === 'string' ? $(toSel) : toSel;
    if (!a || !b) return;
    const ra = a.getBoundingClientRect(); const rb = b.getBoundingClientRect();
    const el = h('div', { class: 'pt-fly ' + (opts.cls || '') });
    if (html) el.append(html);
    el.style.left = `${ra.left + ra.width / 2}px`; el.style.top = `${ra.top + ra.height / 2}px`;
    document.body.append(el);
    const dx = rb.left + rb.width / 2 - (ra.left + ra.width / 2); const dy = rb.top + rb.height / 2 - (ra.top + ra.height / 2);
    el.animate([{ transform: 'translate(-50%,-50%) scale(.9) rotate(-8deg)', opacity: 0.2 }, { transform: 'translate(-50%,-50%) scale(1.05)', opacity: 1, offset: 0.25 }, { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.8) rotate(6deg)`, opacity: 0.9 }], { duration: opts.ms || 620, easing: 'cubic-bezier(.3,.7,.3,1)' }).onfinish = () => el.remove();
  }
  // ----- zoom: hover a card (or hold a finger on it) to read it in full -----
  let zoomEl = null; let zoomTimer = null; let zoomFrom = null; let zoomK = null;
  function zoomHide() { clearTimeout(zoomTimer); zoomTimer = null; zoomFrom = null; zoomK = null; if (zoomEl) { zoomEl.remove(); zoomEl = null; } }
  function zoomShow(card) {
    if (zoomEl) { zoomEl.remove(); zoomEl = null; }
    zoomFrom = card;
    const copy = card.cloneNode(true);
    copy.classList.remove('sel', 'sm', 'dim');
    copy.removeAttribute('style');
    copy.setAttribute('aria-hidden', 'true');
    copy.tabIndex = -1;
    zoomEl = h('div', { class: 'pt-zoom' }, copy);
    document.body.append(zoomEl);
    const r = card.getBoundingClientRect();
    const w = zoomEl.offsetWidth; const hh = zoomEl.offsetHeight;
    let x = r.left + r.width / 2 - w / 2;
    let y = r.top - hh - 12;
    if (y < 8) y = Math.min(innerHeight - hh - 8, r.bottom + 12);
    if (y < 8) { y = 8; x = r.right + 12 + w < innerWidth ? r.right + 12 : r.left - w - 12; }
    zoomEl.style.left = Math.max(8, Math.min(innerWidth - w - 8, x)) + 'px';
    zoomEl.style.top = Math.max(8, y) + 'px';
  }
  const zoomable = (t) => t && t.closest && t.closest('#pt-view [data-zoom], #party-view [data-zoom]');
  // the table re-renders on every update, so a card is followed by what it is, not by its element
  const zoomKey = (c) => (c.dataset.id ? 'id' + c.dataset.id : '') + ':' + ((c.querySelector('b') || {}).textContent || '');
  const findByKey = (k) => [...document.querySelectorAll('#pt-view [data-zoom], #party-view [data-zoom]')].find((x) => zoomKey(x) === k && x.matches(':hover'));
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const c = zoomable(e.target);
    if (!c) { if (zoomFrom || zoomK) { zoomHide(); zoomK = null; } return; }
    const k = zoomKey(c);
    if (k === zoomK) { zoomFrom = c; return; }
    zoomHide();
    zoomK = k;
    zoomFrom = c;
    zoomTimer = setTimeout(() => { const el = zoomFrom && zoomFrom.isConnected ? zoomFrom : findByKey(k); if (el && zoomK === k) zoomShow(el); }, 380);
  });
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') { zoomHide(); return; }
    const c = zoomable(e.target);
    zoomHide();
    if (!c) return;
    zoomFrom = c;
    zoomTimer = setTimeout(() => { if (zoomFrom === c && c.isConnected) { zoomShow(c); c.dataset.zoomed = '1'; } }, 420);
  });
  document.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') { clearTimeout(zoomTimer); if (zoomEl) setTimeout(zoomHide, 900); } });
  document.addEventListener('click', (e) => { const c = zoomable(e.target); if (c && c.dataset.zoomed) { delete c.dataset.zoomed; e.stopPropagation(); e.preventDefault(); } }, true);
  addEventListener('scroll', zoomHide, true);
  addEventListener('hashchange', zoomHide);
  document.addEventListener('contextmenu', (e) => { if (zoomable(e.target) && e.pointerType !== 'mouse') e.preventDefault(); });

  document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('[data-party-go]'); if (a) C.filter = a.dataset.partyGo; });
  window.PartyKit = { strip, fly, GAMES, REDUCE };

  window.PartyUI = { open, close, onState, hubOpen, hubRefresh, openCreate, openPractice };
})();
