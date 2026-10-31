// Painel local + orquestração: mantém cada conta nos chats dos canais oficiais que estão ao vivo.
// Uso: npm start  →  http://localhost:3000
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, accounts, kick, saveConfig, saveAccounts, saveKick, normalizeChannel, MAX_ACCOUNTS } from './src/store.js';
import { startDeviceFlow, waitDeviceToken, refreshToken, validate, revoke, fetchLive } from './src/twitch.js';
import { fetchKickLive, resetKickToken } from './src/kick.js';
import { findChrome, listProfiles, openWatchWindow, closeWatchWindows, openWindowCount } from './src/chrome.js';
import { ChatConnection } from './src/chat.js';
import { recordMinute, boostHistory, todayBoostMinutes, liveHours } from './src/stats.js';
import { autostartEnabled, setAutostart } from './src/autostart.js';

const PORT = Number(process.env.PORT) || 3000;
const LIVE_INTERVAL = 60 * 1000;
const TOKEN_INTERVAL = 30 * 60 * 1000;
const PANEL_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public', 'index.html');

const log = (msg) => console.log(`[${new Date().toLocaleTimeString('pt-BR')}] ${msg}`);

if (!config.clientId || config.clientId.startsWith('COLE')) {
  console.log('Coloque o Client ID do seu app em config.json');
  process.exit(1);
}
const { clientId } = config;

const connections = new Map(); // login -> ChatConnection
let live = new Map(); // canal -> { viewers }
let pendingLink = null; // { userCode, uri, expiresAt, error, cancelled }

// ---------- Contas e tokens ----------

function wantedChannels(account) {
  const base = account.mode === 'custom' ? account.channels : config.channels;
  return new Set(base.filter((c) => live.has(c)));
}

function syncAll() {
  for (const account of accounts) connections.get(account.login)?.setChannels(wantedChannels(account));
}

function startConnection(account) {
  connections.get(account.login)?.close();
  const conn = new ChatConnection(account.login, {
    getToken: () => account.accessToken,
    onAuthFailed: () => ensureFreshToken(account, true).catch((err) => log(`${account.login}: erro ao renovar token (${err.message})`)),
    log,
  });
  connections.set(account.login, conn);
  conn.setChannels(wantedChannels(account));
}

// Renova o token se estiver perto de expirar (ou se `force`). Retorna false se a conta precisa ser vinculada de novo.
// O refresh token só pode ser usado uma vez, então chamadas simultâneas compartilham a mesma renovação.
const refreshing = new Map(); // account -> Promise
function ensureFreshToken(account, force = false) {
  if (!refreshing.has(account)) {
    refreshing.set(account, checkToken(account, force).finally(() => refreshing.delete(account)));
  }
  return refreshing.get(account);
}

async function checkToken(account, force) {
  const info = force ? null : await validate(account.accessToken);
  if (info && info.expires_in > TOKEN_INTERVAL / 1000 + 300) return true;

  const tokens = await refreshToken(clientId, account.refreshToken);
  if (!tokens) {
    log(`${account.login}: não deu para renovar o token, vincule a conta de novo no painel`);
    account.needsRelink = true;
    saveAccounts();
    connections.get(account.login)?.close();
    connections.delete(account.login);
    return false;
  }
  account.accessToken = tokens.access_token;
  account.refreshToken = tokens.refresh_token;
  account.needsRelink = false;
  saveAccounts();
  log(`${account.login}: token renovado`);
  return true;
}

async function maintainTokens() {
  for (const account of accounts) {
    if (!account.needsRelink) await ensureFreshToken(account).catch((err) => log(`Erro ao checar token: ${err.message}`));
  }
}

