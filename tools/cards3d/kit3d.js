// A small toolkit for toy-like 3D card illustrations: a stage, characters, props.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
export { THREE };

export const OUT_W = 480, OUT_H = 400, SS = 1.5;
let renderer = null, env = null;
export function init() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(OUT_W * SS, OUT_H * SS);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);
  document.body.appendChild(renderer.domElement);
  const pm = new THREE.PMREMGenerator(renderer);
  env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
}

// ---------- materials & primitives ----------
const mcache = new Map();
export function mat(color, o = {}) {
  if (color && color.isMaterial) return color;
  const key = JSON.stringify([color, o]);
  if (mcache.has(key)) return mcache.get(key);
  const m = new THREE.MeshPhysicalMaterial({
    color, roughness: o.rough ?? 0.5, metalness: o.metal ?? 0, clearcoat: o.clear ?? 0.25, clearcoatRoughness: 0.35,
    emissive: o.emissive || '#000000', emissiveIntensity: o.ei ?? 1, transparent: !!o.opacity, opacity: o.opacity ?? 1,
    transmission: o.trans || 0, thickness: o.trans ? 0.4 : 0, ior: 1.4, side: o.side || THREE.FrontSide, envMapIntensity: o.env ?? 1,
    sheen: o.sheen || 0, sheenColor: o.sheenColor || '#ffffff',
  });
  mcache.set(key, m); return m;
}
export const GOLD = () => mat('#E2B85A', { metal: 1, rough: 0.22, clear: 0 });
export const METAL = () => mat('#A9AEB6', { metal: 1, rough: 0.3, clear: 0 });
function place(m, pos, rot, scale) {
  if (pos) m.position.set(...pos);
  if (rot) m.rotation.set(...rot);
  if (scale) { if (typeof scale === 'number') m.scale.setScalar(scale); else m.scale.set(...scale); }
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
export const sph = (r, m, pos, scale, rot) => place(new THREE.Mesh(new THREE.SphereGeometry(r, 40, 28), mat(m)), pos, rot, scale);
export const box = (w, h, d, m, pos, rot, r = 0) => place(new THREE.Mesh(r ? roundedBox(w, h, d, r) : new THREE.BoxGeometry(w, h, d), mat(m)), pos, rot);
export const cyl = (rt, rb, h, m, pos, rot, seg = 40) => place(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(m)), pos, rot);
export const cone = (r, h, m, pos, rot) => place(new THREE.Mesh(new THREE.ConeGeometry(r, h, 32), mat(m)), pos, rot);
export const torus = (R, r, m, pos, rot, arc = Math.PI * 2) => place(new THREE.Mesh(new THREE.TorusGeometry(R, r, 18, 64, arc), mat(m)), pos, rot);
export const cap = (r, len, m, pos, rot) => place(new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 10, 24), mat(m)), pos, rot);
export const lathe = (pts, m, pos, rot, scale) => place(new THREE.Mesh(new THREE.LatheGeometry(pts.map(([a, b]) => new THREE.Vector2(a, b)), 48), mat(m)), pos, rot, scale);
export function tube(pts, r, m, closed = false) {
  const c = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), closed);
  return place(new THREE.Mesh(new THREE.TubeGeometry(c, 48, r, 12, closed), mat(m)));
}
export function extrude(shapePts, depth, m, pos, rot, bevel = 0.02) {
  const s = new THREE.Shape(shapePts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3 });
  g.center();
  return place(new THREE.Mesh(g, mat(m)), pos, rot);
}
function roundedBox(w, h, d, r) {
  const s = new THREE.Shape();
  const x = -w / 2 + r, y = -h / 2 + r, ww = w - 2 * r, hh = h - 2 * r;
  s.moveTo(x, y - r); s.lineTo(x + ww, y - r); s.quadraticCurveTo(x + ww + r, y - r, x + ww + r, y); s.lineTo(x + ww + r, y + hh);
  s.quadraticCurveTo(x + ww + r, y + hh + r, x + ww, y + hh + r); s.lineTo(x, y + hh + r); s.quadraticCurveTo(x - r, y + hh + r, x - r, y + hh);
  s.lineTo(x - r, y); s.quadraticCurveTo(x - r, y - r, x, y - r);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, d - 2 * Math.min(r, d / 2.2)), bevelEnabled: true, bevelSize: Math.min(r, d / 2.2), bevelThickness: Math.min(r, d / 2.2), bevelSegments: 4 });
  g.center(); return g;
}
export function group(...kids) { const g = new THREE.Group(); for (const k of kids.flat()) if (k) g.add(k); return g; }
export function at(g, pos, rot, scale) { place(g, pos, rot, scale); return g; }

