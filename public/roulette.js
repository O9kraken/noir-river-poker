/* Roulette table screen: wheel, betting layout, chips. */
(() => {
  'use strict';
  const { $, $$, h, fmt, toast, call, Sound, S } = window.NR;
  const NR = window.NR;

  const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
  const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const col = (n) => (n === 0 ? 'g' : RED.has(n) ? 'r' : 'b');
  const COLOR_WORD = { g: 'зеро', r: 'красное', b: 'чёрное' };
  const WINS = {
    red: (x) => RED.has(x), black: (x) => x !== 0 && !RED.has(x), even: (x) => x !== 0 && x % 2 === 0, odd: (x) => x % 2 === 1,
    low: (x) => x >= 1 && x <= 18, high: (x) => x >= 19, d1: (x) => x >= 1 && x <= 12, d2: (x) => x >= 13 && x <= 24, d3: (x) => x >= 25,
    c1: (x) => x !== 0 && x % 3 === 1, c2: (x) => x !== 0 && x % 3 === 2, c3: (x) => x !== 0 && x % 3 === 0,
  };
  const wins = (spot, n) => (spot[0] === 'n' ? Number(spot.slice(1)) === n : WINS[spot](n));
  const DENOMS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 20000];
  const CHIP_COLORS = ['#C23B3B', '#1F5FD0', '#2E8B57', '#22262A', '#7B3FB0', '#D9B65E'];
  const short = (n) => (n >= 1000 ? `${+(n / 1000).toFixed(n % 1000 ? 1 : 0)}K` : String(n));

  const R = { id: null, st: null, prev: null, at: 0, chips: [], chip: 0, rot: 0, ballRot: 0, spunFor: 0, built: null };

  // ---------- open / close ----------
  async function open(id) {
    if (R.id === id) return;
    if (R.id) call('rl:unwatch', { tableId: R.id }, true);
    R.id = id;
    R.st = null;
    R.prev = null;
    R.spunFor = 0;
    const res = await call('rl:watch', { tableId: id });
    if (!res) { location.hash = '#/'; return; }
    onState(res.state);
  }
  function close() { if (R.id) call('rl:unwatch', { tableId: R.id }, true); R.id = null; R.st = null; }
  const send = (ev, extra = {}) => call(ev, { tableId: R.id, ...extra });

  function onState(st) {
    if (st.id !== R.id) return;
    R.prev = R.st;
    R.st = st;
    R.at = performance.now();
    if (st.mySeat >= 0) S.myRl.add(st.id); else S.myRl.delete(st.id);
    if (R.built !== st.id) build(st);
    render();
    effects();
  }

  // ---------- wheel ----------
  const NS = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs = {}, kids = []) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); kids.forEach((k) => el.append(k)); return el; };
  const polar = (r, deg) => { const a = ((deg - 90) * Math.PI) / 180; return [r * Math.cos(a), r * Math.sin(a)]; };
  function buildWheel() {
    const el = $('#rl-wheel');
    const step = 360 / 37;
    const defs = svg('defs', {}, [
      svg('radialGradient', { id: 'rlWood', cx: '50%', cy: '45%', r: '60%' }, [svg('stop', { offset: '0', 'stop-color': '#6B3C1C' }), svg('stop', { offset: '1', 'stop-color': '#24120A' })]),
      svg('radialGradient', { id: 'rlCone', cx: '45%', cy: '40%', r: '65%' }, [svg('stop', { offset: '0', 'stop-color': '#1F6A50' }), svg('stop', { offset: '.7', 'stop-color': '#0D3326' }), svg('stop', { offset: '1', 'stop-color': '#071A13' })]),
      svg('linearGradient', { id: 'rlGold', x1: '0', y1: '0', x2: '0', y2: '1' }, [svg('stop', { offset: '0', 'stop-color': '#F7E2A3' }), svg('stop', { offset: '.5', 'stop-color': '#D9B65E' }), svg('stop', { offset: '1', 'stop-color': '#9C7A2F' })]),
      svg('radialGradient', { id: 'rlBall', cx: '35%', cy: '30%', r: '70%' }, [svg('stop', { offset: '0', 'stop-color': '#FFFFFF' }), svg('stop', { offset: '1', 'stop-color': '#B9B4A8' })]),
    ]);
    const rotor = svg('g', { id: 'rl-rotor', class: 'rl-rotor' });
    WHEEL.forEach((n, k) => {
      const a0 = k * step - step / 2;
      const a1 = a0 + step;
      const [x0, y0] = polar(92, a0); const [x1, y1] = polar(92, a1);
      const [x2, y2] = polar(62, a1); const [x3, y3] = polar(62, a0);
      const fill = n === 0 ? '#1F7A4C' : RED.has(n) ? '#B0242F' : '#16181B';
      rotor.append(svg('path', { d: `M${x0} ${y0}A92 92 0 0 1 ${x1} ${y1}L${x2} ${y2}A62 62 0 0 0 ${x3} ${y3}Z`, fill, stroke: '#C9A24A', 'stroke-width': '.6' }));
      const [tx, ty] = polar(84, k * step);
      rotor.append(svg('text', { x: tx, y: ty, transform: `rotate(${k * step} ${tx} ${ty})`, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'rl-num' }, [document.createTextNode(String(n))]));
    });
    rotor.append(svg('circle', { r: 75, fill: 'none', stroke: '#C9A24A', 'stroke-width': '.8' }));
    rotor.append(svg('circle', { r: 62, fill: 'url(#rlCone)', stroke: 'url(#rlGold)', 'stroke-width': '2' }));
    for (let k = 0; k < 8; k++) { const [x, y] = polar(58, k * 45); rotor.append(svg('line', { x1: 0, y1: 0, x2: x, y2: y, stroke: '#C9A24A', 'stroke-opacity': '.45', 'stroke-width': '.8' })); }
    for (let k = 0; k < 4; k++) {
      const [x, y] = polar(24, k * 90 + 45);
      rotor.append(svg('line', { x1: 0, y1: 0, x2: x, y2: y, stroke: 'url(#rlGold)', 'stroke-width': '3.2', 'stroke-linecap': 'round' }));
      rotor.append(svg('circle', { cx: x, cy: y, r: 3.2, fill: 'url(#rlGold)' }));
    }
    rotor.append(svg('circle', { r: 9, fill: 'url(#rlGold)', stroke: '#7A5A1E', 'stroke-width': '.8' }));
    rotor.append(svg('circle', { r: 3.5, fill: '#F7E2A3' }));
    const ballG = svg('g', { id: 'rl-ballg', class: 'rl-ballg' }, [svg('circle', { id: 'rl-ball', cx: 0, cy: -97, r: 4.2, fill: 'url(#rlBall)', stroke: 'rgba(0,0,0,.35)', 'stroke-width': '.5' })]);
    el.replaceChildren(defs,
      svg('circle', { r: 109, fill: 'url(#rlWood)', stroke: 'url(#rlGold)', 'stroke-width': '2' }),
      svg('circle', { r: 101, fill: '#120B07' }),
      svg('circle', { r: 101, fill: 'none', stroke: 'rgba(255,255,255,.06)', 'stroke-width': '6' }),
      svg('circle', { r: 93, fill: 'none', stroke: 'url(#rlGold)', 'stroke-width': '1.4' }),
      rotor, ballG);
  }

  function setRotor(deg, ms = 0, easing) {
    const rotor = $('#rl-rotor');
    rotor.getAnimations().forEach((a) => a.cancel());
    if (!ms) { rotor.style.transform = `rotate(${deg}deg)`; R.rot = deg; return; }
    const from = R.rot;
    rotor.animate([{ transform: `rotate(${from}deg)` }, { transform: `rotate(${deg}deg)` }], { duration: ms, easing, fill: 'forwards' });
    rotor.style.transform = `rotate(${deg}deg)`;
    R.rot = deg;
  }
  function setBall(deg, radius, ms = 0) {
    const g = $('#rl-ballg');
    const ball = $('#rl-ball');
    g.getAnimations().forEach((a) => a.cancel());
    ball.getAnimations().forEach((a) => a.cancel());
    if (!ms) { g.style.transform = `rotate(${deg}deg)`; ball.setAttribute('cy', -radius); R.ballRot = deg; return; }
    ball.setAttribute('cy', -97);
    g.animate([{ transform: `rotate(${R.ballRot}deg)` }, { transform: `rotate(${deg}deg)` }], { duration: ms, easing: 'cubic-bezier(.2,.65,.25,1)', fill: 'forwards' });
    g.style.transform = `rotate(${deg}deg)`;
    ball.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(0)', offset: 0.62 }, { transform: `translateY(${97 - radius}px)` }], { duration: ms, easing: 'ease-in', fill: 'forwards' });
    R.ballRot = deg;
  }
  const pocketAngle = (n) => WHEEL.indexOf(n) * (360 / 37);
  function spinTo(n, ms) {
    // rotor turns clockwise and brings pocket n under the pointer; the ball runs the other way and drops into it
    const target = -pocketAngle(n);
    let end = R.rot + 360 * 4 + ((((target - R.rot) % 360) + 360) % 360);
    if (ms < 1500) end = R.rot + ((((target - R.rot) % 360) + 360) % 360);
    setRotor(end, ms, 'cubic-bezier(.15,.55,.2,1)');
    setBall(R.ballRot - 360 * 6 - (((R.ballRot % 360) + 360) % 360), 76, ms);
  }

  // ---------- board ----------
  function cellsSpec() {
    const out = [{ spot: 'n0', label: '0', cls: 'g zero', r: '1 / span 3', c: '1', vr: '1', vc: '3 / span 3' }];
    for (let n = 1; n <= 36; n++) {
      const m = n % 3;
      out.push({ spot: 'n' + n, label: String(n), cls: col(n), r: String({ 0: 1, 2: 2, 1: 3 }[m]), c: String(1 + Math.ceil(n / 3)), vr: String(1 + Math.ceil(n / 3)), vc: String(2 + (m === 1 ? 1 : m === 2 ? 2 : 3)) });
    }
    out.push(
      { spot: 'c3', label: '2:1', cls: 'out', r: '1', c: '14', vr: '14', vc: '5' },
      { spot: 'c2', label: '2:1', cls: 'out', r: '2', c: '14', vr: '14', vc: '4' },
      { spot: 'c1', label: '2:1', cls: 'out', r: '3', c: '14', vr: '14', vc: '3' },
      { spot: 'd1', label: '1–12', cls: 'out', r: '4', c: '2 / span 4', vr: '2 / span 4', vc: '2' },
      { spot: 'd2', label: '13–24', cls: 'out', r: '4', c: '6 / span 4', vr: '6 / span 4', vc: '2' },
      { spot: 'd3', label: '25–36', cls: 'out', r: '4', c: '10 / span 4', vr: '10 / span 4', vc: '2' },
      { spot: 'low', label: '1–18', cls: 'out', r: '5', c: '2 / span 2', vr: '2 / span 2', vc: '1' },
      { spot: 'even', label: 'Чёт', cls: 'out', r: '5', c: '4 / span 2', vr: '4 / span 2', vc: '1' },
      { spot: 'red', label: '', cls: 'out diamond red', r: '5', c: '6 / span 2', vr: '6 / span 2', vc: '1', aria: 'Красное' },
      { spot: 'black', label: '', cls: 'out diamond black', r: '5', c: '8 / span 2', vr: '8 / span 2', vc: '1', aria: 'Чёрное' },
      { spot: 'odd', label: 'Нечет', cls: 'out', r: '5', c: '10 / span 2', vr: '10 / span 2', vc: '1' },
      { spot: 'high', label: '19–36', cls: 'out', r: '5', c: '12 / span 2', vr: '12 / span 2', vc: '1' },
    );
    return out;
  }
  function buildBoard() {
    const board = $('#rl-board');
    board.replaceChildren(...cellsSpec().map((c) => h('button', {
      type: 'button', class: 'rl-cell ' + c.cls, 'data-spot': c.spot, role: 'gridcell',
      'aria-label': c.aria || (c.spot[0] === 'n' ? `Число ${c.label}` : c.label),
      style: `--r:${c.r};--c:${c.c};--vr:${c.vr};--vc:${c.vc}`,
      onclick: () => placeBet(c.spot),
    }, h('span', { class: 'rl-label' }, c.label), h('span', { class: 'rl-stack' }))));
  }
  function build(st) {
    R.built = st.id;
    buildWheel();
    buildBoard();
    R.rot = 0; R.ballRot = 0;
    const list = DENOMS.filter((d) => d >= st.minBet && d <= st.maxBet);
    R.chips = list.length > 6 ? [0, 1, 2, 3, 4, 5].map((i) => list[Math.round((i * (list.length - 1)) / 5)]) : list;
    R.chip = R.chips[Math.min(1, R.chips.length - 1)] || st.minBet;
    // land on the last number without animation
    if (st.history && st.history.length) { setRotor(-pocketAngle(st.result ?? st.history[0])); setBall(0, 76); }
    if (st.status === 'spinning' && st.result != null) { R.spunFor = st.spinNo; spinTo(st.result, Math.max(300, st.spinIn - 200)); }
  }

  async function placeBet(spot) {
    const st = R.st;
    if (!st) return;
    if (st.mySeat < 0) {
      const ok = await send('rl:sit', {});
      if (!ok) return;
    }
    if (st.status !== 'betting') { toast('Ставок больше нет — дождитесь следующего спина', true); return; }
    const res = await send('rl:bet', { spot, amount: R.chip });
    if (res) Sound.play('chips');
  }

  // ---------- render ----------
  function render() {
    const st = R.st;
    if (!st) return;
    document.title = `${st.name} — рулетка — NOIR RIVER`;
    $('#rl-name').textContent = st.name;
    $('#rl-meta').textContent = `Рулетка · фишка от ${fmt(st.minBet)} · за спин до ${fmt(st.maxBet)}`;
    $('#rl-spin').textContent = st.spinNo ? `Спин #${st.spinNo}` : '';

    // history
    $('#rl-history').replaceChildren(...(st.history.length ? st.history.map((n, i) => h('span', { class: `rl-n ${col(n)}${i === 0 && st.status !== 'spinning' ? ' last' : ''}` }, n)) : [h('span', { class: 'muted small' }, 'Номера появятся после первого спина')]));

    // board chips
    const me = st.you;
    const showWin = st.status === 'result' && st.result != null;
    const others = {};
    st.seats.forEach((s, i) => {
      if (!s || i === st.mySeat) return;
      for (const [spot, amount] of Object.entries(s.bets || {})) (others[spot] ||= []).push({ s, amount });
    });
    for (const cell of $$('#rl-board .rl-cell')) {
      const spot = cell.dataset.spot;
      const mine = me && me.bets[spot];
      const stack = cell.querySelector('.rl-stack');
      const kids = [];
      if (mine) {
        const idx = Math.max(0, R.chips.filter((c) => c <= mine).length - 1);
        kids.push(h('i', { class: 'rl-chip mine', style: `--chip:${CHIP_COLORS[idx % CHIP_COLORS.length]}`, title: `Ваша ставка ${fmt(mine)}` }, short(mine)));
      }
      for (const o of (others[spot] || []).slice(0, 3)) {
        const hue = o.s.avatar && o.s.avatar.hue != null ? o.s.avatar.hue : NR.hueOf(o.s.name);
        kids.push(h('i', { class: 'rl-dot', style: `--hue:${hue}`, title: `${o.s.name}: ${fmt(o.amount)}` }));
      }
      stack.replaceChildren(...kids);
      cell.classList.toggle('win', showWin && wins(spot, st.result));
      cell.classList.toggle('has-bet', !!mine);
      cell.disabled = st.status !== 'betting';
    }

    // players
    $('#rl-players').replaceChildren(...st.seats.map((s, i) => s && h('div', { class: 'rl-pl' + (i === st.mySeat ? ' me' : '') + (s.connected ? '' : ' off'), 'data-seat': i },
      NR.avatarEl(s.name, s.avatar, 'sm'),
      h('span', { class: 'rl-pl-name' }, s.name),
      s.net != null && st.status === 'result'
        ? h('b', { class: 'rl-pl-net ' + (s.net > 0 ? 'plus' : s.net < 0 ? 'minus' : '') }, s.net > 0 ? `+${fmt(s.net)}` : s.net < 0 ? `−${fmt(-s.net)}` : '0')
        : h('b', { class: 'rl-pl-bet' }, s.total ? fmt(s.total) : '—'))).filter(Boolean));

    // result badge in the wheel
    const rb = $('#rl-result');
    if (showWin) {
      rb.className = `rl-result show ${col(st.result)}`;
      rb.replaceChildren(h('b', null, st.result), h('small', null, COLOR_WORD[col(st.result)]));
    } else { rb.className = 'rl-result'; rb.replaceChildren(); }

    renderStatus();
    renderCtrl();
    renderSide(st);
  }

  function renderStatus() {
    const st = R.st;
    const el = $('#rl-status');
    el.dataset.timer = '';
    if (st.status === 'spinning') { el.textContent = 'Ставок больше нет · колесо крутится'; return; }
    if (st.status === 'result') {
      const me = st.mySeat >= 0 ? st.seats[st.mySeat] : null;
      const tail = me && me.net != null ? (me.net > 0 ? ` · вы выиграли +${fmt(me.net)}` : me.net < 0 ? ` · ставка проиграла` : ' · ставка вернулась') : '';
      el.textContent = `Выпало ${st.result} — ${COLOR_WORD[col(st.result)]}${tail}`;
      return;
    }
    if (st.bettingIn) { el.dataset.timer = '1'; el.textContent = 'Делайте ставки…'; return; }
    el.textContent = st.mySeat >= 0 ? 'Делайте ставки — таймер пойдёт с первой фишки' : 'Выберите фишку и нажмите на поле, чтобы сделать ставку';
  }

  function renderCtrl() {
    const st = R.st;
    const me = st.you;
    const betting = st.status === 'betting';
    const chips = h('div', { class: 'rl-chips', role: 'radiogroup', 'aria-label': 'Номинал фишки' }, R.chips.map((c, i) => h('button', {
      type: 'button', class: 'rl-chip-btn' + (c === R.chip ? ' on' : ''), role: 'radio', 'aria-checked': c === R.chip ? 'true' : 'false',
      style: `--chip:${CHIP_COLORS[i % CHIP_COLORS.length]}`, onclick: () => { R.chip = c; renderCtrl(); },
    }, short(c))));
    const act = (label, ev, extra, dis) => h('button', { type: 'button', class: 'btn btn-dark btn-sm', disabled: dis, onclick: async () => { if (await send(ev, extra)) Sound.play('chips'); } }, label);
    $('#rl-ctrl').replaceChildren(
      chips,
      h('div', { class: 'rl-actions' },
        h('span', { class: 'rl-mybet' }, me ? `Ваша ставка: ${fmt(me.total)}` : 'Вы наблюдаете'),
        act('Отменить', 'rl:undo', {}, !me || !betting || !me.total),
        act('Очистить', 'rl:clear', {}, !me || !betting || !me.total),
        act('Повторить', 'rl:rebet', {}, !me || !betting || !me.last),
        act('Удвоить', 'rl:rebet', { double: true }, !me || !betting || !me.total),
        st.mySeat >= 0
          ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => send('rl:leave') }, 'Отойти')
          : h('button', { type: 'button', class: 'btn btn-gold btn-sm', onclick: () => send('rl:sit', {}) }, 'Подойти к столу')));
  }

  // ---------- effects ----------
  function effects() {
    const st = R.st; const prev = R.prev;
    if (st.status === 'spinning' && st.result != null && R.spunFor !== st.spinNo) {
      R.spunFor = st.spinNo;
      spinTo(st.result, Math.max(300, (st.spinIn || st.spinTime) - 250));
      Sound.play('deal');
    }
    if (prev && prev.status === 'spinning' && st.status === 'result') {
      const me = st.mySeat >= 0 ? st.seats[st.mySeat] : null;
      if (me && me.net > 0) Sound.play(me.net >= me.total * 10 ? 'bigwin' : 'win', 0.1);
      else Sound.play('check');
    }
  }

  // ---------- side ----------
  $$('[data-rl-tab]').forEach((tab) => tab.addEventListener('click', () => {
    const which = tab.dataset.rlTab;
    $$('[data-rl-tab]').forEach((x) => { x.classList.toggle('is-active', x === tab); x.setAttribute('aria-selected', x === tab); });
    $('#rl-chat-pane').hidden = which !== 'chat';
    $('#rl-log-pane').hidden = which !== 'log';
    $('#rl-rules-pane').hidden = which !== 'rules';
  }));
  function fill(el, items, mk) {
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    el.replaceChildren(...items.map(mk));
    if (atBottom) el.scrollTop = el.scrollHeight;
  }
  function renderSide(st) {
    if (!st.chat.length) $('#rl-chat').replaceChildren(h('li', { class: 'sys' }, 'Здесь пока тихо.'));
    else fill($('#rl-chat'), st.chat, (m) => h('li', null, NR.chatNick(m), m.text));
    fill($('#rl-log'), st.log, (l) => h('li', null, l.text));
  }
  $('#rl-chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#rl-chat-input');
    const text = input.value.trim();
    if (!text || !R.id) return;
    if (await send('rl:chat', { text })) input.value = '';
  });

  // ---------- betting countdown ----------
  let lastSec = -1;
  function tick() {
    const st = R.st;
    if (st && !$('#rl-view').hidden && st.status === 'betting' && st.bettingIn) {
      const left = Math.max(0, Math.ceil((st.bettingIn - (performance.now() - R.at)) / 1000));
      const el = $('#rl-status');
      if (el.dataset.timer) el.textContent = left ? `Делайте ставки · ${left}` : 'Ставок больше нет';
      if (left !== lastSec && left > 0 && left <= 3 && st.mySeat >= 0) Sound.play('tick');
      lastSec = left;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  window.RouletteUI = { open, close, onState };
})();
