# Changelog

Mudanças do IdleLive, da mais recente para a mais antiga.

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
