'use strict';
/* =====================================================================
   JOGATINA DOS AMIGOS — cliente v2 (by C0kz)
   ===================================================================== */
(() => {
  /* ------------------------------ helpers ------------------------------ */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k in el) el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach(c => {
      if (c == null || c === false) return;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    });
    return el;
  }
  const safeColor = c => (/^#[0-9a-f]{6}$/i.test(c) ? c : '#a855f7');
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* ------------------------------ configurações ------------------------------ */
  const THEMES = {
    neon: { name: 'Neon Roxo', c: ['#a855f7', '#06b6d4', '#ec4899'] },
    rose: { name: 'Rosa Solar', c: ['#f43f5e', '#f59e0b', '#a855f7'] },
    matrix: { name: 'Matrix', c: ['#10b981', '#84cc16', '#06b6d4'] },
    ice: { name: 'Gelo', c: ['#38bdf8', '#818cf8', '#22d3ee'] },
    solar: { name: 'Solar', c: ['#f59e0b', '#ef4444', '#a855f7'] }
  };
  const AVATAR_COLORS = ['#a855f7', '#06b6d4', '#ec4899', '#10b981', '#f59e0b', '#6366f1', '#f43f5e', '#22d3ee'];
  const DEFAULTS = {
    profileColor: '', status: 'online', customStatus: '', autoIdle: true,
    inputDevice: 'default', outputDevice: 'default', inputVolume: 100, outputVolume: 100,
    noiseSuppression: true, echoCancellation: true, autoGain: true,
    inputMode: 'open', sensitivity: 35,
    pttKey: 'KeyV', muteKey: 'Ctrl+Shift+KeyM', deafenKey: 'Ctrl+Shift+KeyD',
    shareRes: '1080', shareFps: 30, shareBitrate: 4000, shareHint: 'motion', shareAudio: true,
    sounds: true, soundVolume: 50, desktopNotif: false, mentionsOnly: false, voiceSounds: true,
    theme: 'neon', compact: false, fontScale: 100, reduceMotion: false
  };
  let settings = (() => {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('jogatina_settings_v2') || '{}') }; }
    catch (_) { return { ...DEFAULTS }; }
  })();
  const saveSettings = () => { try { localStorage.setItem('jogatina_settings_v2', JSON.stringify(settings)); } catch (_) {} };

  function applyTheme() {
    const t = THEMES[settings.theme] || THEMES.neon;
    const root = document.documentElement.style;
    const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(' ');
    ['a1', 'a2', 'a3'].forEach((k, i) => { root.setProperty('--' + k, t.c[i]); root.setProperty(`--${k}-rgb`, rgb(t.c[i])); });
    root.fontSize = clamp(settings.fontScale, 80, 140) + '%';
    document.body.classList.toggle('compact', !!settings.compact);
    document.body.classList.toggle('no-motion', !!settings.reduceMotion);
  }

  /* ------------------------------ estado ------------------------------ */
  const state = {
    socket: null, meId: null, users: [], channels: [], iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    activeText: null, voice: null, messages: {}, unread: {}, mentions: {}, typing: {},
    muted: false, deafened: false, serverMuted: false,
    screens: {}, screenStream: null, userVol: {}, userMuted: {},
    replyTo: null, editing: null, ai: false, joined: false, password: '',
    autoIdled: false, lastActivity: Date.now(), pendingChannelOpen: null
  };
  const peers = {};
  const remote = {};
  const speakingNow = new Set();
  let monitorOn = false;
  let settingsOpen = false;
  let voiceTabOpen = false;

  const me = () => state.users.find(u => u.id === state.meId);
  const isAdmin = () => ['owner', 'admin'].includes(me()?.role);
  const isOwner = () => me()?.role === 'owner';
  const userById = id => state.users.find(u => u.id === id);
  const chById = id => state.channels.find(c => c.id === id);

  /* ------------------------------ UI utilitários ------------------------------ */
  function toast(message, type) {
    const t = h('div', { class: 'toast' + (type === 'error' ? ' error' : '') }, message);
    $('#toasts').append(t);
    setTimeout(() => t.remove(), 4500);
  }
  function avatar(user, size = '', withStatus = false) {
    return h('div', { class: 'avatar ' + size, style: `--c:${safeColor(user.color)}`, dataset: { speak: user.id || '' } },
      (user.nick || '?').trim().charAt(0).toUpperCase(),
      withStatus ? h('span', { class: 'sdot ' + (user.status || 'online') }) : null);
  }
  const roleTag = r => (r === 'owner' ? h('span', { class: 'role-tag owner' }, 'DONO') : r === 'admin' ? h('span', { class: 'role-tag admin' }, 'ADMIN') : null);
  function fmtTime(ts) {
    const d = new Date(ts), now = new Date();
    const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === now.toDateString()) return hm;
    return d.toLocaleDateString([], { day: '2-digit', month: '2-digit' }) + ' ' + hm;
  }

  /* ------------------------------ sons ------------------------------ */
  function beep(seq, type = 'sine') {
    if (!settings.sounds || !audio.ctx || state.deafened) return;
    const vol = (settings.soundVolume / 100) * 0.25;
    let t = audio.ctx.currentTime;
    seq.forEach(([f, d]) => {
      const o = audio.ctx.createOscillator(), g = audio.ctx.createGain();
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g); g.connect(audio.ctx.destination);
      o.start(t); o.stop(t + d + 0.02);
      t += d * 0.9;
    });
  }
  const SOUNDS = {
    join: () => settings.voiceSounds && beep([[520, .09], [780, .12]]),
    leave: () => settings.voiceSounds && beep([[780, .09], [440, .13]]),
    msg: () => beep([[660, .07]]),
    mention: () => beep([[880, .08], [1100, .12]], 'triangle'),
    mute: () => beep([[300, .08]], 'square'),
    unmute: () => beep([[500, .08]], 'square'),
    deaf: () => beep([[260, .1], [200, .12]], 'square'),
    undeaf: () => beep([[420, .08], [560, .08]], 'square')
  };

  /* ------------------------------ motor de áudio ------------------------------ */
  const audio = { ctx: null, raw: null, src: null, inGain: null, analyser: null, gate: null, dest: null, master: null, monitor: null,
    outStream: null, outTrack: null, fbuf: null, level: 0, hold: 0, open: false, ptt: false };

  async function ensureCtx() {
    if (!audio.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      audio.ctx = new AC({ latencyHint: 'interactive' });
      const c = audio.ctx;
      audio.inGain = c.createGain();
      audio.inGain.gain.value = settings.inputVolume / 100;
      audio.analyser = c.createAnalyser();
      audio.analyser.fftSize = 1024;
      audio.fbuf = new Float32Array(audio.analyser.fftSize);
      audio.gate = c.createGain();
      audio.dest = c.createMediaStreamDestination();
      audio.monitor = c.createGain();
      audio.monitor.gain.value = 0;
      audio.master = c.createGain();
      audio.master.gain.value = settings.outputVolume / 100;
      audio.inGain.connect(audio.analyser);
      audio.inGain.connect(audio.gate);
      audio.gate.connect(audio.dest);
      audio.gate.connect(audio.monitor);
      audio.monitor.connect(c.destination);
      audio.master.connect(c.destination);
      audio.outStream = audio.dest.stream;
      audio.outTrack = audio.dest.stream.getAudioTracks()[0];
      applyOutputDevice();
    }
    if (audio.ctx.state === 'suspended') await audio.ctx.resume().catch(() => {});
  }
  function applyOutputDevice() {
    const id = settings.outputDevice === 'default' ? '' : settings.outputDevice;
    try { audio.ctx?.setSinkId?.(id); } catch (_) {}
    $$('video').forEach(v => { try { v.setSinkId?.(id); } catch (_) {} });
  }
  function stopMicSource() {
    try { audio.src?.disconnect(); } catch (_) {}
    audio.raw?.getTracks().forEach(t => t.stop());
    audio.src = null; audio.raw = null;
  }
  async function startMic() {
    await ensureCtx();
    stopMicSource();
    const a = { echoCancellation: settings.echoCancellation, noiseSuppression: settings.noiseSuppression, autoGainControl: settings.autoGain };
    if (settings.inputDevice !== 'default') a.deviceId = { exact: settings.inputDevice };
    let raw;
    try {
      raw = await navigator.mediaDevices.getUserMedia({ audio: a });
    } catch (e) {
      if (e.name === 'OverconstrainedError' && a.deviceId) {
        delete a.deviceId; settings.inputDevice = 'default'; saveSettings();
        raw = await navigator.mediaDevices.getUserMedia({ audio: a });
      } else throw e;
    }
    audio.raw = raw;
    audio.src = audio.ctx.createMediaStreamSource(raw);
    audio.src.connect(audio.inGain);
    raw.getAudioTracks()[0].onended = () => { audio.raw = null; };
  }
  async function tryStartMic() {
    try { await startMic(); return true; }
    catch (e) {
      console.warn('Microfone indisponível:', e);
      toast('Sem acesso ao microfone. Você ouvirá os outros, mas não poderá falar.', 'error');
      return false;
    }
  }
  const effectiveMuted = () => state.muted || state.deafened || state.serverMuted;

  function audioTick() {
    if (!audio.ctx) return;
    let pct = 0;
    if (audio.raw) {
      audio.analyser.getFloatTimeDomainData(audio.fbuf);
      let sum = 0;
      for (let i = 0; i < audio.fbuf.length; i++) sum += audio.fbuf[i] * audio.fbuf[i];
      const rms = Math.sqrt(sum / audio.fbuf.length);
      pct = clamp(((20 * Math.log10(rms + 1e-9)) + 70) / 70, 0, 1) * 100;
    }
    audio.level = pct;
    const now = performance.now();
    let open;
    if (!audio.raw || effectiveMuted()) open = false;
    else if (settings.inputMode === 'ptt') open = audio.ptt;
    else if (settings.inputMode === 'vad') { if (pct >= settings.sensitivity) audio.hold = now + 400; open = now < audio.hold; }
    else open = true;
    if (open !== audio.open) {
      audio.open = open;
      audio.gate.gain.setTargetAtTime(open ? 1 : 0, audio.ctx.currentTime, 0.012);
    }
    const minLvl = settings.inputMode === 'vad' ? settings.sensitivity : 22;
    const next = new Set();
    if (state.meId && open && pct >= minLvl) next.add(state.meId);
    for (const [id, r] of Object.entries(remote)) {
      r.an.getFloatTimeDomainData(r.buf);
      let s = 0;
      for (let i = 0; i < r.buf.length; i++) s += r.buf[i] * r.buf[i];
      const p = clamp(((20 * Math.log10(Math.sqrt(s / r.buf.length) + 1e-9)) + 70) / 70, 0, 1) * 100;
      if (p >= 30 && !state.userMuted[id] && !state.deafened) next.add(id);
    }
    if (next.size !== speakingNow.size || [...next].some(x => !speakingNow.has(x))) {
      speakingNow.clear(); next.forEach(x => speakingNow.add(x));
      applySpeaking();
    }
    if (settingsOpen && voiceTabOpen) {
      const fill = $('#meter-fill'), thr = $('#meter-thr');
      if (fill) fill.style.width = pct + '%';
      if (thr) thr.style.left = settings.sensitivity + '%';
    }
  }
  function applySpeaking() {
    $$('[data-speak]').forEach(el => el.classList.toggle('speaking', speakingNow.has(el.dataset.speak)));
  }
  setInterval(audioTick, 60);

  /* ------------------------------ áudio remoto ------------------------------ */
  function remoteGainValue(id) {
    if (state.deafened || state.userMuted[id]) return 0;
    return (state.userVol[id] ?? 100) / 100;
  }
  function attachRemoteAudio(id, stream) {
    detachRemoteAudio(id);
    const c = audio.ctx;
    if (!c) return;
    const el = new Audio();
    el.srcObject = stream; el.muted = true;
    el.play().catch(() => {});
    const src = c.createMediaStreamSource(stream);
    const gain = c.createGain();
    const an = c.createAnalyser();
    an.fftSize = 512;
    src.connect(gain); gain.connect(audio.master); src.connect(an);
    remote[id] = { el, src, gain, an, buf: new Float32Array(an.fftSize) };
    gain.gain.value = remoteGainValue(id);
  }
  function detachRemoteAudio(id) {
    const r = remote[id];
    if (!r) return;
    try { r.src.disconnect(); r.gain.disconnect(); } catch (_) {}
    r.el.srcObject = null;
    delete remote[id];
  }
  function applyAllRemoteGains() {
    Object.keys(remote).forEach(id => { remote[id].gain.gain.value = remoteGainValue(id); });
    $$('#video-grid video').forEach(v => { if (!v.dataset.local) v.muted = state.deafened; });
  }

  /* ------------------------------ WebRTC (perfect negotiation) ------------------------------ */
  function createPeer(id, nick) {
    if (peers[id] || id === state.meId) return peers[id];
    const pc = new RTCPeerConnection({ iceServers: state.iceServers });
    const p = { id, nick, pc, polite: state.meId < id, makingOffer: false, ignoreOffer: false, screenSenders: [] };
    peers[id] = p;
    if (audio.outTrack) pc.addTrack(audio.outTrack, audio.outStream);
    else pc.addTransceiver('audio', { direction: 'recvonly' });
    if (state.screenStream) addScreenToPeer(p);

    pc.onicecandidate = e => { if (e.candidate) state.socket.emit('signal', { to: id, candidate: e.candidate }); };
    pc.onnegotiationneeded = async () => {
      try {
        p.makingOffer = true;
        await pc.setLocalDescription();
        state.socket.emit('signal', { to: id, description: pc.localDescription });
      } catch (e) { console.warn('negociação:', e); } finally { p.makingOffer = false; }
    };
    pc.ontrack = e => onRemoteTrack(p, e);
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') try { pc.restartIce(); } catch (_) {} };
    return p;
  }
  async function onSignal({ from, description, candidate }) {
    let p = peers[from];
    if (!p) {
      if (!state.voice) return;
      p = createPeer(from, userById(from)?.nick || '???');
    }
    const pc = p.pc;
    try {
      if (description) {
        const collision = description.type === 'offer' && (p.makingOffer || pc.signalingState !== 'stable');
        p.ignoreOffer = !p.polite && collision;
        if (p.ignoreOffer) return;
        await pc.setRemoteDescription(description);
        if (description.type === 'offer') {
          await pc.setLocalDescription();
          state.socket.emit('signal', { to: from, description: pc.localDescription });
        }
      } else if (candidate) {
        try { await pc.addIceCandidate(candidate); } catch (e) { if (!p.ignoreOffer) throw e; }
      }
    } catch (e) { console.warn('sinalização:', e); }
  }
  function onRemoteTrack(p, e) {
    const stream = e.streams[0] || new MediaStream([e.track]);
    if (e.track.kind === 'video') {
      showRemoteScreen(p, stream);
    } else if (e.track.kind === 'audio') {
      if (stream.id === state.screens[p.id] || stream.getVideoTracks().length) return; // áudio da tela toca pelo <video>
      attachRemoteAudio(p.id, stream);
    }
  }
  function removePeer(id) {
    const p = peers[id];
    if (p) { try { p.pc.close(); } catch (_) {} delete peers[id]; }
    detachRemoteAudio(id);
    removeTile(id);
    delete state.screens[id];
    delete remote[id];
  }
  function closeAllPeers() {
    Object.keys(peers).forEach(removePeer);
    $$('#video-grid .video-box:not(.local)').forEach(el => el.remove());
    refreshStage();
  }

  /* ------------------------------ compartilhar tela ------------------------------ */
  function addScreenToPeer(p) {
    state.screenStream.getTracks().forEach(t => {
      const s = p.pc.addTrack(t, state.screenStream);
      p.screenSenders.push(s);
      if (t.kind === 'video') { tuneSender(s); setTimeout(() => tuneSender(s), 1500); }
    });
  }
  async function tuneSender(s) {
    try {
      const pr = s.getParameters();
      if (!pr.encodings || !pr.encodings.length) pr.encodings = [{}];
      pr.encodings[0].maxBitrate = settings.shareBitrate * 1000;
      pr.encodings[0].maxFramerate = settings.shareFps;
      pr.degradationPreference = settings.shareHint === 'detail' ? 'maintain-resolution' : 'maintain-framerate';
      await s.setParameters(pr);
    } catch (_) {}
  }
  async function toggleScreenShare() {
    if (!state.voice) return toast('Entre em um canal de voz para compartilhar a tela.');
    if (state.screenStream) return stopShare(true);
    const v = { frameRate: { ideal: settings.shareFps, max: settings.shareFps } };
    if (settings.shareRes === '720') { v.width = { ideal: 1280 }; v.height = { ideal: 720 }; }
    if (settings.shareRes === '1080') { v.width = { ideal: 1920 }; v.height = { ideal: 1080 }; }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: v, audio: settings.shareAudio ? { echoCancellation: false, noiseSuppression: false } : false
      });
      const vt = stream.getVideoTracks()[0];
      try { vt.contentHint = settings.shareHint; } catch (_) {}
      state.screenStream = stream;
      state.socket.emit('screen:share', { streamId: stream.id });
      Object.values(peers).forEach(addScreenToPeer);
      vt.onended = () => stopShare(true);
      showLocalScreen(stream);
      renderVoicePanel();
    } catch (e) {
      if (e.name !== 'NotAllowedError') toast('Não foi possível compartilhar a tela.', 'error');
    }
  }
  function stopShare(notify) {
    const s = state.screenStream;
    if (!s) return;
    s.getTracks().forEach(t => { t.onended = null; t.stop(); });
    Object.values(peers).forEach(p => {
      p.screenSenders.forEach(sn => { try { p.pc.removeTrack(sn); } catch (_) {} });
      p.screenSenders = [];
    });
    state.screenStream = null;
    if (notify && state.socket?.connected) state.socket.emit('screen:share', { streamId: null });
    removeTile('local');
    refreshStage();
    renderVoicePanel();
  }

  /* tiles de vídeo */
  function buildTile(id, label, stream, local) {
    const video = h('video', { autoplay: true, playsInline: true, muted: !!local || state.deafened });
    if (local) video.dataset.local = '1';
    video.srcObject = stream;
    video.play?.().catch(() => {});
    try { video.setSinkId?.(settings.outputDevice === 'default' ? '' : settings.outputDevice); } catch (_) {}
    const box = h('div', { class: 'video-box' + (local ? ' local' : ''), dataset: { tile: id } });
    const controls = h('div', { class: 'vb-controls' });
    if (!local) {
      const vol = h('input', { type: 'range', min: 0, max: 100, value: 100, class: 'vb-vol', title: 'Volume da transmissão' });
      vol.addEventListener('input', () => { video.volume = vol.value / 100; });
      controls.append(vol);
    }
    controls.append(
      h('button', { class: 'vb-btn', title: 'Expandir / Reduzir', onclick: () => box.classList.toggle('expanded') }, '🔲'),
      h('button', { class: 'vb-btn', title: 'Tela cheia', onclick: () => video.requestFullscreen?.() }, '⛶')
    );
    box.append(h('div', { class: 'vb-label cyber' }, label), controls, video);
    return box;
  }
  function showLocalScreen(stream) {
    removeTile('local');
    $('#video-grid').append(buildTile('local', '🔴 LIVE Sua Tela', stream, true));
    refreshStage();
  }
  function showRemoteScreen(p, stream) {
    let box = $(`[data-tile="${CSS.escape(p.id)}"]`);
    if (box) { const v = $('video', box); v.srcObject = stream; v.play?.().catch(() => {}); }
    else { $('#video-grid').append(buildTile(p.id, '🔴 LIVE ' + p.nick, stream, false)); }
    refreshStage();
  }
  function removeTile(id) {
    const b = $(`[data-tile="${CSS.escape(id)}"]`);
    if (b) { const v = $('video', b); if (v) v.srcObject = null; b.remove(); }
    refreshStage();
  }
  function refreshStage() { $('#stage').classList.toggle('hidden', !$('#video-grid .video-box')); }

  /* ------------------------------ voz ------------------------------ */
  async function joinVoice(chId) {
    if (state.voice === chId) return;
    await ensureCtx();
    if (!audio.raw) await tryStartMic();
    state.socket.emit('voice:join', { channelId: chId });
  }
  function leaveVoice() {
    if (!state.voice) return;
    stopShare(false);
    state.socket.emit('voice:leave');
    closeAllPeers();
    state.voice = null;
    if (!settingsOpen) stopMicSource();
    SOUNDS.leave();
    renderAll();
  }
  function sendVoiceState() { state.socket?.emit('voice:state', { muted: state.muted, deafened: state.deafened }); }
  function toggleMute() {
    if (state.serverMuted) return toast('Você foi silenciado por um administrador.', 'error');
    if (state.deafened) { state.deafened = false; applyAllRemoteGains(); }
    state.muted = !state.muted;
    (state.muted ? SOUNDS.mute : SOUNDS.unmute)();
    sendVoiceState(); renderUserPanel(); renderChannels();
  }
  function toggleDeafen() {
    state.deafened = !state.deafened;
    applyAllRemoteGains();
    (state.deafened ? SOUNDS.deaf : SOUNDS.undeaf)();
    sendVoiceState(); renderUserPanel(); renderChannels();
  }

  /* ------------------------------ socket ------------------------------ */
  function connect(nick, password, token, color) {
    const socket = io({ transports: ['websocket', 'polling'] });
    state.socket = socket;
    socket.on('connect', () => socket.emit('join', { nick, password, token, color }));
    socket.on('connect_error', () => showLoginError('Não foi possível conectar ao servidor.'));
    socket.on('need-password', () => {
      $('#pass-wrap').classList.remove('hidden');
      showLoginError('Esse é o nick do dono. Informe a senha do administrador principal.');
      $('#input-pass').focus();
      socket.disconnect();
    });
    socket.on('join-error', msg => { showLoginError(msg); socket.disconnect(); });
    socket.on('banned', d => { alert(d?.message || 'Você foi banido.'); location.reload(); });
    socket.on('kicked', d => { alert(d?.message || 'Você foi expulso.'); location.reload(); });
    socket.on('app-error', m => toast(typeof m === 'string' ? m : 'Ocorreu um erro.', 'error'));
    socket.on('toast', d => toast(d?.message || ''));

    socket.on('init', d => {
      const first = !state.joined;
      state.meId = d.meId; state.channels = d.channels; state.users = d.users; state.ai = !!d.ai;
      if (Array.isArray(d.iceServers)) state.iceServers = d.iceServers;
      state.joined = true;
      $('#login-screen').classList.add('hidden');
      $('#app').classList.remove('hidden');
      $('#btn-login').disabled = false;
      $('#ai-badge').textContent = state.ai ? 'GEMINI' : 'LOCAL';
      $('#ai-badge').classList.toggle('on', state.ai);
      if (first) {
        aiSay('bot', state.ai
          ? 'Olá! Sou o secretário do C0kz, com IA Gemini conectada. Pergunte o que quiser.'
          : 'Olá! Sou o secretário do C0kz. Estou em modo local: faço contas, dou dicas do Arcade e ajudo com a sala.');
      }
      const keep = chById(state.activeText) ? state.activeText : state.channels.find(c => c.type === 'text')?.id;
      sendProfile();
      sendVoiceState();
      openText(keep);
      renderAll();
    });
    socket.on('users', list => {
      state.users = list;
      const m = me();
      if (m && m.serverMuted !== state.serverMuted) {
        state.serverMuted = m.serverMuted;
        toast(m.serverMuted ? 'Um administrador silenciou você.' : 'Você pode falar novamente.');
      }
      renderAll();
    });
    socket.on('channels', list => {
      state.channels = list;
      if (!chById(state.activeText)) openText(state.channels.find(c => c.type === 'text')?.id);
      if (state.voice && !chById(state.voice)) state.voice = null;
      renderAll();
    });

    socket.on('voice:joined', ({ channelId, peers: list, screens }) => {
      stopShare(false);
      closeAllPeers();
      state.voice = channelId;
      state.screens = {};
      (screens || []).forEach(s => { state.screens[s.peerId] = s.streamId; });
      list.forEach(p => createPeer(p.id, p.nick));
      SOUNDS.join();
      sendVoiceState();
      renderAll();
    });
    socket.on('voice:peer-joined', ({ peerId, nick: n }) => {
      if (!state.voice) return;
      createPeer(peerId, n);
      SOUNDS.join();
    });
    socket.on('voice:peer-left', id => { removePeer(id); SOUNDS.leave(); });
    socket.on('voice:kicked', d => { closeAllPeers(); stopShare(false); state.voice = null; toast(d?.message || 'Desconectado da voz.', 'error'); renderAll(); });
    socket.on('force-move', ({ channelId }) => toast('Você foi movido para: ' + (chById(channelId)?.name || 'outro canal')));
    socket.on('screen:share', ({ peerId, streamId }) => {
      if (streamId) state.screens[peerId] = streamId;
      else { delete state.screens[peerId]; removeTile(peerId); }
    });
    socket.on('signal', onSignal);

    socket.on('chat:history', ({ channelId, messages }) => {
      state.messages[channelId] = messages;
      if (channelId === state.activeText) renderMessages();
    });
    socket.on('chat:message', m => {
      (state.messages[m.channelId] = state.messages[m.channelId] || []).push(m);
      if (state.typing[m.channelId]) delete state.typing[m.channelId][m.author.nick];
      renderTyping();
      const mine = m.author.nick === me()?.nick;
      if (m.channelId === state.activeText) {
        appendMessage(m);
        if (document.hidden && !mine) notifyMessage(m, mentionsMe(m));
      } else if (!mine) {
        const men = mentionsMe(m);
        state.unread[m.channelId] = (state.unread[m.channelId] || 0) + 1;
        if (men) state.mentions[m.channelId] = (state.mentions[m.channelId] || 0) + 1;
        notifyMessage(m, men);
        renderChannels(); updateTitle();
      }
    });
    socket.on('chat:update', m => {
      const list = state.messages[m.channelId];
      if (!list) return;
      const i = list.findIndex(x => x.id === m.id);
      if (i >= 0) list[i] = m;
      if (m.channelId === state.activeText) renderMessages(true);
    });
    socket.on('chat:delete', ({ channelId, id }) => {
      const list = state.messages[channelId];
      if (list) state.messages[channelId] = list.filter(x => x.id !== id);
      if (channelId === state.activeText) renderMessages(true);
    });
    socket.on('chat:cleared', ({ channelId, by }) => {
      state.messages[channelId] = [];
      if (channelId === state.activeText) { renderMessages(); toast(`${by} limpou o chat.`); }
    });
    socket.on('chat:typing', ({ channelId, nick: n }) => {
      (state.typing[channelId] = state.typing[channelId] || {})[n] = Date.now() + 4000;
      renderTyping();
    });
    socket.on('ai:answer', ({ answer, source }) => {
      $('.ai-msg.pending')?.remove();
      aiSay('bot', answer);
      if (source === 'gemini') $('#ai-badge').classList.add('on');
    });
    socket.on('bans:list', renderBans);
    socket.on('disconnect', () => {
      closeAllPeers(); stopShare(false);
      state.voice = null; state.users = [];
      if (state.joined) toast('Conexão perdida. Tentando reconectar...', 'error');
      renderAll();
    });
  }
  const emit = (ev, data) => state.socket?.connected && state.socket.emit(ev, data);
  function sendProfile() { emit('profile:set', { color: settings.profileColor, status: settings.status, customStatus: settings.customStatus }); }

  /* ------------------------------ render geral ------------------------------ */
  function renderAll() {
    $$('.admin-only').forEach(el => el.classList.toggle('hidden', !isAdmin()));
    renderChannels(); renderMembers(); renderUserPanel(); renderVoicePanel(); renderTopbar();
    applySpeaking();
    $('#message-gate')?.remove();
  }
  function renderTopbar() {
    const ch = chById(state.activeText);
    $('#tb-name').textContent = ch?.name || '—';
    $('#tb-topic').textContent = ch?.topic || '';
    $('#chat-input').placeholder = ch ? `Enviar mensagem em #${ch.name}` : 'Enviar mensagem...';
  }
  function renderChannels() {
    const gear = c => (isAdmin() ? h('button', { class: 'icon-btn gear', title: 'Editar canal', onclick: e => { e.stopPropagation(); openChannelModal(c); } }, '⚙') : null);
    $('#list-text').replaceChildren(...state.channels.filter(c => c.type === 'text').map(c => {
      const un = state.unread[c.id] || 0, men = state.mentions[c.id] || 0;
      return h('div', { class: 'ch' + (state.activeText === c.id ? ' active' : '') + (un ? ' unread' : ''), onclick: () => openText(c.id) },
        h('span', { class: 'ch-ico' }, '#'), h('span', { class: 'ch-name' }, c.name),
        men ? h('span', { class: 'badge' }, men) : null, gear(c));
    }));
    $('#list-voice').replaceChildren(...state.channels.filter(c => c.type === 'voice').map(c => {
      const members = state.users.filter(u => u.voice === c.id);
      return h('div', {},
        h('div', { class: 'ch' + (state.voice === c.id ? ' active' : ''), onclick: () => joinVoice(c.id) },
          h('span', { class: 'ch-ico' }, '🔊'), h('span', { class: 'ch-name' }, c.name),
          members.length || c.limit ? h('span', { class: 'count' }, c.limit ? `${members.length}/${c.limit}` : members.length) : null, gear(c)),
        members.length ? h('div', { class: 'vmembers' }, members.map(u =>
          h('div', { class: 'vmember', onclick: e => openUserMenu(e, u.id) },
            avatar(u, 'sm'), h('span', { class: 'nm' }, u.nick + (u.id === state.meId ? ' (você)' : '')),
            h('span', { class: 'vicons' }, u.sharing ? h('span', { class: 'live-dot' }, 'LIVE') : null,
              u.serverMuted ? '🔇' : u.muted ? '🎙️' : null, u.deafened ? '🎧' : null)))) : null);
    }));
  }
  function renderMembers() {
    const groups = [['DONO', u => u.role === 'owner'], ['ADMINS', u => u.role === 'admin'], ['MEMBROS', u => u.role === 'member']];
    const out = [];
    groups.forEach(([title, f]) => {
      const list = state.users.filter(f);
      if (!list.length) return;
      out.push(h('div', { class: 'mem-title' }, `${title} — ${list.length}`));
      list.forEach(u => out.push(h('div', { class: 'mem', onclick: e => openUserMenu(e, u.id) },
        avatar(u, '', true),
        h('div', { class: 'mem-info' }, h('div', { class: 'mem-name', style: `color:${safeColor(u.color)}` }, u.nick),
          h('div', { class: 'mem-sub' }, u.customStatus || (u.voice ? '🔊 ' + (chById(u.voice)?.name || 'voz') : statusLabel(u.status)))))));
    });
    $('#members-list').replaceChildren(...out);
  }
  const statusLabel = s => ({ online: 'Online', idle: 'Ausente', dnd: 'Não perturbe' }[s] || 'Online');
  function renderUserPanel() {
    const m = me() || { nick: '…', color: settings.profileColor, status: settings.status };
    $('#up-avatar').replaceChildren(avatar(m, '', true));
    $('#up-info').replaceChildren(h('div', { class: 'up-name' }, m.nick), h('div', { class: 'up-sub' }, m.customStatus || statusLabel(m.status)));
    const mic = $('#btn-mic'), deaf = $('#btn-deaf');
    const micOff = state.muted || state.deafened || state.serverMuted;
    mic.classList.toggle('off', micOff); mic.textContent = micOff ? '🔇' : '🎤';
    deaf.classList.toggle('off', state.deafened);
  }
  function renderVoicePanel() {
    const panel = $('#voice-panel');
    panel.classList.toggle('hidden', !state.voice);
    if (!state.voice) return;
    $('#vp-channel').textContent = chById(state.voice)?.name || '';
    $('#btn-screen').classList.toggle('on', !!state.screenStream);
    $('#btn-screen').title = state.screenStream ? 'Parar transmissão' : 'Compartilhar tela';
  }

  /* ------------------------------ chat ------------------------------ */
  function openText(id) {
    if (!id) return;
    state.activeText = id;
    state.unread[id] = 0; state.mentions[id] = 0;
    state.replyTo = null; state.editing = null; renderReplyBar();
    emit('text:open', { channelId: id });
    renderMessages(); renderChannels(); renderTopbar(); renderTyping(); updateTitle();
    closeDrawers();
  }
  function mentionsMe(m) {
    const nick = me()?.nick?.toLowerCase();
    if (!nick || m.author.nick.toLowerCase() === nick) return false;
    const t = m.content.toLowerCase();
    return t.includes('@everyone') || t.includes('@' + nick);
  }
  const MD_RE = /(```[\s\S]+?```)|(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|(\*[^*\n]+\*)|(https?:\/\/[^\s<>"]+)|(@[^\s@]{1,32})/g;
  function renderText(text) {
    const frag = document.createDocumentFragment();
    let last = 0, m;
    MD_RE.lastIndex = 0;
    while ((m = MD_RE.exec(text))) {
      if (m.index > last) frag.append(text.slice(last, m.index));
      const [all, c3, c1, b, s, i, u, at] = m;
      if (c3) frag.append(h('pre', { class: 'code-block' }, h('code', {}, c3.slice(3, -3).replace(/^\n/, ''))));
      else if (c1) frag.append(h('code', { class: 'code-inline' }, c1.slice(1, -1)));
      else if (b) frag.append(h('strong', {}, b.slice(2, -2)));
      else if (s) frag.append(h('s', {}, s.slice(2, -2)));
      else if (i) frag.append(h('em', {}, i.slice(1, -1)));
      else if (u) {
        const clean = u.replace(/[).,;!?]+$/, '');
        frag.append(h('a', { href: clean, target: '_blank', rel: 'noopener noreferrer' }, clean), u.slice(clean.length));
      } else if (at) {
        const name = at.slice(1).toLowerCase();
        if (name === 'everyone' || state.users.some(x => x.nick.toLowerCase() === name)) frag.append(h('span', { class: 'mention-chip' }, at));
        else frag.append(at);
      }
      last = m.index + all.length;
    }
    if (last < text.length) frag.append(text.slice(last));
    return frag;
  }
  function buildMessage(m, prev) {
    const grouped = prev && prev.author.nick === m.author.nick && m.ts - prev.ts < 5 * 60e3 && !m.replyTo;
    const author = state.users.find(u => u.nick === m.author.nick);
    const mine = m.author.nick === me()?.nick;
    const el = h('div', { class: 'msg' + (grouped ? ' grouped' : '') + (mentionsMe(m) ? ' mention' : ''), dataset: { id: m.id } });
    el.append(grouped
      ? h('div', { class: 'msg-side' }, new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
      : avatar({ nick: m.author.nick, color: m.author.color, id: author?.id }));
    const body = h('div', { class: 'msg-body' });
    if (m.replyTo) body.append(h('div', { class: 'reply-ref' }, '↩ ', h('b', {}, m.replyTo.nick), ' ' + m.replyTo.snippet));
    if (!grouped) body.append(h('div', { class: 'msg-head' },
      h('span', { class: 'msg-nick', style: `color:${safeColor(m.author.color)}` }, m.author.nick), roleTag(author?.role),
      h('span', { class: 'msg-time' }, fmtTime(m.ts))));
    if (state.editing === m.id) {
      const ta = h('textarea', { class: 'edit-box', rows: 2, maxLength: 2000 }, m.content);
      ta.value = m.content;
      ta.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          const v = ta.value.trim();
          if (v && v !== m.content) emit('chat:edit', { channelId: m.channelId, id: m.id, content: v });
          state.editing = null; renderMessages(true);
        } else if (e.key === 'Escape') { state.editing = null; renderMessages(true); }
      });
      body.append(ta, h('div', { class: 'msg-edited' }, 'Enter para salvar • Esc para cancelar'));
      setTimeout(() => ta.focus(), 0);
    } else {
      const txt = h('div', { class: 'msg-text' }, renderText(m.content));
      if (m.edited) txt.append(' ', h('span', { class: 'msg-edited' }, '(editada)'));
      body.append(txt);
    }
    const emojis = Object.entries(m.reactions || {});
    if (emojis.length) body.append(h('div', { class: 'reactions' }, emojis.map(([e, nicks]) =>
      h('button', { type: 'button', class: 'react-chip' + (nicks.includes(me()?.nick) ? ' me' : ''), title: nicks.join(', '),
        onclick: () => emit('chat:react', { channelId: m.channelId, id: m.id, emoji: e }) }, `${e} ${nicks.length}`))));
    el.append(body);
    el.append(h('div', { class: 'msg-actions' },
      h('button', { type: 'button', class: 'act-btn', title: 'Reagir', onclick: ev => openEmoji(ev.currentTarget, e => emit('chat:react', { channelId: m.channelId, id: m.id, emoji: e })) }, '😊'),
      h('button', { type: 'button', class: 'act-btn', title: 'Responder', onclick: () => { state.replyTo = { id: m.id, nick: m.author.nick, snippet: m.content.slice(0, 80) }; renderReplyBar(); $('#chat-input').focus(); } }, '↩'),
      mine ? h('button', { type: 'button', class: 'act-btn', title: 'Editar', onclick: () => { state.editing = m.id; renderMessages(true); } }, '✏️') : null,
      mine || isAdmin() ? h('button', { type: 'button', class: 'act-btn', title: 'Apagar', onclick: () => { if (confirm('Apagar esta mensagem?')) emit('chat:delete', { channelId: m.channelId, id: m.id }); } }, '🗑️') : null));
    return el;
  }
  function atBottom() { const b = $('#messages'); return b.scrollHeight - b.scrollTop - b.clientHeight < 80; }
  function renderMessages(keepScroll) {
    const box = $('#messages');
    const prevTop = box.scrollTop;
    const list = state.messages[state.activeText] || [];
    box.replaceChildren();
    if (!list.length) box.append(h('div', { class: 'empty-chat' }, `Bem-vindo ao #${chById(state.activeText)?.name || ''}! Seja o primeiro a mandar uma mensagem. ✨`));
    let prev = null;
    list.forEach(m => { box.append(buildMessage(m, prev)); prev = m; });
    box.scrollTop = keepScroll ? prevTop : box.scrollHeight;
  }
  function appendMessage(m) {
    const box = $('#messages');
    const stick = atBottom();
    $('.empty-chat', box)?.remove();
    const list = state.messages[m.channelId] || [];
    box.append(buildMessage(m, list[list.length - 2]));
    if (stick || m.author.nick === me()?.nick) box.scrollTop = box.scrollHeight;
    if (m.author.nick !== me()?.nick) (mentionsMe(m) ? SOUNDS.mention : SOUNDS.msg)();
  }
  function renderTyping() {
    const now = Date.now();
    const t = state.typing[state.activeText] || {};
    const names = Object.entries(t).filter(([, exp]) => exp > now).map(([n]) => n);
    $('#typing').textContent = names.length ? (names.length === 1 ? `${names[0]} está digitando...` : `${names.slice(0, 3).join(', ')} estão digitando...`) : '';
  }
  setInterval(renderTyping, 1000);
  function renderReplyBar() {
    const bar = $('#reply-bar');
    bar.classList.toggle('hidden', !state.replyTo);
    if (!state.replyTo) return;
    bar.replaceChildren(h('span', {}, 'Respondendo a ', h('b', {}, state.replyTo.nick)),
      h('button', { type: 'button', class: 'icon-btn', onclick: () => { state.replyTo = null; renderReplyBar(); } }, '✖'));
  }
  function updateTitle() {
    const total = Object.values(state.mentions).reduce((a, b) => a + b, 0);
    document.title = (total ? `(${total}) ` : '') + 'Jogatina Dos Amigos - By C0kz';
  }
  function notifyMessage(m, mention) {
    if (!settings.desktopNotif || !document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
    if (settings.mentionsOnly && !mention) return;
    try { new Notification(`${m.author.nick} em #${chById(m.channelId)?.name || ''}`, { body: m.content.slice(0, 120), tag: m.channelId }); } catch (_) {}
  }
  function sendChat() {
    const input = $('#chat-input');
    let text = input.value.trim();
    if (!text || !state.activeText) return;
    if (text === '/help') { toast('Comandos: /me ação • /shrug • /ia pergunta • /clear (admin)'); input.value = ''; return; }
    if (text === '/clear') { if (isAdmin() && confirm('Limpar todas as mensagens deste canal?')) emit('chat:clear', { channelId: state.activeText }); input.value = ''; return; }
    if (text.startsWith('/ia ')) { openAI(); askAI(text.slice(4)); input.value = ''; return; }
    if (text.startsWith('/me ')) text = `*${text.slice(4)}*`;
    if (text === '/shrug' || text.startsWith('/shrug ')) text = text.replace('/shrug', '').trim() + ' ¯\\_(ツ)_/¯';
    emit('chat:send', { channelId: state.activeText, content: text, replyTo: state.replyTo?.id });
    input.value = ''; input.style.height = 'auto';
    state.replyTo = null; renderReplyBar();
  }

  /* emoji */
  const EMOJIS = '😀 😂 🤣 😊 😍 😎 🤩 🥳 😭 😡 🤔 🙄 😴 🤯 😱 🥶 👍 👎 👏 🙌 🙏 💪 👀 🔥 ✨ 💯 ❤️ 💜 💙 💀 🎮 🕹️ 🏆 🎧 🎤 📺 🍕 🍻 ⚡ 🚀 🤖 👑 🎉 😈 🤝 ✅ ❌ ⭐'.split(' ');
  function openEmoji(anchor, cb) {
    const pop = $('#emoji-pop');
    pop.replaceChildren(...EMOJIS.map(e => h('button', { type: 'button', onclick: () => { cb(e); pop.classList.add('hidden'); } }, e)));
    pop.classList.remove('hidden');
    const r = anchor.getBoundingClientRect();
    pop.style.left = clamp(r.left, 8, window.innerWidth - pop.offsetWidth - 8) + 'px';
    pop.style.top = clamp(r.top - pop.offsetHeight - 8, 8, window.innerHeight - pop.offsetHeight - 8) + 'px';
  }

  /* ------------------------------ menu de usuário ------------------------------ */
  function closeMenu() { $('#ctx-menu').classList.add('hidden'); }
  function openUserMenu(ev, userId) {
    ev.stopPropagation();
    const u = userById(userId);
    if (!u) return;
    const menu = $('#ctx-menu');
    const self = u.id === state.meId;
    const items = [h('div', { class: 'menu-head' }, avatar(u, '', true),
      h('div', {}, h('div', { class: 'mem-name', style: `color:${safeColor(u.color)}` }, u.nick), roleTag(u.role), h('div', { class: 'mem-sub' }, u.customStatus || statusLabel(u.status))))];
    if (!self) {
      const val = state.userVol[u.id] ?? 100;
      const out = h('span', {}, val + '%');
      const rng = h('input', { type: 'range', min: 0, max: 200, value: val });
      rng.addEventListener('input', () => { state.userVol[u.id] = Number(rng.value); out.textContent = rng.value + '%'; applyAllRemoteGains(); });
      items.push(h('div', { class: 'menu-label' }, 'VOLUME DO USUÁRIO'), h('div', { class: 'menu-range' }, rng, out),
        h('button', { class: 'menu-item', onclick: () => { state.userMuted[u.id] = !state.userMuted[u.id]; applyAllRemoteGains(); closeMenu(); } },
          state.userMuted[u.id] ? '🔊 Reativar para mim' : '🔇 Silenciar para mim'));
    }
    const can = !self && u.role !== 'owner' && (isOwner() || (isAdmin() && u.role === 'member'));
    if (can) {
      items.push(h('div', { class: 'menu-sep' }), h('div', { class: 'menu-label' }, 'MODERAÇÃO'));
      if (isOwner()) items.push(h('button', { class: 'menu-item', onclick: () => { emit(u.role === 'admin' ? 'mod:demote' : 'mod:promote', { targetId: u.id }); closeMenu(); } },
        u.role === 'admin' ? '👑 Remover admin' : '👑 Tornar admin'));
      if (u.voice) {
        items.push(h('button', { class: 'menu-item', onclick: () => { emit('mod:servermute', { targetId: u.id, value: !u.serverMuted }); closeMenu(); } },
          u.serverMuted ? '🎙️ Remover silêncio do servidor' : '🔇 Silenciar no servidor'),
          h('div', { class: 'menu-label' }, 'MOVER PARA CANAL'),
          h('div', { class: 'menu-scroll' }, state.channels.filter(c => c.type === 'voice' && c.id !== u.voice).map(c =>
            h('button', { class: 'menu-item', onclick: () => { emit('mod:move', { targetId: u.id, channelId: c.id }); closeMenu(); } }, '📁 ' + c.name))),
          h('button', { class: 'menu-item warn', onclick: () => { emit('mod:voicekick', { targetId: u.id }); closeMenu(); } }, '📞 Desconectar da voz'));
      }
      items.push(h('div', { class: 'menu-sep' }),
        h('button', { class: 'menu-item warn', onclick: () => { if (confirm(`Expulsar ${u.nick}?`)) emit('mod:kick', { targetId: u.id }); closeMenu(); } }, '⚡ Expulsar'));
      if (isOwner()) items.push(h('button', { class: 'menu-item danger', onclick: () => { if (confirm(`Banir ${u.nick}? O banimento vale para o nick e o IP.`)) emit('mod:ban', { targetId: u.id }); closeMenu(); } }, '🚫 Banir'));
    }
    if (!self) items.push(h('div', { class: 'menu-sep' }), h('button', { class: 'menu-item', onclick: () => { const i = $('#chat-input'); i.value += `@${u.nick} `; i.focus(); closeMenu(); } }, '@ Mencionar'));
    menu.replaceChildren(...items);
    menu.classList.remove('hidden');
    const x = clamp(ev.clientX, 8, window.innerWidth - menu.offsetWidth - 8);
    const y = clamp(ev.clientY, 8, window.innerHeight - menu.offsetHeight - 8);
    menu.style.left = x + 'px'; menu.style.top = y + 'px';
  }

  /* ------------------------------ modais ------------------------------ */
  function closeOverlays() {
    $('#overlay-root').replaceChildren();
    settingsOpen = false; voiceTabOpen = false;
    if (!state.voice) stopMicSource();
  }
  function modal(title, body, footer, extraClass) {
    const ov = h('div', { class: 'overlay', onclick: e => { if (e.target === ov) closeOverlays(); } },
      h('div', { class: 'modal ' + (extraClass || '') },
        h('div', { class: 'modal-head' }, h('h3', { class: 'cyber' }, title), h('button', { class: 'icon-btn', onclick: closeOverlays }, '✖')),
        body, footer || null));
    $('#overlay-root').replaceChildren(ov);
    return ov;
  }
  function openChannelModal(ch, type) {
    const isNew = !ch;
    const t = ch?.type || type;
    const name = h('input', { type: 'text', maxLength: 32, value: ch?.name || '', placeholder: t === 'text' ? 'ex: clipes' : 'ex: Sala da Resenha' });
    const topic = h('input', { type: 'text', maxLength: 120, value: ch?.topic || '', placeholder: 'Descrição do canal' });
    const limit = h('input', { type: 'number', min: 0, max: 99, value: ch?.limit || 0 });
    const body = h('div', { class: 'modal-body' },
      h('div', { class: 'field' }, h('label', {}, 'NOME DO CANAL'), name),
      t === 'text' ? h('div', { class: 'field' }, h('label', {}, 'TÓPICO'), topic) : h('div', { class: 'field' }, h('label', {}, 'LIMITE DE USUÁRIOS (0 = SEM LIMITE)'), limit));
    const foot = h('div', { class: 'modal-foot' },
      !isNew ? h('button', { class: 'btn danger cyber', onclick: () => { if (confirm(`Excluir o canal "${ch.name}"?`)) { emit('channel:delete', { id: ch.id }); closeOverlays(); } } }, 'Excluir') : null,
      h('button', { class: 'btn ghost cyber', onclick: closeOverlays }, 'Cancelar'),
      h('button', { class: 'btn primary cyber', onclick: () => {
        if (!name.value.trim()) return toast('Informe um nome.', 'error');
        const data = { name: name.value, topic: topic.value, limit: Number(limit.value) || 0 };
        if (isNew) emit('channel:create', { ...data, type: t }); else emit('channel:update', { id: ch.id, ...data });
        closeOverlays();
      } }, isNew ? 'Criar' : 'Salvar'));
    modal(isNew ? (t === 'text' ? 'NOVO CANAL DE TEXTO' : 'NOVO CANAL DE VOZ') : 'EDITAR CANAL', body, foot);
    name.focus();
  }

  /* ------------------------------ configurações ------------------------------ */
  function row(label, desc, control, col) {
    return h('div', { class: 'set-row' + (col ? ' col' : '') }, h('div', { class: 'set-info' }, h('div', { class: 'set-label' }, label), desc ? h('div', { class: 'set-desc' }, desc) : null), control);
  }
  function toggle(key, onChange) {
    const i = h('input', { type: 'checkbox', checked: !!settings[key] });
    i.addEventListener('change', () => { settings[key] = i.checked; saveSettings(); onChange?.(i.checked); });
    return h('label', { class: 'switch' }, i, h('span', { class: 'slider' }));
  }
  function slider(key, min, max, step, fmt, onChange) {
    const out = h('span', { class: 'range-out' }, fmt(settings[key]));
    const i = h('input', { type: 'range', min, max, step, value: settings[key] });
    i.addEventListener('input', () => { settings[key] = Number(i.value); out.textContent = fmt(i.value); saveSettings(); onChange?.(Number(i.value)); });
    return h('div', { class: 'range-wrap' }, i, out);
  }
  function select(key, options, onChange) {
    const s = h('select', {}, options.map(([v, l]) => h('option', { value: v, selected: String(settings[key]) === String(v) }, l)));
    s.addEventListener('change', () => { settings[key] = isNaN(Number(s.value)) || s.value === '' ? s.value : (typeof DEFAULTS[key] === 'number' ? Number(s.value) : s.value); saveSettings(); onChange?.(settings[key]); });
    return s;
  }
  function seg(key, options, onChange) {
    const wrap = h('div', { class: 'seg' });
    options.forEach(([v, l]) => {
      const b = h('button', { type: 'button', class: settings[key] === v ? 'active' : '', onclick: () => { settings[key] = v; saveSettings(); $$('button', wrap).forEach(x => x.classList.remove('active')); b.classList.add('active'); onChange?.(v); } }, l);
      wrap.append(b);
    });
    return wrap;
  }
  const keyLabel = s => String(s || '—').split('+').map(p => p.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow/, '↔').replace('Backquote', '`').replace('Left', '').replace('Right', '')).join(' + ');
  function keyString(e) {
    const c = e.code || '';
    const mods = [];
    if (e.ctrlKey && !c.startsWith('Control')) mods.push('Ctrl');
    if (e.altKey && !c.startsWith('Alt')) mods.push('Alt');
    if (e.shiftKey && !c.startsWith('Shift')) mods.push('Shift');
    return [...mods, c].join('+');
  }
  function keybind(key) {
    const b = h('button', { type: 'button', class: 'kbd' }, keyLabel(settings[key]));
    b.addEventListener('click', () => {
      b.classList.add('rec'); b.textContent = 'Pressione uma tecla...';
      const handler = e => {
        e.preventDefault(); e.stopPropagation();
        if (e.key === 'Escape') { /* cancela */ }
        else if (e.key === 'Backspace') settings[key] = '';
        else settings[key] = keyString(e);
        saveSettings();
        window.removeEventListener('keydown', handler, true);
        b.classList.remove('rec'); b.textContent = keyLabel(settings[key]);
      };
      window.addEventListener('keydown', handler, true);
    });
    return b;
  }

  async function fillDevices(inSel, outSel) {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      const fill = (sel, kind, key) => {
        const list = devs.filter(d => d.kind === kind);
        sel.replaceChildren(h('option', { value: 'default' }, 'Padrão do sistema'),
          ...list.filter(d => d.deviceId !== 'default').map((d, i) => h('option', { value: d.deviceId, selected: settings[key] === d.deviceId }, d.label || `${kind === 'audioinput' ? 'Microfone' : 'Saída'} ${i + 1}`)));
        if (settings[key] === 'default') sel.value = 'default';
      };
      fill(inSel, 'audioinput', 'inputDevice'); fill(outSel, 'audiooutput', 'outputDevice');
    } catch (_) {}
  }

  function openSettings(tab) {
    settingsOpen = true;
    const tabs = [['account', '👤 Minha Conta'], ['voice', '🎙️ Voz e Áudio'], ['stream', '📺 Transmissão'], ['notif', '🔔 Notificações'], ['look', '🎨 Aparência'], ['keys', '⌨️ Atalhos']];
    if (isAdmin()) tabs.push(['server', '🛡️ Servidor']);
    const pane = h('div', { class: 'set-pane' });
    const nav = h('div', { class: 'set-nav' });
    const show = id => {
      voiceTabOpen = id === 'voice';
      $$('.set-tab', nav).forEach(b => b.classList.toggle('active', b.dataset.tab === id));
      pane.replaceChildren(...PANES[id]());
      pane.scrollTop = 0;
    };
    tabs.forEach(([id, label]) => nav.append(h('button', { class: 'set-tab', dataset: { tab: id }, onclick: () => show(id) }, label)));

    const PANES = {
      account: () => {
        const sw = h('div', { class: 'swatches' });
        const cur = () => safeColor(me()?.color || settings.profileColor);
        const mk = () => {
          sw.replaceChildren(...AVATAR_COLORS.map(c => h('button', { type: 'button', class: 'swatch' + (cur() === c ? ' active' : ''), style: `--c:${c}`, onclick: () => { settings.profileColor = c; saveSettings(); sendProfile(); setTimeout(mk, 150); } })),
            h('input', { type: 'color', value: cur(), onchange: e => { settings.profileColor = e.target.value; saveSettings(); sendProfile(); } }));
        };
        mk();
        const cs = h('input', { type: 'text', maxLength: 60, value: settings.customStatus, placeholder: 'Ex: jogando CS2 🔥' });
        cs.addEventListener('change', () => { settings.customStatus = cs.value; saveSettings(); sendProfile(); });
        return [h('h4', {}, 'MINHA CONTA'),
          row('Nick', 'O nick é definido ao entrar. Para trocar, desconecte e entre de novo.', h('b', {}, me()?.nick || '')),
          row('Cor do avatar', null, sw),
          row('Status', 'Aparece para todos na lista de membros.', select('status', [['online', '🟢 Online'], ['idle', '🟡 Ausente'], ['dnd', '🔴 Não perturbe']], () => { state.autoIdled = false; sendProfile(); })),
          row('Status personalizado', null, cs),
          row('Ausente automático', 'Muda para Ausente após 5 minutos sem atividade.', toggle('autoIdle')),
          row('Desconectar', 'Sai do servidor e volta para a tela de login.', h('button', { class: 'btn danger cyber', onclick: logout }, 'Sair'))];
      },
      voice: () => {
        const inSel = h('select', {}), outSel = h('select', {});
        inSel.addEventListener('change', async () => { settings.inputDevice = inSel.value; saveSettings(); await tryStartMic(); });
        outSel.addEventListener('change', () => { settings.outputDevice = outSel.value; saveSettings(); applyOutputDevice(); });
        (async () => { await ensureCtx(); if (!audio.raw) await tryStartMic(); fillDevices(inSel, outSel); })();
        const restart = () => { if (audio.raw || settingsOpen) tryStartMic(); };
        const monitor = h('button', { type: 'button', class: 'btn ghost cyber', onclick: e => { monitorOn = !monitorOn; audio.monitor.gain.value = monitorOn ? 1 : 0; e.currentTarget.textContent = monitorOn ? '⏹ Parar teste' : '▶ Ouvir meu microfone'; } }, monitorOn ? '⏹ Parar teste' : '▶ Ouvir meu microfone');
        const sensWrap = h('div', {}, h('div', { class: 'meter' }, h('div', { id: 'meter-fill', class: 'meter-fill' }), h('div', { id: 'meter-thr', class: 'meter-thr', style: `left:${settings.sensitivity}%` })),
          slider('sensitivity', 0, 100, 1, v => v + '%'));
        sensWrap.lastChild.style.cssText = 'width:100%;max-width:100%;margin-top:.5rem';
        return [h('h4', {}, 'VOZ E ÁUDIO'),
          row('Dispositivo de entrada', null, inSel), row('Dispositivo de saída', 'Troca de saída funciona em navegadores baseados em Chromium.', outSel),
          row('Volume do microfone', null, slider('inputVolume', 0, 200, 1, v => v + '%', v => { if (audio.inGain) audio.inGain.gain.value = v / 100; })),
          row('Volume geral de saída', null, slider('outputVolume', 0, 200, 1, v => v + '%', v => { if (audio.master) audio.master.gain.value = v / 100; })),
          row('Supressão de ruído', null, toggle('noiseSuppression', restart)),
          row('Cancelamento de eco', null, toggle('echoCancellation', restart)),
          row('Ganho automático', null, toggle('autoGain', restart)),
          row('Modo de entrada', 'Fale livremente, só acima da sensibilidade, ou segure uma tecla (push-to-talk).', seg('inputMode', [['open', 'Sempre aberto'], ['vad', 'Detecção de voz'], ['ptt', 'Push-to-talk']])),
          row('Sensibilidade do microfone', 'No modo "Detecção de voz": a barra branca é o limite.', sensWrap, true),
          row('Testar microfone', 'Use fones para evitar eco.', monitor)];
      },
      stream: () => [h('h4', {}, 'TRANSMISSÃO DE TELA'),
        row('Resolução', null, select('shareRes', [['720', '720p'], ['1080', '1080p'], ['source', 'Original da tela']])),
        row('Taxa de quadros', null, select('shareFps', [[15, '15 fps'], [30, '30 fps'], [60, '60 fps']])),
        row('Taxa de bits máxima', 'Maior = mais nítido, exige mais internet.', select('shareBitrate', [[1500, '1,5 Mbps'], [2500, '2,5 Mbps'], [4000, '4 Mbps'], [8000, '8 Mbps']])),
        row('Otimizar para', 'Movimento (jogos) ou detalhe (texto/apresentações).', seg('shareHint', [['motion', 'Movimento'], ['detail', 'Detalhe']])),
        row('Transmitir áudio da tela', 'Pode ser alterado a cada transmissão.', toggle('shareAudio')),
        h('div', { class: 'set-desc', style: 'margin-top:1rem' }, 'As mudanças valem na próxima transmissão.')],
      notif: () => [h('h4', {}, 'NOTIFICAÇÕES'),
        row('Sons', 'Entrada/saída de voz, mensagens e menções.', toggle('sounds')),
        row('Sons de voz (entrar/sair)', null, toggle('voiceSounds')),
        row('Volume dos sons', null, slider('soundVolume', 0, 100, 1, v => v + '%', () => beep([[660, .08]]))),
        row('Notificações da área de trabalho', 'Avisos quando a aba está em segundo plano.', toggle('desktopNotif', async on => {
          if (on && 'Notification' in window && Notification.permission !== 'granted') {
            const p = await Notification.requestPermission();
            if (p !== 'granted') { settings.desktopNotif = false; saveSettings(); toast('Permissão de notificação negada.', 'error'); show('notif'); }
          }
        })),
        row('Somente menções', 'Notificar da área de trabalho apenas quando mencionarem você.', toggle('mentionsOnly'))],
      look: () => [h('h4', {}, 'APARÊNCIA'),
        h('div', { class: 'theme-grid' }, Object.entries(THEMES).map(([id, t]) =>
          h('button', { type: 'button', class: 'theme-card' + (settings.theme === id ? ' active' : ''), onclick: () => { settings.theme = id; saveSettings(); applyTheme(); show('look'); } },
            h('div', { class: 'theme-bar', style: `background:linear-gradient(90deg,${t.c.join(',')})` }), t.name))),
        row('Modo compacto', 'Mensagens mais juntas.', toggle('compact', applyTheme)),
        row('Tamanho da fonte', null, slider('fontScale', 80, 140, 5, v => v + '%', applyTheme)),
        row('Reduzir animações', null, toggle('reduceMotion', applyTheme))],
      keys: () => [h('h4', {}, 'ATALHOS'),
        row('Push-to-talk', 'Segure para falar (modo Push-to-talk). Backspace limpa.', keybind('pttKey')),
        row('Mutar / Desmutar microfone', null, keybind('muteKey')),
        row('Ensurdecer / Reativar áudio', null, keybind('deafenKey')),
        h('div', { class: 'set-desc', style: 'margin-top:1rem' }, 'Navegadores só detectam atalhos com a aba em foco. Para teclas globais use um aplicativo desktop.')],
      server: () => {
        const list = h('div', {}, state.channels.map(c => h('div', { class: 'ban-row' }, h('span', {}, (c.type === 'text' ? '# ' : '🔊 ') + c.name),
          h('button', { class: 'btn ghost cyber', onclick: () => openChannelModal(c) }, 'Editar'))));
        const bans = h('div', { id: 'bans-box' });
        if (isOwner()) emit('bans:list');
        return [h('h4', {}, 'SERVIDOR'),
          h('div', { class: 'set-row' }, h('div', { class: 'set-label' }, 'Canais'), h('div', {}, h('button', { class: 'btn primary cyber', onclick: () => openChannelModal(null, 'text') }, '＋ Texto'), ' ', h('button', { class: 'btn primary cyber', onclick: () => openChannelModal(null, 'voice') }, '＋ Voz'))), list,
          row('Limpar chat', 'Apaga todas as mensagens do canal de texto aberto.', h('button', { class: 'btn danger cyber', onclick: () => { if (confirm('Limpar o chat atual?')) emit('chat:clear', { channelId: state.activeText }); } }, 'Limpar')),
          isOwner() ? h('h4', { style: 'margin-top:1.4rem' }, 'USUÁRIOS BANIDOS') : null, isOwner() ? bans : null];
      }
    };
    const foot = h('div', { class: 'modal-foot' }, h('button', { class: 'btn primary cyber', onclick: closeOverlays }, 'Fechar'));
    modal('CONFIGURAÇÕES', h('div', { class: 'settings-body' }, nav, pane), foot, 'settings');
    show(tab || 'account');
  }
  function renderBans(list) {
    const box = $('#bans-box');
    if (!box) return;
    box.replaceChildren(...(list.length ? list.map(b => h('div', { class: 'ban-row' }, h('span', {}, `${b.nick} `, h('span', { class: 'muted' }, `· ${fmtTime(b.ts)}`)),
      h('button', { class: 'btn ghost cyber', onclick: () => emit('mod:unban', { nick: b.nick }) }, 'Desbanir'))) : [h('div', { class: 'set-desc' }, 'Nenhum usuário banido.')]));
  }

  /* ------------------------------ assistente ------------------------------ */
  function aiSay(who, text, pending) {
    const box = $('#ai-box');
    box.append(h('div', { class: 'ai-msg ' + who + (pending ? ' pending' : '') }, text));
    box.scrollTop = box.scrollHeight;
  }
  function openAI() { $('#ai-panel').classList.remove('hidden'); $('#ai-input').focus(); }
  function askAI(q) {
    q = String(q || '').trim();
    if (!q) return;
    aiSay('me', q); aiSay('bot', '...', true);
    emit('ai:ask', { prompt: q });
  }

  /* ------------------------------ arcade ------------------------------ */
  const GAMES = {
    mario: ['🍄 Super Mario', 'https://snesfun.com/play/super-mario-world/183'],
    metalslug: ['🔫 Metal Slug X', 'https://www.retrogames.cc/embed/9355-metal-slug-x-super-vehicle-001-iii.html'],
    kof2002: ['🥊 KOF 2002 (VS)', 'https://www.retrogames.cc/embed/20703-the-king-of-fighters-2002-challenge-to-the-ultimate-battle.html'],
    captain: ['🦾 Capt. Commando', 'https://snesfun.com/play/captain-commando/241'],
    cadillacs: ['🦖 Cadillacs & Dino', 'https://www.retrogames.cc/embed/9350-cadillacs-and-dinosaurs-world-930223.html']
  };
  function openArcade() {
    $('#arcade-modal').classList.remove('hidden');
    $('#arcade-games').replaceChildren(...Object.entries(GAMES).map(([id, [label]]) => h('button', { class: 'game-btn cyber', dataset: { game: id }, onclick: () => startGame(id) }, label)));
  }
  function closeArcade() {
    $('#arcade-modal').classList.add('hidden');
    $('#arcade-screen').replaceChildren(h('span', { class: 'cyber muted' }, '[ ESCOLHA UM JOGO ACIMA PARA INICIALIZAR ]'));
    $('#arcade-open').classList.add('hidden');
  }
  function startGame(id) {
    const g = GAMES[id];
    if (!g) return;
    $$('.game-btn').forEach(b => b.classList.toggle('active', b.dataset.game === id));
    const iframe = h('iframe', { src: g[1], allowFullscreen: true, allow: 'fullscreen; autoplay; gamepad', referrerPolicy: 'no-referrer' });
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-popups');
    $('#arcade-screen').replaceChildren(iframe);
    const a = $('#arcade-open'); a.href = g[1]; a.classList.remove('hidden');
  }

  /* ------------------------------ login / sessão ------------------------------ */
  function showLoginError(msg) {
    const e = $('#login-error');
    e.textContent = msg; e.classList.remove('hidden');
    $('#btn-login').disabled = false;
  }
  function deviceToken() {
    try {
      let t = localStorage.getItem('jogatina_token');
      if (!t || t.length < 16) {
        t = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)) + Math.random().toString(36).slice(2);
        localStorage.setItem('jogatina_token', t);
      }
      return t;
    } catch (_) { return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); }
  }
  async function login() {
    const nick = $('#input-nick').value.replace(/\s+/g, ' ').trim().slice(0, 32);
    if (!nick) return showLoginError('Informe seu nick!');
    $('#login-error').classList.add('hidden');
    $('#btn-login').disabled = true;
    if ($('#chk-save').checked) { try { localStorage.setItem('jogatina_nick', nick); } catch (_) {} }
    settings.profileColor = settings.profileColor || AVATAR_COLORS[0];
    saveSettings();
    await ensureCtx(); // criado dentro do gesto do usuário (política de autoplay)
    if (state.socket) { state.socket.removeAllListeners(); state.socket.disconnect(); }
    state.password = $('#input-pass').value;
    connect(nick, state.password, deviceToken(), settings.profileColor);
  }
  function logout() {
    stopShare(false); stopMicSource();
    state.socket?.disconnect();
    location.reload();
  }
  function buildLoginSwatches() {
    const wrap = $('#login-swatches');
    const mk = () => {
      wrap.replaceChildren(...AVATAR_COLORS.map(c => h('button', { type: 'button', class: 'swatch' + (settings.profileColor === c ? ' active' : ''), style: `--c:${c}`, onclick: () => { settings.profileColor = c; saveSettings(); mk(); } })),
        h('input', { type: 'color', value: safeColor(settings.profileColor || AVATAR_COLORS[0]), onchange: e => { settings.profileColor = e.target.value; saveSettings(); mk(); } }));
    };
    if (!settings.profileColor) settings.profileColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
    mk();
  }

  /* ------------------------------ drawers (mobile) ------------------------------ */
  function closeDrawers() { $('#sidebar').classList.remove('open'); $('#members').classList.remove('open'); $('#scrim').classList.add('hidden'); }

  /* ------------------------------ teclado / atividade ------------------------------ */
  function pttCode() { return String(settings.pttKey).split('+').pop(); }
  document.addEventListener('keydown', e => {
    activity();
    if (!state.joined || e.repeat) return;
    const ks = keyString(e);
    const tag = document.activeElement?.tagName;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tag || '');
    if (settings.muteKey && ks === settings.muteKey) { e.preventDefault(); toggleMute(); return; }
    if (settings.deafenKey && ks === settings.deafenKey) { e.preventDefault(); toggleDeafen(); return; }
    if (settings.pttKey && ks === settings.pttKey && (!typing || /\+/.test(ks))) audio.ptt = true;
    if (e.key === 'Escape') {
      if (!$('#emoji-pop').classList.contains('hidden')) $('#emoji-pop').classList.add('hidden');
      else if (!$('#ctx-menu').classList.contains('hidden')) closeMenu();
      else if (!$('#arcade-modal').classList.contains('hidden')) closeArcade();
      else if ($('#overlay-root').firstChild) closeOverlays();
      else if (state.replyTo) { state.replyTo = null; renderReplyBar(); }
    }
  });
  document.addEventListener('keyup', e => { if (e.code === pttCode()) audio.ptt = false; });
  window.addEventListener('blur', () => { audio.ptt = false; });
  document.addEventListener('click', e => {
    if (!e.target.closest('#ctx-menu') && !e.target.closest('.mem, .vmember')) closeMenu();
    if (!e.target.closest('#emoji-pop') && !e.target.closest('#btn-emoji') && !e.target.closest('.act-btn')) $('#emoji-pop').classList.add('hidden');
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { activity(); updateTitle(); } });
  function activity() {
    state.lastActivity = Date.now();
    if (state.autoIdled) { state.autoIdled = false; sendProfile(); }
  }
  ['mousemove', 'mousedown', 'touchstart'].forEach(ev => document.addEventListener(ev, activity, { passive: true }));
  setInterval(() => {
    if (!state.joined || !settings.autoIdle || settings.status !== 'online' || state.autoIdled) return;
    if (Date.now() - state.lastActivity > 5 * 60 * 1000) {
      state.autoIdled = true;
      emit('profile:set', { color: settings.profileColor, status: 'idle', customStatus: settings.customStatus });
    }
  }, 30000);

  /* ------------------------------ inicialização ------------------------------ */
  window.addEventListener('DOMContentLoaded', () => {
    applyTheme();
    try { $('#input-nick').value = localStorage.getItem('jogatina_nick') || ''; } catch (_) {}
    buildLoginSwatches();
    $('#login-form').addEventListener('submit', e => { e.preventDefault(); login(); });

    $('#btn-mic').addEventListener('click', toggleMute);
    $('#btn-deaf').addEventListener('click', toggleDeafen);
    $('#btn-settings').addEventListener('click', () => openSettings());
    $('#btn-screen').addEventListener('click', toggleScreenShare);
    $('#btn-leave-voice').addEventListener('click', leaveVoice);
    $('#btn-logout').addEventListener('click', () => { if (confirm('Desconectar do servidor?')) logout(); });
    $('#btn-invite').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(location.origin); toast('Convite copiado! 🔗'); }
      catch (_) { toast('Copie o endereço do navegador para convidar.', 'error'); }
    });
    $$('[data-add]').forEach(b => b.addEventListener('click', () => openChannelModal(null, b.dataset.add)));
    $('#btn-ai').addEventListener('click', () => $('#ai-panel').classList.toggle('hidden'));
    $('#ai-close').addEventListener('click', () => $('#ai-panel').classList.add('hidden'));
    $('#ai-form').addEventListener('submit', e => { e.preventDefault(); const i = $('#ai-input'); askAI(i.value); i.value = ''; });
    $('#btn-arcade').addEventListener('click', openArcade);
    $('#arcade-close').addEventListener('click', closeArcade);
    $('#arcade-fs').addEventListener('click', () => $('#arcade-screen iframe')?.requestFullscreen?.());
    $('#btn-members').addEventListener('click', () => { $('#members').classList.toggle('open'); });
    $('#btn-menu').addEventListener('click', () => { $('#sidebar').classList.add('open'); $('#scrim').classList.remove('hidden'); });
    $('#scrim').addEventListener('click', closeDrawers);
    $('#btn-emoji').addEventListener('click', e => openEmoji(e.currentTarget, em => { const i = $('#chat-input'); i.value += em; i.focus(); }));

    const input = $('#chat-input');
    $('#composer').addEventListener('submit', e => { e.preventDefault(); sendChat(); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } });
    let lastTyping = 0;
    input.addEventListener('input', () => {
      input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 128) + 'px';
      if (input.value.trim() && Date.now() - lastTyping > 2500) { lastTyping = Date.now(); emit('chat:typing', { channelId: state.activeText }); }
    });
  });
})();
