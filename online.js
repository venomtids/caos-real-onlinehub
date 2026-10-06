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
let sequenciaJogada=0;
let ffaAtiva=false, ffaLocal={estado:null,mao:[],pendente:false};
let ffaTimerHost=null, ffaTimerReveal=null;
const FFA_MAX_RODADAS=12, FFA_TEMPO_ESCOLHA=35000;
const sequenciasAceitas=new Map();
const sequenciasAplicadas=new Map();

function assinaturaCarta(c){
  return c?JSON.stringify([c.n,c.v,c.e,c.ic,c.el,c.r,c.pw&&c.pw.k,c.pw2&&c.pw2.k,c.puz&&c.puz.k,
    !!c.god,!!c.ordem,!!c.scar,!!c.furtivo,!!c.puzWon]):'';
}
function assinaturaItem(it){
  return it?JSON.stringify([it.n,it.t,it.v,it.i,it.e]):'';
}
function atualizarNomesPartida(){
  const nomes={};
  jogadoresSala.forEach(j=>{if(j.slot)nomes[j.slot]=String(j.nome||'JOGADOR').slice(0,18)});
  window.__onlinePlayerNames=nomes;
  if(!window.__onlineSession)return;
  const nome=s=>String(nomes[s]||('JOG. '+s));
  const p1=$$('l1'),p2=$$('l2'),lbl=$$('handlbl');
  if(p1)p1.textContent=nome(1);
  if(p2)p2.textContent=nome(2);
  if(lbl&&window.turn===meuSlot&&meuSlot&&/ESCOLHA UMA CARTA/.test(lbl.textContent))
    lbl.textContent='VEZ DE '+nome(meuSlot)+' — ESCOLHA UMA CARTA';
}

const PREFIXO='caosreal2026-';
const LETRAS='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // sem I,O,0,1
const LIMITE_SALA=8, LIMITE_CHAT=60, MSG_MAX=300;

function novoCodigo(){
  let c=''; for(let i=0;i<4;i++) c+=LETRAS[Math.floor(randomOriginal()*LETRAS.length)];
  return c;
}
function novoId(){ return 'j'+randomOriginal().toString(36).slice(2,10) }

/* ---------------- carregar o PeerJS sob demanda ---------------- */
let peerjsPronto=null;
const PEERJS_CDNS=[
  'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js',
  'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js'
];
const PEER_OPTIONS={
  host:'0.peerjs.com', port:443, path:'/', secure:true, debug:0,
  config:{iceServers:[
    {urls:'stun:stun.l.google.com:19302'},
    {urls:'stun:stun.cloudflare.com:3478'}
  ]}
};
function carregarPeerJS(){
  if(window.Peer) return Promise.resolve();
  if(peerjsPronto) return peerjsPronto;
  peerjsPronto=new Promise((ok,falha)=>{
    let indice=0;
    const tentarCDN=()=>{
      if(window.Peer) return ok();
      if(indice>=PEERJS_CDNS.length) return falha(new Error('PeerJS indisponível'));
      const s=document.createElement('script');
      let terminou=false;
      const avancar=()=>{
        if(terminou) return;
        terminou=true; clearTimeout(prazo); s.remove(); indice++; tentarCDN();
      };
      const prazo=setTimeout(avancar,9000);
      s.async=true;
      s.src=PEERJS_CDNS[indice];
      s.onload=()=>{
        if(terminou) return;
        terminou=true; clearTimeout(prazo);
        if(window.Peer) ok();
        else{ s.remove(); indice++; tentarCDN() }
      };
      s.onerror=avancar;
      document.head.appendChild(s);
    };
    tentarCDN();
  }).catch(e=>{ peerjsPronto=null; throw e });
  return peerjsPronto;
}

/* ---------------- criar / entrar ---------------- */
function criarSala(nome,heroi){
  jaEncerrou=false; conectando=true; modoOnline=true;
  statusRede('abrindo a sala…','#f9c74f');
  carregarPeerJS().then(()=>{
    tentativasCod=0;
    tentarAbrir(nome,heroi);
  }).catch(()=>{
    conectando=false; modoOnline=false;
    statusRede('sem conexão','#fe5f55');
    mostrarErro('Não consegui carregar a rede. Verifique sua internet e tente novamente.');
  });
}
function tentarAbrir(nome,heroi){
  const cod=novoCodigo();
  if(peer){ try{ peer.destroy() }catch(e){} }
  let novoPeer;
  try{ novoPeer=new window.Peer(PREFIXO+cod,{...PEER_OPTIONS}) }
  catch(e){
    conectando=false; modoOnline=false;
    statusRede('erro','#fe5f55');
    mostrarErro('Não consegui iniciar a conexão. Atualize a página e tente novamente.');
    return;
  }
  peer=novoPeer;

  novoPeer.on('open',()=>{
    if(peer!==novoPeer) return;
    conectando=false; souHost=true; salaAtual=cod; meuId=novoId();
    salaLocal={codigo:cod,jogadores:new Map(),chat:[],host:meuId,jogo:false,ultimaAvancada:0};
    salaLocal.jogadores.set(meuId,{id:meuId,nome,heroi,slot:1,pronto:false,host:true});
    jogadoresSala=listaJogadores(); meuSlot=1;
    statusRede('sala aberta','#3ddc97');
    abrirSala();
    sistemaChat('Você abriu a sala '+cod+'. Mande o código pro seu amigo!');
    sistemaChat('⚠ Mantenha esta aba aberta — a sala vive aqui.');
    renderJogadores();
  });

  novoPeer.on('connection',con=>{
    if(peer===novoPeer) ligarConexaoDoConvidado(con);
    else try{con.close()}catch(e){}
  });

  novoPeer.on('error',err=>{
    if(peer!==novoPeer) return;
    if(err && err.type==='unavailable-id' && ++tentativasCod<8){
      try{novoPeer.destroy()}catch(e){}
      peer=null;
      return tentarAbrir(nome,heroi);
    }
    conectando=false; modoOnline=false;
    statusRede('erro','#fe5f55');
    mostrarErro('Não consegui abrir a sala. Verifique a internet e tente novamente.');
  });
}

function entrarNaSala(cod,nome,heroi){
  jaEncerrou=false; conectando=true; modoOnline=true;
  statusRede('procurando a sala…','#f9c74f');
  carregarPeerJS().then(()=>{
    if(peer){try{peer.destroy()}catch(e){}}
    let novoPeer,con=null,entrou=false,falhou=false;
    const falhar=(mensagem,estado='erro')=>{
      if(entrou || falhou) return;
      falhou=true; entrou=false; conectando=false; modoOnline=false;
      clearTimeout(prazo);
      statusRede(estado,'#fe5f55');
      mostrarErro(mensagem);
      try{con&&con.close()}catch(e){}
      try{novoPeer&&novoPeer.destroy()}catch(e){}
      if(peer===novoPeer) peer=null;
      conHost=null;
    };
    const prazo=setTimeout(()=>{
      if(!entrou) falhar('A conexão demorou demais. Confira o código, a internet e se o anfitrião ainda está com a sala aberta.','tempo esgotado');
    },18000);
    try{novoPeer=new window.Peer({...PEER_OPTIONS})}
    catch(e){falhar('Não consegui iniciar a conexão. Atualize a página e tente novamente.');return}
    peer=novoPeer;
    novoPeer.on('open',()=>{
      if(peer!==novoPeer) return;
      try{
        con=novoPeer.connect(PREFIXO+cod,{reliable:true,serialization:'json'});
        conHost=con;
      }catch(e){falhar('Não consegui conectar à sala. Confira o código e tente novamente.','sala não encontrada');return}
      con.on('open',()=>{
        if(peer!==novoPeer) return;
        statusRede('validando sala…','#f9c74f');
        try{con.send({tipo:'entrar',nome,heroi})}
        catch(e){falhar('A conexão caiu ao entrar na sala. Tente novamente.','desconectado')}
      });
      con.on('data',m=>{
        if(m && (m.tipo==='entrou'||m.tipo==='erro')){
          clearTimeout(prazo);
          if(m.tipo==='entrou'){
            entrou=true; conectando=false; jaEncerrou=false;
          }else{
            falhar(m.msg||'Não foi possível entrar nesta sala.');
            receber(m); return;
          }
        }
        receber(m);
      });
      con.on('close',()=>{
        clearTimeout(prazo);
        if(entrou && modoOnline) encerrarPorQuedaDoHost();
        else if(!entrou) falhar('A sala não respondeu. Confira o código e se o anfitrião está conectado.','sala não encontrada');
      });
      con.on('error',()=>{
        if(entrou){encerrarPorQuedaDoHost();return}
        falhar('Não consegui falar com a sala. Verifique sua conexão e tente novamente.','erro de rede');
      });
    });
    novoPeer.on('error',err=>{
      if(peer!==novoPeer || entrou) return;
      if(err && err.type==='peer-unavailable')
        falhar('Sala não encontrada. Confira o código e veja se o anfitrião ainda está com a aba aberta.','sala não encontrada');
      else falhar('Problema de rede ao entrar. Verifique a internet e tente novamente.','erro de rede');
    });
  }).catch(()=>{
    conectando=false; modoOnline=false;
    statusRede('sem conexão','#fe5f55');
    mostrarErro('Não consegui carregar a rede. Verifique sua internet e tente novamente.');
  });
}

