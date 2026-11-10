// Persistência: config.json (canais), kick.json (Kick e navegador) e points.json (contas de pontos da Twitch).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// Pasta dos arquivos de dados. Os testes trocam por uma pasta temporária, para nunca tocar nas contas reais.
export const DATA_DIR = process.env.IDLELIVE_DATA_DIR ? path.resolve(process.env.IDLELIVE_DATA_DIR) : ROOT;
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const KICK_FILE = path.join(DATA_DIR, 'kick.json');
const POINTS_FILE = path.join(DATA_DIR, 'points.json');
const LOLIDLE_FILE = path.join(DATA_DIR, 'lolidle.json');

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
config.lolidleChannels ??= []; // canais da Twitch do LoLdle (só presença no chat)

// { clientId, clientSecret, browser: 'chrome' | 'brave' | 'edge', accounts: [{ id, username, token, profile, needsRelink }] }
// App da Kick (opcional), navegador do botão ▶ e as contas da Kick que juntam pontos (login pelo token da conta).
export const kick = readJson(KICK_FILE, {});
delete kick.profiles; // perfis das janelas antigas da Kick, que não existem mais
kick.accounts ??= [];

// [{ login, userId, accessToken, refreshToken, deviceId, needsRelink, streakDone: [ids das lives com a sequência garantida] }]
// Contas que juntam pontos do canal (login do app de TV da Twitch). Versões antigas guardavam uma conta só, como objeto.
const savedPoints = readJson(POINTS_FILE, []);
export const pointsAccounts = Array.isArray(savedPoints) ? savedPoints : savedPoints.accessToken ? [savedPoints] : [];

// { accounts: [{ id, login, userId, accessToken, refreshToken, needsRelink }] }
// Contas da Twitch que ficam no chat dos canais do LoLdle (login do app de TV, só com permissão de ler o chat).
export const lolidle = readJson(LOLIDLE_FILE, {});
lolidle.accounts ??= [];

export const saveConfig = () => writeJson(CONFIG_FILE, config);
export const saveLolidle = () => writeJson(LOLIDLE_FILE, lolidle);
export const saveKick = () => writeJson(KICK_FILE, kick);
export const savePoints = () => writeJson(POINTS_FILE, pointsAccounts);

export const normalizeChannel = (name) => String(name).trim().toLowerCase().replace(/^#/, '');
