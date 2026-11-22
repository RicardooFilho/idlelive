# Design do painel

Como o painel (`public/index.html`) é desenhado. Estas regras descrevem o que o painel já faz: siga-as ao criar ou mudar uma tela, para tudo continuar com a mesma cara. As regras gerais (Web Awesome 3.14.0, Montserrat, sem build, `setHTML()`) estão no [AGENTS.md](AGENTS.md).

## Base

- Tema escuro fixo (`<html class="wa-dark">`). Fundo da página: `--wa-color-surface-lowered`; cards e menu: `--wa-color-surface-default`; bordas: `--wa-color-surface-border`.
- Texto secundário (dicas, datas, rótulos) usa `--wa-color-text-quiet`, de preferência pela classe `.meta` (12px).
- Números que mudam (pontos, saldos, contagens) usam `font-variant-numeric: tabular-nums` e `fmt()` (separador de milhar do pt-BR).
- Cantos: 8px em itens de menu e botões próprios, 10px em caixas de destaque, 16px na sidebar. Os componentes do Web Awesome ficam com o padrão deles.
- Títulos: `h1` do cabeçalho em 20px; `h2` dos cards em 15px, com ícone ou logo à esquerda (`display: flex; gap: 8px`). Rótulos de grupo (`.nav-label`, `.ov-label`, `.event-day`) são 11px, maiúsculos e espaçados (`letter-spacing: .08em`).

## Cores

Cada seção tem uma cor de destaque, que vira a cor "brand" do Web Awesome:

| Seção | Cor | Onde |
|---|---|---|
| Twitch (Pokeidle e LoLdle) | roxo `--twitch` | `#page-twitch`, `#page-lolidle`, `.brand-twitch` |
| Kick (Pokeidle e LoLdle) | verde `--kick` | `#page-kick`, `#page-lolidle-kick`, `.brand-kick` |
| O resto | laranja `--orange` | `:root`, `.brand-orange` |

- Cada tema define `--brand`, `--brand-on` (texto sobre a cor cheia), `--brand-soft` (fundo fraco) e `--brand-text` (texto colorido legível no escuro). Use essas variáveis em CSS próprio, e `variant="brand"` nos componentes.
- Janelas (`wa-dialog`) e gavetas ficam fora das páginas: dê a classe `brand-twitch`, `brand-kick` ou `brand-orange` para elas pegarem a cor certa.
- Não escreva cores direto no CSS. Se precisar de uma cor nova que se repete, crie uma variável no `:root`.
- Seção nova na Twitch ou na Kick: inclua o seletor dela nas duas regras de cor no começo do `<style>`.
- Cores que não mudam com a seção:
  - `--live` (verde): ao vivo, ganho de pontos, coisa boa (`.gained`, `.up`, sequência de dias).
  - `--error-text` (texto e ícones) e `--error-fill` (fundo): erros e o contador de espectadores (`.viewers`, como na Twitch).
  - `--wa-color-*` do Web Awesome (`success`, `warning`, `danger`, `neutral`) para estados.

## Layout

- Sidebar à esquerda (248px, recolhe para 80px só com ícones), cabeçalho fixo no topo e conteúdo com `padding: 24px 28px`. Abaixo de 860px a sidebar some e vira gaveta (botão ☰).
- Cada página é uma `<section class="page">` em coluna com `gap: 24px`. Avisos gerais ficam em `#alerts`, acima de todas as páginas.
- Grades:
  - `.kpis`: números de resumo, colunas de no mínimo 190px.
  - `.cards`: canais, colunas de no mínimo 290px, 4 por linha a partir de 1500px.
  - `.points-grid`: contas, colunas de no mínimo 340px, 4 por linha a partir de 1500px. O espaço livre vira um card tracejado "+ Adicionar conta" (`.points.add`).
  - `.games`: cards dos jogos na Visão geral, no mínimo 420px.
- Listas dentro de cards: `.row` (flex, `gap: 12px`, linha divisória entre itens, sem linha no último). Nome que pode ser longo: `flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis`.
- Tabelas (`.history`, `.points-table`): cabeçalho 12px fraco, números alinhados à direita (`.num`), dentro de um contêiner com `overflow-x: auto`.
- Tudo precisa funcionar no celular: use `flex-wrap`, `min()` nas larguras e `min-width` nos itens em vez de larguras fixas.

## Componentes

### Botões (`wa-button`)

| Uso | Como |
|---|---|
| Ação principal da tela ou do card | `variant="brand"` |
| Ação secundária (Adicionar, Abrir todos, Reiniciar) | `variant="brand" appearance="outlined"` |
| Ação discreta (Abrir →, Fechar, Cancelar) | `appearance="plain"` |
| Botão só com ícone (ajuda ⓘ, ▶, loja) | `appearance="plain"` + `<wa-icon label="…">` + `title` |

- Quase todos os botões dentro de cards são `size="small"`. Tamanho normal só em formulários e janelas.
- Ícone de apoio: `slot="start"` para a ação, `slot="end"` para seta ou link externo (`arrow-right`, `arrow-up-right-from-square`).
- Enquanto o servidor trabalha, use `loading` no botão, e não um texto de "carregando".
- Exceção: o "Resgatado" que aparece por um instante depois de um resgate é `variant="success"` (verde de "deu certo", com o ✓ e o confete). Não use `success` em outros botões.
- Não há botão vermelho. Ações destrutivas ficam no menu ⋮ da conta (`<wa-dropdown-item variant="danger">`) ou pedem confirmação com `ask({ danger: true })`.
- Botões e links levam `data-action="…"` e são tratados por um único ouvinte de cliques. Não use `onclick` no HTML.

### Cards (`wa-card`)