/** A flat textured panel: labels, screens, card faces. draw(ctx, w, h) */
export function panel(w, h, draw, { px = 512, emissive = 0, depth = 0.02, edge = '#1A1612' } = {}) {
  const cw = px, ch = Math.round(px * h / w);
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const x = c.getContext('2d'); draw(x, cw, ch);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const face = new THREE.MeshPhysicalMaterial({ map: t, roughness: 0.45, clearcoat: 0.2, emissive: emissive ? '#ffffff' : '#000000', emissiveMap: emissive ? t : null, emissiveIntensity: emissive });
  const e = mat(edge);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, depth), [e, e, e, e, face, e]);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
export function textPanel(w, h, text, { bg = '#F4EEDF', fg = '#1A1612', font = 800, size = 0.6, emissive = 0, depth = 0.02, lines } = {}) {
  return panel(w, h, (x, cw, ch) => {
    x.fillStyle = bg; x.fillRect(0, 0, cw, ch);
    x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
    const L = lines || [text];
    const fs = Math.round(ch * size / L.length);
    x.font = `${font} ${fs}px MR, sans-serif`;
    L.forEach((t, i) => { let s = fs; while (x.measureText(t).width > cw * 0.92 && s > 8) { s -= 2; x.font = `${font} ${s}px MR, sans-serif`; } x.fillText(t, cw / 2, ch * (i + 0.5) / L.length + fs * 0.04); x.font = `${font} ${fs}px MR, sans-serif`; });
  }, { emissive, depth });
}

// ---------- faces ----------
/** Big cartoon eyes. look: [x,y] offset of the pupils. */
export function eyes(g, { x = 0.15, y = 0, z = 0.3, r = 0.1, iris = '#ffffff', pupil = '#0B0B0C', look = [0, 0], lids = 0, angry = false, glow = null }) {
  for (const s of [-1, 1]) {
    const e = sph(r, glow ? mat(glow, { emissive: glow, ei: 1.6 }) : iris, [s * x, y, z], [1, 1.1, 0.6]);
    g.add(e);
    if (!glow) {
      g.add(sph(r * 0.55, pupil, [s * x + look[0] * r * 0.5, y + look[1] * r * 0.5, z + r * 0.45], [1, 1.1, 0.5]));
      g.add(sph(r * 0.18, mat('#ffffff', { emissive: '#ffffff', ei: 0.6 }), [s * x + r * 0.25, y + r * 0.35, z + r * 0.6]));
    }
    if (lids) g.add(sph(r * 1.08, lids === true ? '#000' : lids, [s * x, y + r * 0.35, z + 0.01], [1, 0.55, 0.62]));
    if (angry) g.add(box(r * 2.2, r * 0.45, r * 0.4, '#141014', [s * x, y + r * 1.15, z + r * 0.3], [0, 0, s * 0.45]));
  }
}
export function mouth(g, { y = -0.15, z = 0.32, w = 0.12, kind = 'smile', color = '#3A1414' }) {
  if (kind === 'smile') g.add(torus(w, 0.022, color, [0, y + w * 0.6, z], [0, 0, Math.PI * 1.1], Math.PI * 0.8));
  else if (kind === 'sad') g.add(torus(w, 0.022, color, [0, y - w * 0.4, z], [0, 0, Math.PI * 0.1], Math.PI * 0.8));
  else if (kind === 'o') g.add(sph(w * 0.5, color, [0, y, z], [1, 1.2, 0.5]));
  else if (kind === 'grin') { g.add(sph(w, color, [0, y, z - 0.02], [1.4, 0.6, 0.4])); g.add(box(w * 2.2, w * 0.35, 0.02, '#F4EEDF', [0, y + w * 0.32, z + 0.03])); }
  else if (kind === 'flat') g.add(box(w * 1.6, 0.03, 0.03, color, [0, y, z]));
  else if (kind === 'fangs') { g.add(sph(w, color, [0, y, z - 0.02], [1.4, 0.6, 0.4])); for (const s of [-1, 1]) g.add(cone(0.03, 0.08, '#F4EEDF', [s * w * 0.6, y + 0.01, z + 0.03], [Math.PI, 0, 0])); }
}

