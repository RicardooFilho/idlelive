# IdleLive

Painel local para quem joga jogos idle com várias contas e ganha bônus assistindo lives de streamers parceiros. Ele cuida disso na **Twitch** e na **Kick** por você.

- **Twitch:** mostra quais parceiros estão ao vivo e até 4 contas suas juntam **pontos do canal** neles sozinhas. Com esses pontos você resgata o bônus de XP do jogo.
- **Kick:** mostra quais parceiros estão ao vivo e até 4 contas suas juntam **pontos do canal** neles em segundo plano, como na Twitch.

Tudo roda no seu próprio PC. Nada é enviado para servidores de terceiros além da própria Twitch e da Kick.

## O que ele faz

**Twitch**
- A cada minuto vê quais parceiros estão ao vivo e quantas pessoas estão assistindo. Isso funciona sem vincular conta.
- Vincula até 4 contas com o login oficial da Twitch, por código. Ele nunca pede a sua senha, e renova o login sozinho.
- **Pontos do canal:** cada conta junta pontos nos canais oficiais ao vivo. Ela "assiste" até 2 lives por vez (o máximo que a Twitch conta por conta), escolhidas pelos saldos dela, e pega o bônus sozinha. Primeiro ela assiste uns 7 minutos de cada live nova, para manter a sequência (watch streak, que dá de 300 a 450 pontos extras). No resto do tempo, fica nas lives onde já tem mais pontos.
- Age como uma pessoa: descansa das 5h às 8h (Brasília, uns 12% a menos de pontos), pega baús e Momentos depois de alguns segundos, e cada conta age num momento diferente.
- Pega os **Momentos** dos canais oficiais e o baú assim que a Twitch avisa.
- Entra nas **raids** de um canal oficial para outro canal oficial, se a conta estava assistindo quem fez a raid.
- **Segue todos os canais da lista**, um por vez a cada 3 a 10 minutos (só uma vez por canal: se você deixar de seguir, a conta não segue de novo).
- O botão **▶** ao lado de cada canal abre a live no navegador, na conta certa, para você resgatar as recompensas.
- Mostra o saldo em todos os canais da lista, ao vivo ou offline, quanto subiu desde que o painel abriu e quantos bônus foram pegos.

**Kick**
- Mostra o status ao vivo e o número de espectadores dos parceiros (pela API oficial, se você criar o app da Kick, ou canal por canal sem ele).
- **Pontos do canal:** até 4 contas, cada uma "assiste" até 2 lives por vez em segundo plano, sempre as lives onde ela tem mais pontos. Na Kick os pontos vêm só do tempo assistido.
- Mesmas travas da Twitch: descanso das 5h às 8h (Brasília), tempos aleatórios e poucas leituras de saldo.
- **Segue todos os canais da lista** aos poucos, como na Twitch.
- O botão **▶** abre a live no navegador, no perfil da conta, para você resgatar as recompensas.

**Painel**
- Menu lateral com **Visão geral** (resumo de tudo), **Twitch**, **Kick**, **Histórico** (pontos por dia e de onde vieram) e **Configurações**.
- No topo, o ícone de inseto 🐞 lista os erros da Twitch e da Kick, e o de presente 🎁 lista os baús, Momentos, raids e follows, dos últimos 30 dias.
- Avisos no topo quando algo para de funcionar (conta para vincular de novo, Twitch recusando pedidos, conexão caída). No celular, ele vira uma gaveta no botão ☰.

**Geral**
- Tem a opção **Iniciar com o Windows**, que abre o painel minimizado quando o PC liga.
- O botão **Reiniciar servidor** fecha e abre o servidor de novo, para carregar atualizações sem fechar a janela preta.
- O botão **Hub** leva direto para o hub do jogo.

## Do que você precisa

