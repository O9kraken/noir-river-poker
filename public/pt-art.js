/* Card illustrations for the party games: hand-drawn SVG, one per card. window.PartyArt.bomb(k) / .dungeon(k) */
(() => {
  'use strict';
  const INK = '#120D0B';
  const cache = new Map();

  /** The frame every illustration lives in: a glow in the card's colour, a floor shadow. */
  function wrap(id, tone, inner, { floor = true, glow = 0.55 } = {}) {
    return `<svg class="pt-art" viewBox="0 0 120 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
<defs>
<radialGradient id="${id}-bg" cx="50%" cy="42%" r="70%"><stop offset="0" stop-color="${tone}" stop-opacity="${glow}"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
<radialGradient id="${id}-sh" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
<linearGradient id="${id}-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F7E2A3"/><stop offset="1" stop-color="#B88E3C"/></linearGradient>
<radialGradient id="${id}-ball" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#5A5E66"/><stop offset=".55" stop-color="#1C1E22"/><stop offset="1" stop-color="#050506"/></radialGradient>
<radialGradient id="${id}-fire" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#FFF8D0"/><stop offset=".35" stop-color="#FFC23A"/><stop offset=".7" stop-color="#F05A1E" stop-opacity=".7"/><stop offset="1" stop-color="#F05A1E" stop-opacity="0"/></radialGradient>
<radialGradient id="${id}-orb" cx="40%" cy="35%" r="65%"><stop offset="0" stop-color="#F4E8FF"/><stop offset=".35" stop-color="#B58CFF"/><stop offset="1" stop-color="#3A1C78"/></radialGradient>
</defs>
<rect width="120" height="100" fill="url(#${id}-bg)"/>
${floor ? `<ellipse cx="60" cy="90" rx="40" ry="6" fill="url(#${id}-sh)"/>` : ''}
<g stroke="${INK}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">${inner}</g>
</svg>`;
  }
  const G = (id) => `url(#${id}-gold)`;

  // ---------- shared pieces ----------
  /** A sitting cat seen from the front. o: fur, belly, eye, ears in */
  function cat(x, y, s, o = {}) {
    const fur = o.fur || '#2A2C30'; const belly = o.belly || fur; const eye = o.eye || '#F0D48A';
    const mood = o.mood || 'calm';
    const eyes = mood === 'angry'
      ? `<path d="M-14 -36 l9 3 M14 -36 l-9 3" stroke-width="2.4"/><ellipse cx="-9" cy="-30" rx="4.5" ry="3.6" fill="${eye}"/><ellipse cx="9" cy="-30" rx="4.5" ry="3.6" fill="${eye}"/><path d="M-9 -33v6M9 -33v6" stroke="${INK}" stroke-width="2"/>`
      : mood === 'smug'
        ? `<path d="M-14 -30q5 -4 10 0M4 -30q5 -4 10 0" fill="none" stroke-width="2.4"/>`
        : `<ellipse cx="-9" cy="-30" rx="4.5" ry="5.5" fill="${eye}"/><ellipse cx="9" cy="-30" rx="4.5" ry="5.5" fill="${eye}"/><path d="M-9 -34v8M9 -34v8" stroke="${INK}" stroke-width="2"/>`;
    return `<g transform="translate(${x} ${y}) scale(${s})">
<path d="M18 2 q22 -4 20 -22 q-1 -8 -7 -6" fill="none" stroke="${fur}" stroke-width="7"/><path d="M18 2 q22 -4 20 -22 q-1 -8 -7 -6" fill="none" stroke-width="2" stroke="${INK}" opacity=".0"/>
<path d="M-20 4 q-4 -26 6 -34 h28 q10 8 6 34 z" fill="${fur}"/>
<path d="M-10 4 q-2 -16 10 -20 q12 4 10 20 z" fill="${belly}" stroke="none" opacity=".9"/>
<path d="M-22 -40 l2 -20 l12 10 h16 l12 -10 l2 20 q4 18 -22 20 q-26 -2 -22 -20 z" fill="${fur}"/>
<path d="M-18 -53 l1 -6 l5 4 z M18 -53 l-1 -6 l-5 4 z" fill="#E8A0A8" stroke="none"/>
${eyes}
<path d="M-3 -23 h6 l-3 3 z" fill="#E8A0A8" stroke-width="1.4"/>
<path d="M0 -20 q-3 4 -6 2 M0 -20 q3 4 6 2" fill="none" stroke-width="1.6"/>
<path d="M-6 -24 l-16 -3 M-6 -22 l-16 2 M6 -24 l16 -3 M6 -22 l16 2" stroke="#E9DEC6" stroke-width="1" opacity=".75"/>
<path d="M-12 4 v-6 q0 -4 4 -4 q4 0 4 4 v6 M4 4 v-6 q0 -4 4 -4 q4 0 4 4 v6" fill="${fur}" stroke-width="1.8"/>
${o.extra || ''}
</g>`;
  }
  function spark(x, y, r, color = '#FFD866') {
    return `<path d="M${x} ${y - r} L${x + r * 0.25} ${y - r * 0.25} L${x + r} ${y} L${x + r * 0.25} ${y + r * 0.25} L${x} ${y + r} L${x - r * 0.25} ${y + r * 0.25} L${x - r} ${y} L${x - r * 0.25} ${y - r * 0.25} Z" fill="${color}" stroke="none"/>`;
  }
  function miniCard(x, y, w, h, rot, fill = '#EFE6D2', mark = '') {
    return `<g transform="translate(${x} ${y}) rotate(${rot})"><rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="3" fill="${fill}"/>${mark}</g>`;
  }
  function face(x, y, r, skin, o = {}) {
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="${skin}"/>
<circle cx="${x - r * 0.35}" cy="${y - r * 0.1}" r="${r * 0.12}" fill="${o.eye || INK}" stroke="none"/><circle cx="${x + r * 0.35}" cy="${y - r * 0.1}" r="${r * 0.12}" fill="${o.eye || INK}" stroke="none"/>
${o.brows ? `<path d="M${x - r * 0.55} ${y - r * 0.38} l${r * 0.35} ${r * 0.12} M${x + r * 0.55} ${y - r * 0.38} l${-r * 0.35} ${r * 0.12}" stroke-width="1.8"/>` : ''}
${o.mouth === 'grin' ? `<path d="M${x - r * 0.45} ${y + r * 0.3} q${r * 0.45} ${r * 0.45} ${r * 0.9} 0 z" fill="#F4EEDF" stroke-width="1.6"/>`
    : o.mouth === 'o' ? `<ellipse cx="${x}" cy="${y + r * 0.42}" rx="${r * 0.18}" ry="${r * 0.22}" fill="${INK}"/>`
      : o.mouth === 'sad' ? `<path d="M${x - r * 0.35} ${y + r * 0.48} q${r * 0.35} ${-r * 0.3} ${r * 0.7} 0" fill="none" stroke-width="1.8"/>`
        : `<path d="M${x - r * 0.35} ${y + r * 0.35} h${r * 0.7}" stroke-width="1.8"/>`}`;
  }
  function body(x, y, w, h, fill) { return `<path d="M${x - w / 2} ${y + h} q0 ${-h} ${w / 2} ${-h} q${w / 2} 0 ${w / 2} ${h} z" fill="${fill}"/>`; }
  function eyes2(x, y, d, r, color = '#FFE07A') { return `<circle cx="${x - d}" cy="${y}" r="${r}" fill="${color}" stroke="none"/><circle cx="${x + d}" cy="${y}" r="${r}" fill="${color}" stroke="none"/>`; }
  function coin(x, y, r = 6) { return `<circle cx="${x}" cy="${y}" r="${r}" fill="#E2B85A"/><circle cx="${x}" cy="${y}" r="${r * 0.6}" fill="none" stroke="#9C7A2F" stroke-width="1.2"/>`; }
  function bottle(x, y, s, glass, label) {
    return `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-4 -30 h8 v8 q8 6 8 16 v30 q0 4 -4 4 h-16 q-4 0 -4 -4 v-30 q0 -10 8 -16 z" fill="${glass}"/><rect x="-6" y="-36" width="12" height="7" rx="1.5" fill="#3A3C40"/>${label ? `<rect x="-10" y="-2" width="20" height="16" rx="2" fill="${label}"/>` : ''}<path d="M-7 -14 v24" stroke="#fff" stroke-opacity=".35" stroke-width="2"/></g>`;
  }

  // ================= Котобомба =================
  const BOMB = {
    bomb: ['#F05A1E', (id) => `
<path d="M66 30 q8 -16 22 -14 q8 2 10 -4" fill="none" stroke="#B89C6A" stroke-width="3.5"/>
<circle cx="99" cy="11" r="11" fill="url(#${id}-fire)" stroke="none"/>${spark(99, 11, 7, '#FFF2B0')}
<path d="M30 40 l-2 -18 l14 10 M86 40 l2 -18 l-14 10" fill="#1C1E22"/>
<rect x="52" y="22" width="16" height="10" rx="2" fill="#3A3C40"/>
<circle cx="58" cy="58" r="30" fill="url(#${id}-ball)"/>
<path d="M44 52 l9 4 M72 52 l-9 4" stroke-width="2.6"/>
<ellipse cx="48" cy="60" rx="5" ry="3.5" fill="#FF7A3A" stroke="none"/><ellipse cx="68" cy="60" rx="5" ry="3.5" fill="#FF7A3A" stroke="none"/>
<path d="M50 72 q8 -5 16 0" fill="none" stroke-width="2.2"/>
<path d="M40 70 l-14 2 M40 74 l-13 6 M76 70 l14 2 M76 74 l13 6" stroke="#9AA0A8" stroke-width="1.2"/>
<ellipse cx="46" cy="44" rx="7" ry="4" fill="#fff" opacity=".18" stroke="none" transform="rotate(-30 46 44)"/>
<path d="M14 20 l6 4 M10 34 l7 0 M104 40 l8 -2 M100 56 l9 3" stroke="#FFB13A" stroke-width="2"/>`],
    defuse: ['#3D7FE0', (id) => `
<rect x="20" y="52" width="40" height="30" rx="4" fill="#26282C"/><rect x="26" y="58" width="18" height="9" rx="1.5" fill="#0E3A1E"/><text x="35" y="65.5" font-size="7" font-family="monospace" fill="#5BFF8A" stroke="none" text-anchor="middle">0:03</text>
<circle cx="52" cy="62" r="3" fill="#C3202F"/>
<path d="M56 74 q20 -2 26 -22 q4 -12 16 -10" fill="none" stroke="#C3202F" stroke-width="4"/>
<path d="M56 78 q26 6 40 -6" fill="none" stroke="#2F6BC4" stroke-width="4"/>
<path d="M82 34 l12 18 M98 32 l-10 20" stroke="#D9D2C2" stroke-width="5"/>
<path d="M82 34 l12 18 M98 32 l-10 20" stroke="#8A8F98" stroke-width="2" stroke-opacity=".6"/>
<circle cx="90" cy="47" r="3" fill="#8A8F98"/>
<path d="M96 52 q10 10 6 24 q-2 6 -8 4 q-4 -6 -2 -14 z" fill="#C3202F"/><path d="M84 52 q-12 10 -8 24 q2 6 8 4 q4 -6 2 -14 z" fill="#C3202F"/>
${spark(88, 30, 6, '#BFE3FF')}`],
    skip: ['#2FAE6A', (id) => `
<rect x="74" y="14" width="34" height="72" rx="2" fill="#2A1A10"/><rect x="78" y="18" width="26" height="64" fill="#0A0605"/><path d="M78 18 l14 6 v64 l-14 -6 z" fill="#5A3A20"/>
${cat(52, 82, 0.62, { fur: '#D98A3A', belly: '#F0C890', mood: 'smug', extra: '' })}
<path d="M8 56 h18 M4 66 h22 M10 76 h14" stroke="#9FE0BC" stroke-width="2.4"/>
<circle cx="22" cy="86" r="5" fill="#8A7A60" stroke="none" opacity=".6"/><circle cx="12" cy="84" r="3.5" fill="#8A7A60" stroke="none" opacity=".5"/>`],
    attack: ['#E0453F', (id) => `
${cat(36, 84, 0.6, { fur: '#2A2C30', belly: '#55585E', mood: 'angry' })}
<path d="M54 44 q6 -4 12 -2" fill="none" stroke="#2A2C30" stroke-width="7"/>
<path d="M62 30 h26 v-8 l16 16 l-16 16 v-8 h-26 z" fill="#C3202F"/>
<path d="M66 54 h22 v-6 l12 12 l-12 12 v-6 h-22 z" fill="#E0453F"/>
<text x="102" y="92" font-size="16" font-weight="900" font-family="sans-serif" fill="#F0D48A" stroke="none" text-anchor="end">×2</text>`],
    future: ['#9B6BFF', (id) => `
<path d="M38 78 h44 l-6 10 h-32 z" fill="${G(id)}"/>
<circle cx="60" cy="50" r="28" fill="url(#${id}-orb)"/>
${miniCard(48, 52, 12, 17, -14, '#2A1A44', '')}${miniCard(60, 48, 12, 17, 0, '#C3202F', '')}${miniCard(72, 52, 12, 17, 14, '#2A1A44', '')}
<ellipse cx="50" cy="36" rx="9" ry="5" fill="#fff" opacity=".45" stroke="none" transform="rotate(-25 50 36)"/>
<path d="M30 70 q-4 -8 4 -10 q6 0 6 8 z M90 70 q4 -8 -4 -10 q-6 0 -6 8 z" fill="#2A2C30"/>
${spark(20, 20, 5, '#E0D0FF')}${spark(100, 26, 4, '#E0D0FF')}${spark(92, 12, 3, '#E0D0FF')}`],
    alter: ['#8F5BE0', (id) => `
${miniCard(36, 54, 24, 34, -16, '#2A1A44')}${miniCard(60, 50, 24, 34, 0, '#3E2866')}${miniCard(84, 54, 24, 34, 16, '#2A1A44')}
<text x="60" y="56" font-size="14" font-weight="900" font-family="sans-serif" fill="#F0D48A" stroke="none" text-anchor="middle">?</text>
<path d="M28 26 q32 -22 64 0" fill="none" stroke="#F0D48A" stroke-width="3"/><path d="M90 18 l3 9 l-9 1" fill="none" stroke="#F0D48A" stroke-width="3"/>
<path d="M92 80 q-32 18 -64 0" fill="none" stroke="#B58CFF" stroke-width="3"/><path d="M30 88 l-3 -9 l9 -1" fill="none" stroke="#B58CFF" stroke-width="3"/>
<path d="M54 74 q-4 8 4 12 l10 0 q4 -4 0 -10 z" fill="#2A2C30"/>`],
    shuffle: ['#E0A043', (id) => `
<path d="M60 50 m-34 0 a34 22 0 1 0 68 0 a34 22 0 1 0 -68 0" fill="none" stroke="#F0D48A" stroke-width="2" stroke-dasharray="5 6" opacity=".7"/>
${miniCard(30, 40, 18, 26, -40, '#EFE6D2', '<path d="M0 -4 l4 4 l-4 4 l-4 -4 z" fill="#C3202F" stroke="none"/>')}
${miniCard(58, 26, 18, 26, 20, '#1E1E22')}
${miniCard(90, 44, 18, 26, 60, '#EFE6D2', '<circle r="3.5" fill="#16181B" stroke="none"/>')}
${miniCard(72, 72, 18, 26, -20, '#1E1E22')}
${miniCard(40, 72, 18, 26, 35, '#6A1C22')}
<path d="M14 18 l6 2 M104 70 l7 3 M100 20 l6 -4" stroke="#FFD866" stroke-width="2"/>`],
    bottom: ['#E0A043', (id) => `
${[0, 1, 2, 3, 4].map((k) => `<rect x="34" y="${22 + k * 6}" width="52" height="34" rx="4" fill="${k % 2 ? '#1E1E22' : '#2A1A12'}"/>`).join('')}
<g transform="translate(66 74) rotate(10)"><rect x="-22" y="-14" width="44" height="28" rx="4" fill="#EFE6D2"/><path d="M-6 0 h12" stroke="#C3202F" stroke-width="3"/></g>
<path d="M18 30 v40 l-8 -8 M18 70 l8 -8" fill="none" stroke="#F0D48A" stroke-width="3.2"/>
<path d="M92 86 q6 -6 12 -2" fill="none" stroke="#2A2C30" stroke-width="6"/>`],
    favor: ['#2BB5A5', (id) => `
<path d="M24 58 l36 -18 l36 18 v28 h-72 z" fill="#E9DEC6"/><path d="M24 58 l36 20 l36 -20" fill="#D8CBAE"/>
<circle cx="60" cy="60" r="10" fill="#C3202F"/><text x="60" y="64.5" font-size="12" font-weight="900" font-family="sans-serif" fill="#F4EEDF" stroke="none" text-anchor="middle">₽</text>
${coin(22, 84)}${coin(32, 88, 5)}${coin(96, 86, 6)}
<path d="M86 40 q10 -14 20 -6 q4 6 -2 10 l-14 6 z" fill="#2A2C30"/>
${miniCard(92, 26, 16, 22, 18, '#3E2866')}
${spark(18, 30, 4)}`],
    nope: ['#E0453F', (id) => `
<circle cx="60" cy="50" r="36" fill="#1A0A0A" stroke="#C3202F" stroke-width="5"/>
<path d="M36 26 l48 48" stroke="#C3202F" stroke-width="6"/>
<path d="M44 76 q-6 -18 2 -30 q4 -6 10 -4 v-8 q0 -6 5 -6 q5 0 5 6 v6 q0 -8 5 -8 q5 0 5 8 v6 q0 -6 5 -6 q5 0 5 6 v14 q0 18 -16 24 z" fill="#2A2C30"/>
<ellipse cx="62" cy="62" rx="7" ry="5" fill="#E8A0A8" stroke="none"/><circle cx="52" cy="50" r="2.6" fill="#E8A0A8" stroke="none"/><circle cx="60" cy="47" r="2.6" fill="#E8A0A8" stroke="none"/><circle cx="68" cy="47" r="2.6" fill="#E8A0A8" stroke="none"/><circle cx="76" cy="50" r="2.6" fill="#E8A0A8" stroke="none"/>`],
    c1: ['#7FB86A', (id) => cat(58, 86, 0.78, { fur: '#E8DCC0', belly: '#F6EEDC', mood: 'angry', extra: `
<path d="M-24 -56 q24 -12 48 0 v6 h-48 z" fill="#1E3A1E"/><path d="M-24 -50 h56" stroke-width="3"/>
<path d="M26 -10 l26 -40" stroke="#8A5A2A" stroke-width="7"/><path d="M48 -46 l8 -10" stroke="#5A3A1A" stroke-width="9"/>
<text x="-22" y="-60" font-size="7" font-weight="900" font-family="sans-serif" fill="#F0D48A" stroke="none">ДОЛГ</text>` })],
    c2: ['#8A7AB8', (id) => `
<path d="M80 36 l14 -6 l12 14 l-6 40 h-14 l-10 -36 z" fill="#3A2414"/><path d="M90 48 h10 M95 42 v14" stroke="#D9B65E" stroke-width="2"/>
${cat(48, 86, 0.74, { fur: '#16181B', belly: '#2A2C30', eye: '#9FE0BC', extra: `
<rect x="-14" y="-82" width="28" height="22" rx="2" fill="#0A0A0C"/><path d="M-22 -60 h44" stroke-width="3.5"/><rect x="-14" y="-68" width="28" height="4" fill="#6A1C22" stroke="none"/>
<path d="M-6 -2 l6 -8 l6 8 z" fill="#F4EEDF" stroke-width="1.4"/>` })}`],
    c3: ['#D98A3A', (id) => cat(58, 86, 0.78, { fur: '#D98A3A', belly: '#F0C890', extra: `
<circle cx="-9" cy="-30" r="8" fill="none" stroke-width="2.2"/><circle cx="9" cy="-30" r="8" fill="none" stroke-width="2.2"/><path d="M-1 -30 h2" stroke-width="2"/>
<rect x="-34" y="-12" width="26" height="20" rx="2" fill="#3A1E0E"/>${[0, 1, 2].map((r) => `<path d="M-32 ${-7 + r * 6} h22" stroke="#B88E3C" stroke-width="1"/>${[0, 1, 2].map((c) => `<circle cx="${-28 + c * 6 + r * 2}" cy="${-7 + r * 6}" r="2" fill="#E9DEC6" stroke-width="0.8"/>`).join('')}`).join('')}` })],
    c4: ['#8A93A0', (id) => cat(58, 86, 0.78, { fur: '#8A93A0', belly: '#C9CED6', mood: 'angry', extra: `
<path d="M-26 -50 q-8 8 -6 20 q-6 6 0 12 M26 -50 q8 8 6 20 q6 6 0 12" fill="#F4EEDF" stroke-width="1.6"/>
<path d="M-24 -50 q24 -16 48 0" fill="#F4EEDF"/>
<rect x="22" y="-26" width="22" height="9" rx="2" fill="#5A3A1A" transform="rotate(-30 33 -21)"/><path d="M30 -18 l10 18" stroke="#5A3A1A" stroke-width="4"/>` })],
    c5: ['#E06A3A', (id) => cat(58, 86, 0.78, { fur: '#F2EEE6', belly: '#FFFFFF', mood: 'smug', extra: `
<path d="M-24 -54 q24 -12 48 0 l-4 -12 q-20 -8 -40 0 z" fill="#FFFFFF"/>
<g transform="translate(24 -10) rotate(-30)"><path d="M-6 -22 q6 -4 12 0 l4 32 q-10 6 -20 0 z" fill="#E9C38A"/><path d="M-4 -16 h8 M-5 -8 h10 M-5 0 h10" stroke="#6A8A2A" stroke-width="2"/><path d="M-2 -20 q2 -6 6 0" stroke="#C3202F" stroke-width="2" fill="none"/></g>` })],
  };

  // ================= Подземелье =================
  const MON = '#C0392B'; const UND = '#5FA35A';
  const DUN = {
    // ----- monsters -----
    m1: [MON, () => `<ellipse cx="60" cy="62" rx="26" ry="16" fill="#6A3A1A"/><path d="M60 46 v32" stroke-width="1.4"/><circle cx="60" cy="44" r="9" fill="#5A2E12"/><path d="M54 38 q-18 -24 -36 -20 M66 38 q18 -24 36 -20" fill="none" stroke-width="1.6"/><path d="M38 56 l-14 -8 M36 64 l-16 0 M38 72 l-14 8 M82 56 l14 -8 M84 64 l16 0 M82 72 l14 8" stroke-width="2"/>${eyes2(60, 43, 4, 2)}<path d="M50 96 h20" stroke="#F0D48A" stroke-width="1.2" opacity=".5"/><text x="60" y="20" font-size="7" font-family="sans-serif" fill="#F0D48A" stroke="none" text-anchor="middle">с 1987 г.</text>`],
    m2: [UND, () => `<path d="M34 46 h44 v32 q0 10 -10 10 h-24 q-10 0 -10 -10 z" fill="#E9DEC6"/><path d="M78 52 q14 0 14 12 q0 12 -14 12" fill="none" stroke-width="4"/><path d="M34 46 q6 -14 12 -2 q4 -16 12 -4 q6 -14 12 0 q6 -10 8 6 z" fill="#7FB86A"/><circle cx="46" cy="40" r="5" fill="#9FD88A"/><circle cx="64" cy="36" r="6" fill="#6FA85A"/>${eyes2(55, 58, 6, 2.5, '#1A1A1A')}<path d="M50 66 q5 3 10 0" fill="none" stroke-width="1.6"/><text x="56" y="82" font-size="6" font-family="sans-serif" fill="#8A7A60" stroke="none" text-anchor="middle">ЛУЧШИЙ ПАПА</text>`],
    m3: [MON, () => `${body(52, 54, 44, 36, '#3A5A8A')}${face(52, 40, 13, '#E8C49A', { brows: 1, mouth: 'grin' })}<path d="M40 30 q12 -10 24 0" fill="#8A5A2A"/><rect x="66" y="52" width="26" height="12" rx="3" fill="#E0A043"/><rect x="88" y="56" width="16" height="4" fill="#8A8F98"/><rect x="70" y="62" width="8" height="14" rx="2" fill="#26282C"/><path d="M106 52 l6 -4 M108 58 h7 M106 64 l6 4" stroke="#FFD866" stroke-width="2"/><text x="20" y="24" font-size="9" font-weight="900" font-family="sans-serif" fill="#F0D48A" stroke="none">8:00</text>`],
    m4: [MON, () => `<ellipse cx="58" cy="62" rx="24" ry="18" fill="#7A8290"/><circle cx="74" cy="42" r="12" fill="#8A93A0"/><path d="M74 48 q6 -2 6 4" fill="#5A8A5A" stroke="none"/><path d="M84 42 l12 3 l-12 3 z" fill="#E0A043"/><circle cx="76" cy="39" r="3" fill="#FF7A3A"/><path d="M40 56 q-16 -10 -22 4 q10 6 22 4" fill="#5A6270"/><path d="M52 78 v10 l-4 2 M64 78 v10 l4 2" stroke="#E0A043" stroke-width="2.4"/><g transform="translate(90 70) rotate(-20)"><path d="M-5 -14 q5 -3 10 0 l3 22 q-8 4 -16 0 z" fill="#E9C38A"/></g>`],
    m5: [MON, () => `${body(60, 56, 56, 34, '#5A3A6A')}${face(60, 44, 15, '#E8C49A', { brows: 1, mouth: 'sad' })}<path d="M42 44 q0 -24 18 -24 q18 0 18 24 q-6 -14 -18 -14 q-12 0 -18 14 z" fill="#C3202F"/><path d="M58 60 l2 6 l2 -6" stroke-width="1.4"/><rect x="18" y="72" width="30" height="6" fill="#5A3A1A"/><path d="M22 78 v10 M44 78 v10" stroke-width="3"/><circle cx="90" cy="70" r="6" fill="#F0D48A" stroke-width="1.4"/><path d="M86 66 h8" stroke-width="1"/>`],
    m6: [MON, () => `<rect x="38" y="30" width="44" height="36" rx="3" fill="#C9A06A"/><path d="M38 42 h44 M60 30 v12" stroke-width="1.6"/>${eyes2(60, 52, 9, 3.2, '#1A1A1A')}<path d="M52 60 q8 -4 16 0" fill="none" stroke-width="1.8"/><path d="M48 66 l-6 18 M72 66 l6 18" stroke-width="3.5"/><circle cx="34" cy="86" r="5" fill="#26282C"/><circle cx="86" cy="86" r="5" fill="#26282C"/><path d="M22 86 h76" stroke-width="2"/><text x="60" y="22" font-size="7" font-family="sans-serif" fill="#F0D48A" stroke="none" text-anchor="middle">«5 минут!»</text>`],
    m7: [UND, () => `<rect x="24" y="12" width="72" height="80" rx="3" fill="#4A2C16"/><rect x="28" y="16" width="64" height="72" fill="#0A0605"/><path d="M28 16 l-14 6 v70 l14 -4 z" fill="#5A3A20"/><circle cx="60" cy="34" r="11" fill="#EFE6D2"/>${eyes2(60, 33, 4, 2.6, '#0A0605')}<path d="M56 41 h8" stroke="#0A0605" stroke-width="1.4"/><path d="M60 46 v24" stroke="#EFE6D2" stroke-width="3"/><path d="M50 50 h20 M50 56 h20 M52 62 h16" stroke="#EFE6D2" stroke-width="2.2"/><path d="M60 52 l-18 10 M60 52 l18 -14 l6 -6" stroke="#EFE6D2" stroke-width="2.4"/><path d="M60 70 l-6 16 M60 70 l6 16" stroke="#EFE6D2" stroke-width="2.6"/>`],
    m8: [MON, () => `<rect x="38" y="20" width="44" height="70" rx="7" fill="#1A1C20"/><rect x="42" y="26" width="36" height="54" rx="2" fill="#2F6BC4"/>${face(60, 46, 11, '#E8C49A', { mouth: 'grin' })}<path d="M56 58 l4 14 l4 -14 z" fill="#C3202F"/><path d="M50 30 q10 -6 20 0" fill="#3A2414"/><path d="M90 26 q8 4 6 12 M96 20 q12 8 8 22" fill="none" stroke="#FFD866" stroke-width="2"/><text x="60" y="78" font-size="6" font-family="sans-serif" fill="#F4EEDF" stroke="none" text-anchor="middle">ОДОБРЕНО</text>`],
    m9: [UND, () => `${body(60, 54, 50, 38, '#3A3C44')}<path d="M56 54 l4 18 l4 -18 z" fill="#C3202F"/>${face(60, 40, 15, '#8ABF7A', { mouth: 'o' })}<path d="M50 38 l2 -2 M68 38 l2 -2" stroke="#C3202F" stroke-width="1.4"/><path d="M38 62 l-16 -6 M82 62 l16 -6" stroke="#8ABF7A" stroke-width="7"/><rect x="88" y="44" width="18" height="12" rx="2" fill="#EFE6D2" transform="rotate(10 97 50)"/><text x="97" y="52" font-size="5" font-family="sans-serif" fill="#1A1612" stroke="none" text-anchor="middle">ОТЧЁТ</text>`],
    m10: [MON, () => `<rect x="34" y="14" width="40" height="76" rx="7" fill="#1A1C20"/><rect x="38" y="20" width="32" height="62" rx="2" fill="#0E1A14"/>${[0, 1, 2, 3].map((k) => `<rect x="${k % 2 ? 46 : 41}" y="${26 + k * 13}" width="22" height="9" rx="3" fill="${k % 2 ? '#2F6BC4' : '#3A3C44'}" stroke-width="1"/>`).join('')}<circle cx="78" cy="22" r="13" fill="#C3202F"/><text x="78" y="26.5" font-size="11" font-weight="900" font-family="sans-serif" fill="#fff" stroke="none" text-anchor="middle">348</text><path d="M84 54 q14 -2 20 8 M86 64 q12 2 16 12" fill="none" stroke="#FFD866" stroke-width="2"/>`],
    m11: [UND, () => `<path d="M36 86 q0 -60 24 -62 q24 2 24 62 l-6 -6 l-6 6 l-6 -6 l-6 6 l-6 -6 l-6 6 l-6 -6 z" fill="#DDE8F0" fill-opacity=".9"/>${eyes2(60, 46, 8, 4, '#1A2A3A')}<ellipse cx="60" cy="60" rx="5" ry="6" fill="#1A2A3A"/><rect x="80" y="40" width="20" height="32" rx="4" fill="#1A1C20"/><path d="M90 52 q-5 -5 -5 0 q0 4 5 8 q5 -4 5 -8 q0 -5 -5 0 z" fill="#E06A72" stroke="none"/><path d="M24 30 l4 4 M20 44 l6 0" stroke="#BFE3FF" stroke-width="2"/>`],
    m12: [MON, () => `<rect x="16" y="64" width="88" height="26" rx="2" fill="#5A3A1A"/>${body(60, 34, 46, 32, '#2A3A5A')}${face(60, 34, 13, '#E8C49A', { brows: 1 })}<path d="M44 26 q16 -14 32 0 v-4 h-32 z" fill="#1A2A44"/><rect x="44" y="20" width="32" height="6" fill="#1A2A44"/><circle cx="60" cy="23" r="2.5" fill="#E2B85A"/><rect x="30" y="68" width="60" height="14" rx="2" fill="#E9DEC6"/><text x="60" y="78" font-size="6.5" font-weight="900" font-family="sans-serif" fill="#C3202F" stroke="none" text-anchor="middle">НЕ ПОЛОЖЕНО</text>`],
    m13: [UND, () => `${body(54, 52, 50, 38, '#2A1A3A')}${face(54, 40, 14, '#D8C8B0', { brows: 1, mouth: 'grin' })}<path d="M38 38 q0 -22 16 -22 q16 0 16 22 l-4 -10 q-12 -8 -24 0 z" fill="#8A8F98"/><circle cx="54" cy="20" r="6" fill="#8A8F98"/><path d="M86 18 v72" stroke="#5A3A1A" stroke-width="4"/><circle cx="86" cy="16" r="7" fill="#EFE6D2"/>${eyes2(86, 15, 2.4, 1.6, '#1A1A1A')}<circle cx="86" cy="16" r="12" fill="#7FFF9A" opacity=".2" stroke="none"/><path d="M16 84 l8 -6 l4 8 M100 86 l6 -8" stroke="#7FFF9A" stroke-width="2"/>`],
    m14: [MON, () => `${body(60, 54, 52, 36, '#1A1A1E')}<path d="M40 60 h40 M44 70 h32" stroke="#EFE6D2" stroke-width="2.4"/><path d="M38 62 v24 M82 62 v24" stroke="#EFE6D2" stroke-width="2"/>${face(60, 40, 14, '#E8C49A', { brows: 1 })}<path d="M44 34 q16 -18 32 0 l-2 -4 h-28 z" fill="#1A1A1E"/><path d="M44 30 q16 -8 32 0 l10 2 q-8 4 -14 0" fill="#26282C"/><path d="M56 50 l2 1 M64 50 l-2 1" stroke-width="1.4"/><circle cx="66" cy="49" r="1.2" fill="#1A1A1A" stroke="none"/><circle cx="92" cy="78" r="2" fill="#2A2A2A" stroke="none"/><circle cx="96" cy="82" r="1.6" fill="#2A2A2A" stroke="none"/>`],
    m15: [MON, () => `<path d="M36 90 q-2 -54 24 -60 q26 6 24 60 z" fill="#0E0E12"/><circle cx="60" cy="36" r="14" fill="#0E0E12"/>${eyes2(60, 36, 5, 2.4, '#FF3A3A')}<path d="M84 32 l16 -14" stroke="#5A3A1A" stroke-width="5"/><path d="M98 20 l8 -8" stroke="#3A2414" stroke-width="8"/><rect x="18" y="54" width="22" height="28" rx="2" fill="#E9DEC6" transform="rotate(-10 29 68)"/><text x="29" y="70" font-size="6" font-weight="900" font-family="sans-serif" fill="#C3202F" stroke="none" text-anchor="middle" transform="rotate(-10 29 68)">ДОЛГ</text>`],
    m16: [UND, () => `<path d="M30 40 l-18 22 l20 -6 l8 28 h40 l8 -28 l20 6 l-18 -22 z" fill="#2A0A12"/>${body(60, 52, 40, 38, '#1A1A1E')}${face(60, 38, 14, '#D8D0E0', { brows: 1, mouth: 'grin' })}<path d="M54 46 v4 M66 46 v4" stroke="#fff" stroke-width="2"/><path d="M46 30 q14 -18 28 0 l-14 4 z" fill="#1A1A1E"/><rect x="82" y="58" width="12" height="20" rx="2" fill="#3A8A2A"/><path d="M84 64 h8" stroke="#FFE07A" stroke-width="2"/><text x="88" y="75" font-size="4" font-family="sans-serif" fill="#fff" stroke="none" text-anchor="middle">BTC</text>`],
    m17: [MON, () => `<path d="M24 56 h72 v30 h-72 z" fill="#6A3A1A"/><path d="M24 56 q36 -40 72 0" fill="#7A4A22"/><path d="M28 58 l8 8 l8 -8 l8 8 l8 -8 l8 8 l8 -8 l8 8 l8 -8" fill="#F4EEDF" stroke-width="1.4"/><path d="M24 70 h72" stroke="#D9B65E" stroke-width="3"/>${eyes2(60, 46, 12, 4, '#FFE07A')}<path d="M52 20 l8 -8 l8 8 v10 h-16 z" fill="#E9DEC6"/><path d="M58 30 v-6 h4 v6" fill="#5A3A1A"/><text x="60" y="84" font-size="8" font-weight="900" font-family="sans-serif" fill="#F0D48A" stroke="none" text-anchor="middle">30 ЛЕТ</text>`],
    m18: [UND, () => `${body(48, 52, 44, 38, '#1A1A1E')}${face(48, 40, 13, '#D8D0C0', { mouth: 'grin' })}<rect x="38" y="16" width="20" height="16" fill="#0A0A0C"/><path d="M32 32 h32" stroke-width="3"/><path d="M78 30 l14 -6 l12 14 l-6 48 h-14 l-10 -40 z" fill="#4A2C16"/><path d="M66 60 q10 -6 20 4" fill="none" stroke="#E0A043" stroke-width="3"/><path d="M68 58 v4 M73 57 v4 M78 58 v4" stroke="#1A1A1A" stroke-width="1"/>`],
    m19: [MON, () => `${body(54, 56, 48, 34, '#26282C')}<path d="M50 56 l4 16 l4 -16 z" fill="#C3202F"/>${face(54, 42, 14, '#E8C49A', { mouth: 'grin', brows: 1 })}<path d="M40 34 q14 -12 28 0" fill="#5A5E66"/><circle cx="92" cy="34" r="16" fill="#EFE6D2"/><path d="M92 34 v-11 M92 34 l8 0" stroke-width="2.4"/><text x="92" y="58" font-size="9" font-weight="900" font-family="sans-serif" fill="#F0D48A" stroke="none" text-anchor="middle">18:05</text><text x="22" y="22" font-size="8" font-weight="900" font-family="sans-serif" fill="#F0D48A" stroke="none">ПТ</text>`],
    m20: [UND, () => `<path d="M34 90 q-2 -50 26 -54 q28 4 26 54 z" fill="#2A1A44"/><circle cx="60" cy="34" r="14" fill="#EFE6D2"/>${eyes2(60, 33, 5, 3, '#7FFF9A')}<path d="M54 42 h12" stroke-width="1.4"/><path d="M48 20 l4 -10 l4 6 l4 -8 l4 8 l4 -6 l4 10 z" fill="${'#E2B85A'}"/><rect x="72" y="60" width="26" height="20" rx="3" fill="#1A1C20"/><rect x="75" y="63" width="20" height="5" fill="#5BFF8A" stroke="none"/>${[0, 1, 2].map((c) => `<rect x="${75 + c * 7}" y="71" width="5" height="5" fill="#5A5E66" stroke="none"/>`).join('')}<circle cx="60" cy="34" r="22" fill="#7FFF9A" opacity=".12" stroke="none"/>`],
    m21: [MON, () => `<circle cx="96" cy="18" r="10" fill="#F4EEDF" stroke="none" opacity=".9"/><path d="M16 50 h70 q14 0 16 14 v14 h-86 z" fill="#E9DEC6"/><rect x="22" y="54" width="14" height="12" fill="#2A3A5A"/><rect x="40" y="54" width="14" height="12" fill="#2A3A5A"/><rect x="58" y="54" width="14" height="12" fill="#2A3A5A"/><path d="M76 54 h10 q6 0 8 10 h-18 z" fill="#2A3A5A"/><path d="M84 50 l4 -12 l6 12 M68 50 l4 -12 l6 12" fill="#5A5E66"/><circle cx="34" cy="80" r="8" fill="#1A1A1E"/><circle cx="84" cy="80" r="8" fill="#1A1A1E"/>${eyes2(90, 64, 0, 3, '#FFE07A')}<path d="M98 72 l4 4 l-4 0" fill="#F4EEDF" stroke-width="1.2"/><text x="40" y="44" font-size="8" font-weight="900" font-family="sans-serif" fill="#F0D48A" stroke="none">№ 666</text>`],
    m22: [MON, () => `${[0, 1, 2, 3, 4].map((k) => `<rect x="${36 + (k % 2) * 4}" y="${26 + k * 12}" width="44" height="13" rx="1" fill="${k % 2 ? '#E9DEC6' : '#D8CBAE'}" transform="rotate(${(k - 2) * 3} 60 50)"/>`).join('')}<rect x="44" y="12" width="32" height="18" rx="2" fill="#E9DEC6"/>${eyes2(60, 21, 7, 3, '#FF3A3A')}<path d="M34 46 l-18 18 l4 4 M86 46 l18 18 l-4 4" stroke="#D8CBAE" stroke-width="7"/><circle cx="60" cy="54" r="8" fill="#C3202F" opacity=".9"/><text x="60" y="57" font-size="7" font-weight="900" font-family="sans-serif" fill="#fff" stroke="none" text-anchor="middle">%</text>`],
    m23: [UND, () => `${body(60, 54, 44, 36, '#D8CBAE')}<path d="M40 60 l40 -4 M40 70 l40 4 M42 80 l36 -4" stroke="#B8A888" stroke-width="2"/><circle cx="60" cy="40" r="14" fill="#D8CBAE"/><path d="M46 36 l28 -4 M46 44 l28 2" stroke="#B8A888" stroke-width="2"/>${eyes2(60, 40, 5, 2.4, '#FFE07A')}<rect x="80" y="56" width="24" height="16" rx="2" fill="#E9DEC6"/><path d="M80 56 l12 9 l12 -9" fill="none" stroke-width="1.4"/><text x="92" y="82" font-size="5" font-family="sans-serif" fill="#F0D48A" stroke="none" text-anchor="middle">ПЕНСИЯ</text><path d="M26 30 l4 -4 M20 40 h6" stroke="#E9DEC6" stroke-width="2"/>`],
    m24: [MON, () => `<rect x="10" y="66" width="70" height="6" fill="#5A3A1A"/><path d="M16 72 v18 M74 72 v18" stroke-width="3"/>${cat(44, 66, 0.55, { fur: '#16181B', mood: 'smug' })}<g transform="translate(92 74) rotate(28)"><rect x="-14" y="-10" width="28" height="18" rx="2" fill="#5A5E66"/><rect x="-12" y="-8" width="24" height="13" fill="#2F6BC4"/></g><path d="M78 56 q6 -6 10 2 M84 48 q8 -4 10 4" fill="none" stroke="#FFD866" stroke-width="2"/>`],
    m25: [MON, () => `${body(60, 54, 50, 36, '#3A3C44')}<path d="M44 64 q16 26 32 0 q-6 22 -16 26 q-10 -4 -16 -26 z" fill="#E9DEC6"/>${face(60, 40, 14, '#E8C49A', {})}<circle cx="55" cy="38" r="5" fill="none" stroke-width="1.6"/><circle cx="65" cy="38" r="5" fill="none" stroke-width="1.6"/><path d="M28 30 q-10 20 4 40 M92 30 q10 20 -4 40" fill="none" stroke="#2FAE6A" stroke-width="3"/><path d="M28 70 l-4 6 M92 70 l4 6" stroke="#2FAE6A" stroke-width="3"/><text x="60" y="20" font-size="8" font-weight="900" font-family="monospace" fill="#5BFF8A" stroke="none" text-anchor="middle">sudo</text>`],
    m26: [MON, () => `<path d="M10 70 h100 v8 q-4 12 -16 12 h-68 q-12 0 -16 -12 z" fill="#E9DEC6"/><path d="M18 78 v12 M102 78 v12" stroke-width="3"/><path d="M30 70 q-8 -30 6 -44 q6 6 -2 20 q-4 12 4 24 M54 70 q-4 -40 12 -52 q8 8 -2 26 q-6 14 0 26 M80 70 q0 -30 16 -36 q4 8 -6 18 q-6 8 -4 18" fill="#2A5A3A"/><circle cx="64" cy="22" r="4" fill="#FFE07A" stroke="none"/><circle cx="36" cy="30" r="3" fill="#FFE07A" stroke="none"/><circle cx="96" cy="38" r="3" fill="#FFE07A" stroke="none"/><path d="M40 70 h50" stroke="#0A1A12" stroke-width="5"/>`],
    m27: [MON, () => `${[0, 1, 2, 3, 4].map((k) => { const x = 18 + k * 21; const y = 50 + (k % 2) * 6; return `${body(x, y, 20, 34, '#26282C')}<circle cx="${x}" cy="${y - 8}" r="8" fill="#E8C49A"/><rect x="${x - 6}" y="${y - 10}" width="12" height="3" fill="#1A1A1A" stroke="none"/><path d="M${x - 1} ${y + 2} l1 8 l1 -8 z" fill="#C3202F" stroke-width="1"/>`; }).join('')}<rect x="38" y="16" width="44" height="14" rx="2" fill="#E9DEC6"/><text x="60" y="26" font-size="7" font-weight="900" font-family="sans-serif" fill="#C3202F" stroke="none" text-anchor="middle">ПРОВЕРКА</text>`],
    m28: [MON, () => `<rect x="52" y="14" width="16" height="40" rx="4" fill="#1A1A1E"/><circle cx="60" cy="22" r="5" fill="#FF3A3A"/><circle cx="60" cy="34" r="5" fill="#5A4A1A"/><circle cx="60" cy="46" r="5" fill="#1A3A1A"/><path d="M48 14 l4 -8 l4 6 l4 -8 l4 8 l4 -6 l4 8" fill="${'#E2B85A'}"/>${[0, 1, 2].map((k) => `<g transform="translate(${22 + k * 38} ${74 + (k % 2) * 6})"><path d="M-14 0 q2 -10 10 -10 h8 q8 0 10 10 z" fill="${['#C3202F', '#2F6BC4', '#E0A043'][k]}"/><rect x="-16" y="0" width="32" height="7" rx="2" fill="${['#C3202F', '#2F6BC4', '#E0A043'][k]}"/><circle cx="-8" cy="8" r="3.5" fill="#1A1A1E"/><circle cx="8" cy="8" r="3.5" fill="#1A1A1E"/></g>`).join('')}<path d="M40 62 q20 -6 40 0" fill="none" stroke="#FF3A3A" stroke-width="1.4" stroke-dasharray="2 3"/>`],
    m29: [UND, () => `<path d="M30 90 q-2 -56 30 -62 q32 6 30 62 z" fill="#0A0A0E"/><circle cx="60" cy="32" r="15" fill="#0A0A0E"/>${eyes2(60, 32, 6, 3, '#B58CFF')}<rect x="38" y="52" width="44" height="30" rx="2" fill="#3A1E0E"/><path d="M60 52 v30" stroke-width="1.6"/>${[0, 1, 2, 3].map((k) => `<path d="M42 ${58 + k * 6} h14 M64 ${58 + k * 6} h14" stroke="#B88E3C" stroke-width="1"/>`).join('')}<circle cx="60" cy="40" r="28" fill="#B58CFF" opacity=".1" stroke="none"/><path d="M16 22 l4 4 M104 24 l-4 4" stroke="#B58CFF" stroke-width="2"/>`],
    m30: [MON, () => `<path d="M14 80 q10 -40 40 -40 h16 q24 0 30 20 l12 -6 l-4 14 q-6 14 -24 12 z" fill="#2A6A3A"/><path d="M40 42 l-6 -14 l10 8 M54 40 l0 -14 l8 12" fill="#1A4A2A"/><path d="M100 54 l10 -2 l-6 8 z" fill="#1A4A2A"/><circle cx="96" cy="56" r="2.5" fill="#FFE07A" stroke="none"/><path d="M110 62 q6 2 8 -2" fill="none" stroke="#FF7A3A" stroke-width="2"/><path d="M26 56 l10 -26 l12 18 z" fill="#3A8A4A"/><path d="M50 44 l6 -10 l8 10 v10 h-14 z" fill="#E9DEC6"/><text x="60" y="88" font-size="7" font-weight="900" font-family="sans-serif" fill="#F0D48A" stroke="none" text-anchor="middle">40% ДОХОДА</text>`],
    // ----- classes -----
    'cls-brute': ['#2F6BC4', () => `${body(60, 50, 60, 40, '#5A3A2A')}<path d="M30 64 q-14 -14 -6 -28 q8 -6 14 2 M90 64 q14 -14 6 -28 q-8 -6 -14 2" fill="#E8C49A"/><circle cx="22" cy="34" r="8" fill="#E8C49A"/><circle cx="98" cy="34" r="8" fill="#E8C49A"/>${face(60, 34, 13, '#E8C49A', { brows: 1 })}<path d="M48 26 q12 -10 24 0" fill="#1A1A1A"/><text x="60" y="80" font-size="10" font-weight="900" font-family="sans-serif" fill="#F0D48A" stroke="none" text-anchor="middle">+1</text>`],
    'cls-thief': ['#2F6BC4', () => `${body(60, 52, 44, 38, '#1A1A1E')}${face(60, 38, 13, '#E8C49A', { mouth: 'grin' })}<rect x="44" y="32" width="32" height="9" rx="4" fill="#1A1A1E"/>${eyes2(60, 36, 6, 2, '#FFE07A')}<path d="M44 30 q16 -14 32 0" fill="#26282C"/><rect x="80" y="54" width="20" height="16" rx="3" fill="#E2B85A"/><text x="90" y="65" font-size="8" font-weight="900" font-family="sans-serif" fill="#3A2414" stroke="none" text-anchor="middle">₽</text><path d="M16 64 h14 M12 72 h16" stroke="#9FC7E8" stroke-width="2"/>`],
    'cls-mage': ['#2F6BC4', () => `${body(56, 48, 48, 42, '#3A2866')}${face(56, 44, 12, '#E8C49A', {})}<path d="M44 52 q12 22 24 0 q-2 20 -12 26 q-10 -6 -12 -26 z" fill="#EFE6D2"/><path d="M40 38 l16 -32 l16 32 z" fill="#3A2866"/>${spark(52, 22, 4, '#F0D48A')}<path d="M90 14 v74" stroke="#5A3A1A" stroke-width="4"/><circle cx="90" cy="12" r="7" fill="url(#orbX)"/><circle cx="90" cy="12" r="7" fill="#B58CFF"/>${spark(90, 12, 10, 'rgba(240,212,138,.7)')}`],
    'cls-healer': ['#2F6BC4', () => `<path d="M40 64 h40 l-6 22 h-28 z" fill="#8A6A4A"/><ellipse cx="60" cy="64" rx="20" ry="5" fill="#5A4A3A"/><path d="M60 62 l20 -30" stroke="#8A6A4A" stroke-width="5"/><path d="M40 40 q-14 -20 0 -28 q14 8 0 28 M28 52 q-18 -6 -14 -22 q16 -2 14 22 M78 26 q8 -18 22 -12 q-4 16 -22 12" fill="#5FA35A"/><path d="M40 40 v-24 M28 52 l-10 -18 M78 26 l18 -8" stroke="#2A5A2A" stroke-width="1.4"/>${spark(96, 50, 5, '#9FE0BC')}`],
    // ----- monster boosts -----
    'mod-big': ['#E0A043', () => `<path d="M24 80 q-6 -20 10 -34 q-2 -14 12 -20 q16 -4 22 8 q14 -4 22 6 q10 12 -2 22 l-12 4 q-6 18 -26 16 z" fill="#C0392B"/><path d="M44 44 q8 8 20 2 M40 62 q10 6 22 0" fill="none" stroke-width="1.8"/>`],
    'mod-hungry': ['#E0A043', () => `<path d="M16 40 q44 -40 88 0 l-8 10 l-8 -8 l-8 8 l-8 -8 l-8 8 l-8 -8 l-8 8 l-8 -8 l-8 8 l-8 -8 z" fill="#7A1A16"/><path d="M16 60 q44 40 88 0 l-8 -10 l-8 8 l-8 -8 l-8 8 l-8 -8 l-8 8 l-8 -8 l-8 8 l-8 -8 l-8 8 z" fill="#7A1A16"/><path d="M24 40 l6 10 l6 -8 l6 8 l6 -8 l6 8 l6 -8 l6 8 l6 -8 l6 8 l6 -10" fill="#F4EEDF" stroke-width="1.2"/><ellipse cx="60" cy="52" rx="30" ry="6" fill="#2A0404"/>`],
    'mod-baby': ['#E0A043', () => `<path d="M34 46 q0 -30 26 -30 q26 0 26 30 z" fill="#F4C8D8"/><circle cx="60" cy="54" r="22" fill="#E8C49A"/>${eyes2(60, 50, 8, 3)}<circle cx="60" cy="64" r="7" fill="#7FB0E8"/><circle cx="60" cy="64" r="3" fill="#E9DEC6"/><path d="M38 46 q22 10 44 0" fill="none" stroke-width="2"/>`],
    'mod-sleepy': ['#E0A043', () => `<path d="M38 30 l22 -20 l22 20 z" fill="#E06A72"/><circle cx="60" cy="10" r="4" fill="#F0D48A"/><circle cx="60" cy="50" r="20" fill="#8ABF7A"/><path d="M50 48 q4 -3 8 0 M62 48 q4 -3 8 0" fill="none" stroke-width="2"/><path d="M52 60 q8 4 16 0" fill="none" stroke-width="1.8"/>${bottle(92, 70, 0.6, '#2A6A3A', '#E9DEC6')}<text x="22" y="34" font-size="10" font-weight="900" font-family="sans-serif" fill="#BFE3FF" stroke="none">z z</text>`],
    wander: ['#C0397A', () => `<rect x="30" y="14" width="60" height="76" rx="3" fill="#3A2414"/><rect x="36" y="20" width="48" height="70" fill="#0A0605"/><path d="M84 20 l14 6 v64 l-14 -6 z" fill="#5A3A20"/>${eyes2(52, 46, 4, 3.5, '#FFE07A')}${eyes2(70, 60, 4, 2.6, '#FF5A5A')}<path d="M18 84 q4 -4 8 0 M14 92 q4 -4 8 0 M100 88 q4 -4 8 0" fill="none" stroke="#C0397A" stroke-width="3"/>`],
    // ----- curses -----
    'cu-tax': ['#8A4AE0', () => `<rect x="30" y="16" width="52" height="70" rx="2" fill="#E9DEC6" transform="rotate(-6 56 51)"/>${[0, 1, 2, 3, 4].map((k) => `<path d="M38 ${30 + k * 9} h${30 - (k % 2) * 8}" stroke="#B8A888" stroke-width="2" transform="rotate(-6 56 51)"/>`).join('')}<circle cx="74" cy="66" r="18" fill="none" stroke="#C3202F" stroke-width="4"/><text x="74" y="72" font-size="16" font-weight="900" font-family="sans-serif" fill="#C3202F" stroke="none" text-anchor="middle">%</text><path d="M88 24 l10 -6 M92 34 l10 0" stroke="#B58CFF" stroke-width="2"/>`],
    'cu-ex': ['#8A4AE0', () => `<circle cx="60" cy="28" r="14" fill="#C9A06A"/><path d="M60 42 v30 M42 52 h36 M60 72 l-12 16 M60 72 l12 16" stroke="#C9A06A" stroke-width="10"/>${eyes2(60, 26, 5, 2, INK)}<path d="M52 30 l4 -4 M64 30 l4 -4" stroke-width="1"/><path d="M72 22 l24 -14 M70 52 l26 -4 M58 64 l20 22" stroke="#B8B8C0" stroke-width="2"/><circle cx="96" cy="8" r="3" fill="#C3202F"/><circle cx="96" cy="48" r="3" fill="#C3202F"/><circle cx="78" cy="86" r="3" fill="#C3202F"/><path d="M46 20 q-4 -10 6 -12" fill="none" stroke="#E06A72" stroke-width="2"/>`],
    'cu-crisis': ['#8A4AE0', () => `<rect x="16" y="16" width="88" height="66" rx="3" fill="#0E1A14"/><path d="M22 76 h80 M22 22 v54" stroke="#5A5E66" stroke-width="1.4"/><path d="M24 30 l16 10 l12 -6 l14 18 l10 -4 l20 26" fill="none" stroke="#FF3A3A" stroke-width="3.5"/><path d="M96 74 l2 -10 l-10 2" fill="none" stroke="#FF3A3A" stroke-width="3"/>${coin(30, 90, 5)}${coin(88, 92, 4)}`],
    'cu-flood': ['#8A4AE0', () => `<rect x="10" y="8" width="100" height="14" fill="#E9DEC6"/><path d="M30 22 q4 14 10 6 M60 22 q-6 18 4 12 M86 22 q6 10 0 16" fill="#9FC7E8" stroke="none"/>${[[34, 44], [62, 52], [88, 42], [46, 66], [76, 70]].map(([x, y]) => `<path d="M${x} ${y - 7} q6 8 0 12 q-6 -4 0 -12 z" fill="#5A92E6"/>`).join('')}<path d="M10 84 q12 -6 24 0 t24 0 t24 0 t28 0 v12 h-100 z" fill="#2F6BC4"/>`],
    'cu-shoes': ['#8A4AE0', () => `<ellipse cx="60" cy="84" rx="44" ry="6" fill="#3A5A8A" stroke="none" opacity=".4"/><path d="M26 60 q-4 -16 12 -16 q16 0 14 16 v4 h-26 z" fill="#E06A72" opacity=".35" stroke-dasharray="3 3"/><path d="M66 60 q-4 -16 12 -16 q16 0 14 16 v4 h-26 z" fill="#E06A72" opacity=".35" stroke-dasharray="3 3"/><text x="60" y="36" font-size="22" font-weight="900" font-family="sans-serif" fill="#F0D48A" stroke="none" text-anchor="middle">?!</text><path d="M84 74 q4 -8 10 -4 q6 4 2 10 M96 84 q4 -6 8 -2" fill="none" stroke="#C9A06A" stroke-width="2"/>`],
    'cu-hangover': ['#8A4AE0', () => `${face(60, 52, 24, '#B8D8A0', { mouth: 'sad' })}<path d="M44 46 l8 4 M76 46 l-8 4" stroke-width="2"/><path d="M38 34 q22 -20 44 0 v-6 q-22 -14 -44 0 z" fill="#7FB0E8"/><rect x="48" y="16" width="24" height="14" rx="4" fill="#7FB0E8"/><path d="M84 22 l6 -6 M90 30 l8 -2 M86 38 l8 4" stroke="#FFD866" stroke-width="2"/>${bottle(22, 78, 0.5, '#2A6A3A', '')}`],
    // ----- gear -----
    'g-helmet': ['#C9A06A', () => `<path d="M24 66 q0 -40 36 -40 q36 0 36 40 z" fill="#E0B020"/><path d="M60 26 v40 M42 30 q-6 16 -4 36 M78 30 q6 16 4 36" stroke-width="2"/><path d="M14 66 h92 v8 h-92 z" fill="#C89A10"/><circle cx="60" cy="40" r="6" fill="#FFF2B0"/>`],
    'g-foil': ['#C9A06A', () => `<path d="M30 70 l30 -54 l30 54 z" fill="#C9CED6"/><path d="M38 56 l12 -6 l6 10 l10 -14 l8 12 l8 -4" fill="none" stroke="#fff" stroke-width="1.6" opacity=".8"/><path d="M30 70 h60" stroke-width="3"/><path d="M60 16 l0 -8" stroke-width="2"/><circle cx="60" cy="8" r="2.5" fill="#FFE07A"/><path d="M20 24 q8 -6 14 0 M86 24 q8 -6 14 0" fill="none" stroke="#9FC7E8" stroke-width="2"/>`],
    'g-crown': ['#C9A06A', () => `<path d="M24 74 l-4 -40 l20 16 l20 -26 l20 26 l20 -16 l-4 40 z" fill="#F0D48A"/><path d="M24 74 h72" stroke-width="3"/><circle cx="60" cy="56" r="5" fill="#C3202F"/><circle cx="40" cy="60" r="3.5" fill="#2F6BC4"/><circle cx="80" cy="60" r="3.5" fill="#2FAE6A"/><text x="60" y="88" font-size="7" font-family="sans-serif" fill="#C9B590" stroke="none" text-anchor="middle">картон, 1 шт.</text>`],
    'g-jacket': ['#C9A06A', () => `<path d="M30 30 q30 -14 60 0 l16 22 l-10 8 l-8 -10 v38 h-56 v-38 l-8 10 l-10 -8 z" fill="#2A3A5A"/>${[0, 1, 2, 3].map((k) => `<path d="M38 ${42 + k * 11} h44" stroke-width="1.6"/>`).join('')}<path d="M60 26 v62" stroke-width="2"/><path d="M48 24 q12 10 24 0" fill="#8A7A60"/>`],
    'g-vest': ['#C9A06A', () => `<path d="M34 20 h14 q4 10 12 10 q8 0 12 -10 h14 v68 h-52 z" fill="#3A4A2A"/><rect x="40" y="46" width="16" height="12" rx="2" fill="#2A3A1A"/><rect x="64" y="46" width="16" height="12" rx="2" fill="#2A3A1A"/><rect x="40" y="64" width="40" height="10" rx="2" fill="#2A3A1A"/><path d="M34 40 h52" stroke-width="2"/>`],
    'g-robe': ['#C9A06A', () => `<path d="M38 18 q22 -8 44 0 l10 70 h-64 z" fill="#3A2866"/><path d="M60 22 v66" stroke="#F0D48A" stroke-width="2"/>${spark(46, 46, 5, '#F0D48A')}${spark(74, 62, 4, '#F0D48A')}${spark(50, 74, 3, '#F0D48A')}<path d="M40 24 l-14 22 l10 4 M80 24 l14 22 l-10 4" fill="#3A2866"/><text x="60" y="96" font-size="6" font-family="sans-serif" fill="#C9B590" stroke="none" text-anchor="middle">«Я у мамы колдун»</text>`],
    'g-tracksuit': ['#C9A06A', () => `<path d="M30 28 q30 -12 60 0 l16 24 l-10 8 l-10 -12 v40 h-52 v-40 l-10 12 l-10 -8 z" fill="#1A1A1E"/><path d="M28 32 l-14 22 M32 30 l-14 22 M88 30 l14 22 M92 32 l14 22" stroke="#EFE6D2" stroke-width="2"/><path d="M60 24 v64" stroke="#E2B85A" stroke-width="2"/><path d="M48 22 q12 8 24 0" fill="#1A1A1E"/>`],
    'g-valenki': ['#C9A06A', () => `<path d="M24 18 h22 v54 q0 10 10 10 h4 v8 h-40 q-6 0 -6 -10 z" fill="#8A8F98"/><path d="M66 18 h22 v54 q0 10 10 10 h4 v8 h-40 q-6 0 -6 -10 z" fill="#7A7F88"/><path d="M24 26 h22 M66 26 h22" stroke="#C3202F" stroke-width="3"/><path d="M104 56 l8 -2 M104 64 h10" stroke="#9FE0BC" stroke-width="2"/>`],
    'g-boots': ['#C9A06A', () => `<path d="M26 16 h22 v56 q14 2 16 12 v6 h-44 v-20 z" fill="#2A2018"/><path d="M68 16 h22 v56 q14 2 16 12 v6 h-44 v-20 z" fill="#2A2018"/><path d="M26 84 h38 M68 84 h38" stroke="#5A4A3A" stroke-width="3"/><path d="M30 30 h14 M72 30 h14" stroke="#4A3A2A" stroke-width="2"/>`],
    'g-slippers': ['#C9A06A', () => `<path d="M14 70 q0 -16 20 -16 h14 q12 0 12 16 q0 10 -20 10 h-12 q-14 0 -14 -10 z" fill="#E06A9A"/><path d="M62 70 q0 -16 20 -16 h14 q12 0 12 16 q0 10 -20 10 h-12 q-14 0 -14 -10 z" fill="#E06A9A"/><circle cx="34" cy="52" r="8" fill="#F4C8D8"/><circle cx="82" cy="52" r="8" fill="#F4C8D8"/><path d="M20 30 l6 6 M60 22 v8 M100 30 l-6 6" stroke="#9FE0BC" stroke-width="2"/>`],
    'g-pan': ['#C9A06A', () => `<ellipse cx="50" cy="56" rx="32" ry="26" fill="#26282C"/><ellipse cx="50" cy="56" rx="24" ry="18" fill="#3A3C42"/><path d="M80 50 l30 -16 l4 6 l-30 18 z" fill="#5A3A1A"/><ellipse cx="42" cy="48" rx="8" ry="4" fill="#fff" opacity=".14" stroke="none"/>${spark(26, 22, 5)}`],
    'g-rebar': ['#C9A06A', () => `<path d="M20 84 l80 -70" stroke="#7A4A2A" stroke-width="9"/><path d="M20 84 l80 -70" stroke="#A86A3A" stroke-width="9" stroke-dasharray="3 5" stroke-linecap="butt"/><path d="M96 10 l10 -6" stroke-width="2"/>`],
    'g-stool': ['#C9A06A', () => `<ellipse cx="60" cy="34" rx="34" ry="10" fill="#A86A3A"/><path d="M34 40 l-8 48 M86 40 l8 48 M48 42 l-2 44 M72 42 l2 44" stroke="#7A4A2A" stroke-width="5"/><path d="M30 70 h60" stroke="#7A4A2A" stroke-width="3"/><circle cx="60" cy="32" r="5" fill="#5A3A1A" stroke="none"/>`],
    'g-taser': ['#C9A06A', () => `<rect x="22" y="44" width="60" height="22" rx="6" fill="#1A1A1E"/><rect x="40" y="62" width="16" height="26" rx="4" fill="#26282C"/><rect x="82" y="48" width="8" height="14" fill="#5A5E66"/><path d="M90 50 l10 -6 l-4 8 l10 -2 l-8 8 l8 2 l-12 4" fill="none" stroke="#7FD0FF" stroke-width="2.4"/><rect x="28" y="50" width="20" height="5" fill="#FFE07A" stroke="none"/>`],
    'g-abacus': ['#C9A06A', () => `<rect x="18" y="18" width="84" height="64" rx="3" fill="#5A3A1A"/><rect x="24" y="24" width="72" height="52" fill="#2A1A0C"/>${[0, 1, 2, 3, 4].map((r) => `<path d="M24 ${32 + r * 10} h72" stroke="#B88E3C" stroke-width="1.4"/>${[0, 1, 2, 3].map((c) => `<ellipse cx="${30 + c * 8 + (r % 2) * 30}" cy="${32 + r * 10}" rx="3.6" ry="4" fill="#E9DEC6" stroke-width="1"/>`).join('')}`).join('')}`],
    'g-plantain': ['#C9A06A', () => `<path d="M60 90 v-60" stroke="#2A5A2A" stroke-width="3"/><path d="M60 80 q-34 -14 -30 -50 q30 8 30 50 z" fill="#5FA35A"/><path d="M60 70 q34 -14 30 -50 q-30 8 -30 50 z" fill="#6FB86A"/><path d="M60 80 l-22 -40 M60 70 l22 -40" stroke="#2A5A2A" stroke-width="1.4"/>${spark(94, 18, 5, '#9FE0BC')}`],
    'g-shovel': ['#C9A06A', () => `<path d="M30 14 l50 56" stroke="#8A5A2A" stroke-width="6"/><path d="M22 10 h16" stroke="#5A3A1A" stroke-width="6"/><path d="M74 62 l20 -4 l8 18 q2 14 -12 16 l-18 -12 z" fill="#8A8F98"/>`],
    'g-saw': ['#C9A06A', () => `<rect x="14" y="44" width="38" height="26" rx="5" fill="#E06A1A"/><path d="M52 50 h50 q8 0 8 6 q0 6 -8 6 h-50 z" fill="#C9CED6"/>${[0, 1, 2, 3, 4, 5].map((k) => `<path d="M${56 + k * 8} 50 l3 -4 l3 4 M${56 + k * 8} 62 l3 4 l3 -4" stroke-width="1.2" fill="#C9CED6"/>`).join('')}<path d="M20 44 q6 -16 24 -8" fill="none" stroke-width="5"/><text x="33" y="62" font-size="6" font-weight="900" font-family="sans-serif" fill="#1A1A1A" stroke="none" text-anchor="middle">ДРУЖБА</text>`],
    'g-mop': ['#C9A06A', () => `<path d="M30 10 l46 60" stroke="#2F6BC4" stroke-width="5"/><path d="M68 64 l16 -8 l20 30 l-34 6 z" fill="#E9DEC6"/><path d="M74 66 l-2 26 M80 64 l2 28 M88 62 l8 26" stroke="#B8A888" stroke-width="2"/><rect x="12" y="74" width="26" height="18" rx="2" fill="#5A92E6"/>`],
    'g-cat': ['#C9A06A', () => `<path d="M16 90 q4 -40 44 -40 q40 0 44 40 z" fill="#3A4A5A"/>${cat(82, 60, 0.42, { fur: '#D98A3A', belly: '#F0C890', mood: 'angry' })}<path d="M50 50 l2 -8 M58 48 v-8" stroke="#3A4A5A" stroke-width="2"/>`],
    'g-cert': ['#C9A06A', () => `<rect x="24" y="14" width="66" height="76" rx="2" fill="#F4EEDF"/><text x="57" y="30" font-size="8" font-weight="900" font-family="sans-serif" fill="#1A1612" stroke="none" text-anchor="middle">СПРАВКА</text>${[0, 1, 2, 3].map((k) => `<path d="M32 ${40 + k * 8} h${44 - k * 6}" stroke="#B8A888" stroke-width="1.6"/>`).join('')}<circle cx="74" cy="74" r="12" fill="none" stroke="#2F6BC4" stroke-width="2.4"/><text x="74" y="77" font-size="5" font-weight="900" font-family="sans-serif" fill="#2F6BC4" stroke="none" text-anchor="middle">НЕ ПСИХ</text>`],
    'g-garlic': ['#C9A06A', () => `<path d="M20 26 q40 70 80 0" fill="none" stroke="#B89C6A" stroke-width="2"/>${[[28, 44], [40, 56], [54, 62], [68, 60], [82, 52], [92, 40]].map(([x, y]) => `<path d="M${x} ${y - 10} q-8 4 -6 10 q2 6 6 6 q4 0 6 -6 q2 -6 -6 -10 z" fill="#F4EEDF"/><path d="M${x} ${y - 10} v-4" stroke-width="1.4"/>`).join('')}`],
    'g-gopro': ['#C9A06A', () => `<rect x="30" y="30" width="60" height="44" rx="6" fill="#1A1A1E"/><circle cx="60" cy="52" r="16" fill="#26282C"/><circle cx="60" cy="52" r="10" fill="#2F4A7A"/><circle cx="56" cy="48" r="3" fill="#fff" opacity=".5" stroke="none"/><circle cx="82" cy="38" r="3" fill="#FF3A3A" stroke="none"/><text x="38" y="40" font-size="6" font-weight="900" font-family="sans-serif" fill="#FF3A3A" stroke="none">REC</text>`],
    // ----- one-shots -----
    'o-energy': ['#2FAE8A', () => `<rect x="44" y="18" width="32" height="68" rx="5" fill="#1A1A1E"/><ellipse cx="60" cy="18" rx="16" ry="4" fill="#8A8F98"/><path d="M54 34 l10 -2 l-6 14 l8 -2 l-12 20 l4 -14 l-8 2 z" fill="#7FFF5A" stroke-width="1.2"/><text x="60" y="80" font-size="6" font-weight="900" font-family="sans-serif" fill="#7FFF5A" stroke="none" text-anchor="middle">−50%</text>`],
    'o-pickle': ['#2FAE8A', () => `<path d="M36 26 h48 v6 q8 6 8 16 v34 q0 6 -6 6 h-52 q-6 0 -6 -6 v-34 q0 -10 8 -16 z" fill="#C9E0A0" fill-opacity=".85"/><rect x="34" y="16" width="52" height="12" rx="2" fill="#C3202F"/>${[[48, 52], [62, 60], [74, 48], [54, 72]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="5" ry="11" fill="#4A8A3A" transform="rotate(20 ${x} ${y})"/>`).join('')}`],
    'o-brick': ['#2FAE8A', () => `<path d="M20 50 l60 -14 l22 14 l-60 16 z" fill="#C0592B"/><path d="M42 66 v18 l60 -16 v-18 z" fill="#8A3A1A"/><path d="M20 50 v18 l22 16 v-18 z" fill="#A04A22"/><path d="M14 30 l10 6 M22 20 l6 10" stroke="#FFD866" stroke-width="2"/>`],
    'o-firework': ['#2FAE8A', () => `<rect x="48" y="44" width="24" height="44" rx="3" fill="#C3202F"/><path d="M48 54 h24 M48 74 h24" stroke="#F0D48A" stroke-width="3"/><path d="M60 44 q4 -10 0 -18" fill="none" stroke="#B89C6A" stroke-width="2.4"/><circle cx="60" cy="24" r="10" fill="url(#__id__-fire)" stroke="none"/>${spark(60, 24, 6, '#FFF2B0')}<path d="M30 30 l8 4 M90 30 l-8 4 M34 14 l6 6 M86 14 l-6 6" stroke="#FFB13A" stroke-width="2"/>`],
    'o-pies': ['#2FAE8A', () => `<ellipse cx="60" cy="74" rx="44" ry="10" fill="#E9DEC6"/>${[[42, 64], [64, 66], [54, 52], [78, 56]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="16" ry="9" fill="#D8963A"/><path d="M${x - 10} ${y - 2} q10 -6 20 0" fill="none" stroke="#A86A22" stroke-width="1.4"/>`).join('')}<path d="M40 34 q4 -10 0 -18 M60 30 q4 -10 0 -18 M80 34 q4 -10 0 -18" fill="none" stroke="#E9DEC6" stroke-width="2" opacity=".6"/>`],
    'o-holy': ['#2FAE8A', () => `${bottle(60, 56, 1.1, '#9FC7E8', '#F4EEDF')}<path d="M57 52 h6 M60 48 v10" stroke="#E2B85A" stroke-width="2"/><path d="M24 30 l4 4 M96 30 l-4 4 M20 50 h6 M94 50 h6" stroke="#FFF2B0" stroke-width="2"/><circle cx="60" cy="54" r="30" fill="#FFF2B0" opacity=".1" stroke="none"/>`],
    'o-mother': ['#2FAE8A', () => `<rect x="40" y="14" width="40" height="72" rx="7" fill="#1A1A1E"/><rect x="44" y="20" width="32" height="56" rx="2" fill="#2FAE6A"/><circle cx="60" cy="38" r="9" fill="#F4EEDF"/><text x="60" y="58" font-size="8" font-weight="900" font-family="sans-serif" fill="#fff" stroke="none" text-anchor="middle">МАМА</text><circle cx="60" cy="68" r="5" fill="#fff" stroke="none"/><path d="M88 28 q8 4 6 12 M94 20 q12 8 8 22 M32 28 q-8 4 -6 12" fill="none" stroke="#FFD866" stroke-width="2"/><path d="M57 36 q3 -4 6 0 q-3 6 -3 6 q0 0 -3 -6 z" fill="#E06A72" stroke="none"/>`],
    // ----- levels -----
    'l-blat': ['#E0C043', () => `<path d="M14 60 q16 -16 34 -6 l12 8 l-6 8 l-14 -6 l-10 8 z" fill="#E8C49A"/><path d="M106 60 q-16 -16 -34 -6 l-12 8 l6 8 l14 -6 l10 8 z" fill="#D8B48A"/><rect x="48" y="30" width="24" height="16" rx="2" fill="#E9DEC6" transform="rotate(-8 60 38)"/><text x="60" y="42" font-size="8" font-weight="900" font-family="sans-serif" fill="#2FAE6A" stroke="none" text-anchor="middle" transform="rotate(-8 60 38)">₽</text><text x="60" y="92" font-size="12" font-weight="900" font-family="sans-serif" fill="#F0D48A" stroke="none" text-anchor="middle">+1 УР.</text>`],
    'l-lottery': ['#E0C043', () => `<rect x="20" y="22" width="80" height="44" rx="4" fill="#F0D48A"/><path d="M20 22 h80 v12 h-80 z" fill="#C3202F"/><text x="60" y="31" font-size="7" font-weight="900" font-family="sans-serif" fill="#fff" stroke="none" text-anchor="middle">ЛОТО-МИЛЛИОН</text>${[0, 1, 2, 3, 4].map((k) => `<circle cx="${32 + k * 14}" cy="50" r="5" fill="#fff"/><text x="${32 + k * 14}" y="52.5" font-size="6" font-weight="900" font-family="sans-serif" fill="#1A1612" stroke="none" text-anchor="middle">${[7, 13, 21, 3, 42][k]}</text>`).join('')}${spark(100, 18, 6)}${spark(20, 74, 5)}<text x="60" y="92" font-size="12" font-weight="900" font-family="sans-serif" fill="#F0D48A" stroke="none" text-anchor="middle">+1 УР.</text>`],
    'l-bribe': ['#E0C043', () => `<path d="M22 34 h76 v40 h-76 z" fill="#E9DEC6"/><path d="M22 34 l38 22 l38 -22" fill="#D8CBAE"/><rect x="34" y="20" width="40" height="20" rx="1" fill="#7FB86A" transform="rotate(-10 54 30)"/><text x="54" y="34" font-size="9" font-weight="900" font-family="sans-serif" fill="#1A4A1A" stroke="none" text-anchor="middle" transform="rotate(-10 54 30)">5000</text><text x="60" y="92" font-size="12" font-weight="900" font-family="sans-serif" fill="#F0D48A" stroke="none" text-anchor="middle">+1 УР.</text>`],
    'l-exam': ['#E0C043', () => `<rect x="22" y="22" width="76" height="48" rx="5" fill="#F4C8D8"/><rect x="28" y="28" width="22" height="28" rx="2" fill="#E8C49A"/>${face(39, 40, 7, '#E8C49A', { mouth: 'grin' })}${[0, 1, 2].map((k) => `<path d="M56 ${34 + k * 8} h${34 - k * 6}" stroke="#B8A888" stroke-width="2"/>`).join('')}<text x="76" y="64" font-size="7" font-weight="900" font-family="sans-serif" fill="#1A1612" stroke="none" text-anchor="middle">B</text><text x="60" y="92" font-size="12" font-weight="900" font-family="sans-serif" fill="#F0D48A" stroke="none" text-anchor="middle">+1 УР.</text>`],
  };

  function render(set, prefix, k) {
    const key = prefix + k;
    if (cache.has(key)) return cache.get(key);
    const def = set[k];
    if (!def) return '';
    const id = 'pa-' + key.replace(/[^a-z0-9]/gi, '');
    const svg = wrap(id, def[0], def[1](id).replace(/__id__/g, id).replace(/url\(#orbX\)/g, `url(#${id}-orb)`));
    cache.set(key, svg);
    return svg;
  }
  // 3D renders of every card (public/art/cards); the SVG drawings above stay as a fallback
  const img = (file, k) => `<img class="pt-art-img" src="/art/cards/${file}.webp" alt="" width="480" height="400" loading="lazy" decoding="async" draggable="false" data-k="${k}">`;
  window.PartyArt = {
    bomb: (k) => (BOMB[k] ? img('b-' + k, k) : ''),
    dungeon: (k) => (DUN[k] ? img('d-' + k, k) : ''),
    svg: { bomb: (k) => render(BOMB, 'b-', k), dungeon: (k) => render(DUN, 'd-', k) },
    has: (game, k) => !!(game === 'bomb' ? BOMB : DUN)[k],
  };
  // a render that failed to load is swapped for the drawing
  document.addEventListener('error', (e) => {
    const el = e.target;
    if (!el || !el.classList || !el.classList.contains('pt-art-img')) return;
    const k = el.dataset.k; const bomb = el.src.includes('/b-');
    const holder = el.parentNode; if (holder) holder.innerHTML = bomb ? render(BOMB, 'b-', k) : render(DUN, 'd-', k);
  }, true);
})();
