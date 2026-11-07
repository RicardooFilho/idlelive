// Persistência: config.json (canais oficiais), kick.json e points.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_FILE = path.join(ROOT, 'config.json');
const KICK_FILE = path.join(ROOT, 'kick.json');
const POINTS_FILE = path.join(ROOT, 'points.json');

export const MAX_ACCOUNTS = 4; // contas de pontos da Twitch e perfis da Kick

function readJson(file, fallback) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

export const config = readJson(CONFIG_FILE, {});
config.channels ??= [];
config.kickChannels ??= [];

// { clientId, clientSecret, browser: 'chrome' | 'brave' | 'edge', profiles: ['Profile 1', ...] } — perfis do navegador usados como contas da Kick.
export const kick = readJson(KICK_FILE, {});
kick.profiles ??= [];

// [{ login, userId, accessToken, refreshToken, deviceId, needsRelink, streakDone: [ids das lives com a sequência garantida] }]
// Contas que juntam pontos do canal (login do app de TV da Twitch). Versões antigas guardavam uma conta só, como objeto.
const savedPoints = readJson(POINTS_FILE, []);
export const pointsAccounts = Array.isArray(savedPoints) ? savedPoints : savedPoints.accessToken ? [savedPoints] : [];

export const saveConfig = () => writeJson(CONFIG_FILE, config);
export const saveKick = () => writeJson(KICK_FILE, kick);
export const savePoints = () => writeJson(POINTS_FILE, pointsAccounts);

export const normalizeChannel = (name) => String(name).trim().toLowerCase().replace(/^#/, '');
