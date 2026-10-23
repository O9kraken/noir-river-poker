// 3D scenes for «Подземелье»
import * as K from '/kit3d.js';
const { THREE, sph, box, cyl, cone, torus, cap, tube, lathe, group, at, panel, textPanel, mat, GOLD, METAL, cat, person, hat, eyes, mouth, coin, coinStack, bottle, phone, spark, table, chair, extrude } = K;

const MON = '#C0392B', UND = '#5FA35A', CLS = '#2F6BC4', MOD = '#E0A043', CUR = '#8A4AE0', GEAR = '#C9A06A', ONE = '#2FAE8A', LVL = '#E0C043';
const v = (x, y, z) => new THREE.Vector3(x, y, z);
function hand(p, side = 'R') { p.updateMatrixWorld(true); const w = new THREE.Vector3(); p.userData.hands[side].getWorldPosition(w); return w; }
function put(s, obj, pos, rot, scale) { s.add(at(obj, pos instanceof THREE.Vector3 ? [pos.x, pos.y, pos.z] : pos, rot, scale)); return obj; }
const glow = (c, i = 1.6) => mat(c, { emissive: c, ei: i });
const paper = () => mat('#EFE6D2', { rough: 0.85, clear: 0 });
function doc(w, h, lines = 4, stamp = null) {
  return panel(w, h, (x, cw, ch) => {
    x.fillStyle = '#F4EEDF'; x.fillRect(0, 0, cw, ch);
    x.fillStyle = '#B8A888'; for (let k = 0; k < lines; k++) x.fillRect(cw * 0.12, ch * (0.2 + k * 0.13), cw * (0.76 - (k % 2) * 0.2), ch * 0.04);
    if (stamp) { x.strokeStyle = stamp[1]; x.lineWidth = cw * 0.03; x.beginPath(); x.arc(cw * 0.68, ch * 0.78, cw * 0.17, 0, 7); x.stroke(); x.fillStyle = stamp[1]; x.font = `900 ${cw * 0.09}px MR`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(stamp[0], cw * 0.68, ch * 0.78); }
  }, { depth: 0.01, edge: '#D8CBAE' });
}
function money(w = 0.6, label = '5000') { return textPanel(w, w * 0.45, label, { bg: '#7FB86A', fg: '#1A4A1A', depth: 0.008 }); }
function coffin(h = 1.8, color = '#4A2C16') { return extrude([[-0.28 * h / 1.8, -h / 2], [0.28 * h / 1.8, -h / 2], [0.42 * h / 1.8, h / 4], [0.2 * h / 1.8, h / 2], [-0.2 * h / 1.8, h / 2], [-0.42 * h / 1.8, h / 4]], 0.3, mat(color, { clear: 0.6 })); }
function skeletonFig(o = {}) {
  const g = new THREE.Group(); const bone = mat(o.bone || '#EFE6D2', { rough: 0.6 });
  const skull = new THREE.Group(); skull.position.set(0, 1.75, 0); g.add(skull);
  skull.add(sph(0.3, bone, [0, 0, 0], [1, 1.05, 1])); skull.add(box(0.32, 0.16, 0.24, bone, [0, -0.24, 0.06], null, 0.05));
  for (const s of [-1, 1]) skull.add(sph(0.085, o.eye ? glow(o.eye, 2) : '#0A0605', [s * 0.11, 0.02, 0.26], [1, 1.15, 0.5]));
  skull.add(cone(0.04, 0.07, '#0A0605', [0, -0.08, 0.29], [Math.PI, 0, 0]));
  g.add(cyl(0.05, 0.05, 0.9, bone, [0, 1.05, 0]));
  for (let k = 0; k < 4; k++) g.add(torus(0.22 - k * 0.02, 0.03, bone, [0, 1.38 - k * 0.12, 0], [Math.PI / 2, 0, 0], Math.PI * 1.6));
  g.add(sph(0.18, bone, [0, 0.62, 0], [1.3, 0.6, 0.8]));
  for (const s of [-1, 1]) {
    g.add(cyl(0.04, 0.04, 0.6, bone, [s * 0.14, 0.3, 0])); g.add(sph(0.07, bone, [s * 0.14, 0.04, 0.05], [1, 0.6, 1.5]));
    const arm = new THREE.Group(); arm.position.set(s * 0.28, 1.42, 0); arm.rotation.set(...(o['arm' + (s < 0 ? 'L' : 'R')] || [0, 0, s * 0.3]));
    arm.add(cyl(0.035, 0.035, 0.7, bone, [0, -0.35, 0])); arm.add(sph(0.07, bone, [0, -0.72, 0])); g.add(arm);
  }
  g.userData.skull = skull;
  return g;
}
function blobMonster(color, o = {}) {
  const g = new THREE.Group(); const m = mat(color, { rough: o.rough ?? 0.45, clear: 0.5 });
  g.add(sph(0.75, m, [0, 0.75, 0], o.scale || [1, 1, 0.9]));
  eyes(g, { x: 0.25, y: 1.0, z: 0.62, r: 0.16, angry: o.angry, glow: o.glow });
  mouth(g, { y: 0.6, z: 0.7, w: 0.2, kind: o.mouth || 'fangs' });
  return g;
}
function wardrobe(open = 1.2) {
  const g = group(box(1.4, 2.3, 0.7, '#4A2C16', [0, 1.15, 0]), box(1.24, 2.1, 0.05, '#0A0605', [0, 1.15, 0.33]));
  const d = new THREE.Group(); d.position.set(-0.62, 1.15, 0.36); d.rotation.y = -open; d.add(box(0.62, 2.1, 0.05, '#6A4426', [0.31, 0, 0])); d.add(sph(0.04, GOLD(), [0.55, 0, 0.04])); g.add(d);
  return g;
}

function garment(m, { sleeves = true, collar = null, zip = GOLD() } = {}) {
  const g = new THREE.Group();
  g.add(box(1.25, 1.45, 0.55, m, [0, 1.15, 0], null, 0.22));
  if (sleeves) for (const sd of [-1, 1]) { g.add(cap(0.2, 0.85, m, [sd * 0.82, 1.05, 0], [0, 0, sd * 0.32])); g.add(sph(0.22, m, [sd * 0.64, 1.72, 0])); }
  if (collar) g.add(torus(0.28, 0.1, collar, [0, 1.88, 0], [Math.PI / 2, 0, 0]));
  if (zip) g.add(box(0.035, 1.35, 0.03, zip, [0, 1.15, 0.29]));
  return g;
}

