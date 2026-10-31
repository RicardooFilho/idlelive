// Estatísticas locais (stats.json), anotadas a cada minuto com o painel aberto:
// - tempo com boost por conta e por dia;
// - em que horas cada canal costuma estar ao vivo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STATS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'stats.json');
const KEEP_DAYS = 30;
// Precisa de umas horas de observação antes de dizer "costuma estar ao vivo".
const MIN_OBSERVED_HOUR = 20; // minutos observados naquela hora do dia

const hours = () => Array(24).fill(0);

// boost: { 'AAAA-MM-DD': { login: { minutes, boostMinutes, bonusSum } } }
// observed: { twitch: [24], kick: [24] } — minutos em que o painel checou cada hora do dia
// live: { twitch: { canal: [24] }, kick: { canal: [24] } } — minutos ao vivo em cada hora do dia
const stats = fs.existsSync(STATS_FILE) ? JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')) : {};
stats.boost ??= {};
stats.observed ??= { twitch: hours(), kick: hours() };
stats.live ??= { twitch: {}, kick: {} };

// Bônus do jogo: +15% pela primeira live, +2,5% por live adicional.
export const bonus = (n) => (n === 0 ? 0 : 15 + (n - 1) * 2.5);

const dayKey = (date) => date.toLocaleDateString('sv-SE'); // AAAA-MM-DD no horário local

// accounts: [{ login, chats }]; twitchLive/kickLive: lista de canais ao vivo, ou null se não deu para checar.
export function recordMinute({ accounts, twitchLive, kickLive }) {
  const now = new Date();
  const hour = now.getHours();

  const today = (stats.boost[dayKey(now)] ??= {});
  for (const { login, chats } of accounts) {
    const entry = (today[login] ??= { minutes: 0, boostMinutes: 0, bonusSum: 0 });
    entry.minutes++;
    if (chats > 0) {
      entry.boostMinutes++;
      entry.bonusSum += bonus(chats);
    }
  }
  for (const day of Object.keys(stats.boost).sort().slice(0, -KEEP_DAYS)) delete stats.boost[day];

  for (const [platform, live] of [['twitch', twitchLive], ['kick', kickLive]]) {
    if (!live) continue;
    stats.observed[platform][hour]++;
    for (const channel of live) (stats.live[platform][channel] ??= hours())[hour]++;
  }

  fs.writeFileSync(STATS_FILE, JSON.stringify(stats) + '\n');
}

// Últimos `days` dias, do mais recente: [{ day, accounts: { login: { boostMinutes, avgBonus } } }].
export function boostHistory(days = 7) {
  return Object.keys(stats.boost).sort().reverse().slice(0, days).map((day) => ({
    day,
    accounts: Object.fromEntries(Object.entries(stats.boost[day]).map(([login, e]) => [
      login,
      { boostMinutes: e.boostMinutes, avgBonus: e.boostMinutes ? e.bonusSum / e.boostMinutes : 0 },
    ])),
  }));
}

export const todayBoostMinutes = (login) => stats.boost[dayKey(new Date())]?.[login]?.boostMinutes ?? 0;

// Chance (0 a 1) de o canal estar ao vivo em cada hora do dia; null nas horas ainda pouco observadas.
export function liveHours(platform, channel) {
  const counts = stats.live[platform][channel] ?? hours();
  return stats.observed[platform].map((obs, h) => (obs < MIN_OBSERVED_HOUR ? null : Math.min(1, counts[h] / obs)));
}
