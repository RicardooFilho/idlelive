# Regras para agentes de IA

Leia antes de mexer no projeto. Elas valem para qualquer agente (Claude, Copilot, Cursor, etc.).

## Sobre o projeto

IdleLive é um painel local (Node.js) para jogadores de jogos idle que dão bônus por assistir lives de parceiros:
- **Twitch:** mostra quem está ao vivo e até 4 contas juntam **pontos do canal** nas lives dos parceiros (`src/points.js`, baseado no Twitch Channel Points Miner v2). O jogo dá o bônus de XP para quem resgata com esses pontos;
- **Kick:** lista as lives dos parceiros e abre a live numa janela visível do navegador (Chrome, Brave ou Edge) quando o usuário clica.

O público é de jogadores, não programadores. Veja o [README.md](README.md).

## Segurança e dados

- **Nunca** leia em voz alta, copie, faça commit ou envie `accounts.json`, `kick.json`, `points.json`, `stats.json` ou `.token.json`. Eles têm tokens, segredos e dados das contas e estão no `.gitignore`. Antes de cada commit, confira com `git status` que nenhum deles entrou.
- Não peça para o usuário colar segredos (Client Secret, tokens) no chat. Eles são colados só no painel local.
- O servidor escuta só em `127.0.0.1`. Não mude para `0.0.0.0`.
- Não altere configurações do sistema, como a política de execução do PowerShell. Para rodar, use `iniciar.bat` ou `node server.js`.

## Código

- Node.js 20+, ES modules, **sem dependências**. Não adicione pacotes do npm. Use `fetch`, `node:tls`, `node:http`, etc.
- O painel é um arquivo só (`public/index.html`), sem framework e sem build. Os componentes são do **Web Awesome 3.14.0** (`<wa-button>`, `<wa-card>`…) e a fonte é Montserrat, ambos via CDN com versão fixa. Não troque por React/Tailwind nem adicione etapa de build.
- Cores: roxo (`--twitch`) na página Twitch, verde (`--kick`) na Kick e laranja (`--orange`, #fc5e03) no resto. A cor "brand" do Web Awesome é trocada por seção no CSS. Use `variant="brand"` em vez de cores fixas.
- O painel atualiza a cada 5 s. Use `setHTML()`, que só troca o HTML quando ele muda, para não fechar menus abertos nem piscar.
- Siga o estilo do código ao redor: comentários curtos e em português explicando o *porquê*, nomes em inglês, `const`, arrow functions, 2 espaços.
- Textos da interface e mensagens de log são em **português do Brasil**, simples, para quem não é programador.
- Os dados ficam em JSON na raiz e são lidos e gravados por `src/store.js` (ou `src/stats.js`).
- Integrações com o Windows (posicionar e fechar janelas) ficam em PowerShell + `src/win.cs`. Os scripts devem funcionar no Windows PowerShell 5.1.

## Cuidados com a Twitch

- O refresh token só pode ser usado **uma vez**. Renovações simultâneas devem compartilhar a mesma promessa (`ensureFresh` em `src/points.js`).
- Erro de rede ao renovar **não** pode marcar a conta como `needsRelink`. Só respostas 400/401 marcam.
- Tudo da Twitch usa o Client ID do app de TV (`TV_CLIENT_ID` em `src/twitch.js`), porque a API interna (GQL) só aceita os apps da própria Twitch. O status das lives vem da GQL **sem login**, em lotes. As consultas usam hashes fixos (em `src/twitch.js` e `HASHES` em `src/points.js`); se a Twitch trocar algum, o log mostra `PersistedQueryNotFound`.
- A Twitch só conta tempo assistido em 2 lives ao mesmo tempo, por conta. Cada conta (`PointsAccount`) escolhe as suas pelos próprios saldos.

## Testes

- Não há testes automatizados. Rode `node --check` nos arquivos alterados e teste o painel no navegador.
- **Não rode uma segunda instância com as contas reais** enquanto o painel do usuário estiver aberto: as duas renovariam o mesmo refresh token e uma derrubaria a outra. Para testar, copie o projeto para outra pasta **sem** `points.json` e rode com outra porta (`PORT=3005 node server.js`).
- Mudanças no servidor só valem depois de reiniciar o painel. O `index.html` é lido a cada acesso, então a página nova pode rodar com o servidor antigo. Escreva o front-end tolerando campos que ainda não existem (`?.`, `?? 0`).
- O botão "Reiniciar servidor" faz o processo sair com o código 75, e o `iniciar.bat` (que define `IDLELIVE_LAUNCHER=1`) abre o servidor de novo. Fora do `.bat` o botão fica escondido. Se mudar o `iniciar.bat`, mantenha esse laço.
- Não abra janelas na tela do usuário sem avisar.

## Documentação

- Toda mudança visível para o usuário entra no [CHANGELOG.md](CHANGELOG.md), na seção da data do dia (`## DD/MM/AAAA`), em Novidades, Mudanças ou Correções. Crie a seção se ainda não existir.
- Se mudar a instalação, o uso ou os arquivos de dados, atualize o [README.md](README.md).
- Commits em português, curtos, no imperativo (ex.: "Adiciona botão Hub no topo").
