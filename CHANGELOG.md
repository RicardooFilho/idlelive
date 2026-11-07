# Changelog

Mudanças do IdleLive, da mais recente para a mais antiga.

## 07/11/2026

### Novidades
- **Listas de acontecimentos no topo:** o ícone de **inseto** 🐞 mostra os erros que a Twitch e a Kick devolveram, e o de **presente** 🎁 mostra os baús, Momentos e raids que as contas da Twitch pegaram. Cada um tem um contador do que é novo. Ficam guardados no `eventos.jsonl` por 30 dias (os mais velhos saem sozinhos) e não somem ao reiniciar.
- **Pontos do canal na Twitch:** até 4 contas (vinculadas na página Twitch, cada uma no seu card) e cada uma assiste até 2 lives dos canais oficiais por vez (primeiro uns minutos de cada live nova para manter a sequência, depois as que têm mais pontos naquela conta), ganha os pontos por tempo assistido e pega o bônus sozinha. O card mostra o saldo em todos os canais da lista (os offline também, atualizados a cada 10 minutos), quanto subiu desde que o painel abriu e quantos bônus foram pegos. O card mostra 5 canais, e o botão **Ver todos** abre uma janela com a tabela completa (situação, espectadores, saldo, ganho e baús). O ícone ⓘ ao lado de "Pontos do canal" abre uma janela explicando o farm: de onde vêm os pontos, quais lives cada conta assiste, como resgatar o boost, o histórico e os riscos. Baseado no Twitch Channel Points Miner v2.

- **Descanso diário:** das 5h às 8h (horário de Brasília) as contas de pontos param, como quem vai dormir. São 3 horas, para quebrar o padrão de 24 horas por dia perdendo só uns 12% dos pontos. Cada conta dorme e acorda até 20 minutos antes ou depois, num horário que muda todo dia. O card mostra "Descansando até…".
- **Farm mais parecido com uma pessoa:** baús e Momentos são pegos depois de uma espera aleatória de 5 a 40 segundos; as contas começam e trocam de live em momentos diferentes; os intervalos variam um pouco; e o saldo é lido bem menos vezes (a cada 5–10 min nas lives assistidas e a cada ~30 min no resto, em vez de todo minuto).
- **Sequência garantida:** um ✓ verde ao lado do canal mostra que a conta já garantiu a sequência (watch streak) da live atual.
- **Momentos:** quando um canal oficial ao vivo solta um Momento, todas as contas de pontos pegam na hora.
- **Raids entre parceiros:** quando um canal oficial faz raid para outro canal oficial, as contas que estavam assistindo entram junto e ficam uns minutos na live que recebeu. Raid para canal fora da lista é ignorada.
- **Baú na hora:** a Twitch avisa em tempo real quando o baú aparece, e o painel pega sem esperar a checagem de cada minuto.
- **Histórico de pontos:** a página **Histórico** voltou, agora com os pontos ganhos por conta e por dia, e uma tabela de onde vieram os pontos nos últimos 7 dias (tempo assistido, baús, sequências, raids, Momentos).
- **Avisos no topo do painel** quando algo para de funcionar: conta que precisa ser vinculada de novo, a Twitch recusando os pedidos, a conexão em tempo real caída ou falha ao ver quem está ao vivo. Se o problema for a internet, aparece um aviso só, "Sem conexão com a internet", em vez de um por conta.
- **Botão ▶ nos pontos:** abre a live no navegador para você resgatar as recompensas. Em **Configurações → Navegador e perfis**, escolha o perfil do navegador de cada conta para ela abrir já logada.

- **Pontos do canal na Kick:** até 4 contas da Kick juntam pontos em segundo plano, cada uma em até 2 lives por vez (as que têm mais pontos na conta), com as mesmas travas da Twitch (descanso das 5h às 8h, tempos aleatórios, poucas leituras de saldo). A conta entra pelo favorito **⚡ Enviar para o IdleLive**: arraste ele uma vez para a barra de favoritos e clique nele no kick.com, logado na conta. O painel pergunta antes de adicionar. Também dá para colar o token à mão. Cada card mostra os saldos, o que está assistindo e o botão ▶ para abrir a live no perfil da conta. Baseado no Kick Channel Points Miner (Baillora).
- **Navegador e perfis** agora ficam em Configurações, para as contas da Twitch e da Kick.

