# IdleLive

Painel local para quem joga jogos idle com várias contas e ganha bônus assistindo lives de streamers parceiros. Ele cuida disso na **Twitch** e na **Kick** por você.

- **Twitch:** suas contas (até 4) entram sozinhas no chat dos canais parceiros que estão ao vivo. É assim que o jogo reconhece que você está assistindo e libera o bônus de XP (+15% pela primeira live, +2,5% por live a mais).
- **Kick:** mostra quais parceiros estão ao vivo e abre a live numa janela pequena, com a conta que você escolher, num clique. Os pontos de canal da Kick só sobem assistindo de verdade, então o painel não tenta burlar isso.

Tudo roda no seu próprio PC. Nada é enviado para servidores de terceiros além da própria Twitch e da Kick.

## O que ele faz

**Twitch**
- Vincula até 4 contas com o login oficial da Twitch, por código. Ele nunca pede a sua senha.
- A cada minuto vê quem está ao vivo, entra no chat dos canais ao vivo e sai quando a live acaba.
- Para cada conta, você escolhe se ela entra em todos os canais parceiros ou só em alguns.
- Mostra o bônus estimado de cada conta e quanto tempo ela ficou com boost hoje.
- Tem um histórico dos últimos dias, com as horas de boost e o bônus médio de cada conta.
- Reconecta sozinho se a internet cair e renova o login das contas automaticamente.

**Kick**
- Mostra o status ao vivo e o número de espectadores dos parceiros, pela API oficial da Kick.
- Cada conta da Kick é um perfil do navegador (Chrome, Brave ou Edge). O botão **▶** abre a live daquele perfil numa janela pequena, e as janelas ficam lado a lado no canto da tela.
- **▶ Todas** abre a live em todas as contas de uma vez. **✕ Fechar janelas** fecha as janelas que o painel abriu.

**Painel**
- Menu lateral com **Visão geral** (resumo de tudo), **Twitch**, **Kick**, **Histórico** e **Configurações**. No celular, ele vira uma gaveta no botão ☰.

**Geral**
- Uma barrinha de 24 horas em cada canal mostra os horários em que ele costuma estar ao vivo. O painel vai aprendendo enquanto fica aberto.
- Tem a opção **Iniciar com o Windows**, que abre o painel minimizado quando o PC liga.
- O botão **Reiniciar servidor** fecha e abre o servidor de novo, para carregar atualizações sem fechar a janela preta.
- O botão **Hub** leva direto para o hub do jogo.

## Do que você precisa

