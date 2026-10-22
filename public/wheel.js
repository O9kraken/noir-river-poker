/* Daily fortune wheel: the server picks the prize, the wheel only shows it. */
(() => {
  'use strict';
  const NR = window.NR;
  const { $, h, fmt, toast, call, Sound, S } = NR;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const W = { built: null, angle: 0, spinning: false, timer: null, raf: 0, gotAt: 0 };

  const sv = (tag, attrs = {}, ...kids) => {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    kids.forEach((k) => el.append(k));
    return el;
  };
  const short = (n) => (n >= 1000 ? `${n % 1000 ? (n / 1000).toFixed(1).replace('.', ',') : n / 1000}K` : String(n));

  function build(values) {
    const key = values.join(',');
    if (W.built === key) return;
    W.built = key;
    const n = values.length;
    const seg = 360 / n;
    const R = 150;
    const g = sv('g', { id: 'wheel-rotor' });
    const max = Math.max(...values);
    values.forEach((v, i) => {
      const a0 = ((i * seg - 90 - seg / 2) * Math.PI) / 180;
      const a1 = (((i + 1) * seg - 90 - seg / 2) * Math.PI) / 180;
      const p = `M0 0 L${R * Math.cos(a0)} ${R * Math.sin(a0)} A${R} ${R} 0 0 1 ${R * Math.cos(a1)} ${R * Math.sin(a1)} Z`;
      const cls = v === max ? 'jack' : v >= 5000 ? 'big' : i % 2 ? 'b' : 'a';
      g.append(sv('path', { d: p, class: 'wseg ' + cls }));
      const mid = i * seg;
      const label = sv('text', { class: 'wlabel ' + cls, transform: `rotate(${mid}) translate(0 ${-R + 30})`, 'text-anchor': 'middle', 'dominant-baseline': 'middle' });
      label.textContent = short(v);
      g.append(label);
    });
    // studs on the rim
    for (let i = 0; i < n; i++) {
      const a = ((i * seg - 90 - seg / 2) * Math.PI) / 180;
      g.append(sv('circle', { cx: (R - 6) * Math.cos(a), cy: (R - 6) * Math.sin(a), r: 3.2, class: 'wstud' }));
    }
    g.append(sv('circle', { r: 34, class: 'whub' }));
    g.append(sv('circle', { r: 26, class: 'whub-in' }));
    const svg = sv('svg', { viewBox: '-160 -160 320 320', class: 'wheel-svg', role: 'img', 'aria-label': `Колесо фортуны: ${values.map(fmt).join(', ')}` },
      sv('circle', { r: 158, class: 'wrim' }), g,
      sv('path', { d: 'M-13 -162 L13 -162 L0 -134 Z', class: 'wpointer' }));
    $('#wheel-stage').replaceChildren(svg);
    W.angle = 0;
  }

  const left = () => (S.me ? Math.max(0, S.me.nextBonusIn - (Date.now() - W.gotAt)) : 0);
  function clock(ms) {
    const s = Math.ceil(ms / 1000);
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }

  function renderState() {
    if (!S.me) return;
    const ready = !!S.me.bonusAvailable || (S.me.nextBonusIn > 0 && left() <= 0);
    const btn = $('#wheel-spin');
    btn.disabled = !ready || W.spinning;
    btn.textContent = W.spinning ? 'Крутится…' : ready ? 'Крутить колесо' : `Через ${clock(left())}`;
    $('#wheel-note').textContent = ready ? 'Один бесплатный спин в сутки. Главный приз — 25 000 фишек.' : 'Колесо уже крутили — возвращайтесь завтра.';
  }

  function open() {
    if (!S.me) return;
    build(S.me.wheel || [1000, 3000, 500, 7500, 1500, 2000, 25000, 5000, 1000, 2000, 500, 3000]);
    $('#wheel-result').hidden = true;
    renderState();
    clearInterval(W.timer);
    W.timer = setInterval(renderState, 1000);
    $('#modal-wheel').showModal();
  }

  function currentAngle(el) {
    const m = getComputedStyle(el).transform;
    if (!m || m === 'none') return 0;
    const v = m.match(/matrix\(([^)]+)\)/);
    if (!v) return 0;
    const [a, b] = v[1].split(',').map(Number);
    return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  }

  async function spin() {
    if (W.spinning) return;
    W.spinning = true;
    renderState();
    const res = await call('bonus:claim');
    if (!res) { W.spinning = false; renderState(); return; }
    const values = S.me.wheel || [];
    const n = values.length || 12;
    const seg = 360 / n;
    const rotor = $('#wheel-rotor');
    const jitter = (Math.random() - 0.5) * seg * 0.6;
    // the sector's centre ends under the pointer at the top
    const base = W.angle - (W.angle % 360);
    W.angle = base + 360 * 6 + (360 - res.sector * seg) + jitter;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dur = reduce ? 600 : 5600;
    rotor.style.transition = `transform ${dur}ms cubic-bezier(.12,.72,.1,1)`;
    rotor.style.transform = `rotate(${W.angle}deg)`;
    // tick on every sector edge, slowing down with the wheel
    let last = Math.floor(currentAngle(rotor) / seg);
    const tick = () => {
      const k = Math.floor((currentAngle(rotor) + seg / 2) / seg);
      if (k !== last) { last = k; Sound.play('tick'); }
      W.raf = requestAnimationFrame(tick);
    };
    if (!reduce) W.raf = requestAnimationFrame(tick);
    setTimeout(() => {
      cancelAnimationFrame(W.raf);
      W.spinning = false;
      const r = $('#wheel-result');
      r.replaceChildren(h('small', null, 'Ваш приз'), h('b', null, `+${fmt(res.amount)}`), h('span', null, 'фишек уже на балансе'));
      r.hidden = false;
      r.classList.toggle('jack', res.amount >= 7500);
      Sound.play(res.amount >= 5000 ? 'bigwin' : 'win');
      if (window.FX) window.FX.burst($('#wheel-stage'), res.amount >= 5000 ? 22 : 12);
      toast(`Колесо фортуны: +${fmt(res.amount)} фишек`);
      renderState();
    }, dur + 120);
  }

  $('#bonus-btn').addEventListener('click', open);
  $('#wheel-spin').addEventListener('click', spin);
  $('#modal-wheel').addEventListener('close', () => { clearInterval(W.timer); });

  window.Wheel = {
    open,
    onMe(me) {
      W.gotAt = Date.now();
      const b = $('#bonus-btn');
      b.hidden = false;
      b.classList.toggle('ready', !!me.bonusAvailable);
      b.title = me.bonusAvailable ? 'Колесо фортуны: бесплатный спин' : `Колесо фортуны: следующий спин через ${clock(me.nextBonusIn)}`;
      if ($('#modal-wheel').open && !W.spinning) renderState();
    },
  };
})();
