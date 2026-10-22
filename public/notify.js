/* Browser notifications (your turn, invites, messages) and installing the club as an app. */
(() => {
  'use strict';
  const NR = window.NR;
  const { $, h, toast, Sound, S } = NR;
  const KEY = 'nr_notify';
  const supported = 'Notification' in window;
  let swReg = null;

  // ---------- service worker: offline shell + notification clicks ----------
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then((r) => { swReg = r; }).catch(() => {});
    });
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'open' && typeof e.data.href === 'string' && e.data.href.startsWith('#/')) location.hash = e.data.href;
    });
  }

  const wanted = () => { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } };
  const enabled = () => supported && Notification.permission === 'granted' && wanted();

  /** Show a system notification, only when the tab isn't in front of the player. */
  function notify(title, body, opts = {}) {
    if (!enabled() || (document.visibilityState === 'visible' && document.hasFocus())) return;
    const options = {
      body, tag: opts.tag || 'nr', renotify: !!opts.tag, icon: '/brand/icon-192.png', badge: '/brand/icon-192.png',
      data: { href: opts.href || location.hash || '#/' }, silent: false,
    };
    try {
      if (swReg && swReg.showNotification) { swReg.showNotification(title, options); return; }
      const n = new Notification(title, options);
      n.onclick = () => { window.focus(); if (options.data.href) location.hash = options.data.href; n.close(); };
    } catch (e) { /* some browsers only allow notifications from the service worker */ }
  }

  async function enable() {
    if (!supported) { toast('Этот браузер не умеет показывать уведомления', true); return; }
    let p = Notification.permission;
    if (p === 'default') p = await Notification.requestPermission();
    if (p !== 'granted') { toast('Уведомления запрещены в настройках браузера', true); render(); return; }
    try { localStorage.setItem(KEY, '1'); } catch (e) { /* ignore */ }
    toast('Уведомления включены: ход, приглашения и сообщения');
    render();
  }
  function disable() {
    try { localStorage.setItem(KEY, '0'); } catch (e) { /* ignore */ }
    render();
  }

  // "your turn" in any game: every game already plays the turn sound, hook into it
  const play = Sound.play.bind(Sound);
  Sound.play = (name, delay) => {
    if (name === 'turn' && document.hidden) {
      const what = document.title.replace(/\s+—\s+NOIR RIVER$/, '');
      notify('Ваш ход', what, { tag: 'turn', href: location.hash });
    }
    return play(name, delay);
  };

  // ---------- install as an app ----------
  let deferred = null;
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; render(); });
  window.addEventListener('appinstalled', () => { deferred = null; toast('NOIR RIVER установлен — ищите иконку на рабочем столе'); render(); });
  async function install() {
    if (deferred) {
      deferred.prompt();
      const choice = await deferred.userChoice.catch(() => null);
      deferred = null;
      if (choice && choice.outcome === 'accepted') toast('Устанавливаем…');
      render();
      return;
    }
    if (ios) { toast('В Safari нажмите «Поделиться» → «На экран Домой»'); return; }
    toast('Откройте меню браузера и выберите «Установить приложение»');
  }

  // ---------- the panel in the lobby ----------
  function render() {
    const box = $('#app-panel');
    if (!box) return;
    const on = enabled();
    const denied = supported && Notification.permission === 'denied';
    const rows = [];
    rows.push(h('div', { class: 'app-row' },
      h('span', { class: 'app-ico', 'aria-hidden': 'true' }, '🔔'),
      h('span', { class: 'app-txt' }, h('b', null, 'Уведомления'), h('small', null, !supported ? 'браузер не поддерживает' : denied ? 'запрещены в настройках браузера' : on ? 'ваш ход, приглашения, сообщения' : 'не пропустите ход и приглашения')),
      supported && !denied ? h('button', { type: 'button', class: 'btn btn-sm ' + (on ? 'btn-ghost' : 'btn-gold'), onclick: on ? disable : enable }, on ? 'Выключить' : 'Включить') : null));
    if (!standalone()) {
      rows.push(h('div', { class: 'app-row' },
        h('span', { class: 'app-ico', 'aria-hidden': 'true' }, '📲'),
        h('span', { class: 'app-txt' }, h('b', null, 'Приложение'), h('small', null, ios ? 'Safari → «Поделиться» → «На экран Домой»' : 'клуб с иконкой на рабочем столе')),
        h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: install }, 'Установить')));
    }
    box.replaceChildren(...rows);
  }
  render();

  // ---------- events worth a notification ----------
  function bind(socket) {
    if (bind.done === socket) return;
    bind.done = socket;
    socket.on('invite', (e) => notify(`${e.from.name} зовёт играть`, `«${e.title}» · ${e.game}`, { tag: 'invite', href: e.href }));
    socket.on('dm:new', (e) => {
      if (!e.from || !S.me || e.msg.from === S.me.id) return;
      notify(e.from.name, e.msg.text.length > 120 ? e.msg.text.slice(0, 120) + '…' : e.msg.text, { tag: 'dm-' + e.with, href: location.hash });
    });
    socket.on('friends:request', (e) => notify('Заявка в друзья', `${e.from.name} хочет добавить вас в друзья`, { tag: 'friend', href: '#/' }));
    socket.on('sng:started', (e) => notify('Турнир начался', `«${e.name}» — вас ждут за столом`, { tag: 'sng', href: `#/table/${e.tableId}` }));
    socket.on('notice', (n) => { if (n.type === 'season') notify('Итоги сезона', n.text, { tag: 'season', href: '#/ratings' }); });
  }
  if (S.socket) bind(S.socket);
  setInterval(() => { if (S.socket && bind.done !== S.socket) bind(S.socket); }, 1000);

  window.Notify = { notify, enable, render };
})();
