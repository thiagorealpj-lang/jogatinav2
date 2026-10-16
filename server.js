'use strict';
/* =====================================================================
   JOGATINA DOS AMIGOS — servidor v2 (by C0kz)
   Express + Socket.IO. Canais de texto/voz, histórico, moderação,
   sinalização WebRTC, assistente (Gemini opcional).
   ===================================================================== */
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const OWNER_NICK = (process.env.OWNER_NICK || 'c0kz').trim().toLowerCase();
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const MAX_MESSAGES = 300;
const HISTORY_SIZE = 100;
const MAX_CHANNELS = 30;

fs.mkdirSync(DATA_DIR, { recursive: true });
const FILES = {
  channels: path.join(DATA_DIR, 'channels.json'),
  messages: path.join(DATA_DIR, 'messages.json'),
  bans: path.join(DATA_DIR, 'bans.json'),
  admins: path.join(DATA_DIR, 'admins.json')
};

/* ------------------------------ utilidades ------------------------------ */
function readJSON(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error('Erro lendo', path.basename(file), e.message);
  }
  return fallback;
}
function writeJSON(file, data) {
  try {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  } catch (e) {
    console.error('Erro salvando', path.basename(file), e.message);
  }
}
const timers = {};
function saveLater(key, file, getter, delay = 800) {
  clearTimeout(timers[key]);
  timers[key] = setTimeout(() => writeJSON(file, getter()), delay);
}
const newId = () => crypto.randomBytes(6).toString('hex');
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const COLORS = ['#a855f7', '#06b6d4', '#ec4899', '#10b981', '#f59e0b', '#6366f1', '#f43f5e', '#22d3ee'];
const colorFor = nick => COLORS[parseInt(sha(nick).slice(0, 6), 16) % COLORS.length];
const isHex = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);

