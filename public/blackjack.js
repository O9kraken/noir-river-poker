(() => {
  'use strict';
  const { $, $$, h, fmt, anim, cardEl, toast, call, Sound, S, hueOf, initials } = window.NR;

  const B = { id: null, st: null, prev: null, at: 0 };
  const CHIPS = [5, 25, 100, 500, 1000, 5000];
  const RESULT = {
    blackjack: ['Блэкджек!', 'win'], win: ['Выигрыш', 'win'], push: ['Ничья', 'push'], lose: ['Проигрыш', 'lose'], bust: ['Перебор', 'lose'],
  };

  // ---------- open / close ----------
  async function open(id) {
    if (B.id === id) return;
    if (B.id) call('bj:unwatch', { tableId: B.id }, true);
    B.id = id;
    B.st = null;
    B.prev = null;
    const res = await call('bj:watch', { tableId: id });
    if (!res) { location.hash = '#/'; return; }
    onState(res.state);
  }
  function close() { if (B.id) call('bj:unwatch', { tableId: B.id }, true); B.id = null; B.st = null; }
  function reset() { B.id = null; }

  function onState(st) {
    if (st.id !== B.id) return;
    B.prev = B.st;
    B.st = st;
    B.at = performance.now();
    if (st.mySeat >= 0) S.myBj.add(st.id); else S.myBj.delete(st.id);
    const snap = capture();
    render();
    effects(snap);
  }

  const send = (ev, extra = {}) => call(ev, { tableId: B.id, ...extra });

  // ---------- geometry: boxes in a row that follows the table's curve ----------
  function spotLift(i, n) {
    const m = (n - 1) / 2;
    const d = m ? Math.abs(i - m) / m : 0; // 0 in the middle, 1 at the edges
    return (d * d * 9).toFixed(2); // % of the row width
  }

  /** Chip stack for an amount: biggest denominations first, at most 5 discs. */
  function chipStack(amount) {
    const out = [];
    let left = amount;
    for (const c of CHIPS.slice().reverse()) {
      while (left >= c && out.length < 5) { out.push(c); left -= c; }
    }
    if (!out.length && amount > 0) out.push(5);
    return h('span', { class: 'bj-chipstack', 'aria-hidden': 'true' }, out.reverse().map((c, k) => h('i', { class: `chip c${c}`, style: `--k:${k}` })));
  }

  // ---------- render ----------
  function render() {
    const st = B.st;
    if (!st) return;
    document.title = `${st.name} — блэкджек — NOIR RIVER`;
    $('#bj-name').textContent = st.name;
    $('#bj-meta').textContent = `Блэкджек · ставка ${fmt(st.minBet)}–${fmt(st.maxBet)} · 6 колод`;
    $('#bj-round').textContent = st.roundNo ? `Раздача #${st.roundNo}` : '';
    $('#bj-shoe-count').textContent = st.shoeLeft;

    // dealer
    const dc = $('#bj-dealer-cards');
    dc.replaceChildren(...st.dealer.cards.map((c, k) => { const el = cardEl(c); el.dataset.k = k; return el; }));
    const dt = $('#bj-dealer-total');
    dt.hidden = !st.dealer.cards.length;
    dt.textContent = st.dealer.blackjack ? 'Блэкджек' : st.dealer.total > 21 ? `Перебор · ${st.dealer.total}` : (st.dealer.soft ? `${st.dealer.total - 10}/${st.dealer.total}` : `${st.dealer.total}`);
    dt.className = 'bj-total' + (st.dealer.total > 21 ? ' bust' : '');

    renderSpots(st);
    renderStatus(st);
    renderControls(st);
    renderSide(st);
  }

  function handEl(hd, seat, k) {
    const res = hd.result ? RESULT[hd.result] : null;
    const totalText = hd.natural ? 'BJ' : hd.busted ? `${hd.total} ✕` : hd.soft ? `${hd.total - 10}/${hd.total}` : `${hd.total}`;
    const el = h('div', { class: 'bj-hand' + (hd.active ? ' active' : '') + (res ? ' r-' + res[1] : ''), 'data-key': `${seat}:${k}` },
      res ? h('span', { class: 'bj-res ' + res[1] }, res[0], hd.payout - hd.bet > 0 ? ` +${fmt(hd.payout - hd.bet)}` : '') : null,
      h('div', { class: 'bj-cards' }, hd.cards.map((c) => cardEl(c))),
      h('div', { class: 'bj-hand-foot' },
        h('span', { class: 'bj-total' + (hd.busted ? ' bust' : hd.natural ? ' bj' : '') }, totalText),
        h('span', { class: 'bj-bet' }, chipStack(hd.bet), fmt(hd.bet), hd.doubled ? ' ×2' : '')));
    return el;
  }

  function renderSpots(st) {
    const layer = $('#bj-spots');
    layer.replaceChildren();
    layer.style.setProperty('--n', st.maxSeats);
    st.seats.forEach((s, i) => {
      const style = `--lift:${spotLift(i, st.maxSeats)}`;
      if (!s) {
        layer.append(h('div', { class: 'bj-spot bj-free', style },
          st.mySeat === -1
            ? h('button', { type: 'button', class: 'bj-sit', onclick: () => sit(i), 'aria-label': `Сесть на бокс ${i + 1}` }, 'Сесть')
            : h('span', { class: 'bj-ring', 'aria-hidden': 'true' })));
        return;
      }
      const isMe = i === st.mySeat;
      const myTurn = st.turn && st.turn.seat === i;
      const hands = s.hands.length
        ? h('div', { class: 'bj-hands' + (s.hands.length > 1 ? ' split' : '') }, s.hands.map((hd, k) => handEl(hd, i, k)))
        : s.bet
          ? h('div', { class: 'bj-hands' }, h('div', { class: 'bj-hand pending' }, h('div', { class: 'bj-hand-foot' }, h('span', { class: 'bj-bet' }, chipStack(s.bet), fmt(s.bet)))))
          : h('div', { class: 'bj-hands' }, h('span', { class: 'bj-ring', 'aria-hidden': 'true' }));
      layer.append(h('div', { class: 'bj-spot' + (isMe ? ' me' : '') + (myTurn ? ' turn' : ''), style, 'data-seat': i },
        hands,
        h('div', { class: 'bj-player seat' + (myTurn ? ' turn' : '') },
          h('div', { class: 'avatar', style: `--hue:${hueOf(s.name)}`, 'aria-hidden': 'true' }, initials(s.name)),
          h('div', { class: 'seat-info' },
            h('div', { class: 'seat-name', title: s.name }, s.name),
            s.net != null ? h('div', { class: 'bj-net ' + (s.net > 0 ? 'plus' : s.net < 0 ? 'minus' : '') }, s.net > 0 ? `+${fmt(s.net)}` : s.net < 0 ? fmt(s.net) : '±0')
              : !s.connected ? h('div', { class: 'offline' }, 'не в сети') : null),
          myTurn ? h('i', { 'data-bj-timer': '', hidden: true }) : null)));
    });
  }

  function renderStatus(st) {
    const el = $('#bj-status');
    const you = st.you;
    const nameOf = (i) => (st.seats[i] ? st.seats[i].name : '');
    let text = '';
    if (st.status === 'betting') {
      if (st.mySeat === -1) text = 'Выберите свободный бокс, чтобы сыграть';
      else if (st.bettingIn) text = `Ставки принимаются · раздача через ${Math.ceil(st.bettingIn / 1000)}…`;
      else text = `Сделайте ставку от ${fmt(st.minBet)} до ${fmt(st.maxBet)}`;
    } else if (st.status === 'playing' && st.turn) {
      text = st.turn.seat === st.mySeat
        ? (st.seats[st.mySeat].hands.length > 1 ? `Ваш ход — рука ${st.turn.hand + 1}` : 'Ваш ход')
        : `Ходит ${nameOf(st.turn.seat)}`;
    } else if (st.status === 'dealer') text = 'Дилер открывает карту и добирает…';
    else if (st.status === 'result') {
      const me = st.mySeat >= 0 ? st.seats[st.mySeat] : null;
      text = me && me.net != null ? (me.net > 0 ? `Вы выиграли +${fmt(me.net)}` : me.net < 0 ? `Вы проиграли ${fmt(-me.net)}` : 'Ничья — ставка вернулась') : 'Раздача окончена';
    }
    el.textContent = text;
    el.dataset.betting = st.status === 'betting' && st.bettingIn ? '1' : '';
  }

  function renderControls(st) {
    const box = $('#bj-ctrl');
    box.replaceChildren();
    const you = st.you;
    if (!you) { box.hidden = true; return; }
    box.hidden = false;
    if (you.turn) {
      const t = you.turn;
      const kbd = (k) => h('kbd', { 'aria-hidden': 'true' }, k);
      box.append(h('div', { class: 'ctrl-actions bj-actions' },
        h('button', { type: 'button', class: 'btn btn-gold', 'data-bj': 'hit', disabled: !t.hit, onclick: () => send('bj:act', { type: 'hit' }) }, 'Взять ', kbd('H')),
        h('button', { type: 'button', class: 'btn btn-dark', 'data-bj': 'stand', onclick: () => send('bj:act', { type: 'stand' }) }, 'Хватит ', kbd('S')),
        t.double ? h('button', { type: 'button', class: 'btn btn-dark', 'data-bj': 'double', onclick: () => send('bj:act', { type: 'double' }) }, `Удвоить +${fmt(t.bet)} `, kbd('D')) : null,
        t.split ? h('button', { type: 'button', class: 'btn btn-dark', 'data-bj': 'split', onclick: () => send('bj:act', { type: 'split' }) }, `Разделить +${fmt(t.bet)} `, kbd('P')) : null));
      return;
    }
    if (you.canBet) {
      const chips = h('div', { class: 'bj-chips', role: 'group', 'aria-label': 'Фишки' },
        CHIPS.filter((c) => c <= st.maxBet).map((c) => h('button', {
          type: 'button', class: `chip-btn c${c}`, 'aria-label': `Поставить ${c}`,
          disabled: you.bet + c > st.maxBet,
          onclick: async () => { if (await send('bj:bet', { amount: c })) Sound.play('chips'); },
        }, c >= 1000 ? `${c / 1000}K` : c)));
      box.append(chips, h('div', { class: 'bj-bet-actions' },
        h('span', { class: 'bj-mybet' }, 'Ставка: ', h('b', null, fmt(you.bet))),
        you.lastBet && you.bet < you.lastBet ? h('button', { type: 'button', class: 'btn btn-dark btn-sm', onclick: () => send('bj:rebet') }, `Повторить ${fmt(you.lastBet)}`) : null,
        you.bet ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => send('bj:clear') }, 'Убрать') : null,
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: leave }, 'Встать')));
      return;
    }
    box.append(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: leave }, 'Встать после раздачи'));
  }

  async function sit(i) { if (await send('bj:sit', { seat: i })) S.myBj.add(B.id); }
  async function leave() { await send('bj:leave'); S.myBj.delete(B.id); }

  // hotkeys H / S / D / P
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (/INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '')) return;
    if ($('#bj-view').hidden || !B.st || !B.st.you || !B.st.you.turn) return;
    const map = { KeyH: 'hit', KeyS: 'stand', KeyD: 'double', KeyP: 'split' };
    const btn = map[e.code] && $(`#bj-ctrl [data-bj="${map[e.code]}"]`);
    if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
  });

  // ---------- effects ----------
  function fx() {
    let l = document.getElementById('bj-fx');
    if (!l) { l = h('div', { id: 'bj-fx', class: 'dk-fx', 'aria-hidden': 'true' }); document.body.append(l); }
    return l;
  }
  const rect = (el) => (el ? el.getBoundingClientRect() : null);
  const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

  function capture() { return {}; }

  function flyFrom(el, fromRect, delay, rotate = -25) {
    if (!el || !fromRect) return;
    const to = el.getBoundingClientRect();
    const a = center(fromRect);
    const b = center(to);
    anim(el, [
      { transform: `translate(${a.x - b.x}px,${a.y - b.y}px) rotate(${rotate}deg) scale(.8)`, opacity: 0.4 },
      { transform: 'none', opacity: 1 },
    ], { duration: 420, delay, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
  }

  function chipFly(from, to, delay) {
    if (!from || !to) return;
    const g = h('i', { class: 'chip c100 bj-chipfly' });
    const a = center(from);
    const b = center(to);
    g.style.left = `${a.x - 11}px`;
    g.style.top = `${a.y - 11}px`;
    fx().append(g);
    const an = anim(g, [{ transform: 'translate(0,0)', opacity: 1 }, { transform: `translate(${b.x - a.x}px,${b.y - a.y}px)`, opacity: 0.9 }],
      { duration: 520, delay, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'both' });
    if (an) an.onfinish = () => g.remove(); else g.remove();
  }

  function effects() {
    const st = B.st;
    const prev = B.prev;
    if (!prev || prev.id !== st.id) return;
    const shoe = rect($('#bj-shoe'));
    let delay = 0;
    let drew = 0;
    // new player cards: from the shoe, in dealing order
    st.seats.forEach((s, i) => {
      if (!s) return;
      const ps = prev.seats[i];
      s.hands.forEach((hd, k) => {
        const before = ps && ps.hands[k] ? ps.hands[k].cards.length : 0;
        const handNode = $(`#bj-spots [data-key="${i}:${k}"] .bj-cards`);
        if (!handNode) return;
        [...handNode.children].forEach((c, idx) => {
          if (idx < before) return;
          // a split moves an existing card: only animate the ones that came out of the shoe
          if (ps && ps.hands.length < s.hands.length && idx === 0 && k > 0) return;
          flyFrom(c, shoe, delay); delay += 110; drew++;
        });
      });
    });
    // dealer: new cards and the hole card turning over
    const dcards = $$('#bj-dealer-cards .card');
    dcards.forEach((c, k) => {
      const was = prev.dealer.cards[k];
      if (was === undefined) { flyFrom(c, shoe, delay, 0); delay += 110; drew++; }
      else if (was === null && st.dealer.cards[k]) {
        anim(c, [{ transform: 'perspective(500px) rotateY(90deg)' }, { transform: 'perspective(500px) rotateY(0)' }], { duration: 360, delay: 60, easing: 'ease-out' });
        drew++;
      }
    });
    if (drew) Sound.play(drew > 2 ? 'deal' : 'card');

    // chips: losers' bets to the dealer, winnings from the dealer
    if (st.status === 'result' && prev.status !== 'result') {
      const dealer = rect($('#bj-dealer-cards'));
      let mine = 0;
      st.seats.forEach((s, i) => {
        if (!s || s.net == null) return;
        const spot = rect($(`#bj-spots [data-seat="${i}"] .bj-bet`));
        if (s.net < 0) for (let k = 0; k < 3; k++) chipFly(spot, dealer, k * 70);
        if (s.net > 0) for (let k = 0; k < 4; k++) chipFly(dealer, spot, 150 + k * 70);
        if (i === st.mySeat) mine = s.net;
      });
      if (st.mySeat >= 0) Sound.play(mine > 0 ? 'bigwin' : mine < 0 ? 'fold' : 'check', 0.15);
    }
    const myTurn = st.turn && st.turn.seat === st.mySeat;
    const was = prev.turn && prev.turn.seat === prev.mySeat && prev.turn.hand === (st.turn && st.turn.hand);
    if (myTurn && !was) Sound.play('turn');
  }

  // ---------- side ----------
  $$('[data-bj-tab]').forEach((tab) => tab.addEventListener('click', () => {
    const which = tab.dataset.bjTab;
    $$('[data-bj-tab]').forEach((x) => { x.classList.toggle('is-active', x === tab); x.setAttribute('aria-selected', x === tab); });
    $('#bj-chat-pane').hidden = which !== 'chat';
    $('#bj-log-pane').hidden = which !== 'log';
    $('#bj-rules-pane').hidden = which !== 'rules';
  }));
  function fill(el, items, mk) {
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    el.replaceChildren(...items.map(mk));
    if (atBottom) el.scrollTop = el.scrollHeight;
  }
  function renderSide(st) {
    if (!st.chat.length) $('#bj-chat').replaceChildren(h('li', { class: 'sys' }, 'Здесь пока тихо.'));
    else fill($('#bj-chat'), st.chat, (m) => h('li', null, h('b', null, m.name), m.text));
    fill($('#bj-log'), st.log, (l) => h('li', { class: l.text.startsWith('—') ? 'sep' : '' }, l.text));
  }
  $('#bj-chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#bj-chat-input');
    const text = input.value.trim();
    if (!text || !B.id) return;
    if (await send('bj:chat', { text })) input.value = '';
  });

  // ---------- timers ----------
  function tick() {
    const st = B.st;
    if (st && !$('#bj-view').hidden) {
      const elapsed = performance.now() - B.at;
      if (st.turn && st.deadlineIn) {
        const frac = Math.max(0, st.deadlineIn - elapsed) / (st.actionTime || 20000);
        const av = $(`#bj-spots [data-seat="${st.turn.seat}"] .avatar`);
        if (av) { av.style.setProperty('--p', frac.toFixed(3)); av.style.setProperty('--ring', frac < 0.3 ? 'var(--red-soft)' : 'var(--gold)'); }
      }
      if (st.status === 'betting' && st.bettingIn && st.mySeat >= 0) {
        const left = Math.max(0, Math.ceil((st.bettingIn - elapsed) / 1000));
        const el = $('#bj-status');
        if (el.dataset.betting) el.textContent = left ? `Ставки принимаются · раздача через ${left}…` : 'Раздаём…';
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  window.BjUI = { open, close, reset, onState };
})();
