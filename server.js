// Painel local + orquestração: status das lives da Twitch e da Kick e o farm de pontos do canal nas duas.
// Uso: npm start  →  http://localhost:3000
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, kick, pointsAccounts, saveConfig, saveKick, savePoints, normalizeChannel, MAX_ACCOUNTS, GAMES, gameEnabled, setGameEnabled } from './src/store.js';
import { fetchLive, fetchRewards, isNetworkError } from './src/twitch.js';
import { fetchKickLive, fetchKickChannel, fetchKickRewards, resetKickToken } from './src/kick.js';
import { installedBrowsers, browserName, listProfiles, openInProfile } from './src/browser.js';
import { saveStats, pointsHistory } from './src/stats.js';
import { autostartEnabled, setAutostart } from './src/autostart.js';
import { PointsMiner } from './src/points.js';
import { KickMiner } from './src/kickpoints.js';
import { LolIdleMiner } from './src/lolidle.js';
import { sleep } from './src/human.js';
import { addEvent, recentEvents } from './src/events.js';
import { Updater } from './src/update.js';
import { addVoter, removeVoter, setVoterProfile, clearVoterProfiles, openVote, votesState } from './src/votes.js';

const PORT = Number(process.env.PORT) || 3000;
const LIVE_INTERVAL = 60 * 1000;
const TOKEN_INTERVAL = 30 * 60 * 1000;
// O botão "Reiniciar servidor" só funciona quando o painel foi aberto pelo iniciar.bat, que repete ao receber esse código.
const RESTART_CODE = 75;
const CAN_RESTART = process.env.IDLELIVE_LAUNCHER === '1';
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const PANEL_FILE = path.join(PUBLIC_DIR, 'index.html');
const FAVICON_FILE = path.join(PUBLIC_DIR, 'favicon.ico');

const log = (msg) => console.log(`[${new Date().toLocaleTimeString('pt-BR')}] ${msg}`);

let live = new Map(); // canal -> { viewers, userId, streamId }
let liveError = null; // mensagem da última falha, para o aviso no painel
let liveOffline = false; // a última falha foi falta de internet?
const miner = new PointsMiner({ log });
const kickMiner = new KickMiner({ log });
// Contas da Kick do LoLdle: as mesmas regras do Pokeidle, com contas e canais próprios.
// Uma conta não fica nos dois jogos ao mesmo tempo (a Kick só conta 2 lives por conta).
const lolKickMiner = new KickMiner({ log, game: 'lolidle', saved: kick.lolidleAccounts, isTaken: (id) => kickMiner.has(id) && 'Pokeidle → Kick' });
kickMiner.isTaken = (id) => lolKickMiner.has(id) && 'LoLdle → Kick';
const lolMiner = new LolIdleMiner({ log });
const updater = new Updater({ log });

// Jogo desligado em Configurações → Jogos: as contas dele param e as lives dele não são consultadas.
function applyGames() {
  miner.setEnabled(gameEnabled('pokeidle'));
  kickMiner.setEnabled(gameEnabled('pokeidle'));
  lolMiner.setEnabled(gameEnabled('lolidle'));
  lolKickMiner.setEnabled(gameEnabled('lolidle'));
}
applyGames();

// ---------- Twitch ----------

function syncPoints() {
  miner.setLive(config.channels.filter((c) => live.has(c)).map((name) => ({ name, channelId: live.get(name).userId, broadcastId: live.get(name).streamId })), config.channels);
  lolMiner.setLive(config.lolidleChannels, live);
}

async function updateLive() {
  try {
    // Uma consulta só para os canais do Pokeidle e do LoLdle (um canal pode estar nas duas listas), só dos jogos ligados.
    const channels = [...(gameEnabled('pokeidle') ? config.channels : []), ...(gameEnabled('lolidle') ? config.lolidleChannels : [])];
    live = channels.length ? await fetchLive([...new Set(channels)]) : new Map();
    liveError = null;
    liveOffline = false;
  } catch (err) {
    if (err.message !== liveError) addEvent({ kind: 'bad', platform: 'twitch', text: `não deu para ver quem está ao vivo (${err.message})` });
    liveError = err.message;
    liveOffline = isNetworkError(err);
    throw err;
  } finally {
    syncPoints();
  }
}