// ---------- characters ----------
/** A sitting cat. o: fur, belly, eye, mood (calm|angry|smug), tail */
export function cat(o = {}) {
  const fur = o.fur || '#2A2C30'; const belly = o.belly || fur; const g = new THREE.Group();
  const fm = mat(fur, { rough: 0.7, clear: 0.05, sheen: 0.6, sheenColor: belly });
  g.add(sph(0.56, fm, [0, 0.6, 0], [1, 1.08, 0.88]));
  g.add(sph(0.36, mat(belly, { rough: 0.75, sheen: 0.5 }), [0, 0.6, 0.3], [0.95, 1.15, 0.55]));
  for (const s of [-1, 1]) g.add(sph(0.15, fm, [s * 0.22, 0.12, 0.38], [1, 0.7, 1.3]));
  g.add(tube([[0.42, 0.25, -0.25], [0.8, 0.45, -0.25], [0.85, 0.95, -0.15], [0.7, 1.15, -0.05]], 0.09, fm));
  const head = new THREE.Group(); head.position.set(0, 1.32, 0.04); g.add(head);
  head.add(sph(0.46, fm, [0, 0, 0], [1.12, 0.95, 0.98]));
  for (const s of [-1, 1]) {
    head.add(cone(0.18, 0.36, fm, [s * 0.3, 0.42, -0.02], [0, 0, s * -0.38]));
    head.add(cone(0.1, 0.22, mat('#E8A0A8', { rough: 0.8 }), [s * 0.29, 0.38, 0.05], [0, 0, s * -0.38]));
    head.add(sph(0.15, mat(belly, { rough: 0.8 }), [s * 0.1, -0.14, 0.36], [1, 0.8, 0.8]));
    for (const k of [-1, 1]) head.add(cyl(0.008, 0.008, 0.42, '#EDE4D0', [s * 0.38, -0.12 + k * 0.04, 0.32], [0, 0, Math.PI / 2 + s * k * 0.12]));
  }
  head.add(sph(0.055, '#E87A8A', [0, -0.05, 0.47]));
  eyes(head, { x: 0.18, y: 0.07, z: 0.33, r: 0.12, iris: o.eye || '#F0D48A', lids: o.mood === 'smug' ? fur : 0, angry: o.mood === 'angry', look: o.look || [0, 0] });
  g.userData.head = head;
  return g;
}

