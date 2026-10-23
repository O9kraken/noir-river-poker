/* Private messages with friends: a drawer with the list of dialogs and one open conversation. */
(() => {
  'use strict';
  const NR = window.NR;
  const { $, $$, h, toast, call, Sound, S } = NR;
  const D = { open: false, with: null, friend: null, msgs: [], list: [], friends: [], typingTimer: null, lastTypingSent: 0 };

  const timeOf = (t) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const dayOf = (t) => {
    const d = new Date(t); const today = new Date();
    const y = new Date(); y.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return 'Сегодня';
    if (d.toDateString() === y.toDateString()) return 'Вчера';
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  };
  const shortWhen = (t) => (new Date(t).toDateString() === new Date().toDateString() ? timeOf(t) : new Date(t).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }));
  const profileHref = (name) => `#/profile/${encodeURIComponent(name)}`;

  // ---------- drawer ----------
  function show() {
    D.open = true;
    $('#dm-drawer').hidden = false;
    requestAnimationFrame(() => $('#dm-drawer').classList.add('open'));
    $('#dm-btn').setAttribute('aria-expanded', 'true');
  }
  function hide() {
    D.open = false;
    D.with = null;
    const el = $('#dm-drawer');
    el.classList.remove('open');
    $('#dm-btn').setAttribute('aria-expanded', 'false');
    setTimeout(() => { if (!D.open) el.hidden = true; }, 220);
  }

  $('#dm-report').addEventListener('click', () => {
    if (!D.friend || !window.Report) return;
    const theirs = (D.msgs || []).filter((m) => m.from !== S.me.id).slice(-3).map((m) => m.text).join(' / ');
    window.Report.open({ name: D.friend.name, where: 'Личные сообщения', text: theirs });
  });

  async function openList() {
    D.with = null;
    show();
    $('#dm-list-pane').hidden = false;
    $('#dm-chat-pane').hidden = true;
    const [l, f] = await Promise.all([call('dm:list', {}, true), call('friends:list', {}, true)]);
    D.list = (l && l.list) || [];
    D.friends = (f && f.friends) || [];
    renderList();
  }

  function renderList() {
    const ul = $('#dm-list');
    const inList = new Set(D.list.map((c) => c.id));
    const rest = D.friends.filter((f) => !inList.has(f.id));
    const items = [];
    for (const c of D.list) {
      const online = (D.friends.find((f) => f.id === c.id) || c).online;
      items.push(h('li', null, h('button', { type: 'button', class: 'dm-row' + (c.unread ? ' unread' : ''), onclick: () => openChat(c.id) },
        h('span', { class: 'av-wrap' + (online ? ' on' : '') }, NR.avatarEl(c.friend.name, c.friend.avatar, 'sm'), h('i', { class: 'dot' })),
        h('span', { class: 'dm-row-main' },
          h('b', null, c.friend.name),
          h('small', null, (c.last.mine ? 'Вы: ' : '') + c.last.text)),
        h('span', { class: 'dm-row-side' },
          h('small', null, shortWhen(c.last.t)),
          c.unread ? h('span', { class: 'badge' }, c.unread) : null))));
    }
    if (rest.length) {
      items.push(h('li', { class: 'dm-sep' }, D.list.length ? 'Написать другу' : 'Начните переписку с другом'));
      for (const f of rest) {
        items.push(h('li', null, h('button', { type: 'button', class: 'dm-row', onclick: () => openChat(f.id) },
          h('span', { class: 'av-wrap' + (f.online ? ' on' : '') }, NR.avatarEl(f.name, f.avatar, 'sm'), h('i', { class: 'dot' })),
          h('span', { class: 'dm-row-main' }, h('b', null, f.name), h('small', null, f.online ? 'в сети' : 'не в сети')))));
      }
    }
    if (!items.length) items.push(h('li', { class: 'dm-empty' }, h('b', null, 'Пока не с кем переписываться'), h('span', null, 'Добавьте друзей по нику в лобби — и сможете писать им здесь.')));
    ul.replaceChildren(...items);
  }

  async function openChat(id) {
    show();
    D.with = id;
    $('#dm-list-pane').hidden = true;
    $('#dm-chat-pane').hidden = false;
    $('#dm-msgs').replaceChildren(h('p', { class: 'muted small dm-loading' }, 'Загружаем…'));
    const res = await call('dm:history', { id }, true);
    if (!res || D.with !== id) return;
    D.friend = res.friend;
    D.msgs = res.messages;
    renderWho();
    renderMsgs(true);
    const canWrite = res.friend.isFriend;
    $('#dm-input').disabled = !canWrite;
    $('#dm-input').placeholder = canWrite ? 'Сообщение…' : 'Писать можно только друзьям';
    if (canWrite && matchMedia('(hover: hover)').matches) $('#dm-input').focus();
  }

  function renderWho() {
    const f = D.friend;
    const who = $('#dm-who');
    who.href = profileHref(f.name);
    who.replaceChildren(
      h('span', { class: 'av-wrap' + (f.online ? ' on' : '') }, NR.avatarEl(f.name, f.avatar, 'sm'), h('i', { class: 'dot' })),
      h('span', { class: 'dm-who-txt' }, h('b', null, f.name), h('small', null, f.online ? 'в сети' : 'не в сети')));
  }

  function renderMsgs(scroll) {
    const box = $('#dm-msgs');
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    const out = [];
    let day = '';
    let prev = null;
    for (const m of D.msgs) {
      const d = dayOf(m.t);
      if (d !== day) { out.push(h('div', { class: 'dm-day' }, d)); day = d; prev = null; }
      const mine = m.from === S.me.id;
      const grouped = prev && prev.from === m.from && m.t - prev.t < 3 * 60 * 1000;
      out.push(h('div', { class: 'dm-msg' + (mine ? ' mine' : '') + (grouped ? ' grouped' : '') },
        h('p', null, m.text), h('time', { datetime: new Date(m.t).toISOString() }, timeOf(m.t))));
      prev = m;
    }
    if (!D.msgs.length) out.push(h('div', { class: 'dm-empty' }, h('b', null, 'Здесь пока пусто'), h('span', null, `Напишите ${D.friend ? D.friend.name : ''} первым — например, позовите за стол.`)));
    box.replaceChildren(...out);
    if (scroll || atBottom) box.scrollTop = box.scrollHeight;
  }

  async function send() {
    const input = $('#dm-input');
    const text = input.value.trim();
    if (!text || !D.with) return;
    const res = await call('dm:send', { id: D.with, text });
    if (!res) return;
    input.value = '';
    autoGrow();
    // the message also arrives as dm:new; add it here if it hasn't yet
    if (!D.msgs.some((m) => m.id === res.msg.id)) { D.msgs.push(res.msg); renderMsgs(true); }
  }

  function autoGrow() {
    const t = $('#dm-input');
    t.style.height = 'auto';
    t.style.height = Math.min(120, t.scrollHeight) + 'px';
  }

  // ---------- incoming ----------
  function onNew(e) {
    if (D.open && D.with === e.with) {
      if (!D.msgs.some((m) => m.id === e.msg.id)) { D.msgs.push(e.msg); renderMsgs(e.msg.from === S.me.id); }
      if (e.msg.from !== S.me.id) { call('dm:read', { id: e.with }, true); $('#dm-typing').hidden = true; }
      return;
    }
    if (D.open && !D.with) openList();
    if (e.msg.from !== S.me.id && e.from) {
      Sound.play('ping');
      toast(`${e.from.name}: ${e.msg.text.length > 60 ? e.msg.text.slice(0, 60) + '…' : e.msg.text}`);
    }
  }
  function onTyping(e) {
    if (!D.open || D.with !== e.with) return;
    const el = $('#dm-typing');
    el.hidden = false;
    clearTimeout(D.typingTimer);
    D.typingTimer = setTimeout(() => { el.hidden = true; }, 3500);
  }

  // ---------- events ----------
  $('#dm-btn').addEventListener('click', () => { if (D.open) hide(); else openList(); });
  $$('[data-dm-close]').forEach((b) => b.addEventListener('click', hide));
  $('#dm-back').addEventListener('click', openList);
  $('#dm-form').addEventListener('submit', (e) => { e.preventDefault(); send(); });
  $('#dm-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });
  $('#dm-input').addEventListener('input', () => {
    autoGrow();
    if (D.with && Date.now() - D.lastTypingSent > 2500) { D.lastTypingSent = Date.now(); call('dm:typing', { id: D.with }, true); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && D.open && !document.querySelector('dialog[open]')) hide(); });
  $('#dm-who').addEventListener('click', () => hide());

  function bind(socket) {
    if (bind.done === socket) return;
    bind.done = socket;
    socket.on('dm:new', onNew);
    socket.on('dm:typing', onTyping);
  }
  if (S.socket) bind(S.socket);
  // play.js creates the socket on login; catch it when it appears
  const watch = setInterval(() => { if (S.socket && bind.done !== S.socket) bind(S.socket); }, 1000);
  window.addEventListener('beforeunload', () => clearInterval(watch));

  window.DM = { open: (id) => (id ? openChat(id) : openList()), close: hide, bind };
})();
