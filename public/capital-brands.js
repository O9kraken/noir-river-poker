/* «Капитал» — «Биржа брендов»: invented companies with original marks.
   Every name and logo here is made up for NOIR RIVER; none of them belongs to a real company. */
(() => {
  'use strict';
  // a mark is drawn on a 32×32 grid: `bg` fills a rounded tile, `svg` is the glyph on top
  const M = (bg, fg, svg) => ({ bg, fg, svg });
  const LOGOS = {
    // уличная еда
    1: M('#E8913A', '#FFF4E2', '<rect x="7" y="12" width="18" height="9" rx="4.5" transform="rotate(-24 16 16)" fill="currentColor"/><path d="M10 19.5l12-5.4M9.2 16.6l11.2-5" stroke="#B5561B" stroke-width="1.6" stroke-linecap="round"/><circle cx="23.5" cy="10.5" r="2.2" fill="#7BC46A"/>'),
    3: M('#F6B9CF', '#7A2E4E', '<circle cx="16" cy="16" r="9.5" fill="#D9925A"/><circle cx="16" cy="16" r="8" fill="#E9579A"/><circle cx="16" cy="16" r="3.2" fill="#F6B9CF"/><path d="M12 11.5l1.6.6M19.4 11.2l1.2 1.1M11 18.6l1.4-.9M20 20l1.5.4M15.6 22l.6-1.4" stroke="#FFF4E2" stroke-width="1.4" stroke-linecap="round"/>'),
    // кофейни
    6: M('#3B2416', '#F1D9B5', '<ellipse cx="16" cy="16" rx="7" ry="9.5" transform="rotate(30 16 16)" fill="currentColor"/><path d="M12.3 9.7c4 3 -0.4 9.6 7.4 12.6" stroke="#3B2416" stroke-width="1.8" fill="none" stroke-linecap="round"/>'),
    8: M('#7EC8E3', '#17324A', '<path d="M8 13h14v5.5a7 7 0 0 1-14 0z" fill="currentColor"/><path d="M8.6 13.2l1.4-4 3 3.6M21.4 13.2l-1.4-4-3 3.6" fill="currentColor"/><path d="M22 14.5h1.8a2.7 2.7 0 0 1 0 5.4H21.6" stroke="currentColor" stroke-width="1.8" fill="none"/><circle cx="12.4" cy="16.4" r="1" fill="#7EC8E3"/><circle cx="17.6" cy="16.4" r="1" fill="#7EC8E3"/>'),
    9: M('#1E2B4A', '#F4E6B8', '<path d="M17.5 5.5a6 6 0 1 0 6.5 7.6 4.6 4.6 0 1 1-6.5-7.6z" fill="currentColor"/><path d="M8 18h13v3.5a5.5 5.5 0 0 1-5.5 5.5h-2A5.5 5.5 0 0 1 8 21.5z" fill="#C9E4F2"/><path d="M21 19.2h1.4a2.2 2.2 0 0 1 0 4.4H21" stroke="#C9E4F2" stroke-width="1.6" fill="none"/>'),
    // мода
    11: M('#FBEFF5', '#B53E7A', '<path d="M22.5 6.5L9 23" stroke="#5A4A52" stroke-width="2" stroke-linecap="round"/><ellipse cx="21.6" cy="7.6" rx=".9" ry="1.8" transform="rotate(40 21.6 7.6)" fill="#FBEFF5"/><path d="M21.8 8c-6 2-13 3-12 9s9 4 10.5 0-6-6-9.5 1" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>'),
    13: M('#D46A9F', '#FFFFFF', '<path d="M6 21.5c0-3 .5-7 1.5-9.5h4.5l1.5 3 5-1.5c3 2 7 3 8 6v2z" fill="currentColor"/><rect x="5.5" y="21.5" width="21" height="3" rx="1.5" fill="#3A1830"/><path d="M13.6 17.2l1.6-.5M16 18.6l1.7-.5" stroke="#D46A9F" stroke-width="1.3" stroke-linecap="round"/>'),
    14: M('#4A1630', '#E8C77A', '<path d="M16 5l2.4 4.2 4.8-.6-1.8 4.4 3.4 3.5-4.6 1.4.2 4.8L16 20l-4.4 2.7.2-4.8-4.6-1.4 3.4-3.5-1.8-4.4 4.8.6z" fill="none" stroke="currentColor" stroke-width="1.2"/><text x="16" y="18.8" text-anchor="middle" font-family="Georgia,serif" font-size="9.5" font-weight="700" fill="currentColor">Б</text>'),
    // доставка
    16: M('#FFF1DC', '#E8913A', '<path d="M8 13h16l-2 12H10z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9.3 17.5h13.4M9.8 21.2h12.4M13 13l-.5 12M19 13l.5 12M16 13v12" stroke="currentColor" stroke-width="1.1"/><path d="M12 13a4 4.5 0 0 1 8 0" fill="none" stroke="currentColor" stroke-width="1.8"/>'),
    18: M('#2E9E6A', '#E9FBE9', '<path d="M8 24C8 13 15 7 25 7c0 10-6 17-17 17z" fill="currentColor"/><path d="M9 23c4-5 8-9 13-12.5" stroke="#2E9E6A" stroke-width="1.6" stroke-linecap="round" fill="none"/>'),
    19: M('#E8913A', '#FFF8EC', '<rect x="7" y="14" width="18" height="11" rx="2.5" fill="currentColor"/><path d="M7 18h18" stroke="#E8913A" stroke-width="1.5"/><path d="M12 11c-1-1.5 1-2.5 0-4.5M16 11c-1-1.5 1-2.5 0-4.5M20 11c-1-1.5 1-2.5 0-4.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>'),
    // кино
    21: M('#C8323C', '#FFFFFF', '<path d="M9 13h14l-2 13H11z" fill="currentColor"/><path d="M13.6 13.4l.6 12.4M18.4 13.4l-.6 12.4" stroke="#C8323C" stroke-width="2.2"/><circle cx="11.5" cy="11.5" r="3" fill="#FFE59A"/><circle cx="16" cy="9.8" r="3.3" fill="#FFF1C4"/><circle cx="20.5" cy="11.5" r="3" fill="#FFE59A"/><path d="M24.5 6.5v5M22 9h5" stroke="#FFE59A" stroke-width="1.6" stroke-linecap="round"/>'),
    23: M('#16101A', '#FF5C6C', '<path d="M12 8.5v11l9-5.5z" fill="currentColor"/><path d="M6 23.5c2.5-2.4 5-2.4 7.5 0s5 2.4 7.5 0 3.5-2 5 -.6" stroke="#7FC8FF" stroke-width="1.8" fill="none" stroke-linecap="round"/>'),
    24: M('#FFE8EA', '#C8323C', '<rect x="5.5" y="9" width="15" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="9" y="12.5" width="15" height="10" rx="2" fill="#FFE8EA" stroke="currentColor" stroke-width="1.6"/><rect x="12.5" y="16" width="14" height="9.5" rx="2" fill="currentColor"/><path d="M18 18.4v4.6l3.8-2.3z" fill="#FFE8EA"/>'),
    // гаджеты
    26: M('#1D1A14', '#E6C34A', '<rect x="8" y="8" width="5" height="5" rx="1" fill="currentColor"/><rect x="13.5" y="8" width="5" height="5" rx="1" fill="#F2DE96" opacity=".55"/><rect x="19" y="8" width="5" height="5" rx="1" fill="currentColor"/><rect x="8" y="13.5" width="5" height="5" rx="1" fill="#F2DE96" opacity=".55"/><rect x="13.5" y="13.5" width="5" height="5" rx="1" fill="currentColor"/><rect x="19" y="13.5" width="5" height="5" rx="1" fill="#F2DE96" opacity=".55"/><rect x="8" y="19" width="5" height="5" rx="1" fill="currentColor"/><rect x="13.5" y="19" width="5" height="5" rx="1" fill="#F2DE96" opacity=".55"/><rect x="19" y="19" width="5" height="5" rx="1" fill="currentColor"/>'),
    27: M('#E6C34A', '#1D1A14', '<rect x="7" y="10" width="16" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><rect x="23" y="13.5" width="2.5" height="5" rx="1" fill="currentColor"/><path d="M16.5 11.5L12 16.6h3.4L14 20.8l4.6-5.4h-3.4z" fill="currentColor"/>'),
    29: M('#FFF6D6', '#8A6A10', '<ellipse cx="16" cy="16" rx="10" ry="4" fill="none" stroke="currentColor" stroke-width="1.5"/><ellipse cx="16" cy="16" rx="10" ry="4" transform="rotate(60 16 16)" fill="none" stroke="currentColor" stroke-width="1.5"/><ellipse cx="16" cy="16" rx="10" ry="4" transform="rotate(-60 16 16)" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="16" cy="16" r="2.4" fill="#E6A82A"/>'),
    // финтех и маркет
    31: M('#2E9E6A', '#FFFFFF', '<path d="M6 12.5h20M6 22.5h20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="8" y="6.5" width="5" height="6" rx="1" fill="#FFE59A"/><rect x="14.5" y="8.5" width="5" height="4" rx="1" fill="currentColor"/><rect x="9.5" y="16" width="6" height="6.5" rx="1" fill="currentColor"/><rect x="17" y="17.5" width="5.5" height="5" rx="1" fill="#FFE59A"/>'),
    32: M('#0E3B2A', '#9BE8C1', '<circle cx="16" cy="16" r="5.6" fill="currentColor"/><text x="16" y="19" text-anchor="middle" font-family="Arial,sans-serif" font-size="8" font-weight="800" fill="#0E3B2A">₽</text><path d="M7 14a9.4 9.4 0 0 1 15.5-5.6M25 18a9.4 9.4 0 0 1-15.5 5.6" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M22.8 5.6l.2 3.4-3.3.6M9.2 26.4L9 23l3.3-.6" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'),
    34: M('#F4FBF6', '#2E9E6A', '<path d="M6 12l2-5h16l2 5z" fill="currentColor"/><path d="M6 12a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0" fill="#C8323C"/><path d="M11 7l-1 5M16 7v5M21 7l1 5" stroke="#F4FBF6" stroke-width="1.2"/><rect x="8" y="15" width="16" height="10" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="13.5" y="18.5" width="5" height="6.5" fill="currentColor"/>'),
    // премиум
    37: M('#2F4FA8', '#FFFFFF', '<path d="M26 10.5c.8-.8.3-2-1-1.6L20 10.6 12.5 6.6l-2 1 4.8 5.3-4.3 1.6-2.6-1.6-1.6.6 2.4 3.4c.4.6 1 .8 1.7.6z" fill="currentColor"/><path d="M6 24h20" stroke="#AFC2FF" stroke-width="1.6" stroke-linecap="round"/>'),
    39: M('#0C1430', '#E8D58F', '<path d="M8 13l3.5-5h9l3.5 5L16 25z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 13h16M11.5 8L14 13l2 12 2-12 2.5-5M14 13l2-5 2 5" stroke="currentColor" stroke-width="1.1" fill="none" stroke-linejoin="round"/>'),
    // транспорт
    5: M('#FFD23F', '#1D1A14', '<path d="M7 19.5l1.6-5a2.5 2.5 0 0 1 2.4-1.8h10a2.5 2.5 0 0 1 2.4 1.8l1.6 5v3H7z" fill="currentColor"/><rect x="13" y="9" width="6" height="3" rx=".5" fill="currentColor"/><path d="M13 9h1.5v1.5H13zM16 9h1.5v1.5H16zM14.5 10.5H16V12h-1.5zM17.5 10.5H19V12h-1.5z" fill="#FFD23F"/><circle cx="11" cy="22.5" r="2.2" fill="#FFD23F" stroke="currentColor" stroke-width="1.4"/><circle cx="21" cy="22.5" r="2.2" fill="#FFD23F" stroke="currentColor" stroke-width="1.4"/><path d="M10.4 15.5h11.2" stroke="#FFD23F" stroke-width="1.4"/>'),
    15: M('#DDE3EA', '#3A4656', '<rect x="10" y="5.5" width="12" height="15" rx="4" fill="currentColor"/><rect x="12" y="8" width="8" height="5" rx="1.2" fill="#9FD3F5"/><circle cx="13" cy="17" r="1.1" fill="#FFE59A"/><circle cx="19" cy="17" r="1.1" fill="#FFE59A"/><path d="M12 20.5l-3 6M20 20.5l3 6M10.5 23.5h11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'),
    25: M('#16243F', '#F1F4FA', '<path d="M7 18h18l-2.6 4.6a2 2 0 0 1-1.7 1H11.3a2 2 0 0 1-1.7-1z" fill="currentColor"/><rect x="11" y="13" width="10" height="5" rx="1" fill="currentColor"/><rect x="14" y="8.5" width="3" height="4.5" fill="#E06A72"/><path d="M5.5 26.5c2-1.4 4-1.4 6 0s4 1.4 6 0 4-1.4 6 0 2.5 1 3 .6" stroke="#7FC8FF" stroke-width="1.4" fill="none" stroke-linecap="round"/><circle cx="13.5" cy="15.5" r=".9" fill="#16243F"/><circle cx="18.5" cy="15.5" r=".9" fill="#16243F"/>'),
    35: M('#E9F6EE', '#1E6B48', '<circle cx="10" cy="20" r="4.6" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="22" cy="20" r="4.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10 20l4-7.5h6.5L22 20M14 12.5L16.5 20h2l2-7.5M13 10.5h3M19.5 10h2.5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'),
    // сервисы
    12: M('#1A1A10', '#FFD23F', '<path d="M18 4.5L9 18h6.2L13 27.5 23 13h-6.4z" fill="currentColor"/>'),
    28: M('#7B3FE4', '#FFFFFF', '<path d="M8 25V21M12.5 25v-7M17 25v-10M21.5 25V12" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M23 6.5v6M20 9.5h6" stroke="#FFD23F" stroke-width="2" stroke-linecap="round"/>'),
  };
  const TAGS = {
    1: 'Завернём всё, кроме удачи',
    3: 'Дырка — это не баг, это фича',
    6: 'Зерно истины в каждой чашке',
    8: 'Мурчит, пока варится',
    9: 'Для тех, кто не спит до утра',
    11: 'Шьём на вас, а не на манекен',
    13: 'Бегите — но к нам',
    14: 'Мягко стелем, дорого продаём',
    16: 'Привезём всё, что влезет',
    18: 'Сорвано сегодня утром',
    19: 'Обед, который не надо греть',
    21: 'Хрустит громче спойлеров',
    23: 'Ловите волну премьер',
    24: 'Ещё одну серию — и спать',
    26: 'Мир по пикселю',
    27: 'Заряд на весь вечер',
    29: 'Технологии на грани физики',
    31: 'Всё на своих местах',
    32: 'Ваши деньги всегда в обороте',
    34: 'Торгуемся, но вежливо',
    37: 'Летаем стильно',
    39: 'Сияние без повода',
    5: 'Шашечки и ехать',
    15: 'Точно по расписанию',
    25: 'Через реку — с комфортом',
    35: 'Крутите педали, а не голову',
    12: 'Свет в каждом окне',
    28: 'На связи даже в лифте',
  };
  /** An <svg> element for cell i, or null for cells without a brand. */
  function logo(i, cls = 'cap-mark') {
    const m = LOGOS[i];
    if (!m) return null;
    const wrap = document.createElement('span');
    wrap.className = cls;
    wrap.setAttribute('aria-hidden', 'true');
    wrap.innerHTML = `<svg viewBox="0 0 32 32" style="color:${m.fg}"><rect width="32" height="32" rx="8" fill="${m.bg}"/>${m.svg}</svg>`;
    return wrap;
  }
  window.CapitalBrands = { LOGOS, TAGS, logo };
})();
