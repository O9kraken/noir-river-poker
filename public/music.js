/* The club's music: a small lounge-jazz trio played live by the browser (no audio files).
   Electric piano, upright bass and brushes in the lounge; slow pads and a far-off bell at night.
   Every bar is improvised a little differently, so it never loops the same way twice. */
(() => {
  'use strict';
  const NR = window.NR;
  const { $, h, Sound, toast } = NR;
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // chords: [bass root, ...voicing] as MIDI notes
  const LOUNGE = [
    [43, 58, 62, 65, 69], [48, 58, 64, 69, 74], [41, 57, 60, 64, 67], [50, 53, 57, 60, 64], // Gm9 C13 Fmaj9 Dm9
    [43, 58, 62, 65, 69], [48, 58, 64, 67, 73], [45, 55, 60, 64, 67], [50, 54, 60, 64, 66], // Gm9 C7b9 Am7 D9
    [46, 57, 62, 65, 69], [45, 55, 60, 64, 67], [43, 58, 62, 65, 69], [48, 58, 62, 65, 69], // Bbmaj7 Am7 Gm9 C9sus
    [41, 57, 60, 64, 67], [50, 53, 57, 60, 64], [43, 58, 62, 65, 69], [48, 58, 64, 69, 74], // Fmaj9 Dm9 Gm9 C13
  ];
  const NIGHT = [
    [45, 52, 59, 60, 64], [41, 52, 57, 59, 64], [50, 60, 64, 65, 69], [40, 50, 57, 59, 62], // Am(add9) Fmaj7#11 Dm9 E7sus4
  ];
  const MOODS = {
    lounge: { name: 'Лаунж-джаз', bpm: 76, prog: LOUNGE, barsPerChord: 1 },
    night: { name: 'Ночной город', bpm: 54, prog: NIGHT, barsPerChord: 2 },
  };

  const Music = {
    on: false, vol: 0.5, mood: 'lounge', bus: null, timer: null, bar: 0, nextBar: 0, crackle: null, playing: false,

    init() {
      try {
        const on = localStorage.getItem('nr_music');
        this.on = on === '1'; // off until the player turns it on
        const v = parseFloat(localStorage.getItem('nr_mvol'));
        if (v >= 0 && v <= 1) this.vol = v;
      } catch (e) { /* ignore */ }
      window.addEventListener('nr:audio', () => this.start(true));
      document.addEventListener('visibilitychange', () => (document.hidden ? this.stop() : this.start()));
      Sound.renderBtn();
    },
    level() { return this.vol * 1.1 * (this.ducked ? 0.3 : 1); },
    /** Quieter while people talk in the voice chat. */
    duck(on) {
      this.ducked = !!on;
      if (this.bus && this.playing) this.bus.gain.setTargetAtTime(this.level(), Sound.ctx.currentTime, 0.5);
    },
    start(first) {
      if (!this.on || this.playing || document.hidden) return;
      if (!first && !Sound.ctx) return; // wait for the first tap: browsers block sound before it
      const c = Sound.ensure();
      if (!c) return;
      if (!this.bus) {
        this.bus = c.createGain();
        this.bus.gain.value = 0.0001;
        this.bus.connect(Sound.out);
        this.send = c.createGain(); this.send.gain.value = 0.9; this.send.connect(Sound.verb);
        this.bus.connect(this.send);
      }
      this.bus.gain.cancelScheduledValues(c.currentTime);
      this.bus.gain.setTargetAtTime(this.level(), c.currentTime, 1.2);
      this.playing = true;
      this.nextBar = c.currentTime + 0.15;
      this._crackle(true);
      clearInterval(this.timer);
      this.timer = setInterval(() => this._pump(), 120);
      this._pump();
      try {
        if (first && !localStorage.getItem('nr_music_hint')) {
          localStorage.setItem('nr_music_hint', '1');
          toast('Играет музыка клуба. Громкость и выключение — в кнопке звука наверху.');
        }
      } catch (e) { /* ignore */ }
    },
    stop() {
      if (!this.playing) return;
      this.playing = false;
      clearInterval(this.timer);
      const c = Sound.ctx;
      if (c && this.bus) { this.bus.gain.cancelScheduledValues(c.currentTime); this.bus.gain.setTargetAtTime(0.0001, c.currentTime, 0.4); }
      this._crackle(false);
    },
    setOn(on) {
      this.on = on;
      try { localStorage.setItem('nr_music', on ? '1' : '0'); } catch (e) { /* ignore */ }
      if (on) this.start(); else this.stop();
      Sound.renderBtn();
      renderPanel();
    },
    setVolume(v) {
      this.vol = v;
      try { localStorage.setItem('nr_mvol', String(v)); } catch (e) { /* ignore */ }
      if (this.bus && this.playing) this.bus.gain.setTargetAtTime(this.level(), Sound.ctx.currentTime, 0.1);
    },
    setMood(m) {
      if (!MOODS[m] || m === this.mood) return;
      this.mood = m;
      this.bar = 0;
      renderPanel();
    },

    // ---------- scheduling ----------
    _pump() {
      const c = Sound.ctx;
      if (!c || !this.playing) return;
      if (this.nextBar < c.currentTime) this.nextBar = c.currentTime + 0.05; // after a stall, don't play catch-up
      while (this.nextBar < c.currentTime + 0.7) {
        const M = MOODS[this.mood];
        const beat = 60 / M.bpm;
        try { (this.mood === 'night' ? this._nightBar : this._loungeBar).call(this, this.nextBar, beat, M); } catch (e) { /* audio hiccup */ }
        this.nextBar += beat * 4;
        this.bar += 1;
      }
    },
    _chord(M, offset = 0) { return M.prog[Math.floor((this.bar + offset) / M.barsPerChord) % M.prog.length]; },

    _loungeBar(t, beat, M) {
      const ch = this._chord(M);
      const next = this._chord(M, 1);
      const sw = beat * 2 / 3; // swung eighth
      // piano comping: a rolled chord on 1, and a stab or two pushed off the beat
      this._chordHit(ch, t + 0.01, beat * 1.7, 0.42);
      if (Math.random() < 0.6) this._chordHit(ch, t + beat + sw, beat * 0.7, 0.26, true);
      if (Math.random() < 0.35) this._chordHit(ch, t + beat * 3 + sw, beat * 0.5, 0.22, true);
      // walking bass: root, a chord tone, another, then a step into the next chord
      const root = ch[0];
      const tones = [root, root + (Math.random() < 0.5 ? 7 : 3 + (ch.some((n) => (n - root) % 12 === 4) ? 1 : 0)), root + (Math.random() < 0.5 ? 12 : 7)];
      const nr = next[0];
      const approach = nr + (Math.random() < 0.5 ? 1 : -1);
      [...tones, approach].forEach((n, k) => this._bass(n, t + k * beat, beat * 0.92, k === 0 ? 0.55 : 0.42));
      // brushes: ride on the beats and the swung upbeats, swish on 2 and 4, a soft kick
      for (let k = 0; k < 4; k++) {
        this._ride(t + k * beat, k % 2 ? 0.08 : 0.06);
        if (k === 1 || k === 3) { this._ride(t + k * beat + sw, 0.045); this._swish(t + k * beat, 0.05); }
      }
      this._kick(t, 0.22);
      if (Math.random() < 0.4) this._kick(t + beat * 2, 0.14);
      // now and then a short melodic phrase on top
      if (Math.random() < 0.45) {
        const scale = [...new Set(ch.slice(1).map((n) => (n % 12)))];
        const n = 2 + Math.floor(Math.random() * 3);
        let at = beat * (Math.random() < 0.5 ? 0 : 1) + (Math.random() < 0.5 ? sw : 0);
        for (let k = 0; k < n && at < beat * 4; k++) {
          const pc = scale[Math.floor(Math.random() * scale.length)];
          this._ep(72 + pc + (Math.random() < 0.3 ? 12 : 0), t + at, beat * 1.2, 0.3, 0.7);
          at += Math.random() < 0.5 ? sw : beat;
        }
      }
    },
    _nightBar(t, beat, M) {
      const ch = this._chord(M);
      if (this.bar % M.barsPerChord === 0) {
        const len = beat * 4 * M.barsPerChord;
        ch.slice(1).forEach((n, k) => this._pad(n, t + k * 0.08, len, 0.06));
        this._bass(ch[0], t, len * 0.8, 0.45, 260);
      }
      if (Math.random() < 0.55) {
        const pc = ch[1 + Math.floor(Math.random() * (ch.length - 1))] % 12;
        this._ep(84 + pc, t + beat * (1 + Math.floor(Math.random() * 3)), beat * 3, 0.18, 1);
      }
    },

    // ---------- instruments ----------
    _pan(v) { const c = Sound.ctx; if (!c.createStereoPanner) return null; const p = c.createStereoPanner(); p.pan.value = v; return p; },
    _chordHit(ch, t, dur, vel, short) {
      ch.slice(1).forEach((n, k) => this._ep(n, t + (short ? 0 : k * 0.018), dur, vel * (0.8 + Math.random() * 0.3), short ? 0.5 : 0.8));
    },
    /** Electric piano: a two-operator FM voice with a bell-like bark that softens as it rings. */
    _ep(n, t, dur, vel, room) {
      const c = Sound.ctx; const f = mtof(n);
      const car = c.createOscillator(); car.frequency.value = f;
      const mod = c.createOscillator(); mod.frequency.value = f;
      const mg = c.createGain();
      mg.gain.setValueAtTime(f * 1.6 * vel, t);
      mg.gain.exponentialRampToValueAtTime(f * 0.08, t + 0.5);
      mod.connect(mg).connect(car.frequency);
      const tine = c.createOscillator(); tine.frequency.value = f * 4.02;
      const tg = c.createGain();
      tg.gain.setValueAtTime(0.0001, t); tg.gain.exponentialRampToValueAtTime(0.05 * vel, t + 0.004); tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      const g = c.createGain();
      const end = t + Math.max(0.4, dur) + 0.9;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.11 * vel, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.05 * vel, t + 0.35);
      g.gain.setTargetAtTime(0.0001, t + dur, 0.25);
      car.connect(g); tine.connect(tg).connect(g);
      const pan = this._pan((n - 64) / 40);
      if (pan) g.connect(pan).connect(this.bus); else g.connect(this.bus);
      if (room > 0.6) { const s = c.createGain(); s.gain.value = room - 0.6; g.connect(s).connect(this.send); }
      [car, mod, tine].forEach((o) => { o.start(t); o.stop(end); });
    },
    _bass(n, t, dur, vel, cutoff = 520) {
      const c = Sound.ctx; const f = mtof(n);
      const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = f;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(cutoff * 2, t); lp.frequency.exponentialRampToValueAtTime(cutoff, t + 0.15);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.32 * vel, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.14 * vel, t + 0.2);
      g.gain.setTargetAtTime(0.0001, t + dur * 0.85, 0.06);
      o.connect(lp); o2.connect(lp); lp.connect(g).connect(this.bus);
      [o, o2].forEach((x) => { x.start(t); x.stop(t + dur + 0.4); });
    },
    _pad(n, t, dur, vel) {
      const c = Sound.ctx; const f = mtof(n);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.4;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vel, t + dur * 0.35);
      g.gain.setTargetAtTime(0.0001, t + dur * 0.75, dur * 0.12);
      lp.connect(g);
      const pan = this._pan(Math.random() * 1.2 - 0.6);
      if (pan) g.connect(pan).connect(this.bus); else g.connect(this.bus);
      const s = c.createGain(); s.gain.value = 0.6; g.connect(s).connect(this.send);
      for (const d of [-7, 7]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = d; o.connect(lp); o.start(t); o.stop(t + dur * 1.3); }
    },
    _noiseBuf() {
      if (this._nb) return this._nb;
      const c = Sound.ctx; const len = c.sampleRate;
      const b = c.createBuffer(1, len, c.sampleRate); const d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this._nb = b; return b;
    },
    _hit(t, dur, vol, type, freq, q) {
      const c = Sound.ctx;
      const src = c.createBufferSource(); src.buffer = this._noiseBuf();
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q || 0.7;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.03, dur / 3)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(g).connect(this.bus);
      src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
    },
    _ride(t, vol) { this._hit(t, 0.12, vol, 'highpass', 7000); },
    _swish(t, vol) { this._hit(t, 0.22, vol, 'bandpass', 2600, 0.5); },
    _kick(t, vol) {
      const c = Sound.ctx;
      const o = c.createOscillator(); o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.18);
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.connect(g).connect(this.bus); o.start(t); o.stop(t + 0.35);
    },
    /** Vinyl crackle under everything: sparse clicks over a whisper of hiss. */
    _crackle(on) {
      const c = Sound.ctx;
      if (!c) return;
      if (!on) { if (this.crackle) { try { this.crackle.stop(); } catch (e) { /* ignore */ } this.crackle = null; } return; }
      if (this.crackle) return;
      const len = c.sampleRate * 4;
      const b = c.createBuffer(1, len, c.sampleRate); const d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.012 + (Math.random() < 0.0004 ? (Math.random() * 2 - 1) * 0.5 : 0);
      const src = c.createBufferSource(); src.buffer = b; src.loop = true;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 0.4;
      const g = c.createGain(); g.gain.value = 0.35;
      src.connect(f).connect(g).connect(this.bus);
      src.start();
      this.crackle = src;
    },
  };

  // ---------- the sound panel under the speaker button ----------
  const panel = h('div', { class: 'snd-panel', id: 'snd-panel', role: 'dialog', 'aria-label': 'Звук и музыка', hidden: true });
  document.body.append(panel);
  function row(label, on, vol, onToggle, onVol, note) {
    const id = 'snd-' + label.length + Math.random().toString(36).slice(2, 6);
    return h('div', { class: 'snd-row' },
      h('label', { class: 'snd-switch', for: id },
        h('input', { type: 'checkbox', id, checked: on, onchange: (e) => onToggle(e.target.checked) }),
        h('i', { 'aria-hidden': 'true' }),
        h('span', null, label)),
      h('input', { type: 'range', min: 0, max: 100, value: Math.round(vol * 100), 'aria-label': `Громкость: ${label.toLowerCase()}`, disabled: !on, oninput: (e) => onVol(e.target.value / 100) }),
      note ? h('small', { class: 'muted' }, note) : null);
  }
  function renderPanel() {
    if (panel.hidden) return;
    panel.replaceChildren(
      h('b', { class: 'snd-title' }, 'Звук'),
      row('Звуки игры', !Sound.muted, Sound.vol, (v) => { Sound.toggle(v); renderPanel(); }, (v) => Sound.setVolume(v)),
      row('Музыка клуба', Music.on, Music.vol, (v) => Music.setOn(v), (v) => Music.setVolume(v), Music.on ? `Сейчас играет: ${MOODS[Music.mood].name}` : 'Живой лаунж-джаз, каждый раз немного другой'));
  }
  function place() {
    const b = $('#sound-btn').getBoundingClientRect();
    panel.style.top = `${Math.round(b.bottom + 10)}px`;
    panel.style.right = `${Math.max(10, Math.round(window.innerWidth - b.right - 40))}px`;
  }
  function openPanel(open) {
    panel.hidden = !open;
    $('#sound-btn').setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) { Sound.ensure(); place(); renderPanel(); panel.querySelector('input').focus(); }
  }
  $('#sound-btn').addEventListener('click', (e) => { e.stopPropagation(); openPanel(panel.hidden); });
  document.addEventListener('click', (e) => { if (!panel.hidden && !panel.contains(e.target)) openPanel(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) { openPanel(false); $('#sound-btn').focus(); } });
  window.addEventListener('resize', () => { if (!panel.hidden) place(); });

  window.Music = Music;
  Music.init();
})();
