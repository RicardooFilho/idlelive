// Persistência: config.json (Client ID + canais oficiais) e accounts.json (contas e tokens).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_FILE = path.join(ROOT, 'config.json');
const ACCOUNTS_FILE = path.join(ROOT, 'accounts.json');
const KICK_FILE = path.join(ROOT, 'kick.json');

export const MAX_ACCOUNTS = 4;

function readJson(file, fallback) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

export const config = readJson(CONFIG_FILE, {});
config.channels ??= [];
config.kickChannels ??= [];

// [{ login, userId, accessToken, refreshToken, mode: 'all' | 'custom', channels: [], needsRelink }]
export const accounts = readJson(ACCOUNTS_FILE, []);

// { clientId, clientSecret, profiles: ['Profile 1', ...] } — perfis do Chrome usados como contas da Kick.
export const kick = readJson(KICK_FILE, {});
kick.profiles ??= [];

export const saveConfig = () => writeJson(CONFIG_FILE, config);
export const saveAccounts = () => writeJson(ACCOUNTS_FILE, accounts);
export const saveKick = () => writeJson(KICK_FILE, kick);

export const normalizeChannel = (name) => String(name).trim().toLowerCase().replace(/^#/, '');