- Windows 10 ou 11.
- [Node.js](https://nodejs.org) versão 22 ou mais nova (na 20 funciona, mas sem os Momentos e sem o motivo dos pontos no histórico). Baixe a versão **LTS** e vá clicando em "Avançar".
- Internet: além da Twitch e da Kick, o visual do painel (componentes Web Awesome e fonte Montserrat) carrega da internet.
- Google Chrome, Brave ou Microsoft Edge, só para o botão **▶** abrir as lives no perfil de cada conta. O Edge já vem no Windows. O Firefox não é compatível.

## Instalação

1. Baixe o projeto: botão verde **Code → Download ZIP** aqui no GitHub. Depois extraia numa pasta.
   Se você usa git: `git clone https://github.com/RicardooFilho/idlelive.git`
2. Dê dois cliques em **`iniciar.bat`**.
   Vai abrir uma janela preta (o servidor) e o painel no navegador, em http://localhost:3000.
   Deixe a janela preta aberta. Pode minimizar.

Não precisa rodar `npm install`: o projeto não tem dependências.

## Primeiros passos

### Twitch
1. Na página **Twitch**, em **Pontos do canal**, clique em **+ Vincular conta**.
2. Vai aparecer um link e um código. Abra o link **numa janela anônima**, para não confirmar na conta errada.
3. Entre na conta da Twitch que vai juntar os pontos e confirme o código.
4. Repita para cada conta, até 4.

Pronto. As contas juntam pontos sozinhas quando os parceiros estiverem ao vivo.

Para o botão **▶** abrir a live já logada na conta certa: crie um perfil no navegador (Chrome, Brave ou Edge) para cada conta, entre na Twitch com ela e escolha esse perfil em **Configurações → Navegador e perfis**.

### Kick
A Kick não tem login por código: cada conta entra pelo **token** dela, que fica no navegador.
1. Na página **Kick**, em **Pontos do canal**, clique em **+ Adicionar conta**.
2. Mostre a barra de favoritos (**Ctrl+Shift+B**) e arraste o botão **⚡ Enviar para o IdleLive** para ela. Só na primeira vez (em cada navegador ou perfil).
3. Abra **kick.com** no perfil da conta, já logado, e clique no favorito **Enviar para o IdleLive**. O painel abre e pergunta se pode adicionar a conta. Repita para cada conta, até 4.

Se o favorito não funcionar, dá para fazer à mão: no kick.com aperte **F12** → aba **Application** → **Cookies → https://kick.com**, copie o valor de `session_token` e cole na janela **Adicionar conta**.

O token fica só no seu PC, no `kick.json`. Não mostre ele para ninguém: quem tem o token entra na conta. Se o card mostrar **Token recusado**, pegue um token novo do mesmo jeito e use **Trocar token**.

Opcional: em **Configurações → App da Kick**, cole o Client ID e o Client Secret de um app da Kick (**kick.com → Configurações → Desenvolvedor**, Redirect URL `http://localhost`). Com ele, o painel vê quem está ao vivo num pedido só, em vez de canal por canal.

### Lista de parceiros
O painel já vem com os parceiros atuais. Se o jogo adicionar ou remover algum, use o campo **Adicionar canal** em cima de cada lista. Para remover, clique no **✕** do canal.

## Seus dados e segurança

Esses arquivos são criados na pasta do projeto e **nunca devem ser enviados para ninguém**:

| Arquivo | O que guarda |
|---|---|
| `kick.json` | Tokens das contas da Kick, app da Kick e navegador escolhido |
| `stats.json` | Horários das lives e histórico de pontos por dia |
| `points.json` | Login das contas de pontos do canal (tokens) |
| `eventos.jsonl` | Erros e baús/Momentos/raids dos últimos 30 dias (as listas do topo) |

Se você usava uma versão antiga, o `accounts.json` (contas do chat) não é mais usado e pode ser apagado.

Eles já estão no `.gitignore`. O painel só aceita conexões do próprio PC (`127.0.0.1`), então ninguém na sua rede consegue abrir ele.

## Perguntas frequentes

**Pesa no PC?**
Quase nada. As contas de pontos não baixam o vídeo das lives, só fazem pequenos pedidos de tempos em tempos.

**E se a internet cair?**
O painel percebe em até uns 3 minutos e reconecta sozinho quando a internet voltar.

**Uma conta de pontos aparece "Vincule de novo". O que faço?**
O login dela expirou ou foi cancelado na Twitch. Clique em **Vincular de novo** no card e confirme o código.

**Aparece "porta 3000 em uso".**
O painel já está aberto em outra janela preta. Use essa, ou feche ela antes de abrir de novo.

**O PowerShell bloqueia o `npm start`.**
Use o `iniciar.bat`, que não depende disso.

## O que ele não faz (de propósito)

- Não resgata recompensas com os pontos. Ele só junta os pontos e pega o bônus; o resgate é com você, pelo botão **▶**.

## Para desenvolvedores

Node.js puro (ES modules), sem dependências no servidor. O painel usa o [Web Awesome](https://webawesome.com) 3.14.0 (licença MIT) e a fonte Montserrat, carregados de CDN com versão fixa, sem build.

```
server.js              servidor HTTP do painel + orquestração
public/index.html      o painel (HTML/CSS/JS num arquivo só, com Web Awesome)
public/favicon.ico     ícone do IdleLive
src/twitch.js          login por código, tokens e status das lives (GQL, sem login)
src/points.js          pontos do canal: minutos assistidos, baús, Momentos e conexão em tempo real (PubSub)
src/kick.js            API da Kick: lives, números do canal, conta, saldo e token de espectador
src/kickpoints.js      pontos do canal na Kick: conexão de espectador e saldos
src/human.js           travas comuns às duas plataformas (descanso, tempos aleatórios)
src/browser.js         navegadores (Chrome, Brave, Edge), perfis e o botão ▶
src/stats.js           horários das lives e histórico de pontos
src/events.js          erros e baús/Momentos/raids dos últimos 30 dias (eventos.jsonl)
src/autostart.js       atalho "Iniciar com o Windows"
src/store.js           leitura e gravação dos arquivos .json
test/*.test.js         testes automatizados (node:test, sem dependências)
scripts/check.js       confere a sintaxe de todos os .js
.github/workflows/     CI: sintaxe e testes no Node 20, 22 e 24 a cada push
config.json            listas de canais
```

Para trocar a porta, defina `PORT` antes de iniciar (ex.: `set PORT=3005`).

Para conferir o código: `npm run check` (sintaxe de todos os arquivos) e `npm test` (testes). Os testes não usam internet nem as suas contas: os arquivos de dados ficam numa pasta temporária (`IDLELIVE_DATA_DIR`). O GitHub Actions roda os dois a cada push e pull request.

Veja o [CHANGELOG.md](CHANGELOG.md) para o histórico de mudanças e o [AGENTS.md](AGENTS.md) para as regras do projeto.
