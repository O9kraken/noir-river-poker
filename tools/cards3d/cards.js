import * as K from '/kit3d.js';
import { loadFonts } from '/lib.js';
const P = new URLSearchParams(location.search);
const set = P.get('set');
(async () => {
  try {
    await loadFonts();
    K.init();
    const mod = set === 'bomb' ? (await import('/cards-bomb.js')).BOMB : (await import('/cards-dungeon.js')).DUNGEON;
    const keys = (P.get('keys') || Object.keys(mod).join(',')).split(',').filter(Boolean);
    const out = {};
    for (const k of keys) {
      const d = mod[k];
      if (!d) { out[k] = 'ERR missing'; continue; }
      try { out[k] = await K.shoot((s) => d.build(s), { tone: d.tone, ...(d.opts || {}) }); } catch (e) { out[k] = 'ERR ' + e.stack; }
    }
    window.result = JSON.stringify(out);
  } catch (e) { window.result = JSON.stringify({ _: 'ERR ' + e.stack }); }
})();
