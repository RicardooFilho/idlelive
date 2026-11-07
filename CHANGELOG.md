# Changelog

Mudanças do IdleLive, da mais recente para a mais antiga.

## 07/11/2026

### Novidades
- **Pontos do canal na Twitch:** até 4 contas (vinculadas na página Twitch, cada uma no seu card) e cada uma assiste até 2 lives dos canais oficiais por vez (primeiro uns minutos de cada live nova para manter a sequência, depois as que têm mais pontos naquela conta), ganha os pontos por tempo assistido e pega o bônus sozinha. O card mostra o saldo em todos os canais da lista (os offline também, atualizados a cada 10 minutos), quanto subiu desde que o painel abriu e quantos bônus foram pegos. O card mostra 5 canais, e o botão **Ver todos** abre uma janela com a tabela completa (situação, espectadores, saldo, ganho e baús). O botão **?** ao lado de "Pontos do canal" explica como o farm funciona. Baseado no Twitch Channel Points Miner v2.

### Mudanças
- **Saem as contas do chat da Twitch:** agora o bônus de XP do jogo vem de resgatar com pontos do canal, então ficar no chat não serve mais. Saíram os cards das contas, o "+% de XP", o "Boost hoje" e a página **Histórico**. Na Visão geral, o lugar do "Boost hoje" agora mostra os pontos do canal.
- A lista de quem está ao vivo na Twitch funciona **sem nenhuma conta vinculada**.
- O `accounts.json` não é mais usado e pode ser apagado.
- Cards dos canais da Twitch mais simples: saíram a barra de horários e o "Costuma estar ao vivo" (continuam na Kick).
- Lista de canais oficiais da Twitch atualizada com os parceiros do jogo: entraram yetz, revolta, daniels, kennzy, ookina e surskity11.

## 31/10/2026

### Novidades
- **Kick com Brave e Edge:** além do Chrome, as lives da Kick agora abrem no Brave ou no Edge. O painel mostra só os navegadores instalados no campo **Navegador**. Sem escolha, ele usa o primeiro que encontrar (Chrome, Brave, Edge). Como o Edge vem no Windows, quem não tem Chrome também consegue usar a parte da Kick.
- **Botão Reiniciar servidor** no topo: fecha e abre o servidor de novo na mesma janela preta, sem abrir outra aba, e o painel recarrega sozinho quando ele volta. Serve para carregar atualizações. Só aparece quando o painel foi aberto pelo `iniciar.bat`.
- **Visual novo**, feito com os componentes do Web Awesome e a fonte Montserrat:
  - **menu lateral** com Visão geral, Twitch, Kick, Histórico e Configurações, que vira gaveta no celular;
  - página **Visão geral** com o bônus atual, contas da Twitch e da Kick, lives ao vivo, a lista "Ao vivo agora" (Twitch e Kick juntas) e o "Boost hoje";
  - cores por seção: roxo na Twitch, verde na Kick e laranja (#fc5e03) no resto;
  - cards em grade de 4 colunas em telas largas, e filtro **Todos / Ao vivo / Offline** nos canais;
  - espectadores em vermelho, e a barra de horários com as marcações 0h, 6h, 12h, 18h e 24h;
  - o ícone do IdleLive aparece no menu e na aba do navegador.
- **Kick:** o botão da conta fica verde enquanto ela está assistindo aquele canal.

### Mudanças
- Na Kick, os botões das contas mostram só o nome do perfil (sem "Conta 1", "Conta 2"). Com 3 ou 4 contas, ou em card estreito, o "Todas" fica numa linha e as contas embaixo.
- O app da Kick (Client ID e Client Secret) agora fica na página **Configurações**.
- Trocar de navegador desmarca as contas da Kick e fecha as janelas abertas, porque cada navegador tem os próprios perfis.

### Correções
- **Horários das lives:** o visual novo escondia o "Costuma estar ao vivo" até o painel ter observado 6 horas do dia. Agora ele mostra o que já sabe desde a primeira hora, com o aviso "ainda aprendendo" até cobrir metade do dia.

## 30/10/2026

### Novidades
- **Novo visual:** o painel agora tem duas seções, Twitch (roxa) e Kick (verde), e uma barra no topo com quantos canais estão ao vivo em cada uma.
- **Botão Hub** no topo, que abre o hub do jogo numa aba nova.
- **Iniciar com o Windows:** uma chave no topo cria um atalho na pasta Inicializar, e o painel abre minimizado, sem abrir o navegador.
- **Histórico de boost:** cada conta mostra quanto tempo ficou com boost hoje. Uma tabela mostra os últimos 7 dias, com as horas de boost e o bônus médio de cada conta. Os dados ficam em `stats.json` por até 30 dias.
- **Horários das lives:** cada canal, da Twitch e da Kick, ganhou uma barrinha de 24 horas com a chance de estar ao vivo em cada hora, e o texto "Costuma estar ao vivo: …".
- **Kick, ▶ Todas:** abre a live em todas as contas de uma vez, cada janela no seu lugar.
- **Kick, ✕ Fechar janelas:** fecha as janelas que o painel abriu.

### Mudanças
- Cada conta da Kick agora fica com uma janela só. Abrir outro canal na mesma conta fecha a janela anterior dela.
- Lista de parceiros atualizada:
  - **Twitch:** entrou a yulla.
  - **Kick:** entraram a yulla e o surskity, e saiu o mandiocaa.

### Correções
- **Internet caindo:** quando a internet caía, a conexão com o chat podia ficar "morta" sem dar erro, e as contas perdiam o boost até reiniciar o painel. Agora o painel manda um PING a cada minuto e reconecta se ficar 150 segundos sem resposta.
- Uma falha de rede na hora de renovar o login não marca mais a conta como "Vincule de novo" por engano.

## 28/10/2026

### Novidades
- **Primeira versão:**
  - vincula até 4 contas da Twitch pelo login com código;
  - as contas entram sozinhas no chat dos parceiros que estão ao vivo;
  - cada conta pode seguir todos os parceiros ou só alguns;
  - mostra o bônus estimado de XP de cada conta;
  - renova os logins automaticamente e reconecta se a conexão cair.
- **Kick:**
  - status ao vivo e espectadores dos parceiros, pela API oficial;
  - perfis do Chrome usados como contas;
  - botão ▶ que abre a live numa janela pequena.
- `iniciar.bat` para abrir o painel com dois cliques.

### Correções
- As janelas da Kick agora abrem num bloco 2x2 no canto inferior direito, sem uma ficar em cima da outra, e respeitam a escala de tela do Windows.
