// Persistência: config.json (canais), kick.json (Kick e navegador) e points.json (contas de pontos da Twitch).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_FILE = path.join(ROOT, 'config.json');
const KICK_FILE = path.join(ROOT, 'kick.json');
const POINTS_FILE = path.join(ROOT, 'points.json');

export const MAX_ACCOUNTS = 4; // contas de pontos da Twitch e perfis da Kick

// Lê um JSON. Se o arquivo estiver quebrado (ex.: o PC desligou no meio de uma gravação antiga), guarda uma cópia
// com ".quebrado" no nome e segue com o valor padrão, em vez de o painel não abrir.
export function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    const copy = `${file}.quebrado-${Date.now()}`;
    fs.renameSync(file, copy);
    console.log(`${path.basename(file)} estava quebrado (${err.message}). Guardei uma cópia em ${path.basename(copy)} e comecei de novo.`);
    return fallback;
  }
}

// Grava num arquivo temporário e troca de uma vez: fechar o painel no meio da gravação não deixa o arquivo pela metade.
export function writeJson(file, data, space = 2) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, space) + '\n');
  fs.renameSync(tmp, file);
}

export const config = readJson(CONFIG_FILE, {});
config.channels ??= [];
config.kickChannels ??= [];

// { clientId, clientSecret, browser: 'chrome' | 'brave' | 'edge', accounts: [{ id, username, token, profile, needsRelink }] }
// App da Kick (opcional), navegador do botão ▶ e as contas da Kick que juntam pontos (login pelo token da conta).
export const kick = readJson(KICK_FILE, {});
delete kick.profiles; // perfis das janelas antigas da Kick, que não existem mais
kick.accounts ??= [];

// [{ login, userId, accessToken, refreshToken, deviceId, needsRelink, streakDone: [ids das lives com a sequência garantida] }]
// Contas que juntam pontos do canal (login do app de TV da Twitch). Versões antigas guardavam uma conta só, como objeto.
const savedPoints = readJson(POINTS_FILE, []);
export const pointsAccounts = Array.isArray(savedPoints) ? savedPoints : savedPoints.accessToken ? [savedPoints] : [];

export const saveConfig = () => writeJson(CONFIG_FILE, config);
export const saveKick = () => writeJson(KICK_FILE, kick);
export const savePoints = () => writeJson(POINTS_FILE, pointsAccounts);

export const normalizeChannel = (name) => String(name).trim().toLowerCase().replace(/^#/, '');
