// Travas para o farm de pontos parecer uma pessoa, e não um robô (Twitch e Kick):
// tempos aleatórios em vez de exatos, contas desencontradas e um descanso diário.
import crypto from 'node:crypto';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const random = ([min, max]) => min + Math.random() * (max - min);

export const SWITCH_DELAY = [5 * 1000, 45 * 1000]; // espera antes de trocar de live
// Seguir os canais da lista: um por vez, com um intervalo aleatório entre um e outro, como quem vai clicando aos poucos.
export const FOLLOW_DELAY = [1 * 60 * 1000, 5 * 60 * 1000]; // espera antes do primeiro follow, depois de a conta começar
export const FOLLOW_GAP = [3 * 60 * 1000, 10 * 60 * 1000]; // intervalo entre um follow e o próximo
export const FOLLOW_CHECK = [30 * 1000, 90 * 1000]; // espera para ler o saldo depois do follow (bônus de follow da Kick)
export const START_DELAY = [0, 90 * 1000]; // cada conta começa num momento diferente
export const CHECK_OTHERS = [25 * 60 * 1000, 35 * 60 * 1000]; // saldo das lives que a conta não está assistindo
export const CHECK_TICK = 60 * 1000; // de quanto em quanto tempo vê se algum saldo precisa ser lido
export const CHECKS_PER_TICK = 4; // poucas consultas por vez, como um navegador, em vez de todas de uma vez

// Descanso diário (horário de Brasília): as contas param como quem vai dormir.
// Cada conta dorme e acorda até 20 min antes ou depois, num horário que muda todo dia.
// 3 horas: quebra o padrão de 24 h por dia perdendo só ~12% dos pontos (das 4h às 10h ainda tem parceiro ao vivo, ex.: cogu e guaxilol1).
const REST = { start: 5 * 60, end: 8 * 60, jitter: 20 }; // em minutos do dia
const TIMEZONE = 'America/Sao_Paulo';

// Minutos do dia e data (AAAA-MM-DD) no horário de Brasília, seja qual for o fuso do PC.
function brasiliaNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { minutes: Number(parts.hour) * 60 + Number(parts.minute), day: `${parts.year}-${parts.month}-${parts.day}` };
}

// Número entre -jitter e +jitter, fixo para a mesma conta no mesmo dia.
const dailyOffset = (seed) => (crypto.createHash('sha256').update(seed).digest().readUInt16BE(0) % (2 * REST.jitter + 1)) - REST.jitter;

export const clock = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

// Horário de descanso de hoje de uma conta, em minutos do dia (Brasília). `seed` identifica a conta.
export function restWindow(seed) {
  const { day } = brasiliaNow();
  return {
    start: REST.start + dailyOffset(`${seed}:${day}:start`),
    end: REST.end + dailyOffset(`${seed}:${day}:end`),
  };
}

export function isResting(seed) {
  const { minutes } = brasiliaNow();
  const { start, end } = restWindow(seed);
  return minutes >= start && minutes < end;
}