/* ------------------------------ senha do dono ------------------------------ */
// Sem isso, qualquer pessoa digitando o nick do dono viraria dono.
function loadOwnerPassword() {
  if (process.env.OWNER_PASSWORD) return process.env.OWNER_PASSWORD;
  const file = path.join(DATA_DIR, 'owner-password.txt');
  try {
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  } catch (_) { /* segue e gera uma nova */ }
  const pw = crypto.randomBytes(9).toString('base64url');
  try { fs.writeFileSync(file, pw, { mode: 0o600 }); } catch (_) { /* ignora */ }
  console.log('\n==============================================================');
  console.log(` SENHA DO DONO (nick "${OWNER_NICK}") gerada: ${pw}`);
  console.log(` Salva em ${file}. Defina OWNER_PASSWORD para fixar uma sua.`);
  console.log('==============================================================\n');
  return pw;
}
const OWNER_PASSWORD = loadOwnerPassword();
function checkOwnerPassword(input) {
  const a = crypto.createHash('sha256').update(String(input)).digest();
  const b = crypto.createHash('sha256').update(OWNER_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}
const ownerFails = new Map();
function ownerLimited(ip) {
  const now = Date.now();
  const arr = (ownerFails.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
  ownerFails.set(ip, arr);
  return arr.length >= 5;
}
function ownerFail(ip) {
  const arr = ownerFails.get(ip) || [];
  arr.push(Date.now());
  ownerFails.set(ip, arr);
}

/* ------------------------------ dados persistentes ------------------------------ */
const channels = new Map();
function addChannel(c) {
  const ch = {
    id: c.id || newId(),
    name: String(c.name || 'canal').slice(0, 64),
    type: c.type === 'text' ? 'text' : 'voice',
    limit: Math.max(0, Math.min(99, Number(c.limit) || 0)),
    topic: String(c.topic || '').slice(0, 120)
  };
  channels.set(ch.id, ch);
  return ch;
}
function saveChannels() { saveLater('channels', FILES.channels, () => [...channels.values()], 200); }
(function loadChannels() {
  const saved = readJSON(FILES.channels, null);
  if (Array.isArray(saved) && saved.length) {
    saved.forEach(addChannel);
  } else {
    const legacy = readJSON(path.join(__dirname, 'rooms.json'), null); // migração da v1
    addChannel({ name: 'geral', type: 'text', topic: 'Bate-papo geral da galera' });
    addChannel({ name: 'jogos', type: 'text', topic: 'Combine partidas e mande clipes' });
    let names = Array.isArray(legacy) ? legacy.map(String) : ['Geral', 'Jogatina', 'AFK'];
    if (!names.includes('Geral')) names.unshift('Geral');
    names.forEach(n => addChannel({ name: n, type: 'voice' }));
  }
  const list = [...channels.values()];
  if (!list.some(c => c.type === 'text')) addChannel({ name: 'geral', type: 'text' });
  if (!list.some(c => c.type === 'voice')) addChannel({ name: 'Geral', type: 'voice' });
  saveChannels();
})();

const messages = readJSON(FILES.messages, {});
function saveMessages() { saveLater('messages', FILES.messages, () => messages); }

let bans = readJSON(FILES.bans, null);
if (!Array.isArray(bans)) {
  const legacy = readJSON(path.join(__dirname, 'banned-users.json'), []);
  bans = (Array.isArray(legacy) ? legacy : []).map(n => ({ nick: String(n), ip: null, ts: Date.now(), by: 'v1' }));
}
function saveBans() { saveLater('bans', FILES.bans, () => bans, 100); }
const isLoopback = ip => !ip || ip === '::1' || ip.startsWith('127.') || ip.includes('127.0.0.1');
const isBanned = (lowerNick, ip) =>
  bans.some(b => b.nick.toLowerCase() === lowerNick || (b.ip && !isLoopback(ip) && b.ip === ip));

const admins = new Map(); // hash do token do dispositivo -> nick
(readJSON(FILES.admins, []) || []).forEach(a => a && a.hash && admins.set(a.hash, a.nick));
function saveAdmins() {
  saveLater('admins', FILES.admins, () => [...admins].map(([hash, nick]) => ({ hash, nick })), 100);
}

function flushAll() {
  Object.values(timers).forEach(clearTimeout);
  writeJSON(FILES.channels, [...channels.values()]);
  writeJSON(FILES.messages, messages);
  writeJSON(FILES.bans, bans);
  writeJSON(FILES.admins, [...admins].map(([hash, nick]) => ({ hash, nick })));
}
['SIGINT', 'SIGTERM'].forEach(sig => process.on(sig, () => { flushAll(); process.exit(0); }));

/* ------------------------------ app / io ------------------------------ */
const app = express();
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 2e5, pingTimeout: 30000 });

function iceServers() {
  const list = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
  if (process.env.TURN_URL) {
    list.push({
      urls: process.env.TURN_URL.split(',').map(s => s.trim()),
      username: process.env.TURN_USER || '',
      credential: process.env.TURN_PASS || ''
    });
  }
  return list;
}

const onlineSockets = () => [...io.sockets.sockets.values()].filter(s => s.data.nick);
const isAdminS = s => s.data.owner === true || s.data.isAdmin === true;
const roleOf = s => (s.data.owner ? 'owner' : s.data.isAdmin ? 'admin' : 'member');
const publicUser = s => ({
  id: s.id,
  nick: s.data.nick,
  color: s.data.color,
  status: s.data.status,
  customStatus: s.data.customStatus,
  role: roleOf(s),
  voice: s.data.voice,
  muted: s.data.muted,
  deafened: s.data.deafened,
  serverMuted: s.data.serverMuted,
  sharing: !!s.data.screenStream
});
const allUsers = () => onlineSockets().map(publicUser);
let usersPending = false;
function scheduleUsers() {
  if (usersPending) return;
  usersPending = true;
  setTimeout(() => { usersPending = false; io.emit('users', allUsers()); }, 50);
}
const broadcastChannels = () => io.emit('channels', [...channels.values()]);
const voiceRoom = id => 'voice:' + id;
const voiceSize = id => (io.sockets.adapter.rooms.get(voiceRoom(id)) || new Set()).size;