/** A standing toy person. o: skin, shirt, pants, hair, armL/armR [rotX, rotZ], mouth, angry, eyes */
export function person(o = {}) {
  const g = new THREE.Group();
  const skin = o.skin || '#E8C49A';
  const shirt = mat(o.shirt || '#3A5A8A', { rough: 0.7, clear: 0.05 });
  const pants = mat(o.pants || '#26282C', { rough: 0.7, clear: 0.05 });
  for (const s of [-1, 1]) {
    g.add(cyl(0.12, 0.11, 0.62, pants, [s * 0.16, 0.31, 0]));
    g.add(sph(0.13, o.shoes || '#1A1614', [s * 0.16, 0.05, 0.06], [1, 0.6, 1.4]));
  }
  g.add(sph(0.42, shirt, [0, 0.98, 0], [1, 1.15, 0.78]));
  if (o.tie) { g.add(box(0.08, 0.38, 0.04, o.tie, [0, 1.02, 0.33])); g.add(box(0.1, 0.07, 0.05, o.tie, [0, 1.23, 0.32])); }
  if (o.belly) g.add(sph(0.3, shirt, [0, 0.88, 0.18], [1, 0.9, 0.9]));
  const arms = {};
  for (const [s, key] of [[-1, 'L'], [1, 'R']]) {
    const piv = new THREE.Group(); piv.position.set(s * 0.42, 1.22, 0);
    const [rx, rz] = o['arm' + key] || [0, s * 0.25];
    piv.rotation.set(rx, 0, rz);
    piv.add(cap(0.1, 0.42, shirt, [0, -0.3, 0]));
    piv.add(sph(0.11, skin, [0, -0.6, 0]));
    const hand = new THREE.Group(); hand.position.set(0, -0.62, 0); piv.add(hand);
    arms[key] = hand; g.add(piv);
  }
  const head = new THREE.Group(); head.position.set(0, 1.74, 0); g.add(head);
  head.add(sph(0.36, skin, [0, 0, 0], [1, 1.02, 0.95]));
  head.add(sph(0.06, skin, [0, -0.04, 0.35]));
  for (const s of [-1, 1]) head.add(sph(0.07, skin, [s * 0.35, 0, 0]));
  eyes(head, { x: 0.13, y: 0.06, z: 0.28, r: 0.07, angry: o.angry, lids: o.lids || 0, glow: o.glow, look: o.look || [0, 0] });
  mouth(head, { y: -0.16, z: 0.31, w: 0.09, kind: o.mouth || 'smile' });
  if (o.hair) head.add(sph(0.375, mat(o.hair, { rough: 0.8 }), [0, 0.06, -0.03], [1.02, 0.9, 1], [-0.3, 0, 0]));
  if (o.hairTop) head.add(sph(0.38, mat(o.hair || '#2A1A10', { rough: 0.8 }), [0, 0.12, -0.02], [1.02, 0.72, 1.02]));
  if (o.beard) head.add(sph(0.3, mat(o.beard, { rough: 0.9 }), [0, -0.24, 0.12], [1, 1.1, 0.8]));
  if (o.glasses) { for (const s of [-1, 1]) head.add(torus(0.085, 0.015, o.glasses, [s * 0.13, 0.06, 0.33])); head.add(box(0.08, 0.015, 0.015, o.glasses, [0, 0.07, 0.34])); }
  g.userData = { head, hands: arms };
  return g;
}
export function hat(kind, color, extra = {}) {
  const g = new THREE.Group();
  if (kind === 'cap') { g.add(sph(0.38, color, [0, 0.12, 0], [1.02, 0.6, 1.02])); g.add(cyl(0.3, 0.3, 0.03, color, [0, 0.12, 0.3], [0.2, 0, 0])); }
  if (kind === 'top') { g.add(cyl(0.28, 0.28, 0.5, color, [0, 0.5, 0])); g.add(cyl(0.45, 0.45, 0.04, color, [0, 0.27, 0])); g.add(cyl(0.285, 0.285, 0.08, extra.band || '#6A1C22', [0, 0.33, 0])); }
  if (kind === 'crown') { const c = cyl(0.3, 0.28, 0.2, GOLD(), [0, 0.42, 0], null, 8); g.add(c); for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; g.add(cone(0.06, 0.16, GOLD(), [Math.sin(a) * 0.29, 0.6, Math.cos(a) * 0.29])); } g.add(sph(0.05, mat('#C3202F', { clear: 1, rough: 0.1 }), [0, 0.44, 0.3])); }
  if (kind === 'scarf') g.add(sph(0.4, color, [0, 0.04, -0.02], [1.08, 1.05, 1.08]));
  if (kind === 'helmet') { g.add(sph(0.42, color, [0, 0.12, 0], [1, 0.75, 1])); g.add(cyl(0.48, 0.48, 0.04, color, [0, 0.1, 0])); }
  if (kind === 'wizard') { g.add(cone(0.36, 0.9, color, [0, 0.62, -0.05], [-0.15, 0, 0])); g.add(cyl(0.5, 0.5, 0.04, color, [0, 0.2, 0])); }
  if (kind === 'peaked') { g.add(cyl(0.36, 0.33, 0.18, color, [0, 0.34, 0])); g.add(cyl(0.27, 0.27, 0.03, '#111', [0, 0.27, 0.22], [0.35, 0, 0])); g.add(sph(0.05, GOLD(), [0, 0.36, 0.35])); }
  if (kind === 'party') { g.add(cone(0.2, 0.5, color, [0, 0.55, 0])); g.add(sph(0.06, '#F0D48A', [0, 0.82, 0])); }
  return g;
}

