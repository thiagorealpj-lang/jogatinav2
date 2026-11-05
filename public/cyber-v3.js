'use strict';
/* Jogatina V3 — interface premium, sem substituir o chat/voz/arcade originais. */
(() => {
  let app = null;
  const V = { view:'chat', profiles:{}, lobby:null, clips:[], agenda:[], draft:null, search:'' };
  const $ = s => document.querySelector(s);
  const $ = s => [...document.querySelectorAll(s)];
  const E = v => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const games = ['Valorant','CS2','League of Legends','Fortnite','Minecraft','Rocket League','Outro'];
  const actName = {online:'Online',jogando:'Jogando agora',duo:'Procurando duo',afk:'AFK'};
  const key = v => String(v||'').trim().toLowerCase();
  const myNick = () => app?.me()?.nick || '';
  const myProfile = () => V.profiles[key(myNick)] || {};
  const photo = (nick,cls='') => {
    const p=V.profiles[key(nick)]?.avatar;
    return `<span class="v3-face ${cls}">${p ? `<img src="${E(p)}" alt="" loading="lazy">` : E(nick?.trim()?.[0]?.toUpperCase() || '🎮')}</span>`;
  };
  const symbol = nick => key(nick)===key(myNick()) && app?.isOwner() ? ' 👑' : '';
  const shortTime = s => {try{return new Date(s).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});}catch{return '—';}};
  const bannerBg = id => `v3-banner--${['nebula','arena','night'].includes(id)?id:'nebula'}`;
  const notify = msg => app?.toast(msg);
  const send = (ev,data={}) => app?.emit('v3:'+ev,data);

  function title() { return V.view==='chat'?'# geral':V.view==='lobby'?'Bora jogar?':V.view==='profile'?'Meu perfil':'Clipes'; }
  function show(view) {
    if(!['chat','lobby','profile','clips'].includes(view))return;
    V.view=view;
    const isChat=view==='chat';
    ['#chat','#typing','#composer','#v3-chat-promo'].forEach(s=>{const n=$(s);if(n)n.classList.toggle('hidden',!isChat);});
    ['lobby','profile','clips'].forEach(s=>$('#v3-'+s)?.classList.toggle('hidden',view!==s));
    $$('.v3-link').forEach(btn=>btn.classList.toggle('v3-active',btn.dataset.v3View===view));
    $('#v3-view-label').textContent=title();
    const stage=$('#stage');
    if(stage){
      if(view==='lobby') $('#v3-share-host')?.append(stage);
      else $('#topbar')?.after(stage);
    }
    if(view==='lobby')renderLobby();
    if(view==='profile')renderProfile();
    if(view==='clips')renderClips();
    $('#sidebar')?.classList.remove('open');$('#scrim')?.classList.add('hidden');
  }
  const link=(name,label,emoji)=>`<button type="button" class="v3-link" data-v3-view="${name}"><span>${emoji}</span><span>${label}</span></button>`;
  function install() {
    if($('#v3-topnav'))return;
    const sidebar=$('#sidebar'), main=$('#main'), topbar=$('#topbar'), members=$('#members');
    if(!sidebar || !main || !topbar || !members)return;
    document.body.classList.add('v3-enabled');
    // Preserva os controles e listeners atuais; apenas insere navegação adicional.
    const nav=document.createElement('div');nav.id='v3-sidebar-nav';
    nav.innerHTML=link('chat','Conversas','💬')+link('lobby','Bora jogar?','🎮')+link('profile','Meu perfil','👤')+link('clips','Clipes','🎬');
    sidebar.querySelector('.server-head')?.after(nav);
    const top=document.createElement('div');top.id='v3-topnav';
    top.innerHTML=`<span class="v3-view-heading" id="v3-view-label"># geral</span>`+link('lobby','Bora jogar?','🎮')+link('profile','Perfil','👤');
    const actions=topbar.querySelector('.tb-actions');if(actions)topbar.insertBefore(top,actions);else topbar.append(top);
    const promo=document.createElement('section');promo.id='v3-chat-promo';promo.className='v3-promo';
    main.insertBefore(promo,$('#composer'));
    for(const id of ['lobby','profile','clips']){
      const sec=document.createElement('section');sec.id='v3-'+id;sec.className='v3-page hidden';
      main.insertBefore(sec,$('#composer'));
    }
    const mhead=document.createElement('div');mhead.className='v3-members-head';
    mhead.innerHTML='<span>Amigos da galera</span><input id="v3-member-search" type="search" placeholder="Buscar membros…" aria-label="Buscar membros">';
    members.prepend(mhead);
    const mfoot=document.createElement('div');mfoot.id='v3-members-foot';members.append(mfoot);
    mhead.querySelector('input').addEventListener('input',e=>{V.search=e.target.value.toLowerCase();filterMembers();});
    new MutationObserver(filterMembers).observe($('#members-list'),{childList:true});
    const face=document.createElement('span');face.id='v3-brand-symbol';face.textContent='🎮';
    sidebar.querySelector('.server-head')?.prepend(face);
    // Somente o usuário C0kz validado pelo servidor ganha o badge de master no perfil.
    $$('.v3-link').forEach(b=>b.addEventListener('click',()=>show(b.dataset.v3View)));
    const mdock=document.createElement('div');mdock.id='v3-mobile-voice-dock';mdock.className='hidden';main.append(mdock);
    const mark=document.createElement('span');mark.id='v3-voice-status';
    sidebar.querySelector('#voice-panel')?.append(mark);
    show('chat');renderPromo();renderRight();
  }
  function filterMembers(){
    const list=$('#members-list');if(!list)return;
    [...list.querySelectorAll('.mem')].forEach(el=>el.style.display=el.textContent.toLowerCase().includes(V.search)?'':'none');
  }
  function renderMobileVoice(){
    const n=$('#v3-mobile-voice-dock');if(!n||!app)return;
    const current=app.state.voice;
    if(!current){n.classList.add('hidden');document.body.classList.remove('v3-in-voice');return;}
    document.body.classList.add('v3-in-voice');n.classList.remove('hidden');
    const users=app.state.users.filter(u=>u.voice===current);
    n.innerHTML=`<strong>🎙️ ${E(app.chById(current)?.name||'Em voz')}</strong><div class="v3-dock-faces">${users.slice(0,5).map(u=>photo(u.nick,'small')).join('')}</div><button id="v3-dock-mic" aria-label="Microfone">${app.state.muted?'🔇':'🎤'}</button><button id="v3-dock-leave" aria-label="Sair da voz">📞</button>`;
    $('#v3-dock-mic')?.addEventListener('click',()=>$('#btn-mic')?.click());
    $('#v3-dock-leave')?.addEventListener('click',()=>$('#btn-leave-voice')?.click());
  }
  function renderPromo(){
    const p=$('#v3-chat-promo');if(!p)return;
    const lobby=V.lobby;
    p.innerHTML=`<div class="v3-promo-badge">🎮</div><div class="v3-promo-copy"><strong>${lobby?'Bora jogar? · '+E(lobby.game):'Bora jogar?'}</strong><small>${lobby?`${lobby.players.length}/${lobby.capacity} na sala · ${lobby.players.filter(x=>x.ready).length} prontos`:'Monte uma partida e convide a rapaziada!'}</small></div><div class="v3-promo-faces">${(lobby?.players||[]).slice(0,5).map(p=>photo(p.nick,'tiny')).join('')}</div><button id="v3-promo-open" class="v3-btn v3-btn-glow">${lobby?'Abrir lobby':'Organizar partida'} →</button>`;
    $('#v3-promo-open').addEventListener('click',()=>show('lobby'));
  }
  function renderRight(){
    const box=$('#v3-members-foot');if(!box||!app)return;
    const online=app.state.users || [];
    const playing=online.filter(u=>V.profiles[key(u.nick)]?.activity==='jogando').length;
    const speaking=online.filter(u=>u.voice).length;
    box.innerHTML=`<div class="v3-right-line">🎮 <strong>Jogando agora</strong><span>${playing}</span></div><div class="v3-right-line">🎙️ <strong>Em voz</strong><span>${speaking}</span></div><div class="v3-right-line">🗓️ <strong>Próxima jogatina</strong></div>${V.agenda.length?V.agenda.slice(0,2).map(e=>`<div class="v3-compact-event"><b>${E(e.game)}</b><small>${shortTime(e.when)} · ${e.going.length} confirmados</small></div>`).join(''):'<p class="v3-muted">Ainda sem partidas agendadas.</p>'}`;
    filterMembers();
  }
  function renderLobby(){
    const n=$('#v3-lobby');if(!n)return;
    const liveStage=$("#stage");
    if(liveStage && n.contains(liveStage)) liveStage.remove();
    const l=V.lobby, users=app?.state.users||[], onVoice=users.filter(u=>u.voice);
    const meIn=l?.players.some(p=>key(p.nick)===key(myNick()));
    const isHost=l&&(key(l.host)===key(myNick())||app?.isOwner());
    const currentlyReady=l?.players.find(p=>key(p.nick)===key(myNick()))?.ready;
    n.innerHTML=`<div class="v3-hero"><div class="v3-hero-glyph">🎮</div><div><span class="v3-eyebrow">JOGATINA DOS AMIGOS · BY C0KZ</span><h1>Bora jogar?</h1><p>Escolhe o jogo, chama a rapaziada e fecha o time.</p></div><span class="v3-hero-crown">👑</span></div>
    <div class="v3-lobby-grid"><div class="v3-lobby-main">
      ${l?`<div class="v3-section-head"><div><span class="v3-eyebrow">LOBBY DA PARTIDA</span><h2>${E(l.game)} <small>· ${E(l.mode)}</small></h2></div><span class="v3-state">${l.players.filter(p=>p.ready).length}/${l.capacity} prontos</span></div>
      <div class="v3-party">${Array.from({length:l.capacity},(_,i)=>{const p=l.players[i];return `<article class="v3-player">${p?photo(p.nick,'large'):'<span class="v3-player-empty">＋</span>'}<b>${p?E(p.nick):'Convidar'}</b><small>${p?p.ready?'✓ Pronto':'Aguardando…':'Vaga livre'}</small></article>`}).join('')}</div>
      <div class="v3-actions">${!meIn?'<button class="v3-btn v3-btn-glow" data-action="join">＋ Entrar no lobby</button>':`<button class="v3-btn ${currentlyReady?'v3-btn-on':'v3-btn-glow'}" data-action="ready">${currentlyReady?'✓ Estou pronto':'Confirmar presença'}</button><button class="v3-btn" data-action="leave">Sair do lobby</button>`}${isHost?'<button class="v3-btn v3-btn-outline-red" data-action="close">Encerrar lobby</button>':''}<button class="v3-btn" data-action="invite">🔗 Convidar</button></div>`:
      `<div class="v3-section-head"><div><span class="v3-eyebrow">PRÓXIMA PARTIDA</span><h2>Criar novo lobby</h2></div><span class="v3-state">Disponível</span></div><form id="v3-create-lobby" class="v3-create-form"><label>Jogo<select name="game">${games.map(g=>`<option>${E(g)}</option>`).join('')}</select></label><label>Modo<select name="mode"><option>Casual</option><option>Competitivo</option><option>Personalizada</option></select></label><label>Vagas<select name="capacity">${[2,3,4,5,6,8,10].map(n=>`<option ${n===5?'selected':''}>${n}</option>`).join('')}</select></label><button type="submit" class="v3-btn v3-btn-glow">🎮 Criar lobby</button></form>`}
      <div class="v3-voice-card"><div class="v3-section-head"><h2>🎙️ Sala de voz</h2><span class="v3-state">${onVoice.length} em voz</span></div><div class="v3-party v3-party-small">${onVoice.length?onVoice.map(u=>`<div class="v3-voice-person" data-speak="${E(u.id)}">${photo(u.nick,'medium')}<b>${E(u.nick)}</b><small>${u.muted?'🔇 Mutado':'▂▅▇'}</small></div>`).join(''):'<p class="v3-muted">Entre num canal de voz para conversar com a galera.</p>'}</div><div class="v3-actions"><button id="v3-goto-voice" class="v3-btn">Ver canais de voz</button><button id="v3-mic" class="v3-btn">🎤 Microfone</button><button id="v3-share" class="v3-btn">📺 Compartilhar tela</button></div><div id="v3-share-host"></div></div>
    </div><aside class="v3-lobby-aside"><div class="v3-sidecard"><h3>👥 Amigos online</h3>${users.length?users.map(u=>`<div class="v3-friend">${photo(u.nick,'small')}<span><b>${E(u.nick)}${symbol(u.nick)}</b><small>${E(actName[V.profiles[key(u.nick)]?.activity]||'Online')}</small></span>${l&&key(u.nick)!==key(myNick())?`<button class="v3-btn v3-btn-tiny" data-invite-id="${E(u.id)}">＋</button>`:''}</div>`).join(''):'<p class="v3-muted">Ninguém conectado.</p>'}</div>
    <div class="v3-sidecard"><div class="v3-section-head"><h3>🗓️ Agenda da galera</h3>${app?.isOwner()?'<button id="v3-new-event" class="v3-btn v3-btn-tiny">＋</button>':''}</div>${V.agenda.length?V.agenda.slice(-5).reverse().map(e=>`<div class="v3-event"><b>${E(e.game)}</b><small>${shortTime(e.when)} · ${E(e.title)}</small><button class="v3-btn v3-btn-tiny" data-event="${E(e.id)}">${e.going.some(n=>key(n)===key(myNick()))?'✓ Confirmado':'Confirmar'}</button></div>`).join(''):'<p class="v3-muted">Sem eventos agendados.</p>'}</div></aside></div>`;
    $('#v3-create-lobby')?.addEventListener('submit',ev=>{ev.preventDefault();const f=new FormData(ev.currentTarget);send('lobby:create',{game:f.get('game'),mode:f.get('mode'),capacity:Number(f.get('capacity'))});});
    n.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',async()=>{
      const action=b.dataset.action;if(action==='invite'){try{await navigator.clipboard.writeText(location.origin);notify('Link da Jogatina copiado!');}catch{notify('Copie o endereço do navegador.');}return;}
      if(action==='close'&&!confirm('Encerrar o lobby para todos?'))return;
      send('lobby:'+action);
    }));
    n.querySelectorAll('[data-event]').forEach(b=>b.addEventListener('click',()=>send('agenda:rsvp',{id:b.dataset.event})));
    n.querySelectorAll('[data-invite-id]').forEach(b=>b.addEventListener('click',()=>send('invite',{targetId:b.dataset.inviteId})));
    $('#v3-new-event')?.addEventListener('click',()=>{const game=prompt('Jogo (Valorant, CS2, etc.):','Valorant');if(!game)return;const when=prompt('Data e hora (ex: 2026-11-06T21:00):');if(!when)return;const label=prompt('Nome da jogatina:','Ranked com a galera');const date=new Date(when);if(Number.isNaN(date.getTime()))return notify('Data inválida. Use AAAA-MM-DDTHH:MM.');send('agenda:add',{game,when:date.toISOString(),title:label});});
    $('#v3-goto-voice')?.addEventListener('click',()=>{show('chat');$('#sidebar')?.classList.add('open');});
    $('#v3-mic')?.addEventListener('click',()=>$('#btn-mic')?.click());
    $('#v3-share')?.addEventListener('click',()=>$('#btn-screen')?.click());
    if(V.view==='lobby' && liveStage)$('#v3-share-host')?.append(liveStage);
  }
  function renderProfile(){
    const n=$('#v3-profile');if(!n||!app)return;
    const me=app.me();if(!me)return;
    const base={avatar:'',bio:'',games:[],activity:'online',banner:'nebula',...myProfile()};
    if(!V.draft||V.draftNick!==key(myNick())){V.draft={...base,games:[...base.games]};V.draftNick=key(myNick());}
    const p=V.draft;
    n.innerHTML=`<div class="v3-page-heading"><span class="v3-eyebrow">SEU ESPAÇO NA JOGATINA</span><h1>Meu perfil & personalização</h1><p>Foto, banner, status, jogos favoritos e identidade gamer.</p></div>
    <div class="v3-profile-banner ${bannerBg(p.banner)}"><div class="v3-banner-logo">🎮 <strong>JOGATINA</strong><small>BY C0KZ</small></div><span>Seu universo. Sua galera.</span></div>
    <div class="v3-profile-card"><div class="v3-profile-main">${p.avatar?`<span class="v3-face giant"><img src="${E(p.avatar)}" alt="Foto de perfil"></span>`:photo(myNick(),'giant')}<div><h2>${E(myNick())} ${app.isOwner()?'👑 <span class="v3-owner">DONO</span>':''}</h2><p class="v3-muted">${app.isOwner()?'Administrador master':'Membro da Jogatina'}</p></div></div>
    <div class="v3-profile-setup"><label class="v3-btn v3-upload">📸 Enviar foto<input id="v3-avatar-upload" type="file" accept="image/jpeg,image/png,image/webp" hidden></label><label>Banner<select id="v3-banner"><option value="nebula" ${p.banner==='nebula'?'selected':''}>Nebulosa neon</option><option value="arena" ${p.banner==='arena'?'selected':''}>Arena gamer</option><option value="night" ${p.banner==='night'?'selected':''}>Noite cyber</option></select></label></div></div>
    <div class="v3-profile-grid"><div class="v3-sidecard"><h3>🎮 Jogos favoritos</h3><div class="v3-pills">${games.map(g=>`<button class="v3-game-chip ${p.games.includes(g)?'selected':''}" data-game="${E(g)}">${E(g)}</button>`).join('')}</div><label>Sobre mim<textarea id="v3-bio" maxlength="180" placeholder="Conta um pouco sobre você…">${E(p.bio)}</textarea></label></div>
    <div class="v3-sidecard"><h3>🟢 Status rápido</h3><div class="v3-status-options">${Object.keys(actName).map(k=>`<button class="v3-status-btn ${p.activity===k?'selected':''}" data-activity="${k}"><span>●</span>${actName[k]}</button>`).join('')}</div><p class="v3-muted">Seu status aparece na lista de membros.</p></div>
    <div class="v3-sidecard"><h3>⚙️ Configurações</h3><p class="v3-muted">As configurações de voz existentes continuam funcionando.</p><button id="v3-open-audio" class="v3-btn">🎙️ Áudio e microfone</button><button id="v3-open-look" class="v3-btn">🎨 Tema e aparência</button><button id="v3-open-notifs" class="v3-btn">🔔 Notificações</button></div></div>
    <div class="v3-achievements"><div class="v3-section-head"><h3>🏆 Conquistas da galera</h3><small>Conquistas simples, sem pontuações inventadas</small></div><div class="v3-achievement-grid">${[
      ['🎮','Membro da galera',true],['👑','Dono da Jogatina',app.isOwner()],
      ['✅','Na party',!!V.lobby?.players.some(x=>key(x.nick)===key(myNick()))],
      ['🎬','Primeiro clipe',V.clips.some(c=>key(c.by)===key(myNick()))]
    ].map(([symbol,label,unlocked])=>`<div class="v3-achievement ${unlocked?'unlocked':'locked'}"><span>${symbol}</span><b>${label}</b><small>${unlocked?'Desbloqueada':'Bloqueada'}</small></div>`).join('')}</div></div>
    <div class="v3-profile-save"><span>Sem cadastro geral; o nick C0kz continua protegido por senha.</span><button id="v3-save-profile" class="v3-btn v3-btn-glow">✓ Salvar perfil</button></div>`;
    n.querySelectorAll('[data-game]').forEach(b=>b.addEventListener('click',()=>{const g=b.dataset.game; p.games=p.games.includes(g)?p.games.filter(x=>x!==g):[...p.games,g].slice(0,5);const bio=$('#v3-bio')?.value;p.bio=bio||'';renderProfile();}));
    n.querySelectorAll('[data-activity]').forEach(b=>b.addEventListener('click',()=>{p.bio=$('#v3-bio')?.value||'';p.activity=b.dataset.activity;renderProfile();}));
    $('#v3-banner')?.addEventListener('change',e=>{p.bio=$('#v3-bio')?.value||'';p.banner=e.target.value;renderProfile();});
    $('#v3-avatar-upload')?.addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;
      try{p.bio=$('#v3-bio')?.value||'';p.avatar=await avatarData(file);renderProfile();}
      catch(err){notify('Imagem não carregada: '+err.message);}
    });
    $('#v3-open-audio')?.addEventListener('click',()=>app.openSettings('voice'));
    $('#v3-open-look')?.addEventListener('click',()=>app.openSettings('look'));
    $('#v3-open-notifs')?.addEventListener('click',()=>app.openSettings('notif'));
    $('#v3-save-profile')?.addEventListener('click',()=>{p.bio=$('#v3-bio')?.value.trim().slice(0,180)||'';send('profile:update',p);notify('Salvando perfil…');});
  }
  async function avatarData(file) {
    if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('Use PNG, JPG ou WebP.');
    if(file.size>3*1024*1024)throw new Error('Imagem muito grande (máximo 3 MB).');
    const bmp=await createImageBitmap(file);
    const c=document.createElement('canvas');c.width=c.height=160;const g=c.getContext('2d');
    const side=Math.min(bmp.width,bmp.height);g.drawImage(bmp,(bmp.width-side)/2,(bmp.height-side)/2,side,side,0,0,160,160);bmp.close?.();
    const data=c.toDataURL('image/webp',.76);
    if(data.length>130000)throw new Error('Foto ultrapassou o limite de 130 KB após processamento.');
    return data;
  }
  function renderClips(){
    const n=$('#v3-clips');if(!n)return;
    n.innerHTML=`<div class="v3-page-heading"><span class="v3-eyebrow">MELHORES MOMENTOS</span><h1>Clipes da rapaziada</h1><p>Compartilhe links de jogadas, highlights e vídeos memoráveis.</p><button id="v3-add-clip" class="v3-btn v3-btn-glow">＋ Adicionar clipe</button></div><div class="v3-clips-grid">${V.clips.length?V.clips.slice().reverse().map(c=>`<article class="v3-clip"><div class="v3-clip-icon">▶</div><h3>${E(c.title)}</h3><small>Por ${E(c.by)} · ${shortTime(c.ts)}</small><a href="${E(c.url)}" target="_blank" rel="noopener noreferrer" class="v3-btn">Abrir clipe ↗</a></article>`).join(''):'<p class="v3-muted">Ainda sem clipes. Manda o primeiro highlight!</p>'}</div>`;
    $('#v3-add-clip')?.addEventListener('click',()=>{const url=prompt('Cole o link HTTPS do clipe:');if(!url)return;const title=prompt('Título do clipe:','Melhor jogada da noite');send('clip:add',{url,title});});
  }
  window.JogatinaV3Bind = socket => {
    socket.on('v3:data', d => {
      V.profiles=d.profiles||{};V.lobby=d.lobby||null;V.clips=d.clips||[];V.agenda=d.agenda||[];
      if(app){app.state.v3Profiles=V.profiles;app.renderAll();renderPromo();renderRight();if(V.view==='lobby')renderLobby();if(V.view==='profile'){V.draft=null;renderProfile();}if(V.view==='clips')renderClips();}
    });
    socket.on('v3:profiles', p => {V.profiles=p||{};if(app){app.state.v3Profiles=V.profiles;app.renderAll();renderRight();if(V.view==='lobby')renderLobby();if(V.view==='profile'){V.draft=null;renderProfile();}}});
    socket.on('v3:lobby', l => {V.lobby=l;renderPromo();renderRight();if(V.view==='lobby')renderLobby();});
    socket.on('v3:agenda', a => {V.agenda=a||[];renderRight();if(V.view==='lobby')renderLobby();});
    socket.on('v3:clips', c => {V.clips=c||[];if(V.view==='clips')renderClips();});
    socket.on('v3:invite', ({from,game})=>{if(confirm(`${from} te convidou para jogar ${game}. Entrar no lobby?`)){show('lobby');send('lobby:join');}});
    socket.on('v3:toast', message=>notify(message));
    socket.on('v3:error', message => app?.toast(message,'error'));
  };
  window.JogatinaV3AfterInit = () => {send('get');if(!$('#v3-topnav'))install();};
  window.JogatinaV3Refresh = () => {renderRight();renderMobileVoice(); if(V.view==='lobby')renderLobby();};
  window.JogatinaV3Init = ctx => {app=ctx;ctx.state.v3Profiles={};window.addEventListener('DOMContentLoaded',install);};
})();