- O título vai em `<h2 slot="header">`, com o ícone da plataforma ou do jogo à esquerda. O botão de ajuda (`.help-btn`) fica logo depois do título, e ações do card vão para a direita (`margin-left: auto`).
- Canal offline: o card fica mais apagado (`.channel.offline`, opacidade .7). O botão de remover só aparece forte quando o mouse passa por cima (`.remove`).

### Avisos

| O quê | Componente | Ícone |
|---|---|---|
| Erro que o jogador precisa resolver | `<wa-callout variant="danger">` | `circle-exclamation` |
| Algo pode dar errado | `<wa-callout variant="warning">` | `triangle-exclamation` |
| Deu certo | `<wa-callout variant="success">` | `circle-check` |
| Dica ou informação | `<wa-callout variant="neutral">` | `circle-info` |
| Destaque da seção (atualização, código de vínculo) | `<wa-callout variant="brand">` | ícone do assunto |
| Resposta rápida de uma ação (salvo, erro do servidor) | `toast(msg)` (erro) ou `toast(msg, 'info')` | — |

- Todo callout tem `<wa-icon slot="icon">`. Avisos pequenos e empilhados usam `size="small"`.
- "Precisa de você" (Visão geral) junta num callout `warning` tudo o que o jogador tem de resolver. Some quando não há nada.
- Erros e coisas boas que o jogador deve ver mais tarde vão para a gaveta de acontecimentos (botões 🐞 e 🎁 no topo), pelo `addEvent` do servidor. Não crie outra lista de erros na tela.

### Badges e tags

- `wa-badge pill` mostra estado ou contagem:
  - `success`: quantos estão ao vivo (no menu e nos cards dos jogos, escondido quando é zero);
  - `danger`: conta com problema ("Vincule de novo", "Token recusado");
  - `neutral`: informação sem urgência;
  - `.viewers` (`danger` + `filled-outlined` + ícone `user`): espectadores.
- `wa-tag size="small"` descreve um item: `warning` para algo que impede (pausada, esgotada, em espera) e `neutral` para restrição (só inscritos).

### Janelas

- Confirmação: sempre `ask({ title, text, ok, danger, brand, summary, alt })`, nunca `confirm()` ou `alert()` do navegador. O título é uma pergunta curta ("Remover fulano?"); o texto diz o que acontece e se dá para voltar atrás ("Dá para adicionar de novo depois."); o botão repete o verbo ("Remover", não "OK").
- Ajuda "Como funciona": `wa-dialog` com `light-dismiss`, largura `min(680px, 94vw)`, aberta por um `.help-btn` ⓘ ao lado do título. O conteúdo usa `.farm-help`: blocos `<section>` com `<h3>` (ícone + frase) e parágrafos curtos.
- Toda janela tem `light-dismiss` (fecha clicando fora). Se ela precisar ser mais larga que o padrão, use `--width: min(<px>, 94vw)`, para caber no celular.

### Estados

- Carregando pela primeira vez: esboço (`skel()` + `data-skel`), que se desfaz com `.revealing` quando os dados chegam. Esperando o servidor: `.shimmer` no texto.
- Lista vazia: `<div class="empty">` com uma frase que diz o que fazer e onde ("Nenhum canal ainda. Adicione os canais parceiros do LoLdle aqui em cima.").
- Campo com valor errado: classe `is-error` + `.shake` no `wa-input`.
- Ao vivo: `.live-dot` (verde brilhando; na Kick, verde da Kick). Offline: `.off-dot` cinza e nome mais fraco.

## Ícones

Font Awesome grátis (`<wa-icon name="…">`), sempre com o mesmo significado:

| Ícone | Significa |
|---|---|
| `coins` | pontos do canal |
| `gift` | baú, recompensa, coisas boas |
| `store` | loja do canal |
| `play` | abrir a live |
| `eye` | assistindo / juntando pontos |
| `user` / `users` | espectadores, contas |
| `moon` | descanso diário |
| `bug` | erros |
| `check-to-slot` | votos |
| `chart-column` | histórico |
| `gear` / `sliders` | configurações |
| `circle-info` | ajuda e dica |
| `triangle-exclamation` | aviso, risco |
| `circle-exclamation` | erro |
| `circle-check` | deu certo |
| `link` / `link-slash` | vincular / desvincular |
| `power-off` | o painel precisa estar aberto |

- Logos da Twitch e da Kick: `<wa-icon family="brands" name="twitch">` e o SVG da Kick com `.brand-logo` (pinta com a cor do texto).
- Os ícones dos jogos (Pokeidle e LoLdle) são SVGs desenhados no HTML (`.nav-svg`), porque o Font Awesome grátis não tem.
- Ícone sem texto do lado precisa de `label` (leitor de tela) e o botão em volta precisa de `title`.

## Movimento

- Curva padrão: `cubic-bezier(0.22, 1, 0.36, 1)`. Entre 120 e 280 ms para menus, abas e sidebar; até 500 ms para comemoração (✓ do resgate, número que sobe, contador que "estoura").
- Animações vêm do Transitions.dev, adaptadas: o comentário no CSS diz qual é.
- Toda animação nova precisa de uma regra em `@media (prefers-reduced-motion: reduce)` que a desliga.
- Não anime na carga da página: a sidebar só ganha transição (`.anim`) depois do primeiro clique.

## Textos

- Português do Brasil, frases curtas, sem termos técnicos ("vincular conta", não "OAuth"; "janela preta", não "terminal").
- Fale com o jogador no imperativo e diga o caminho no painel com setas: "Vincule uma conta em Pokeidle → Twitch."
- Botões começam com verbo: Adicionar, Resgatar, Abrir todos, Atualizar agora.
- Nomes de botões e seções citados no texto vão em **negrito**.
- Erro diz o que fazer, não só o que falhou: "Cole um token novo para esta conta antes de resgatar."