const safeUpdateLive = () => updateLive().catch((err) => log(`Erro ao checar lives: ${err.message}`));

// ---------- Kick ----------

let kickLive = new Map(); // slug -> { viewers, channelId, userId, livestreamId }
let kickError = null;
let kickOffline = false;
let kickScanAt = 0;
// Números do canal e da live, guardados por transmissão (startTime) para não pedir de novo a cada minuto.
const kickIds = new Map(); // slug -> { key, channelId, userId, livestreamId }
const KICK_SCAN_INTERVAL = 2 * 60 * 1000; // sem o app da Kick, checa canal por canal, então com menos frequência

// O app da Kick (API oficial) é opcional: ele diz quem está ao vivo num pedido só. Sem ele, o painel pergunta canal por canal.
const kickConfigured = () => !!(kick.clientId && kick.clientSecret);

// Canais da Kick consultados: os do Pokeidle e os do LoLdle (um canal pode estar nas duas listas), só dos jogos ligados.
const kickChannelsToScan = () => [...new Set([
  ...(gameEnabled('pokeidle') ? config.kickChannels : []),
  ...(gameEnabled('lolidle') ? config.lolidleKickChannels : []),
])];

// Um canal com erro não derruba a lista inteira: ele fica de fora (ou com os números antigos) e os outros seguem.
// Só se todos falharem o erro sobe, para virar aviso no painel.
async function scanKickLive(slugs) {
  const next = new Map();
  const errors = [];
  if (kickConfigured()) {
    const official = await fetchKickLive(kick, slugs);
    for (const [slug, info] of official) {
      let ids = kickIds.get(slug);
      if (!ids || ids.key !== info.startTime) {
        try {
          ids = { key: info.startTime, ...(await fetchKickChannel(slug)) };
          // Live que acabou de começar pode ainda não ter número; tenta de novo na próxima vez.
          if (ids.livestreamId) kickIds.set(slug, ids);
        } catch (err) {
          errors.push(err);
          ids = kickIds.get(slug) ?? {};
        }
        await sleep(300);
      }
      next.set(slug, { viewers: info.viewers, channelId: ids.channelId, userId: ids.userId, livestreamId: ids.livestreamId });
    }
    if (official.size && errors.length === official.size) throw errors[0];
  } else {
    if (Date.now() - kickScanAt < KICK_SCAN_INTERVAL) return kickLive;
    kickScanAt = Date.now();
    for (const slug of slugs) {
      try {
        const channel = await fetchKickChannel(slug);
        if (channel.livestreamId) next.set(slug, channel);
      } catch (err) {
        errors.push(err);
        // Sem resposta agora: mantém o que se sabia desse canal até a próxima checagem.
        if (kickLive.has(slug)) next.set(slug, kickLive.get(slug));
      }
      await sleep(300);
    }
    if (errors.length === slugs.length) throw errors[0];
  }
  if (errors.length) {
    log(`Kick: ${errors.length} canal(is) não responderam agora (${errors[0].message})`);
    addEvent({ kind: 'bad', platform: 'kick', text: `${errors.length} canal(is) não responderam ao ver quem está ao vivo (${errors[0].message})` });
  }
  return next;
}

async function updateKickLive() {
  try {
    // Com os dois jogos desligados (ou sem canais), nem consulta.
    const slugs = kickChannelsToScan();
    kickLive = slugs.length ? await scanKickLive(slugs) : new Map();
    kickError = null;
    kickOffline = false;
  } catch (err) {
    if (err.message !== kickError) addEvent({ kind: 'bad', platform: 'kick', text: `não deu para ver quem está ao vivo (${err.message})` });
    kickError = err.message;
    kickOffline = isNetworkError(err);
  }
  syncKick();
}

