# Regras para agentes de IA

Leia antes de mexer no projeto. Elas valem para qualquer agente (Claude, Copilot, Cursor, etc.).

## Sobre o projeto

IdleLive é um painel local (Node.js) para jogadores de jogos idle que dão bônus por assistir lives de parceiros:
- **Twitch:** mostra quem está ao vivo e até 4 contas juntam **pontos do canal** nas lives dos parceiros (`src/points.js`, baseado no Twitch Channel Points Miner v2). O jogo dá o bônus de XP para quem resgata com esses pontos;
- **Kick:** lista as lives dos parceiros e até 4 contas juntam **pontos do canal** em segundo plano (`src/kickpoints.js`, baseado no Kick Channel Points Miner de Baillora). O login é o token da conta, colado no painel;
- **LoLdle:** até 5 contas da Twitch ficam em silêncio no **chat** (IRC) dos parceiros que estão ao vivo (`src/lolidle.js` e `src/chat.js`). É a presença no chat que dá o bônus desse jogo; não assistem a live nem juntam pontos.

Cada jogo (Pokeidle e LoLdle) pode ser desligado em Configurações → Jogos (`gameEnabled` em `src/store.js`).

O público é de jogadores, não programadores. Veja o [README.md](README.md).

## Segurança e dados

- **Nunca** leia em voz alta, copie, faça commit ou envie `accounts.json`, `kick.json`, `points.json`, `lolidle.json`, `stats.json` ou `.token.json`. Eles têm tokens, segredos e dados das contas e estão no `.gitignore`. Antes de cada commit, confira com `git status` que nenhum deles entrou.
- Não peça para o usuário colar segredos (Client Secret, tokens) no chat. Eles são colados só no painel local.
- O servidor escuta só em `127.0.0.1`. Não mude para `0.0.0.0`.
- O servidor só atende o próprio painel: confere o `Host` (tem de ser `localhost` ou `127.0.0.1`) e, na API, o `Origin` (`server.js`). Sem isso, qualquer site aberto no navegador mandaria pedidos para o painel. Não tire essas checagens nem adicione cabeçalhos de CORS.
- O servidor abre a porta **antes** de renovar os logins: uma segunda janela do painel para na porta ocupada sem gastar o refresh token de ninguém. Mantenha essa ordem.
- Não altere configurações do sistema, como a política de execução do PowerShell. Para rodar, use `iniciar.bat` ou `node server.js`.

## Código

