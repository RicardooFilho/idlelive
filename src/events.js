// Registro de acontecimentos para as listas do topo do painel (eventos.jsonl, um por linha):
// - good: baús, Momentos e raids pegos pelas contas;
// - bad: erros que a Twitch ou a Kick devolveram.
// Fica no disco para não sumir ao reiniciar e guarda só os últimos 30 dias (os mais velhos saem sozinhos).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'eventos.jsonl');
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_EVENTS = 3000; // teto de segurança, caso algum erro se repita muito
const REPEAT_MS = 10 * 60 * 1000; // o mesmo erro da mesma conta só entra de novo depois disso
const PRUNE_EVERY = 6 * 60 * 60 * 1000;

let events = load();

function load() {
  if (!fs.existsSync(FILE)) return [];
  const list = [];
  for (const line of fs.readFileSync(FILE, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      list.push(JSON.parse(line));
    } catch {
      // Linha cortada (painel fechado no meio da gravação): ignora só ela.
    }
  }
  return prune(list);
}

// Tira o que passou de 30 dias (e o excesso) e regrava o arquivo de uma vez, se algo saiu.
function prune(list = events) {
  const limit = Date.now() - KEEP_MS;
  const kept = list.filter((e) => e.at >= limit).slice(-MAX_EVENTS);
  if (kept.length !== list.length || !fs.existsSync(FILE)) {
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, kept.map((e) => JSON.stringify(e) + '\n').join(''));
    fs.renameSync(tmp, FILE);
  }
  return kept;
}

setInterval(() => {
  try {
    events = prune();
  } catch {
    // Tenta de novo na próxima vez.
  }
}, PRUNE_EVERY).unref();

// kind: 'good' | 'bad'; platform: 'twitch' | 'kick'; account e channel podem faltar.
export function addEvent({ kind, platform, account = null, channel = null, text }) {
  const at = Date.now();
  // "fetch failed" é como o Node diz que não tem internet.
  const clean = String(text).replace(/fetch failed/gi, 'sem conexão com a internet');
  if (kind === 'bad') {
    const repeated = events.findLast((e) => e.kind === 'bad' && e.platform === platform && e.account === account && e.text === clean);
    if (repeated && at - repeated.at < REPEAT_MS) return;
  }
  const event = { at, kind, platform, account, channel, text: clean };
  events.push(event);
  try {
    fs.appendFileSync(FILE, JSON.stringify(event) + '\n');
  } catch {
    // Sem conseguir gravar, o evento ainda aparece até o painel reiniciar.
  }
  if (events.length > MAX_EVENTS * 1.2) events = prune();
}

// Os mais recentes de cada tipo, do mais novo para o mais velho.
export function recentEvents(limit = 100) {
  const pick = (kind) => events.filter((e) => e.kind === kind).slice(-limit).reverse();
  return { good: pick('good'), bad: pick('bad') };
}