function syncKick() {
  for (const [m, channels] of [[kickMiner, config.kickChannels], [lolKickMiner, config.lolidleKickChannels]]) {
    m.setLive(channels.filter((slug) => kickLive.get(slug)?.livestreamId).map((slug) => ({ slug, ...kickLive.get(slug) })), channels);
  }
}

const kickChannelsState = (channels) => channels.map((name) => ({ name, live: kickLive.has(name), viewers: kickLive.get(name)?.viewers ?? 0 }));

// Navegador escolhido no painel; sem escolha, o primeiro instalado (Chrome, Brave, Edge). Usado pelo ▶ das duas plataformas.
const currentBrowser = () => kick.browser ?? installedBrowsers()[0]?.id ?? null;

function kickState() {
  const browser = currentBrowser();
  const browsers = installedBrowsers();
  return {
    appConfigured: kickConfigured(),
    error: kickError,
    browsers,
    browser,
    browserFound: browsers.some((b) => b.id === browser),
    availableProfiles: listProfiles(browser),
    points: kickMiner.state(),
    channels: kickChannelsState(config.kickChannels),
  };
}

// Rotas da Kick: /api/kick/<ação>/<id>/<sub> (Pokeidle, mais o app e o navegador) e /api/lolkick/<ação>/<id>/<sub> (LoLdle).
// As contas, a loja e os canais funcionam igual nos dois jogos; muda só o miner e a lista de canais.
async function handleKick(req, res, url, game = 'pokeidle') {
  const [, , , action, rawId, rawSub] = url.pathname.split('/');
  const id = rawId && decodeURIComponent(rawId);
  const sub = rawSub && decodeURIComponent(rawSub);
  const lol = game === 'lolidle';
  const accounts = lol ? lolKickMiner : kickMiner;
  const listKey = lol ? 'lolidleKickChannels' : 'kickChannels';
  const inList = (channel) => config[listKey].includes(channel);

  if (!lol && req.method === 'PUT' && action === 'app') {
    const { clientId, clientSecret } = await readBody(req);
    kick.clientId = String(clientId ?? '').trim();
    kick.clientSecret = String(clientSecret ?? '').trim();
    saveKick();
    resetKickToken();
    await updateKickLive();
    return send(res, 200, state());
  }

  if (!lol && req.method === 'PUT' && action === 'browser') {
    const { browser } = await readBody(req);
    if (!installedBrowsers().some((b) => b.id === browser)) return send(res, 400, { error: 'Navegador não encontrado neste PC' });
    if (browser !== currentBrowser()) {
      // Os perfis são de cada navegador: ao trocar, os perfis das contas são escolhidos de novo.
      kick.browser = browser;
      for (const a of [...kick.accounts, ...kick.lolidleAccounts]) a.profile = null;
      for (const a of pointsAccounts) a.profile = null;
      saveKick();
      savePoints();
      clearVoterProfiles();
      log(`Navegador trocado para ${browserName(browser)}`);
    }
    return send(res, 200, state());
  }

  if (action === 'accounts') {
    if (req.method === 'POST' && !id) {
      await accounts.addAccount((await readBody(req)).token);
      return send(res, 200, state());
    }
    if (req.method === 'DELETE' && id && !sub) {
      accounts.removeAccount(id);
      return send(res, 200, state());
    }
    if (req.method === 'PUT' && sub === 'profile') {
      const { profile } = await readBody(req);
      if (profile && !listProfiles(currentBrowser()).some((p) => p.dir === profile)) return send(res, 400, { error: 'Perfil não encontrado' });
      accounts.setProfile(id, profile);
      return send(res, 200, state());
    }
    if (req.method === 'POST' && sub === 'open') {
      const channel = normalizeChannel((await readBody(req)).channel ?? '');
      if (!inList(channel)) return send(res, 400, { error: 'Canal não está na lista' });
      openInProfile(currentBrowser(), accounts.profileOf(id), `https://kick.com/${channel}`);
      log(`Kick: abrindo #${channel} no navegador`);
      return send(res, 200, state());
    }
    if (req.method === 'POST' && sub === 'redeem') {
      const { channel: raw, rewardId, text } = await readBody(req);
      const channel = normalizeChannel(raw ?? '');
      if (!inList(channel)) return send(res, 400, { error: 'Canal não está na lista' });
      try {
        const reward = await accounts.find(id).redeem(channel, String(rewardId ?? ''), String(text ?? ''));
        return send(res, 200, { ...state(), redeemed: { title: reward.title, cost: reward.cost } });
      } catch (err) {
        return send(res, 400, { error: `Não deu para resgatar: ${err.message}` });
      }
    }
  }

  // Loja de um canal da Kick: recompensas lidas sem login (o saldo de cada conta vem do state).
  if (req.method === 'GET' && action === 'rewards' && id) {
    const channel = normalizeChannel(id);
    if (!inList(channel)) return send(res, 400, { error: 'Canal não está na lista' });
    return send(res, 200, { channel, ...(await fetchKickRewards(channel)) });
  }

  if (action === 'channels') {
    if (req.method === 'POST') {
      const name = normalizeChannel((await readBody(req)).name ?? '');
      if (!/^[\w-]{3,25}$/.test(name)) return send(res, 400, { error: 'Nome de canal inválido' });
      if (!inList(name)) {
        config[listKey].push(name);
        saveConfig();
        kickScanAt = 0;
        await updateKickLive();
      }
      return send(res, 200, state());
    }

    if (req.method === 'DELETE' && id) {
      config[listKey] = config[listKey].filter((c) => c !== id);
      // Só sai de kickLive se não estiver também na lista do outro jogo.
      if (![...config.kickChannels, ...config.lolidleKickChannels].includes(id)) kickLive.delete(id);
      saveConfig();
      syncKick();
      return send(res, 200, state());
    }
  }

  send(res, 404, { error: 'Rota não encontrada' });
}