- Node.js 20+, ES modules, **sem dependências**. Não adicione pacotes do npm. Use `fetch`, `node:tls`, `node:http`, `WebSocket` etc. O `WebSocket` global só existe no Node 22+: sem ele, a conexão em tempo real (`PubSub` em `src/points.js`) fica desligada e o resto continua funcionando.
- O painel é um arquivo só (`public/index.html`), sem framework e sem build. Os componentes são do **Web Awesome 3.14.0** (`<wa-button>`, `<wa-card>`…) e a fonte é Montserrat, ambos via CDN com versão fixa. Não troque por React/Tailwind nem adicione etapa de build.
- Cores: roxo (`--twitch`) na página Twitch, verde (`--kick`) na Kick e laranja (`--orange`, #fc5e03) no resto. A cor "brand" do Web Awesome é trocada por seção no CSS. Use `variant="brand"` em vez de cores fixas.
- O painel atualiza a cada 5 s. Use `setHTML()`, que só troca o HTML quando ele muda, para não fechar menus abertos nem piscar.
- Siga o estilo do código ao redor: comentários curtos e em português explicando o *porquê*, nomes em inglês, `const`, arrow functions, 2 espaços.
- Textos da interface e mensagens de log são em **português do Brasil**, simples, para quem não é programador.
- Erros e coisas boas (baús, Momentos, raids) vão para `addEvent` de `src/events.js` (arquivo `eventos.jsonl`, 30 dias, erro repetido da mesma conta só entra depois de 10 min). Use `report('good'|'bad', …)` das contas em vez de só `log` quando o usuário deve ver o acontecimento no painel.
- Os dados ficam em JSON na raiz e são lidos e gravados por `readJson`/`writeJson` de `src/store.js` (também usados por `src/stats.js`). A gravação é atômica (arquivo `.tmp` + troca) e um arquivo quebrado é guardado como `.quebrado-<data>`; os dois estão no `.gitignore` porque podem ter tokens.

## Cuidados com a Twitch

- O refresh token só pode ser usado **uma vez**. Renovações simultâneas devem compartilhar a mesma promessa (`ensureFresh` em `src/points.js`).
- Erro de rede ao renovar **não** pode marcar a conta como `needsRelink`. Só respostas 400/401 marcam.
- Tudo da Twitch usa o Client ID do app de TV (`TV_CLIENT_ID` em `src/twitch.js`), porque a API interna (GQL) só aceita os apps da própria Twitch. O status das lives vem da GQL **sem login**, em lotes. As consultas usam hashes fixos (em `src/twitch.js` e `HASHES` em `src/points.js`); se a Twitch trocar algum, o log mostra `PersistedQueryNotFound`.
- Momentos, baús na hora e o motivo dos pontos chegam pelo PubSub da Twitch (`wss://pubsub-edge.twitch.tv/v1`), com **uma conexão por conta**, como um navegador logado. Não junte contas numa conexão só. Raids só são seguidas de um canal oficial para outro, e só pelas contas que assistiam a origem. Sem ele, o histórico anota a diferença de saldo como `OTHER`.
- O farm imita uma pessoa para diminuir o risco de punição: descanso diário (`REST`, 5h–8h de Brasília, com variação por conta e por dia), esperas aleatórias antes de pegar baú/Momento e de trocar de live, intervalos com variação e poucas leituras de saldo (`CHECK_*`). Não volte para tempos exatos nem consultas a cada minuto.
- A Twitch só conta tempo assistido em 2 lives ao mesmo tempo, por conta.

## Cuidados com a Kick

- Use a API do site (`kick.com/api`) **sem fingir ser o Chrome**: com User-Agent de navegador e o TLS do Node, a Kick bloqueia ("Request blocked by security policy"). Com o `fetch` padrão, responde.
- O farm abre a conexão de espectador (`wss://websockets.kick.com/viewer/v1/connect`) e manda `tracking.user.watch.livestream` a cada ~11 s, como o player. Máximo de 2 lives por conta.
- O token de espectador responde 403 quando o token da conta não vale mais. Antes de marcar `needsRelink`, confira com `fetchKickUser` (só 401 marca), para um bloqueio passageiro não pedir token novo.
- As travas de `src/human.js` valem para as duas plataformas. Cada conta (`PointsAccount`) escolhe as suas pelos próprios saldos.

## Testes

- Antes de terminar, rode `npm run check` (sintaxe de todos os `.js`) e `npm test` (testes em `test/*.test.js`, com `node:test` e `node:assert`, sem pacotes do npm). O GitHub Actions (`.github/workflows/ci.yml`) roda os dois no Node 20, 22 e 24 a cada push e pull request; o código precisa passar em todos.
- Mudou lógica em `src/`? Crie ou ajuste o teste do módulo (um arquivo por módulo, ex.: `test/human.test.js`). Os testes cobrem lógica, não as APIs da Twitch e da Kick: mudanças de hash, endpoint ou bloqueio só aparecem no painel (🐞).
- Testes **nunca** usam internet nem os arquivos de dados reais: troque `globalThis.fetch` por uma função falsa e defina `IDLELIVE_DATA_DIR` com uma pasta temporária **antes** de importar módulos que leem arquivos (`store.js`, `events.js`, `stats.js`). Não abra WebSocket de verdade.
- O painel (`public/index.html`) não tem testes: teste ele no navegador.
- **Não rode uma segunda instância com as contas reais** enquanto o painel do usuário estiver aberto: as duas renovariam o mesmo refresh token e uma derrubaria a outra. Para testar, copie o projeto para outra pasta **sem** `points.json` e `lolidle.json` e rode com outra porta (`PORT=3005 node server.js`).
- Mudanças no servidor só valem depois de reiniciar o painel. O `index.html` é lido a cada acesso, então a página nova pode rodar com o servidor antigo. Escreva o front-end tolerando campos que ainda não existem (`?.`, `?? 0`).
- O botão "Reiniciar servidor" faz o processo sair com o código 75, e o `iniciar.bat` (que define `IDLELIVE_LAUNCHER=1`) abre o servidor de novo. Fora do `.bat` o botão fica escondido. Se mudar o `iniciar.bat`, mantenha esse laço.
- Não abra janelas na tela do usuário sem avisar.

## Documentação

- Toda mudança visível para o usuário entra no [CHANGELOG.md](CHANGELOG.md), na seção da data do dia (`## DD/MM/AAAA`), em Novidades, Mudanças ou Correções. Crie a seção se ainda não existir.
- Se mudar a instalação, o uso ou os arquivos de dados, atualize o [README.md](README.md).
- Commits em português, curtos, no imperativo (ex.: "Adiciona botão Hub no topo").

## Versões e atualização

- A versão é o `version` do `package.json`. Uma tag `v<versão>` enviada ao GitHub dispara o `.github/workflows/release.yml`, que testa, monta o `IdleLive.zip` e publica a release. A tag e o `package.json` precisam bater.
- Os jogadores atualizam pelo painel (`src/update.js`): ele baixa o `.tar.gz` da release e troca só os arquivos que mudaram. Nunca troca os arquivos de dados nem um `config.json` que já existe. Novo arquivo de dados? Coloque o nome em `PROTECTED` em `src/update.js`.
- Arquivo removido do projeto **não** é apagado na pasta dos jogadores. O código não pode depender de um arquivo sumir.
- Evite mudar o `iniciar.bat`: o cmd lê o `.bat` aos poucos enquanto roda, então quando ele muda o painel não reinicia sozinho e pede para fechar a janela e abrir de novo.
- Arquivo só para quem programa (testes, scripts de CI) vai com `export-ignore` no `.gitattributes`, para ficar fora do zip.
