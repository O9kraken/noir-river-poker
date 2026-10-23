/* «Подземелье»: heroes, the fight, gear slots and the hand with context actions. */
(() => {
  'use strict';
  const { h } = window.NR;
  const SLOT_NAME = { head: 'Голова', body: 'Броня', feet: 'Обувь', hand: 'Одна рука', two: 'Две руки', misc: 'Прочее' };
  const TYPE_NAME = { monster: 'Монстр', curse: 'Проклятие', class: 'Класс', mod: 'Усилитель', wander: 'Бродячая тварь', gear: 'Шмот', oneshot: 'Разовая', level: 'Уровень' };
  const TYPE_ICON = { monster: '☠', curse: '✸', class: '♜', mod: '±', wander: '↯', gear: '⚔', oneshot: '⚗', level: '▲' };

  function cardEl(c, defs, { sel, onclick, small, extra } = {}) {
    const d = defs[c.k] || { name: c.k, type: 'gear' };
    const stat = d.type === 'monster' ? `${d.level}` : d.type === 'gear' ? (d.bonus ? `+${d.bonus}` : '') : d.type === 'oneshot' ? `+${d.power}` : d.type === 'mod' ? (d.mod > 0 ? `+${d.mod}` : `${d.mod}`) : '';
    const sub = d.type === 'gear' ? SLOT_NAME[d.slot] : d.type === 'monster' ? `ур. ${d.level}${d.undead ? ' · нежить' : ''}` : TYPE_NAME[d.type];
    const tag = onclick ? 'button' : 'div';
    return h(tag, {
      ...(onclick ? { type: 'button', onclick, 'aria-pressed': !!sel } : {}),
      class: `dg-card t-${d.type}${sel ? ' sel' : ''}${small ? ' sm' : ''}${d.undead ? ' undead' : ''}`,
      'data-id': c.id != null ? c.id : '',
      'data-zoom': '1',
    },
    artEl(c.k, d),
    stat ? h('span', { class: 'dg-stat' }, stat) : null,
    h('b', null, d.name),
    h('small', null, sub || ''),
    h('p', null, d.text || ''),
    d.type === 'monster' ? h('em', { class: 'dg-bad' }, `Не победил: ${BAD[d.bad] || ''} · сокровищ ${d.treasures}${d.levels > 1 ? ` · +${d.levels} ур.` : ''}`) : null,
    d.gold ? h('span', { class: 'dg-gold' }, `${d.gold} зол.`) : null,
    extra || null);
  }

  const BAD = { lvl1: 'минус уровень', lvl2: 'минус 2 уровня', lvl3: 'минус 3 уровня', head: 'потеря головного убора', body: 'потеря брони', feet: 'потеря обуви', hand: 'потеря оружия', item: 'потеря самой дорогой вещи', cards2: 'минус 2 карты', death: 'смерть' };
  function artEl(k, d) {
    const el = h('span', { class: 'dg-art', 'aria-hidden': 'true' });
    if (window.PartyArt && window.PartyArt.has('dungeon', k)) el.innerHTML = window.PartyArt.dungeon(k);
    else el.textContent = TYPE_ICON[d.type] || '◆';
    return el;
  }

  function render(board, dock, ctx) {
    const { g, st, seat, ui, send } = ctx;
    const D = g.cards;
    const me = g.players.find((p) => p.seat === seat);
    const myTurn = seat === g.cur && st.status === 'playing';
    const f = g.fight;
    ui.sel ||= [];
    const hand = g.hand || [];
    ui.sel = ui.sel.filter((id) => hand.some((c) => c.id === id) || (me && allItems(me).some((c) => c.id === id)));

    // ---------- heroes ----------
    const strip = window.PartyKit.strip(ctx, g.players, {
      active: [g.cur],
      cls: (p) => (p.dead ? 'dead' : ''),
      extra: (p) => h('span', { class: 'dg-pl-meta' },
        h('em', { class: 'dg-lvl', title: 'Уровень' }, String(p.level)),
        h('span', null, `сила ${p.power}`),
        p.cls ? h('span', { class: 'dg-cls' }, g.classes[p.cls]) : null,
        h('span', { class: 'muted' }, `${p.cards} карт`),
        gearIcons(p)),
      onPick: (s) => {
        if (ui.mode === 'curse') { const id = ui.sel[0]; ui.mode = null; ui.sel = []; send('curse', { card: id, target: s }); return; }
        ui.inspect = ui.inspect === s ? null : s;
        ctx.rerender();
      },
      pickable: () => true,
      quiet: ui.mode !== 'curse',
    });
    if (ui.inspect != null) strip.querySelectorAll(`[data-seat="${ui.inspect}"]`).forEach((x) => x.classList.add('inspect'));
    const goal = h('div', { class: 'dg-goal' }, h('span', null, `Цель — ${g.goal} уровень · нажмите на героя, чтобы увидеть его шмот`), h('span', { class: 'muted' }, `дверей ${g.decks.doors} · сокровищ ${g.decks.treasures}`));

    // ---------- centre: fight or the door ----------
    let center;
    if (f) {
      const fighter = g.players.find((p) => p.seat === f.seat);
      const winning = f.pp > f.mp;
      const mineFight = f.seat === seat;
      const acts = [];
      if (mineFight) {
        if (winning) acts.push(h('button', { type: 'button', class: 'btn btn-gold', disabled: f.final, onclick: () => send('go') }, f.final ? 'Добиваем…' : 'Бить!'));
        acts.push(h('button', { type: 'button', class: 'btn btn-dark', onclick: () => send('run') }, 'Бежать'));
        for (const o of f.helper == null ? f.offers : []) acts.push(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => send('accept', { helper: o }) }, `Принять помощь: ${ctx.nameOf(o)}`));
      } else if (me && f.helper == null && !f.offers.includes(seat)) acts.push(h('button', { type: 'button', class: 'btn btn-dark btn-sm', onclick: () => send('offer') }, 'Предложить помощь (за половину добычи)'));
      center = h('div', { class: 'dg-fight' + (winning ? ' win' : ' lose') + (f.final ? ' final' : '') },
        h('div', { class: 'dg-side hero' },
          h('small', null, 'Герои'),
          h('b', null, fighter ? fighter.name : '—', f.helper != null ? ` + ${ctx.nameOf(f.helper)}` : ''),
          h('span', { class: 'dg-power' }, String(f.pp)),
          h('small', { class: 'muted' }, [f.pfx ? `зелья +${f.pfx}` : '', f.burnt ? `ритуал +${f.burnt}` : ''].filter(Boolean).join(' · ') || ' ')),
        h('div', { class: 'dg-vs' }, h('span', null, 'VS'), f.final ? ctx.timer(f.left, 6000, 'ring') : null),
        h('div', { class: 'dg-side monster' },
          h('div', { class: 'dg-monsters' }, ...f.monsters.map((m, i) => cardEl(m, D, { small: true, extra: m.mods.length ? h('span', { class: 'dg-mpow' }, `сила ${m.power}`, h('i', null, m.mods.map((k) => D[k].name).join(', '))) : null, onclick: ui.mode === 'mod' ? () => { const id = ui.sel[0]; ui.mode = null; ui.sel = []; send('mod', { card: id, monster: i }); } : null }))),
          h('span', { class: 'dg-power' }, String(f.mp)),
          h('small', { class: 'muted' }, f.mfx ? `подлянки +${f.mfx}` : ' ')),
        h('p', { class: 'dg-verdict' }, winning ? (mineFight ? 'Сил хватает — бейте!' : `${fighter ? fighter.name : ''} побеждает… если никто не вмешается`) : (mineFight ? 'Не хватает сил: зелья, помощь или бегство' : `${fighter ? fighter.name : ''} проигрывает`)),
        f.plays.length ? h('ul', { class: 'dg-plays' }, ...f.plays.map((p) => h('li', null, `${ctx.nameOf(p.seat)}: ${D[p.k].name} → ${p.side === 'p' ? 'герою' : 'монстру'} +${p.pow}`))) : null,
        acts.length ? h('div', { class: 'pt-actions' }, ...acts) : null);
    } else {
      const acts = [];
      if (myTurn && g.phase === 'start') acts.push(h('button', { type: 'button', class: 'btn btn-gold dg-door-btn', onclick: () => { ui.sel = []; send('kick'); } }, 'Выбить дверь'));
      if (myTurn && g.phase === 'after') {
        acts.push(h('button', { type: 'button', class: 'btn btn-dark', onclick: () => send('loot') }, 'Пошарить по углам'));
        const mon = hand.filter((c) => D[c.k].type === 'monster');
        if (mon.length) acts.push(h('span', { class: 'muted small' }, 'или выберите монстра в руке → «Искать неприятности»'));
      }
      const last = g.ev && g.ev.type === 'flee' ? h('div', { class: 'dg-rolls' }, ...g.ev.rolls.map((r) => h('span', { class: r.ok ? 'ok' : 'bad' }, h('i', { class: 'dg-die', 'data-v': r.die }, String(r.die)), `${ctx.nameOf(r.seat)}: ${r.ok ? 'удрал от' : 'не удрал от'} «${r.monster}»`))) : null;
      center = h('div', { class: 'dg-door' },
        h('div', { class: 'dg-door-art', 'aria-hidden': 'true' }, h('span', null)),
        h('b', null, myTurn ? (g.phase === 'start' ? 'Ваш ход. За дверью что-то шуршит…' : 'Боя не было. Что дальше?') : `Ходит ${ctx.nameOf(g.cur)}`),
        last,
        acts.length ? h('div', { class: 'pt-actions' }, ...acts) : null,
        st.turn && st.turn.seat === g.cur ? ctx.timer(st.turn.left, st.turn.ms, 'bar') : null);
    }
    const insp = ui.inspect != null && ui.inspect !== seat ? g.players.find((p) => p.seat === ui.inspect) : null;
    if (ui.inspect != null && !insp) ui.inspect = null;
    board.replaceChildren(...[strip, insp ? inspectPanel(insp, g, ctx) : null, goal, center].filter(Boolean));

    // ---------- me: gear + hand ----------
    if (!me) { dock.replaceChildren(h('p', { class: 'muted small' }, 'Вы смотрите партию.')); return; }
    const selCards = ui.sel.map((id) => hand.find((c) => c.id === id) || allItems(me).find((c) => c.id === id)).filter(Boolean);
    const one = selCards.length === 1 ? selCards[0] : null;
    const d1 = one ? D[one.k] : null;
    const inHand = one && hand.some((c) => c.id === one.id);
    const between = myTurn && (g.phase === 'start' || g.phase === 'after') && !f;
    const toggle = (c) => {
      if (ui.mode === 'wander') { ui.sel = [ui.sel[0], c.id]; ctx.rerender(); return; }
      if (ui.mode === 'sell') { const i = ui.sel.indexOf(c.id); if (i === -1) ui.sel.push(c.id); else ui.sel.splice(i, 1); ctx.rerender(); return; }
      ui.mode = null;
      ui.sel = ui.sel[0] === c.id ? [] : [c.id];
      ctx.rerender();
    };
    const acts = [];
    const B = (label, fn, cls = 'btn-dark') => h('button', { type: 'button', class: `btn btn-sm ${cls}`, onclick: fn }, label);
    const clear = () => { ui.sel = []; ui.mode = null; };
    if (ui.mode === 'sell') {
      const gold = selCards.reduce((a, c) => a + (D[c.k].gold || 0), 0);
      acts.push(h('span', { class: 'bk-hint' }, `Скупщик: ${gold} зол. → +${Math.floor(gold / 1000)} ур.`), B('Продать', () => { send('sell', { cards: ui.sel }); clear(); }, 'btn-gold'), B('Отмена', () => { clear(); ctx.rerender(); }, 'btn-ghost'));
    } else if (ui.mode === 'curse') acts.push(h('span', { class: 'bk-hint strong' }, 'Кого проклинаем? Нажмите на игрока вверху'), B('Отмена', () => { clear(); ctx.rerender(); }, 'btn-ghost'));
    else if (ui.mode === 'mod') acts.push(h('span', { class: 'bk-hint strong' }, 'Нажмите на монстра в бою'), B('Отмена', () => { clear(); ctx.rerender(); }, 'btn-ghost'));
    else if (ui.mode === 'wander') {
      const mon = selCards.find((c) => D[c.k].type === 'monster');
      acts.push(h('span', { class: 'bk-hint strong' }, mon ? `Подкинуть ${D[mon.k].name}?` : 'Теперь выберите монстра в руке'), mon ? B('Подкинуть', () => { const w = ui.sel.find((id) => D[(hand.find((c) => c.id === id) || {}).k].type === 'wander'); send('wander', { card: w, monster: mon.id }); clear(); }, 'btn-gold') : null, B('Отмена', () => { clear(); ctx.rerender(); }, 'btn-ghost'));
    } else if (d1) {
      if (!inHand && between) acts.push(B('Снять', () => { send('unequip', { card: one.id }); clear(); }));
      if (inHand && d1.type === 'gear' && between) acts.push(B('Надеть', () => { send('equip', { card: one.id }); clear(); }, 'btn-gold'));
      if (inHand && d1.type === 'class' && between) acts.push(B(`Стать: ${d1.name}`, () => { send('class', { card: one.id }); clear(); }, 'btn-gold'));
      if (inHand && d1.type === 'level' && !f) acts.push(B('+1 уровень', () => { send('level', { card: one.id }); clear(); }, 'btn-gold'));
      if (inHand && d1.type === 'curse') acts.push(B('Проклясть…', () => { ui.mode = 'curse'; ctx.rerender(); }, 'btn-red'));
      if (inHand && d1.type === 'monster' && myTurn && g.phase === 'after') acts.push(B('Искать неприятности', () => { send('trouble', { card: one.id }); clear(); }, 'btn-gold'));
      if (inHand && d1.type === 'oneshot' && f) acts.push(B('Герою', () => { send('oneshot', { card: one.id, side: 'p' }); clear(); }, 'btn-gold'), B('Монстру', () => { send('oneshot', { card: one.id, side: 'm' }); clear(); }, 'btn-red'));
      if (inHand && d1.type === 'mod' && f) acts.push(B('На монстра…', () => { if (f.monsters.length === 1) { send('mod', { card: one.id, monster: 0 }); clear(); } else { ui.mode = 'mod'; ctx.rerender(); } }, 'btn-red'));
      if (inHand && d1.type === 'wander' && f && f.monsters.length < 3) acts.push(B('Подкинуть монстра…', () => { ui.mode = 'wander'; ctx.rerender(); }, 'btn-red'));
      if (inHand && f && f.seat === seat && me.cls === 'mage' && f.burnt < 3) acts.push(B('Сжечь в ритуале (+1)', () => { send('burn', { card: one.id }); clear(); }));
      acts.push(B('Отмена', () => { clear(); ctx.rerender(); }, 'btn-ghost'));
    } else if (between) {
      acts.push(B('Продать вещи…', () => { ui.mode = 'sell'; ui.sel = []; ctx.rerender(); }, 'btn-ghost'));
      acts.push(h('span', { class: 'muted small' }, 'Выберите карту — появятся действия'));
    } else if (f) acts.push(h('span', { class: 'muted small' }, 'В бою можно сыграть разовые карты, усилители и бродячих тварей — выберите карту'));
    const slot = (label, c) => h('div', { class: 'dg-slot' + (c ? '' : ' vacant') }, h('small', null, label), c ? cardEl(c, D, { small: true, sel: ui.sel.includes(c.id), onclick: () => toggle(c) }) : h('span', null, '—'));
    const gear = h('div', { class: 'dg-gear' },
      h('div', { class: 'dg-me' }, h('em', { class: 'dg-lvl big' }, String(me.level)), h('span', null, h('b', null, me.cls ? g.classes[me.cls] : 'Без класса'), h('small', null, `сила ${me.power} · побег +${me.escape}`))),
      slot('Голова', me.eq.head), slot('Броня', me.eq.body), slot('Обувь', me.eq.feet),
      ...[0, 1].map((i) => slot(i ? 'Рука' : 'Рука', me.eq.hands[i])),
      ...[0, 1].map((i) => slot('Прочее', me.eq.misc[i])));
    const order = { level: 0, oneshot: 1, gear: 2, class: 3, curse: 4, mod: 5, wander: 6, monster: 7 };
    const sorted = [...hand].sort((a, b) => (order[D[a.k].type] ?? 9) - (order[D[b.k].type] ?? 9));
    dock.replaceChildren(h('div', { class: 'dg-dock' },
      gear,
      h('div', { class: 'dg-acts' }, ...acts.filter(Boolean)),
      h('div', { class: 'dg-hand' }, ...(sorted.length ? sorted.map((c) => cardEl(c, D, { sel: ui.sel.includes(c.id), onclick: () => toggle(c) })) : [h('p', { class: 'muted small' }, me.dead ? 'Вы погибли: всё потеряно. В свой ход вернётесь с новыми картами.' : 'Карт нет')]))));
    if (ctx.fresh && ['door', 'trouble', 'wander'].includes(ctx.fresh.type)) {
      const el = board.querySelector('.dg-monsters .dg-card:last-child');
      if (el && !window.PartyKit.REDUCE) el.classList.add('enter');
    }
  }
  /** Small pictures of what a hero wears, under their name. */
  function gearIcons(p) {
    const items = allItems(p);
    if (!items.length) return null;
    return h('span', { class: 'dg-pl-gear' }, ...items.map((c) => { const el = h('span', { title: c.k }); if (window.PartyArt) el.innerHTML = window.PartyArt.dungeon(c.k); return el; }));
  }
  /** Everything another hero has on: opens when you click them. */
  function inspectPanel(p, g, ctx) {
    const D = g.cards;
    const slot = (label, c) => h('div', { class: 'dg-slot' + (c ? '' : ' vacant') }, h('small', null, label), c ? cardEl(c, D, { small: true }) : h('span', null, '—'));
    return h('div', { class: 'dg-inspect' },
      h('div', { class: 'dg-inspect-head' }, h('b', null, p.name), h('small', null, `${p.level} уровень · ${p.cls ? g.classes[p.cls] : 'без класса'}`), h('small', null, `сила ${p.power} · побег +${p.escape} · ${p.cards} карт`), h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { ctx.ui.inspect = null; ctx.rerender(); } }, 'Закрыть')),
      slot('Голова', p.eq.head), slot('Броня', p.eq.body), slot('Обувь', p.eq.feet),
      slot('Рука', p.eq.hands[0]), slot('Рука', p.eq.hands[1]), slot('Прочее', p.eq.misc[0]), slot('Прочее', p.eq.misc[1]));
  }
  function allItems(p) { return [p.eq.head, p.eq.body, p.eq.feet, ...p.eq.hands, ...p.eq.misc].filter(Boolean); }

  (window.PartyGames ||= {}).dungeon = { render, cardEl: (k, D) => cardEl({ k }, D, { small: true }) };
})();