// ---------- HTTP ----------

function state() {
  return {
    maxAccounts: MAX_ACCOUNTS,
    autostart: autostartEnabled(),
    canRestart: CAN_RESTART,
    update: updater.state(),
    games: Object.fromEntries(GAMES.map((g) => [g, gameEnabled(g)])),
    channels: config.channels.map((name) => ({
      name,
      live: live.has(name),
      viewers: live.get(name)?.viewers ?? 0,
    })),
    points: miner.state(),
    pointsHistory: pointsHistory(),
    alerts: alerts(),
    events: recentEvents(),
    kick: kickState(),
    votes: votesState(),
    lolidle: {
      ...lolMiner.state(),
      channels: config.lolidleChannels.map((name) => ({ name, live: live.has(name), viewers: live.get(name)?.viewers ?? 0 })),
      kick: { points: lolKickMiner.state(), channels: kickChannelsState(config.lolidleKickChannels) },
    },
  };
}

// Problemas para mostrar no topo do painel: [{ variant: 'danger' | 'warning', text }].
// Sem internet vira um aviso só, em vez de um por conta dizendo que a Twitch recusou.
function alerts() {
  const offline = liveOffline || miner.offline || kickOffline || kickMiner.offline || lolKickMiner.offline;
  const list = [];
  if (offline) {
    list.push({ variant: 'warning', text: 'Sem conexão com a internet. Os pontos não contam enquanto ela estiver fora; o painel volta sozinho quando ela voltar.' });
  } else {
    if (liveError) list.push({ variant: 'danger', text: `Não deu para ver quem está ao vivo na Twitch: ${liveError}` });
    if (kickError) list.push({ variant: 'danger', text: `Não deu para ver quem está ao vivo na Kick: ${kickError}` });
  }
  // O aviso de "atualize o Node.js" vem igual dos dois jogos: entra uma vez só.
  const kickAlerts = [...kickMiner.alerts({ offline }), ...lolKickMiner.alerts({ offline })].filter((a, i, all) => all.findIndex((b) => b.text === a.text) === i);
  return [...list, ...miner.alerts({ offline }), ...kickAlerts];
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function handleApi(req, res, url) {
  const [, , resource, rawId, rawSub] = url.pathname.split('/'); // /api/<resource>/<id>
  const id = rawId && decodeURIComponent(rawId);

  if (req.method === 'GET' && resource === 'state') return send(res, 200, state());
  if (resource === 'kick') return handleKick(req, res, url);
  if (resource === 'lolkick') return handleKick(req, res, url, 'lolidle');

  if (req.method === 'POST' && resource === 'restart') {
    if (!CAN_RESTART) return send(res, 400, { error: 'Para reiniciar por aqui, abra o painel pelo iniciar.bat' });
    send(res, 200, { restarting: true });
    log('Reiniciando o servidor…');
    // O iniciar.bat abre o servidor de novo quando ele sai com esse código.
    setTimeout(() => process.exit(RESTART_CODE), 300);
    return;
  }

  // Atualização: /api/update/check (procurar agora) e /api/update (baixar e instalar a versão nova).
  if (req.method === 'POST' && resource === 'update') {
    if (id === 'check') {
      await updater.check();
      return send(res, 200, state());
    }
    let result;
    try {
      result = await updater.install();
    } catch (err) {
      return send(res, 400, { error: `Não deu para atualizar: ${err.message}` });
    }
    // Com o iniciar.bat trocado, o cmd que roda ele pode se perder: o jogador fecha a janela e abre de novo.
    const restart = CAN_RESTART && !result.launcherChanged;
    send(res, 200, { ...state(), updated: { ...result, restart } });
    if (restart) {
      log('Reiniciando para usar a versão nova…');
      setTimeout(() => process.exit(RESTART_CODE), 300);
    }
    return;
  }

  // Loja de um canal da Twitch: recompensas (lidas sem login) e o saldo de cada conta nele.
  if (req.method === 'GET' && resource === 'rewards' && id) {
    const channel = normalizeChannel(id);
    if (!config.channels.includes(channel)) return send(res, 400, { error: 'Canal não está na lista' });
    return send(res, 200, { channel, ...(await fetchRewards(channel)) });
  }

  // Ligar ou desligar um jogo: { game: 'pokeidle' | 'lolidle', enabled }.
  if (req.method === 'PUT' && resource === 'games') {
    const { game, enabled } = await readBody(req);
    if (!GAMES.includes(game)) return send(res, 400, { error: 'Jogo desconhecido' });
    setGameEnabled(game, enabled);
    applyGames();
    log(`${game === 'pokeidle' ? 'Pokeidle' : 'LoLdle'} ${enabled ? 'ligado' : 'desligado'}`);
    // Vê quem está ao vivo de novo: ligou, as contas começam sem esperar o próximo minuto;
    // desligou, as lives daquele jogo saem do painel (com os dois desligados, a Kick nem é consultada).
    await safeUpdateLive();
    kickScanAt = 0;
    await updateKickLive();
    return send(res, 200, state());
  }

  if (req.method === 'PUT' && resource === 'autostart') {
    const { enabled } = await readBody(req);
    setAutostart(!!enabled);
    log(enabled ? 'Painel vai abrir junto com o Windows' : 'Painel não abre mais junto com o Windows');
    return send(res, 200, state());
  }

  // Votos no idlehub: /api/votes (adicionar), /api/votes/<id> (remover), /api/votes/<id>/profile (perfil do navegador)
  // e /api/votes/<id>/open (abrir a página de voto nesse perfil, com o nick preenchido).
  if (resource === 'votes') {
    const sub = rawSub && decodeURIComponent(rawSub);
    const knownProfile = (profile) => !profile || listProfiles(currentBrowser()).some((p) => p.dir === profile);
    try {
      if (req.method === 'POST' && !id) {
        const { game, player, profile } = await readBody(req);
        if (!knownProfile(profile)) return send(res, 400, { error: 'Perfil não encontrado' });
        addVoter({ game, player, profile });
      } else if (req.method === 'DELETE' && id && !sub) removeVoter(id);
      else if (req.method === 'PUT' && sub === 'profile') {
        const { profile } = await readBody(req);
        if (!knownProfile(profile)) return send(res, 400, { error: 'Perfil não encontrado' });
        setVoterProfile(id, profile);
      } else if (req.method === 'POST' && sub === 'open') {
        const voter = votesState().voters.find((v) => v.id === id);
        if (!voter) return send(res, 400, { error: 'Voto não encontrado' });
        openInProfile(currentBrowser(), voter.profile, openVote(id));
        log(`Votos: abrindo a página de voto de ${voter.player}`);
      } else return send(res, 404, { error: 'Rota não encontrada' });
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
    return send(res, 200, state());
  }

  // Contas de pontos do canal: /api/points/link (vincular), /api/points/<login> (desvincular),
  // /api/points/<login>/profile (perfil do navegador), /api/points/<login>/open (abrir uma live nesse perfil)
  // e /api/points/<login>/redeem (resgatar uma recompensa da loja).
  if (resource === 'points') {
    const sub = rawSub && decodeURIComponent(rawSub);
    if (req.method === 'POST' && id === 'link') await miner.startLink();
    else if (req.method === 'DELETE' && id === 'link') miner.cancelLink();
    else if (req.method === 'PUT' && sub === 'profile') {
      const { profile } = await readBody(req);
      if (profile && !listProfiles(currentBrowser()).some((p) => p.dir === profile)) return send(res, 400, { error: 'Perfil não encontrado' });
      miner.setProfile(id, profile);
    } else if (req.method === 'POST' && sub === 'open') {
      const channel = normalizeChannel((await readBody(req)).channel ?? '');
      if (!config.channels.includes(channel)) return send(res, 400, { error: 'Canal não está na lista' });
      openInProfile(currentBrowser(), miner.profileOf(id), `https://www.twitch.tv/${channel}`);
      log(`Pontos (${id}): abrindo #${channel} no navegador`);
    } else if (req.method === 'POST' && sub === 'redeem') {
      const { channel: raw, rewardId, text } = await readBody(req);
      const channel = normalizeChannel(raw ?? '');
      if (!config.channels.includes(channel)) return send(res, 400, { error: 'Canal não está na lista' });
      try {
        const reward = await miner.find(id).redeem(channel, String(rewardId ?? ''), String(text ?? ''));
        return send(res, 200, { ...state(), redeemed: { title: reward.title, cost: reward.cost } });
      } catch (err) {
        return send(res, 400, { error: `Não deu para resgatar: ${err.message}` });
      }
    } else if (req.method === 'DELETE' && id && !sub) miner.unlink(id);
    else return send(res, 404, { error: 'Rota não encontrada' });
    return send(res, 200, state());
  }

  // LoLdle: /api/lolidle/link (vincular), /api/lolidle/<login> (desvincular)
  // e /api/lolidle/channels[/<canal>] (adicionar e remover canais).
  if (resource === 'lolidle') {
    if (id === 'channels') {
      if (req.method === 'POST') {
        const name = normalizeChannel((await readBody(req)).name ?? '');
        if (!/^\w{3,25}$/.test(name)) return send(res, 400, { error: 'Nome de canal inválido' });
        if (!config.lolidleChannels.includes(name)) {
          config.lolidleChannels.push(name);
          saveConfig();
          await safeUpdateLive();
        }
      } else if (req.method === 'DELETE' && rawSub) {
        const name = decodeURIComponent(rawSub);
        config.lolidleChannels = config.lolidleChannels.filter((c) => c !== name);
        saveConfig();
        syncPoints();
      } else return send(res, 404, { error: 'Rota não encontrada' });
    } else if (req.method === 'POST' && id === 'link') await lolMiner.startLink();
    else if (req.method === 'DELETE' && id === 'link') lolMiner.cancelLink();
    else if (req.method === 'DELETE' && id) lolMiner.unlink(id);
    else return send(res, 404, { error: 'Rota não encontrada' });
    return send(res, 200, state());
  }

  if (resource === 'channels') {
    if (req.method === 'POST') {
      const name = normalizeChannel((await readBody(req)).name ?? '');
      if (!/^\w{3,25}$/.test(name)) return send(res, 400, { error: 'Nome de canal inválido' });
      if (!config.channels.includes(name)) {
        config.channels.push(name);
        saveConfig();
        await safeUpdateLive();
      }
      return send(res, 200, state());
    }

    if (req.method === 'DELETE' && id) {
      // Não tira o canal de `live`: ele pode estar também na lista do LoLdle, e as contas sairiam do chat à toa.
      config.channels = config.channels.filter((c) => c !== id);
      saveConfig();
      syncPoints();
      return send(res, 200, state());
    }
  }

  send(res, 404, { error: 'Rota não encontrada' });
}

// Só o próprio painel fala com o servidor. Qualquer site aberto no navegador consegue mandar pedidos para o
// localhost (adicionar um canal, reiniciar…), então:
// - o endereço pedido tem de ser o deste PC, o que barra um domínio de fora apontado para 127.0.0.1;
// - quando o navegador diz de que página veio o pedido (Origin), tem de ser a do painel.
const LOCAL_HOST = /^(localhost|127\.0\.0\.1)(:\d+)?$/i;

const server = http.createServer(async (req, res) => {
  try {
    const { host = '', origin } = req.headers;
    if (!LOCAL_HOST.test(host)) return send(res, 403, { error: 'Abra o painel pelo endereço http://localhost' });
    // Endereço torto (ex.: "//") faz o URL lançar erro: responde 400 em vez de derrubar o servidor.
    let url;
    try {
      url = new URL(req.url, `http://${host}`);
    } catch {
      return send(res, 400, { error: 'Endereço inválido' });
    }
    if (url.pathname.startsWith('/api/')) {
      if (origin && origin !== `http://${host}`) return send(res, 403, { error: 'Pedido de fora do painel' });
      return await handleApi(req, res, url);
    }
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(PANEL_FILE));
    }
    if (url.pathname === '/favicon.ico') {
      res.writeHead(200, { 'Content-Type': 'image/x-icon', 'Cache-Control': 'max-age=86400' });
      return res.end(fs.readFileSync(FAVICON_FILE));
    }
    send(res, 404, { error: 'Não encontrado' });
  } catch (err) {
    // Se a resposta já começou, mandar outra lançaria um erro sem ninguém para pegar.
    if (res.headersSent) res.end();
    else send(res, 500, { error: err.message });
  }
});

