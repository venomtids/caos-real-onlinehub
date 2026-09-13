/* ============================================================
   CAOS REAL — camada ONLINE P2P (GitHub Pages)
   Sem servidor proprio: os navegadores conversam direto por
   WebRTC (PeerJS). Quem CRIA a sala vira o anfitriao e roda a
   logica da sala dentro do proprio navegador.
   O codigo de 4 letras vira o endereco do anfitriao.
   ============================================================ */
(function(){
'use strict';

const $$ = id => document.getElementById(id);

/* ---------------- estado ---------------- */
let peer=null, meuId=null, salaAtual=null, souHost=false, meuSlot=0;
let jogadoresSala=[], modoOnline=false, conectando=false;
let conHost=null;            // convidado -> conexao com o anfitriao
let conexoes=new Map();      // anfitriao -> id do jogador => conexao
let salaLocal=null;          // anfitriao -> os dados da sala
let tentativasCod=0;

const PREFIXO='caosreal2026-';
const LETRAS='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // sem I,O,0,1
const LIMITE_SALA=8, LIMITE_CHAT=60, MSG_MAX=300;

function novoCodigo(){
  let c=''; for(let i=0;i<4;i++) c+=LETRAS[Math.floor(Math.random()*LETRAS.length)];
  return c;
}
function novoId(){ return 'j'+Math.random().toString(36).slice(2,10) }

/* ---------------- carregar o PeerJS sob demanda ---------------- */
let peerjsPronto=null;
function carregarPeerJS(){
  if(peerjsPronto) return peerjsPronto;
  peerjsPronto=new Promise((ok,falha)=>{
    if(window.Peer) return ok();
    const s=document.createElement('script');
    s.src='https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
    s.onload=()=>ok();
    s.onerror=()=>falha(new Error('nao consegui carregar o PeerJS'));
    document.head.appendChild(s);
  });
  return peerjsPronto;
}

/* ---------------- criar / entrar ---------------- */
function criarSala(nome,heroi){
  conectando=true;
  statusRede('abrindo a sala…','#f9c74f');
  carregarPeerJS().then(()=>{
    tentativasCod=0;
    tentarAbrir(nome,heroi);
  }).catch(e=>{
    conectando=false;
    statusRede('sem conexao','#fe5f55');
    mostrarErro('Não consegui carregar a rede. Verifique sua internet.');
  });
}
function tentarAbrir(nome,heroi){
  const cod=novoCodigo();
  if(peer){ try{ peer.destroy() }catch(e){} }
  peer=new window.Peer(PREFIXO+cod,{debug:0});

  peer.on('open',()=>{
    conectando=false; souHost=true; salaAtual=cod; meuId=novoId();
    salaLocal={ codigo:cod, jogadores:new Map(), chat:[], host:meuId, jogo:false };
    salaLocal.jogadores.set(meuId,{ id:meuId, nome, heroi, slot:1, pronto:false, host:true });
    jogadoresSala=listaJogadores();
    meuSlot=1;
    statusRede('sala aberta','#3ddc97');
    abrirSala();
    sistemaChat('Você abriu a sala '+cod+'. Mande o código pro seu amigo!');
    sistemaChat('⚠ Mantenha esta aba aberta — a sala vive aqui.');
    renderJogadores();
  });

  peer.on('connection',con=>{ ligarConexaoDoConvidado(con) });

  peer.on('error',err=>{
    if(err && err.type==='unavailable-id'){
      // codigo ja em uso: sorteia outro
      if(++tentativasCod<8) return tentarAbrir(nome,heroi);
    }
    conectando=false;
    statusRede('erro','#fe5f55');
    mostrarErro('Não consegui abrir a sala. Tente de novo.');
  });
}

function entrarNaSala(cod,nome,heroi){
  conectando=true;
  statusRede('procurando a sala…','#f9c74f');
  carregarPeerJS().then(()=>{
    if(peer){ try{ peer.destroy() }catch(e){} }
    peer=new window.Peer({debug:0});
    peer.on('open',()=>{
      const con=peer.connect(PREFIXO+cod,{reliable:true});
      let respondeu=false;

      const prazo=setTimeout(()=>{
        if(!respondeu){
          conectando=false;
          statusRede('sala nao encontrada','#fe5f55');
          mostrarErro('Sala não encontrada. Confira o código — e veja se o anfitrião ainda está com a aba aberta.');
          try{ con.close() }catch(e){}
        }
      },12000);

      con.on('open',()=>{
        respondeu=true; clearTimeout(prazo);
        conectando=false; souHost=false; conHost=con;
        statusRede('conectado','#3ddc97');
        con.send({tipo:'entrar', nome, heroi});
      });
      con.on('data',m=>receber(m));
      con.on('close',()=>{
        if(modoOnline) encerrarPorQuedaDoHost();
        else statusRede('desconectado','#fe5f55');
      });
      // rede WebRTC as vezes demora a avisar: vigiamos o canal
      const vigia=setInterval(()=>{
        if(!modoOnline || souHost) return clearInterval(vigia);
        if(conHost && !conHost.open){ clearInterval(vigia); encerrarPorQuedaDoHost() }
      },2000);
      con.on('error',()=>{
        clearTimeout(prazo);
        conectando=false;
        mostrarErro('Não consegui falar com a sala.');
      });
    });
    peer.on('error',err=>{
      conectando=false;
      if(err && (err.type==='peer-unavailable')){
        statusRede('sala nao encontrada','#fe5f55');
        mostrarErro('Sala não encontrada. Confira o código.');
      }else{
        statusRede('erro','#fe5f55');
        mostrarErro('Problema de rede. Tente de novo.');
      }
    });
  }).catch(()=>{
    conectando=false;
    mostrarErro('Não consegui carregar a rede. Verifique sua internet.');
  });
}

/* ---------------- envio ---------------- */
function env(tipo,dados){
  const m={tipo,...dados};
  if(souHost) tratarNoHost(meuId,m);            // o anfitriao processa direto
  else if(conHost && conHost.open) conHost.send(m);
}
function statusRede(txt,cor){
  const e=$$('netStatus'); if(!e) return;
  e.textContent='● '+txt; e.style.color=cor||'#8fb0c4';
}

/* ============================================================
   LADO ANFITRIAO — a logica da sala roda aqui no navegador
   ============================================================ */
function listaJogadores(){
  if(!salaLocal) return [];
  return [...salaLocal.jogadores.values()].map(j=>({
    id:j.id, nome:j.nome, slot:j.slot, pronto:j.pronto, host:j.host, heroi:j.heroi
  }));
}
function slotsLivres(){
  const usados=new Set([...salaLocal.jogadores.values()].map(j=>j.slot));
  if(!usados.has(1)) return 1;
  if(!usados.has(2)) return 2;
  return 0;                                    // 0 = espectador
}
function paraTodos(tipo,dados,exceto){
  const m={tipo,...dados};
  if(meuId!==exceto) receber(m);               // o proprio anfitriao tambem ve
  conexoes.forEach((con,id)=>{
    if(id!==exceto && con.open){ try{ con.send(m) }catch(e){} }
  });
}
function paraUm(id,tipo,dados){
  if(id===meuId) return receber({tipo,...dados});
  const con=conexoes.get(id);
  if(con && con.open){ try{ con.send({tipo,...dados}) }catch(e){} }
}
function sincronizar(){
  paraTodos('sala',{codigo:salaLocal.codigo, jogadores:listaJogadores(), host:salaLocal.host});
}

function ligarConexaoDoConvidado(con){
  let idDele=null;
  con.on('data',m=>{
    if(!m || typeof m!=='object') return;
    if(m.tipo==='entrar' && !idDele){
      if(!salaLocal || salaLocal.jogadores.size>=LIMITE_SALA){
        try{ con.send({tipo:'erro',msg:'A sala está cheia.'}) }catch(e){}
        return;
      }
      idDele=novoId();
      conexoes.set(idDele,con);
      salaLocal.jogadores.set(idDele,{
        id:idDele, nome:String(m.nome||'ANÔNIMO').slice(0,18),
        heroi:String(m.heroi||'comedia').slice(0,24),
        slot:slotsLivres(), pronto:false, host:false
      });
      const j=salaLocal.jogadores.get(idDele);
      try{ con.send({tipo:'entrou', codigo:salaLocal.codigo, id:idDele,
        jogadores:listaJogadores(), chat:salaLocal.chat, host:salaLocal.host,
        jogo:salaLocal.jogo}) }catch(e){}
      paraTodos('sistema',{texto:j.nome+' entrou na sala.'},idDele);
      sincronizar();
      return;
    }
    if(idDele) tratarNoHost(idDele,m);
  });
  con.on('close',()=>{
    if(!idDele || !salaLocal) return;
    const j=salaLocal.jogadores.get(idDele);
    conexoes.delete(idDele);
    salaLocal.jogadores.delete(idDele);
    if(j){
      paraTodos('sistema',{texto:j.nome+' saiu da sala.'});
      if(salaLocal.jogo && j.slot){
        salaLocal.jogo=false;
        paraTodos('abandono',{nome:j.nome});
      }
    }
    sincronizar();
  });
  con.on('error',()=>{});
}

function tratarNoHost(id,m){
  if(!salaLocal) return;
  const j=salaLocal.jogadores.get(id);
  if(!j) return;

  switch(m.tipo){
    case 'chat': {
      const agora=Date.now();
      j.credito = Math.min(4,(j.credito===undefined?4:j.credito)+(agora-(j.ultimaMsg||0))/500);
      j.ultimaMsg=agora;
      if(j.credito<1){ paraUm(id,'sistema',{texto:'Calma — você está escrevendo rápido demais.'}); return }
      j.credito-=1;
      const texto=String(m.texto||'').slice(0,MSG_MAX).trim();
      if(!texto) return;
      const msg={de:j.nome, id, texto, hora:agora, slot:j.slot};
      salaLocal.chat.push(msg);
      if(salaLocal.chat.length>LIMITE_CHAT) salaLocal.chat.shift();
      paraTodos('chat',{msg});
      break;
    }
    case 'emote':
      paraTodos('emote',{de:j.nome, emote:String(m.emote||'').slice(0,4), slot:j.slot});
      break;

    case 'pronto': {
      j.pronto=!!m.pronto;
      if(m.heroi) j.heroi=String(m.heroi).slice(0,24);
      sincronizar();
      const jogam=[...salaLocal.jogadores.values()].filter(x=>x.slot);
      if(jogam.length===2 && jogam.every(x=>x.pronto) && !salaLocal.jogo){
        salaLocal.jogo=true;
        const semente=Math.floor(Math.random()*1e9);
        paraTodos('comecar',{semente, jogadores:listaJogadores()});
      }
      break;
    }
    case 'jogada':
      if(!j.slot) return;
      paraTodos('jogada',{de:j.nome, slot:j.slot, dados:m.dados},id);
      break;

    case 'estado':
      if(id!==salaLocal.host) return;          // so o anfitriao dita o estado
      paraTodos('estado',{dados:m.dados},id);
      break;

    case 'fim':
      salaLocal.jogo=false;
      paraTodos('fim',{dados:m.dados});
      break;

    case 'sair': {
      if(id===meuId) return;                   // o anfitriao sai por outro caminho
      const con=conexoes.get(id);
      conexoes.delete(id);
      salaLocal.jogadores.delete(id);
      paraTodos('sistema',{texto:j.nome+' saiu da sala.'});
      sincronizar();
      try{ con && con.close() }catch(e){}
      break;
    }
  }
}

/* ---------------- recepcao (igual dos dois lados) ---------------- */
function receber(m){
  switch(m.tipo){
    case 'entrou':
      salaAtual=m.codigo; meuId=m.id; souHost=(m.host===m.id);
      jogadoresSala=m.jogadores||[];
      meuSlot=(jogadoresSala.find(j=>j.id===meuId)||{}).slot||0;
      abrirSala();
      (m.chat||[]).forEach(c=>addChat(c,true));
      renderJogadores();
      sistemaChat('Você entrou na sala '+m.codigo+'.');
      break;

    case 'sala':
      jogadoresSala=m.jogadores||[];
      souHost=(m.host===meuId);
      meuSlot=(jogadoresSala.find(j=>j.id===meuId)||{}).slot||0;
      renderJogadores();
      break;

    case 'chat':    addChat(m.msg); break;
    case 'sistema': sistemaChat(m.texto); break;
    case 'erro':    mostrarErro(m.msg); break;

    case 'emote':
      sistemaChat(`${m.de} ${m.emote}`);
      flutuarEmote(m.emote);
      break;

    case 'comecar':
      jogadoresSala=m.jogadores||jogadoresSala;
      meuSlot=(jogadoresSala.find(j=>j.id===meuId)||{}).slot||0;
      iniciarPartidaOnline(m.semente);
      break;

    case 'jogada': aplicarJogadaRemota(m); break;
    case 'estado': aplicarEstadoRemoto(m.dados); break;

    case 'abandono':
      sistemaChat('⚠ '+m.nome+' abandonou a partida. Voltando ao lobby.');
      if(window.banner) banner('ABANDONO','#fe5f55');
      voltarAoLobby();
      break;

    case 'fim':
      sistemaChat('A partida terminou.');
      break;

    case 'salaMorreu':
      encerrarPorQuedaDoHost();
      break;
  }
}

let jaEncerrou=false;
function encerrarPorQuedaDoHost(){
  if(jaEncerrou || souHost) return;
  jaEncerrou=true;
  statusRede('sala encerrada','#fe5f55');
  sistemaChat('⚠ O anfitrião saiu — a sala acabou.');
  if(window.banner) banner('SALA ENCERRADA','#fe5f55');
  emPartidaOnline=false; desligarRng();
  const p=$$('salaPainel'); if(p) p.classList.add('aberto');
  setTimeout(()=>{ abrirLobby() },2000);
}

/* ---------------- interface: lobby ---------------- */
function criarInterface(){
  const el=document.createElement('div');
  el.id='onlineWrap';
  el.innerHTML=`
  <div id="lobbyOv">
    <div class="lobbyBox">
      <div class="lobbyLogo">CAOS<span>REAL</span></div>
      <div class="lobbySub">jogue com seus amigos · salas privadas · chat</div>

      <div class="lobbyCampo">
        <label>SEU NOME</label>
        <input id="lbNome" maxlength="18" placeholder="como querem te chamar?" autocomplete="off">
      </div>

      <div class="lobbyBotoes">
        <button class="lbBtn solo" id="lbSolo">🎮 JOGAR SOZINHO<small>contra o computador</small></button>
        <button class="lbBtn criar" id="lbCriar">🚪 CRIAR SALA<small>você recebe um código</small></button>
      </div>

      <div class="lobbyOu">— ou entre numa sala —</div>
      <div class="lobbyCampo cod">
        <input id="lbCodigo" maxlength="4" placeholder="CÓDIGO" autocomplete="off">
        <button class="lbBtn entrar" id="lbEntrar">ENTRAR</button>
      </div>
      <div class="lobbyErro" id="lbErro"></div>
      <div class="lobbyPe"><span id="netStatus">● offline</span></div>
    </div>
  </div>

  <div id="salaPainel">
    <div class="spTopo">
      <div class="spCod">SALA <b id="spCodigo">----</b>
        <button class="spCopiar" id="spCopiar" title="copiar código">📋</button></div>
      <button class="spSair" id="spSair">SAIR</button>
    </div>
    <div class="spJogadores" id="spJogadores"></div>
    <div class="spAcao" id="spAcao"></div>
    <div class="spChatTitulo">💬 CHAT DA SALA</div>
    <div class="spChat" id="spChat"></div>
    <div class="spEmotes">
      <button data-e="😂">😂</button><button data-e="😱">😱</button>
      <button data-e="🔥">🔥</button><button data-e="💀">💀</button>
      <button data-e="👏">👏</button><button data-e="🤡">🤡</button>
    </div>
    <div class="spEntrada">
      <input id="spTexto" maxlength="300" placeholder="escreva algo…" autocomplete="off">
      <button id="spEnviar">▶</button>
    </div>
  </div>

  <button id="chatToggle" title="abrir/fechar o chat">💬<span id="chatBadge"></span></button>
  `;
  document.body.appendChild(el);
  ligarEventos();
}

function ligarEventos(){
  $$('lbSolo').onclick=()=>{
    modoOnline=false;
    fecharLobby();
    if(window.S) S.click();
  };
  $$('lbCriar').onclick=()=>{
    if(conectando) return;
    modoOnline=true;
    const nome=($$('lbNome').value||'').trim()||'ANÔNIMO';
    localStorage.setItem('caosreal.nome',nome);
    criarSala(nome,(window.hero&&hero.id)||'comedia');
  };
  $$('lbEntrar').onclick=entrarSala;
  $$('lbCodigo').addEventListener('keydown',e=>{ if(e.key==='Enter') entrarSala() });
  $$('lbCodigo').addEventListener('input',e=>{
    e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4);
  });
  $$('lbNome').addEventListener('keydown',e=>{ if(e.key==='Enter') $$('lbCriar').click() });

  $$('spSair').onclick=()=>{
    if(souHost){
      conexoes.forEach(c=>{ try{ c.send({tipo:'sistema',texto:'O anfitrião encerrou a sala.'}); c.close() }catch(e){} });
      conexoes.clear(); salaLocal=null;
    }else{
      env('sair',{});
      try{ conHost && conHost.close() }catch(e){}
    }
    try{ peer && peer.destroy() }catch(e){}
    peer=null; conHost=null; souHost=false;
    modoOnline=false; salaAtual=null; emPartidaOnline=false;
    desligarRng();
    statusRede('offline','#8fb0c4');
    $$('salaPainel').classList.remove('aberto');
    $$('chatToggle').style.display='none';
    abrirLobby();
  };
  $$('spCopiar').onclick=()=>{
    const t=location.origin+location.pathname+'?sala='+salaAtual;
    navigator.clipboard?.writeText(t).then(()=>{
      sistemaChat('Link da sala copiado! Mande pro seu amigo.');
    }).catch(()=>{ sistemaChat('Código da sala: '+salaAtual) });
  };
  $$('spEnviar').onclick=enviarChat;
  $$('spTexto').addEventListener('keydown',e=>{
    if(e.key==='Enter'){ e.preventDefault(); enviarChat() }
    e.stopPropagation();
  });
  $$('spTexto').addEventListener('keyup',e=>e.stopPropagation());
  document.querySelectorAll('.spEmotes button').forEach(b=>{
    b.onclick=()=>env('emote',{emote:b.dataset.e});
  });
  $$('chatToggle').onclick=()=>{
    const p=$$('salaPainel');
    p.classList.toggle('aberto');
    if(p.classList.contains('aberto')){ naoLidas=0; atualizarBadge() }
  };

  const salvo=localStorage.getItem('caosreal.nome');
  if(salvo) $$('lbNome').value=salvo;
  const url=new URLSearchParams(location.search).get('sala');
  if(url){ $$('lbCodigo').value=url.toUpperCase().slice(0,4) }
}

function entrarSala(){
  if(conectando) return;
  const cod=($$('lbCodigo').value||'').toUpperCase().trim();
  if(cod.length!==4){ mostrarErro('O código tem 4 letras.'); return }
  modoOnline=true;
  const nome=($$('lbNome').value||'').trim()||'ANÔNIMO';
  localStorage.setItem('caosreal.nome',nome);
  entrarNaSala(cod,nome,(window.hero&&hero.id)||'comedia');
}
function mostrarErro(msg){
  const e=$$('lbErro'); if(!e) return;
  e.textContent=msg; e.classList.add('on');
  setTimeout(()=>e.classList.remove('on'),4500);
}
function abrirLobby(){ $$('lobbyOv').style.display='flex' }
function fecharLobby(){ $$('lobbyOv').style.display='none' }
function abrirSala(){
  fecharLobby();
  $$('spCodigo').textContent=salaAtual;
  $$('salaPainel').classList.add('aberto');
  $$('chatToggle').style.display='flex';
}
function voltarAoLobby(){
  desligarRng();
  emPartidaOnline=false;
  const p=$$('salaPainel'); if(p) p.classList.add('aberto');
}

/* ---------------- jogadores e prontidao ---------------- */
function renderJogadores(){
  const box=$$('spJogadores'); if(!box) return;
  box.innerHTML='';
  jogadoresSala.forEach(j=>{
    const d=document.createElement('div');
    d.className='spJog'+(j.slot?' joga':' assiste')+(j.id===meuId?' eu':'');
    const tag=j.slot?('J'+j.slot):'👁';
    d.innerHTML=`<span class="sjTag">${tag}</span>
      <span class="sjNome">${esc(j.nome)}${j.host?' 👑':''}</span>
      <span class="sjPronto">${j.slot?(j.pronto?'✔ pronto':'aguardando'):'assistindo'}</span>`;
    box.appendChild(d);
  });
  renderAcao();
}
function renderAcao(){
  const box=$$('spAcao'); if(!box) return;
  const jogam=jogadoresSala.filter(j=>j.slot);
  const eu=jogadoresSala.find(j=>j.id===meuId)||{};
  box.innerHTML='';
  if(!meuSlot){
    box.innerHTML='<div class="spAviso">👁 você está assistindo — a sala já tem 2 jogadores</div>';
    return;
  }
  if(jogam.length<2){
    box.innerHTML='<div class="spAviso">aguardando mais um jogador… mande o código!</div>';
    return;
  }
  const b=document.createElement('button');
  b.className='spPronto'+(eu.pronto?' on':'');
  b.textContent=eu.pronto?'✔ PRONTO (clique pra cancelar)':'ESTOU PRONTO';
  b.onclick=()=>env('pronto',{pronto:!eu.pronto, heroi:(window.hero&&hero.id)||'comedia'});
  box.appendChild(b);
}

/* ---------------- chat ---------------- */
let naoLidas=0;
function esc(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])) }
function addChat(msg,silencioso){
  const box=$$('spChat'); if(!box) return;
  const d=document.createElement('div');
  const meu = msg.id===meuId;
  d.className='chMsg'+(meu?' meu':'');
  const h=new Date(msg.hora||Date.now());
  const hh=String(h.getHours()).padStart(2,'0')+':'+String(h.getMinutes()).padStart(2,'0');
  d.innerHTML=`<span class="chDe">${esc(msg.de)}</span>
    <span class="chTx">${esc(msg.texto)}</span><span class="chH">${hh}</span>`;
  box.appendChild(d);
  box.scrollTop=box.scrollHeight;
  while(box.children.length>80) box.removeChild(box.firstChild);
  if(!silencioso && !meu){
    if(!$$('salaPainel').classList.contains('aberto')){ naoLidas++; atualizarBadge() }
    try{ if(window.S&&S.beep) S.beep() }catch(e){}
  }
}
function sistemaChat(txt){
  const box=$$('spChat'); if(!box) return;
  const d=document.createElement('div');
  d.className='chSis'; d.textContent=txt;
  box.appendChild(d); box.scrollTop=box.scrollHeight;
}
function atualizarBadge(){
  const b=$$('chatBadge'); if(!b) return;
  b.textContent=naoLidas||'';
  b.style.display=naoLidas?'flex':'none';
}
function enviarChat(){
  const i=$$('spTexto'); const t=(i.value||'').trim();
  if(!t) return;
  env('chat',{texto:t}); i.value='';
}
function flutuarEmote(e){
  const d=document.createElement('div');
  d.className='emoteFlut'; d.textContent=e;
  d.style.left=(15+Math.random()*70)+'%';
  document.body.appendChild(d);
  setTimeout(()=>d.remove(),2400);
}