function limited(socket, key, max, windowMs) {
  const now = Date.now();
  const arr = (socket.data.rl[key] = socket.data.rl[key] || []);
  while (arr.length && now - arr[0] > windowMs) arr.shift();
  if (arr.length >= max) return true;
  arr.push(now);
  return false;
}
function clientIp(socket) {
  const xf = String(socket.handshake.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || socket.handshake.address || '';
}
function cleanNick(v) {
  return String(v || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 32);
}
function cleanChannelName(v, type) {
  let n = String(v || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 32);
  if (type === 'text') n = n.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '');
  return n;
}

function leaveVoice(s) {
  const id = s.data.voice;
  if (!id) return;
  s.leave(voiceRoom(id));
  s.data.voice = null;
  if (s.data.screenStream) {
    s.data.screenStream = null;
    io.to(voiceRoom(id)).emit('screen:share', { peerId: s.id, streamId: null });
  }
  io.to(voiceRoom(id)).emit('voice:peer-left', s.id);
  scheduleUsers();
}
function joinVoice(s, id, force = false) {
  const ch = channels.get(id);
  if (!ch || ch.type !== 'voice') { s.emit('app-error', 'Esse canal de voz não existe.'); return false; }
  if (s.data.voice === id) return true;
  if (!force && ch.limit > 0 && voiceSize(id) >= ch.limit && !isAdminS(s)) {
    s.emit('app-error', 'Esse canal de voz está lotado.');
    return false;
  }
  leaveVoice(s);
  const room = voiceRoom(id);
  const peers = [...(io.sockets.adapter.rooms.get(room) || [])]
    .map(sid => io.sockets.sockets.get(sid)).filter(Boolean);
  s.join(room);
  s.data.voice = id;
  s.emit('voice:joined', {
    channelId: id,
    peers: peers.map(p => ({ id: p.id, nick: p.data.nick })),
    screens: peers.filter(p => p.data.screenStream).map(p => ({ peerId: p.id, streamId: p.data.screenStream }))
  });
  s.to(room).emit('voice:peer-joined', { peerId: s.id, nick: s.data.nick });
  scheduleUsers();
  return true;
}
function dropUser(t, event, message) {
  t.emit(event, { message });
  setTimeout(() => t.disconnect(true), 300);
}

/* ------------------------------ assistente ------------------------------ */
function evalMath(input) {
  const src = String(input).replace(/,/g, '.').replace(/[x×]/gi, '*').replace(/÷/g, '/').replace(/\s+/g, '');
  if (!src || !/^[0-9.+\-*/%^()]+$/.test(src)) return null;
  let i = 0;
  const peek = () => src[i];
  function expr() { let v = term(); while (peek() === '+' || peek() === '-') { const o = src[i++]; const r = term(); v = o === '+' ? v + r : v - r; } return v; }
  function term() { let v = pow(); while (peek() === '*' || peek() === '/' || peek() === '%') { const o = src[i++]; const r = pow(); v = o === '*' ? v * r : o === '/' ? v / r : v % r; } return v; }
  function pow() { const b = unary(); if (peek() === '^') { i++; return Math.pow(b, pow()); } return b; }
  function unary() { if (peek() === '-') { i++; return -unary(); } if (peek() === '+') { i++; return unary(); } return atom(); }
  function atom() {
    if (peek() === '(') { i++; const v = expr(); if (peek() !== ')') throw new Error('x'); i++; return v; }
    const m = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(i));
    if (!m) throw new Error('x');
    i += m[0].length;
    return parseFloat(m[0]);
  }
  try {
    const v = expr();
    return i === src.length && Number.isFinite(v) ? Number(v.toFixed(10)) : null;
  } catch (_) { return null; }
}
function localAnswer(q) {
  const p = q.toLowerCase();
  if (/quem (é|e) voc(ê|e)|seu nome/.test(p)) return 'Sou o Secretário do C0kz, o assistente da Jogatina Dos Amigos. Sem chave de IA configurada, respondo contas, dicas dos jogos do Arcade e ajuda com a plataforma.';
  if (/dono|c0kz/.test(p)) return 'O C0kz é o criador e dono da Jogatina Dos Amigos.';
  if (/mario/.test(p)) return 'Super Mario World: segure o botão de correr para pegar a capa e voar, e procure as saídas secretas das fases.';
  if (/kof|king of fighters/.test(p)) return 'KOF 2002: dominar o cancelamento no modo MAX (B+C) é a chave para os maiores combos.';
  if (/metal slug/.test(p)) return 'Metal Slug X: guarde as bombas para os chefes e resgate todos os prisioneiros.';
  if (/ajuda|comandos|como usar|help/.test(p)) return 'Entre num canal de voz, use 📺 para compartilhar a tela, abra o Arcade Retrô e ajuste tudo em ⚙ Configurações. No chat: /me, /shrug, /ia, /clear (admin).';
  return `Entendi sua pergunta sobre "${q.slice(0, 80)}". Para respostas completas de IA, o dono precisa configurar GEMINI_API_KEY no servidor. Enquanto isso, posso ajudar com contas, dicas do Arcade e uso da sala.`;
}
async function askGemini(q, nick) {
  if (!GEMINI_KEY || typeof fetch !== 'function') return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
        signal: ctrl.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: 'Você é o Secretário do C0kz, assistente de uma sala de voz e jogos entre amigos chamada Jogatina Dos Amigos. Responda em português do Brasil, de forma curta, simpática e útil.' }] },
          contents: [{ role: 'user', parts: [{ text: `${nick} pergunta: ${q}` }] }],
          generationConfig: { maxOutputTokens: 600, temperature: 0.7 }
        })
      }
    );
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const text = (j?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
    return text ? text.slice(0, 2000) : null;
  } finally { clearTimeout(t); }
}