// ---------- props ----------
export function card(w, h, face, { back = false, tilt = 0 } = {}) {
  const m = panel(w, h, face, { depth: 0.025, edge: '#D9B65E' });
  return m;
}
export function cardBack(w, h, mark = '✶', tint = '#140B09') {
  return panel(w, h, (x, cw, ch) => {
    x.fillStyle = tint; x.fillRect(0, 0, cw, ch);
    x.strokeStyle = 'rgba(217,182,94,.45)'; x.lineWidth = 3;
    for (let k = -ch; k < ch * 2; k += 30) { x.beginPath(); x.moveTo(k, 0); x.lineTo(k + ch, ch); x.stroke(); x.beginPath(); x.moveTo(k + ch, 0); x.lineTo(k, ch); x.stroke(); }
    x.strokeStyle = '#D9B65E'; x.lineWidth = 10; x.strokeRect(14, 14, cw - 28, ch - 28);
    x.fillStyle = tint; x.beginPath(); x.arc(cw / 2, ch / 2, cw * 0.2, 0, 7); x.fill(); x.stroke();
    x.fillStyle = '#F0D48A'; x.font = `900 ${cw * 0.22}px MR`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(mark, cw / 2, ch / 2 + 6);
  }, { depth: 0.025, edge: '#D9B65E' });
}
export function coin(r = 0.16) { const g = group(cyl(r, r, 0.05, GOLD(), [0, 0.025, 0]), torus(r * 0.7, 0.012, mat('#9C7A2F', { metal: 1, rough: 0.3 }), [0, 0.052, 0], [Math.PI / 2, 0, 0])); return g; }
export function coinStack(n, r = 0.16) { const g = new THREE.Group(); for (let k = 0; k < n; k++) { const c = coin(r); c.position.set((k % 2) * 0.01, k * 0.052, 0); c.rotation.y = k; g.add(c); } return g; }
export function bottle(glass = '#2A6A3A', label = null, { h = 0.9, r = 0.2 } = {}) {
  const g = new THREE.Group();
  g.add(lathe([[0, 0], [r, 0], [r, h * 0.6], [r * 0.4, h * 0.78], [r * 0.32, h], [0, h]], mat(glass, { rough: 0.08, trans: 0.6, clear: 1 })));
  g.add(cyl(r * 0.36, r * 0.36, 0.08, '#3A3C40', [0, h + 0.03, 0]));
  if (label) { const l = panel(r * 1.4, h * 0.3, (x, cw, ch) => { x.fillStyle = label; x.fillRect(0, 0, cw, ch); }, { depth: 0.01 }); l.position.set(0, h * 0.33, r + 0.005); g.add(l); }
  return g;
}
export function phone(screen, { w = 0.55, h = 1.0 } = {}) {
  const g = new THREE.Group();
  g.add(box(w, h, 0.07, '#111215', [0, 0, 0], null, 0.06));
  const s = panel(w * 0.88, h * 0.86, screen, { emissive: 0.7, depth: 0.005, edge: '#000' }); s.position.set(0, 0, 0.04); g.add(s);
  return g;
}
export function bombBall(r = 0.6, { face = false, ears = false } = {}) {
  const g = new THREE.Group();
  g.add(sph(r, mat('#17181B', { metal: 0.4, rough: 0.28, clear: 0.8 }), [0, r, 0]));
  g.add(cyl(r * 0.28, r * 0.3, r * 0.22, '#3A3C40', [0, r * 2 - 0.02, 0]));
  g.add(tube([[0, r * 2.05, 0], [0.1, r * 2.35, 0], [0.32, r * 2.45, 0.05], [0.45, r * 2.3, 0.08]], 0.035, '#B89C6A'));
  const spark = sph(0.09, mat('#FFE9A0', { emissive: '#FFB43A', ei: 3 }), [0.47, r * 2.3, 0.08]); spark.castShadow = false; g.add(spark);
  const pl = new THREE.PointLight('#FFA040', 6, 4, 1.6); pl.position.set(0.5, r * 2.35, 0.2); g.add(pl);
  if (ears) for (const s of [-1, 1]) g.add(cone(r * 0.3, r * 0.5, mat('#17181B', { metal: 0.4, rough: 0.3 }), [s * r * 0.55, r * 1.75, 0], [0, 0, s * -0.5]));
  if (face) {
    const f = new THREE.Group(); f.position.set(0, r, 0); g.add(f);
    eyes(f, { x: r * 0.34, y: r * 0.12, z: r * 0.84, r: r * 0.2, glow: '#FF8A2A' });
    for (const s of [-1, 1]) f.add(box(r * 0.4, r * 0.08, r * 0.08, '#050505', [s * r * 0.32, r * 0.36, r * 0.86], [0, 0, s * -0.45]));
    f.add(torus(r * 0.18, 0.02, '#050505', [0, -r * 0.32, r * 0.9], [0, 0, 0.3], Math.PI * 0.8));
  }
  return g;
}
export function chair() { return group(box(0.7, 0.08, 0.7, '#6A3A1A', [0, 0.55, 0]), ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => cyl(0.04, 0.04, 0.55, '#5A3014', [a * 0.3, 0.27, b * 0.3]))); }
export function table(w = 1.6, d = 0.8, h = 0.7, color = '#5A3A1A') { return group(box(w, 0.08, d, color, [0, h, 0]), ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => box(0.07, h, 0.07, color, [a * (w / 2 - 0.08), h / 2, b * (d / 2 - 0.08)]))); }
export function spark(color = '#FFE07A', s = 0.12) { const m = sph(s, mat(color, { emissive: color, ei: 2.5 })); m.castShadow = false; return m; }

