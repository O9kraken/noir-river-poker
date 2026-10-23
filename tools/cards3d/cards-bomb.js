// 3D scenes for «Котобомба»
import * as K from '/kit3d.js';
const { THREE, sph, box, cyl, cone, torus, cap, tube, lathe, group, at, panel, textPanel, mat, GOLD, METAL, cat, person, hat, bombBall, coin, coinStack, cardBack, spark, phone } = K;

const back = () => cardBack(0.62, 0.88);
function miniCard(color, mark, { w = 0.62, h = 0.88 } = {}) {
  return panel(w, h, (x, cw, ch) => {
    x.fillStyle = color; x.fillRect(0, 0, cw, ch);
    x.strokeStyle = '#D9B65E'; x.lineWidth = 10; x.strokeRect(14, 14, cw - 28, ch - 28);
    if (mark) { x.fillStyle = '#F0D48A'; x.font = `900 ${cw * 0.42}px MR`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(mark, cw / 2, ch / 2); }
  }, { depth: 0.025, edge: '#D9B65E' });
}

export const BOMB = {
  bomb: { tone: '#F0602A', build(s) {
    s.add(at(bombBall(0.72, { face: true, ears: true }), [0, 0, 0.1], [0, -0.15, 0]));
    for (const [x, y, z] of [[-1.1, 1.8, 0.3], [1.2, 1.6, 0.2], [-0.9, 0.5, 0.9], [1.05, 0.7, 0.8]]) s.add(at(spark('#FFB13A', 0.05), [x, y, z]));
  } },
  defuse: { tone: '#3D7FE0', build(s) {
    const dev = group(box(1.3, 0.7, 0.8, '#26282C', [0, 0.35, 0], null, 0.06));
    const scr = textPanel(0.6, 0.28, '0:03', { bg: '#04140A', fg: '#5BFF8A', emissive: 1.2, depth: 0.01 }); scr.position.set(-0.22, 0.42, 0.41); dev.add(scr);
    dev.add(sph(0.08, mat('#FF3A3A', { emissive: '#FF2020', ei: 2 }), [0.38, 0.5, 0.4]));
    s.add(at(dev, [-0.35, 0, -0.1], [0, 0.35, 0]));
    s.add(tube([[0.2, 0.4, 0.2], [0.7, 0.6, 0.5], [1.0, 1.1, 0.4], [1.2, 1.5, 0.2]], 0.045, mat('#D8282C', { clear: 0.8 })));
    s.add(tube([[0.25, 0.3, 0.3], [0.8, 0.3, 0.7], [1.2, 0.5, 0.6]], 0.045, mat('#2F6BD4', { clear: 0.8 })));
    const cut = new THREE.Group();
    for (const sd of [-1, 1]) {
      const half = new THREE.Group(); half.rotation.z = sd * 0.35;
      half.add(cap(0.08, 0.6, mat('#D8282C', { clear: 0.8 }), [0, -0.45, 0]));
      half.add(box(0.06, 0.5, 0.04, METAL(), [sd * 0.02, 0.2, 0], [0, 0, sd * -0.1]));
      cut.add(half);
    }
    cut.add(cyl(0.06, 0.06, 0.08, METAL(), [0, 0, 0], [Math.PI / 2, 0, 0]));
    s.add(at(cut, [1.05, 1.15, 0.6], [0.2, -0.4, -0.6]));
  } },
  skip: { tone: '#2FAE6A', build(s) {
    const door = group(box(1.1, 2.1, 0.12, '#3A2414', [0, 1.05, 0]), box(0.9, 1.9, 0.02, '#050302', [0, 1.0, 0.06]));
    const leaf = box(0.9, 1.9, 0.06, '#6A4426', [0.45, 0, 0]); const hinge = group(leaf); hinge.position.set(0.45, 1.0, 0.08); hinge.rotation.y = -1.1; door.add(hinge);
    door.add(sph(0.05, GOLD(), [0.4, 1.0, 0.6]));
    s.add(at(door, [0.75, 0, -0.4], [0, -0.35, 0]));
    const c = cat({ fur: '#D98A3A', belly: '#F6D8A8', mood: 'smug', look: [1, 0] }); s.add(at(c, [-0.4, 0, 0.3], [0, 0.9, 0], 0.85));
    for (const [z, y] of [[0.6, 0.5], [0.4, 0.9], [0.8, 0.25]]) s.add(at(cyl(0.02, 0.02, 0.6, mat('#BFF0D0', { emissive: '#7FE0A8', ei: 0.6 })), [-1.35, y, z], [0, 0, Math.PI / 2]));
    for (const [x, z, r] of [[-1.2, 0.9, 0.13], [-1.45, 0.65, 0.09]]) s.add(sph(r, mat('#9A8A70', { rough: 1, opacity: 0.6 }), [x, r, z]));
  } },
  attack: { tone: '#E0453F', build(s) {
    const c = cat({ fur: '#2A2C30', belly: '#4A4D52', mood: 'angry', look: [1, 0] }); s.add(at(c, [-0.75, 0, 0.2], [0, 0.6, 0], 0.85));
    const arrow = (col) => K.extrude([[0, 0.14], [0.7, 0.14], [0.7, 0.32], [1.1, 0], [0.7, -0.32], [0.7, -0.14], [0, -0.14]], 0.16, mat(col, { clear: 0.8, rough: 0.3 }));
    s.add(at(arrow('#D8282C'), [0.55, 1.55, 0], [0, -0.25, 0.08]));
    s.add(at(arrow('#F0503A'), [0.75, 0.85, 0.3], [0, -0.25, -0.04]));
    const x2 = textPanel(0.6, 0.42, '×2', { bg: '#1A0A0A', fg: '#F0D48A', depth: 0.06 }); s.add(at(x2, [1.1, 0.3, 0.9], [-0.2, -0.3, 0]));
  } },
  future: { tone: '#9B6BFF', build(s) {
    s.add(lathe([[0, 0], [0.7, 0], [0.62, 0.12], [0.45, 0.2], [0.35, 0.45], [0.5, 0.55], [0, 0.55]], GOLD(), [0, 0, 0]));
    const orb = sph(0.72, mat('#C9B0FF', { trans: 0.85, rough: 0.05, clear: 1, ior: 1.3 }), [0, 1.2, 0]); s.add(orb);
    const inner = new THREE.Group(); inner.position.set(0, 1.2, 0);
    [['#3E2866', -0.25, -0.3], ['#C3202F', 0, 0], ['#3E2866', 0.25, 0.3]].forEach(([c, x, r]) => inner.add(at(miniCard(c, '', { w: 0.26, h: 0.38 }), [x, 0, 0.05], [0, 0, r])));
    s.add(inner);
    const glow = new THREE.PointLight('#B58CFF', 7, 4, 1.5); glow.position.set(0, 1.2, 0.2); s.add(glow);
    for (const [x, y] of [[-1.2, 2.1], [1.1, 2.2], [1.3, 1.4]]) s.add(at(spark('#E0D0FF', 0.05), [x, y, 0]));
  } },
  alter: { tone: '#8F5BE0', build(s) {
    [[-0.75, 0.25, '#2A1A44'], [0, 0, '#3E2866'], [0.75, -0.25, '#2A1A44']].forEach(([x, r, c], i) => s.add(at(miniCard(c, i === 1 ? '?' : ''), [x, 0.95 + (i === 1 ? 0.15 : 0), 0.2 - Math.abs(x) * 0.2], [0, -x * 0.4, r])));
    s.add(at(torus(1.2, 0.04, mat('#F0D48A', { emissive: '#F0D48A', ei: 0.5 }), null, null, Math.PI * 0.8), [0, 1.0, -0.2], [0, 0, Math.PI * 0.1]));
    s.add(at(cone(0.1, 0.25, mat('#F0D48A', { emissive: '#F0D48A', ei: 0.5 })), [-1.1, 1.5, -0.2], [0, 0, 0.6]));
    s.add(at(torus(1.2, 0.04, mat('#B58CFF', { emissive: '#B58CFF', ei: 0.6 }), null, null, Math.PI * 0.8), [0, 0.9, -0.2], [0, 0, Math.PI * 1.1]));
  } },
  shuffle: { tone: '#E0A043', build(s) {
    const pts = [[-1.0, 1.4, 0.2, 0.6, '#EFE6D2', '♦'], [-0.3, 2.0, -0.2, -0.4, '#1E1E22', ''], [0.6, 1.7, 0.1, 0.9, '#EFE6D2', '♣'], [0.9, 0.9, 0.4, -0.7, '#6A1C22', ''], [-0.6, 0.7, 0.6, 0.3, '#1E1E22', ''], [0.1, 1.2, 0.5, 1.4, '#EFE6D2', '♥']];
    for (const [x, y, z, r, c, m] of pts) {
      const p = panel(0.5, 0.72, (ctx, cw, ch) => { ctx.fillStyle = c; ctx.fillRect(0, 0, cw, ch); ctx.strokeStyle = '#D9B65E'; ctx.lineWidth = 8; ctx.strokeRect(10, 10, cw - 20, ch - 20); if (m) { ctx.fillStyle = m === '♣' ? '#16181B' : '#C3202F'; ctx.font = `900 ${cw * 0.5}px MR`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(m, cw / 2, ch / 2); } }, { depth: 0.02, edge: '#D9B65E' });
      s.add(at(p, [x, y, z], [r * 0.6, r, r * 0.5]));
    }
    s.add(at(torus(1.25, 0.02, mat('#F0D48A', { emissive: '#F0D48A', ei: 0.6, opacity: 0.6 })), [0, 1.3, 0], [1.25, 0, 0.2]));
  } },
  bottom: { tone: '#E0A043', build(s) {
    const deck = new THREE.Group();
    for (let k = 0; k < 9; k++) { const b = back(); b.rotation.x = -Math.PI / 2; b.position.set(0, 0.03 + k * 0.03, 0); b.rotation.z = (k % 3 - 1) * 0.03; deck.add(b); }
    s.add(at(deck, [-0.15, 0.25, -0.1], [0.5, 0.3, 0], 1.7));
    const face = panel(0.62, 0.88, (x, cw, ch) => { x.fillStyle = '#EFE6D2'; x.fillRect(0, 0, cw, ch); x.fillStyle = '#C3202F'; x.fillRect(cw * 0.3, ch * 0.47, cw * 0.4, ch * 0.06); x.strokeStyle = '#D9B65E'; x.lineWidth = 10; x.strokeRect(12, 12, cw - 24, ch - 24); }, { depth: 0.025, edge: '#D9B65E' });
    s.add(at(face, [0.75, 0.15, 0.75], [-Math.PI / 2 + 0.25, 0, -0.5], 1.4));
    s.add(at(K.extrude([[-0.12, 0.5], [0.12, 0.5], [0.12, 0], [0.3, 0], [0, -0.4], [-0.3, 0], [-0.12, 0]], 0.12, mat('#F0D48A', { clear: 0.8 })), [-1.1, 1.1, 0.2], [0, 0.4, 0]));
  } },
  favor: { tone: '#2BB5A5', build(s) {
    const env = group(box(1.4, 0.9, 0.06, '#E9DEC6', [0, 0, 0]));
    const flap = K.extrude([[-0.7, 0], [0.7, 0], [0, -0.5]], 0.03, mat('#D8CBAE')); flap.position.set(0, 0.2, 0.05); env.add(flap);
    env.add(cyl(0.16, 0.16, 0.04, mat('#B0242F', { clear: 0.6 }), [0, -0.05, 0.09], [Math.PI / 2, 0, 0]));
    const r = textPanel(0.2, 0.2, '₽', { bg: '#B0242F', fg: '#F4EEDF', depth: 0.005 }); r.position.set(0, -0.05, 0.115); env.add(r);
    s.add(at(env, [0, 0.95, 0.1], [-0.25, 0.15, 0.05]));
    s.add(at(coinStack(5), [-1.05, 0, 0.5])); s.add(at(coinStack(3), [1.1, 0, 0.6])); s.add(at(coin(), [0.5, 0, 0.95], [0.1, 0, 0.3]));
    s.add(at(miniCard('#3E2866', '★', { w: 0.45, h: 0.64 }), [0.75, 1.75, -0.2], [0.1, -0.3, -0.35]));
  } },
  nope: { tone: '#E0453F', build(s) {
    const ring = torus(1.0, 0.11, mat('#D8282C', { clear: 0.8, rough: 0.25 })); s.add(at(ring, [0, 1.25, -0.3]));
    s.add(at(box(2.0, 0.2, 0.18, mat('#D8282C', { clear: 0.8, rough: 0.25 })), [0, 1.25, -0.3], [0, 0, -Math.PI / 4]));
    const paw = new THREE.Group();
    const fur = mat('#2A2C30', { rough: 0.7, sheen: 0.6 });
    paw.add(sph(0.5, fur, [0, 0, 0], [1, 1.1, 0.6]));
    paw.add(cap(0.3, 0.25, fur, [0, -0.55, -0.05]));
    const pink = mat('#E8A0A8', { rough: 0.6 });
    paw.add(sph(0.22, pink, [0, -0.08, 0.27], [1.15, 0.9, 0.35]));
    [[-0.32, 0.3], [-0.12, 0.45], [0.12, 0.45], [0.32, 0.3]].forEach(([x, y]) => { paw.add(sph(0.14, fur, [x, y, 0.05])); paw.add(sph(0.08, pink, [x, y, 0.16], [1, 1, 0.5])); });
    s.add(at(paw, [0, 1.3, 0.35], [-0.1, 0, 0], 1.25));
  } },
  c1: { tone: '#7FB86A', build(s) {
    const c = cat({ fur: '#E8DCC0', belly: '#F6EEDC', mood: 'angry' }); s.add(c);
    const h = hat('cap', mat('#1E3A1E', { rough: 0.7 })); h.position.set(0, 0.02, 0); h.scale.setScalar(1.2); c.userData.head.add(h);
    const bat = group(cyl(0.06, 0.12, 1.3, mat('#8A5A2A', { clear: 0.6 }), [0, 0, 0]), cyl(0.13, 0.13, 0.08, '#5A3A1A', [0, 0.66, 0]));
    s.add(at(bat, [0.75, 0.9, 0.35], [0, 0, -0.55]));
    const tag = textPanel(0.6, 0.3, 'ДОЛГ', { bg: '#F4EEDF', fg: '#B0242F' }); s.add(at(tag, [-0.85, 0.55, 0.7], [-0.2, 0.4, 0.1]));
  } },
  c2: { tone: '#8A7AB8', build(s) {
    const c = cat({ fur: '#16181B', belly: '#2A2C30', eye: '#9FE0BC' }); s.add(at(c, [-0.35, 0, 0.2], [0, 0.25, 0]));
    const h = hat('top', mat('#0A0A0C', { rough: 0.4 })); h.scale.setScalar(1.05); c.userData.head.add(h);
    const coffin = K.extrude([[-0.28, -0.9], [0.28, -0.9], [0.42, 0.45], [0.2, 0.9], [-0.2, 0.9], [-0.42, 0.45]], 0.3, mat('#4A2C16', { clear: 0.6 }));
    s.add(at(coffin, [0.85, 0.92, -0.3], [0, -0.4, 0]));
    s.add(at(box(0.06, 0.5, 0.04, GOLD()), [0.85, 1.1, -0.1], [0, -0.4, 0])); s.add(at(box(0.32, 0.06, 0.04, GOLD()), [0.86, 1.2, -0.1], [0, -0.4, 0]));
  } },
  c3: { tone: '#D98A3A', build(s) {
    const c = cat({ fur: '#D98A3A', belly: '#F6D8A8' }); s.add(at(c, [0.15, 0, 0]));
    const head = c.userData.head;
    for (const sd of [-1, 1]) head.add(torus(0.14, 0.02, GOLD(), [sd * 0.18, 0.07, 0.42]));
    head.add(box(0.1, 0.02, 0.02, GOLD(), [0, 0.08, 0.43]));
    const ab = group(box(0.9, 0.62, 0.08, '#5A3A1A', [0, 0, 0]));
    for (let r = 0; r < 4; r++) { ab.add(cyl(0.012, 0.012, 0.78, METAL(), [0, 0.22 - r * 0.15, 0.05], [0, 0, Math.PI / 2])); for (let k = 0; k < 5; k++) ab.add(sph(0.045, mat(k < 2 + (r % 3) ? '#C3202F' : '#EFE6D2', { clear: 0.8 }), [-0.3 + k * 0.08 + (k >= 2 + (r % 3) ? 0.25 : 0), 0.22 - r * 0.15, 0.06], [1, 1, 0.8])); }
    s.add(at(ab, [-0.85, 0.42, 0.55], [-0.35, 0.5, 0]));
  } },
  c4: { tone: '#8A93A0', build(s) {
    const c = cat({ fur: '#8A93A0', belly: '#D0D4DA', mood: 'angry' }); s.add(at(c, [-0.15, 0, 0]));
    const head = c.userData.head; const wig = mat('#F4EEDF', { rough: 0.9 });
    head.add(sph(0.48, wig, [0, 0.22, -0.12], [1.08, 0.62, 0.95]));
    for (const sd of [-1, 1]) for (let k = 0; k < 3; k++) head.add(sph(0.12, wig, [sd * 0.6, 0.02 - k * 0.2, -0.18]));
    const gavel = group(cyl(0.14, 0.14, 0.42, mat('#5A3A1A', { clear: 0.7 }), [0, 0, 0], [0, 0, Math.PI / 2]), cyl(0.04, 0.04, 0.7, mat('#6A4A2A', { clear: 0.7 }), [0, -0.36, 0]));
    s.add(at(gavel, [0.95, 1.05, 0.3], [0, 0, 0.7]));
    s.add(at(cyl(0.3, 0.34, 0.1, mat('#4A2A14', { clear: 0.7 })), [1.0, 0.05, 0.6]));
  } },
  c5: { tone: '#E06A3A', build(s) {
    const c = cat({ fur: '#F2EEE6', belly: '#FFFFFF', mood: 'smug' }); s.add(at(c, [-0.2, 0, 0]));
    const h = new THREE.Group(); h.add(cyl(0.36, 0.42, 0.3, mat('#FFFFFF', { rough: 0.9 }), [0, 0.46, 0])); h.add(sph(0.42, mat('#FFFFFF', { rough: 0.9 }), [0, 0.68, 0], [1.1, 0.6, 1.1])); c.userData.head.add(h);
    const sh = group(cyl(0.2, 0.17, 0.85, mat('#E9C38A', { rough: 0.8 }), [0, 0, 0]), cyl(0.205, 0.205, 0.12, mat('#7FB84A', { rough: 0.8 }), [0, 0.42, 0]), sph(0.09, '#D8282C', [0.05, 0.5, 0.08]), cyl(0.21, 0.18, 0.45, mat('#D8CBAE', { rough: 0.9 }), [0, -0.22, 0]));
    s.add(at(sh, [0.75, 0.75, 0.45], [0.2, 0, -0.4]));
  } },
};
