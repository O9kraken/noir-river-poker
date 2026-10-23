/* The club shop: avatar frames and titles everyone sees, card backs and felt for your own tables. */
(() => {
  'use strict';
  const NR = window.NR;
  const { $, h, fmt, call, toast, S, Sound } = NR;
  const CATS = [
    ['frame', 'Рамки аватара', 'Рамку видят все: за столами, в чатах, в профиле и рейтингах.'],
    ['back', 'Рубашки карт', 'Рубашка карт в покере, дураке и блэкджеке — для ваших столов.'],
    ['felt', 'Сукно', 'Цвет сукна на ваших столах: покер, дурак, блэкджек.'],
    ['title', 'Титулы', 'Титул виден в вашем профиле рядом с именем.'],
  ];
  const P = { cat: 'frame', shop: null };
  try { P.cat = localStorage.getItem('nr_shop_cat') || 'frame'; } catch (e) { /* ignore */ }

  async function open() {
    renderTabs();
    const res = await call('shop:get', {});
    if (!res) return;
    P.shop = res.shop;
    render();
  }

  function renderTabs() {
    $('#shop-tabs').replaceChildren(...CATS.map(([id, name]) => h('button', {
      type: 'button', role: 'tab', class: 'tab' + (P.cat === id ? ' is-active' : ''), 'aria-selected': P.cat === id ? 'true' : 'false',
      onclick: () => { P.cat = id; try { localStorage.setItem('nr_shop_cat', id); } catch (e) { /* ignore */ } renderTabs(); render(); },
    }, name)));
    $('#shop-note').textContent = CATS.find((c) => c[0] === P.cat)[2];
  }

  /** A small live picture of the item. */
  function preview(it) {
    const me = S.me || { name: 'Вы', avatar: null };
    if (it.cat === 'frame') {
      const av = { ...(me.avatar || {}) };
      if (it.id === 'frame-none') delete av.frame; else av.frame = it.id.slice(6);
      return h('div', { class: 'shop-prev prev-frame' }, NR.avatarEl(me.name, av, 'xl'));
    }
    if (it.cat === 'back') {
      return h('div', { class: `shop-prev prev-back lk-${it.id}` }, NR.cardEl(null, 'pv1'), NR.cardEl(null, 'pv2'), NR.cardEl('As', 'pv3'));
    }
    if (it.cat === 'felt') {
      return h('div', { class: `shop-prev prev-felt lk-${it.id} lk-felt` }, h('div', { class: 'felt pv-felt' }, h('span', { class: 'pv-logo' }, 'NOIR RIVER'), NR.cardEl('Kh', 'pv-c1'), NR.cardEl('Qs', 'pv-c2')));
    }
    return h('div', { class: 'shop-prev prev-title' }, NR.avatarEl(me.name, me.avatar, 'sm'),
      h('span', null, h('b', null, me.name), it.id === 'title-none' ? h('small', { class: 'muted' }, 'без титула') : h('small', { class: 'shop-title-pill' }, it.name)));
  }

  function render() {
    const sh = P.shop;
    if (!sh) return;
    $('#shop-wallet').replaceChildren(h('span', { class: 'chip-icon', 'aria-hidden': 'true' }), h('b', null, fmt(sh.balance)), h('small', null, 'фишек на балансе'));
    const items = sh.items.filter((it) => it.cat === P.cat);
    $('#shop-grid').replaceChildren(...items.map((it) => {
      let btn;
      if (it.equipped) btn = h('span', { class: 'shop-on' }, '✓ Выбрано');
      else if (it.owned) btn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => act('shop:equip', it) }, 'Выбрать');
      else {
        const short = sh.balance < it.price;
        btn = h('button', { type: 'button', class: 'btn btn-gold btn-sm', disabled: short, title: short ? 'Не хватает фишек' : '', onclick: () => act('shop:buy', it) },
          h('span', { class: 'chip-icon sm', 'aria-hidden': 'true' }), fmt(it.price));
      }
      return h('article', { class: 'shop-item' + (it.equipped ? ' on' : '') + (it.owned ? ' owned' : '') },
        preview(it),
        h('div', { class: 'shop-meta' },
          h('div', null, h('b', null, it.name), h('small', { class: 'muted' }, it.equipped ? 'надето' : it.owned ? (it.price ? 'куплено' : 'бесплатно') : it.note || `${fmt(it.price)} фишек`)),
          btn));
    }));
  }

  async function act(ev, it) {
    if (ev === 'shop:buy' && !confirm(`Купить «${it.name}» за ${fmt(it.price)} фишек?`)) return;
    const res = await call(ev, { id: it.id });
    if (!res) return;
    P.shop = res.shop;
    render();
    if (ev === 'shop:buy') { Sound.play('coin'); toast(`«${it.name}» теперь ваше и уже надето`); }
    else Sound.play('chips');
  }

  window.ShopUI = { open };
})();