// ---------- the stage and the shot ----------
/** Renders one card scene. build(scene) adds things; returns a data URL. */
export async function shoot(build, { tone = '#D9B65E', cam = [0, 2.0, 5.3], look = [0, 1.0, 0], fov = 30, pedestal = true, floor = '#16110E', key = [-3, 6, 5], rim = null } = {}) {
  const scene = new THREE.Scene();
  scene.environment = env; scene.environmentIntensity = 0.55;
  if (pedestal) {
    const ped = cyl(1.75, 1.85, 0.22, mat(floor, { rough: 0.55 }), [0, -0.11, 0], null, 96); ped.castShadow = false; scene.add(ped);
    const top = cyl(1.68, 1.68, 0.01, mat(shade(tone, 0.22), { rough: 0.85, clear: 0 }), [0, 0.003, 0], null, 96); top.castShadow = false; scene.add(top);
    scene.add(torus(1.78, 0.035, GOLD(), [0, 0.0, 0], [Math.PI / 2, 0, 0]));
  }
  const hemi = new THREE.HemisphereLight('#FFF2DE', '#2A1A10', 0.55); scene.add(hemi);
  const k = new THREE.DirectionalLight('#FFE9CF', 2.6); k.position.set(...key); k.castShadow = true;
  k.shadow.mapSize.set(2048, 2048); k.shadow.camera.left = -3; k.shadow.camera.right = 3; k.shadow.camera.top = 4; k.shadow.camera.bottom = -2; k.shadow.bias = -0.0004; k.shadow.normalBias = 0.02; k.shadow.radius = 5;
  scene.add(k);
  const r = new THREE.DirectionalLight(rim || tone, 2.2); r.position.set(2.5, 3.5, -5); scene.add(r);
  const f = new THREE.DirectionalLight('#9FC4FF', 0.35); f.position.set(5, 2, 4); scene.add(f);
  await build(scene);
  const camera = new THREE.PerspectiveCamera(fov, OUT_W / OUT_H, 0.1, 50);
  camera.position.set(...cam); camera.lookAt(...look);
  renderer.render(scene, camera);
  // compose: a glow in the card's colour behind, the render, a vignette
  const o = document.createElement('canvas'); o.width = OUT_W; o.height = OUT_H; const x = o.getContext('2d');
  const bgr = x.createRadialGradient(OUT_W / 2, OUT_H * 0.42, 10, OUT_W / 2, OUT_H * 0.5, OUT_W * 0.75);
  bgr.addColorStop(0, shade(tone, 0.55)); bgr.addColorStop(0.55, shade(tone, 0.18)); bgr.addColorStop(1, '#050404');
  x.fillStyle = bgr; x.fillRect(0, 0, OUT_W, OUT_H);
  x.imageSmoothingQuality = 'high';
  x.drawImage(renderer.domElement, 0, 0, OUT_W, OUT_H);
  const vg = x.createRadialGradient(OUT_W / 2, OUT_H * 0.48, OUT_H * 0.3, OUT_W / 2, OUT_H / 2, OUT_W * 0.7);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.55)');
  x.fillStyle = vg; x.fillRect(0, 0, OUT_W, OUT_H);
  scene.traverse((m) => { if (m.geometry) m.geometry.dispose(); });
  return o.toDataURL('image/webp', 0.86);
}
export function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16); const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (v) => Math.round(Math.min(255, v * k * (k > 1 ? 1 : 1)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