// ---------- Início ----------

server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') throw err;
  console.log(`O painel já está aberto em outra janela (porta ${PORT} em uso). Feche a outra janela ou use http://localhost:${PORT}`);
  process.exit(1);
});

// Abre a porta antes de mexer nos logins: se o painel já estiver aberto em outra janela, este para aqui, sem
// renovar nada (o refresh token só vale uma vez; renovado pelos dois, a conta cairia no outro).
// De quebra, o painel já abre no navegador enquanto as primeiras checagens rodam.
// Só escuta no próprio PC: o painel dá acesso às contas.
await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
log(`Painel em http://localhost:${PORT}`);

await miner.ensureFresh().catch((err) => log(`Pontos: erro ao checar token (${err.message})`));
await lolMiner.ensureFresh();
await safeUpdateLive();
await updateKickLive();
miner.start();
kickMiner.start();
lolKickMiner.start();
lolMiner.start();
updater.start();
setInterval(safeUpdateLive, LIVE_INTERVAL);
setInterval(updateKickLive, LIVE_INTERVAL);
setInterval(() => miner.ensureFresh().catch((err) => log(`Pontos: erro ao checar token (${err.message})`)), TOKEN_INTERVAL);
setInterval(() => lolMiner.ensureFresh(), TOKEN_INTERVAL);
// A cada minuto: grava no stats.json os pontos anotados desde a última vez.
setInterval(() => {
  try {
    saveStats();
  } catch (err) {
    log(`Erro ao salvar estatísticas: ${err.message}`);
  }
}, 60 * 1000);