/* ---------------- envio ---------------- */
function env(tipo,dados){
  const m={tipo,...dados};
  if(souHost) tratarNoHost(meuId,m);            // o anfitriao processa direto
  else if(conHost && conHost.open) conHost.send(m);
}
function solicitarRessincronizacao(texto){
  if(souHost||!emPartidaOnline)return;
  sincronizadoOnline=false;
  sistemaChat('🔄 '+(texto||'corrigindo a sincronização da partida…'));
  env('resync',{});
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
  for(let slot=1;slot<=LIMITE_SALA;slot++)if(!usados.has(slot))return slot;
  return 0;
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
function clonarCartaFFA(carta){return carta?JSON.parse(JSON.stringify(carta)):null}
function garantirArenaFFA(){
  let arena=$$('ffaArena');if(arena)return arena;
  arena=document.createElement('section');arena.id='ffaArena';arena.setAttribute('aria-label','Arena todos contra todos');
  arena.innerHTML=`<main class="ffaShell">
    <header class="ffaHeader"><div><div class="ffaEyebrow">CAOS REAL · ONLINE</div><h1>⚔ TODOS CONTRA TODOS</h1></div>
      <div class="ffaBadge">ATÉ 8 JOGADORES</div></header>
    <div class="ffaRound" id="ffaRound">Preparando arena…</div>
    <section class="ffaRule"><div class="ffaRuleLabel">REGRA DO CAOS</div><strong id="ffaRuleName">—</strong><p id="ffaRuleDesc">Aguarde o anfitrião.</p></section>
    <div class="ffaStatus" id="ffaStatus" aria-live="polite">Conectando jogadores…</div>
    <section class="ffaPlayers" id="ffaPlayers" aria-label="Jogadores"></section>
    <section class="ffaHandArea"><div class="ffaHandTitle" id="ffaHandTitle">SUA MÃO</div><div class="ffaHand" id="ffaHand"></div></section>
    <footer class="ffaFooter"><span>Escolham ao mesmo tempo. A regra e todas as cartas são reveladas juntas.</span>
      <button id="ffaLeave" type="button">ABANDONAR PARTIDA</button></footer>
  </main>`;
  document.body.appendChild(arena);
  const leave=$$('ffaLeave');if(leave)leave.onclick=()=>{
    if(ffaLocal.estado&&ffaLocal.estado.phase==='finished'){voltarAoLobby();return}
    if(window.confirm('Abandonar a partida devolverá todos os jogadores ao lobby. Continuar?'))env('abandono',{});
  };
  return arena;
}
function valorExibidoFFA(valor){
  const n=Number(valor);if(!Number.isFinite(n))return'—';
  return Number.isInteger(n)?String(n):n.toFixed(1).replace(/\.0$/,'');
}
function renderFFA(){
  if(!ffaAtiva)return;
  garantirArenaFFA();
  const s=ffaLocal.estado;
  const round=$$('ffaRound'),ruleName=$$('ffaRuleName'),ruleDesc=$$('ffaRuleDesc');
  const status=$$('ffaStatus'),grid=$$('ffaPlayers'),hand=$$('ffaHand'),handTitle=$$('ffaHandTitle'),leave=$$('ffaLeave');
  if(!s){
    if(round)round.textContent='ARENA ONLINE';
    if(ruleName)ruleName.textContent='—';if(ruleDesc)ruleDesc.textContent='Aguarde o anfitrião preparar as cartas.';
    if(status)status.textContent='Conectado. Sincronizando a partida…';
    if(grid)grid.innerHTML='';if(hand)hand.innerHTML='';
    if(leave)leave.textContent='ABANDONAR PARTIDA';
    return;
  }
  const vivos=s.players.filter(p=>p.alive);
  if(round)round.textContent=`RODADA ${s.round} / ${s.maxRounds} · ${vivos.length} VIVOS`;
  if(ruleName)ruleName.textContent=s.ruleName||'REGRA DO CAOS';
  if(ruleDesc)ruleDesc.textContent=s.ruleDesc||'A maior pontuação leva a rodada.';
  if(status){
    if(s.phase==='pick'){
      const escolhidas=vivos.filter(p=>p.selected).length;
      const eu=s.players.find(p=>Number(p.slot)===Number(meuSlot));
      status.textContent=eu&&!eu.alive?'Você foi eliminado. Acompanhe o desfecho da partida.':
        `${escolhidas} de ${vivos.length} escolhas recebidas · escolha uma carta oculta; após 35 s, escolhas faltantes são automáticas.`;
    }else if(s.phase==='show')status.textContent=`CARTAS REVELADAS · ${s.winners.length?`J${s.winners.join(' e J')}${s.winners.length===1?' VENCEU':' EMPATARAM'}`:'rodada resolvida'}`;
    else status.textContent=s.championName?(s.winners.length>1?`🏆 EMPATE ENTRE: ${s.championName}`:`🏆 CAMPEÃO: ${s.championName}`):'Partida encerrada.';
  }
  if(grid){
    grid.innerHTML='';
    const jogadores=s.phase==='finished'?[...s.players].sort((a,b)=>Number(b.alive)-Number(a.alive)||b.hp-a.hp||b.score-a.score||b.wins-a.wins):s.players;
    jogadores.forEach(p=>{
      const card=document.createElement('article');
      card.className='ffaPlayer'+(p.alive?'':' eliminado')+(Number(p.slot)===Number(meuSlot)?' voce':'')+(s.winners.includes(Number(p.slot))?' vencedor':'');
      const topo=document.createElement('div');topo.className='ffaPlayerTop';
      const tag=document.createElement('span');tag.className='ffaSlot';tag.textContent='J'+p.slot;
      const nome=document.createElement('strong');nome.className='ffaName';nome.textContent=p.name||('JOGADOR '+p.slot);
      const vida=document.createElement('span');vida.className='ffaHp';vida.textContent=`${Math.max(0,p.hp)} ❤`;
      topo.append(tag,nome,vida);card.appendChild(topo);
      const trilho=document.createElement('div');trilho.className='ffaHpBar';
      const barra=document.createElement('i');barra.style.width=`${Math.max(0,Math.min(100,Number(p.hp)/20*100))}%`;trilho.appendChild(barra);card.appendChild(trilho);
      const info=document.createElement('div');info.className='ffaPlayerInfo';
      if(s.phase==='pick')info.textContent=!p.alive?'ELIMINADO':(p.selected?(p.auto?'⌛ escolha automática':'✓ escolheu'):'pensando…');
      else if(!p.cardName)info.textContent='ELIMINADO';
      else{
        const carta=`${p.cardIcon||'🃏'} ${p.cardName}`;
        const valor=p.value===null||p.value===undefined?'':` · ${valorExibidoFFA(p.value)}`;
        const dano=Number(p.damage)>0?` · −${p.damage} vida`:'';
        info.textContent=`${carta}${valor}${dano}${p.result?` · ${p.result}`:''}`;
      }
      card.appendChild(info);
      const pontos=document.createElement('div');pontos.className='ffaPoints';pontos.textContent=`${p.score} pts · ${p.wins} vitórias`;
      card.appendChild(pontos);grid.appendChild(card);
    });
  }
  if(hand){
    hand.innerHTML='';
    const eu=s.players.find(p=>Number(p.slot)===Number(meuSlot));
    if(s.phase==='pick'&&eu&&eu.alive&&!eu.selected&&!ffaLocal.pendente){
      if(handTitle)handTitle.textContent='ESCOLHA UMA CARTA';
      ffaLocal.mao.forEach((c,i)=>{
        const b=document.createElement('button');b.type='button';b.className='ffaCard';
        const ic=document.createElement('span');ic.className='ffaCardIcon';ic.textContent=c.ic||'🃏';
        const n=document.createElement('strong');n.className='ffaCardName';n.textContent=c.n||'Carta do Caos';
        const v=document.createElement('span');v.className='ffaCardValue';v.textContent=`VALOR ${c.v}`;
        const power=document.createElement('small');power.className='ffaCardPower';power.textContent=c.pw&&c.pw.n?`✦ ${c.pw.n}`:'SEM PODER';
        b.append(ic,n,v,power);b.onclick=()=>escolherCartaFFA(i);hand.appendChild(b);
      });
      if(!ffaLocal.mao.length){const waiting=document.createElement('div');waiting.className='ffaHandMessage';waiting.textContent='Aguardando suas cartas…';hand.appendChild(waiting)}
    }else{
      if(handTitle)handTitle.textContent=s.phase==='finished'?'RESULTADO FINAL':'SUA MÃO';
      const msg=document.createElement('div');msg.className='ffaHandMessage';
      if(s.phase==='finished')msg.textContent='Partida encerrada. Volte à sala para jogar novamente.';
      else if(s.phase==='show')msg.textContent='As cartas foram reveladas. A próxima rodada começa em instantes.';
      else if(eu&&!eu.alive)msg.textContent='Você foi eliminado — assista até alguém conquistar a vitória.';
      else if(eu&&eu.selected||ffaLocal.pendente)msg.textContent='Carta escolhida. Aguardando os outros jogadores…';
      else msg.textContent='Aguardando a próxima rodada…';
      hand.appendChild(msg);
    }
  }
  if(leave)leave.textContent=s.phase==='finished'?'↩ VOLTAR À SALA':'ABANDONAR PARTIDA';
}
function estadoPublicoFFA(s){
  const revelar=s.phase!=='pick';
  return{
    round:s.round,maxRounds:s.maxRounds,phase:s.phase,ruleName:s.ruleName,ruleDesc:s.ruleDesc,
    winners:[...(s.winners||[])],championName:s.championName||'',
    players:s.players.map(p=>({slot:p.slot,name:p.name,hp:p.hp,score:p.score,wins:p.wins,alive:p.alive,
      selected:!!p.selected,auto:!!p.auto,cardName:revelar&&p.selected?p.selected.n:'',cardIcon:revelar&&p.selected?p.selected.ic:'',
      value:revelar?p.value:null,damage:p.damage||0,result:p.result||''}))
  };
}
function publicarEstadoFFA(s){
  if(!s||!salaLocal)return;
  const estado=estadoPublicoFFA(s);
  const pacotePara=id=>{
    const p=s.players.find(x=>x.id===id);
    const mao=s.phase==='pick'&&p&&p.alive&&!p.selected?(p.hand||[]).map(clonarCartaFFA):[];
    return{tipo:'ffaEstado',estado,mao};
  };
  receber(pacotePara(meuId));
  conexoes.forEach((con,id)=>{if(con.open){try{con.send(pacotePara(id))}catch(e){}}});
}
function cartaNovaFFA(){
  if(typeof window.mkCard==='function')return clonarCartaFFA(window.mkCard());
  return{v:1+Math.floor(Math.random()*10),n:'Carta do Caos',ic:'🃏',el:'vazio',pw:null};
}
function iniciarRodadaFFA(s){
  if(!souHost||!salaLocal||salaLocal.ffa!==s||s.phase==='finished')return;
  if(ffaTimerHost){clearTimeout(ffaTimerHost);ffaTimerHost=null}
  if(ffaTimerReveal){clearTimeout(ffaTimerReveal);ffaTimerReveal=null}
  if(s.players.filter(p=>p.alive).length<=1||s.round>=s.maxRounds){finalizarPartidaFFA(s);return}
  s.round++;s.phase='pick';s.winners=[];s.championName='';
  const regras=Array.isArray(window.ONLINE_RULES)?window.ONLINE_RULES:[];
  const regra=regras.length?regras[Math.floor(Math.random()*regras.length)]:null;
  s.ruleName=regra&&regra.n||'NORMAL (?)';s.ruleDesc=regra&&regra.d||'A maior carta vence.';
  s.players.forEach(p=>{
    p.selected=null;p.value=null;p.damage=0;p.result='';p.auto=false;
    p.hand=p.alive?[cartaNovaFFA(),cartaNovaFFA(),cartaNovaFFA()]:[];
  });
  publicarEstadoFFA(s);
  ffaTimerHost=setTimeout(()=>{
    if(!salaLocal||salaLocal.ffa!==s||s.phase!=='pick')return;
    s.players.filter(p=>p.alive&&!p.selected).forEach(p=>{
      p.selected=clonarCartaFFA(p.hand[Math.floor(Math.random()*p.hand.length)]);p.auto=true;
    });
    resolverRodadaFFA(s);
  },FFA_TEMPO_ESCOLHA);
}
function valorCartaFFA(p,s,regra,vidaMedia){
  const carta=p.selected||{},poder=carta.pw&&carta.pw.k;
  let valor=Number(carta.v)||0;
  if(!regra||!regra.nopw){
    if(p.fenixBoost){valor+=5;p.fenixBoost=false}
    switch(poder){
      case'gigante':if(s.round%2===0)valor+=4;break;
      case'sortudo':valor+=1+Math.floor(Math.random()*5);break;
      case'caotico':valor=1+Math.floor(Math.random()*13);break;
      case'maldito':valor-=3;break;
      case'berserk':valor+=Math.min(8,Math.max(0,20-p.hp));break;
      case'inflacao':valor+=Math.max(0,s.round-1)*2;break;
      case'sanguinario':if(p.hp<10)valor+=6;break;
      case'gravidade':valor=Math.ceil(valor/2);break;
      case'miragem':if(Math.abs(valor%2)===1)valor*=2;break;
    }
  }
  if(regra&&regra.n!=='ESPELHO'&&regra.n!=='ELEMENTOS FURIOSOS'&&poder!=='furtivo'){
    try{const res=regra.f(valor,10,{hp1:p.hp,hp2:vidaMedia,rd:s.round});valor=Number(res&&res[0])}
    catch(e){}
  }
  return Number.isFinite(valor)?valor:0;
}
function resolverRodadaFFA(s){
  if(!souHost||!salaLocal||salaLocal.ffa!==s||s.phase!=='pick')return;
  if(ffaTimerHost){clearTimeout(ffaTimerHost);ffaTimerHost=null}
  const ativos=s.players.filter(p=>p.alive);
  if(!ativos.length){finalizarPartidaFFA(s);return}
  if(ativos.some(p=>!p.selected))return;
  const regras=Array.isArray(window.ONLINE_RULES)?window.ONLINE_RULES:[];
  const regra=regras.find(r=>r.n===s.ruleName)||null;
  if(regra&&regra.n==='CURA COLETIVA')ativos.forEach(p=>p.hp=Math.min(20,p.hp+3));
  const vidaMedia=ativos.reduce((n,p)=>n+p.hp,0)/ativos.length;
  ativos.forEach(p=>p.value=valorCartaFFA(p,s,regra,vidaMedia));
  if(regra&&regra.n==='ESPELHO'&&ativos.length>1){
    const valores=ativos.map(p=>p.value);ativos.forEach((p,i)=>p.value=valores[(i+1)%valores.length]);
  }
  if(regra&&regra.n==='ELEMENTOS FURIOSOS'){
    const beats=window.ONLINE_BEATS||{};
    ativos.forEach(p=>{
      let vence=0,perde=0;const el=p.selected&&p.selected.el;
      if(el)ativos.forEach(q=>{if(q===p)return;const outro=q.selected&&q.selected.el;if(beats[el]===outro)vence++;if(beats[outro]===el)perde++});
      if(vence>perde)p.value+=9;else if(perde>vence)p.value-=9;
    });
  }
  const maior=Math.max(...ativos.map(p=>p.value));
  let vencedores=ativos.filter(p=>p.value===maior);
  if(vencedores.length>1){const teimosos=vencedores.filter(p=>p.selected&&p.selected.pw&&p.selected.pw.k==='teimoso');if(teimosos.length)vencedores=teimosos}
  const idsVencedores=new Set(vencedores.map(p=>p.slot));
  const regraSemPoder=!!(regra&&regra.nopw),poderVencedor=vencedores[0]&&vencedores[0].selected&&vencedores[0].selected.pw&&vencedores[0].selected.pw.k;
  vencedores.forEach(p=>{
    p.wins++;p.score+=10;p.streak=(p.streak||0)+1;p.hp=Math.min(20,p.hp+1);
    if(!regraSemPoder&&p.selected&&p.selected.pw){
      if(p.selected.pw.k==='vampiro'||p.selected.pw.k==='ladrao')p.hp=Math.min(20,p.hp+2);
    }
    if(regra&&regra.rec)p.hp=Math.max(0,p.hp-2);
    if(regra&&regra.healTie&&vencedores.length>1)p.hp=Math.min(20,p.hp+regra.healTie);
    p.result='VENCEU A RODADA';
  });
  const perdedores=ativos.filter(p=>!idsVencedores.has(p.slot));
  const explosivos=regraSemPoder?0:perdedores.filter(p=>p.selected&&p.selected.pw&&p.selected.pw.k==='explosivo').length;
  perdedores.forEach(p=>{
    let dano=regra&&regra.fixed?Number(regra.fixed):Math.max(1,Math.min(6,Math.ceil((maior-p.value)/2)));
    if(regra&&regra.x2)dano*=2;if(regra&&regra.x3)dano*=3;
    if(!regraSemPoder){
      if(poderVencedor==='duplo')dano=Math.ceil(dano*1.5);
      if(poderVencedor==='maldito')dano*=2;
      if(poderVencedor==='trovao')dano+=2;
      if(poderVencedor==='juiz')dano=7;
      if(poderVencedor==='praga')dano+=2;
      if(poderVencedor==='toxico')dano+=3;
      if(p.selected&&p.selected.pw&&p.selected.pw.k==='blindado'&&poderVencedor!=='tsunami')dano=Math.ceil(dano/2);
    }
    p.damage=dano;p.hp=Math.max(0,p.hp-dano);p.score+=Math.max(0,Math.floor(p.value/2));p.streak=0;
    if(!regraSemPoder&&p.selected&&p.selected.pw&&p.selected.pw.k==='curandeiro')p.hp=Math.min(20,p.hp+3);
    if(p.hp<=0&&!regraSemPoder&&p.selected&&p.selected.pw&&p.selected.pw.k==='fenix'&&!p.fenixUsed){
      p.hp=1;p.fenixUsed=true;p.fenixBoost=true;p.alive=true;p.result='FÊNIX · REVIVEU';
    }else if(p.hp<=0){p.hp=0;p.alive=false;p.result='ELIMINADO'}
    else{p.alive=true;p.result=`−${dano} VIDA`}
  });
  if(explosivos){
    vencedores.forEach(p=>{p.hp=Math.max(0,p.hp-explosivos*3);p.damage+=explosivos*3;if(p.hp<=0){p.alive=false;p.result='ATINGIDO PELA EXPLOSÃO'}});
  }
  if(regra&&regra.rec)vencedores.forEach(p=>{if(p.hp<=0)p.alive=false});
  s.winners=vencedores.filter(p=>p.alive).map(p=>p.slot);s.phase='show';
  publicarEstadoFFA(s);
  ffaTimerReveal=setTimeout(()=>{
    if(!salaLocal||salaLocal.ffa!==s||s.phase!=='show')return;
    if(s.players.filter(p=>p.alive).length<=1||s.round>=s.maxRounds)finalizarPartidaFFA(s);
    else iniciarRodadaFFA(s);
  },4200);
}
function finalizarPartidaFFA(s){
  if(!souHost||!salaLocal||salaLocal.ffa!==s||s.phase==='finished')return;
  if(ffaTimerHost){clearTimeout(ffaTimerHost);ffaTimerHost=null}
  if(ffaTimerReveal){clearTimeout(ffaTimerReveal);ffaTimerReveal=null}
  let candidatos=s.players.filter(p=>p.alive);
  if(!candidatos.length)candidatos=s.players;
  candidatos.sort((a,b)=>b.hp-a.hp||b.score-a.score||b.wins-a.wins);
  const melhor=candidatos[0];
  s.winners=melhor?candidatos.filter(p=>p.hp===melhor.hp&&p.score===melhor.score&&p.wins===melhor.wins).map(p=>p.slot):[];
  s.championName=s.winners.map(slot=>s.players.find(p=>p.slot===slot)?.name||('J'+slot)).join(' e ');
  s.phase='finished';publicarEstadoFFA(s);
  salaLocal.jogo=false;salaLocal.avancoPendente=null;salaLocal.ultimaAvancada=0;
  salaLocal.jogadores.forEach(j=>{j.pronto=false});
  sistemaChat(s.winners.length>1?'🏆 FFA encerrado em empate: '+s.championName+'.':'🏆 Campeão do FFA: '+s.championName+'.');
  sincronizar();
}
function comecarArenaFFA(){
  ffaAtiva=true;ffaLocal={estado:null,mao:[],pendente:false};
  document.body.classList.add('onlineFFA','onlineActive');
  const painel=$$('salaPainel');if(painel)painel.classList.remove('aberto');
  garantirArenaFFA();renderFFA();
  if(!souHost||!salaLocal){setTimeout(()=>env('ffaSync',{}),180);return}
  const jogadores=jogadoresSala.filter(j=>Number(j.slot)>0);
  const estado={round:0,maxRounds:FFA_MAX_RODADAS,phase:'pick',ruleName:'',ruleDesc:'',winners:[],championName:'',players:jogadores.map(j=>({
    id:j.id,slot:Number(j.slot),name:String(j.nome||'JOGADOR').slice(0,18),hero:j.heroi||'comedia',hp:20,score:0,wins:0,streak:0,alive:true,hand:[],selected:null,value:null,damage:0,result:'',auto:false,fenixUsed:false,fenixBoost:false
  }))};
  salaLocal.ffa=estado;iniciarRodadaFFA(estado);
}
function escolherCartaFFA(indice){
  const s=ffaLocal.estado,eu=s&&s.players.find(p=>Number(p.slot)===Number(meuSlot));
  if(!ffaAtiva||!s||s.phase!=='pick'||!eu||!eu.alive||eu.selected||ffaLocal.pendente)return;
  const carta=ffaLocal.mao[indice];if(!carta)return;
  ffaLocal.pendente=true;renderFFA();
  env('ffaEscolher',{rodada:s.round,indice,seq:++sequenciaJogada,carta:assinaturaCarta(carta)});
}
function comecarPartidaNaSala(){
  if(!salaLocal||salaLocal.jogo)return false;
  const participantes=[...salaLocal.jogadores.values()].filter(j=>j.slot>0);
  if(participantes.length<2||!participantes.every(j=>j.pronto))return false;
  salaLocal.jogo=true;salaLocal.ultimaAvancada=0;salaLocal.avancoPendente=null;salaLocal.ffa=null;
  const semente=Math.floor(randomOriginal()*1e9);
  const config={hero:(window.hero&&window.hero.id)||'comedia',foe:(window.foe&&window.foe.id)||'gremlin'};
  const inicio={tipo:'comecar',semente,config,jogadores:listaJogadores(),ffa:participantes.length>=3};
  // Enfileira o início nos convidados antes de o anfitrião gerar as mãos locais.
  conexoes.forEach(c=>{if(c.open){try{c.send(inicio)}catch(e){}}});
  receber(inicio);
  return true;
}

function ligarConexaoDoConvidado(con){
  let idDele=null;
  con.on('data',m=>{
    if(!m || typeof m!=='object') return;
    if(m.tipo==='entrar' && !idDele){
      if(!salaLocal||salaLocal.jogo||salaLocal.jogadores.size>=LIMITE_SALA){
        const msg=salaLocal&&salaLocal.jogo?'A partida já começou. Aguarde a próxima sala.':'A sala está cheia (máximo de 8 jogadores).';
        try{con.send({tipo:'erro',msg});setTimeout(()=>con.close(),250)}catch(e){}
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
        salaLocal.jogo=false;salaLocal.avancoPendente=null;salaLocal.ultimaAvancada=0;
        salaLocal.jogadores.forEach(x=>{x.pronto=false});
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
      if(salaLocal.jogo||!j.slot)return;
      j.pronto=!!m.pronto;
      if(m.heroi)j.heroi=String(m.heroi).slice(0,24);
      sincronizar();
      break;
    }
    case 'iniciar':
      if(id!==salaLocal.host||!souHost)return;
      if(!comecarPartidaNaSala())paraUm(id,'sistema',{texto:'Para iniciar, são necessários pelo menos 2 jogadores e todos precisam estar prontos.'});
      else sincronizar();
      break;

    case 'ffaSync': {
      const s=salaLocal.ffa;if(!j.slot||!salaLocal.jogo||!s)return;
      const p=s.players.find(x=>x.id===id);
      const mao=s.phase==='pick'&&p&&p.alive&&!p.selected?(p.hand||[]).map(clonarCartaFFA):[];
      paraUm(id,'ffaEstado',{estado:estadoPublicoFFA(s),mao});
      break;
    }

    case 'ffaEscolher': {
      const s=salaLocal.ffa,seq=Number(m.seq),ultima=sequenciasAceitas.get(id)||0;
      const rejeitar=texto=>paraUm(id,'erroJogo',{texto});
      if(!j.slot||!salaLocal.jogo||!s||s.phase!=='pick')return;
      if(!Number.isSafeInteger(seq)||seq<=ultima){rejeitar('Escolha duplicada ignorada.');return}
      const p=s.players.find(x=>x.id===id),indice=Number(m.indice);
      if(!p||!p.alive||p.selected||Number(m.rodada)!==s.round){rejeitar('Essa rodada já avançou ou sua escolha já foi registrada.');return}
      const carta=p.hand&&p.hand[indice];
      if(!Number.isInteger(indice)||!carta||m.carta!==assinaturaCarta(carta)){rejeitar('Essa carta não está mais na sua mão. Aguarde a sincronização.');return}
      sequenciasAceitas.set(id,seq);p.selected=clonarCartaFFA(carta);p.auto=false;
      publicarEstadoFFA(s);
      if(s.players.filter(x=>x.alive).every(x=>x.selected))resolverRodadaFFA(s);
      break;
    }

    case 'jogada': {
      if(!j.slot || !salaLocal.jogo || ffaAtiva) return;
      const d=m.dados||{}, slot=Number(j.slot), seq=Number(d.seq);
      const ultima=sequenciasAceitas.get(id)||0;
      const rejeitar=texto=>{
        let snapshot=null;
        if(id!==meuId&&typeof window.__getOnlineSnapshot==='function'){
          try{snapshot={rodada:numeroRodada(),snapshot:window.__getOnlineSnapshot(),rng:rngState}}catch(e){}
        }
        paraUm(id,'erroJogo',{texto,snapshot});
      };
      if(!Number.isSafeInteger(seq)||seq<=ultima){rejeitar('Jogada duplicada ignorada.');return}
      if(Number(d.turno)!==slot||Number(window.turn)!==slot){
        rejeitar('Jogada fora de turno — aguarde a sincronização e tente novamente.');return;
      }
      if(window.picked&&window.picked[slot]){
        rejeitar('Você já fez sua jogada nesta rodada.');return;
      }
      const aguardandoJogador2=slot===2&&window.picked&&window.picked[1]&&!window.picked[2];
      if(window.busy&&!aguardandoJogador2){rejeitar('A rodada ainda está sendo resolvida.');return}
      const indice=Number(d.indice);
      if(d.acao==='carta'){
        const carta=window.hands&&window.hands[slot]&&window.hands[slot][indice];
        if(!Number.isInteger(indice)||!carta||d.carta!==assinaturaCarta(carta)){
          rejeitar('Essa carta não está mais na sua mão. Aguarde a próxima sincronização.');return;
        }
      }else if(d.acao==='item'){
        const item=window.inv&&window.inv[slot]&&window.inv[slot][indice];
        if(!Number.isInteger(indice)||!item||item.used||d.item!==assinaturaItem(item)){
          rejeitar('Esse item não está mais disponível. Aguarde a próxima sincronização.');return;
        }
      }else{
        rejeitar('Ação inválida.');return;
      }
      sequenciasAceitas.set(id,seq);
      paraTodos('jogada',{de:j.nome,slot,dados:d},id);
      break;
    }

    case 'abandono':
      if(!j.slot||!salaLocal.jogo)return;
      salaLocal.jogo=false;salaLocal.avancoPendente=null;salaLocal.ultimaAvancada=0;
      salaLocal.jogadores.forEach(x=>{x.pronto=false});
      paraTodos('abandono',{nome:j.nome});
      sincronizar();
      break;

    case 'proxima':
      if(!j.slot||!salaLocal.jogo||ffaAtiva)return;
      aceitarAvanco(id,m.rodada);
      break;

    case 'snapshot':
      if(id!==salaLocal.host || !salaLocal.jogo) return;
      paraTodos('snapshot',{dados:m.dados},id);
      break;

    case 'resync': {
      if(id===meuId||!salaLocal.jogo||typeof window.__getOnlineSnapshot!=='function')return;
      try{
        const snapshot={rodada:numeroRodada(),snapshot:window.__getOnlineSnapshot(),rng:rngState};
        paraUm(id,'erroJogo',{texto:'Sincronização restaurada pelo anfitrião.',snapshot});
      }catch(e){}
      break;
    }

    case 'estado':
      if(id!==salaLocal.host) return;          // so o anfitriao dita o estado
      paraTodos('estado',{dados:m.dados},id);
      break;

    case 'fim':
      if(id!==salaLocal.host) return;          // o anfitriao decide quando a partida acaba
      salaLocal.jogo=false; salaLocal.avancoPendente=null;
      salaLocal.jogadores.forEach(x=>{x.pronto=false});
      paraTodos('fim',{dados:m.dados});
      sincronizar();
      break;

    case 'sair': {
      if(id===meuId) return;                   // o anfitriao sai por outro caminho
      const con=conexoes.get(id);
      if(salaLocal.jogo&&j.slot){
        salaLocal.jogo=false;salaLocal.avancoPendente=null;salaLocal.ultimaAvancada=0;
        salaLocal.jogadores.forEach(x=>{x.pronto=false});
        paraTodos('abandono',{nome:j.nome},id);
      }
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
      jaEncerrou=false; salaAtual=m.codigo; meuId=m.id; souHost=(m.host===m.id);
      jogadoresSala=m.jogadores||[];
      meuSlot=(jogadoresSala.find(j=>j.id===meuId)||{}).slot||0;
      atualizarNomesPartida();
      abrirSala();
      (m.chat||[]).forEach(c=>addChat(c,true));
      renderJogadores();
      sistemaChat('Você entrou na sala '+m.codigo+'.');
      break;

    case 'sala':
      jogadoresSala=m.jogadores||[];
      souHost=(m.host===meuId);
      meuSlot=(jogadoresSala.find(j=>j.id===meuId)||{}).slot||0;
      atualizarNomesPartida();
      renderJogadores();
      break;

    case 'chat':    addChat(m.msg); break;
    case 'sistema': sistemaChat(m.texto); break;
    case 'erro':    mostrarErro(m.msg); break;
    case 'erroJogo':
      if(ffaAtiva){ffaLocal.pendente=false;renderFFA()}
      sistemaChat('⚠ '+(m.texto||'Jogada recusada pelo anfitrião.'));
      if(m.snapshot)aplicarSnapshotRemoto(m.snapshot,true);
      break;

    case 'emote':
      sistemaChat(`${m.de} ${m.emote}`);
      flutuarEmote(m.emote);
      break;

    case 'comecar':
      jogadoresSala=m.jogadores||jogadoresSala;
      meuSlot=(jogadoresSala.find(j=>j.id===meuId)||{}).slot||0;
      iniciarPartidaOnline(m.semente,m.config,!!m.ffa);
      break;

    case 'ffaEstado': {
      if(!ffaAtiva||!m.estado)return;
      ffaLocal.estado=m.estado;ffaLocal.mao=Array.isArray(m.mao)?m.mao:[];
      const euFFA=m.estado.players.find(p=>Number(p.slot)===Number(meuSlot));
      if(m.estado.phase!=='pick'||(euFFA&&euFFA.selected))ffaLocal.pendente=false;
      renderFFA();
      break;
    }

    case 'jogada': aplicarJogadaRemota(m); break;
    case 'avancar': aplicarAvancoRemoto(m.rodada); break;
    case 'avancoErro': cancelarAvanco(m.texto||'Não foi possível avançar. Tente novamente.'); break;
    case 'snapshot': aplicarSnapshotRemoto(m.dados); break;
    case 'estado': aplicarEstadoRemoto(m.dados); break;

    case 'abandono':
      sistemaChat('⚠ '+m.nome+' abandonou a partida. Voltando ao lobby.');
      if(window.banner) banner('ABANDONO','#fe5f55');
      voltarAoLobby();
      break;

    case 'fim':
      sistemaChat('A partida terminou.');
      if(!souHost && emPartidaOnline){
        try{
          if(m.dados && window.st){
            if(typeof m.dados.hp1==='number') st.hp1=m.dados.hp1;
            if(typeof m.dados.hp2==='number') st.hp2=m.dados.hp2;
            if(typeof upd==='function') upd();
          }
          if(typeof window.finish==='function') window.finish();
        }catch(e){console.warn('fim online:',e)}
      }
      break;

    case 'salaMorreu':
      encerrarPorQuedaDoHost();
      break;
  }
}

let jaEncerrou=false;
function encerrarPorQuedaDoHost(){
  if(jaEncerrou || souHost) return;
  jaEncerrou=true; modoOnline=false; conectando=false;
  cancelarAvanco();
  statusRede('sala encerrada','#fe5f55');
  sistemaChat('⚠ O anfitrião saiu — a sala acabou.');
  if(window.banner) banner('SALA ENCERRADA','#fe5f55');
  emPartidaOnline=false;window.__onlineSession=false;desligarRng();limparSincronizacaoSnapshot();
  try{window.__restoreOnlineConfig&&window.__restoreOnlineConfig()}catch(e){}
  const p=$$('salaPainel'); if(p) p.classList.add('aberto');
  const antiga=peer; peer=null; conHost=null;
  try{antiga&&antiga.destroy()}catch(e){}
  setTimeout(()=>{ if(jaEncerrou) abrirLobby() },2000);
}

/* ---------------- interface: lobby ---------------- */
function criarInterface(){
  const el=document.createElement('div');
  el.id='onlineWrap';
  el.innerHTML=`
  <div id="lobbyOv">
    <div class="lobbyBox">
      <div class="lobbyLogo">CAOS<span>REAL</span></div>
      <div class="lobbySub">2–8 jogadores · de 3 a 8, todos contra todos · chat</div>

      <div class="lobbyCampo">
        <label for="lbNome">SEU NOME</label>
        <input id="lbNome" maxlength="18" placeholder="como querem te chamar?" autocomplete="nickname">
      </div>

      <div class="lobbyBotoes">
        <button class="lbBtn solo" id="lbSolo">🎮 JOGAR SOZINHO<small>contra o computador</small></button>
        <button class="lbBtn criar" id="lbCriar">🚪 CRIAR SALA<small>você recebe um código</small></button>
      </div>

      <div class="lobbyOu">— ou entre numa sala —</div>
      <div class="lobbyCampo cod">
        <input id="lbCodigo" maxlength="4" placeholder="CÓDIGO" aria-label="Código da sala" autocomplete="off" autocapitalize="characters" spellcheck="false">
        <button class="lbBtn entrar" id="lbEntrar">ENTRAR</button>
      </div>
      <div class="lobbyErro" id="lbErro"></div>
      <div class="lobbyPe"><span id="netStatus">● offline</span></div>
    </div>
  </div>

  <div id="salaPainel">
    <div class="spTopo">
      <div class="spCod">SALA <b id="spCodigo">----</b>
        <button class="spCopiar" id="spCopiar" title="copiar link da sala" aria-label="Copiar link da sala">📋</button></div>
      <div class="spTopoAcoes">
        <button class="spFechar" id="spFechar" title="voltar ao jogo">↙ JOGO</button>
        <button class="spSair" id="spSair">SAIR</button>
      </div>
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

  <button id="chatToggle" title="abrir/fechar o chat" aria-label="Abrir ou fechar o chat">💬<span id="chatBadge"></span></button>
  `;
  document.body.appendChild(el);
  ligarEventos();
}

function ligarEventos(){
  $$('lbSolo').onclick=()=>{
    modoOnline=false;
    document.querySelectorAll('.foeSelectOverlay').forEach(x=>x.remove());
    fecharLobby();
    if(window.S)S.click();
    if(typeof window.__startSoloRun==='function')window.__startSoloRun();
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

  $$('spFechar').onclick=()=>{
    $$('salaPainel').classList.remove('aberto');
    naoLidas=0; atualizarBadge();
  };
  $$('spSair').onclick=()=>{
    if((emPartidaOnline||(salaLocal&&salaLocal.jogo))&&
       !window.confirm('A partida está em andamento. Sair encerrará a sala para todos. Quer continuar?'))return;
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
    cancelarAvanco();window.__onlineSession=false;limparSincronizacaoSnapshot();
    try{window.__restoreOnlineConfig&&window.__restoreOnlineConfig()}catch(e){}
    desligarRng();
    statusRede('offline','#8fb0c4');
    $$('salaPainel').classList.remove('aberto');
    $$('chatToggle').style.display='none';
    abrirLobby();
  };
  $$('spCopiar').onclick=async()=>{
    const t=location.origin+location.pathname+'?sala='+salaAtual;
    try{
      if(navigator.clipboard&&navigator.clipboard.writeText){
        await navigator.clipboard.writeText(t);
        sistemaChat('Link da sala copiado! Mande pro seu amigo.');
        return;
      }
      const area=document.createElement('textarea');
      area.value=t; area.setAttribute('readonly','');
      area.style.cssText='position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(area); area.select();
      const copiou=document.execCommand&&document.execCommand('copy');
      area.remove();
      sistemaChat(copiou?'Link da sala copiado! Mande pro seu amigo.':'Link: '+t);
    }catch(e){sistemaChat('Link da sala: '+t)}
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
  const saiuDoFFA=ffaAtiva;
  desligarRng();
  emPartidaOnline=false;window.__onlineSession=false;limparSincronizacaoSnapshot();
  try{window.__restoreOnlineConfig&&window.__restoreOnlineConfig()}catch(e){}
  if(saiuDoFFA&&typeof window.__startSoloRun==='function')window.__startSoloRun();
  const p=$$('salaPainel');if(p)p.classList.add('aberto');
  renderJogadores();
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
  const jogam=jogadoresSala.filter(j=>j.slot>0);
  const eu=jogadoresSala.find(j=>j.id===meuId)||{};
  box.innerHTML='';
  if(!meuSlot){
    box.innerHTML='<div class="spAviso">sala cheia — máximo de 8 participantes</div>';
    return;
  }
  if(emPartidaOnline||(salaLocal&&salaLocal.jogo)){
    if(ffaAtiva&&ffaLocal&&ffaLocal.estado&&ffaLocal.estado.phase==='finished'){
      const voltar=document.createElement('button');voltar.className='spPronto';
      voltar.textContent='↩ VOLTAR À SALA';voltar.onclick=()=>voltarAoLobby();
      box.appendChild(voltar);return;
    }
    const aviso=document.createElement('div');aviso.className='spAviso';
    aviso.textContent='Partida em andamento · '+(ffaAtiva?'todos jogam a cada rodada':'duelo 1 × 1');
    const abandonar=document.createElement('button');abandonar.className='spAbandonar';
    abandonar.textContent='⚑ ABANDONAR PARTIDA';
    abandonar.onclick=()=>{
      if(window.confirm('Abandonar agora encerrará esta partida e devolverá todos ao lobby. Continuar?'))
        env('abandono',{});
    };
    box.append(aviso,abandonar);
    return;
  }
  const aviso=document.createElement('div');aviso.className='spAviso';
  aviso.textContent=`${jogam.length}/8 jogadores · mínimo 2 · todos precisam estar prontos`;
  box.appendChild(aviso);
  if(jogam.length<2){
    const espera=document.createElement('div');espera.className='spAviso';
    espera.textContent='aguardando mais um jogador… compartilhe o código da sala';box.appendChild(espera);
    return;
  }
  if(souHost&&jogam.every(j=>j.pronto)){
    const iniciar=document.createElement('button');iniciar.className='spPronto on';
    iniciar.textContent=jogam.length>=3?`⚔ INICIAR FFA · ${jogam.length} JOGADORES`:'▶ INICIAR DUELO · 2 JOGADORES';
    iniciar.onclick=()=>env('iniciar',{});box.appendChild(iniciar);return;
  }
  const b=document.createElement('button');
  b.className='spPronto'+(eu.pronto?' on':'');
  b.textContent=eu.pronto?'✔ PRONTO (clique pra cancelar)':'ESTOU PRONTO';
  b.onclick=()=>env('pronto',{pronto:!eu.pronto,heroi:(window.hero&&hero.id)||'comedia'});
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
  d.style.left=(15+(randomOriginal?randomOriginal():Math.random())*70)+'%';
  document.body.appendChild(d);
  setTimeout(()=>d.remove(),2400);
}

/* ============================================================
   MULTIPLAYER — o anfitriao simula, o convidado acompanha
   ============================================================ */
let emPartidaOnline=false;
let ultimaFotoAnfitriao=0,fotoAgendada=0,fotoPendente=null,fotoAplicada=0,sincronizadoOnline=false;

const randomOriginal=Math.random;
window.__visualRandom=()=>randomOriginal();
let rngLigado=false,rngState=0,rngSetState=null;
function ligarRng(semente){
  let x=0;
  const str=String(semente||'caos');
  for(let i=0;i<str.length;i++) x=(x*31+str.charCodeAt(i))>>>0;
  if(!x)x=0x9e3779b9;
  rngState=x>>>0;
  rngSetState=v=>{x=Number(v)|0;rngState=x>>>0};
  Math.random=function(){                    // mulberry32 replicável entre os dois navegadores
    x|=0; x=(x+0x6D2B79F5)|0; rngState=x>>>0;
    let t=Math.imul(x^(x>>>15),1|x);
    t=(t+Math.imul(t^(t>>>7),61|t))^t;
    return ((t^(t>>>14))>>>0)/4294967296;
  };
  rngLigado=true;
}
function definirEstadoRng(valor){if(rngLigado&&rngSetState)rngSetState(valor)}
function desligarRng(){
  if(rngLigado){Math.random=randomOriginal;rngLigado=false}
  rngSetState=null;rngState=0;
}

/* A rodada só avança quando o anfitrião confirma. Isso mantém as duas
   telas no mesmo turno, mesmo quando o jogador 2 toca em "próxima" primeiro. */
let proximoOriginal=null, textoProximoOriginal='', avancoSolicitado=false;
let avancoRecebido=null, timerAvancoCliente=null;
function numeroRodada(){ return Number(window.st&&window.st.rd)||1 }
function instalarControleAvanco(){
  const botao=$$('next');
  if(!botao || botao.dataset.onlineHook) return false;
  proximoOriginal=botao.onclick;
  textoProximoOriginal=botao.textContent||'PRÓXIMA RODADA ▶';
  botao.onclick=function(ev){
    if(ffaAtiva){if(ev)ev.preventDefault();return}
    if(!emPartidaOnline)return proximoOriginal&&proximoOriginal.call(this,ev);
    if(ev) ev.preventDefault();
    if(avancoSolicitado) return;
    if(!meuSlot){ sistemaChat('Espectadores acompanham a rodada; só os jogadores podem avançar.'); return }
    if(this.style.display==='none') return;
    avancoSolicitado=true;
    this.disabled=true; this.textContent='⏳ AGUARDANDO…';
    env('proxima',{rodada:numeroRodada()});
  };
  botao.dataset.onlineHook='true';
  return true;
}
function restaurarBotaoAvanco(){
  const b=$$('next'); if(!b) return;
  b.disabled=false; b.textContent=textoProximoOriginal||'PRÓXIMA RODADA ▶';
}
function cancelarAvanco(texto){
  avancoSolicitado=false; avancoRecebido=null;
  if(timerAvancoCliente){clearTimeout(timerAvancoCliente);timerAvancoCliente=null}
  restaurarBotaoAvanco();
  if(texto) sistemaChat(texto);
}
function executarAvancoLocal(){
  if(!proximoOriginal) instalarControleAvanco();
  const b=$$('next');
  avancoSolicitado=false; avancoRecebido=null;
  if(timerAvancoCliente){clearTimeout(timerAvancoCliente);timerAvancoCliente=null}
  restaurarBotaoAvanco();
  if(b && proximoOriginal) proximoOriginal.call(b);
  if(!souHost) setTimeout(aplicarSnapshotPendente,40);
}
function aceitarAvanco(id,rodada){
  if(!salaLocal || !salaLocal.jogo) return;
  const r=Number(rodada);
  if(!Number.isInteger(r) || r<1 || r!==numeroRodada()) return;
  if(salaLocal.ultimaAvancada===r) return;
  if(salaLocal.avancoPendente) return;
  const pedido={id,rodada:r,inicio:Date.now(),timer:null};
  salaLocal.avancoPendente=pedido;
  tentarAvancoHost(pedido);
}
function tentarAvancoHost(pedido){
  if(!salaLocal || salaLocal.avancoPendente!==pedido || !salaLocal.jogo) return;
  if(numeroRodada()!==pedido.rodada){salaLocal.avancoPendente=null;return}
  const b=$$('next');
  if(!b || b.style.display==='none'){
    if(Date.now()-pedido.inicio>18000){
      salaLocal.avancoPendente=null;
      const mensagem='A rodada ainda está sendo resolvida. Tente avançar novamente em instantes.';
      if(pedido.id===meuId) cancelarAvanco(mensagem);
      else paraUm(pedido.id,'avancoErro',{texto:mensagem});
      return;
    }
    pedido.timer=setTimeout(()=>tentarAvancoHost(pedido),160);
    return;
  }
  salaLocal.avancoPendente=null;
  salaLocal.ultimaAvancada=pedido.rodada;
  salaLocal.sequenciaAvanco=(salaLocal.sequenciaAvanco||0)+1;
  const mensagem={tipo:'avancar',rodada:pedido.rodada,sequencia:salaLocal.sequenciaAvanco};
  conexoes.forEach(c=>{if(c.open){try{c.send(mensagem)}catch(e){}}});
  executarAvancoLocal();
}
function aplicarAvancoRemoto(rodada){
  if(!emPartidaOnline || souHost) return;
  const r=Number(rodada);
  if(!Number.isInteger(r) || r<1) return;
  if(numeroRodada()>r){cancelarAvanco();return}
  if(avancoRecebido && avancoRecebido.rodada===r) return;
  avancoRecebido={rodada:r,inicio:Date.now()};
  tentarAvancoCliente(avancoRecebido);
}
function tentarAvancoCliente(pedido){
  if(!emPartidaOnline || avancoRecebido!==pedido) return;
  if(numeroRodada()>pedido.rodada){cancelarAvanco();return}
  if(Date.now()-pedido.inicio>18000){cancelarAvanco('A sincronização demorou demais. Aguarde a próxima atualização da sala.');return}
  const b=$$('next');
  if(numeroRodada()!==pedido.rodada || !b || b.style.display==='none'){
    timerAvancoCliente=setTimeout(()=>tentarAvancoCliente(pedido),160);
    return;
  }
  sincronizadoOnline=false;
  executarAvancoLocal();
}
function enviarSnapshotAnfitriao(){
  if(!emPartidaOnline||!souHost||typeof window.__getOnlineSnapshot!=='function')return;
  const r=numeroRodada();
  if(r===ultimaFotoAnfitriao||fotoAgendada===r)return;
  fotoAgendada=r;
  setTimeout(()=>{
    if(fotoAgendada!==r)return;
    fotoAgendada=0;
    if(!emPartidaOnline||!souHost||!salaLocal||!salaLocal.jogo||numeroRodada()!==r)return;
    if(window.turn!==1||(window.picked&&picked[1]))return;
    try{
      const snapshot=window.__getOnlineSnapshot();
      ultimaFotoAnfitriao=r;
      env('snapshot',{dados:{rodada:r,snapshot,rng:rngState}});
    }catch(e){console.warn('snapshot host:',e)}
  },60);
}
function aplicarSnapshotRemoto(pacote,forcar=false){
  if(!emPartidaOnline||souHost||!pacote||!pacote.snapshot)return;
  const r=Number(pacote.rodada||pacote.snapshot.st?.rd);
  if(!Number.isInteger(r)||r<1)return;
  if(!forcar){
    if(r<numeroRodada()||r===fotoAplicada)return;
    if(r>numeroRodada()){
      if(!fotoPendente||r>=Number(fotoPendente.rodada))fotoPendente=pacote;
      sincronizadoOnline=false;
      return;
    }
    // Não sobrescreva uma rodada que já começou por causa de um pacote atrasado.
    if(window.turn!==1||(window.picked&&picked[1]))return;
  }
  try{
    if(typeof window.__applyOnlineSnapshot!=='function'||!window.__applyOnlineSnapshot(pacote.snapshot))return;
    if(typeof pacote.rng==='number')definirEstadoRng(pacote.rng);
    fotoAplicada=r; fotoPendente=null; sincronizadoOnline=true;
  }catch(e){console.warn('snapshot recebido:',e)}
}
function aplicarSnapshotPendente(){
  if(!fotoPendente||!emPartidaOnline||souHost)return;
  if(Number(fotoPendente.rodada)<=numeroRodada()){
    const pacote=fotoPendente;fotoPendente=null;aplicarSnapshotRemoto(pacote);
  }
}
function limparSincronizacaoSnapshot(){
  ultimaFotoAnfitriao=0;fotoAgendada=0;fotoPendente=null;fotoAplicada=0;sincronizadoOnline=false;
  window.__onlinePlayerNames=null;
  sequenciaJogada=0;sequenciasAceitas.clear();sequenciasAplicadas.clear();
  if(ffaTimerHost){clearTimeout(ffaTimerHost);ffaTimerHost=null}
  if(ffaTimerReveal){clearTimeout(ffaTimerReveal);ffaTimerReveal=null}
  ffaAtiva=false;ffaLocal={estado:null,mao:[],pendente:false};
  document.body.classList.remove('onlineActive','onlineFFA');
}

function iniciarPartidaOnline(semente,config,usarFFA=false){
  ultimaFotoAnfitriao=0;fotoAgendada=0;fotoPendente=null;fotoAplicada=0;
  sequenciaJogada=0;sequenciasAceitas.clear();sequenciasAplicadas.clear();
  if(ffaTimerHost){clearTimeout(ffaTimerHost);ffaTimerHost=null}
  if(ffaTimerReveal){clearTimeout(ffaTimerReveal);ffaTimerReveal=null}
  ffaAtiva=false;ffaLocal={estado:null,mao:[],pendente:false};
  atualizarNomesPartida();
  sincronizadoOnline=!!souHost;
  jaEncerrou=false;avancoSolicitado=false;avancoRecebido=null;
  if(salaLocal){salaLocal.ultimaAvancada=0;salaLocal.avancoPendente=null}
  instalarControleAvanco();
  try{
    if(typeof window.__setOnlineConfig==='function')window.__setOnlineConfig(config||{});
    else document.querySelectorAll('.foeSelectOverlay').forEach(x=>x.remove());
  }catch(e){document.querySelectorAll('.foeSelectOverlay').forEach(x=>x.remove())}
  if(window.mode!==undefined)window.mode=2;
  emPartidaOnline=true;window.__onlineSession=true;
  atualizarNomesPartida();
  document.body.classList.add('onlineActive');document.body.classList.remove('onlineFFA');
  const painel=$$('salaPainel');if(painel)painel.classList.remove('aberto');
  sistemaChat(usarFFA?'⚔ FFA iniciado: todos contra todos!':'🎮 O duelo online começou!');
  try{
    if(window.S)S.fanfare();
    window.mode=2;ligarRng(semente);
    if(usarFFA){comecarArenaFFA();}
    else{
      if(typeof startNewRun==='function'){window.__semente=semente;startNewRun()}
      if(typeof log==='function'){
        const outro=jogadoresSala.find(j=>j.slot&&j.id!==meuId)||{};
        log('🌐 <b>PARTIDA ONLINE</b> — você é o <b>JOGADOR '+meuSlot+'</b>.');
        log('⚔ adversário: <b>'+esc(outro.nome||'?')+'</b>. Use o 💬 para conversar.');
      }
    }
  }catch(e){console.error(e)}
  atualizarIndicadorTurno();renderJogadores();
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
    if(ffaAtiva)return;
    if(emPartidaOnline){
      if(!souHost&&!sincronizadoOnline){
        if(typeof log==='function')log('🔄 <b>sincronizando</b> a rodada com o anfitrião…');
        return;
      }
      const meuTurno=(window.turn===meuSlot);
      if(!meuTurno){
        if(typeof log==='function')log('⏳ <b>aguarde</b> — é a vez do seu adversário.');
        return;
      }
      if(window.busy)return; // impede toque/clique duplo de enviar a mesma carta duas vezes
      const indice=Number(i), carta=window.hands&&window.hands[window.turn]&&window.hands[window.turn][indice];
      if(!Number.isInteger(indice)||!carta)return;
      env('jogada',{dados:{acao:'carta',indice,turno:window.turn,seq:++sequenciaJogada,carta:assinaturaCarta(carta)}});
      const r = await chooseOriginal.apply(this,arguments);
      setTimeout(destravarPasseDeVez,80);
      return r;
    }
    return chooseOriginal.apply(this,arguments);
  };

  if(typeof window.useItem==='function'){
    const itemOriginal=window.useItem;
    window.__useItemOriginal=itemOriginal;
    window.useItem=function(i){
      if(ffaAtiva)return;
      if(emPartidaOnline){
        if(!souHost&&!sincronizadoOnline){
          if(typeof log==='function')log('🔄 <b>sincronizando</b> a rodada com o anfitrião…');
          return;
        }
        if(window.turn!==meuSlot){
          if(typeof log==='function')log('⏳ <b>aguarde</b> — é a vez do seu adversário.');
          return;
        }
        if(window.busy)return;
        const indice=Number(i), item=window.inv&&window.inv[window.turn]&&window.inv[window.turn][indice];
        if(!Number.isInteger(indice)||!item||item.used)return;
        env('jogada',{dados:{acao:'item',indice,turno:window.turn,seq:++sequenciaJogada,item:assinaturaItem(item)}});
      }
      return itemOriginal.apply(this,arguments);
    };
  }

  if(typeof window.upd==='function'&&!window.upd.__onlineNameHook){
    const updOriginal=window.upd;
    const updComNomes=function(){
      const r=updOriginal.apply(this,arguments);
      atualizarNomesPartida();
      return r;
    };
    updComNomes.__onlineNameHook=true;
    window.upd=updComNomes;
  }

  if(typeof window.finish==='function'){
    const fimOriginal=window.finish;
    window.finish=function(){
      if(ffaAtiva)return;
      const onlineAntes=emPartidaOnline;
      const r=fimOriginal.apply(this,arguments);
      if(onlineAntes && window.over){
        emPartidaOnline=false;window.__onlineSession=false;
        desligarRng();limparSincronizacaoSnapshot();
        env('fim',{dados:{hp1:window.st&&st.hp1,hp2:window.st&&st.hp2}});
        try{window.__restoreOnlineConfig&&window.__restoreOnlineConfig()}catch(e){}
        const overlay=[...document.querySelectorAll('.overlay')].pop();
        const repetir=overlay&&[...overlay.querySelectorAll('button.big')]
          .find(b=>b.textContent.toUpperCase().includes('JOGAR DE NOVO'));
        if(repetir){
          repetir.textContent='VOLTAR À SALA';
          repetir.onclick=()=>{
            try{window.S&&S.click()}catch(e){}
            overlay.remove();
            const painel=$$('salaPainel'); if(painel) painel.classList.add('aberto');
          };
        }
        setTimeout(()=>{ if($$('salaPainel')) $$('salaPainel').classList.add('aberto') },1500);
      }
      return r;
    };
  }

  if(typeof window.resolve==='function'){
    const resolveOriginal=window.resolve;
    window.resolve=function(){
      if(ffaAtiva)return;
      const r=resolveOriginal.apply(this,arguments);
      if(emPartidaOnline&&souHost)setTimeout(()=>{
        if(!emPartidaOnline||!window.st)return;
        env('estado',{dados:{hp1:st.hp1,hp2:st.hp2,rd:st.rd,
                             score:st.score,mult:st.mult,turno:window.turn}});
      },1650);
      return r;
    };
  }

  if(typeof window.renderTurn==='function'){
    const renderOriginal=window.renderTurn;
    window.renderTurn=function(){
      const r=renderOriginal.apply(this,arguments);
      if(ffaAtiva)return r;
      if(emPartidaOnline){
        atualizarNomesPartida();
        if(window.turn!==meuSlot){
          const mao=$$('hand'),itens=$$('items'),lbl=$$('handlbl');
          if(mao){mao.innerHTML='';const espera=document.createElement('div');espera.className='spAguardando';
            espera.textContent='⏳ aguardando a jogada do adversário…';mao.appendChild(espera)}
          if(itens)itens.innerHTML='';
          if(lbl)lbl.textContent='VEZ DO ADVERSÁRIO';
        }
        atualizarIndicadorTurno();
        // o anfitriao dita o estado depois de cada rodada
        if(souHost){
          setTimeout(()=>{
            if(!emPartidaOnline||!window.st)return;
            env('estado',{dados:{hp1:st.hp1,hp2:st.hp2,rd:st.rd,
                                 score:st.score,mult:st.mult,turno:window.turn}});
          },60);
          enviarSnapshotAnfitriao();
        }
      }
      return r;
    };
  }
  return true;
}

function aplicarJogadaRemota(m){
  if(!emPartidaOnline)return;
  const d=m.dados||{},slot=Number(m.slot),seq=Number(d.seq);
  if((slot!==1&&slot!==2)||!Number.isSafeInteger(seq)||seq<1)return;
  if(seq<=(sequenciasAplicadas.get(slot)||0))return;
  sequenciasAplicadas.set(slot,seq);
  if(Number(d.turno)!==slot||Number(window.turn)!==slot){
    solicitarRessincronizacao('A rodada saiu de sincronia; restaurando o estado do anfitrião.');
    return;
  }
  const indice=Number(d.indice);
  if(d.acao==='carta'){
    const carta=window.hands&&window.hands[slot]&&window.hands[slot][indice];
    if(!Number.isInteger(indice)||!carta||d.carta!==assinaturaCarta(carta)){
      solicitarRessincronizacao('A mão local divergiu; restaurando as cartas da rodada.');return;
    }
    const original=window.__chooseOriginal||window.choose;
    if(typeof original!=='function')return;
    try{
      window.busy=false;
      const p=original(indice);
      if(p&&typeof p.then==='function')p.catch(e=>console.warn('jogada remota:',e));
    }catch(e){console.warn('jogada remota:',e);solicitarRessincronizacao('Não foi possível aplicar a carta.');return}
  }else if(d.acao==='item'){
    const item=window.inv&&window.inv[slot]&&window.inv[slot][indice];
    if(!Number.isInteger(indice)||!item||item.used||d.item!==assinaturaItem(item)){
      solicitarRessincronizacao('O inventário local divergiu; restaurando a rodada.');return;
    }
    const original=window.__useItemOriginal||useItem;
    if(typeof original!=='function')return;
    const busyAntes=window.busy;
    try{window.busy=false;original(indice)}
    catch(e){console.warn('item remoto:',e);solicitarRessincronizacao('Não foi possível aplicar o item.');return}
    finally{if(!window.over)window.busy=busyAntes}
  }else return;
  if(!souHost)sincronizadoOnline=true;
  setTimeout(destravarPasseDeVez,120);
  atualizarIndicadorTurno();
}
function aplicarEstadoRemoto(dados){
  if(!dados || !window.st) return;
  try{
    if(typeof dados.hp1==='number') st.hp1=dados.hp1;
    if(typeof dados.hp2==='number') st.hp2=dados.hp2;
    // st.rd avança junto com o botão sincronizado, não por snapshot parcial.
    if(typeof dados.score==='number') st.score=dados.score;
    if(typeof dados.mult==='number')  st.mult=dados.mult;
    if(typeof dados.turno==='number' && window.turn!==undefined) window.turn=dados.turno;
    if(typeof upd==='function') upd();
    atualizarIndicadorTurno();
  }catch(e){}
}
function atualizarIndicadorTurno(){
  let e=$$('turnoOnline');
  if(ffaAtiva||!emPartidaOnline){if(e)e.style.display='none';return}
  if(!e){
    e=document.createElement('div'); e.id='turnoOnline';
    document.body.appendChild(e);
  }
  e.style.display='block';
  const meuTurno=(window.turn===meuSlot);
  e.className=meuTurno?'meuTurno':'turnoDele';
  const slotAtual=Number(window.turn)||1;
  const nome=(window.__onlinePlayerNames||{})[slotAtual]||('JOG. '+slotAtual);
  e.textContent=(meuTurno?'▶ SUA VEZ · ':'⏳ VEZ DE ')+nome+' · R'+numeroRodada();
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
  instalarControleAvanco();
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
