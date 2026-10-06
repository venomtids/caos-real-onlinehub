# 🎭 CAOS REAL — versão GitHub Pages (sem servidor)

Esta versão roda **inteira no navegador**. Não existe servidor, não existe
conta de hospedagem, não existe cartão de crédito. Até oito jogadores entram
na mesma sala, conectados **diretamente** pela internet (WebRTC) ao navegador anfitrião.

Perfeita pro GitHub Pages, que é grátis e permanente.

---

## Como pôr no ar (5 minutos)

1. Entre em <https://github.com> e crie uma conta, se ainda não tiver.
2. Clique no **+** (canto superior direito) → **New repository**.
   - **Repository name**: `caos-real`
   - Marque **Public**
   - **NÃO** marque "Add a README file"
   - **Create repository**
3. Na tela seguinte, clique em **"uploading an existing file"**.
4. Arraste os **3 arquivos** desta pasta:
   - `index.html`
   - `online.js`
   - `online.css`

   ⚠️ Arraste os arquivos soltos, **não** a pasta. O `index.html`
   precisa ficar na raiz do repositório.
5. Escreva qualquer coisa em "Commit changes" e confirme.
6. Vá em **Settings** (aba do repositório) → **Pages** (menu da esquerda).
7. Em **Source**, escolha **Deploy from a branch**.
   Em **Branch**, escolha **main** e a pasta **/ (root)**. Clique em **Save**.
8. Espere 1–2 minutos e recarregue a página. Vai aparecer:

   > Your site is live at `https://SEUUSUARIO.github.io/caos-real/`

Pronto. Esse é o link. Mande pros amigos.

---

## Como jogar junto

1. Os jogadores abrem o link.
2. Uma pessoa clica em **🚪 CRIAR SALA** e recebe um código de 4 letras (ex.: `PHZ5`).
3. Até **7 pessoas** entram com o código — a sala comporta **8 jogadores contando o anfitrião**.
4. Todos marcam **ESTOU PRONTO**; quando todos estiverem prontos, o anfitrião clica em **INICIAR PARTIDA**.
5. Com **2 jogadores**, a sala inicia um duelo. Com **3 a 8**, inicia o modo **todos contra todos**: cada pessoa escolhe uma carta ao mesmo tempo, e a regra e as cartas são reveladas juntas.
6. O botão **💬** abre o chat. Dá para mandar emotes também.

Todos os lugares da sala são jogáveis. A sala não aceita novas entradas depois que a partida começou. No FFA, cada jogador tem vida própria; quem perde vida pode ser eliminado, e a última pessoa sobrevivente (ou a melhor colocada ao fim de 12 rodadas) vence. Pelo painel da sala, um jogador pode **abandonar a partida** e devolver todos ao lobby sem fechar a sala; no duelo 1 × 1, jogadas repetidas ou fora de turno são bloqueadas e a tela pode ser ressincronizada pelo anfitrião.

---

## ⚠️ A única regra importante

**A sala vive na aba de quem criou.**

Não tem servidor guardando nada, então o navegador do anfitrião é quem segura
a sala. Isso significa:

- Quem criou a sala **precisa manter a aba aberta** até o fim da partida.
- Se essa pessoa fechar a aba, a sala acaba e o outro volta pro lobby
  (com aviso na tela — ninguém fica travado).
- O jogo avisa antes de fechar, se ainda tiver gente na sala.

Pra jogar com amigos combinados, isso não atrapalha em nada.

---

## Perguntas comuns

**Preciso pagar alguma coisa?**
Não. GitHub Pages é grátis e não pede cartão. O serviço que apresenta os dois
navegadores um ao outro (PeerJS) também é grátis e público.

**O site dorme como no Render?**
Não. É um site estático — está sempre no ar, sem espera nenhuma.

**Funciona em celular?**
Sim. O lobby e o jogo se adaptam à tela pequena: as cartas e os itens podem ser deslizados na horizontal, o HUD fica em uma faixa rolável e os botões têm áreas maiores para toque. Para jogar online no celular, mantenha a página aberta durante a partida.

**Dá pra jogar sozinho?**
Dá. O botão **🎮 JOGAR SOZINHO** roda o jogo completo contra o computador,
sem usar rede nenhuma.

**E se a conexão entre os dois não rolar?**
É raro, mas algumas redes muito fechadas (Wi-Fi corporativo, alguns
provedores) bloqueiam conexão direta entre navegadores. Nesse caso, tentem
de outra rede — ou usem a versão com servidor (pasta `caos-online`).

**Posso atualizar o jogo depois?**
Pode. Suba o arquivo novo no GitHub e o site atualiza em 1–2 minutos.

---

## O que tem em cada arquivo

| arquivo | o que é |
|---|---|
| `index.html` | o jogo inteiro — 688 cartas, 24 personagens, 55 níveis |
| `online.js` | lobby, salas, chat, duelo 1 × 1 e modo FFA de até 8 jogadores |
| `online.css` | visual do lobby, chat e arena todos contra todos |

Nenhum outro arquivo é necessário. Não tem `npm install`, não tem build.

---

## Diferença pra pasta `caos-online`

| | `caos-pages` (esta) | `caos-online` |
|---|---|---|
| precisa de servidor | não | sim (Node.js) |
| onde hospedar | GitHub Pages, grátis | Render, Railway… |
| pede cartão | nunca | depende do serviço |
| sala vive onde | na aba do anfitrião | no servidor |
| anfitrião pode fechar a aba | não | pode |

As duas jogam igual. Escolha pela hospedagem que você prefere.
