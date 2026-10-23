/* Voice chat at any table: browsers talk to each other directly (WebRTC), the server only introduces them.
   Only players sitting at the table can join. In mafia the game decides who may speak and whom you hear. */
(() => {
  'use strict';
  const NR = window.NR;
  const { $, $$, h, toast, call, S } = NR;
  const HASH = /^#\/(table|durak|bj|rl|ck|ch|cap|mf)\/([\w-]+)/;
  const MIC = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
  const MIC_OFF = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 9.3V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 5 2.2M5 11a7 7 0 0 0 11.5 5.3M19 11a7 7 0 0 1-.6 2.8M12 18v3M3 3l18 18"/></svg>';
  const HANG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 15.5c5-4.7 13-4.7 18 0l-2.3 2.6-3.6-1.4.2-2.5a12 12 0 0 0-6.6 0l.2 2.5-3.6 1.4z"/></svg>';

  const V = {
    key: null, sid: null, stream: null, peers: new Map(), muted: false, policy: { speak: true, hear: null, note: '' },
    ice: [], joining: false, analyser: null, level: 0,
  };
  window.Voice = V;

  // ---------- buttons in every table header and the dock ----------
  $$('[data-invite]').forEach((inv) => {
    const b = h('button', { type: 'button', class: 'btn btn-ghost btn-sm voice-btn', 'data-voice': '', 'aria-pressed': 'false', title: 'Голосовой чат за столом' });
    b.innerHTML = `${MIC}<span class="btn-label">Голос</span>`;
    b.addEventListener('click', () => (V.key ? toggleMute() : join()));
    inv.before(b);
  });
  const dock = h('div', { class: 'voice-dock', id: 'voice-dock', role: 'region', 'aria-label': 'Голосовой чат', hidden: true });
  document.body.append(dock);

  const tableFromHash = () => { const m = HASH.exec(location.hash); return m ? { kind: m[1], id: m[2], key: `${m[1]}:${m[2]}` } : null; };

  // ---------- joining and leaving ----------
  async function join() {
    const t = tableFromHash();
    if (!t || V.joining) return;
    if (!navigator.mediaDevices || !window.RTCPeerConnection) { toast('Этот браузер не поддерживает голосовой чат', true); return; }
    V.joining = true;
    render();
    try {
      if (!V.stream) {
        V.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
        meter();
      }
    } catch (e) {
      V.joining = false; render();
      toast(e && e.name === 'NotAllowedError' ? 'Нет доступа к микрофону — разрешите его в настройках браузера' : 'Не удалось включить микрофон', true);
      return;
    }
    const res = await call('voice:join', { kind: t.kind, id: t.id });
    V.joining = false;
    if (!res) { stopStream(); render(); return; }
    V.key = t.key; V.sid = res.sid; V.ice = res.iceServers; V.policy = res.policy;
    applyPolicy();
    for (const p of res.peers) connect(p, true);
    if (window.Music) window.Music.duck(true);
    NR.Sound.play('ping');
    render();
  }

  function leave(silent) {
    if (!V.key) return;
    call('voice:leave', {}, true);
    for (const id of [...V.peers.keys()]) drop(id);
    V.key = null; V.sid = null;
    stopStream();
    if (window.Music) window.Music.duck(false);
    if (!silent) NR.Sound.play('fold');
    render();
  }
  function stopStream() {
    if (V.stream) V.stream.getTracks().forEach((tr) => tr.stop());
    V.stream = null;
    if (V.meterTimer) { clearInterval(V.meterTimer); V.meterTimer = null; }
  }

  function toggleMute() {
    V.muted = !V.muted;
    applyPolicy();
    call('voice:mute', { muted: V.muted }, true);
    render();
  }

  // ---------- peers ----------
  function connect(p, initiator) {
    if (V.peers.has(p.sid)) return V.peers.get(p.sid);
    const pc = new RTCPeerConnection({ iceServers: V.ice });
    const audio = new Audio();
    audio.autoplay = true;
    audio.setAttribute('playsinline', '');
    const peer = { ...p, pc, audio, level: 0, speaking: false, restarted: false };
    V.peers.set(p.sid, peer);
    if (V.stream) V.stream.getTracks().forEach((tr) => pc.addTrack(tr, V.stream));
    pc.onicecandidate = (e) => { if (e.candidate) call('voice:signal', { to: p.sid, data: { candidate: e.candidate } }, true); };
    pc.ontrack = (e) => {
      audio.srcObject = e.streams[0];
      audio.play().catch(() => {});
      peerMeter(peer, e.streams[0]);
      applyPolicy();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' && initiator && !peer.restarted) { peer.restarted = true; offer(peer, true); }
      render();
    };
    if (initiator) offer(peer);
    render();
    return peer;
  }
  async function offer(peer, restart) {
    try {
      const o = await peer.pc.createOffer(restart ? { iceRestart: true } : undefined);
      await peer.pc.setLocalDescription(o);
      call('voice:signal', { to: peer.sid, data: { sdp: peer.pc.localDescription } }, true);
    } catch (e) { /* the peer will retry */ }
  }
  function drop(sid) {
    const p = V.peers.get(sid);
    if (!p) return;
    try { p.pc.close(); } catch (e) { /* closed */ }
    p.audio.srcObject = null;
    V.peers.delete(sid);
    render();
  }

  async function onSignal({ from, data }) {
    if (!V.key) return;
    let peer = V.peers.get(from);
    if (!peer) peer = connect({ sid: from, name: '…', userId: null }, false);
    try {
      if (data.sdp) {
        await peer.pc.setRemoteDescription(data.sdp);
        if (data.sdp.type === 'offer') {
          const a = await peer.pc.createAnswer();
          await peer.pc.setLocalDescription(a);
          call('voice:signal', { to: from, data: { sdp: peer.pc.localDescription } }, true);
        }
      } else if (data.candidate) await peer.pc.addIceCandidate(data.candidate);
    } catch (e) { /* stale candidate */ }
  }

  /** The game's rules: whether my mic may send, and whose voices are played. */
  function applyPolicy() {
    const pol = V.policy || {};
    if (V.stream) V.stream.getAudioTracks().forEach((tr) => { tr.enabled = !V.muted && pol.speak !== false; });
    for (const p of V.peers.values()) p.audio.muted = !(pol.hear == null || pol.hear.includes(p.userId));
  }

  // ---------- who is talking ----------
  let actx = null;
  const ctx = () => { if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; } } return actx; };
  function levelOf(stream) {
    const c = ctx();
    if (!c) return () => 0;
    const src = c.createMediaStreamSource(stream);
    const an = c.createAnalyser(); an.fftSize = 512;
    src.connect(an);
    const d = new Uint8Array(an.fftSize);
    return () => { an.getByteTimeDomainData(d); let s = 0; for (const x of d) { const v = (x - 128) / 128; s += v * v; } return Math.sqrt(s / d.length); };
  }
  function meter() { V.myLevel = levelOf(V.stream); }
  function peerMeter(peer, stream) { peer.levelFn = levelOf(stream); }
  setInterval(() => {
    if (!V.key) return;
    let changed = false;
    const me = !!(V.myLevel && !V.muted && V.policy.speak !== false && V.myLevel() > 0.035);
    if (me !== V.meSpeaking) { V.meSpeaking = me; changed = true; }
    for (const p of V.peers.values()) {
      const on = !!(p.levelFn && !p.audio.muted && p.levelFn() > 0.03);
      if (on !== p.speaking) { p.speaking = on; changed = true; }
    }
    if (changed) render();
  }, 150);

  // ---------- drawing ----------
  // At the table the header button carries the faces of everyone in the voice chat (they light up when talking);
  // elsewhere in the club a small dock keeps the call within reach.
  function people() {
    const me = S.me || { name: 'Вы' };
    return [{ name: me.name, avatar: me.avatar, speaking: V.meSpeaking, muted: V.muted || V.policy.speak === false, self: true },
      ...[...V.peers.values()].map((p) => ({ name: p.name, avatar: p.avatar, speaking: p.speaking, muted: p.muted, deaf: p.audio.muted, state: p.pc.connectionState }))];
  }
  const faces = (cls) => h('span', { class: cls }, ...people().map((p) => h('span', {
    class: 'vd-p' + (p.speaking ? ' talk' : '') + (p.muted ? ' mute' : '') + (p.deaf ? ' deaf' : '') + (p.state && p.state !== 'connected' ? ' wait' : ''),
    title: `${p.name}${p.self ? ' (вы)' : ''}${p.muted ? ' · микрофон выключен' : ''}${p.state && p.state !== 'connected' ? ' · подключается' : ''}`,
  }, NR.avatarEl(p.name, p.avatar, 'xs'), p.muted ? h('i', { class: 'vd-x', 'aria-hidden': 'true' }) : null)));

  function render() {
    const here = tableFromHash();
    if (V.key && here && here.key !== V.key) leave(true);
    const live = !!V.key;
    const off = live && (V.muted || V.policy.speak === false);
    $$('[data-voice]').forEach((b) => {
      b.classList.toggle('on', live);
      b.classList.toggle('muted', off);
      b.classList.toggle('talking', live && (V.meSpeaking || [...V.peers.values()].some((p) => p.speaking)));
      b.setAttribute('aria-pressed', live && !V.muted ? 'true' : 'false');
      b.disabled = V.joining;
      b.innerHTML = `${off ? MIC_OFF : MIC}<span class="btn-label">${V.joining ? 'Подключаем…' : !live ? 'Голос' : ''}</span>`;
      if (live) b.append(faces('vb-people'));
      b.title = !live ? 'Голосовой чат за столом' : `${V.policy.note ? V.policy.note + '. ' : ''}${V.muted ? 'Нажмите, чтобы включить микрофон' : 'Нажмите, чтобы выключить микрофон'}`;
      let x = b.nextElementSibling;
      if (!x || !x.matches('[data-voice-leave]')) {
        x = h('button', { type: 'button', class: 'btn btn-ghost btn-sm voice-leave', 'data-voice-leave': '', 'aria-label': 'Выйти из голосового чата', title: 'Выйти из голосового чата', onclick: () => leave() });
        x.innerHTML = HANG;
        b.after(x);
      }
      x.hidden = !live;
    });
    renderDock(here);
  }
  function renderDock(here = tableFromHash()) {
    const show = !!V.key && !(here && here.key === V.key);
    dock.hidden = !show;
    document.body.classList.toggle('voice-on', show);
    if (!show) return;
    dock.replaceChildren(...[
      faces('vd-people'),
      V.policy.note ? h('small', { class: 'vd-note' }, V.policy.note) : null,
      h('a', { class: 'vd-back', href: '#/' + V.key.replace(':', '/') }, 'К столу'),
      (() => { const b = h('button', { type: 'button', class: 'vd-btn' + (V.muted ? ' off' : ''), 'aria-label': V.muted ? 'Включить микрофон' : 'Выключить микрофон', onclick: toggleMute }); b.innerHTML = V.muted ? MIC_OFF : MIC; return b; })(),
      (() => { const b = h('button', { type: 'button', class: 'vd-btn hang', 'aria-label': 'Выйти из голосового чата', onclick: () => leave() }); b.innerHTML = HANG; return b; })()].filter(Boolean));
  }

  // ---------- server events ----------
  function bind(socket) {
    if (bind.done === socket) return;
    bind.done = socket;
    socket.on('voice:joined', (p) => { if (V.key) { connect(p, false); NR.Sound.play('ping'); } });
    socket.on('voice:left', ({ sid }) => drop(sid));
    socket.on('voice:signal', onSignal);
    socket.on('voice:muted', ({ sid, muted }) => { const p = V.peers.get(sid); if (p) { p.muted = muted; render(); } });
    socket.on('voice:policy', (pol) => { const was = V.policy.note; V.policy = pol; applyPolicy(); render(); if (pol.note && pol.note !== was) toast(pol.note); });
    socket.on('voice:kicked', ({ reason }) => { if (V.key) { leave(true); toast(`Голосовой чат: ${reason}`); } });
    // after a reconnect the server has forgotten us: join again
    socket.on('connect', () => { if (V.key) { const t = V.key; for (const id of [...V.peers.keys()]) drop(id); V.key = null; if (tableFromHash() && tableFromHash().key === t) join(); else stopStream(); render(); } });
  }
  if (S.socket) bind(S.socket);
  setInterval(() => { if (S.socket && bind.done !== S.socket) bind(S.socket); }, 1000);
  window.addEventListener('hashchange', render);
  window.addEventListener('pagehide', () => leave(true));
  render();
})();
