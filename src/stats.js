// Estatísticas locais (stats.json), anotadas a cada minuto com o painel aberto: em que horas cada canal costuma estar ao vivo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STATS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'stats.json');
// Precisa de umas horas de observação antes de dizer "costuma estar ao vivo".
const MIN_OBSERVED_HOUR = 20; // minutos observados naquela hora do dia

const hours = () => Array(24).fill(0);

// observed: { twitch: [24], kick: [24] } — minutos em que o painel checou cada hora do dia
// live: { twitch: { canal: [24] }, kick: { canal: [24] } } — minutos ao vivo em cada hora do dia
const stats = fs.existsSync(STATS_FILE) ? JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')) : {};
delete stats.boost; // tempo com boost das antigas contas do chat, que não existem mais
stats.observed ??= { twitch: hours(), kick: hours() };
stats.live ??= { twitch: {}, kick: {} };

// twitchLive/kickLive: lista de canais ao vivo, ou null se não deu para checar.
export function recordMinute({ twitchLive, kickLive }) {
  const hour = new Date().getHours();

  for (const [platform, live] of [['twitch', twitchLive], ['kick', kickLive]]) {
    if (!live) continue;
    stats.observed[platform][hour]++;
    for (const channel of live) (stats.live[platform][channel] ??= hours())[hour]++;
  }

  fs.writeFileSync(STATS_FILE, JSON.stringify(stats) + '\n');
}

// Chance (0 a 1) de o canal estar ao vivo em cada hora do dia; null nas horas ainda pouco observadas.
export function liveHours(platform, channel) {
  const counts = stats.live[platform][channel] ?? hours();
  return stats.observed[platform].map((obs, h) => (obs < MIN_OBSERVED_HOUR ? null : Math.min(1, counts[h] / obs)));
}
