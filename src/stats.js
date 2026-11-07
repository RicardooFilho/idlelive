// Estatísticas locais (stats.json), anotadas com o painel aberto:
// - em que horas cada canal costuma estar ao vivo (a cada minuto);
// - pontos do canal ganhos por conta e por dia, separados pelo motivo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STATS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'stats.json');
// Precisa de umas horas de observação antes de dizer "costuma estar ao vivo".
const MIN_OBSERVED_HOUR = 20; // minutos observados naquela hora do dia
const KEEP_DAYS = 60;

const hours = () => Array(24).fill(0);

// observed: { twitch: [24], kick: [24] } — minutos em que o painel checou cada hora do dia
// live: { twitch: { canal: [24] }, kick: { canal: [24] } } — minutos ao vivo em cada hora do dia
// points: { 'AAAA-MM-DD': { login: { motivo: { points, count } } } } — motivo é o reason_code da Twitch (WATCH, CLAIM…)
const stats = fs.existsSync(STATS_FILE) ? JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')) : {};
delete stats.boost; // tempo com boost das antigas contas do chat, que não existem mais
stats.observed ??= { twitch: hours(), kick: hours() };
stats.live ??= { twitch: {}, kick: {} };
stats.points ??= {};

const dayKey = (date) => date.toLocaleDateString('sv-SE'); // AAAA-MM-DD no horário local
const save = () => fs.writeFileSync(STATS_FILE, JSON.stringify(stats) + '\n');

// twitchLive/kickLive: lista de canais ao vivo, ou null se não deu para checar.
export function recordMinute({ twitchLive, kickLive }) {
  const hour = new Date().getHours();

  for (const [platform, live] of [['twitch', twitchLive], ['kick', kickLive]]) {
    if (!live) continue;
    stats.observed[platform][hour]++;
    for (const channel of live) (stats.live[platform][channel] ??= hours())[hour]++;
  }

  save();
}

// Pontos ganhos por uma conta. Fica na memória e vai para o arquivo na anotação de cada minuto.
export function recordPoints(login, reason, points) {
  const day = (stats.points[dayKey(new Date())] ??= {});
  const entry = ((day[login] ??= {})[reason] ??= { points: 0, count: 0 });
  entry.points += points;
  entry.count++;
  for (const old of Object.keys(stats.points).sort().slice(0, -KEEP_DAYS)) delete stats.points[old];
}

// Últimos `days` dias, do mais recente: [{ day, accounts: { login: { motivo: { points, count } } } }].
export const pointsHistory = (days = 30) =>
  Object.keys(stats.points).sort().reverse().slice(0, days).map((day) => ({ day, accounts: stats.points[day] }));

// Chance (0 a 1) de o canal estar ao vivo em cada hora do dia; null nas horas ainda pouco observadas.
export function liveHours(platform, channel) {
  const counts = stats.live[platform][channel] ?? hours();
  return stats.observed[platform].map((obs, h) => (obs < MIN_OBSERVED_HOUR ? null : Math.min(1, counts[h] / obs)));
}
