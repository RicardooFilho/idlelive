// Painel local + orquestração: status das lives da Twitch e da Kick e o farm de pontos do canal nas duas.
// Uso: npm start  →  http://localhost:3000
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, kick, pointsAccounts, saveConfig, saveKick, savePoints, normalizeChannel, MAX_ACCOUNTS } from './src/store.js';
import { fetchLive, fetchRewards, isNetworkError } from './src/twitch.js';
import { fetchKickLive, fetchKickChannel, resetKickToken } from './src/kick.js';
import { installedBrowsers, browserName, listProfiles, openInProfile } from './src/browser.js';
import { recordMinute, pointsHistory } from './src/stats.js';
import { autostartEnabled, setAutostart } from './src/autostart.js';
import { PointsMiner } from './src/points.js';
import { KickMiner } from './src/kickpoints.js';
import { sleep } from './src/human.js';
import { addEvent, recentEvents } from './src/events.js';

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
let liveOk = false; // a última checagem das lives da Twitch deu certo?
let liveError = null; // mensagem da última falha, para o aviso no painel
let liveOffline = false; // a última falha foi falta de internet?
const miner = new PointsMiner({ log });
const kickMiner = new KickMiner({ log });

// ---------- Twitch ----------

function syncPoints() {
  miner.setLive(config.channels.filter((c) => live.has(c)).map((name) => ({ name, channelId: live.get(name).userId, broadcastId: live.get(name).streamId })), config.channels);
}

