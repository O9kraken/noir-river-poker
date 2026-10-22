/* Life at the tables: emoji reactions over the seats, floating win amounts and chip bursts. */
(() => {
  'use strict';
  const NR = window.NR;
  const { $, $$, h, fmt, call, Sound, S } = NR;
  const EMOJI = ['👍', '😂', '😮', '😎', '🔥', '😢', '🙏', '🎉'];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** The room of the table on screen, as the server names it. */
  function currentRoom() {
    const m = location.hash.match(/^#\/(table|durak|bj|rl|ck)\/([\w-]+)/);
    return m ? `${m[1]}:${m[2]}` : null;
  }
  const SEAT_SEL = {
    table: (i) => `#seats .seat[data-seat="${i}"] .seat-box`,
    durak: (i) => `#dk-seats [data-seat="${i}"] .seat-box`,
    bj: (i) => `#bj-spots [data-seat="${i}"] .avatar, #bj-spots [data-seat="${i}"]`,
    rl: (i) => `#rl-players [data-seat="${i}"]`,
    ck: (i) => `#ck-view [data-seat="${i}"]`,
  };
  function seatEl(room, seat) {
    const kind = room.split(':')[0];
    const el = $(SEAT_SEL[kind](seat));
    return el && el.getBoundingClientRect().width ? el : null;
  }
  function layer() {
    let l = $('#fx-layer');
    if (!l) { l = h('div', { id: 'fx-layer', class: 'fx-layer', 'aria-hidden': 'true' }); document.body.append(l); }
    return l;
  }
  function anchor(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 28) };
  }

  /** A short label that pops up over an element and drifts upwards. */
  function float(el, content, cls) {
    const p = anchor(el);
    const node = h('div', { class: 'fx-float ' + cls, style: `left:${p.x}px;top:${p.y}px` }, content);
    layer().append(node);
    const life = cls.includes('react') ? 2200 : 2000;
    if (reduce || !node.animate) { setTimeout(() => node.remove(), life); return; }
    const a = node.animate([
      { transform: 'translate(-50%,-30%) scale(.4)', opacity: 0 },
      { transform: 'translate(-50%,-90%) scale(1.15)', opacity: 1, offset: 0.14 },
      { transform: 'translate(-50%,-110%) scale(1)', opacity: 1, offset: 0.6 },
      { transform: 'translate(-50%,-190%) scale(.95)', opacity: 0 },
    ], { duration: life, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'both' });
    a.onfinish = () => node.remove();
  }

  /** Chips flying out of a seat. */
  function burst(el, n = 10) {
    if (reduce) return;
    const p = anchor(el);
    for (let k = 0; k < n; k++) {
      const ang = (Math.PI * 2 * k) / n + Math.random() * 0.5;
      const dist = 38 + Math.random() * 34;
      const c = h('i', { class: 'fx-bit' + (k % 3 === 0 ? ' red' : k % 3 === 1 ? ' gold' : ''), style: `left:${p.x}px;top:${p.y}px` });
      layer().append(c);
      const a = c.animate([
        { transform: 'translate(-50%,-50%) scale(.6)', opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(ang) * dist}px), calc(-50% + ${Math.sin(ang) * dist - 18}px)) scale(1)`, opacity: 1, offset: 0.55 },
        { transform: `translate(calc(-50% + ${Math.cos(ang) * dist * 1.2}px), calc(-50% + ${Math.sin(ang) * dist + 26}px)) scale(.7)`, opacity: 0 },
      ], { duration: 900 + Math.random() * 300, easing: 'cubic-bezier(.2,.7,.4,1)', fill: 'both' });
      a.onfinish = () => c.remove();
    }
  }

  // ---------- incoming ----------
  function onReact(e) {
    if (e.room !== currentRoom() || !EMOJI.includes(e.emoji)) return;
    const el = seatEl(e.room, e.seat);
    if (el) float(el, e.emoji, 'react');
    else NR.toast(`${e.name}: ${e.emoji}`);
  }
  function onFx(e) {
    if (e.room !== currentRoom()) return;
    // let the table's own animation (cards, wheel, pot) land first
    const wait = e.room.startsWith('rl:') ? 300 : 650;
    setTimeout(() => {
      for (const it of e.items) {
        const isMe = !!(S.me && it.userId === S.me.id);
        const el = seatEl(e.room, it.seat);
        if (!el) continue;
        const text = it.text || `+${fmt(it.amount)}`;
        float(el, text, 'win' + (isMe ? ' mine' : ''));
        if (it.amount > 0) burst(el, it.amount >= 1000 ? 14 : 9);
      }
    }, wait);
  }

  // ---------- reaction picker ----------
  let lastSent = 0;
  function closeTrays() { $$('.react-tray').forEach((t) => { t.hidden = true; }); $$('.react-btn').forEach((b) => b.setAttribute('aria-expanded', 'false')); }
  function addPickers() {
    $$('.table-top [data-invite]').forEach((inv) => {
      if (inv.previousElementSibling && inv.previousElementSibling.classList.contains('react-wrap')) return;
      const tray = h('div', { class: 'react-tray', role: 'menu', hidden: true },
        ...EMOJI.map((e) => h('button', { type: 'button', role: 'menuitem', class: 'react-emoji', 'aria-label': `Реакция ${e}`, onclick: async () => {
          closeTrays();
          const room = currentRoom();
          if (!room) return;
          if (Date.now() - lastSent < 1200) return;
          lastSent = Date.now();
          await call('react', { room, emoji: e });
        } }, e)));
      const btn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm react-btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: 'Реакция', onclick: (ev) => {
        ev.stopPropagation();
        const open = tray.hidden;
        closeTrays();
        tray.hidden = !open;
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      } }, h('span', { 'aria-hidden': 'true' }, '😊'), h('span', { class: 'btn-label' }, 'Эмоция'));
      inv.before(h('div', { class: 'react-wrap' }, btn, tray));
    });
  }
  document.addEventListener('click', (e) => { if (!e.target.closest('.react-wrap')) closeTrays(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTrays(); });
  addPickers();

  function bind(socket) {
    if (bind.done === socket) return;
    bind.done = socket;
    socket.on('react', onReact);
    socket.on('fx', onFx);
  }
  if (S.socket) bind(S.socket);
  setInterval(() => { if (S.socket && bind.done !== S.socket) bind(S.socket); }, 1000);

  window.FX = { float, burst, EMOJI };
})();