export const DUNGEON = {
  // ================= monsters =================
  m1: { tone: MON, build(s) {
    const g = new THREE.Group(); const sh = mat('#6A3A1A', { clear: 1, rough: 0.2 });
    g.add(sph(0.6, sh, [0, 0.4, 0], [1, 0.45, 1.6])); g.add(sph(0.3, '#4A2410', [0, 0.45, 0.95], [1.2, 0.8, 0.9]));
    eyes(g, { x: 0.13, y: 0.6, z: 1.15, r: 0.09 });
    for (const sd of [-1, 1]) { g.add(tube([[sd * 0.1, 0.65, 1.15], [sd * 0.5, 1.4, 1.5], [sd * 0.9, 1.9, 1.0]], 0.02, '#2A1408')); for (const z of [-0.5, 0, 0.5]) g.add(tube([[sd * 0.5, 0.35, z], [sd * 0.95, 0.5, z + 0.1], [sd * 1.2, 0.05, z + 0.2]], 0.035, '#3A1A08')); }
    g.add(box(0.02, 0.05, 1.6, '#2A1408', [0, 0.67, -0.1]));
    put(s, g, [0, 0, -0.2], [0, 0.5, 0]);
    put(s, textPanel(0.7, 0.28, 'с 1987 г.', { bg: '#1A0A06', fg: '#F0D48A' }), [-0.9, 0.25, 0.9], [-0.4, 0.4, 0]);
  } },
  m2: { tone: UND, build(s) {
    const mug = group(lathe([[0, 0], [0.55, 0], [0.58, 0.05], [0.58, 1.1], [0.52, 1.1], [0.52, 0.1], [0, 0.1]], mat('#EFE6D2', { clear: 0.8, rough: 0.2 })));
    mug.add(torus(0.3, 0.07, mat('#EFE6D2', { clear: 0.8 }), [0.7, 0.55, 0], [0, 0, 0], Math.PI * 1.2));
    const mold = mat('#7FB86A', { rough: 1, clear: 0, sheen: 1, sheenColor: '#CFFFA0' });
    mug.add(cyl(0.53, 0.53, 0.2, mold, [0, 1.0, 0]));
    for (const [x, y, z, r] of [[-0.2, 1.25, 0.1, 0.25], [0.2, 1.3, -0.1, 0.3], [0, 1.45, 0.15, 0.22], [0.35, 1.15, 0.3, 0.15]]) mug.add(sph(r, mold, [x, y, z]));
    eyes(mug, { x: 0.16, y: 1.45, z: 0.35, r: 0.1 }); mouth(mug, { y: 1.28, z: 0.44, w: 0.08, kind: 'smile' });
    const lab = textPanel(0.6, 0.25, 'ЛУЧШИЙ ПАПА', { bg: '#EFE6D2', fg: '#6A1C22', depth: 0.005 }); lab.position.set(0, 0.55, 0.585); mug.add(lab);
    put(s, mug, [0, 0, 0], [0, -0.35, 0]);
  } },
  m3: { tone: MON, build(s) {
    const p = person({ shirt: '#3A5A8A', pants: '#2A3A5A', hair: '#6A3A1A', angry: true, mouth: 'grin', armR: [-1.4, 0.1], armL: [-1.2, -0.3] });
    put(s, p, [-0.35, 0, 0], [0, 0.35, 0]);
    const drill = group(box(0.25, 0.3, 0.7, mat('#E0A043', { clear: 0.7 }), [0, 0, 0], null, 0.05), cyl(0.04, 0.02, 0.6, METAL(), [0, 0.02, 0.6], [Math.PI / 2, 0, 0]), box(0.15, 0.45, 0.18, '#26282C', [0, -0.3, -0.12], null, 0.04));
    put(s, drill, hand(p).add(v(0, 0.12, 0.15)), [0, 0.35, 0]);
    for (const [x, y] of [[1.1, 1.5], [1.25, 1.1], [1.15, 0.75]]) put(s, spark('#FFD866', 0.04), [x, y, 0.9]);
    put(s, textPanel(0.7, 0.32, '8:00', { bg: '#0A0A0C', fg: '#FF5A5A', emissive: 1.2, depth: 0.06 }), [1.05, 2.2, -0.6], [0, -0.3, 0]);
  } },
  m4: { tone: MON, build(s) {
    const g = new THREE.Group(); const f = mat('#7A8290', { rough: 0.7, sheen: 0.5, sheenColor: '#9FC0A0' });
    g.add(sph(0.6, f, [0, 0.8, 0], [1, 0.9, 1.25])); g.add(sph(0.38, mat('#8A93A0', { rough: 0.7 }), [0, 1.45, 0.45]));
    g.add(sph(0.3, mat('#5A8A6A', { rough: 0.5, metal: 0.3 }), [0, 1.2, 0.35], [1.2, 0.8, 0.9]));
    eyes(g, { x: 0.17, y: 1.55, z: 0.72, r: 0.09, iris: '#FF8A3A', angry: true });
    g.add(cone(0.1, 0.3, '#E0A043', [0, 1.45, 0.92], [Math.PI / 2, 0, 0]));
    for (const sd of [-1, 1]) { g.add(sph(0.35, f, [sd * 0.55, 0.85, -0.1], [0.3, 0.7, 1.1])); g.add(cyl(0.03, 0.03, 0.4, '#E0A043', [sd * 0.18, 0.2, 0.1])); g.add(box(0.2, 0.03, 0.2, '#E0A043', [sd * 0.18, 0.02, 0.18])); }
    put(s, g, [-0.15, 0, 0], [0, 0.5, 0]);
    put(s, group(cyl(0.16, 0.13, 0.6, mat('#E9C38A', { rough: 0.8 })), cyl(0.165, 0.165, 0.1, '#7FB84A', [0, 0.3, 0])), [0.95, 1.2, 0.6], [0.4, 0, -0.9]);
  } },
  m5: { tone: MON, build(s) {
    const p = person({ shirt: '#5A3A6A', pants: '#3A2A3A', skin: '#E0BC94', angry: true, mouth: 'sad', armL: [-0.6, -0.5], armR: [-0.6, 0.5], belly: true });
    p.userData.head.add(sph(0.4, mat('#C3202F', { rough: 0.85 }), [0, 0.06, -0.14], [1.08, 1.06, 1.0])); p.userData.head.add(sph(0.08, mat('#C3202F', { rough: 0.85 }), [0.12, -0.38, 0.12]));
    put(s, p, [0.1, 0.35, 0]);
    put(s, group(box(1.8, 0.1, 0.5, '#5A3A1A', [0, 0.35, 0]), box(0.08, 0.35, 0.4, '#3A2414', [-0.8, 0.17, 0]), box(0.08, 0.35, 0.4, '#3A2414', [0.8, 0.17, 0])), [0, 0, -0.1]);
    put(s, group(cyl(0.12, 0.1, 0.18, '#EFE6D2'), sph(0.11, mat('#7A4A1A', { rough: 0.9 }), [0, 0.1, 0], [1, 0.4, 1])), [0.95, 0.5, 0.4]);
  } },
  m6: { tone: MON, build(s) {
    const g = new THREE.Group();
    g.add(box(1.2, 0.9, 0.9, mat('#C9A06A', { rough: 0.9, clear: 0 }), [0, 1.0, 0], null, 0.03));
    g.add(box(1.22, 0.08, 0.2, '#B08A50', [0, 1.46, 0])); g.add(box(0.16, 0.92, 0.92, '#B08A50', [0, 1.0, 0]));
    eyes(g, { x: 0.25, y: 1.05, z: 0.46, r: 0.12, angry: true }); mouth(g, { y: 0.78, z: 0.46, w: 0.1, kind: 'flat' });
    for (const sd of [-1, 1]) { g.add(cyl(0.06, 0.06, 0.6, '#26282C', [sd * 0.35, 0.32, 0])); g.add(sph(0.09, '#111', [sd * 0.35, 0.04, 0.08], [1, 0.6, 1.4])); }
    put(s, g, [-0.1, 0, 0], [0, 0.3, 0]);
    put(s, group(box(0.8, 0.06, 0.25, '#2A2C30', [0, 0.12, 0]), cyl(0.12, 0.12, 0.06, '#111', [-0.32, 0.08, 0], [0, 0, Math.PI / 2]), cyl(0.12, 0.12, 0.06, '#111', [0.32, 0.08, 0], [0, 0, Math.PI / 2]), cyl(0.025, 0.025, 1.1, METAL(), [0.36, 0.65, 0], [0, 0, 0.2])), [0.95, 0, 0.5], [0, -0.6, 0]);
    put(s, textPanel(1.0, 0.32, '«уже еду!»', { bg: '#1A1612', fg: '#F0D48A', depth: 0.03 }), [-0.95, 2.05, -0.3], [0, 0.4, 0.06]);
  } },
  m7: { tone: UND, build(s) {
    put(s, wardrobe(1.5), [0, 0, -0.5]);
    const sk = skeletonFig({ armR: [0, 0, 2.4], armL: [0, 0, -0.4] }); put(s, sk, [0, 0, -0.25], [0, 0.1, 0], 0.95);
    mouth(sk.userData.skull, { y: -0.22, z: 0.2, w: 0.1, kind: 'grin' });
  } },
  m8: { tone: MON, build(s) {
    const ph = phone((x, cw, ch) => { const g = x.createLinearGradient(0, 0, 0, ch); g.addColorStop(0, '#1E4A8A'); g.addColorStop(1, '#0A1A3A'); x.fillStyle = g; x.fillRect(0, 0, cw, ch); x.fillStyle = '#E8C49A'; x.beginPath(); x.arc(cw / 2, ch * 0.32, cw * 0.2, 0, 7); x.fill(); x.fillStyle = '#0A0A0A'; x.beginPath(); x.arc(cw * 0.42, ch * 0.3, cw * 0.025, 0, 7); x.arc(cw * 0.58, ch * 0.3, cw * 0.025, 0, 7); x.fill(); x.strokeStyle = '#0A0A0A'; x.lineWidth = cw * 0.02; x.beginPath(); x.arc(cw / 2, ch * 0.34, cw * 0.09, 0.2, Math.PI - 0.2); x.stroke(); x.fillStyle = '#C3202F'; x.beginPath(); x.moveTo(cw * 0.47, ch * 0.45); x.lineTo(cw * 0.53, ch * 0.45); x.lineTo(cw * 0.55, ch * 0.6); x.lineTo(cw / 2, ch * 0.65); x.lineTo(cw * 0.45, ch * 0.6); x.fill(); x.fillStyle = '#5BFF8A'; x.font = `800 ${cw * 0.1}px MR`; x.textAlign = 'center'; x.fillText('ОДОБРЕНО!', cw / 2, ch * 0.8); }, { w: 1.0, h: 1.8 });
    put(s, ph, [0, 1.05, 0], [0, -0.25, 0.08]);
    for (const sd of [-1, 1]) put(s, cap(0.06, 0.5, mat('#111215'), null), [sd * 0.7, 0.9, 0.1], [0, 0, sd * 0.8]);
    for (const r of [0.35, 0.55, 0.75]) put(s, torus(r, 0.025, glow('#FFD866', 0.8), null, null, Math.PI * 0.5), [0.7, 1.8, 0], [0, 0, -0.3]);
  } },
  m9: { tone: UND, build(s) {
    const p = person({ skin: '#8ABF7A', shirt: '#3A3C44', pants: '#26282C', tie: '#C3202F', mouth: 'o', hair: '#2A2A1A', armL: [-1.45, -0.1], armR: [-1.45, 0.1] });
    put(s, p, [0, 0, 0], [0, -0.15, 0]);
    put(s, doc(0.55, 0.75, 4), hand(p, 'R').add(v(0, 0.1, 0.15)), [-0.3, -0.2, 0.2]);
    p.userData.head.add(box(0.06, 0.06, 0.04, '#7A1A16', [0.15, 0.2, 0.31]));
  } },
  m10: { tone: MON, build(s) {
    const ph = phone((x, cw, ch) => { x.fillStyle = '#0E1A14'; x.fillRect(0, 0, cw, ch); for (let k = 0; k < 6; k++) { x.fillStyle = k % 2 ? '#2F6BC4' : '#3A3C44'; const w = cw * (0.5 + (k % 3) * 0.12); x.beginPath(); x.roundRect(k % 2 ? cw - w - cw * 0.06 : cw * 0.06, ch * (0.08 + k * 0.15), w, ch * 0.1, cw * 0.04); x.fill(); } }, { w: 1.0, h: 1.8 });
    put(s, ph, [-0.15, 1.05, 0], [0, 0.2, -0.06]);
    const badge = group(sph(0.38, mat('#D8282C', { clear: 0.8 }), [0, 0, 0], [1, 1, 0.4])); const t = textPanel(0.55, 0.32, '348', { bg: '#D8282C', fg: '#ffffff', depth: 0.005 }); t.position.set(0, 0, 0.16); badge.add(t);
    put(s, badge, [0.45, 1.95, 0.3]);
    for (const [x, y] of [[0.9, 1.3], [1.05, 0.9], [0.95, 0.5]]) put(s, textPanel(0.34, 0.2, '₽', { bg: '#2F6BC4', fg: '#fff', depth: 0.04 }), [x, y, 0.2], [0, -0.3, 0.2]);
  } },
  m11: { tone: UND, build(s) {
    const gh = lathe([[0, 2.2], [0.35, 2.15], [0.6, 1.9], [0.7, 1.3], [0.75, 0.6], [0.85, 0.2], [0.6, 0.1], [0, 0.15]], mat('#E8F0F8', { rough: 0.3, opacity: 0.82, clear: 0.6, emissive: '#A0C8FF', ei: 0.25 }));
    const g = group(gh); eyes(g, { x: 0.22, y: 1.65, z: 0.55, r: 0.13, iris: '#1A2A3A', pupil: '#1A2A3A' }); g.add(sph(0.11, '#1A2A3A', [0, 1.3, 0.66], [1, 1.3, 0.5]));
    put(s, g, [-0.25, 0, 0]);
    const ph = phone((x, cw, ch) => { x.fillStyle = '#1A1A24'; x.fillRect(0, 0, cw, ch); x.fillStyle = '#E06A72'; x.font = `900 ${cw * 0.6}px MR`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('♥', cw / 2, ch / 2); }, { w: 0.5, h: 0.9 });
    put(s, ph, [0.75, 1.15, 0.45], [0, -0.4, -0.2]);
    const pl = new THREE.PointLight('#A0C8FF', 4, 3); pl.position.set(-0.2, 1.4, 1); s.add(pl);
  } },
  m12: { tone: MON, build(s) {
    put(s, group(box(2.4, 0.9, 0.6, '#5A3A1A', [0, 0.45, 0], null, 0.03), box(2.5, 0.06, 0.7, '#3A2414', [0, 0.92, 0])), [0, 0, 0.55]);
    const p = person({ shirt: '#2A3A5A', pants: '#1A2A44', angry: true, mouth: 'flat', armL: [-1.2, -0.2], armR: [-1.2, 0.2] });
    p.userData.head.add(hat('peaked', mat('#1A2A44', { rough: 0.6 })));
    put(s, p, [0, 0.1, -0.15]);
    const sign = textPanel(1.6, 0.4, 'НЕ ПОЛОЖЕНО', { bg: '#F4EEDF', fg: '#B0242F', depth: 0.03 }); put(s, sign, [0, 0.55, 0.87]);
  } },
  m13: { tone: UND, build(s) {
    const p = person({ skin: '#D8C8B0', shirt: '#2A1A3A', pants: '#2A1A3A', angry: true, mouth: 'grin', armR: [-0.3, 0.1], armL: [-1.0, -0.6] });
    p.userData.head.add(sph(0.38, mat('#8A8F98', { rough: 0.9 }), [0, 0.12, -0.05], [1.02, 0.8, 1])); p.userData.head.add(sph(0.18, mat('#8A8F98', { rough: 0.9 }), [0, 0.42, -0.15]));
    put(s, p, [-0.3, 0, 0]);
    const staff = group(cyl(0.04, 0.05, 2.4, mat('#4A2A14', { rough: 0.6 }), [0, 1.2, 0]), sph(0.2, '#EFE6D2', [0, 2.5, 0]));
    const sk = staff.children[1]; eyes(staff, { x: 0.07, y: 2.52, z: 0.17, r: 0.055, glow: '#7FFF9A' });
    put(s, staff, [0.45, 0, 0.25], [0, 0, -0.08]);
    const gl = new THREE.PointLight('#7FFF9A', 5, 3); gl.position.set(0.5, 2.4, 0.5); s.add(gl);
    for (const [x, z] of [[-1.1, 0.7], [1.15, 0.6]]) put(s, group(sph(0.16, '#EFE6D2'), sph(0.04, '#000', [-0.06, 0.02, 0.14]), sph(0.04, '#000', [0.06, 0.02, 0.14])), [x, 0.15, z]);
    void sk;
  } },
  m14: { tone: MON, build(s) {
    const p = person({ shirt: '#15161A', pants: '#15161A', angry: true, mouth: 'flat', armL: [-0.4, -0.25], armR: [-0.4, 0.25] });
    for (const sd of [-1, 1]) { p.add(box(0.05, 0.5, 0.3, '#EFE6D2', [sd * 0.34, 1.0, 0.18], [0, 0, sd * 0.1])); p.add(box(0.03, 0.55, 0.03, '#EFE6D2', [sd * 0.16, 0.32, 0.12])); }
    const c = hat('cap', mat('#1A1A1E', { rough: 0.7 })); p.userData.head.add(c);
    put(s, p, [0, -0.25, 0], [0, 0, 0], 1);
    p.position.y = -0.25; p.scale.set(1.05, 0.85, 1.05);
    for (const [x, z] of [[0.8, 0.8], [0.95, 0.6], [0.7, 0.95], [-0.9, 0.7]]) put(s, sph(0.03, '#1A1A1A', null, [1, 0.6, 1.6]), [x, 0.03, z]);
  } },
  m15: { tone: MON, build(s) {
    const cl = lathe([[0, 0], [0.75, 0], [0.6, 0.8], [0.45, 1.5], [0.3, 1.75], [0, 1.8]], mat('#0E0E12', { rough: 0.6 }));
    const g = group(cl, sph(0.34, mat('#0E0E12', { rough: 0.6 }), [0, 1.95, 0])); eyes(g, { x: 0.12, y: 1.98, z: 0.27, r: 0.06, glow: '#FF2A2A' });
    put(s, g, [-0.15, 0, 0]);
    put(s, group(cyl(0.06, 0.13, 1.4, mat('#5A3A1A', { clear: 0.6 })), cyl(0.14, 0.14, 0.08, '#3A2414', [0, 0.7, 0])), [0.75, 1.2, 0.3], [0, 0, -0.5]);
    put(s, doc(0.55, 0.75, 4, ['ДОЛГ', '#B0242F']), [-1.0, 0.45, 0.6], [-0.3, 0.4, 0.15]);
    const pl = new THREE.PointLight('#FF2A2A', 3, 2.5); pl.position.set(-0.1, 2.0, 0.8); s.add(pl);
  } },
  m16: { tone: UND, build(s) {
    const p = person({ skin: '#D8D0E0', shirt: '#1A1A1E', pants: '#1A1A1E', mouth: 'fangs', hairTop: true, hair: '#0A0A0C', armL: [-0.5, -0.9], armR: [-1.3, 0.15] });
    put(s, p, [0, 0, 0]);
    const capeL = extrude([[0, 0], [1.1, -0.4], [1.0, -1.6], [0, -1.4]], 0.04, mat('#5A0A14', { rough: 0.5, clear: 0.5 }));
    put(s, capeL, [-0.55, 1.15, -0.25], [0, 0.3, 0.4]); put(s, capeL.clone(), [0.55, 1.15, -0.25], [0, -0.3, -0.4]);
    const can = group(cyl(0.12, 0.12, 0.38, mat('#2A8A2A', { metal: 0.6, rough: 0.3 })), cyl(0.1, 0.1, 0.02, METAL(), [0, 0.2, 0]));
    put(s, can, hand(p).add(v(0, 0.12, 0.05)));
  } },
  m17: { tone: MON, build(s) {
    const g = new THREE.Group(); const wood = mat('#7A4A22', { clear: 0.6 });
    g.add(box(1.8, 0.8, 1.1, wood, [0, 0.4, 0], null, 0.05));
    const lid = new THREE.Group(); lid.position.set(0, 0.8, -0.55); lid.rotation.x = -0.7;
    lid.add(cyl(0.55, 0.55, 1.8, wood, [0, 0, 0.55], [0, 0, Math.PI / 2], 32)); g.add(lid);
    for (let k = 0; k < 7; k++) { g.add(cone(0.07, 0.2, '#F4EEDF', [-0.75 + k * 0.25, 0.9, 0.5])); lid.add(cone(0.07, 0.2, '#F4EEDF', [-0.75 + k * 0.25, -0.1, 1.0], [Math.PI, 0, 0])); }
    g.add(box(1.82, 0.08, 1.12, GOLD(), [0, 0.55, 0])); g.add(sph(0.28, mat('#C0392B', { rough: 0.4 }), [0, 0.85, 0.2], [1.6, 0.4, 1]));
    eyes(lid, { x: 0.35, y: 0.3, z: 0.95, r: 0.13, glow: '#FFE07A' });
    put(s, g, [0, 0, 0], [0, -0.25, 0]);
    const house = group(box(0.5, 0.4, 0.4, '#E9DEC6', [0, 0.2, 0]), cone(0.42, 0.35, '#B0242F', [0, 0.57, 0], [0, Math.PI / 4, 0]));
    put(s, house, [0.95, 0, 0.85], [0, -0.4, 0], 0.8);
    put(s, textPanel(0.9, 0.3, '30 ЛЕТ', { bg: '#1A0A06', fg: '#F0D48A', depth: 0.03 }), [-0.95, 0.2, 0.9], [-0.4, 0.3, 0]);
  } },
  m18: { tone: UND, build(s) {
    const p = person({ skin: '#D8D0C0', shirt: '#1A1A1E', pants: '#1A1A1E', mouth: 'grin', armR: [-1.3, 0.3], armL: [-0.2, -0.2] });
    p.userData.head.add(hat('top', mat('#0A0A0C', { rough: 0.4 })));
    put(s, p, [-0.4, 0, 0], [0, 0.4, 0]);
    put(s, coffin(1.9), [0.75, 0.95, -0.35], [0, -0.35, 0]);
    const tape = group(cyl(0.12, 0.12, 0.08, mat('#E0A043', { clear: 0.6 }), [0, 0, 0], [Math.PI / 2, 0, 0]), box(0.9, 0.06, 0.005, '#F0D48A', [0.45, -0.08, 0]));
    put(s, tape, hand(p).add(v(0, 0, 0.1)), [0, -0.3, -0.2]);
  } },
  m19: { tone: MON, build(s) {
    const p = person({ shirt: '#26282C', pants: '#26282C', tie: '#B0242F', mouth: 'grin', hair: '#5A5E66', armR: [-2.3, 0.2], armL: [-0.2, -0.25], belly: true });
    put(s, p, [-0.35, 0, 0.1]);
    const clock = group(cyl(0.45, 0.45, 0.1, '#1A1A1E', [0, 0, 0], [Math.PI / 2, 0, 0]));
    const face = panel(0.78, 0.78, (x, cw) => { x.fillStyle = '#F4EEDF'; x.beginPath(); x.arc(cw / 2, cw / 2, cw / 2, 0, 7); x.fill(); x.strokeStyle = '#111'; x.lineWidth = cw * 0.04; x.beginPath(); x.moveTo(cw / 2, cw / 2); x.lineTo(cw / 2, cw * 0.2); x.moveTo(cw / 2, cw / 2); x.lineTo(cw * 0.53, cw * 0.72); x.stroke(); x.fillStyle = '#B0242F'; x.font = `900 ${cw * 0.13}px MR`; x.textAlign = 'center'; x.fillText('18:05', cw / 2, cw * 0.9); }, { depth: 0.01, edge: '#1A1A1E' });
    face.position.z = 0.06; clock.add(face);
    put(s, clock, [0.85, 1.9, -0.3], [0, -0.3, 0]);
    put(s, doc(0.5, 0.68, 4), hand(p).add(v(0, 0.15, 0.1)), [0, 0, 0.1]);
    put(s, textPanel(0.5, 0.3, 'ПТ', { bg: '#B0242F', fg: '#fff', depth: 0.04 }), [0.95, 1.2, 0.2], [0, -0.3, 0]);
  } },
  m20: { tone: UND, build(s) {
    const robe = lathe([[0, 0], [0.8, 0], [0.55, 0.9], [0.4, 1.5], [0, 1.55]], mat('#2A1A44', { rough: 0.6 }));
    const sk = skeletonFig({ eye: '#7FFF9A', armL: [-1.2, 0, -0.2], armR: [-1.2, 0, 0.2] });
    const g = group(robe); put(s, g, [0, 0, 0]); put(s, sk, [0, 0.05, 0]);
    sk.userData.skull.add(hat('crown', null));
    const calc = group(box(0.55, 0.75, 0.08, '#1A1C20', [0, 0, 0], null, 0.03)); const scr = textPanel(0.42, 0.16, '-999 999', { bg: '#04140A', fg: '#5BFF8A', emissive: 1.2, depth: 0.005 }); scr.position.set(0, 0.22, 0.045); calc.add(scr);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) calc.add(box(0.1, 0.08, 0.03, '#5A5E66', [-0.14 + c * 0.14, 0.02 - r * 0.13, 0.05]));
    put(s, calc, [0, 1.05, 0.55], [-0.3, 0, 0]);
    const pl = new THREE.PointLight('#7FFF9A', 5, 3); pl.position.set(0, 1.9, 0.8); s.add(pl);
  } },
  m21: { tone: MON, build(s) {
    const g = new THREE.Group(); const body = mat('#F0E6D0', { clear: 0.8, rough: 0.25 });
    g.add(box(2.4, 1.1, 1.0, body, [0, 0.85, 0], null, 0.15));
    for (let k = 0; k < 4; k++) g.add(box(0.42, 0.38, 0.02, mat('#1E2E4A', { rough: 0.1, clear: 1 }), [-0.85 + k * 0.5, 1.05, 0.51]));
    g.add(box(0.5, 0.45, 0.02, mat('#1E2E4A', { rough: 0.1, clear: 1 }), [1.18, 1.05, 0.2], [0, Math.PI / 2, 0]));
    for (const x of [-0.8, 0.8]) for (const z of [-0.5, 0.5]) g.add(cyl(0.25, 0.25, 0.15, '#111', [x, 0.25, z], [Math.PI / 2, 0, 0]));
    for (const sd of [-1, 1]) g.add(cone(0.16, 0.35, mat('#5A5E66', { rough: 0.8 }), [0.9, 1.55, sd * 0.3], [0, 0, -0.2]));
    eyes(g, { x: 0.2, y: 0.8, z: 0.0, r: 0.1, glow: '#FFE07A' }); g.children.slice(-2).forEach((e) => { e.position.x += 1.2; });
    g.add(box(0.1, 0.12, 0.6, '#F4EEDF', [1.22, 0.55, 0]));
    put(s, g, [0, 0, 0], [0, -0.55, 0], 0.85);
    const moon = sph(0.32, mat('#F4EEDF', { emissive: '#F4EEDF', ei: 1.2 })); moon.castShadow = false; put(s, moon, [-1.2, 2.3, -1.2]);
    put(s, textPanel(0.6, 0.22, '№ 666', { bg: '#1A1A1E', fg: '#F0D48A', emissive: 0.5, depth: 0.02 }), [-0.2, 1.45, 0.65], [0, -0.55, 0]);
  } },
  m22: { tone: MON, build(s) {
    const g = new THREE.Group();
    for (let k = 0; k < 5; k++) g.add(at(doc(1.1, 0.4, 2), [0, 0.3 + k * 0.32, 0], [Math.PI / 2 - 0.1 * (k % 2 ? 1 : -1), 0.15 * (k - 2), 0]));
    for (let k = 0; k < 5; k++) g.add(box(1.0, 0.3, 0.8, paper(), [0, 0.3 + k * 0.32, -0.02]));
    g.add(box(0.8, 0.55, 0.6, paper(), [0, 1.95, 0]));
    eyes(g, { x: 0.18, y: 2.0, z: 0.31, r: 0.1, glow: '#FF3A3A' });
    for (const sd of [-1, 1]) g.add(at(box(0.3, 1.1, 0.3, paper()), [sd * 0.75, 1.15, 0], [0, 0, sd * 0.6]));
    const pct = textPanel(0.36, 0.36, '%', { bg: '#B0242F', fg: '#fff', depth: 0.03 }); pct.position.set(0, 1.2, 0.42); g.add(pct);
    put(s, g, [0, 0, 0], [0, -0.2, 0]);
  } },
  m23: { tone: UND, build(s) {
    const p = person({ skin: '#D8CBAE', shirt: '#D8CBAE', pants: '#D8CBAE', shoes: '#C9B890', mouth: 'flat', glow: '#FFE07A', armL: [-1.4, -0.1], armR: [-1.4, 0.1] });
    const band = mat('#B8A888', { rough: 1 });
    for (let k = 0; k < 9; k++) p.add(torus(0.36 - Math.abs(k - 4) * 0.02, 0.025, band, [0, 0.55 + k * 0.17, 0], [Math.PI / 2 + (k % 2 ? 0.25 : -0.25), 0, 0]));
    for (let k = 0; k < 3; k++) p.userData.head.add(torus(0.36, 0.022, band, [0, -0.1 + k * 0.14, 0], [Math.PI / 2 + (k % 2 ? 0.3 : -0.3), 0, 0]));
    put(s, p, [0, 0, 0], [0, -0.1, 0]);
    const env = group(box(0.7, 0.45, 0.03, '#E9DEC6')); const lab = textPanel(0.5, 0.14, 'ПЕНСИЯ', { bg: '#E9DEC6', fg: '#6A1C22', depth: 0.005 }); lab.position.z = 0.02; env.add(lab);
    put(s, env, hand(p).add(v(-0.35, 0.05, 0.12)), [-0.2, 0, 0]);
  } },
  m24: { tone: MON, build(s) {
    put(s, table(2.2, 1.0, 0.75), [0, 0, -0.1]);
    const c = cat({ fur: '#16181B', belly: '#2A2C30', mood: 'smug' }); put(s, c, [-0.35, 0.79, -0.15], [0, 0.4, 0], 0.7);
    const lap = new THREE.Group(); lap.add(box(0.8, 0.04, 0.55, METAL())); const scr = panel(0.8, 0.52, (x, cw, ch) => { x.fillStyle = '#2F6BC4'; x.fillRect(0, 0, cw, ch); }, { emissive: 0.6, depth: 0.02, edge: '#555' }); scr.position.set(0, 0.26, -0.28); scr.rotation.x = -0.3; lap.add(scr);
    put(s, lap, [0.95, 0.9, 0.2], [0.2, -0.4, -0.55]);
    for (const [x, y] of [[1.35, 1.4], [1.45, 1.1]]) put(s, spark('#FFD866', 0.04), [x, y, 0.4]);
  } },
  m25: { tone: MON, build(s) {
    const p = person({ shirt: '#3A3C44', pants: '#26282C', beard: '#E9DEC6', hair: '#D8D0C0', glasses: '#111', armL: [-1.6, -0.3], armR: [-1.6, 0.3], mouth: 'flat' });
    put(s, p, [0, 0, 0]);
    const kb = group(box(1.1, 0.06, 0.4, '#1A1A1E', [0, 0, 0], null, 0.02)); for (let r = 0; r < 3; r++) for (let c = 0; c < 10; c++) kb.add(box(0.08, 0.03, 0.08, '#3A3C44', [-0.45 + c * 0.1, 0.04, -0.12 + r * 0.12]));
    put(s, kb, [0, 1.0, 0.65], [0.3, 0, 0]);
    for (const sd of [-1, 1]) put(s, tube([[sd * 0.4, 0.05, -0.3], [sd * 1.0, 0.8, -0.5], [sd * 0.9, 1.8, -0.4], [sd * 0.4, 2.3, -0.3]], 0.04, mat(sd < 0 ? '#2FAE6A' : '#2F6BC4', { clear: 0.6 })));
    put(s, textPanel(0.7, 0.25, 'sudo', { bg: '#04140A', fg: '#5BFF8A', emissive: 1.2, depth: 0.02 }), [0, 2.45, -0.2]);
  } },
  m26: { tone: MON, build(s) {
    const tub = group(lathe([[0, 0.1], [1.2, 0.1], [1.25, 0.15], [1.2, 0.7], [1.1, 0.7], [1.05, 0.2], [0, 0.2]], mat('#F4EEDF', { clear: 1, rough: 0.15 })));
    tub.scale.set(1, 1, 0.55); for (const x of [-0.9, 0.9]) for (const z of [-0.45, 0.45]) tub.add(sph(0.08, GOLD(), [x, 0.06, z]));
    put(s, tub, [0, 0, 0]);
    const t = mat('#2A5A3A', { clear: 0.8, rough: 0.3 });
    for (const [x, z, hgt, b] of [[-0.6, 0.1, 1.9, 0.5], [0.1, -0.05, 2.3, -0.4], [0.65, 0.15, 1.7, 0.6], [-0.15, 0.25, 1.4, 0.9]]) {
      put(s, tube([[x, 0.4, z], [x + b * 0.3, hgt * 0.5, z + 0.1], [x - b * 0.2, hgt * 0.8, z + 0.2], [x + b * 0.4, hgt, z + 0.1]], 0.11, t));
      put(s, sph(0.09, glow('#FFE07A', 1.4)), [x + b * 0.4, hgt, z + 0.22]);
    }
    put(s, cyl(1.0, 1.0, 0.04, mat('#0A1A12', { rough: 0.2 }), [0, 0.55, 0]), null, null, [1, 1, 0.5]);
  } },
  m27: { tone: MON, build(s) {
    [[-1.1, 0.1, -0.3], [-0.55, 0.35, 0.1], [0, 0.2, -0.4], [0.55, 0.35, 0.1], [1.1, 0.1, -0.3]].forEach(([x, z, r], i) => {
      const p = person({ shirt: '#26282C', pants: '#1A1A1E', tie: '#B0242F', hair: '#1A1A1A', mouth: 'flat', glasses: '#111', armL: [0, -0.15], armR: i === 2 ? [-1.3, 0.15] : [0, 0.15] });
      put(s, p, [x, 0, z], [0, -x * 0.25, 0], 0.68);
      if (i === 2) put(s, doc(0.4, 0.55, 3, ['ПРОВЕРКА', '#B0242F']), hand(p).add(v(0, 0.1, 0.1)), [0, 0, 0]);
    });
  } },
  m28: { tone: MON, build(s) {
    const tl = group(box(0.5, 1.4, 0.4, '#1A1A1E', [0, 1.6, 0], null, 0.06), cyl(0.06, 0.06, 0.9, '#26282C', [0, 0.45, 0]));
    [['#FF2A2A', 2.05, 2.2], ['#5A4A1A', 1.6, 0.2], ['#1A3A1A', 1.15, 0.2]].forEach(([c, y, e]) => tl.add(sph(0.15, mat(c, { emissive: c, ei: e }), [0, y, 0.18], [1, 1, 0.5])));
    tl.add(hat('crown').translateY(1.95).translateZ(0));
    put(s, tl, [0, 0, -0.4]);
    const car = (c) => group(box(0.8, 0.25, 0.42, mat(c, { clear: 1, rough: 0.2 }), [0, 0.2, 0], null, 0.08), box(0.45, 0.2, 0.38, mat(c, { clear: 1, rough: 0.2 }), [-0.05, 0.4, 0], null, 0.08), ...[-0.25, 0.25].flatMap((x) => [-0.2, 0.2].map((z) => cyl(0.1, 0.1, 0.06, '#111', [x, 0.1, z], [Math.PI / 2, 0, 0]))));
    [['#D8282C', -0.9, 0.6], ['#2F6BD4', 0, 0.85], ['#E0A043', 0.9, 0.6]].forEach(([c, x, z]) => put(s, car(c), [x, 0, z], [0, 0.3, 0]));
    const gl = new THREE.PointLight('#FF2A2A', 4, 3); gl.position.set(0, 2.1, 0.4); s.add(gl);
  } },
  m29: { tone: UND, build(s) {
    const cl = lathe([[0, 0], [0.85, 0], [0.62, 0.9], [0.45, 1.6], [0, 1.7]], mat('#08080C', { rough: 0.7 }));
    const g = group(cl, sph(0.38, mat('#08080C', { rough: 0.7 }), [0, 1.95, 0]), cone(0.4, 0.6, mat('#08080C', { rough: 0.7 }), [0, 2.25, -0.08]));
    eyes(g, { x: 0.14, y: 1.98, z: 0.31, r: 0.07, glow: '#B58CFF' }); put(s, g, [0, 0, -0.1]);
    const book = group(box(0.95, 0.65, 0.12, '#3A1E0E', [0, 0, 0], null, 0.02), box(0.9, 0.6, 0.13, paper(), [0, 0, 0.01]));
    const pg = doc(0.42, 0.55, 5); pg.position.set(-0.22, 0, 0.08); book.add(pg); const pg2 = doc(0.42, 0.55, 5); pg2.position.set(0.22, 0, 0.08); book.add(pg2);
    put(s, book, [0, 1.15, 0.65], [-0.4, 0, 0]);
    const pl = new THREE.PointLight('#B58CFF', 6, 3); pl.position.set(0, 1.5, 1.1); s.add(pl);
  } },
  m30: { tone: MON, build(s) {
    const sk = mat('#2A6A3A', { clear: 0.7, rough: 0.35 });
    const g = new THREE.Group();
    g.add(sph(0.75, sk, [0, 0.75, 0], [1.4, 0.9, 1]));
    g.add(sph(0.42, sk, [1.15, 1.45, 0.1])); g.add(sph(0.3, sk, [1.5, 1.3, 0.1], [1.3, 0.8, 0.9]));
    eyes(g, { x: 0.17, y: 1.6, z: 0.35, r: 0.09, angry: true }); g.children.slice(-6).forEach((e) => { e.position.x += 1.15; });
    for (let k = 0; k < 4; k++) g.add(cone(0.12, 0.3, mat('#1A4A2A', { clear: 0.7 }), [-0.6 + k * 0.4, 1.45 - Math.abs(k - 1.5) * 0.12, 0]));
    g.add(tube([[-1.0, 0.5, 0], [-1.5, 0.5, 0.3], [-1.7, 0.9, 0.5]], 0.14, sk));
    for (const sd of [-1, 1]) g.add(extrude([[0, 0], [0.9, 0.5], [0.7, -0.1], [0.4, -0.3]], 0.03, mat('#3A8A4A', { clear: 0.5 }), [-0.1, 1.4, sd * 0.5], [sd * 0.5, 0, 0.3]));
    put(s, g, [-0.25, 0, 0], [0, -0.3, 0], 0.85);
    const house = group(box(0.5, 0.4, 0.4, '#E9DEC6', [0, 0.2, 0]), cone(0.42, 0.35, '#B0242F', [0, 0.57, 0], [0, Math.PI / 4, 0]));
    put(s, house, [-0.3, 1.25, 0], [0, 0.3, 0], 0.7);
    put(s, textPanel(1.0, 0.3, '40% ДОХОДА', { bg: '#1A0A06', fg: '#F0D48A', depth: 0.03 }), [0.6, 0.2, 1.0], [-0.4, -0.2, 0]);
    put(s, sph(0.1, glow('#FF7A2A', 2)), [1.85, 1.3, 0.25]);
  } },
  // ================= classes =================
  'cls-brute': { tone: CLS, build(s) {
    const p = person({ shirt: '#5A3A2A', pants: '#3A2A1A', angry: true, mouth: 'grin', hair: '#1A1A1A', armL: [0, 0, -2.4], armR: [0, 0, 2.4] });
    p.userData.hands.L.parent.rotation.set(0, 0, -2.3); p.userData.hands.R.parent.rotation.set(0, 0, 2.3);
    p.userData.hands.L.add(sph(0.2, '#E8C49A')); p.userData.hands.R.add(sph(0.2, '#E8C49A'));
    p.scale.set(1.25, 1, 1.2);
    put(s, p, [0, 0, 0]);
    put(s, group(cyl(0.12, 0.12, 1.4, METAL(), [0, 0, 0], [0, 0, Math.PI / 2]), cyl(0.3, 0.3, 0.12, '#1A1A1E', [-0.7, 0, 0], [0, 0, Math.PI / 2]), cyl(0.3, 0.3, 0.12, '#1A1A1E', [0.7, 0, 0], [0, 0, Math.PI / 2])), [0.2, 0.3, 0.8]);
  } },
  'cls-thief': { tone: CLS, build(s) {
    const p = person({ shirt: '#1A1A1E', pants: '#1A1A1E', mouth: 'grin', armR: [-1.3, 0.3], armL: [0.6, -0.3], look: [0.8, 0] });
    p.userData.head.add(box(0.62, 0.14, 0.1, '#0A0A0C', [0, 0.06, 0.3])); p.userData.head.add(hat('cap', mat('#26282C')));
    put(s, p, [-0.1, 0, 0], [0, 0.3, 0]);
    const bag = group(sph(0.35, mat('#B89C6A', { rough: 0.9 }), [0, 0, 0], [1, 1.1, 1]), cyl(0.1, 0.16, 0.18, mat('#B89C6A', { rough: 0.9 }), [0, 0.38, 0])); const r = textPanel(0.3, 0.3, '₽', { bg: '#B89C6A', fg: '#3A2414', depth: 0.005 }); r.position.set(0, 0, 0.36); bag.add(r);
    put(s, bag, hand(p).add(v(0.05, -0.25, 0.05)));
    for (const z of [0.3, 0.6, 0.9]) put(s, cyl(0.015, 0.015, 0.55, glow('#9FC7E8', 0.6)), [-1.15, 0.6 + z * 0.4, z], [0, 0, Math.PI / 2]);
  } },
  'cls-mage': { tone: CLS, build(s) {
    const p = person({ shirt: '#3A2866', pants: '#3A2866', beard: '#EFE6D2', armR: [-0.4, 0.4], armL: [-1.3, -0.3], mouth: 'flat' });
    const robe = lathe([[0, 0], [0.6, 0], [0.45, 0.8], [0.4, 1.2], [0, 1.25]], mat('#3A2866', { rough: 0.6 })); p.add(robe);
    const h = hat('wizard', mat('#3A2866', { rough: 0.6 })); p.userData.head.add(h); h.add(at(spark('#F0D48A', 0.07), [0.15, 0.6, 0.25]));
    put(s, p, [-0.25, 0, 0]);
    const staff = group(cyl(0.04, 0.05, 2.3, mat('#5A3A1A'), [0, 1.15, 0]), sph(0.17, mat('#B58CFF', { emissive: '#B58CFF', ei: 2, trans: 0.4 }), [0, 2.4, 0]));
    put(s, staff, [0.6, 0, 0.25]);
    const pl = new THREE.PointLight('#B58CFF', 6, 3); pl.position.set(0.6, 2.4, 0.6); s.add(pl);
  } },
  'cls-healer': { tone: CLS, build(s) {
    const mortar = group(lathe([[0, 0], [0.55, 0], [0.62, 0.15], [0.6, 0.6], [0.5, 0.6], [0.45, 0.15], [0, 0.15]], mat('#8A6A4A', { rough: 0.7 })));
    mortar.add(cyl(0.48, 0.48, 0.04, mat('#5A8A3A', { rough: 0.9 }), [0, 0.5, 0]));
    mortar.add(at(cap(0.08, 0.8, mat('#9A7A5A', { rough: 0.6 })), [0.25, 0.8, 0], [0, 0, -0.5]));
    put(s, mortar, [0, 0, 0.2]);
    const leaf = (c) => { const l = extrude([[0, 0], [0.18, 0.3], [0.1, 0.65], [0, 0.8], [-0.1, 0.65], [-0.18, 0.3]], 0.02, mat(c, { rough: 0.5, clear: 0.4 }), null, null, 0.01); return l; };
    [[-0.85, 1.0, 0.1, 0.5, '#5FA35A'], [-0.55, 1.5, -0.3, 0.2, '#6FB86A'], [0.8, 1.2, -0.1, -0.5, '#5FA35A'], [0.6, 1.7, -0.4, -0.2, '#7FC87A']].forEach(([x, y, z, r, c]) => put(s, leaf(c), [x, y, z], [0.2, 0, r], 1.3));
    put(s, bottle('#9FE0BC', '#F4EEDF', { h: 0.7, r: 0.16 }), [0.95, 0, 0.6]);
    put(s, spark('#9FE0BC', 0.06), [-0.2, 2.0, 0]);
  } },
  // ================= monster boosts =================
  'mod-big': { tone: MOD, build(s) { const g = blobMonster('#C0392B', { angry: true }); const sk = mat('#C0392B', { clear: 0.6, rough: 0.35 }); for (const sd of [-1, 1]) { g.add(cap(0.2, 0.55, sk, [sd * 0.85, 0.9, 0.1], [0, 0, sd * 0.9])); g.add(cap(0.18, 0.45, sk, [sd * 1.1, 1.45, 0.1], [0, 0, sd * -0.25])); g.add(sph(0.33, sk, [sd * 0.95, 1.05, 0.15])); g.add(sph(0.22, sk, [sd * 1.18, 1.75, 0.1])); } put(s, g, [0, 0, -0.1], null, 0.9); put(s, textPanel(0.7, 0.5, '+5', { bg: '#1A0A06', fg: '#F0D48A', depth: 0.06 }), [1.1, 0.35, 0.7], [0, -0.3, 0]); } },
  'mod-hungry': { tone: MOD, build(s) {
    const jaw = (up) => { const g = new THREE.Group(); g.add(sph(1.0, mat('#7A1A16', { clear: 0.6 }), [0, 0, 0], [1.1, 0.35, 0.8])); for (let k = 0; k < 9; k++) { const a = -1.2 + k * 0.3; g.add(cone(0.08, 0.28, '#F4EEDF', [Math.sin(a) * 0.95, up ? -0.22 : 0.22, Math.cos(a) * 0.6], [up ? Math.PI : 0, 0, 0])); } return g; };
    put(s, jaw(true), [0, 1.6, 0], [0.3, 0, 0]); put(s, jaw(false), [0, 0.6, 0.1], [-0.15, 0, 0]);
    put(s, sph(0.7, mat('#2A0404', { rough: 0.9 })), [0, 1.05, -0.15], null, [1.2, 0.5, 0.6]);
    put(s, sph(0.25, mat('#E06A72', { rough: 0.4, clear: 0.8 })), [0, 0.85, 0.35], null, [1.3, 0.4, 1]);
    put(s, textPanel(0.7, 0.45, '+10', { bg: '#1A0A06', fg: '#F0D48A', depth: 0.06 }), [1.05, 0.35, 0.7], [-0.2, -0.3, 0]);
  } },
  'mod-baby': { tone: MOD, build(s) {
    const g = blobMonster('#E07A6A', { mouth: 'o', scale: [1, 0.95, 0.9] }); g.scale.setScalar(0.85);
    g.add(sph(0.82, mat('#F4C8D8', { rough: 0.9 }), [0, 1.15, -0.1], [1, 0.6, 1]));
    const paci = group(cyl(0.16, 0.16, 0.05, '#7FB0E8', [0, 0, 0], [Math.PI / 2, 0, 0]), torus(0.1, 0.03, '#7FB0E8', [0, -0.12, 0.05])); g.add(at(paci, [0, 0.55, 0.78]));
    put(s, g, [0, 0, 0]);
    put(s, textPanel(0.7, 0.5, '−5', { bg: '#0E2A20', fg: '#9FE0BC', depth: 0.06 }), [1.05, 0.45, 0.5], [0, -0.3, 0]);
  } },
  'mod-sleepy': { tone: MOD, build(s) {
    const g = blobMonster('#8ABF7A', { mouth: 'sad' });
    g.children.filter((c) => c.geometry && c.geometry.type === 'SphereGeometry').slice(1, 7).forEach((c) => { if (c.position.y > 0.95 && c.position.y < 1.1) c.scale.y *= 0.25; });
    g.add(at(hat('party', mat('#E06A72', { clear: 0.6 })), [0.1, 1.35, 0], [0, 0, -0.3]));
    put(s, g, [-0.2, 0, 0]);
    put(s, bottle('#2A6A3A', '#E9DEC6'), [0.95, 0, 0.45], [0, 0, 0]);
    put(s, bottle('#2A6A3A', '#E9DEC6'), [1.05, 0.2, -0.15], [Math.PI / 2, 0.5, 0]);
    put(s, textPanel(0.7, 0.3, 'z z z', { bg: '#0A0A14', fg: '#BFE3FF', depth: 0.02 }), [-1.0, 2.0, -0.3], [0, 0.3, 0.1]);
    put(s, textPanel(0.6, 0.45, '−3', { bg: '#0E2A20', fg: '#9FE0BC', depth: 0.06 }), [-1.0, 0.4, 0.7], [0, 0.3, 0]);
  } },
  wander: { tone: '#C0397A', build(s) {
    const door = group(box(1.3, 2.3, 0.15, '#3A2414', [0, 1.15, 0]), box(1.05, 2.05, 0.02, '#020101', [0, 1.05, 0.08]));
    const d = new THREE.Group(); d.position.set(-0.52, 1.05, 0.1); d.rotation.y = -1.0; d.add(box(1.05, 2.05, 0.06, '#6A4426', [0.52, 0, 0])); d.add(sph(0.05, GOLD(), [0.95, 0, 0.05])); door.add(d);
    put(s, door, [0, 0, -0.3]);
    put(s, sph(0.06, glow('#FFE07A', 3)), [-0.15, 1.5, -0.15]); put(s, sph(0.06, glow('#FFE07A', 3)), [0.05, 1.5, -0.15]);
    put(s, sph(0.045, glow('#FF5A5A', 3)), [0.25, 0.9, -0.15]); put(s, sph(0.045, glow('#FF5A5A', 3)), [0.38, 0.92, -0.15]);
    for (const [x, z, r] of [[-0.3, 0.6, 0.2], [0.1, 1.0, -0.2], [-0.2, 1.35, 0.15]]) put(s, group(sph(0.13, mat('#7A1A3A', { rough: 0.6 }), [0, 0, 0], [1, 0.25, 1.4]), ...[-1, 0, 1].map((k) => sph(0.04, mat('#7A1A3A'), [k * 0.07, 0, 0.2], [1, 0.4, 1]))), [x, 0.02, z], [0, r, 0]);
  } },
  // ================= curses =================
  'cu-tax': { tone: CUR, build(s) {
    put(s, doc(1.2, 1.6, 6, ['ПЕНИ', '#B0242F']), [-0.15, 1.0, 0], [0, 0.2, -0.08]);
    const pct = textPanel(0.7, 0.7, '%', { bg: '#B0242F', fg: '#fff', depth: 0.1 }); put(s, pct, [0.75, 1.7, 0.4], [0, -0.3, 0.2]);
    put(s, coinStack(4), [0.9, 0, 0.6]);
    for (const [x, y] of [[-1.1, 2.0], [1.2, 0.8]]) put(s, spark('#B58CFF', 0.06), [x, y, 0.2]);
  } },
  'cu-ex': { tone: CUR, build(s) {
    const fab = mat('#C9A06A', { rough: 1, clear: 0 });
    const d = group(sph(0.38, fab, [0, 1.7, 0]), cap(0.25, 0.55, fab, [0, 1.05, 0]), cap(0.1, 0.5, fab, [-0.42, 1.15, 0], [0, 0, 1.2]), cap(0.1, 0.5, fab, [0.42, 1.15, 0], [0, 0, -1.2]), cap(0.11, 0.55, fab, [-0.15, 0.45, 0], [0, 0, 0.15]), cap(0.11, 0.55, fab, [0.15, 0.45, 0], [0, 0, -0.15]));
    for (const sd of [-1, 1]) { d.add(box(0.1, 0.02, 0.02, '#1A1A1A', [sd * 0.13, 1.74, 0.36], [0, 0, 0.7])); d.add(box(0.1, 0.02, 0.02, '#1A1A1A', [sd * 0.13, 1.74, 0.36], [0, 0, -0.7])); }
    d.add(torus(0.08, 0.015, '#1A1A1A', [0, 1.55, 0.36], [0, 0, 0], Math.PI));
    d.add(sph(0.12, mat('#E06A72', { rough: 0.6 }), [0.1, 1.2, 0.23], [1, 1, 0.4]));
    put(s, d, [0, 0, 0]);
    for (const [a, b, c] of [[[0.3, 1.9, 0.2], [1.1, 2.4, 0.6], 0], [[0.15, 1.2, 0.2], [1.1, 1.3, 0.8], 0], [[-0.2, 0.7, 0.2], [-1.0, 0.9, 0.8], 0]]) {
      put(s, tube([a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], b], 0.012, METAL()));
      put(s, sph(0.07, mat('#D8282C', { clear: 1, rough: 0.1 })), b);
    }
  } },
  'cu-crisis': { tone: CUR, build(s) {
    const scr = panel(2.0, 1.3, (x, cw, ch) => { x.fillStyle = '#06100C'; x.fillRect(0, 0, cw, ch); x.strokeStyle = '#2A3A30'; x.lineWidth = 2; for (let k = 1; k < 6; k++) { x.beginPath(); x.moveTo(0, ch * k / 6); x.lineTo(cw, ch * k / 6); x.stroke(); } x.strokeStyle = '#FF3A3A'; x.lineWidth = cw * 0.02; x.beginPath(); [[0.05, 0.2], [0.25, 0.3], [0.4, 0.25], [0.55, 0.5], [0.68, 0.45], [0.92, 0.85]].forEach(([a, b], i) => (i ? x.lineTo(a * cw, b * ch) : x.moveTo(a * cw, b * ch))); x.stroke(); x.fillStyle = '#FF3A3A'; x.font = `900 ${ch * 0.16}px MR`; x.fillText('−87%', cw * 0.62, ch * 0.2); }, { emissive: 0.8, depth: 0.08, edge: '#1A1A1E' });
    put(s, scr, [0, 1.2, -0.2], [0, 0, 0]);
    put(s, box(0.3, 0.5, 0.2, '#1A1A1E'), [0, 0.3, -0.25]);
    for (const [x, z] of [[-0.9, 0.6], [0.8, 0.8], [0.3, 0.9]]) put(s, coin(), [x, 0.02, z], [0.2, 0, 0.4]);
    const pl = new THREE.PointLight('#FF3A3A', 3, 3); pl.position.set(0, 1.2, 0.9); s.add(pl);
  } },
  'cu-flood': { tone: CUR, build(s) {
    put(s, box(3.0, 0.15, 1.5, '#E9DEC6'), [0, 2.55, -0.5]);
    put(s, cyl(1.6, 1.6, 0.25, mat('#2F6BC4', { rough: 0.05, clear: 1, trans: 0.3, opacity: 0.85 }), [0, 0.12, 0], null, 96));
    const drop = () => lathe([[0, 0], [0.12, 0.08], [0.1, 0.2], [0.04, 0.32], [0, 0.38]], mat('#5A92E6', { rough: 0.05, clear: 1, trans: 0.5 }));
    for (const [x, y, z] of [[-0.8, 1.9, 0], [-0.2, 1.4, 0.3], [0.5, 2.0, 0.1], [0.9, 1.2, 0.4], [0.1, 0.8, 0.5], [-0.6, 0.9, 0.6]]) put(s, drop(), [x, y, z], null, 1.4);
    const duck = group(sph(0.25, mat('#FFD43A', { clear: 0.8 }), [0, 0.25, 0], [1.2, 0.8, 1]), sph(0.16, mat('#FFD43A', { clear: 0.8 }), [0.15, 0.48, 0]), cone(0.06, 0.12, '#E0703A', [0.32, 0.48, 0], [0, 0, -Math.PI / 2]), sph(0.03, '#111', [0.22, 0.53, 0.1]));
    put(s, duck, [0.7, 0.18, 0.7], [0, -0.6, 0]);
  } },
  'cu-shoes': { tone: CUR, build(s) {
    const ghostShoe = mat('#E06A9A', { rough: 0.6, opacity: 0.25 });
    for (const x of [-0.45, 0.45]) put(s, group(sph(0.32, ghostShoe, [0, 0.12, 0], [1, 0.4, 1.6])), [x, 0, 0.2]);
    for (let k = 0; k < 4; k++) put(s, group(sph(0.12, mat('#5A3A2A', { rough: 0.9 }), [0, 0, 0], [1, 0.12, 1.6])), [-0.9 + k * 0.6, 0.01, 0.7 - k * 0.45], [0, -0.8, 0]);
    put(s, textPanel(0.8, 0.6, '?!', { bg: '#1A0A1A', fg: '#F0D48A', depth: 0.06 }), [0, 1.5, -0.3]);
    put(s, group(box(0.8, 0.6, 0.6, mat('#6A4A2A', { rough: 0.8 }), [0, 0.3, 0], null, 0.05)), [1.0, 0, -0.5], [0, -0.4, 0]);
  } },
  'cu-hangover': { tone: CUR, build(s) {
    const head = new THREE.Group(); head.add(sph(0.8, mat('#B8D8A0', { rough: 0.5 }), [0, 0, 0]));
    eyes(head, { x: 0.28, y: 0.08, z: 0.65, r: 0.17, lids: '#9AC080', look: [0, -0.6] }); mouth(head, { y: -0.35, z: 0.74, w: 0.2, kind: 'sad' });
    head.add(sph(0.55, mat('#7FB0E8', { rough: 0.6 }), [0, 0.65, 0], [1.2, 0.35, 1]));
    put(s, head, [-0.1, 1.05, 0]);
    put(s, bottle('#2A6A3A', null), [0.95, 0, 0.5]); put(s, bottle('#2A6A3A', null), [-1.0, 0.18, 0.5], [Math.PI / 2, 0, 0.6]);
    for (const [x, y] of [[0.8, 2.0], [1.0, 1.7], [-0.85, 2.0]]) put(s, spark('#FFD866', 0.06), [x, y, 0]);
  } },
  // ================= gear =================
  'g-helmet': { tone: GEAR, build(s) { const h = group(sph(0.85, mat('#E8B820', { clear: 1, rough: 0.25 }), [0, 0, 0], [1, 0.8, 1.1]), cyl(1.0, 1.05, 0.08, mat('#D8A810', { clear: 1 }), [0, -0.05, 0.1]), box(0.12, 0.55, 1.6, mat('#D8A810', { clear: 1 }), [0, 0.35, 0])); put(s, h, [0, 0.4, 0], [0.15, 0.6, 0]); put(s, sph(0.12, glow('#FFF2B0', 2)), [0.35, 0.9, 0.65]); } },
  'g-foil': { tone: GEAR, build(s) { const f = mat('#C9CED6', { metal: 1, rough: 0.35, clear: 0 }); const h = new THREE.Group(); const g = new THREE.ConeGeometry(0.8, 1.6, 9, 6); const p = g.attributes.position; for (let k = 0; k < p.count; k++) { p.setX(k, p.getX(k) * (1 + Math.sin(k * 1.7) * 0.06)); p.setZ(k, p.getZ(k) * (1 + Math.cos(k * 2.3) * 0.06)); } g.computeVertexNormals(); const m = new THREE.Mesh(g, f); m.castShadow = true; h.add(m); h.add(sph(0.06, glow('#FFE07A', 2), [0, 0.85, 0])); put(s, h, [0, 0.8, 0]); for (const sd of [-1, 1]) for (const r of [0.3, 0.5]) put(s, torus(r, 0.02, glow('#9FC7E8', 0.8), null, null, Math.PI * 0.4), [sd * 0.6, 1.9, 0], [0, 0, sd > 0 ? 0.6 : 1.9]); } },
  'g-crown': { tone: GEAR, build(s) { const c = new THREE.Group(); const card = mat('#F0D48A', { rough: 0.8, clear: 0 }); const sh = [[-1, 0], [1, 0], [1, 0.8], [0.6, 0.45], [0.3, 1.0], [0, 0.5], [-0.3, 1.0], [-0.6, 0.45], [-1, 0.8]]; for (let k = 0; k < 4; k++) { const e = extrude(sh, 0.02, card, null, null, 0.005); e.position.set(Math.sin(k * Math.PI / 2) * 0.7, 0.55, Math.cos(k * Math.PI / 2) * 0.7); e.rotation.y = k * Math.PI / 2; e.scale.setScalar(0.72); c.add(e); } [['#C3202F', 0, 0.75], ['#2F6BC4', -0.45, 0.6], ['#2FAE6A', 0.45, 0.6]].forEach(([col, x, z]) => c.add(sph(0.08, mat(col, { clear: 1, rough: 0.1 }), [x, 0.45, z]))); put(s, c, [0, 0, 0], [0.1, 0.3, 0]); put(s, textPanel(0.9, 0.25, 'картон, 1 шт.', { bg: '#1A1612', fg: '#C9B590', depth: 0.02 }), [0.8, 0.15, 1.0], [-0.5, -0.3, 0]); } },
  'g-jacket': { tone: GEAR, build(s) { const m = mat('#2A3A5A', { rough: 0.55, clear: 0.5, sheen: 0.6, sheenColor: '#7FA0D0' }); const j = garment(m, { collar: mat('#8A7A60', { rough: 1, sheen: 1 }), zip: METAL() }); for (let k = 0; k < 5; k++) j.add(box(1.28, 0.05, 0.58, mat('#1E2A44', { rough: 0.6 }), [0, 0.55 + k * 0.29, 0], null, 0.02)); for (const sd of [-1, 1]) for (let k = 0; k < 3; k++) j.add(at(torus(0.21, 0.025, mat('#1E2A44'), null, [Math.PI / 2, 0, 0]), [sd * (0.72 + k * 0.1), 1.5 - k * 0.28, 0], [0, 0, sd * 0.32])); put(s, j, [0, 0.05, 0], [0, 0.25, 0], 0.82); } },
  'g-vest': { tone: GEAR, build(s) { const v = group(box(1.3, 1.6, 0.6, mat('#3A4A2A', { rough: 0.8 }), [0, 1.0, 0], null, 0.12)); for (const [x, y] of [[-0.3, 1.15], [0.3, 1.15], [-0.3, 0.7], [0.3, 0.7]]) v.add(box(0.48, 0.32, 0.12, mat('#2A3A1A', { rough: 0.8 }), [x, y, 0.33], null, 0.03)); v.add(box(1.32, 0.1, 0.62, '#1A2410', [0, 1.55, 0])); for (const sd of [-1, 1]) v.add(box(0.25, 0.4, 0.5, mat('#3A4A2A', { rough: 0.8 }), [sd * 0.4, 1.95, 0])); put(s, v, [0, 0, 0], [0, 0.3, 0]); } },
  'g-robe': { tone: GEAR, build(s) { const r = lathe([[0, 0], [0.9, 0], [0.6, 1.1], [0.45, 1.8], [0.2, 2.1], [0, 2.1]], mat('#3A2866', { rough: 0.5, sheen: 0.8, sheenColor: '#B58CFF' })); put(s, r, [0, 0, 0]); for (const [x, y, z] of [[-0.3, 0.6, 0.6], [0.25, 1.1, 0.5], [-0.1, 1.5, 0.4], [0.35, 0.4, 0.7]]) put(s, spark('#F0D48A', 0.06), [x, y, z]); put(s, cyl(0.02, 0.02, 1.9, GOLD(), [0, 1.0, 0.55], [-0.25, 0, 0])); put(s, textPanel(1.2, 0.24, '«Я у мамы колдун»', { bg: '#1A1230', fg: '#F0D48A', depth: 0.02 }), [0, 0.2, 1.1], [-0.4, 0, 0]); } },
  'g-tracksuit': { tone: GEAR, build(s) { const m = mat('#15161A', { rough: 0.35, clear: 0.7 }); const t = garment(m, { collar: m }); const w = mat('#EFE6D2', { rough: 0.5 }); for (const sd of [-1, 1]) for (let k = 0; k < 3; k++) t.add(at(cap(0.022, 0.85, w), [sd * (0.82 + (k - 1) * 0.07), 1.06, 0.16], [0, 0, sd * 0.32])); for (let k = 0; k < 3; k++) t.add(box(0.05, 1.3, 0.02, w, [-0.5 + k * 0.08, 1.15, 0.28])); put(s, t, [0, 0.05, 0], [0, -0.25, 0], 0.82); } },
  'g-valenki': { tone: GEAR, build(s) { const felt = mat('#8A8F98', { rough: 1, clear: 0, sheen: 1, sheenColor: '#D0D4DA' }); const b = () => group(cyl(0.3, 0.28, 1.3, felt, [0, 0.95, 0]), cap(0.27, 0.45, felt, [0, 0.27, 0.25], [Math.PI / 2, 0, 0]), torus(0.3, 0.05, mat('#C3202F', { rough: 0.9 }), [0, 1.45, 0], [Math.PI / 2, 0, 0])); put(s, b(), [-0.45, 0, 0], [0, 0.3, 0]); put(s, b(), [0.45, 0, 0.1], [0, 0.1, 0.05]); for (const z of [0.4, 0.7]) put(s, cyl(0.015, 0.015, 0.5, glow('#9FE0BC', 0.6)), [1.2, 0.5 + z * 0.4, z], [0, 0, Math.PI / 2]); } },
  'g-boots': { tone: GEAR, build(s) { const lea = mat('#2A2018', { rough: 0.35, clear: 0.8 }); const b = () => group(cyl(0.3, 0.27, 1.3, lea, [0, 0.95, 0]), sph(0.3, lea, [0, 0.22, 0.25], [0.9, 0.7, 1.5]), box(0.52, 0.08, 1.0, '#120C08', [0, 0.04, 0.2], null, 0.03), torus(0.29, 0.03, '#4A3A2A', [0, 1.3, 0], [Math.PI / 2, 0, 0])); put(s, b(), [-0.45, 0, 0], [0, 0.35, 0]); put(s, b(), [0.45, 0, 0.1], [0, -0.1, -0.06]); } },
  'g-slippers': { tone: GEAR, build(s) { const pink = mat('#E06A9A', { rough: 0.9, sheen: 1, sheenColor: '#FFC0D8' }); const sl = () => group(sph(0.35, pink, [0, 0.15, 0], [1, 0.45, 1.7]), sph(0.25, pink, [0, 0.28, 0.25], [1.1, 0.7, 1]), sph(0.18, mat('#F4C8D8', { rough: 1, sheen: 1 }), [0, 0.5, 0.35])); put(s, sl(), [-0.45, 0, 0], [0, 0.3, 0], 1.3); put(s, sl(), [0.5, 0, 0.1], [0, -0.2, 0], 1.3); for (const [x, y] of [[-1.0, 1.4], [0, 1.7], [1.0, 1.4]]) put(s, spark('#9FE0BC', 0.05), [x, y, 0]); } },
  'g-pan': { tone: GEAR, build(s) { const iron = mat('#26282C', { metal: 0.7, rough: 0.4 }); const p = group(lathe([[0, 0], [0.9, 0], [1.0, 0.25], [0.95, 0.25], [0.85, 0.06], [0, 0.06]], iron), cyl(0.08, 0.1, 1.3, mat('#5A3A1A', { clear: 0.7 }), [1.55, 0.18, 0], [0, 0, Math.PI / 2])); put(s, p, [-0.35, 0.9, 0], [1.1, 0.4, 0.2]); put(s, spark('#FFE07A', 0.08), [-1.1, 2.0, 0.3]); } },
  'g-rebar': { tone: GEAR, build(s) { const r = new THREE.Group(); const m = mat('#7A4A2A', { metal: 0.6, rough: 0.6 }); r.add(cyl(0.08, 0.08, 2.6, m)); for (let k = 0; k < 20; k++) r.add(torus(0.085, 0.02, m, [0, -1.25 + k * 0.13, 0], [Math.PI / 2 + 0.3, 0, 0])); put(s, r, [0, 1.15, 0], [0, 0, -0.75]); } },
  'g-stool': { tone: GEAR, build(s) { const w = mat('#A86A3A', { clear: 0.5, rough: 0.4 }); const st = group(cyl(0.7, 0.7, 0.12, w, [0, 1.1, 0])); for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.6; st.add(at(cyl(0.05, 0.06, 1.15, mat('#7A4A2A', { clear: 0.5 })), [Math.sin(a) * 0.45, 0.55, Math.cos(a) * 0.45], [Math.cos(a) * 0.12, 0, -Math.sin(a) * 0.12])); } st.add(torus(0.45, 0.03, mat('#7A4A2A'), [0, 0.45, 0], [Math.PI / 2, 0, 0])); put(s, st, [0, 0, 0], [0, 0, 0.15]); } },
  'g-taser': { tone: GEAR, build(s) { const t = group(box(1.3, 0.42, 0.35, '#1A1A1E', [0, 0, 0], null, 0.1), box(0.35, 0.6, 0.3, '#26282C', [-0.3, -0.42, 0], [0, 0, 0.2], 0.08), box(0.12, 0.22, 0.2, METAL(), [0.7, 0, 0]), box(0.5, 0.08, 0.36, glow('#FFE07A', 0.8), [-0.1, 0.12, 0])); put(s, t, [-0.2, 1.1, 0], [0, -0.35, 0.1]); for (let k = 0; k < 3; k++) put(s, tube([[0.45, 1.25, 0.25], [0.7, 1.35 + k * 0.1 - 0.1, 0.3 + k * 0.1], [0.85, 1.15 + k * 0.15, 0.4], [1.1, 1.3, 0.5]], 0.02, glow('#7FD0FF', 3))); const pl = new THREE.PointLight('#7FD0FF', 4, 2.5); pl.position.set(0.9, 1.3, 0.6); s.add(pl); } },
  'g-abacus': { tone: GEAR, build(s) { const a = group(box(1.8, 1.4, 0.12, mat('#5A3A1A', { clear: 0.6 }), [0, 0, -0.05], null, 0.04)); for (let r = 0; r < 5; r++) { a.add(cyl(0.015, 0.015, 1.6, METAL(), [0, 0.5 - r * 0.25, 0.1], [0, 0, Math.PI / 2])); for (let k = 0; k < 8; k++) a.add(sph(0.08, mat(k < 3 + (r % 3) ? '#C3202F' : '#EFE6D2', { clear: 1, rough: 0.15 }), [-0.7 + k * 0.17 + (k >= 3 + (r % 3) ? 0.3 : 0), 0.5 - r * 0.25, 0.1], [0.8, 1, 1])); } put(s, a, [0, 1.05, 0], [-0.25, 0.3, 0]); } },
  'g-plantain': { tone: GEAR, build(s) { const leaf = extrude([[0, 0], [0.5, 0.5], [0.45, 1.3], [0, 1.9], [-0.45, 1.3], [-0.5, 0.5]], 0.03, mat('#5FA35A', { rough: 0.45, clear: 0.6 }), null, null, 0.01); const g = group(leaf); for (let k = 0; k < 5; k++) g.add(at(cyl(0.012, 0.012, 1.1, '#3A7A3A'), [(k - 2) * 0.09, 0.05, 0.035], [0, 0, (k - 2) * -0.1])); g.add(cyl(0.025, 0.03, 0.7, '#3A7A3A', [0, -1.2, 0])); put(s, g, [0, 1.25, 0], [-0.2, 0.25, 0.25]); const cross = group(box(0.5, 0.14, 0.06, mat('#D8282C', { clear: 0.8 })), box(0.14, 0.5, 0.06, mat('#D8282C', { clear: 0.8 }))); put(s, cross, [0.9, 1.8, 0.2], [0, -0.3, 0]); put(s, spark('#9FE0BC', 0.08), [-0.9, 2.0, 0]); } },
  'g-shovel': { tone: GEAR, build(s) { const sh = group(cyl(0.05, 0.05, 2.2, mat('#8A5A2A', { clear: 0.5 }), [0, 1.1, 0]), box(0.45, 0.08, 0.08, '#5A3A1A', [0, 2.2, 0]), extrude([[-0.35, 0.3], [0.35, 0.3], [0.38, -0.2], [0, -0.55], [-0.38, -0.2]], 0.04, mat('#8A8F98', { metal: 0.8, rough: 0.5 }), [0, -0.1, 0])); put(s, sh, [0, 0.5, 0], [0, 0.4, 0.55]); put(s, sph(0.4, mat('#5A3A20', { rough: 1, clear: 0 }), [0.7, 0.05, 0.4], [1.4, 0.35, 1])); } },
  'g-saw': { tone: GEAR, build(s) { const saw = group(box(0.9, 0.6, 0.45, mat('#E0601A', { clear: 0.8 }), [0, 0, 0], null, 0.1), box(1.5, 0.28, 0.05, METAL(), [1.15, -0.05, 0], null, 0.12), torus(0.25, 0.05, '#1A1A1E', [-0.05, 0.38, 0], [0, 0, 0], Math.PI)); for (let k = 0; k < 12; k++) saw.add(cone(0.035, 0.08, METAL(), [0.45 + k * 0.12, 0.12, 0], [0, 0, -0.3])); const lab = textPanel(0.5, 0.15, 'ДРУЖБА', { bg: '#E0601A', fg: '#1A1A1A', depth: 0.005 }); lab.position.set(0, -0.05, 0.23); saw.add(lab); put(s, saw, [-0.5, 1.0, 0], [0, -0.3, 0.2]); } },
  'g-mop': { tone: GEAR, build(s) { const m = group(cyl(0.04, 0.04, 2.3, mat('#2F6BC4', { clear: 0.8 }), [0, 1.15, 0])); for (let k = 0; k < 18; k++) { const a = k / 18 * Math.PI * 2; m.add(at(cap(0.035, 0.55, mat('#EFE6D2', { rough: 1, clear: 0 })), [Math.sin(a) * 0.12, -0.25, Math.cos(a) * 0.12], [Math.cos(a) * 0.3, 0, -Math.sin(a) * 0.3])); } put(s, m, [-0.2, 0.3, 0], [0, 0, 0.35]); put(s, lathe([[0, 0], [0.38, 0], [0.45, 0.6], [0.42, 0.6], [0.35, 0.05], [0, 0.05]], mat('#5A92E6', { clear: 0.8 })), [0.85, 0, 0.3]); put(s, cyl(0.4, 0.4, 0.02, mat('#7FB0E8', { trans: 0.6, rough: 0.1 }), [0.85, 0.5, 0.3])); } },
  'g-cat': { tone: GEAR, build(s) { put(s, group(sph(0.9, mat('#3A4A5A', { rough: 0.7 }), [0, 0, 0], [1.5, 0.75, 0.9])), [0, 0.55, -0.1]); const c = cat({ fur: '#D98A3A', belly: '#F6D8A8', mood: 'angry' }); put(s, c, [0.5, 1.05, 0], [0, -0.3, 0], 0.6); } },
  'g-cert': { tone: GEAR, build(s) { const d = panel(1.2, 1.6, (x, cw, ch) => { x.fillStyle = '#F4EEDF'; x.fillRect(0, 0, cw, ch); x.fillStyle = '#1A1612'; x.font = `900 ${cw * 0.11}px MR`; x.textAlign = 'center'; x.fillText('СПРАВКА', cw / 2, ch * 0.13); x.fillStyle = '#B8A888'; for (let k = 0; k < 5; k++) x.fillRect(cw * 0.12, ch * (0.24 + k * 0.08), cw * (0.76 - (k % 2) * 0.2), ch * 0.025); x.font = `700 ${cw * 0.06}px MR`; x.fillStyle = '#1A1612'; x.fillText('выдана в том, что предъявитель', cw / 2, ch * 0.7); x.fillText('НЕ ПСИХ', cw / 2, ch * 0.76); x.strokeStyle = '#2F6BC4'; x.lineWidth = cw * 0.02; x.beginPath(); x.arc(cw * 0.7, ch * 0.87, cw * 0.11, 0, 7); x.stroke(); }, { depth: 0.01, edge: '#D8CBAE' }); put(s, d, [0, 1.05, 0], [-0.1, 0.2, 0.05]); put(s, group(cyl(0.18, 0.2, 0.18, mat('#5A3A1A', { clear: 0.6 })), cyl(0.06, 0.08, 0.35, mat('#5A3A1A', { clear: 0.6 }), [0, 0.25, 0])), [0.95, 0.1, 0.6]); } },
  'g-garlic': { tone: GEAR, build(s) { const bulb = () => group(lathe([[0, 0], [0.2, 0.05], [0.25, 0.2], [0.18, 0.35], [0.05, 0.45], [0, 0.5]], mat('#F4EEDF', { rough: 0.7 })), cone(0.03, 0.15, '#C9B590', [0, 0.55, 0])); const pts = []; for (let k = 0; k <= 8; k++) { const a = (k / 8) * Math.PI; pts.push([-Math.cos(a) * 1.1, 2.1 - Math.sin(a) * 1.2, 0.2]); } put(s, tube(pts, 0.015, '#B89C6A')); pts.slice(1, -1).forEach(([x, y, z], i) => put(s, bulb(), [x, y - 0.45, z], [0, i, 0], 0.8)); } },
  'g-gopro': { tone: GEAR, build(s) { const c = group(box(1.1, 0.8, 0.6, '#1A1A1E', [0, 0, 0], null, 0.1), cyl(0.28, 0.3, 0.2, '#26282C', [0, -0.02, 0.35], [Math.PI / 2, 0, 0]), cyl(0.2, 0.2, 0.05, mat('#1A3A6A', { metal: 0.5, rough: 0.05, clear: 1 }), [0, -0.02, 0.46], [Math.PI / 2, 0, 0]), sph(0.06, glow('#FF3A3A', 3), [0.4, 0.28, 0.3]), box(0.3, 0.1, 0.1, '#3A3C40', [-0.25, 0.42, 0])); put(s, c, [0, 1.0, 0], [0, -0.35, 0]); put(s, group(cyl(0.04, 0.04, 1.0, '#26282C', [0, 0, 0]), ...[0, 1, 2].map((k) => at(cyl(0.03, 0.03, 0.7, '#26282C'), [Math.sin(k * 2.1) * 0.2, -0.75, Math.cos(k * 2.1) * 0.2], [Math.cos(k * 2.1) * 0.4, 0, -Math.sin(k * 2.1) * 0.4]))), [0, 0.6 - 0.05, -0.05]); } },
  // ================= one-shots =================
  'o-energy': { tone: ONE, build(s) { const can = group(cyl(0.45, 0.45, 1.6, mat('#15161A', { metal: 0.7, rough: 0.25 }), [0, 0.8, 0]), cyl(0.4, 0.45, 0.08, METAL(), [0, 1.64, 0]), extrude([[0, 0.25], [0.15, 0.25], [0.04, 0.02], [0.18, 0.02], [-0.1, -0.35], [0.0, -0.08], [-0.15, -0.08]], 0.04, glow('#7FFF5A', 1.6), [0, 0.9, 0.45])); put(s, can, [0, 0, 0], [0, -0.3, 0]); put(s, textPanel(0.8, 0.35, '−50%', { bg: '#D8282C', fg: '#fff', depth: 0.04 }), [0.75, 1.6, 0.4], [0, -0.3, 0.2]); const pl = new THREE.PointLight('#7FFF5A', 3, 2); pl.position.set(0, 1, 1); s.add(pl); } },
  'o-pickle': { tone: ONE, build(s) { put(s, lathe([[0, 0], [0.6, 0], [0.65, 0.1], [0.65, 1.3], [0.5, 1.5], [0.45, 1.6], [0, 1.6]], mat('#C9E0A0', { trans: 0.8, rough: 0.05, clear: 1 })), [0, 0, 0]); put(s, cyl(0.5, 0.5, 0.2, mat('#C3202F', { metal: 0.3, rough: 0.3 })), [0, 1.68, 0]); for (const [x, y, z, r] of [[-0.25, 0.5, 0.1, 0.3], [0.2, 0.7, -0.1, -0.2], [0, 1.05, 0.2, 0.5], [0.25, 0.4, 0.25, -0.4]]) put(s, cap(0.1, 0.35, mat('#4A8A3A', { rough: 0.5 })), [x, y, z], [r, 0, r]); for (let k = 0; k < 3; k++) put(s, cap(0.012, 0.25, mat('#2A5A1A')), [-0.05 + k * 0.1, 1.25, 0], [0, 0, 0.3 * (k - 1)]); } },
  'o-brick': { tone: ONE, build(s) { const b = box(1.3, 0.45, 0.65, mat('#C0592B', { rough: 0.95, clear: 0 }), [0, 0, 0], null, 0.04); put(s, b, [0, 1.15, 0], [0.5, 0.6, 0.3]); for (let k = 0; k < 3; k++) put(s, cyl(0.015, 0.015, 0.6, glow('#FFD866', 0.6)), [-1.0 + k * 0.1, 1.8 - k * 0.2, 0], [0, 0, 0.7]); for (const [x, z] of [[0.5, 0.6], [-0.3, 0.8], [0.9, 0.2]]) put(s, box(0.15, 0.08, 0.1, mat('#A04A22', { rough: 1 })), [x, 0.04, z], [0, x, 0]); } },
  'o-firework': { tone: ONE, build(s) { const f = group(cyl(0.3, 0.3, 1.1, mat('#D8282C', { clear: 0.8 }), [0, 0.55, 0]), cyl(0.31, 0.31, 0.12, GOLD(), [0, 0.3, 0]), cyl(0.31, 0.31, 0.12, GOLD(), [0, 0.85, 0]), cone(0.3, 0.3, mat('#D8282C', { clear: 0.8 }), [0, 1.25, 0])); put(s, f, [0, 0, 0], [0, 0, -0.1]); put(s, tube([[0.05, 1.38, 0], [0.15, 1.6, 0], [0.1, 1.8, 0.05]], 0.025, '#B89C6A')); put(s, sph(0.14, mat('#FFF2B0', { emissive: '#FFB43A', ei: 3 })), [0.1, 1.85, 0.05]); const pl = new THREE.PointLight('#FFA040', 6, 3); pl.position.set(0.1, 1.9, 0.4); s.add(pl); for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2; put(s, cyl(0.012, 0.012, 0.35, glow(k % 2 ? '#FFB13A' : '#FF5A5A', 2)), [0.1 + Math.cos(a) * 0.45, 1.85 + Math.sin(a) * 0.45, 0.05], [0, 0, a + Math.PI / 2]); } } },
  'o-pies': { tone: ONE, build(s) { put(s, cyl(1.1, 0.9, 0.08, mat('#EFE6D2', { clear: 1, rough: 0.2 }), [0, 0.04, 0])); const pie = () => sph(0.36, mat('#D8963A', { rough: 0.5, clear: 0.6 }), [0, 0, 0], [1.3, 0.55, 0.75]); for (const [x, y, z, r] of [[-0.35, 0.22, 0.15, 0.3], [0.35, 0.22, 0.2, -0.2], [0, 0.22, -0.3, 1.4], [0, 0.48, 0, 0.6]]) put(s, pie(), [x, y, z], [0, r, 0]); for (const x of [-0.4, 0, 0.4]) put(s, tube([[x, 0.8, 0], [x + 0.1, 1.2, 0], [x - 0.08, 1.6, 0], [x + 0.05, 2.0, 0]], 0.025, mat('#ffffff', { opacity: 0.35, emissive: '#ffffff', ei: 0.3 }))); } },
  'o-holy': { tone: ONE, build(s) { const b = bottle('#BFE0FF', '#F4EEDF', { h: 1.4, r: 0.38 }); put(s, b, [0, 0, 0]); put(s, box(0.06, 0.32, 0.02, GOLD()), [0, 0.5, 0.39]); put(s, box(0.22, 0.06, 0.02, GOLD()), [0, 0.56, 0.39]); const pl = new THREE.PointLight('#FFF2B0', 5, 3); pl.position.set(0, 1.0, 0.8); s.add(pl); for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; put(s, cyl(0.01, 0.01, 0.4, glow('#FFF2B0', 2)), [Math.cos(a) * 0.9, 0.9 + Math.sin(a) * 0.9, -0.3], [0, 0, a + Math.PI / 2]); } } },
  'o-mother': { tone: ONE, build(s) { const ph = phone((x, cw, ch) => { const g = x.createLinearGradient(0, 0, 0, ch); g.addColorStop(0, '#2FAE6A'); g.addColorStop(1, '#155A3A'); x.fillStyle = g; x.fillRect(0, 0, cw, ch); x.fillStyle = '#F4EEDF'; x.beginPath(); x.arc(cw / 2, ch * 0.3, cw * 0.18, 0, 7); x.fill(); x.fillStyle = '#E06A72'; x.font = `900 ${cw * 0.22}px MR`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('♥', cw / 2, ch * 0.31); x.fillStyle = '#fff'; x.font = `800 ${cw * 0.14}px MR`; x.fillText('МАМА', cw / 2, ch * 0.55); x.fillStyle = '#fff'; x.beginPath(); x.arc(cw / 2, ch * 0.8, cw * 0.1, 0, 7); x.fill(); }, { w: 0.95, h: 1.75 }); put(s, ph, [0, 1.05, 0], [0, -0.2, 0.08]); for (const r of [0.35, 0.55]) for (const sd of [-1, 1]) put(s, torus(r, 0.025, glow('#FFD866', 0.8), null, null, Math.PI * 0.5), [sd * 0.75, 1.8, 0], [0, 0, sd > 0 ? -0.3 : Math.PI - 0.6 + 0.3]); } },
  // ================= levels =================
  'l-blat': { tone: LVL, build(s) { const armL = group(cap(0.18, 1.1, mat('#26282C', { rough: 0.7 }), [0, 0, 0], [0, 0, Math.PI / 2]), sph(0.2, '#E8C49A', [0.75, 0, 0], [1.2, 0.9, 1])); const armR = group(cap(0.18, 1.1, mat('#3A2A5A', { rough: 0.7 }), [0, 0, 0], [0, 0, Math.PI / 2]), sph(0.2, '#D8B48A', [-0.75, 0, 0], [1.2, 0.9, 1])); put(s, armL, [-0.95, 1.0, 0]); put(s, armR, [0.95, 1.05, 0]); put(s, money(0.6, '₽'), [0, 1.3, 0.1], [0, 0, 0.3]); put(s, textPanel(0.9, 0.32, '+1 УРОВЕНЬ', { bg: '#1A1206', fg: '#F0D48A', depth: 0.04 }), [0, 0.25, 0.9], [-0.4, 0, 0]); } },
  'l-lottery': { tone: LVL, build(s) { const t = panel(1.8, 0.9, (x, cw, ch) => { x.fillStyle = '#F0D48A'; x.fillRect(0, 0, cw, ch); x.fillStyle = '#C3202F'; x.fillRect(0, 0, cw, ch * 0.28); x.fillStyle = '#fff'; x.font = `900 ${ch * 0.17}px MR`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('ЛОТО-МИЛЛИОН', cw / 2, ch * 0.15); [7, 13, 21, 3, 42].forEach((n, i) => { x.fillStyle = '#fff'; x.beginPath(); x.arc(cw * (0.15 + i * 0.175), ch * 0.62, ch * 0.15, 0, 7); x.fill(); x.fillStyle = '#1A1612'; x.font = `900 ${ch * 0.15}px MR`; x.fillText(String(n), cw * (0.15 + i * 0.175), ch * 0.63); }); }, { depth: 0.01, edge: '#D9B65E' }); put(s, t, [0, 1.35, 0], [-0.15, 0.15, 0.08]); put(s, coinStack(6), [-0.8, 0, 0.5]); put(s, coinStack(4), [0.85, 0, 0.6]); for (const [x, y] of [[-1.1, 2.0], [1.05, 1.9], [0.3, 2.1]]) put(s, spark('#FFE07A', 0.07), [x, y, 0.2]); put(s, textPanel(0.9, 0.32, '+1 УРОВЕНЬ', { bg: '#1A1206', fg: '#F0D48A', depth: 0.04 }), [0, 0.3, 0.95], [-0.4, 0, 0]); } },
  'l-bribe': { tone: LVL, build(s) { const env = group(box(1.5, 0.95, 0.05, '#E9DEC6', [0, 0, 0])); const flap = extrude([[-0.75, 0], [0.75, 0], [0, -0.55]], 0.02, mat('#D8CBAE')); flap.position.set(0, 0.47, 0.04); flap.rotation.x = -0.8; env.add(flap); for (let k = 0; k < 3; k++) env.add(at(money(0.9, '5000'), [-0.1 + k * 0.08, 0.5 + k * 0.05, 0.01 - k * 0.005], [0, 0, 0.1 - k * 0.15])); put(s, env, [0, 1.05, 0], [-0.2, 0.2, 0]); put(s, textPanel(0.9, 0.32, '+1 УРОВЕНЬ', { bg: '#1A1206', fg: '#F0D48A', depth: 0.04 }), [0, 0.25, 0.95], [-0.4, 0, 0]); } },
  'l-exam': { tone: LVL, build(s) { const lic = panel(1.6, 1.0, (x, cw, ch) => { const g = x.createLinearGradient(0, 0, cw, ch); g.addColorStop(0, '#F4C8D8'); g.addColorStop(1, '#C8D8F4'); x.fillStyle = g; x.fillRect(0, 0, cw, ch); x.fillStyle = '#E8C49A'; x.fillRect(cw * 0.06, ch * 0.15, cw * 0.28, ch * 0.6); x.fillStyle = '#1A1612'; x.beginPath(); x.arc(cw * 0.15, ch * 0.4, cw * 0.015, 0, 7); x.arc(cw * 0.25, ch * 0.4, cw * 0.015, 0, 7); x.fill(); x.lineWidth = cw * 0.01; x.beginPath(); x.arc(cw * 0.2, ch * 0.48, cw * 0.05, 0.2, Math.PI - 0.2); x.stroke(); x.fillStyle = '#8A7A90'; for (let k = 0; k < 4; k++) x.fillRect(cw * 0.42, ch * (0.2 + k * 0.13), cw * (0.48 - k * 0.06), ch * 0.04); x.fillStyle = '#1A1612'; x.font = `900 ${ch * 0.2}px MR`; x.fillText('B', cw * 0.82, ch * 0.88); x.font = `800 ${ch * 0.1}px MR`; x.fillText('ВОДИТЕЛЬСКОЕ УДОСТОВЕРЕНИЕ', cw * 0.06, ch * 0.09); }, { depth: 0.02, edge: '#E9DEC6' }); put(s, lic, [0, 1.25, 0], [-0.15, -0.15, 0.06]); put(s, group(torus(0.18, 0.03, METAL(), [0, 0, 0]), box(0.08, 0.4, 0.04, METAL(), [0.25, -0.15, 0], [0, 0, 0.6])), [0.85, 0.08, 0.7], [-Math.PI / 2, 0, 0]); put(s, textPanel(0.9, 0.32, '+1 УРОВЕНЬ', { bg: '#1A1206', fg: '#F0D48A', depth: 0.04 }), [-0.3, 0.3, 0.95], [-0.4, 0, 0]); } },
};
