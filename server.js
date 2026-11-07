// Painel local + orquestração: status das lives da Twitch e da Kick, pontos do canal e janelas da Kick.
// Uso: npm start  →  http://localhost:3000
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, kick, saveConfig, saveKick, normalizeChannel, MAX_ACCOUNTS } from './src/store.js';
import { fetchLive } from './src/twitch.js';
import { fetchKickLive, resetKickToken } from './src/kick.js';
import { installedBrowsers, browserName, listProfiles, openWatchWindow, closeWatchWindows, openWindowCount, openWindowList } from './src/browser.js';
import { recordMinute, liveHours } from './src/stats.js';
import { autostartEnabled, setAutostart } from './src/autostart.js';
import { PointsMiner } from './src/points.js';

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
const miner = new PointsMiner({ log });

// ---------- Twitch ----------

function syncPoints() {
  miner.setLive(config.channels.filter((c) => live.has(c)).map((name) => ({ name, channelId: live.get(name).userId, broadcastId: live.get(name).streamId })), config.channels);
}

async function updateLive() {
  try {
    live = await fetchLive(config.channels);
    liveOk = true;
  } catch (err) {
    liveOk = false;
    throw err;
  } finally {
    syncPoints();
  }
}

const safeUpdateLive = () => updateLive().catch((err) => log(`Erro ao checar lives: ${err.message}`));

// ---------- Kick (só status das lives + abrir o player no perfil escolhido) ----------

let kickLive = new Map(); // slug -> { viewers }
let kickError = null;

const kickConfigured = () => !!(kick.clientId && kick.clientSecret);

async function updateKickLive() {
  if (!kickConfigured() || config.kickChannels.length === 0) {
    kickLive = new Map();
    return;
  }
  try {
    kickLive = await fetchKickLive(kick, config.kickChannels);
    kickError = null;
  } catch (err) {
    kickError = err.message;
  }
}

// Janelas pequenas num bloco 2x2 no canto inferior direito da tela, sem sobrepor.
// O navegador pode aumentar um pouco se for menor que o mínimo dele.
const KICK_WINDOW = { width: 360, height: 260 };

// Navegador escolhido no painel; sem escolha, o primeiro instalado (Chrome, Brave, Edge).
const currentBrowser = () => kick.browser ?? installedBrowsers()[0]?.id ?? null;

// Sem `profile`, abre o canal em todas as contas da Kick.
function watchKick({ channel, profile, screen }) {
  if (!config.kickChannels.includes(channel)) throw new Error('Canal não está na lista');
  if (profile === undefined) {
    if (kick.profiles.length === 0) throw new Error('Marque os perfis do navegador que vão ser as contas da Kick');
    for (const p of kick.profiles) watchKick({ channel, profile: p, screen });
    return;
  }
  const slot = kick.profiles.indexOf(profile);
  if (slot === -1) throw new Error('Perfil não está entre as contas da Kick');
  // O painel manda a tela em pixels CSS; o Windows posiciona em pixels físicos.
  const scale = screen.scale || 1;
  const { width, height } = KICK_WINDOW;
  openWatchWindow(currentBrowser(), slot, profile, `https://kick.com/${channel}`, {
    x: (screen.left + screen.width - (2 - (slot % 2)) * width) * scale,
    y: (screen.top + screen.height - (2 - Math.floor(slot / 2)) * height) * scale,
    width: width * scale,
    height: height * scale,
  });
  log(`Kick: abrindo #${channel} no perfil ${profile} (${browserName(currentBrowser())})`);
}

function kickState() {
  const browser = currentBrowser();
  const profiles = listProfiles(browser);
  const browsers = installedBrowsers();
  return {
    configured: kickConfigured(),
    error: kickError,
    browsers,
    browser,
    browserFound: browsers.some((b) => b.id === browser),
    availableProfiles: profiles,
    profiles: kick.profiles.map((dir) => profiles.find((p) => p.dir === dir) ?? { dir, name: dir }),
    openWindows: openWindowCount(),
    // Perfil -> canal que a janela dele está mostrando (para o botão da conta ficar verde).
    watching: Object.fromEntries(openWindowList().map((w) => [w.profileDir, w.url.split('/').pop()])),
    channels: config.kickChannels.map((name) => ({
      name,
      live: kickLive.has(name),
      viewers: kickLive.get(name)?.viewers ?? 0,
      hours: liveHours('kick', name),
    })),
  };
}

async function handleKick(req, res, action, id) {
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
      // Os perfis são de cada navegador: ao trocar, as contas são escolhidas de novo.
      closeWatchWindows();
      kick.browser = browser;
      kick.profiles = [];
      saveKick();
      log(`Kick: navegador trocado para ${browserName(browser)}`);
    }
    return send(res, 200, state());
  }

  if (req.method === 'PUT' && action === 'profiles') {
    const { profiles } = await readBody(req);
    const known = new Set(listProfiles(currentBrowser()).map((p) => p.dir));
    kick.profiles = [...new Set(profiles)].filter((p) => known.has(p)).slice(0, MAX_ACCOUNTS);
    saveKick();
    return send(res, 200, state());
  }

  if (req.method === 'POST' && action === 'watch') {
    watchKick(await readBody(req));
    return send(res, 200, state());
  }

  if (req.method === 'DELETE' && action === 'watch') {
    closeWatchWindows();
    log('Kick: fechando as janelas abertas pelo painel');
    return send(res, 200, state());
  }

  if (action === 'channels') {
    if (req.method === 'POST') {
      const name = normalizeChannel((await readBody(req)).name ?? '');
      if (!/^[\w-]{3,25}$/.test(name)) return send(res, 400, { error: 'Nome de canal inválido' });
      if (!config.kickChannels.includes(name)) {
        config.kickChannels.push(name);
        saveConfig();
        await updateKickLive();
      }
      return send(res, 200, state());
    }

    if (req.method === 'DELETE' && id) {
      config.kickChannels = config.kickChannels.filter((c) => c !== id);
      kickLive.delete(id);
      saveConfig();
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
      hours: liveHours('twitch', name),
    })),
    points: miner.state(),
    kick: kickState(),
  };
}

// A cada minuto: anota quais canais estão ao vivo (para os horários).
function recordStats() {
  const twitchOk = liveOk && config.channels.length > 0;
  const kickOk = kickConfigured() && !kickError && config.kickChannels.length > 0;
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
  if (resource === 'kick') return handleKick(req, res, id, rawSub && decodeURIComponent(rawSub));

  if (req.method === 'POST' && resource === 'restart') {
    if (!CAN_RESTART) return send(res, 400, { error: 'Para reiniciar por aqui, abra o painel pelo iniciar.bat' });
    send(res, 200, { restarting: true });
    log('Reiniciando o servidor…');
    // O iniciar.bat abre o servidor de novo quando ele sai com esse código.
    setTimeout(() => process.exit(RESTART_CODE), 300);
    return;
  }

  if (req.method === 'PUT' && resource === 'autostart') {
    const { enabled } = await readBody(req);
    setAutostart(!!enabled);
    log(enabled ? 'Painel vai abrir junto com o Windows' : 'Painel não abre mais junto com o Windows');
    return send(res, 200, state());
  }

  // Contas de pontos do canal: /api/points/link (vincular) e /api/points/<login> (desvincular).
  if (resource === 'points') {
    if (req.method === 'POST' && id === 'link') await miner.startLink();
    else if (req.method === 'DELETE' && id === 'link') miner.cancelLink();
    else if (req.method === 'DELETE' && id) miner.unlink(id);
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
