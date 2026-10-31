# Regras para agentes de IA

Leia antes de mexer no projeto. Elas valem para qualquer agente (Claude, Copilot, Cursor, etc.).

## Sobre o projeto

IdleLive é um painel local (Node.js) para jogadores de pokeidle:
- **Twitch:** mantém até 4 contas no **chat** dos canais parceiros ao vivo, que é o que o pokeidle usa para dar bônus de XP;
- **Kick:** lista as lives dos parceiros e abre a live numa janela visível do Chrome quando o usuário clica.

O público é de jogadores, não programadores. Veja o [README.md](README.md).

## Limites que não podem ser quebrados

O projeto respeita as regras da Twitch, da Kick e do pokeidle. **Não implemente, mesmo que peçam:**
- espectadores falsos, viewbot ou qualquer coisa que infle a contagem de espectadores;
- players escondidos, headless, sem som forçado para "contar" sem ninguém ver, ou que burlem o player;
- abrir ou reabrir lives da Kick sozinho. Toda janela da Kick é aberta por um clique do usuário;
- automação de pontos de canal, resgates ou recompensas;
- usar APIs não oficiais ou chaves de terceiros para receber eventos (ex.: Pusher antigo da Kick).

Se o pedido cair aqui, explique o motivo e ofereça uma alternativa permitida.

## Segurança e dados

- **Nunca** leia em voz alta, copie, faça commit ou envie `accounts.json`, `kick.json`, `stats.json` ou `.token.json`. Eles têm tokens, segredos e dados das contas e estão no `.gitignore`. Antes de cada commit, confira com `git status` que nenhum deles entrou.
- Não peça para o usuário colar segredos (Client Secret, tokens) no chat. Eles são colados só no painel local.
- O servidor escuta só em `127.0.0.1`. Não mude para `0.0.0.0`.
- O `clientId` da Twitch em `config.json` é público (app do tipo público, login por código), então pode ficar no repositório.
- Não altere configurações do sistema, como a política de execução do PowerShell. Para rodar, use `iniciar.bat` ou `node server.js`.

## Código

- Node.js 20+, ES modules, **sem dependências**. Não adicione pacotes do npm. Use `fetch`, `node:tls`, `node:http`, etc.
- O painel é um arquivo só (`public/index.html`), com CSS e JS puros, sem framework e sem build.
- Siga o estilo do código ao redor: comentários curtos e em português explicando o *porquê*, nomes em inglês, `const`, arrow functions, 2 espaços.
- Textos da interface e mensagens de log são em **português do Brasil**, simples, para quem não é programador.
- Os dados ficam em JSON na raiz e são lidos e gravados por `src/store.js` (ou `src/stats.js`).
- O pokeidle dá +15% pela primeira live e +2,5% por live adicional. Isso está em `bonus()`, no `src/stats.js` e no `public/index.html`.
- Integrações com o Windows (posicionar e fechar janelas) ficam em PowerShell + `src/win.cs`. Os scripts devem funcionar no Windows PowerShell 5.1.

## Cuidados com a Twitch

- O refresh token só pode ser usado **uma vez**. Renovações simultâneas da mesma conta devem compartilhar a mesma promessa (`ensureFreshToken`).
- Erro de rede ao renovar **não** pode marcar a conta como `needsRelink`. Só respostas 400/401 marcam.
- Conexões IRC "zumbis" são detectadas pelo tempo desde o último dado **recebido**. Não use `socket.setTimeout`, porque ele também conta escritas.

## Testes

- Não há testes automatizados. Rode `node --check` nos arquivos alterados e teste o painel no navegador.
- **Não rode uma segunda instância com as contas reais** enquanto o painel do usuário estiver aberto: as duas renovariam o mesmo refresh token e uma derrubaria a outra. Para testar, copie o projeto para outra pasta **sem** `accounts.json` e rode com outra porta (`PORT=3005 node server.js`).
- Mudanças no servidor só valem depois de reiniciar o painel. O `index.html` é lido a cada acesso, então a página nova pode rodar com o servidor antigo. Escreva o front-end tolerando campos que ainda não existem (`?.`, `?? 0`).
- Não abra janelas na tela do usuário sem avisar.

## Documentação

- Toda mudança visível para o usuário entra no [CHANGELOG.md](CHANGELOG.md), na seção da data do dia (`## DD/MM/AAAA`), em Novidades, Mudanças ou Correções. Crie a seção se ainda não existir.
- Se mudar a instalação, o uso ou os arquivos de dados, atualize o [README.md](README.md).
- Commits em português, curtos, no imperativo (ex.: "Adiciona botão Hub no topo").