- Windows 10 ou 11.
- [Node.js](https://nodejs.org) versão 20 ou mais nova. Baixe a versão **LTS** e vá clicando em "Avançar".
- Internet: além da Twitch e da Kick, o visual do painel (componentes Web Awesome e fonte Montserrat) carrega da internet.
- Google Chrome, Brave ou Microsoft Edge. Só é necessário para a parte da Kick. O Edge já vem no Windows. O Firefox não é compatível.

## Instalação

1. Baixe o projeto: botão verde **Code → Download ZIP** aqui no GitHub. Depois extraia numa pasta.
   Se você usa git: `git clone https://github.com/RicardooFilho/idlelive.git`
2. Dê dois cliques em **`iniciar.bat`**.
   Vai abrir uma janela preta (o servidor) e o painel no navegador, em http://localhost:3000.
   Deixe a janela preta aberta. Pode minimizar.

Não precisa rodar `npm install`: o projeto não tem dependências.

## Primeiros passos

### Twitch
1. No painel, clique em **+ Vincular conta**.
2. Vai aparecer um link e um código. Abra o link **numa janela anônima**, para não confirmar na conta errada.
3. Entre na conta da Twitch que você quer vincular e confirme o código.
4. Repita para cada conta, até 4.

Pronto. As contas entram sozinhas nos chats quando os parceiros estiverem ao vivo.

### Kick (opcional)
1. Em **kick.com → Configurações → Desenvolvedor**, crie um app. Em Redirect URL, coloque `http://localhost`.
2. Cole o **Client ID** e o **Client Secret** na página **Configurações** do painel. Não mostre o Client Secret para ninguém.
3. No seu navegador (Chrome, Brave ou Edge), crie um perfil para cada conta da Kick e faça login na Kick em cada um. Se tiver mais de um instalado, escolha qual usar no campo **Navegador** do painel.
4. No painel, marque os perfis que vão ser as suas contas.
5. Quando um parceiro estiver ao vivo, clique em **▶** ou em **▶ Todas**.

Dica: na primeira vez, escolha 160p no player da Kick para gastar menos internet e PC.

### Lista de parceiros
O painel já vem com os parceiros atuais. Se o jogo adicionar ou remover algum, use o campo **Adicionar** embaixo de cada lista. Para remover, passe o mouse no canal e clique no **✕**.

## Seus dados e segurança

Esses arquivos são criados na pasta do projeto e **nunca devem ser enviados para ninguém**:

| Arquivo | O que guarda |
|---|---|
| `accounts.json` | Login das contas da Twitch (tokens) |
| `kick.json` | Client ID e Client Secret do seu app da Kick |
| `stats.json` | Histórico de boost e horários das lives |

Eles já estão no `.gitignore`. O painel só aceita conexões do próprio PC (`127.0.0.1`), então ninguém na sua rede consegue abrir ele.

## Perguntas frequentes

**Pesa no PC?**
Quase nada. A parte da Twitch é só texto (chat), sem vídeo. O que pesa são as janelas da Kick, porque elas são lives de verdade.

**E se a internet cair?**
O painel percebe em até uns 3 minutos e reconecta sozinho quando a internet voltar.

**Uma conta aparece "Vincule de novo". O que faço?**
O login dela expirou ou foi cancelado na Twitch. Clique em **Vincular** no card e confirme o código de novo.

**Aparece "porta 3000 em uso".**
O painel já está aberto em outra janela preta. Use essa, ou feche ela antes de abrir de novo.

**O PowerShell bloqueia o `npm start`.**
Use o `iniciar.bat`, que não depende disso.

## O que ele não faz (de propósito)

- Não cria espectadores falsos e não abre lives escondidas.
- Não dá play sozinho na Kick. Toda janela é aberta por um clique seu.
- Não automatiza resgate de pontos ou recompensas.

Isso mantém as suas contas dentro das regras da Twitch, da Kick e do jogo.

## Para desenvolvedores

Node.js puro (ES modules), sem dependências no servidor. O painel usa o [Web Awesome](https://webawesome.com) 3.14.0 (licença MIT) e a fonte Montserrat, carregados de CDN com versão fixa, sem build.

```
server.js              servidor HTTP do painel + orquestração
public/index.html      o painel (HTML/CSS/JS num arquivo só, com Web Awesome)
public/favicon.ico     ícone do IdleLive
src/twitch.js          login por código, tokens e status das lives (Helix)
src/chat.js            conexão IRC com o chat da Twitch, com reconexão
src/kick.js            status das lives pela API oficial da Kick
src/browser.js         navegadores (Chrome, Brave, Edge), perfis e janelas da Kick
src/open-window.ps1    abre a janela e posiciona na tela
src/close-windows.ps1  fecha as janelas abertas pelo painel
src/win.cs             funções do Windows usadas pelos dois scripts acima
src/stats.js           histórico de boost e horários
src/autostart.js       atalho "Iniciar com o Windows"
src/store.js           leitura e gravação dos arquivos .json
config.json            Client ID da Twitch e listas de canais
```

Para trocar a porta, defina `PORT` antes de iniciar (ex.: `set PORT=3005`).

Veja o [CHANGELOG.md](CHANGELOG.md) para o histórico de mudanças e o [AGENTS.md](AGENTS.md) para as regras do projeto.