async function updateLive() {
  const account = accounts.find((a) => !a.needsRelink);
  if (!account || config.channels.length === 0) {
    live = new Map();
  } else {
    let result = await fetchLive(clientId, account.accessToken, config.channels);
    if (!result && (await ensureFreshToken(account, true))) {
      result = await fetchLive(clientId, account.accessToken, config.channels);
    }
    if (result) live = result;
  }
  syncAll();
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
// O Chrome pode aumentar um pouco se for menor que o mínimo dele.
const KICK_WINDOW = { width: 360, height: 260 };

// Sem `profile`, abre o canal em todas as contas da Kick.
function watchKick({ channel, profile, screen }) {
  if (!config.kickChannels.includes(channel)) throw new Error('Canal não está na lista');
  if (profile === undefined) {
    if (kick.profiles.length === 0) throw new Error('Marque os perfis do Chrome que vão ser as contas da Kick');
    for (const p of kick.profiles) watchKick({ channel, profile: p, screen });
    return;
  }
  const slot = kick.profiles.indexOf(profile);
  if (slot === -1) throw new Error('Perfil não está entre as contas da Kick');
  // O painel manda a tela em pixels CSS; o Windows posiciona em pixels físicos.
  const scale = screen.scale || 1;
  const { width, height } = KICK_WINDOW;
  openWatchWindow(slot, profile, `https://kick.com/${channel}`, {
    x: (screen.left + screen.width - (2 - (slot % 2)) * width) * scale,
    y: (screen.top + screen.height - (2 - Math.floor(slot / 2)) * height) * scale,
    width: width * scale,
    height: height * scale,
  });
  log(`Kick: abrindo #${channel} no perfil ${profile}`);
}

function kickState() {
  const profiles = listProfiles();
  return {
    configured: kickConfigured(),
    error: kickError,
    chromeFound: !!findChrome(),
    availableProfiles: profiles,
    profiles: kick.profiles.map((dir) => profiles.find((p) => p.dir === dir) ?? { dir, name: dir }),
    openWindows: openWindowCount(),
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

  if (req.method === 'PUT' && action === 'profiles') {
    const { profiles } = await readBody(req);
    const known = new Set(listProfiles().map((p) => p.dir));
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

async function startLink() {
  if (pendingLink && !pendingLink.error) throw new Error('Já existe um vínculo em andamento');
  const flow = await startDeviceFlow(clientId);
  const link = { userCode: flow.user_code, uri: flow.verification_uri, expiresAt: Date.now() + flow.expires_in * 1000 };
  pendingLink = link;

  waitDeviceToken(clientId, flow, () => link.cancelled)
    .then(async (tokens) => {
      const info = await validate(tokens.access_token);
      let account = accounts.find((a) => a.userId === info.user_id);
      if (!account) {
        if (accounts.length >= MAX_ACCOUNTS) throw new Error(`Limite de ${MAX_ACCOUNTS} contas atingido`);
        account = { login: info.login, userId: info.user_id, mode: 'all', channels: [] };
        accounts.push(account);
      }
      Object.assign(account, {
        login: info.login,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        needsRelink: false,
      });
      saveAccounts();
      log(`${account.login}: conta vinculada`);
      if (pendingLink === link) pendingLink = null;
      startConnection(account);
      safeUpdateLive();
    })
    .catch((err) => {
      if (pendingLink === link) pendingLink = link.cancelled ? null : { ...link, error: err.message };
    });
}

// ---------- HTTP ----------

function state() {
  return {
    maxAccounts: MAX_ACCOUNTS,
    pendingLink: pendingLink && { userCode: pendingLink.userCode, uri: pendingLink.uri, error: pendingLink.error },
    autostart: autostartEnabled(),
    channels: config.channels.map((name) => ({
      name,
      live: live.has(name),
      viewers: live.get(name)?.viewers ?? 0,
      hours: liveHours('twitch', name),
    })),
    accounts: accounts.map((a) => {
      const conn = connections.get(a.login);
      return {
        login: a.login,
        mode: a.mode,
        channels: a.channels,
        needsRelink: !!a.needsRelink,
        connected: !!conn?.connected,
        joined: conn ? [...conn.joined].sort() : [],
        boostToday: todayBoostMinutes(a.login),
      };
    }),
    history: boostHistory(),
    kick: kickState(),
  };
}

// A cada minuto: anota o boost de cada conta e quais canais estão ao vivo (para o histórico e os horários).
function recordStats() {
  const twitchOk = accounts.some((a) => !a.needsRelink) && config.channels.length > 0;
  const kickOk = kickConfigured() && !kickError && config.kickChannels.length > 0;
  recordMinute({
    accounts: accounts.map((a) => ({ login: a.login, chats: connections.get(a.login)?.joined.size ?? 0 })),
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

  if (req.method === 'PUT' && resource === 'autostart') {
    const { enabled } = await readBody(req);
    setAutostart(!!enabled);
    log(enabled ? 'Painel vai abrir junto com o Windows' : 'Painel não abre mais junto com o Windows');
    return send(res, 200, state());
  }

  if (req.method === 'POST' && resource === 'link') {
    await startLink();
    return send(res, 200, state());
  }

  if (req.method === 'DELETE' && resource === 'link') {
    if (pendingLink) pendingLink.cancelled = true;
    pendingLink = null;
    return send(res, 200, state());
  }

  if (resource === 'accounts' && id) {
    const account = accounts.find((a) => a.login === id);
    if (!account) return send(res, 404, { error: 'Conta não encontrada' });

    if (req.method === 'PUT') {
      const { mode, channels } = await readBody(req);
      if (mode === 'all' || mode === 'custom') account.mode = mode;
      if (Array.isArray(channels)) account.channels = channels.map(normalizeChannel).filter((c) => config.channels.includes(c));
      saveAccounts();
      syncAll();
      return send(res, 200, state());
    }

    if (req.method === 'DELETE') {
      connections.get(account.login)?.close();
      connections.delete(account.login);
      accounts.splice(accounts.indexOf(account), 1);
      saveAccounts();
      revoke(clientId, account.accessToken);
      log(`${account.login}: conta desvinculada`);
      return send(res, 200, state());
    }
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
      for (const account of accounts) account.channels = account.channels.filter((c) => c !== id);
      live.delete(id);
      saveConfig();
      saveAccounts();
      syncAll();
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
    send(res, 404, { error: 'Não encontrado' });
  } catch (err) {
    send(res, 500, { error: err.message });
  }
});

// ---------- Início ----------

await maintainTokens();
for (const account of accounts) if (!account.needsRelink) startConnection(account);
await safeUpdateLive();
await updateKickLive();
setInterval(safeUpdateLive, LIVE_INTERVAL);
setInterval(updateKickLive, LIVE_INTERVAL);
setInterval(maintainTokens, TOKEN_INTERVAL);
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
