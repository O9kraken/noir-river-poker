(() => {
  'use strict';
  const { $, $$, h, fmt, anim, cardEl, toast, call, Sound, S } = window.NR;
  const NR = window.NR;

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
    const snap = capture(D.prev, st); // positions of what is about to disappear
    render();
    effects(snap);
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
    $('#dk-meta').textContent = st.practice ? `${VARIANTS[st.variant]} · против компьютера, без ставки` : `${VARIANTS[st.variant]} · ставка ${fmt(st.stake)} · до ${st.maxPlayers} игроков`;
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
      layer.append(h('div', { class: cls, style, 'data-seat': i },
        h('div', { class: 'seat-cards dk-backs' }, backs),
        h('div', { class: 'seat-box' },
          tag ? h('span', { class: tagCls }, tag) : null,
          NR.avatarEl(s.name, s.avatar),
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
        deck.append(...[
          h('div', { class: 'dk-trump' }, cardEl(st.trumpCard)),
          st.deck > 1 ? h('div', { class: 'dk-stack' }, cardEl(null)) : null,
          h('span', { class: 'dk-count' }, `${st.deck}`)].filter(Boolean));
      }
      deck.append(h('div', { class: 'dk-suit s-' + st.trump, title: `Козырь: ${SUIT_WORDS[st.trump]}` },
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
    table.classList.toggle('ending', !!st.roundEnding);
    if (st.roundEnding) {
      table.append(h('div', { class: 'dk-stamp' + (st.roundEnding.took ? ' took' : ''), role: 'status' }, st.roundEnding.took ? 'Забирает' : 'Бито'));
    }
    $('#dk-discard').replaceChildren(...(st.discard
      ? [h('div', { class: 'dk-stack dk-bito' }, cardEl(null)), h('span', { class: 'dk-count' }, `бито ${st.discard}`)]
      : []));
  }

  function renderResult(st) {
    const box = $('#dk-result');
    if (st.status === 'result' && st.result) {
      const r = st.result;
      box.replaceChildren(...[
        r.draw ? h('div', null, h('b', null, 'Ничья'), ' — ставки возвращены')
          : h('div', null, 'Дурак — ', h('b', null, r.durak.name), r.forfeit ? ' (вышел из партии)' : ''),
        r.draw ? null : h('div', { class: 'small' }, r.payouts.filter((p) => p.amount > 0).map((p) => `${p.name} +${fmt(p.net)}`).join(' · '))].filter(Boolean));
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
        'data-card': c,
        'aria-label': `Карта ${c[0] === 'T' ? '10' : c[0]} ${SUIT_WORDS[c[1]]}${can ? '' : ', сейчас не сыграть'}`,
        onclick: () => clickCard(c),
      }, cardEl(c, c[1] === st.trump ? 'trump' : ''));
      if (prevHand.size && !prevHand.has(c)) el.classList.add('fresh');
      return el;
    }));
  }

  function renderStatus(st) {
    const el = $('#dk-status');
    const you = st.you;
    let text = '';
    if (st.mySeat === -1) text = st.status === 'playing' ? 'Идёт партия — можно наблюдать.' : 'Выберите свободное место, чтобы сыграть.';
    else if (st.status === 'waiting') text = you.ready ? 'Вы готовы. Ждём остальных…' : (st.practice ? 'Нажмите «Готов» — компьютерные соперники уже ждут.' : `Нажмите «Готов» — ставка ${fmt(st.stake)} спишется при раздаче.`);
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
      if (w.kind === 'pause') text = st.roundEnding && st.roundEnding.took ? `${nameOf(st.roundEnding.defender)} забирает карты` : 'Бито — карты уходят в отбой';
      else if (w.kind === 'lead') text = mineTurn ? 'Ваш ход — положите любую карту' : `Ходит ${nameOf(w.seats[0])}`;
      else if (w.kind === 'defend') {
        if (mineTurn) text = (you.transfer && you.transfer.length) ? 'Отбивайтесь или переведите: выберите карту' : 'Отбивайтесь: выберите карту, затем карту на столе — или «Беру»';
        else text = `${nameOf(w.seats[0])} отбивается`;
      } else if (w.kind === 'throw') {
        if (mineTurn) {
          const canAdd = (you.throwable || []).length > 0;
          if (st.taking) text = canAdd ? 'Соперник берёт — подкиньте ему ещё карты или нажмите «Пас»' : 'Соперник берёт — подкинуть нечего, нажмите «Пас»';
          else text = canAdd ? 'Всё побито — подкиньте ещё или подтвердите «Бито»' : 'Всё побито — подтвердите «Бито»';
        }
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
          : h('button', { type: 'button', class: 'btn btn-gold', onclick: ready }, st.stake ? `Готов · ${fmt(st.stake)}` : 'Готов'),
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
    if (you.canPass) {
      // the main attacker must confirm: make it the obvious button
      const main = you.role === 'attacker';
      box.append(h('button', { type: 'button', class: 'btn ' + (main ? 'btn-gold dk-confirm' : 'btn-dark'), onclick: () => act('pass') },
        st.taking ? (main ? 'Пас — пусть забирает' : 'Пас') : 'Бито'));
    }
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
  function fxLayer() {
    let l = document.getElementById('dk-fx');
    if (!l) { l = h('div', { id: 'dk-fx', class: 'dk-fx', 'aria-hidden': 'true' }); document.body.append(l); }
    return l;
  }
  const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  const rectOf = (sel) => { const el = typeof sel === 'string' ? $(sel) : sel; return el ? el.getBoundingClientRect() : null; };
  const seatRect = (i) => rectOf(`#dk-seats [data-seat="${i}"] .seat-box`);

  function capture(prev, st) {
    const snap = { hand: new Map(), ghosts: [], seatCards: [] };
    if (!prev || prev.id !== st.id) return snap;
    $$('#dk-hand .dk-card').forEach((b) => snap.hand.set(b.dataset.card, b.getBoundingClientRect()));
    if (prev.table.length && !st.table.length) {
      $$('#dk-table .card').forEach((c) => {
        const r = c.getBoundingClientRect();
        if (r.width) snap.ghosts.push({ node: c.cloneNode(true), rect: r });
      });
    }
    snap.seatCards = prev.seats.map((x) => (x ? x.cards : 0));
    return snap;
  }

  /** A clone that flies from one screen rect to another and disappears. */
  function flyGhost(node, from, to, { delay = 0, duration = 520, rotate = 0, scale = 0.6, fade = true } = {}) {
    if (!from || !to || !node.animate) return;
    const g = node.cloneNode(true);
    g.classList.add('dk-ghost');
    g.style.cssText = `left:${from.left}px;top:${from.top}px;width:${from.width}px;height:${from.height}px;--cw:${from.width}px`;
    fxLayer().append(g);
    const a = center(from);
    const b = center(to);
    const anim2 = g.animate([
      { transform: 'translate(0,0) rotate(0) scale(1)', opacity: 1 },
      { transform: `translate(${b.x - a.x}px,${b.y - a.y}px) rotate(${rotate}deg) scale(${scale})`, opacity: fade ? 0 : 0.9 },
    ], { duration, delay, easing: 'cubic-bezier(.45,.05,.3,1)', fill: 'both' });
    anim2.onfinish = () => g.remove();
  }

  /** FLIP: an element already in place animates in from where it came from. */
  function flyIn(el, from, { delay = 0, rotate = -14 } = {}) {
    if (!from || !el) return;
    const to = el.getBoundingClientRect();
    const a = center(from);
    const b = center(to);
    const end = getComputedStyle(el).transform;
    anim(el, [
      { transform: `translate(${a.x - b.x}px,${a.y - b.y}px) rotate(${rotate}deg) scale(.85)`, opacity: 0.6 },
      { transform: end === 'none' ? 'none' : end, opacity: 1 },
    ], { duration: 380, delay, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
  }

  function effects(snap) {
    const st = D.st;
    const prev = D.prev;
    if (!prev || prev.id !== st.id) return;
    const deck = rectOf('#dk-deck');

    // 1. cards thrown onto the table: from the player's hand or seat
    let added = 0;
    const lm = st.lastMove;
    const sourceOf = (card) => {
      if (!lm || lm.card !== card) return deck;
      if (lm.seat === st.mySeat && snap.hand.has(card)) return snap.hand.get(card);
      return seatRect(lm.seat) || deck;
    };
    const pairs = $$('#dk-table .dk-pair');
    st.table.forEach((p, i) => {
      const before = prev.table[i];
      const el = pairs[i];
      if (!el) return;
      if (!before) { added++; flyIn(el.querySelector('.dk-a'), sourceOf(p.a)); }
      else if (!before.d && p.d) { added++; flyIn(el.querySelector('.dk-d'), sourceOf(p.d), { rotate: 20 }); }
    });
    if (added) Sound.play('card');

    // 2. round over: stamp "Бито" / "Забирает" while the cards stay on the table
    if (st.roundEnding && !prev.roundEnding) {
      anim($('#dk-table .dk-stamp'), [
        { transform: 'translate(-50%,-85%) scale(1.8) rotate(-12deg)', opacity: 0 },
        { transform: 'translate(-50%,-85%) scale(1) rotate(-8deg)', opacity: 1 },
      ], { duration: 260, easing: 'cubic-bezier(.2,1.4,.4,1)' });
      Sound.play(st.roundEnding.took ? 'chips' : 'check');
    }

    // 3. table cleared: cards fly to the discard pile, or to whoever took them
    if (snap.ghosts.length) {
      const re = prev.roundEnding || { took: prev.taking, defender: prev.seats.findIndex((x) => x && x.defender) };
      let target;
      if (re.took) target = re.defender === st.mySeat ? rectOf('#dk-hand') : seatRect(re.defender);
      else target = rectOf('#dk-discard');
      snap.ghosts.forEach((gh, k) => flyGhost(gh.node, gh.rect, target, {
        delay: k * 45, rotate: re.took ? 0 : 160 + k * 12, scale: re.took ? 0.7 : 0.55, fade: true,
      }));
      Sound.play(re.took ? 'deal' : 'fold');
    }

    // 4. drawing from the deck: backs fly to the other players, my new cards slide in from the deck
    const took = snap.ghosts.length && prev.roundEnding && prev.roundEnding.took ? prev.roundEnding.defender : null;
    if (deck && st.status === 'playing' && prev.status === 'playing') {
      st.seats.forEach((x, i) => {
        if (!x || i === st.mySeat || !x.inGame) return;
        let inc = x.cards - (snap.seatCards[i] || 0);
        if (i === took) inc -= snap.ghosts.length;
        const to = seatRect(i);
        for (let k = 0; k < Math.min(Math.max(inc, 0), 4); k++) {
          flyGhost(cardEl(null), { left: deck.left, top: deck.top, width: deck.width * 0.6, height: deck.width * 0.84 }, to,
            { delay: 250 + k * 90, rotate: 20, scale: 0.6, fade: true, duration: 450 });
        }
      });
      const fresh = $$('#dk-hand .dk-card').filter((b) => !snap.hand.has(b.dataset.card));
      if (snap.hand.size && fresh.length) {
        fresh.forEach((b, k) => flyIn(b, took === st.mySeat ? rectOf('#dk-table') : deck, { delay: 200 + k * 80, rotate: 0 }));
      }
    }

    if (prev.status !== 'playing' && st.status === 'playing') {
      Sound.play('deal');
      // the opening deal: every hand comes from the deck
      $$('#dk-hand .dk-card').forEach((b, k) => flyIn(b, deck, { delay: k * 70, rotate: 0 }));
    }
    if (prev.status === 'playing' && st.status === 'result') {
      const mine = st.result && st.result.payouts.find((p) => p.seat === st.mySeat);
      Sound.play(mine && mine.net > 0 ? 'bigwin' : mine && mine.net < 0 ? 'fold' : 'win', 0.1);
    }
    const myTurnNow = st.status === 'playing' && st.waiting.seats.includes(st.mySeat);
    const myTurnBefore = prev.status === 'playing' && prev.waiting.seats.includes(prev.mySeat) && prev.waiting.kind === st.waiting.kind;
    if (myTurnNow && !myTurnBefore && (st.waiting.kind !== 'throw' || (st.you && st.you.role === 'attacker'))) Sound.play('turn');
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
    else fillList($('#dk-chat'), st.chat, (m) => h('li', null, window.NR.chatNick(m), m.text));
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
          const av = bar.closest('.seat') && bar.closest('.seat').querySelector('.avatar');
          if (av) {
            av.style.setProperty('--p', frac.toFixed(3));
            av.style.setProperty('--ring', frac < 0.3 ? 'var(--red-soft)' : 'var(--gold)');
          }
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
