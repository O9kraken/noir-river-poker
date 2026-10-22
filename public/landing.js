/* Landing: menu, games showcase, scroll reveal, and the signed-in account in the header. */
(() => {
  'use strict';
  document.documentElement.classList.add('js');

  // ---------- menu ----------
  const btn = document.getElementById('menu-btn');
  const panel = document.getElementById('menu-panel');
  const setMenu = (open) => { panel.hidden = !open; btn.setAttribute('aria-expanded', String(open)); btn.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню'); };
  btn.addEventListener('click', (e) => { e.stopPropagation(); setMenu(panel.hidden); });
  panel.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
  document.addEventListener('click', (e) => { if (!panel.hidden && !e.target.closest('.menu')) setMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) { setMenu(false); btn.focus(); } });

  // ---------- games showcase ----------
  const tabs = [...document.querySelectorAll('.show-tab')];
  const cards = [...document.querySelectorAll('.show-card')];
  let auto = null;
  function pick(i, focus) {
    tabs.forEach((t, k) => { const on = k === i; t.classList.toggle('is-active', on); t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; });
    cards.forEach((c, k) => { const on = k === i; c.hidden = !on; c.classList.toggle('is-active', on); });
    if (focus) tabs[i].focus();
  }
  tabs.forEach((t, i) => {
    t.id = `show-tab-${i}`;
    cards[i].setAttribute('aria-labelledby', t.id);
    t.addEventListener('click', () => { clearInterval(auto); pick(i); });
    t.addEventListener('keydown', (e) => {
      const d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
      if (!d) return;
      e.preventDefault(); clearInterval(auto);
      pick((i + d + tabs.length) % tabs.length, true);
    });
  });
  if (tabs.length) {
    pick(0);
    // rotate the games until the visitor picks one
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      auto = setInterval(() => {
        const stage = document.querySelector('.show');
        const r = stage.getBoundingClientRect();
        if (r.bottom < 0 || r.top > innerHeight || document.hidden) return;
        pick((tabs.findIndex((t) => t.classList.contains('is-active')) + 1) % tabs.length);
      }, 6000);
    }
  }

  // ---------- reveal on scroll ----------
  const els = document.querySelectorAll('.club .tile, .club-center, .sec-head, .show, .bcard, .fair-in, .faq-card, .final-in');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((list) => list.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { rootMargin: '0px 0px -8% 0px' });
    els.forEach((el, i) => { el.classList.add('reveal'); el.style.transitionDelay = `${(i % 3) * 70}ms`; io.observe(el); });
  }

  // ---------- account ----------
  let token = null;
  try { token = localStorage.getItem('nr_token'); } catch (e) { /* storage blocked */ }
  if (!token) return;

  const SUITS = { s: '♠︎', h: '♥︎', d: '♦︎', c: '♣︎' };
  const PATHS = {
    crown: 'M3 7l4.5 4L12 4l4.5 7L21 7l-2 12H5L3 7z',
    star: 'M12 2l3 6.9 7.5.7-5.7 5 1.7 7.4L12 18l-6.5 4 1.7-7.4-5.7-5 7.5-.7z',
    bolt: 'M13 2L4 14h7l-1 8 9-12h-7l1-8z',
    moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z',
    flame: 'M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-7 0 3 2 4 3 4-1-4 0-7 0-9z',
  };
  const hueOf = (name) => { let x = 0; for (const ch of name) x = (x * 31 + ch.codePointAt(0)) % 360; return x; };
  const initials = (name) => {
    const p = name.trim().split(/[\s_-]+/).filter(Boolean);
    return ((p[0] || '?')[0] + (p[1] ? p[1][0] : (p[0] || '')[1] || '')).toUpperCase();
  };
  const fmt = (n) => Number(n || 0).toLocaleString('ru-RU');

  function avatar(name, av) {
    const el = document.createElement('span');
    el.className = 'lavatar';
    el.style.setProperty('--hue', av && av.hue != null ? av.hue : hueOf(name));
    const sym = av && av.sym;
    if (av && typeof av.img === 'string' && /^\/avatar\/[\w-]+\?v=\w+$/.test(av.img)) { el.style.backgroundImage = `url("${av.img}")`; el.classList.add('has-img'); }
    else if (sym && SUITS[sym]) el.textContent = SUITS[sym];
    else if (sym && PATHS[sym]) {
      el.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="${PATHS[sym]}"/></svg>`;
    } else el.textContent = initials(name);
    return el;
  }

  fetch('/api/me', { headers: { Authorization: 'Bearer ' + token } })
    .then((r) => (r.ok ? r.json() : null))
    .then((me) => {
      if (!me) return;
      const link = document.getElementById('member');
      link.classList.add('is-user');
      link.setAttribute('aria-label', `Профиль ${me.name}, баланс ${fmt(me.balance)} фишек — открыть игру`);
      const text = document.createElement('span');
      text.className = 'member-text';
      const name = document.createElement('b'); name.textContent = me.name;
      const bal = document.createElement('small'); bal.textContent = `${fmt(me.balance)} фишек`;
      text.append(name, bal);
      link.replaceChildren(text, avatar(me.name, me.avatar));
      link.href = '/play';
      document.querySelectorAll('[data-auth-cta] span').forEach((s) => { s.textContent = 'Продолжить игру'; });
    })
    .catch(() => { /* offline: keep the guest header */ });
})();
