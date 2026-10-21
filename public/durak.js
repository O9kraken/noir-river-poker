(() => {
  'use strict';
  const { $, $$, h, fmt, anim, cardEl, toast, call, Sound, S, hueOf, initials } = window.NR;

  const VARIANTS = { podkidnoy: 'Подкидной', perevodnoy: 'Переводной' };
  const SUIT_SIGNS = { s: '♠︎', h: '♥︎', d: '♦︎', c: '♣︎' };
  const SUIT_WORDS = { s: 'пики', h: 'черви', d: 'бубны', c: 'трефы' };

  const D = { id: null, st: null, prev: null, at: 0, selected: null };

  // ---------- open / close ----------
  async function open(id) {
    if (D.id === id) return;
    if (D.id) call('durak:unwatch', { tableId: D.id }, true);
    D.id = id;
    D.st = null;
    D.prev = null;
    D.selected = null;
    const res = await call('durak:watch', { tableId: id });
    if (!res) { location.hash = '#/'; return; }
    onState(res.state);
  }
  function close() {
    if (D.id) call('durak:unwatch', { tableId: D.id }, true);
    D.id = null;
    D.st = null;
  }
  function reset() { D.id = null; }

  function onState(st) {
    if (st.id !== D.id) return;
    D.prev = D.st;
    D.st = st;
    D.at = performance.now();
    if (st.mySeat >= 0) S.myDurak.add(st.id); else S.myDurak.delete(st.id);
    if (D.selected && !st.hand.includes(D.selected)) D.selected = null;
    if (st.you && st.you.role !== 'defender') D.selected = null;
    render();
    effects();
  }

  const act = (type, extra = {}) => call('durak:act', { tableId: D.id, type, ...extra });

  // ---------- geometry ----------
  function seatPos(i, st) {
    const base = st.mySeat >= 0 ? st.mySeat : 0;
    const k = (i - base + st.maxPlayers) % st.maxPlayers;
    const ang = Math.PI / 2 + (k * 2 * Math.PI) / st.maxPlayers;
    return { x: 50 + 51 * Math.cos(ang), y: 50 + 51 * Math.sin(ang) };
  }

  // ---------- render ----------
  function render() {
    const st = D.st;
    if (!st) return;
    document.title = `${st.name} — дурак — NOIR RIVER`;
    $('#dk-name').textContent = st.name;
    $('#dk-meta').textContent = `${VARIANTS[st.variant]} · ставка ${fmt(st.stake)} · до ${st.maxPlayers} игроков`;
    $('#dk-game').textContent = st.gameNo ? `Партия #${st.gameNo}` : '';

    renderSeats(st);
    renderCenter(st);
    renderResult(st);
    renderHand(st);
    renderStatus(st);
    renderControls(st);
    renderSide(st);
  }

  function renderSeats(st) {
    const layer = $('#dk-seats');
    layer.replaceChildren();
    const waiting = new Set(st.waiting.seats);
    st.seats.forEach((s, i) => {
      const p = seatPos(i, st);
      const style = `left:${p.x}%;top:${p.y}%`;
      if (!s) {
        if (st.status === 'playing' || st.status === 'result') return; // keep the felt clean during a game
        const canSit = st.mySeat === -1 && (st.status !== 'playing' && st.status !== 'result');
        layer.append(h('div', { class: 'seat dk-seat', style },
          canSit
            ? h('button', { type: 'button', class: 'empty-seat', onclick: () => sit(i), 'aria-label': `Сесть на место ${i + 1}` }, 'Сесть')
            : h('span', { class: 'empty-seat static', 'aria-hidden': 'true' }, 'Свободно')));
        return;
      }
      const isMe = i === st.mySeat;
      const turn = waiting.has(i) && st.status === 'playing';
      let tag = '';
      let tagCls = 'seat-tag';
      if (st.status === 'playing' && s.inGame) {
        if (s.out) { tag = `Вышел · ${s.place}`; tagCls += ' win'; }
        else if (s.defender) tag = st.taking ? 'Берёт' : 'Отбивается';
        else if (s.attacker) tag = 'Ходит';
        else if (s.passed) tag = st.taking ? 'Пас' : 'Бито';
      } else if (st.status === 'result' && st.result) {
        const pay = st.result.payouts.find((x) => x.seat === i);
        if (st.result.durak && st.result.durak.seat === i) { tag = 'Дурак'; tagCls += ' allin'; }
        else if (pay) { tag = pay.net > 0 ? `+${fmt(pay.net)}` : 'Ничья'; tagCls += ' win'; }
      } else if (s.ready) { tag = 'Готов'; tagCls += ' win'; }

      // the durak's leftover cards are shown face up after the game
      const loserCards = st.status === 'result' && st.result && st.result.durak && st.result.durak.seat === i ? st.result.durak.cards : null;
      const backs = loserCards && !isMe
        ? loserCards.slice(0, 8).map((c) => cardEl(c))
        : !isMe && s.inGame && st.status !== 'waiting'
          ? Array.from({ length: Math.min(s.cards, 7) }, () => cardEl(null)) : [];
      const cls = ['seat', 'dk-seat', isMe && 'me', turn && 'turn', s.out && 'out', !s.connected && 'away',
        st.result && st.result.durak && st.result.durak.seat === i && 'durak'].filter(Boolean).join(' ');
      layer.append(h('div', { class: cls, style },
        h('div', { class: 'seat-cards dk-backs' }, backs),
        h('div', { class: 'seat-box' },
          tag ? h('span', { class: tagCls }, tag) : null,
          h('div', { class: 'avatar', style: `--hue:${hueOf(s.name)}`, 'aria-hidden': 'true' }, initials(s.name)),
          h('div', { class: 'seat-info' },
            h('div', { class: 'seat-name', title: s.name }, s.name),
            h('div', { class: 'seat-stack' }, s.inGame && st.status !== 'waiting' ? `${s.cards} карт` : s.ready ? 'готов' : 'ждёт'),
            !s.connected ? h('div', { class: 'offline' }, 'не в сети') : null),
          turn ? h('div', { class: 'timer', 'aria-hidden': 'true' }, h('i', { 'data-dk-timer': '' })) : null)));
    });
  }

  function renderCenter(st) {
    const deck = $('#dk-deck');
    deck.replaceChildren();
    if (st.trumpCard) {
      if (st.deck > 0) {
        deck.append(
          h('div', { class: 'dk-trump' }, cardEl(st.trumpCard)),
          st.deck > 1 ? h('div', { class: 'dk-stack' }, cardEl(null)) : null,
          h('span', { class: 'dk-count' }, `${st.deck}`));
      }
      deck.append(h('div', { class: 'dk-suit ' + (st.trump === 'h' || st.trump === 'd' ? 'red' : ''), title: `Козырь: ${SUIT_WORDS[st.trump]}` },
        h('span', { 'aria-hidden': 'true' }, SUIT_SIGNS[st.trump]), h('small', null, 'козырь')));
    }

    const table = $('#dk-table');
    const you = st.you || {};
    const sel = D.selected;
    table.replaceChildren(...st.table.map((p, idx) => {
      const target = !!(sel && you.defend && you.defend[idx] && you.defend[idx].includes(sel));
      const pair = h(target ? 'button' : 'div', {
        class: 'dk-pair' + (target ? ' target' : '') + (p.d ? ' beaten' : ''),
        type: target ? 'button' : null,
        'aria-label': target ? `Побить картой ${sel}` : null,
        onclick: target ? () => { D.selected = null; act('defend', { card: sel, index: idx }); } : null,
      }, cardEl(p.a, 'dk-a'), p.d ? cardEl(p.d, 'dk-d') : null);
      pair.dataset.key = p.a + (p.d || '');
      return pair;
    }));
    if (!st.table.length && st.status === 'playing') table.append(h('div', { class: 'dk-empty muted' }, 'Стол пуст'));
    $('#dk-discard').replaceChildren(
      st.discard ? h('div', { class: 'dk-stack dk-bito' }, cardEl(null)) : null,
      st.discard ? h('span', { class: 'dk-count' }, `бито ${st.discard}`) : null);
  }

  function renderResult(st) {
    const box = $('#dk-result');
    if (st.status === 'result' && st.result) {
      const r = st.result;
      box.replaceChildren(
        r.draw ? h('div', null, h('b', null, 'Ничья'), ' — ставки возвращены')
          : h('div', null, 'Дурак — ', h('b', null, r.durak.name), r.forfeit ? ' (вышел из партии)' : ''),
        r.draw ? null : h('div', { class: 'small' }, r.payouts.filter((p) => p.amount > 0).map((p) => `${p.name} +${fmt(p.net)}`).join(' · ')));
      box.hidden = false;
    } else if (st.status === 'countdown') {
      box.replaceChildren(h('div', null, 'Раздаём карты через ', h('b', { 'data-dk-countdown': '' }, Math.ceil(st.countdownIn / 1000)), '…'));
      box.hidden = false;
    } else if (st.status === 'waiting') {
      const seated = st.seats.filter(Boolean).length;
      box.replaceChildren(seated < 2 ? 'Ждём игроков…' : 'Партия начнётся, когда все за столом нажмут «Готов»');
      box.hidden = false;
    } else box.hidden = true;
  }

  function playableSet(st) {
    const you = st.you;
    const set = new Set();
    if (!you || !you.inGame || st.status !== 'playing') return set;
    (you.throwable || []).forEach((c) => set.add(c));
    (you.transfer || []).forEach((c) => set.add(c));
    Object.values(you.defend || {}).forEach((cs) => cs.forEach((c) => set.add(c)));
    return set;
  }

  function renderHand(st) {
    const handEl = $('#dk-hand');
    const playable = playableSet(st);
    const prevHand = D.prev && D.prev.id === st.id ? new Set(D.prev.hand) : new Set();
    const n = st.hand.length;
    handEl.style.setProperty('--overlap', n > 14 ? '-0.62' : n > 9 ? '-0.45' : n > 6 ? '-0.25' : '0.08');
    handEl.replaceChildren(...st.hand.map((c) => {
      const can = playable.has(c);
      const el = h('button', {
        type: 'button',
        class: 'dk-card' + (can ? ' playable' : '') + (D.selected === c ? ' selected' : ''),
        'aria-label': `Карта ${c[0] === 'T' ? '10' : c[0]} ${SUIT_WORDS[c[1]]}${can ? '' : ', сейчас не сыграть'}`,
        onclick: () => clickCard(c),
      }, cardEl(c, c[1] === st.trump ? 'trump' : ''));
      if (prevHand.size && !prevHand.has(c)) el.classList.add('fresh');
      return el;
    }));
    // newly drawn cards slide in from the deck
    $$('.dk-card.fresh', handEl).forEach((el, k) => anim(el, [
      { transform: 'translateY(-60px) scale(.7)', opacity: 0 }, { transform: 'none', opacity: 1 },
    ], { duration: 320, delay: k * 70, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' }));
  }

  function renderStatus(st) {
    const el = $('#dk-status');
    const you = st.you;
    let text = '';
    if (st.mySeat === -1) text = st.status === 'playing' ? 'Идёт партия — можно наблюдать.' : 'Выберите свободное место, чтобы сыграть.';
    else if (st.status === 'waiting') text = you.ready ? 'Вы готовы. Ждём остальных…' : `Нажмите «Готов» — ставка ${fmt(st.stake)} спишется при раздаче.`;
    else if (st.status === 'countdown') text = 'Сейчас раздадим карты…';
    else if (st.status === 'result') {
      const r = st.result;
      const mine = r && r.payouts.find((p) => p.seat === st.mySeat);
      text = !mine ? 'Партия окончена' : r.draw ? 'Ничья — ставка вернулась' : mine.net < 0 ? `Вы дурак: −${fmt(-mine.net)}` : `Вы выиграли +${fmt(mine.net)}`;
    } else if (!you.inGame) text = 'Вы сыграете в следующей партии.';
    else if (you.out) text = 'Вы вышли из игры — ждём, кто останется дураком.';
    else {
      const w = st.waiting;
      const mineTurn = w.seats.includes(st.mySeat);
      const nameOf = (i) => (st.seats[i] ? st.seats[i].name : '');
      if (w.kind === 'lead') text = mineTurn ? 'Ваш ход — положите любую карту' : `Ходит ${nameOf(w.seats[0])}`;
      else if (w.kind === 'defend') {
        if (mineTurn) text = (you.transfer && you.transfer.length) ? 'Отбивайтесь или переведите: выберите карту' : 'Отбивайтесь: выберите карту, затем карту на столе — или «Беру»';
        else text = `${nameOf(w.seats[0])} отбивается`;
      } else if (w.kind === 'throw') {
        if (mineTurn) text = st.taking ? 'Соперник берёт — подкиньте вдогонку или «Пас»' : 'Можно подкинуть карту или сказать «Бито»';
        else text = st.taking ? `${nameOf(st.seats.findIndex((s) => s && s.defender))} берёт…` : 'Ждём, подкинут ли ещё…';
      }
    }
    el.textContent = text;
  }

  function renderControls(st) {
    const box = $('#dk-ctrl');
    box.replaceChildren();
    const you = st.you;
    if (st.mySeat === -1) return;
    if (st.status === 'waiting' || st.status === 'countdown') {
      box.append(
        you.ready
          ? h('button', { type: 'button', class: 'btn btn-dark', onclick: () => call('durak:ready', { tableId: D.id, value: false }) }, 'Не готов')
          : h('button', { type: 'button', class: 'btn btn-gold', onclick: ready }, `Готов · ${fmt(st.stake)}`),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: leave }, 'Встать'));
      return;
    }
    if (st.status !== 'playing' || !you.inGame || you.out) {
      if (st.status !== 'playing') box.append(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: leave }, 'Встать'));
      return;
    }
    if (D.selected && you.transfer && you.transfer.includes(D.selected)) {
      const c = D.selected;
      box.append(h('button', { type: 'button', class: 'btn btn-gold', onclick: () => { D.selected = null; act('transfer', { card: c }); } }, 'Перевести'));
    }
    if (you.canTake) box.append(h('button', { type: 'button', class: 'btn btn-red', onclick: () => act('take') }, 'Беру'));
    if (you.canPass) box.append(h('button', { type: 'button', class: 'btn btn-dark', onclick: () => act('pass') }, st.taking ? 'Пас' : 'Бито'));
    box.append(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: leave }, 'Сдаться'));
  }

  // ---------- actions ----------
  async function sit(i) {
    const res = await call('durak:sit', { tableId: D.id, seat: i });
    if (res) S.myDurak.add(D.id);
  }
  function ready() { call('durak:ready', { tableId: D.id, value: true }); }
  async function leave() {
    const st = D.st;
    const live = st.status === 'playing' && st.you && st.you.inGame && !st.you.out;
    if (live && !confirm('Выйти из партии? Вам засчитают поражение и ставку.')) return;
    await call('durak:leave', { tableId: D.id });
    S.myDurak.delete(D.id);
  }

  function clickCard(c) {
    const st = D.st;
    const you = st.you;
    if (!you || !you.inGame || st.status !== 'playing') return;
    if (you.role !== 'defender') {
      if ((you.throwable || []).includes(c)) act('attack', { card: c });
      else toast(st.table.length ? 'Подкидывать можно только карты тех же достоинств, что на столе' : 'Сейчас не ваш ход', true);
      return;
    }
    const targets = Object.entries(you.defend || {}).filter(([, cs]) => cs.includes(c)).map(([i]) => Number(i));
    const canTr = (you.transfer || []).includes(c);
    if (!targets.length && !canTr) { toast('Этой картой не побить', true); return; }
    if (targets.length === 1 && !canTr) { D.selected = null; act('defend', { card: c, index: targets[0] }); return; }
    if (!targets.length && canTr) { D.selected = null; act('transfer', { card: c }); return; }
    D.selected = D.selected === c ? null : c;
    render();
  }

  // ---------- effects ----------
  function effects() {
    const st = D.st;
    const prev = D.prev;
    if (!prev || prev.id !== st.id) return;
    // new cards on the table
    const before = new Set(prev.table.map((p) => p.a + (p.d || '')));
    let added = 0;
    $$('#dk-table .dk-pair').forEach((el) => {
      if (before.has(el.dataset.key)) return;
      added++;
      const lastCard = el.lastElementChild;
      anim(lastCard, [{ transform: 'translateY(-30px) rotate(-8deg) scale(.8)', opacity: 0 }, { transform: 'none', opacity: 1 }],
        { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
    });
    if (added) Sound.play('card');
    if (prev.table.length && !st.table.length && st.status === 'playing') Sound.play(prev.taking ? 'chips' : 'fold');
    if (prev.status !== 'playing' && st.status === 'playing') Sound.play('deal');
    if (prev.status === 'playing' && st.status === 'result') {
      const mine = st.result && st.result.payouts.find((p) => p.seat === st.mySeat);
      Sound.play(mine && mine.net > 0 ? 'bigwin' : mine && mine.net < 0 ? 'fold' : 'win', 0.1);
    }
    const myTurnNow = st.status === 'playing' && st.waiting.seats.includes(st.mySeat);
    const myTurnBefore = prev.status === 'playing' && prev.waiting.seats.includes(prev.mySeat) && prev.waiting.kind === st.waiting.kind;
    if (myTurnNow && !myTurnBefore && st.waiting.kind !== 'throw') Sound.play('turn');
  }

  // ---------- side ----------
  $$('[data-dk-tab]').forEach((tab) => tab.addEventListener('click', () => {
    const which = tab.dataset.dkTab;
    $$('[data-dk-tab]').forEach((x) => { x.classList.toggle('is-active', x === tab); x.setAttribute('aria-selected', x === tab); });
    $('#dk-chat-pane').hidden = which !== 'chat';
    $('#dk-log-pane').hidden = which !== 'log';
    $('#dk-rules-pane').hidden = which !== 'rules';
  }));

  function fillList(el, items, mk) {
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    el.replaceChildren(...items.map(mk));
    if (atBottom) el.scrollTop = el.scrollHeight;
  }
  function renderSide(st) {
    if (!st.chat.length) $('#dk-chat').replaceChildren(h('li', { class: 'sys' }, 'Здесь пока тихо.'));
    else fillList($('#dk-chat'), st.chat, (m) => h('li', null, h('b', null, m.name), m.text));
    fillList($('#dk-log'), st.log, (l) => h('li', { class: l.text.startsWith('—') ? 'sep' : '' }, l.text));
  }
  $('#dk-chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#dk-chat-input');
    const text = input.value.trim();
    if (!text || !D.id) return;
    if (await call('durak:chat', { tableId: D.id, text })) input.value = '';
  });

  // ---------- timers ----------
  function tick() {
    const st = D.st;
    if (st && !$('#durak-view').hidden) {
      const elapsed = performance.now() - D.at;
      if (st.status === 'playing' && st.deadlineIn) {
        const frac = Math.max(0, st.deadlineIn - elapsed) / (st.actionTime || 30000);
        $$('[data-dk-timer]').forEach((bar) => {
          bar.style.transform = `scaleX(${frac})`;
          bar.classList.toggle('low', frac < 0.3);
        });
      }
      const cd = $('[data-dk-countdown]');
      if (cd) cd.textContent = Math.max(1, Math.ceil((st.countdownIn - elapsed) / 1000));
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  window.DurakUI = { open, close, reset, onState };
})();
