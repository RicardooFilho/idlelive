import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Pasta temporária no lugar da raiz: events.js lê e pode regravar eventos.jsonl assim que é importado.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idlelive-test-'));
process.env.IDLELIVE_DATA_DIR = dataDir;
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const FILE = path.join(dataDir, 'eventos.jsonl');
const DAY = 24 * 60 * 60 * 1000;
const realNow = Date.now;
let now = realNow();
Date.now = () => now;

// Arquivo antigo: um evento de 40 dias (sai), uma linha cortada (ignorada) e um recente (fica).
fs.writeFileSync(FILE, [
  JSON.stringify({ at: now - 40 * DAY, kind: 'good', platform: 'twitch', account: 'a', channel: 'x', text: 'velho' }),
  '{"at": 1, "kind": "go',
  JSON.stringify({ at: now - DAY, kind: 'good', platform: 'twitch', account: 'a', channel: 'x', text: 'ontem' }),
].join('\n') + '\n');

const { addEvent, recentEvents } = await import('../src/events.js');

after(() => {
  Date.now = realNow;
});

const lines = () => fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const texts = (list) => list.map((e) => e.text);

afterEach(() => {
  now += 60 * 60 * 1000; // cada teste começa uma hora depois, para os erros repetidos de um não afetarem o outro
});

test('ao abrir, tira os eventos com mais de 30 dias e as linhas cortadas', () => {
  assert.deepEqual(texts(recentEvents().good), ['ontem']);
  assert.deepEqual(texts(lines()), ['ontem']);
  assert.equal(fs.existsSync(`${FILE}.tmp`), false);
});

test('addEvent grava no arquivo e recentEvents mostra do mais novo para o mais velho', () => {
  addEvent({ kind: 'good', platform: 'twitch', account: 'a', channel: 'cogu', text: 'baú 1' });
  now += 1000;
  addEvent({ kind: 'good', platform: 'kick', account: 'b', text: 'baú 2' });
  assert.deepEqual(texts(recentEvents().good).slice(0, 3), ['baú 2', 'baú 1', 'ontem']);
  const last = lines().at(-1);
  assert.deepEqual(last, { at: now, kind: 'good', platform: 'kick', account: 'b', channel: null, text: 'baú 2' });
});

test('recentEvents separa bons e ruins e respeita o limite', () => {
  addEvent({ kind: 'bad', platform: 'twitch', account: 'a', text: 'erro limite 1' });
  addEvent({ kind: 'bad', platform: 'twitch', account: 'a', text: 'erro limite 2' });
  const { good, bad } = recentEvents(1);
  assert.equal(good.length, 1);
  assert.deepEqual(texts(bad), ['erro limite 2']);
  assert.ok(recentEvents().bad.every((e) => e.kind === 'bad'));
});

test('troca "fetch failed" por um texto em português', () => {
  addEvent({ kind: 'bad', platform: 'kick', account: 'a', text: 'erro ao ler saldos (Fetch Failed)' });
  assert.equal(recentEvents().bad[0].text, 'erro ao ler saldos (sem conexão com a internet)');
  assert.equal(lines().at(-1).text, 'erro ao ler saldos (sem conexão com a internet)');
});

test('o mesmo erro da mesma conta só entra de novo depois de 10 min', () => {
  const count = () => recentEvents(1000).bad.filter((e) => e.text === 'token recusado').length;
  addEvent({ kind: 'bad', platform: 'twitch', account: 'a', text: 'token recusado' });
  now += 9 * 60 * 1000;
  addEvent({ kind: 'bad', platform: 'twitch', account: 'a', text: 'token recusado' });
  assert.equal(count(), 1);
  // Outra conta ou outra plataforma não contam como repetição.
  addEvent({ kind: 'bad', platform: 'twitch', account: 'b', text: 'token recusado' });
  addEvent({ kind: 'bad', platform: 'kick', account: 'a', text: 'token recusado' });
  assert.equal(count(), 3);
  // A janela conta a partir do último que entrou (o primeiro, há 9 min): 1 min depois já passou de 10.
  now += 60 * 1000;
  addEvent({ kind: 'bad', platform: 'twitch', account: 'a', text: 'token recusado' });
  assert.equal(count(), 4);
});

test('o "fetch failed" trocado também conta como repetição', () => {
  addEvent({ kind: 'bad', platform: 'twitch', account: 'a', text: 'fetch failed' });
  addEvent({ kind: 'bad', platform: 'twitch', account: 'a', text: 'sem conexão com a internet' });
  assert.equal(recentEvents(1000).bad.filter((e) => e.text === 'sem conexão com a internet').length, 1);
});

test('coisas boas repetidas sempre entram', () => {
  addEvent({ kind: 'good', platform: 'twitch', account: 'a', text: 'pegou o baú' });
  addEvent({ kind: 'good', platform: 'twitch', account: 'a', text: 'pegou o baú' });
  assert.equal(recentEvents(1000).good.filter((e) => e.text === 'pegou o baú').length, 2);
});
