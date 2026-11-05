'use strict';
/**
 * Jogatina V3 — extensão aditiva de tempo real.
 * O login por nick continua no server.js. Somente C0kz continua a exigir senha.
 * Armazenamento JSON usa DATA_DIR; em hospedagem com disco efêmero, use volume persistente.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

module.exports = function installJogatinaV3({io, dataDir}) {
  const file = (name) => path.join(dataDir, `v3-${name}.json`);
  const read = (name, fallback) => {
    try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); }
    catch { return fallback; }
  };
  const save = (name, data) => {
    const dest = file(name), tmp = dest + '.tmp';
    try { fs.writeFileSync(tmp, JSON.stringify(data)); fs.renameSync(tmp, dest); }
    catch (e) { console.error('[V3] Falha ao salvar '+name, e.message); }
  };
  const profiles = read('profiles', {});
  let lobby = read('lobby', null);
  let clips = read('clips', []);
  let agenda = read('agenda', []);
  const games = ['Valorant', 'CS2', 'League of Legends', 'Fortnite', 'Minecraft', 'Rocket League', 'Outro'];
  const clean = (v,n=80) => String(v || '').replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,n);
  const key = nick => clean(nick,32).toLowerCase();
  const connected = s => !!s.data.nick;
  const owner = s => s.data.owner === true;
  const emitAll = (kind, data) => io.emit(`v3:${kind}`, data);
  const error = (s,msg) => s.emit('v3:error',msg);
  const protectedCall = (s, fn) => (...args) => { if (connected(s)) { try { fn(...args); } catch(e) { console.error('[V3]', e); error(s,'Erro ao executar ação.'); } } };
  const limits = new Map();
  function throttle(s, action, interval=700) {
    const tag=s.id+':'+action, now=Date.now();
    if(now-(limits.get(tag)||0)<interval) return true;
    limits.set(tag,now); return false;
  }
  const normalizeProfile = p => ({
    avatar: /^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(p?.avatar||'') && p.avatar.length<=130000 ? p.avatar : '',
    bio: clean(p?.bio,180),
    banner: ['nebula','arena','night'].includes(p?.banner) ? p.banner : 'nebula',
    activity: ['online','jogando','duo','afk'].includes(p?.activity) ? p.activity : 'online',
    games: Array.isArray(p?.games) ? [...new Set(p.games.filter(g=>games.includes(g)))].slice(0,5) : []
  });
  Object.keys(profiles).forEach(k => { profiles[k] = normalizeProfile(profiles[k]); });
  function snapshot(s) {
    s.emit('v3:data', { profiles, lobby, clips:clips.slice(-30), agenda:agenda.slice(-12) });
  }
  function sendLobby(){ save('lobby',lobby); emitAll('lobby',lobby); }
  // A sala pertence ao host; apenas o host ou dono pode encerra-la.
  function canManage(s) { return lobby && (owner(s) || key(s.data.nick)===key(lobby.host)); }
  io.on('connection', socket => {
    const on = (event,fn) => socket.on('v3:'+event, protectedCall(socket,fn));
    on('get', () => snapshot(socket));
    on('profile:update', p => {
      if(throttle(socket,'profile',2000)) return;
      const nick=key(socket.data.nick);
      const next=normalizeProfile(p);
      // Limite de fotos impede dados arbitrarios em excesso.
      profiles[nick]=next;
      save('profiles',profiles);
      emitAll('profiles',profiles);
    });
    on('lobby:create', p => {
      if(throttle(socket,'lobby',1000)) return;
      if(lobby) return error(socket,'Já existe uma sala aberta.');
      const game=games.includes(p?.game)?p.game:games[0];
      const capacity=Math.min(10,Math.max(2,Number(p?.capacity)||5));
      lobby={ id:crypto.randomBytes(7).toString('hex'), host:socket.data.nick,
        game, mode:clean(p?.mode,36)||'Casual', capacity,
        players:[{nick:socket.data.nick,ready:false}], createdAt:Date.now() };
      sendLobby();
    });
    on('lobby:join', () => {
      if(!lobby) return error(socket,'Nenhuma partida organizada no momento.');
      if(lobby.players.some(x=>key(x.nick)===key(socket.data.nick))) return;
      if(lobby.players.length>=lobby.capacity) return error(socket,'A sala está cheia.');
      lobby.players.push({nick:socket.data.nick,ready:false}); sendLobby();
    });
    on('lobby:leave', () => {
      if(!lobby) return;
      lobby.players=lobby.players.filter(x=>key(x.nick)!==key(socket.data.nick));
      if(!lobby.players.length) lobby=null;
      else if(key(lobby.host)===key(socket.data.nick)) lobby.host=lobby.players[0].nick;
      sendLobby();
    });
    on('invite', p => {
      if (!lobby || !lobby.players.some(x=>key(x.nick)===key(socket.data.nick)))
        return error(socket,'Entre no lobby para convidar alguém.');
      if (throttle(socket,'invite',1500)) return;
      const target=io.sockets?.sockets?.get(String(p?.targetId||''));
      if (!target?.data?.nick || target===socket) return error(socket,'Amigo indisponível.');
      target.emit('v3:invite',{from:socket.data.nick,game:lobby.game});
      socket.emit('v3:toast','Convite enviado para '+target.data.nick+'.');
    });
    on('lobby:ready', () => {
      if(!lobby) return;
      const player=lobby.players.find(x=>key(x.nick)===key(socket.data.nick));
      if(!player) return error(socket,'Entre na sala antes de confirmar.');
      player.ready=!player.ready; sendLobby();
    });
    on('lobby:close', () => {
      if(!canManage(socket)) return error(socket,'Somente o anfitrião ou C0kz pode encerrar.');
      lobby=null; sendLobby();
    });
    on('clip:add', p => {
      if(throttle(socket,'clip',5000)) return;
      let url;
      try { url=new URL(String(p?.url||'')); }
      catch { return error(socket,'Insira um link válido.'); }
      if(url.protocol!=='https:' || url.href.length>350) return error(socket,'Use um link HTTPS.');
      clips.push({id:crypto.randomBytes(6).toString('hex'),url:url.href,title:clean(p?.title,90)||'Clipe da galera',by:socket.data.nick,ts:Date.now()});
      clips=clips.slice(-60);save('clips',clips);emitAll('clips',clips);
    });
    on('agenda:add',p=>{
      if(!owner(socket)) return error(socket,'Somente o C0kz pode agendar novas partidas.');
      const ts=Date.parse(p?.when||'');
      if(!Number.isFinite(ts)||ts<Date.now()-60000||ts>Date.now()+365*86400000) return error(socket,'Escolha uma data futura válida.');
      agenda.push({id:crypto.randomBytes(5).toString('hex'),game:games.includes(p?.game)?p.game:games[0],when:new Date(ts).toISOString(),title:clean(p?.title,90)||'Jogatina da galera',going:[]});
      agenda=agenda.slice(-20);save('agenda',agenda);emitAll('agenda',agenda);
    });
    on('agenda:rsvp',p=>{
      const event=agenda.find(x=>x.id===p?.id);if(!event)return;
      const i=event.going.findIndex(n=>key(n)===key(socket.data.nick));
      if(i>=0) event.going.splice(i,1);else event.going.push(socket.data.nick);
      save('agenda',agenda);emitAll('agenda',agenda);
    });
    socket.on('disconnect',()=>{ for(const tag of limits.keys()) if(tag.startsWith(socket.id+':')) limits.delete(tag); });
  });
  console.log('[Jogatina V3] perfis, lobby, agenda e clipes ativados.');
};