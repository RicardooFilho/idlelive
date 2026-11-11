// Estatísticas locais (stats.json), anotadas com o painel aberto:
// pontos do canal ganhos por conta e por dia, separados pelo motivo.
import path from 'node:path';
import { readJson, writeJson, DATA_DIR } from './store.js';

const STATS_FILE = path.join(DATA_DIR, 'stats.json');
const KEEP_DAYS = 30; // os mesmos dias que a página Histórico mostra

// points: { 'AAAA-MM-DD': { login: { motivo: { points, count } } } } — motivo é o reason_code da Twitch (WATCH, CLAIM…)
const stats = readJson(STATS_FILE, {});
// Restos de versões antigas: tempo com boost das contas do chat e os horários das lives, que não têm mais tela.
const LEGACY = ['boost', 'observed', 'live'];
let dirty = LEGACY.some((key) => key in stats);
for (const key of LEGACY) delete stats[key];
stats.points ??= {};

const dayKey = (date) => date.toLocaleDateString('sv-SE'); // AAAA-MM-DD no horário local

// Chamado a cada minuto pelo servidor: grava só se algo mudou desde a última vez.
export function saveStats() {
  if (!dirty) return;
  writeJson(STATS_FILE, stats, 0);
  dirty = false;
}

// Pontos ganhos por uma conta. Fica na memória e vai para o arquivo na gravação de cada minuto.
export function recordPoints(login, reason, points) {
  const day = (stats.points[dayKey(new Date())] ??= {});
  const entry = ((day[login] ??= {})[reason] ??= { points: 0, count: 0 });
  entry.points += points;
  entry.count++;
  for (const old of Object.keys(stats.points).sort().slice(0, -KEEP_DAYS)) delete stats.points[old];
  dirty = true;
}

// Últimos `days` dias, do mais recente: [{ day, accounts: { login: { motivo: { points, count } } } }].
export const pointsHistory = (days = KEEP_DAYS) =>
  Object.keys(stats.points).sort().reverse().slice(0, days).map((day) => ({ day, accounts: stats.points[day] }));