async function updateLive() {
  try {
    live = await fetchLive(config.channels);
    liveOk = true;
    liveError = null;
    liveOffline = false;
  } catch (err) {
    liveOk = false;
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

// Um canal com erro não derruba a lista inteira: ele fica de fora (ou com os números antigos) e os outros seguem.
// Só se todos falharem o erro sobe, para virar aviso no painel.
async function scanKickLive() {
  const next = new Map();
  const errors = [];
  if (kickConfigured()) {
    const official = await fetchKickLive(kick, config.kickChannels);
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
    for (const slug of config.kickChannels) {
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
    if (errors.length === config.kickChannels.length) throw errors[0];
  }
  if (errors.length) {
    log(`Kick: ${errors.length} canal(is) não responderam agora (${errors[0].message})`);
    addEvent({ kind: 'bad', platform: 'kick', text: `${errors.length} canal(is) não responderam ao ver quem está ao vivo (${errors[0].message})` });
  }
  return next;
}

async function updateKickLive() {
  try {
    kickLive = config.kickChannels.length ? await scanKickLive() : new Map();
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
  kickMiner.setLive(
    config.kickChannels.filter((slug) => kickLive.get(slug)?.livestreamId).map((slug) => ({ slug, ...kickLive.get(slug) })),
    config.kickChannels,
  );
}

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
    channels: config.kickChannels.map((name) => ({
      name,
      live: kickLive.has(name),
      viewers: kickLive.get(name)?.viewers ?? 0,
    })),
  };
}

// Rotas /api/kick/<ação>/<id>/<sub>.
async function handleKick(req, res, url) {
  const [, , , action, rawId, rawSub] = url.pathname.split('/');
  const id = rawId && decodeURIComponent(rawId);
  const sub = rawSub && decodeURIComponent(rawSub);

  if (req.method === 'PUT' && action === 'app') {
    const { clientId, clientSecret } = await readBody(req);
    kick.clientId = String(clientId ?? '').trim();
    kick.clientSecret = String(clientSecret ?? '').trim();
    saveKick();
    resetKickToken();
    await updateKickLive();
    return send(res, 200, state());
  }

  if (req.method === 'PUT' && action === 'browser') {
    const { browser } = await readBody(req);
    if (!installedBrowsers().some((b) => b.id === browser)) return send(res, 400, { error: 'Navegador não encontrado neste PC' });
    if (browser !== currentBrowser()) {
      // Os perfis são de cada navegador: ao trocar, os perfis das contas são escolhidos de novo.
      kick.browser = browser;
      for (const a of kick.accounts ?? []) a.profile = null;
      for (const a of pointsAccounts) a.profile = null;
      saveKick();
      savePoints();
      log(`Navegador trocado para ${browserName(browser)}`);
    }
    return send(res, 200, state());
  }

  if (action === 'accounts') {
    if (req.method === 'POST' && !id) {
      await kickMiner.addAccount((await readBody(req)).token);
      return send(res, 200, state());
    }
    if (req.method === 'DELETE' && id && !sub) {
      kickMiner.removeAccount(id);
      return send(res, 200, state());
    }
    if (req.method === 'PUT' && sub === 'profile') {
      const { profile } = await readBody(req);
      if (profile && !listProfiles(currentBrowser()).some((p) => p.dir === profile)) return send(res, 400, { error: 'Perfil não encontrado' });
      kickMiner.setProfile(id, profile);
      return send(res, 200, state());
    }
    if (req.method === 'POST' && sub === 'open') {
      const channel = normalizeChannel((await readBody(req)).channel ?? '');
      if (!config.kickChannels.includes(channel)) return send(res, 400, { error: 'Canal não está na lista' });
      openInProfile(currentBrowser(), kickMiner.profileOf(id), `https://kick.com/${channel}`);
      log(`Kick: abrindo #${channel} no navegador`);
      return send(res, 200, state());
    }
  }

  if (action === 'channels') {
    if (req.method === 'POST') {
      const name = normalizeChannel((await readBody(req)).name ?? '');
      if (!/^[\w-]{3,25}$/.test(name)) return send(res, 400, { error: 'Nome de canal inválido' });
      if (!config.kickChannels.includes(name)) {
        config.kickChannels.push(name);
        saveConfig();
        kickScanAt = 0;
        await updateKickLive();
      }
      return send(res, 200, state());
    }

    if (req.method === 'DELETE' && id) {
      config.kickChannels = config.kickChannels.filter((c) => c !== id);
      kickLive.delete(id);
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
  };
}

// Problemas para mostrar no topo do painel: [{ variant: 'danger' | 'warning', text }].
// Sem internet vira um aviso só, em vez de um por conta dizendo que a Twitch recusou.
function alerts() {
  const offline = liveOffline || miner.offline || kickOffline || kickMiner.offline;
  const list = [];
  if (offline) {
    list.push({ variant: 'warning', text: 'Sem conexão com a internet. Os pontos não contam enquanto ela estiver fora; o painel volta sozinho quando ela voltar.' });
  } else {
    if (liveError) list.push({ variant: 'danger', text: `Não deu para ver quem está ao vivo na Twitch: ${liveError}` });
    if (kickError) list.push({ variant: 'danger', text: `Não deu para ver quem está ao vivo na Kick: ${kickError}` });
  }
  return [...list, ...miner.alerts({ offline }), ...kickMiner.alerts({ offline })];
}

// A cada minuto: anota quais canais estão ao vivo (para os horários).
function recordStats() {
  const twitchOk = liveOk && config.channels.length > 0;
  const kickOk = !kickError && config.kickChannels.length > 0;
  recordMinute({
    twitchLive: twitchOk ? config.channels.filter((c) => live.has(c)) : null,
    kickLive: kickOk ? config.kickChannels.filter((c) => kickLive.has(c)) : null,
  });
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

  if (req.method === 'POST' && resource === 'restart') {
    if (!CAN_RESTART) return send(res, 400, { error: 'Para reiniciar por aqui, abra o painel pelo iniciar.bat' });
    send(res, 200, { restarting: true });
    log('Reiniciando o servidor…');
    // O iniciar.bat abre o servidor de novo quando ele sai com esse código.
    setTimeout(() => process.exit(RESTART_CODE), 300);
    return;
  }

  // Loja de um canal da Twitch: recompensas (lidas sem login) e o saldo de cada conta nele.
  if (req.method === 'GET' && resource === 'rewards' && id) {
    const channel = normalizeChannel(id);
    if (!config.channels.includes(channel)) return send(res, 400, { error: 'Canal não está na lista' });
    return send(res, 200, { channel, ...(await fetchRewards(channel)) });
  }

  if (req.method === 'PUT' && resource === 'autostart') {
    const { enabled } = await readBody(req);
    setAutostart(!!enabled);
    log(enabled ? 'Painel vai abrir junto com o Windows' : 'Painel não abre mais junto com o Windows');
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
      config.channels = config.channels.filter((c) => c !== id);
      live.delete(id);
      saveConfig();
      syncPoints();
      return send(res, 200, state());
    }
  }

  send(res, 404, { error: 'Rota não encontrada' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
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
    send(res, 500, { error: err.message });
  }
});

// ---------- Início ----------

await miner.ensureFresh().catch((err) => log(`Pontos: erro ao checar token (${err.message})`));
await safeUpdateLive();
await updateKickLive();
miner.start();
kickMiner.start();
setInterval(safeUpdateLive, LIVE_INTERVAL);
setInterval(updateKickLive, LIVE_INTERVAL);
setInterval(() => miner.ensureFresh().catch((err) => log(`Pontos: erro ao checar token (${err.message})`)), TOKEN_INTERVAL);
setInterval(() => {
  try {
    recordStats();
  } catch (err) {
    log(`Erro ao salvar estatísticas: ${err.message}`);
  }
}, 60 * 1000);

server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') throw err;
  console.log(`O painel já está aberto em outra janela (porta ${PORT} em uso). Feche a outra janela ou use http://localhost:${PORT}`);
  process.exit(1);
});

// Só escuta no próprio PC: o painel dá acesso às contas.
server.listen(PORT, '127.0.0.1', () => log(`Painel em http://localhost:${PORT}`));
