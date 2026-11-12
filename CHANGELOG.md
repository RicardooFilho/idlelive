# Changelog

Mudanças do IdleLive, da mais recente para a mais antiga.

## 11/11/2026

Precisa reiniciar o servidor uma vez para valer.

### Mudanças
- **Painel mais vivo:** quando o saldo, o "+ganho" ou os números da Visão geral mudam, só os dígitos que mudaram sobem (ganhou) ou descem; o contador de baús e erros "estoura" quando chega coisa nova; e a barrinha das abas Twitch | Kick desliza de uma aba para a outra. Quem pediu ao Windows para reduzir animações não vê nada disso. Animações adaptadas do [transitions.dev](https://transitions.dev).
- **Logo da Kick de verdade:** o "K" de texto nas abas, no menu e nas listas virou o logo da Kick; os quadradinhos "T" viraram o logo da Twitch (logos do [theSVG](https://thesvg.org)).
- **Mini gráfico no "Pontos hoje":** uma linha com os pontos dos últimos 7 dias, no canto do cartão da Visão geral.
- **Resgate com ✓ e confete:** na loja, o botão "Resgatar" vira "✓ Resgatado" por alguns segundos e solta confete quando o resgate dá certo.
- **Esboço ao abrir:** enquanto o servidor não responde, o painel mostra o formato dos cards pulsando, e os dados aparecem saindo do desfoque. O saldo que ainda está sendo lido aparece como uma barrinha pulsando no lugar do "–".
- **Campo que treme:** canal ou token vazio ou recusado faz o campo tremer e ficar com a borda vermelha por alguns segundos.
- **Canal sai em fumaça:** ao tirar um parceiro da lista, o card se desfaz antes de sumir. Se o servidor recusar, ele volta.
- "Conectando…" e "Abrindo a loja…" ganharam um brilho passando no texto enquanto esperam.
- **Histórico guarda 30 dias:** o painel guardava 60 dias de pontos, mas só mostrava 30. Agora guarda os mesmos 30 que mostra, e a Ajuda diz o mesmo. Os dias mais antigos saem do `stats.json`.
- **Queda de internet não enche mais o 🐞:** sem internet, cada canal virava um erro "erro ao ver os pontos de #canal" (mais de 100 numa hora). Agora isso fica só na janela preta, e o aviso de internet no topo do painel continua aparecendo.
- O painel parou de anotar os horários das lives, que não aparecem em nenhuma tela desde que as barrinhas de horário saíram. O que já estava anotado sai do `stats.json`.

### Correções
- **"+ganho" depois de um resgate:** o "+ganho" dos cards caía para zero quando a conta resgatava uma recompensa e só voltava a subir depois de recuperar tudo o que gastou. Agora ele continua mostrando o que a conta ganhou desde que o painel abriu, na Twitch e na Kick, mesmo se o resgate foi feito pelo navegador.
- **"Adicionar" com o campo vazio:** clicar em "Adicionar" sem digitar o nome do canal não fazia nada. Agora aparece o aviso para preencher.

## 10/11/2026

### Novidades
- **Loja da Kick:** em **Pokeidle → Kick**, o botão da loja ao lado de cada canal mostra as recompensas do Pokeidle (XP, Capture Boost, Secret Lure) e resgata com a conta escolhida, igual à loja da Twitch. O painel pede confirmação antes e nunca resgata sozinho. Precisa reiniciar o servidor uma vez para usar.
- **Configurações → Jogos:** liga e desliga o **Pokeidle** e o **LoLdle**. Jogo desligado some do menu, da Visão geral, do Histórico e das listas do 🐞 e do 🎁 (o Histórico e os cards de navegador e app da Kick são do Pokeidle). As contas dele param: no Pokeidle não assistem, não pegam baú nem seguem canais; no LoLdle saem dos chats. O painel também para de ver quem está ao vivo nos canais dele. Nada é apagado, e ao ligar de novo tudo volta. Precisa reiniciar o servidor uma vez para usar.
- **Atualização pelo painel:** o painel procura versão nova no GitHub a cada 6 horas e mostra um aviso no topo. O botão **Atualizar agora** baixa a versão nova, troca os arquivos do programa e reinicia sozinho, sem precisar de git. Suas contas, canais e histórico continuam. Em **Configurações** aparece a versão atual e o botão **Procurar atualização**.
- **Download pelo IdleLive.zip:** cada versão sai como release no GitHub, com o zip pronto para extrair.
- O `iniciar.bat` avisa quando o Node.js não está instalado e abre o site para baixar.
- **LoLdle:** vincule até 4 contas da Twitch em **LoLdle → Twitch**: cada conta entra em silêncio no chat dos 47 canais parceiros que estiverem ao vivo e sai quando a live acaba. É assim que o jogo dá o bônus de XP. Não manda mensagem e não assiste a live; pode ser a mesma conta do Pokeidle. O card de cada conta mostra em quais chats ela está agora.

### Mudanças
- **LoLdle:** agora aceita até **5 contas** da Twitch (antes eram 4). Precisa reiniciar o servidor uma vez.
- A loja do Pokeidle não mostra mais as recompensas do LoL Idle que falam de XP.
- **Visão geral nova:** agora ela mostra os dois jogos e o que rendeu no dia.
  - **Números do topo:** pontos de hoje comparados com ontem, contas trabalhando, baús e Momentos de hoje e lives ao vivo. Os pontos vêm do Histórico, então não zeram quando o painel reinicia.
  - **Precisa de você:** só aparece quando alguma conta (Pokeidle ou LoLdle) precisa ser vinculada de novo, quando a Kick recusa um token ou quando tem erro novo, e traz o botão que resolve.
  - **Um card por jogo:** **Pokeidle** e **LoLdle** mostram as contas, os pontos de hoje de cada uma e as lives ao vivo, com a conta que está assistindo cada live (ou quantas contas estão no chat).
  - **Pontos nos últimos 7 dias**, em barras, e os **últimos acontecimentos** (baús, Momentos, raids, follows e resgates).
- **Menu por jogo:** "Plataformas" virou **Jogos**, com **Pokeidle** e **LoLdle**. Cada jogo tem as abas **Twitch** e **Kick**; as antigas páginas Twitch e Kick agora são as abas do Pokeidle.
- **O painel abre na hora:** a página já responde enquanto o servidor faz as primeiras checagens (antes ela só respondia depois delas, e sem o app da Kick isso levava vários segundos). As lives aparecem logo em seguida.
- **Menos alarme falso no 🐞:** a live que acabou não aparece mais como erro ("lista de qualidades respondeu 404"), e uma falha de rede sozinha num "minuto assistido" só vira erro se repetir na vez seguinte. Precisa reiniciar o servidor.

### Correções
- **Abrir o painel duas vezes não derruba mais as contas:** a segunda janela preta podia renovar o login das contas da Twitch antes de perceber que o painel já estava aberto, e a primeira ficava pedindo "Vincule de novo". Agora ela para antes de mexer nos logins.
- **Segurança:** só o próprio painel consegue falar com o servidor. Antes, um site aberto no navegador conseguia mandar pedidos para ele (adicionar um canal, reiniciar) ou derrubar o servidor com um endereço malformado.
- **LoLdle:** uma conta desvinculada (ou o jogo desligado) bem na hora em que o chat reconectava podia continuar nos chats. Remover um canal do Pokeidle que também está no LoLdle não tira mais as contas do chat dele por um minuto.
- **Visão geral:** as contas da Kick agora mostram os pontos de hoje (o valor ficava sempre em branco).
- **Kick no Node.js 20:** o painel avisa no topo que as contas da Kick não juntam pontos nessa versão, em vez de deixar elas em "Esperando live" para sempre.
- Conexão da Kick aberta por muitas horas não gasta mais memória aos poucos.

## 09/11/2026

### Novidades
- **Loja do canal (Twitch):** o botão de **loja** ao lado de cada canal, nos cards de pontos, abre as recompensas daquele streamer, com descrição, preço e situação (pausada, esgotada, em espera, só inscritos). Escolha a conta pelos botões do topo, que mostram o saldo de cada uma no canal, e clique em **Resgatar**. O painel confirma antes, lê o saldo e a recompensa de novo e só então resgata. Ele nunca resgata sozinho. Os resgates aparecem na lista do ícone de **presente** 🎁 e as recusas da Twitch na do **inseto** 🐞. A loja mostra só as recompensas do Pokeidle. Os botões **XP**, **Capture Boost** e **Shiny Lure** no topo da loja mostram só aquele tipo de bônus; clique de novo para ver todas.
- **Follow automático:** cada conta (Twitch e Kick) segue todos os canais da lista, inclusive os que ela quase nunca assiste. Segue um por vez, a cada 3 a 10 minutos (tempo aleatório, como uma pessoa), começando pelas lives que está assistindo. Cada canal só é seguido uma vez por conta: se você deixar de seguir depois, a conta não segue de novo. Os follows aparecem na lista do ícone de **presente** 🎁.
- **Bolinha piscando = ainda não segue:** nos cards de pontos, a bolinha do canal pisca enquanto aquela conta não segue o canal. Nos cards de "Canais parceiros", a bolinha verde pisca se alguma conta ainda não segue.

### Correções
- **Pontos de follow da Kick no Histórico:** o bônus que a Kick dá ao seguir um canal agora aparece no Histórico como **Follow**. Antes ele era contado como tempo assistido ou, se o saldo do canal ainda não tinha sido lido, nem entrava.

## 07/11/2026

### Novidades
- O botão **▶** também abre a live com o **botão do meio (scroll)** do mouse, para abrir várias seguidas.
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