/* ------------------------------ conexões ------------------------------ */
io.on('connection', socket => {
  const d = Object.assign(socket.data, {
    nick: null, color: '#a855f7', status: 'online', customStatus: '',
    isAdmin: false, owner: false, tokenHash: null,
    voice: null, muted: false, deafened: false, serverMuted: false,
    screenStream: null, ip: clientIp(socket), rl: {}
  });
  const fail = m => socket.emit('app-error', m);
  const on = (ev, fn, auth = true) => socket.on(ev, payload => {
    if (auth && !d.nick) return;
    try { fn(payload && typeof payload === 'object' ? payload : {}); } catch (e) { console.error(ev, e); }
  });
  const target = id => {
    const t = io.sockets.sockets.get(String(id || ''));
    return t && t.data.nick ? t : null;
  };
  const canModerate = t => t && t !== socket && !t.data.owner && (d.owner || (isAdminS(socket) && !isAdminS(t)));

  /* ---------- entrada ---------- */
  on('join', p => {
    if (d.nick) return;
    if (limited(socket, 'join', 8, 60000)) return socket.emit('join-error', 'Muitas tentativas. Aguarde um minuto.');
    const nick = cleanNick(p.nick);
    if (!nick) return socket.emit('join-error', 'Informe um nick válido.');
    const lower = nick.toLowerCase();
    const wantsOwner = lower === OWNER_NICK;

    if (!wantsOwner && isBanned(lower, d.ip)) {
      socket.emit('banned', { message: 'Você foi banido deste servidor.' });
      return setTimeout(() => socket.disconnect(true), 300);
    }
    if (wantsOwner) {
      if (!p.password) return socket.emit('need-password');
      if (ownerLimited(d.ip)) return socket.emit('join-error', 'Muitas tentativas de senha. Aguarde alguns minutos.');
      if (!checkOwnerPassword(p.password)) { ownerFail(d.ip); return socket.emit('join-error', 'Senha do dono incorreta.'); }
    }
    const dup = onlineSockets().find(s => s !== socket && s.data.nick.toLowerCase() === lower);
    if (dup) {
      if (wantsOwner) dropUser(dup, 'kicked', 'Sua sessão foi aberta em outro lugar.');
      else return socket.emit('join-error', 'Esse nick já está em uso por alguém online.');
    }

    const token = String(p.token || '');
    d.tokenHash = token.length >= 16 ? sha(token) : null;
    d.nick = nick;
    d.owner = wantsOwner;
    d.isAdmin = !!d.tokenHash && admins.has(d.tokenHash);
    d.color = isHex(p.color) ? p.color : colorFor(nick);

    socket.emit('init', {
      meId: socket.id,
      channels: [...channels.values()],
      users: allUsers(),
      ai: !!GEMINI_KEY,
      iceServers: iceServers()
    });
    scheduleUsers();
  }, false);

  on('profile:set', p => {
    if (isHex(p.color)) d.color = p.color;
    if (['online', 'idle', 'dnd'].includes(p.status)) d.status = p.status;
    if (typeof p.customStatus === 'string') d.customStatus = p.customStatus.replace(/[\u0000-\u001f]/g, '').slice(0, 60);
    scheduleUsers();
  });

  /* ---------- canais ---------- */
  on('channel:create', p => {
    if (!isAdminS(socket)) return fail('Somente administradores podem criar canais.');
    if (channels.size >= MAX_CHANNELS) return fail('Limite de canais atingido.');
    const type = p.type === 'text' ? 'text' : 'voice';
    const name = cleanChannelName(p.name, type);
    if (!name) return fail('Nome de canal inválido.');
    if ([...channels.values()].some(c => c.type === type && c.name.toLowerCase() === name.toLowerCase()))
      return fail('Já existe um canal com esse nome.');
    addChannel({ name, type, limit: p.limit, topic: p.topic });
    saveChannels();
    broadcastChannels();
  });
  on('channel:update', p => {
    if (!isAdminS(socket)) return fail('Sem permissão para editar canais.');
    const ch = channels.get(p.id);
    if (!ch) return;
    if (typeof p.name === 'string') {
      const n = cleanChannelName(p.name, ch.type);
      if (n) ch.name = n;
    }
    if (typeof p.topic === 'string') ch.topic = p.topic.replace(/[\u0000-\u001f]/g, '').slice(0, 120);
    if (ch.type === 'voice' && p.limit !== undefined) ch.limit = Math.max(0, Math.min(99, Number(p.limit) || 0));
    saveChannels();
    broadcastChannels();
  });
  on('channel:delete', p => {
    if (!isAdminS(socket)) return fail('Sem permissão para excluir canais.');
    const ch = channels.get(p.id);
    if (!ch) return;
    const same = [...channels.values()].filter(c => c.type === ch.type);
    if (same.length <= 1) return fail('Precisa existir pelo menos um canal desse tipo.');
    const fallback = same.find(c => c.id !== ch.id);
    if (ch.type === 'voice') {
      for (const sid of [...(io.sockets.adapter.rooms.get(voiceRoom(ch.id)) || [])]) {
        const s = io.sockets.sockets.get(sid);
        if (s) { leaveVoice(s); joinVoice(s, fallback.id, true); s.emit('force-move', { channelId: fallback.id }); }
      }
    } else {
      delete messages[ch.id];
      saveMessages();
    }
    channels.delete(ch.id);
    saveChannels();
    broadcastChannels();
  });

  /* ---------- chat ---------- */
  on('text:open', p => {
    const ch = channels.get(p.channelId);
    if (!ch || ch.type !== 'text') return;
    socket.emit('chat:history', { channelId: ch.id, messages: (messages[ch.id] || []).slice(-HISTORY_SIZE) });
  });
  on('chat:send', p => {
    if (limited(socket, 'chat', 6, 6000)) return fail('Calma! Você está enviando mensagens rápido demais.');
    const ch = channels.get(p.channelId);
    if (!ch || ch.type !== 'text') return;
    const text = String(p.content || '').replace(/\r\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim().slice(0, 2000);
    if (!text) return;
    const list = (messages[ch.id] = messages[ch.id] || []);
    let replyTo = null;
    if (p.replyTo) {
      const o = list.find(m => m.id === p.replyTo);
      if (o) replyTo = { id: o.id, nick: o.author.nick, snippet: o.content.slice(0, 80) };
    }
    const msg = {
      id: newId(), channelId: ch.id,
      author: { nick: d.nick, color: d.color },
      content: text, ts: Date.now(), edited: false, reactions: {}, replyTo
    };
    list.push(msg);
    if (list.length > MAX_MESSAGES) list.splice(0, list.length - MAX_MESSAGES);
    saveMessages();
    io.emit('chat:message', msg);
  });
  on('chat:edit', p => {
    if (limited(socket, 'edit', 10, 10000)) return;
    const m = (messages[p.channelId] || []).find(x => x.id === p.id);
    if (!m || m.author.nick !== d.nick) return;
    const text = String(p.content || '').trim().slice(0, 2000);
    if (!text) return;
    m.content = text;
    m.edited = true;
    saveMessages();
    io.emit('chat:update', m);
  });
  on('chat:delete', p => {
    const list = messages[p.channelId];
    if (!list) return;
    const idx = list.findIndex(x => x.id === p.id);
    if (idx < 0) return;
    if (list[idx].author.nick !== d.nick && !isAdminS(socket)) return fail('Você só pode apagar suas mensagens.');
    list.splice(idx, 1);
    saveMessages();
    io.emit('chat:delete', { channelId: p.channelId, id: p.id });
  });
  on('chat:react', p => {
    if (limited(socket, 'react', 12, 6000)) return;
    const m = (messages[p.channelId] || []).find(x => x.id === p.id);
    const emoji = String(p.emoji || '').slice(0, 8);
    if (!m || !emoji) return;
    const arr = (m.reactions[emoji] = m.reactions[emoji] || []);
    const i = arr.indexOf(d.nick);
    if (i >= 0) arr.splice(i, 1);
    else if (Object.keys(m.reactions).length <= 12) arr.push(d.nick);
    if (!arr.length) delete m.reactions[emoji];
    saveMessages();
    io.emit('chat:update', m);
  });
  on('chat:typing', p => {
    if (limited(socket, 'typing', 1, 2000)) return;
    socket.broadcast.emit('chat:typing', { channelId: p.channelId, nick: d.nick });
  });
  on('chat:clear', p => {
    if (!isAdminS(socket)) return fail('Somente administradores podem limpar o chat.');
    const ch = channels.get(p.channelId);
    if (!ch || ch.type !== 'text') return;
    messages[ch.id] = [];
    saveMessages();
    io.emit('chat:cleared', { channelId: ch.id, by: d.nick });
  });

  /* ---------- voz ---------- */
  on('voice:join', p => { joinVoice(socket, String(p.channelId || '')); });
  on('voice:leave', () => leaveVoice(socket));
  on('voice:state', p => {
    d.muted = !!p.muted;
    d.deafened = !!p.deafened;
    scheduleUsers();
  });
  on('screen:share', p => {
    if (!d.voice) return;
    const sid = p.streamId ? String(p.streamId).slice(0, 80) : null;
    d.screenStream = sid;
    socket.to(voiceRoom(d.voice)).emit('screen:share', { peerId: socket.id, streamId: sid });
    scheduleUsers();
  });
  on('signal', p => {
    const t = target(p.to);
    if (!t || !d.voice || t.data.voice !== d.voice) return;
    const out = { from: socket.id };
    if (p.description && typeof p.description === 'object') out.description = p.description;
    else if (p.candidate && typeof p.candidate === 'object') out.candidate = p.candidate;
    else return;
    t.emit('signal', out);
  });

  /* ---------- moderação ---------- */
  on('mod:promote', p => {
    if (!d.owner) return fail('Somente o dono pode promover administradores.');
    const t = target(p.targetId);
    if (!t || t === socket || t.data.owner) return;
    if (!t.data.tokenHash) return fail('Esse usuário não tem identificação persistente (recarregue a página).');
    admins.set(t.data.tokenHash, t.data.nick);
    t.data.isAdmin = true;
    saveAdmins();
    t.emit('toast', { message: 'Você foi promovido a administrador 👑' });
    scheduleUsers();
  });
  on('mod:demote', p => {
    if (!d.owner) return fail('Somente o dono pode rebaixar administradores.');
    const t = target(p.targetId);
    if (!t || t === socket || t.data.owner) return;
    if (t.data.tokenHash) admins.delete(t.data.tokenHash);
    t.data.isAdmin = false;
    saveAdmins();
    scheduleUsers();
  });
  on('mod:move', p => {
    if (!isAdminS(socket)) return fail('Você não tem permissão para mover usuários.');
    const t = target(p.targetId);
    if (!canModerate(t)) return fail('Você não pode moderar esse usuário.');
    if (!t.data.voice) return fail('Esse usuário não está em um canal de voz.');
    const ch = channels.get(p.channelId);
    if (!ch || ch.type !== 'voice') return fail('O canal de destino não existe.');
    if (t.data.voice === ch.id) return fail('O usuário já está nesse canal.');
    leaveVoice(t);
    joinVoice(t, ch.id, true);
    t.emit('force-move', { channelId: ch.id });
  });
  on('mod:voicekick', p => {
    if (!isAdminS(socket)) return fail('Sem permissão.');
    const t = target(p.targetId);
    if (!canModerate(t) || !t.data.voice) return;
    leaveVoice(t);
    t.emit('voice:kicked', { message: 'Você foi desconectado da voz por um administrador.' });
  });
  on('mod:servermute', p => {
    if (!isAdminS(socket)) return fail('Sem permissão.');
    const t = target(p.targetId);
    if (!canModerate(t)) return;
    t.data.serverMuted = !!p.value;
    scheduleUsers();
  });
  on('mod:kick', p => {
    if (!isAdminS(socket)) return fail('Você não tem permissão para expulsar usuários.');
    const t = target(p.targetId);
    if (!canModerate(t)) return fail('Você não pode expulsar esse usuário.');
    dropUser(t, 'kicked', 'Você foi expulso do servidor.');
  });
  on('mod:ban', p => {
    if (!d.owner) return fail('Somente o dono pode banir usuários.');
    const t = target(p.targetId);
    if (!t || t === socket || t.data.owner) return fail('Esse usuário não pode ser banido.');
    bans.push({ nick: t.data.nick, ip: isLoopback(t.data.ip) ? null : t.data.ip, ts: Date.now(), by: d.nick });
    saveBans();
    dropUser(t, 'banned', 'Você foi banido deste servidor.');
  });
  on('mod:unban', p => {
    if (!d.owner) return fail('Somente o dono pode desbanir.');
    const nick = String(p.nick || '').toLowerCase();
    bans = bans.filter(b => b.nick.toLowerCase() !== nick);
    saveBans();
    socket.emit('bans:list', bans.map(({ nick: n, ts, by }) => ({ nick: n, ts, by })));
  });
  on('bans:list', () => {
    if (!d.owner) return;
    socket.emit('bans:list', bans.map(({ nick, ts, by }) => ({ nick, ts, by })));
  });

  /* ---------- assistente ---------- */
  on('ai:ask', async p => {
    if (limited(socket, 'ai', 5, 60000)) {
      return socket.emit('ai:answer', { answer: 'Muitas perguntas seguidas — espere um instante.', source: 'local' });
    }
    const q = String(p.prompt || '').trim().slice(0, 800);
    if (!q) return;
    let answer = null;
    let source = 'local';
    const math = evalMath(q.replace(/^quanto\s+(é|e)\s*/i, '').replace(/[=?]+$/, ''));
    if (math !== null) {
      answer = `O resultado é ${math}.`;
    } else {
      try { answer = await askGemini(q, d.nick); if (answer) source = 'gemini'; }
      catch (e) { console.error('Gemini:', e.message); }
      if (!answer) answer = localAnswer(q);
    }
    socket.emit('ai:answer', { answer, source });
  });

  socket.on('disconnect', () => {
    if (!d.nick) return;
    leaveVoice(socket);
    scheduleUsers();
  });
});

server.listen(PORT, () => {
  console.log(`Jogatina Dos Amigos v2 rodando na porta ${PORT}`);
  console.log(`Assistente: ${GEMINI_KEY ? 'Gemini (' + GEMINI_MODEL + ')' : 'modo local (defina GEMINI_API_KEY para IA completa)'}`);
});