/* ============================================================
   MULTIPLAYER — o anfitriao simula, o convidado acompanha
   ============================================================ */
let emPartidaOnline=false;

const randomOriginal = Math.random;
let rngLigado=false;
function ligarRng(semente){
  let x = 0;
  const str = String(semente||'caos');
  for(let i=0;i<str.length;i++) x = (x*31 + str.charCodeAt(i))>>>0;
  if(!x) x = 0x9e3779b9;
  Math.random = function(){        // mulberry32
    x |= 0; x = (x + 0x6D2B79F5) | 0;
    let t = Math.imul(x ^ (x >>> 15), 1 | x);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rngLigado=true;
}
function desligarRng(){ if(rngLigado){ Math.random = randomOriginal; rngLigado=false } }

function iniciarPartidaOnline(semente){
  emPartidaOnline=true;
  $$('salaPainel').classList.remove('aberto');
  sistemaChat('🎮 A partida começou!');
  try{
    if(window.S) S.fanfare();
    window.mode=2;
    ligarRng(semente);
    if(typeof startNewRun==='function'){
      window.__semente=semente;
      startNewRun();
    }
    if(typeof log==='function'){
      const outro=jogadoresSala.find(j=>j.slot&&j.id!==meuId)||{};
      log('🌐 <b>PARTIDA ONLINE</b> — você é o <b>JOGADOR '+meuSlot+'</b>.');
      log('⚔ adversário: <b>'+esc(outro.nome||'?')+'</b>. Use o 💬 para conversar.');
    }
  }catch(e){ console.error(e) }
  atualizarIndicadorTurno();
}

/* ---------- no online nao existe "passe o dispositivo" ----------
   O jogo 2P original poe um botao JOG. 2, ESTOU PRONTO para destravar
   o busy. Como cada um esta na sua maquina, removemos esse botao e
   destravamos sozinho assim que a carta do outro chega.            */
function destravarPasseDeVez(){
  if(!emPartidaOnline) return;
  const mao=document.getElementById('hand');
  if(!mao) return;
  const b=mao.querySelector('button.big.b2');
  if(!b) return;
  const lbl=document.getElementById('handlbl');
  b.remove();
  const outro=jogadoresSala.find(j=>j.slot&&j.id!==meuId)||{};
  if(window.turn===meuSlot){
    try{ window.busy=false; if(typeof renderTurn==='function') renderTurn() }catch(e){}
  }else{
    if(lbl) lbl.textContent='AGUARDANDO '+((outro.nome||'ADVERSÁRIO').toUpperCase())+'…';
    const av=document.createElement('div');
    av.className='spAguardando';
    av.textContent='⏳ esperando a carta de '+(outro.nome||'seu adversário');
    mao.appendChild(av);
  }
}

function instalarGanchos(){
  if(typeof window.choose!=='function') return false;

  const chooseOriginal = window.choose;
  window.choose = async function(i){
    if(emPartidaOnline){
      const meuTurno = (window.turn===meuSlot);
      if(!meuTurno){
        if(typeof log==='function') log('⏳ <b>aguarde</b> — é a vez do seu adversário.');
        return;
      }
      env('jogada',{dados:{acao:'carta', indice:i, turno:window.turn}});
      const r = await chooseOriginal.apply(this,arguments);
      setTimeout(destravarPasseDeVez,80);
      return r;
    }
    return chooseOriginal.apply(this,arguments);
  };

  if(typeof window.useItem==='function'){
    const itemOriginal=window.useItem;
    window.useItem=function(i){
      if(emPartidaOnline && window.turn===meuSlot){
        env('jogada',{dados:{acao:'item', indice:i, turno:window.turn}});
      }
      return itemOriginal.apply(this,arguments);
    };
  }

  if(typeof window.finish==='function'){
    const fimOriginal=window.finish;
    window.finish=function(){
      const r=fimOriginal.apply(this,arguments);
      if(emPartidaOnline){
        emPartidaOnline=false;
        desligarRng();
        env('fim',{dados:{hp1:window.st&&st.hp1, hp2:window.st&&st.hp2}});
        setTimeout(()=>{ $$('salaPainel').classList.add('aberto') },1500);
      }
      return r;
    };
  }

  if(typeof window.renderTurn==='function'){
    const renderOriginal=window.renderTurn;
    window.renderTurn=function(){
      const r=renderOriginal.apply(this,arguments);
      if(emPartidaOnline){
        atualizarIndicadorTurno();
        // o anfitriao dita o estado depois de cada rodada
        if(souHost) setTimeout(()=>{
          if(!emPartidaOnline || !window.st) return;
          env('estado',{dados:{hp1:st.hp1,hp2:st.hp2,rd:st.rd,
                               score:st.score,mult:st.mult,turno:window.turn}});
        },60);
      }
      return r;
    };
  }
  /* O truque do Deus da Comedia abre um overlay que espera um CLIQUE.
     Online isso travaria a rodada nos dois lados. Entao escolhemos
     automaticamente, de forma identica nas duas maquinas (semente + rodada). */
  if(typeof window.escolherTruque==='function'){
    const truqueOriginal = window.escolherTruque;
    window.escolherTruque = function(){
      if(!emPartidaOnline) return truqueOriginal.apply(this,arguments);
      return new Promise(res=>{
        try{
          if(typeof heroIs!=='function' || !heroIs('comedia') || !(window.picked&&picked[2])){
            return res();
          }
          const lista = window.TRUQUES||[];
          if(!lista.length) return res();
          // indice deterministico: mesma semente + mesma rodada = mesmo truque
          let h=(Number(window.__semente)||0) ^ (((window.st&&st.rd)||1)*2654435761);
          h=(h^(h>>>13))>>>0;
          const t=lista[h%lista.length];
          try{ t.run() }catch(e){}
          try{ if(typeof addSan==='function') addSan(t.inst) }catch(e){}
          try{
            window.comediaUsos=(window.comediaUsos||0)+1;
            window.comediaEscala=(window.comediaEscala||0)+1;
          }catch(e){}
          if(typeof log==='function'){
            log(`🎭 <b>${t.ic} ${t.n}</b> — ${t.d}`);
            log(`🌀 a piada custou <b>${t.inst}</b> de instabilidade.`);
          }
          if(typeof banner==='function') banner(t.n,'#ff2e88');
        }catch(e){ console.warn('truque online:',e) }
        res();
      });
    };
  }

  /* o anfitriao e a fonte da verdade: apos cada resolucao, anuncia o estado */
  if(typeof window.resolve==='function'){
    const resolveOriginal = window.resolve;
    window.resolve = function(){
      const r = resolveOriginal.apply(this,arguments);
      if(emPartidaOnline && souHost){
        const manda=()=>{
          if(!emPartidaOnline || !window.st) return;
          env('estado',{dados:{hp1:st.hp1,hp2:st.hp2,rd:st.rd,
                               score:st.score,mult:st.mult,turno:window.turn}});
        };
        setTimeout(manda,400); setTimeout(manda,1400); setTimeout(manda,2600);
      }
      return r;
    };
  }

  return true;
}

function aplicarJogadaRemota(m){
  if(!emPartidaOnline) return;
  const d=m.dados||{};
  if(d.acao==='carta'){
    // o jogo trava com busy=true depois da carta anterior; como esta jogada
    // vem do adversario, precisamos liberar antes de reproduzi-la aqui.
    if(window.turn===m.slot){
      const original = window.__chooseOriginal || window.choose;
      if(typeof original==='function'){
        const salvo=emPartidaOnline;
        emPartidaOnline=false;                 // nao reenviar de volta
        try{ window.busy=false }catch(e){}
        try{
          const p = original(d.indice);
          if(p && typeof p.then==='function') p.catch(()=>{});
        }catch(e){ console.warn('jogada remota:',e) }

        emPartidaOnline=salvo;
      }
    }
  }
  if(d.acao==='item' && typeof useItem==='function'){
    const salvo=emPartidaOnline; emPartidaOnline=false;
    try{ useItem(d.indice) }catch(e){}
    emPartidaOnline=salvo;
  }
  setTimeout(destravarPasseDeVez,120);
  atualizarIndicadorTurno();
}
function aplicarEstadoRemoto(dados){
  if(!dados || !window.st) return;
  try{
    if(typeof dados.hp1==='number') st.hp1=dados.hp1;
    if(typeof dados.hp2==='number') st.hp2=dados.hp2;
    if(typeof dados.rd==='number')  st.rd=dados.rd;
    if(typeof dados.score==='number') st.score=dados.score;
    if(typeof dados.mult==='number')  st.mult=dados.mult;
    if(typeof dados.turno==='number' && window.turn!==undefined) window.turn=dados.turno;
    if(typeof upd==='function') upd();
    atualizarIndicadorTurno();
  }catch(e){}
}
function atualizarIndicadorTurno(){
  let e=$$('turnoOnline');
  if(!emPartidaOnline){ if(e) e.style.display='none'; return }
  if(!e){
    e=document.createElement('div'); e.id='turnoOnline';
    document.body.appendChild(e);
  }
  e.style.display='block';
  const meuTurno=(window.turn===meuSlot);
  e.className=meuTurno?'meuTurno':'turnoDele';
  const outro=jogadoresSala.find(j=>j.slot&&j.id!==meuId)||{};
  e.textContent=meuTurno?'▶ SUA VEZ':'⏳ vez de '+(outro.nome||'…');
}

/* ---------------- avisa antes de fechar a aba do anfitriao ---------------- */
window.addEventListener('pagehide',()=>{
  try{
    if(souHost) conexoes.forEach(c=>{ try{ c.send({tipo:'salaMorreu'}) }catch(e){} });
    else if(conHost && conHost.open) conHost.send({tipo:'sair'});
  }catch(e){}
});
window.addEventListener('beforeunload',ev=>{
  try{
    if(souHost) conexoes.forEach(c=>{ try{ c.send({tipo:'salaMorreu'}) }catch(e){} });
  }catch(e){}
  if(souHost && conexoes.size>0){
    ev.preventDefault();
    ev.returnValue='Se você fechar, a sala acaba para todo mundo.';
    return ev.returnValue;
  }
});

/* ---------------- inicializacao ---------------- */
function iniciar(){
  criarInterface();
  if(typeof window.choose==='function') window.__chooseOriginal=window.choose;
  let tentou=0;
  const t=setInterval(()=>{
    if(instalarGanchos()||++tentou>40) clearInterval(t);
  },150);
  const url=new URLSearchParams(location.search).get('sala');
  if(url) setTimeout(()=>{ $$('lbCodigo').focus() },400);
}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',iniciar);
else iniciar();

})();