### Mudanças
- **Conteúdo do painel usa a largura toda da tela**, alinhado com o botão Hub.
- **Páginas Twitch e Kick padronizadas:** os cards de canais são iguais nas duas (a Kick também perdeu a barra de horários), e as listas se chamam "Canais parceiros" nas duas.
- **Nomes dos streamers inteiros nos cards de pontos:** "assistindo" virou um ícone de olho 👁 (com a explicação ao passar o mouse) e o ganho fica embaixo do saldo, para sobrar espaço para o nome.
- **Textos mais claros no painel:** o mesmo nome para o mesmo estado ("Vincule de novo" na Twitch, "Token recusado" na Kick), "Remover conta" na Kick, "bônus de XP" e "baú de pontos", e menos termos técnicos nas ajudas.
- **Adicionar canal** agora tem um botão **Adicionar** (o Enter continua funcionando), e o nome digitado só some se der certo.
- **App da Kick:** não deixa salvar com os campos vazios e confirma quando salva.
- **Ajuda da Kick** completa: painel aberto, como resgatar e onde adicionar contas.
- **Visão geral sem contas** mostra botões para vincular uma conta da Twitch ou adicionar uma da Kick.
- O **✕** de remover canal fica sempre visível (bem fraco). Uma dica explica o **▶** até a primeira vez que você usar.
- **Histórico** mostra as duas plataformas no título, e tocar num valor mostra de onde vieram os pontos (no celular também).
- Em Configurações, o painel avisa embaixo do seletor que trocar de navegador apaga os perfis escolhidos.
- **Saem as janelas da Kick:** o painel não abre mais a live numa janela pequena por perfil; o farm é em segundo plano. O app da Kick ficou opcional: sem ele, o painel vê quem está ao vivo canal por canal.
- Lista da Kick atualizada com os parceiros do jogo: entraram denissnider, fnblol, daniels, revolta, yoda, kennzy e ookina8.
- **Saem as contas do chat da Twitch:** agora o bônus de XP do jogo vem de resgatar com pontos do canal, então ficar no chat não serve mais. Saíram os cards das contas, o "+% de XP", o "Boost hoje" e a página **Histórico**. Na Visão geral, o lugar do "Boost hoje" agora mostra os pontos do canal.
- A lista de quem está ao vivo na Twitch funciona **sem nenhuma conta vinculada**.
- O `accounts.json` não é mais usado e pode ser apagado.
- Cards dos canais da Twitch mais simples: saíram a barra de horários e o "Costuma estar ao vivo" (continuam na Kick).
- Lista de canais oficiais da Twitch atualizada com os parceiros do jogo: entraram yetz, revolta, daniels, kennzy, ookina e surskity11, e saíram faasii e yulla.

### Correções
- Conexão em tempo real da Twitch que podia ficar aberta durante o descanso (ou depois de desvincular) e duplicar os pontos no histórico.
- Conexão da Kick "morta" (PC hibernou, roteador caiu) agora é percebida em até ~1,5 min e refeita.
- A Twitch não "troca" mais de live à toa quando duas lives com saldos parecidos invertem de posição.
- Depois de renovar o login, os avisos em tempo real da conta voltam a funcionar sem esperar a próxima queda.
- O aviso "Sem conexão com a internet" não fica mais preso durante o descanso.
- Arquivos de dados não ficam mais pela metade se o painel fechar no meio de uma gravação; um arquivo quebrado é guardado de lado e o painel abre mesmo assim.
- Se a Twitch ou a Kick derrubarem a conexão logo depois de aceitar, o painel espera cada vez mais antes de tentar de novo, em vez de tentar a cada poucos segundos.
- Um canal da Kick que não responde não trava mais a lista inteira.
- Erro ao abrir o navegador pelo ▶ ou ao conferir o token da Kick não derruba mais o servidor.
- Menu ⋮ dos cards não fecha mais sozinho quando o saldo muda.
- Avisos de sucesso aparecem em cor neutra (vermelho só para erro).
- No celular, o ✕ de remover canal aparece.
- Sem internet, o painel mostra um aviso em vez de ficar em branco.

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
