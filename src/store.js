// Persistência: config.json (canais, que começam pelo parceiros.json), kick.json (Kick e navegador) e points.json (contas de pontos da Twitch).
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

export const MAX_ACCOUNTS = 4; // contas de pontos, na Twitch e na Kick
export const MAX_LOL_ACCOUNTS = 5; // contas do LoLdle: até 5 no chat da Twitch e até 5 na Kick

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

// Listas de parceiros dos jogos. O parceiros.json vem em cada versão e o atualizador troca ele; o config.json é do
// jogador e nunca é trocado. Ao abrir, entra no config.json quem virou parceiro e sai quem deixou de ser.
export const PARTNER_LISTS = ['channels', 'kickChannels', 'lolidleChannels', 'lolidleKickChannels'];
const PARTNERS_FILE = path.join(ROOT, 'parceiros.json');
// Mudanças desde a versão 1.5.0, a última antes do parceiros.json. Num config.json dessa época, que ainda não
// guarda a lista em "partners", é assim que se sabe o que mudou desde a versão que o jogador tinha.
const SINCE_V150 = { channels: { added: ['fnblol9', 'brtt'] }, kickChannels: { added: ['brtt'], removed: ['yulla'] } };

// Junta a lista do jogador com a dos parceiros. "base" é a lista de parceiros da última vez que juntou: só entra quem
// virou parceiro depois dela e só sai quem deixou de ser. Canal que o jogador tirou ou adicionou à mão continua assim.
export function mergePartners(list, base, partners) {
  const added = partners.filter((c) => !base.includes(c) && !list.includes(c));
  const removed = list.filter((c) => base.includes(c) && !partners.includes(c));
  return { list: [...list.filter((c) => !removed.includes(c)), ...added], added, removed };
}

// Aplica o parceiros.json no config. Devolve { lista: { added, removed } } só com o que mudou.
export function applyPartners(cfg, partners, fresh) {
  const changes = {};
  for (const key of PARTNER_LISTS) {
    const now = partners[key];
    if (!Array.isArray(now)) continue;
    if (fresh) {
      cfg[key] = [...now];
    } else {
      const since = SINCE_V150[key] ?? {};
      const base = cfg.partners?.[key] ?? [...now.filter((c) => !since.added?.includes(c)), ...(since.removed ?? [])];
      const merged = mergePartners(cfg[key], base, now);
      cfg[key] = merged.list;
      if (merged.added.length || merged.removed.length) changes[key] = { added: merged.added, removed: merged.removed };
    }
    cfg.partners = { ...cfg.partners, [key]: [...now] };
  }
  return changes;
}

export const config = readJson(CONFIG_FILE, {});
// Sem nenhuma lista (instalação nova ou config.json quebrado): começa com todos os parceiros.
const fresh = !PARTNER_LISTS.some((key) => Array.isArray(config[key]));
config.channels ??= [];
config.kickChannels ??= [];
config.lolidleChannels ??= []; // canais da Twitch do LoLdle (só presença no chat)
config.lolidleKickChannels ??= []; // canais da Kick do LoLdle (pontos do canal, como no Pokeidle)
const partnersBefore = JSON.stringify(config.partners);
// O que entrou e saiu da lista ao abrir, para o servidor avisar no painel.
export const partnerChanges = applyPartners(config, readJson(PARTNERS_FILE, {}), fresh);
if (JSON.stringify(config.partners) !== partnersBefore) writeJson(CONFIG_FILE, config);

// { clientId, clientSecret, browser: 'chrome' | 'brave' | 'edge', accounts: [{ id, username, token, profile, needsRelink }], lolidleAccounts: [...] }
// App da Kick (opcional), navegador do botão ▶ e as contas da Kick que juntam pontos (login pelo token da conta):
// accounts nos canais do Pokeidle, lolidleAccounts nos do LoLdle.
export const kick = readJson(KICK_FILE, {});
delete kick.profiles; // perfis das janelas antigas da Kick, que não existem mais
kick.accounts ??= [];
kick.lolidleAccounts ??= [];

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

// Jogos do painel (Configurações → Jogos). Ficam em config.games só quando alguém mexe: sem a chave, o jogo está ligado.
export const GAMES = ['pokeidle', 'lolidle'];
export const gameEnabled = (game) => config.games?.[game] !== false;
export function setGameEnabled(game, enabled) {
  if (!GAMES.includes(game)) throw new Error('Jogo desconhecido');
  config.games = { ...config.games, [game]: !!enabled };
  saveConfig();
}

export const normalizeChannel = (name) => String(name).trim().toLowerCase().replace(/^#/, '');
