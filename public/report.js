/* Reports: "Пожаловаться" from table chats, private messages and profiles; account deletion. */
(() => {
  'use strict';
  const { $, h, toast, call, S } = window.NR;
  const REASONS = [['abuse', 'Оскорбления'], ['spam', 'Спам или реклама'], ['cheat', 'Нечестная игра'], ['image', 'Недопустимый ник или аватар'], ['other', 'Другое']];

  // ---------- the report dialog ----------
  const dlg = h('dialog', { class: 'modal', id: 'modal-report', 'aria-labelledby': 'report-title' });
  document.body.append(dlg);
  function open({ name, where, text }) {
    if (!name || (S.me && name === S.me.name)) return;
    const form = h('form', { method: 'dialog', class: 'form' },
      h('h2', { class: 'h2', id: 'report-title' }, 'Пожаловаться на ', h('span', { class: 'report-target' }, name)),
      text ? h('p', { class: 'report-quote' }, '«' + String(text).slice(0, 200) + '»') : null,
      h('fieldset', { class: 'seg-field' }, h('legend', null, 'Причина'),
        h('div', { class: 'report-reasons' }, REASONS.map(([v, l], i) => h('label', { class: 'check' }, h('input', { type: 'radio', name: 'reason', value: v, ...(i === 0 ? { checked: true } : {}) }), h('span', null, l))))),
      h('label', { class: 'field' }, h('span', null, 'Комментарий (необязательно)'), h('textarea', { name: 'note', maxlength: '200', rows: '2', placeholder: 'Что случилось' })),
      h('p', { class: 'muted small' }, 'Жалобу увидят только администраторы клуба.'),
      h('div', { class: 'modal-actions' },
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => dlg.close() }, 'Отмена'),
        h('button', { type: 'submit', class: 'btn btn-gold' }, 'Отправить')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const note = form.note.value.trim();
      const res = await call('report:create', { name, reason: form.reason.value, where, text: [text, note].filter(Boolean).join(' — ') });
      if (!res) return;
      dlg.close();
      toast('Жалоба отправлена. Спасибо!');
    });
    dlg.replaceChildren(form);
    dlg.showModal();
  }

  // ---------- a menu on chat nicknames ----------
  let menu = null;
  function closeMenu() { if (menu) { menu.remove(); menu = null; } }
  function nickMenu(el) {
    closeMenu();
    const name = el.dataset.name;
    if (!name || (S.me && name === S.me.name)) return;
    const r = el.getBoundingClientRect();
    const where = el.closest('[data-chat-where]');
    menu = h('div', { class: 'nick-menu', role: 'menu' },
      h('button', { type: 'button', role: 'menuitem', onclick: () => { closeMenu(); location.hash = '#/profile/' + encodeURIComponent(name); } }, 'Профиль'),
      h('button', { type: 'button', role: 'menuitem', class: 'danger', onclick: () => { closeMenu(); open({ name, where: where ? where.dataset.chatWhere : 'Чат стола', text: el.dataset.msg }); } }, 'Пожаловаться'));
    document.body.append(menu);
    const w = menu.offsetWidth; const hh = menu.offsetHeight;
    menu.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left)) + 'px';
    menu.style.top = (r.bottom + hh + 8 > innerHeight ? Math.max(8, r.top - hh - 6) : r.bottom + 6) + 'px';
    menu.querySelector('button').focus();
  }
  document.addEventListener('click', (e) => {
    const nick = e.target.closest('.chat-nick[data-name]');
    if (nick) { e.preventDefault(); nickMenu(nick); return; }
    if (menu && !menu.contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
    const nick = e.target.closest && e.target.closest('.chat-nick[data-name]');
    if (nick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); nickMenu(nick); }
  });
  addEventListener('hashchange', closeMenu);
  addEventListener('scroll', closeMenu, true);

  // ---------- deleting one's own account ----------
  function deleteAccount() {
    const d = h('dialog', { class: 'modal' });
    const form = h('form', { method: 'dialog', class: 'form' },
      h('h2', { class: 'h2' }, 'Удалить аккаунт?'),
      h('p', { class: 'muted' }, 'Аккаунт, фишки, статистика, покупки, друзья и переписка будут удалены навсегда. Восстановить их нельзя.'),
      h('label', { class: 'field' }, h('span', null, 'Пароль для подтверждения'), h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true })),
      h('p', { class: 'form-error', role: 'alert' }),
      h('div', { class: 'modal-actions' },
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => d.close() }, 'Отмена'),
        h('button', { type: 'submit', class: 'btn btn-dark btn-report' }, 'Удалить навсегда')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const res = await call('account:delete', { password: form.password.value });
      if (!res) return;
      d.close();
      try { localStorage.removeItem('nr_token'); } catch (err) { /* ignore */ }
      toast('Аккаунт удалён');
      setTimeout(() => location.replace('/'), 900);
    });
    d.append(form);
    d.addEventListener('close', () => d.remove());
    document.body.append(d);
    d.showModal();
  }

  window.Report = { open, deleteAccount };
})();
