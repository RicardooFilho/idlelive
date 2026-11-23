import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Pasta temporária no lugar da raiz: o store lê config.json, kick.json e points.json assim que é importado.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idlelive-test-'));
process.env.IDLELIVE_DATA_DIR = dataDir;
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

// points.json antigo (uma conta só, como objeto) para conferir a conversão para lista.
fs.writeFileSync(path.join(dataDir, 'points.json'), JSON.stringify({ login: 'velha', accessToken: 'x' }));

const store = await import('../src/store.js');
const { readJson, writeJson, normalizeChannel, DATA_DIR } = store;

const file = (name) => path.join(dataDir, name);

test('usa a pasta da variável IDLELIVE_DATA_DIR', () => {
  assert.equal(DATA_DIR, path.resolve(dataDir));
});

test('sem config.json, começa com as listas do parceiros.json e grava', () => {
  const partners = JSON.parse(fs.readFileSync(new URL('../parceiros.json', import.meta.url), 'utf8'));
  for (const key of store.PARTNER_LISTS) {
    assert.deepEqual(store.config[key], partners[key]);
    assert.deepEqual(store.config.partners[key], partners[key]);
  }
  assert.deepEqual(store.partnerChanges, {});
  assert.deepEqual(JSON.parse(fs.readFileSync(file('config.json'), 'utf8')).channels, partners.channels);
  assert.deepEqual(store.kick, { accounts: [], lolidleAccounts: [] });
  assert.deepEqual(store.lolidle, { accounts: [] });
});

test('points.json antigo (objeto) vira lista', () => {
  assert.deepEqual(store.pointsAccounts, [{ login: 'velha', accessToken: 'x' }]);
});

test('saveConfig grava na pasta de dados', () => {
  store.config.channels.push('meucanal');
  store.saveConfig();
  assert.equal(JSON.parse(fs.readFileSync(file('config.json'), 'utf8')).channels.at(-1), 'meucanal');
});

test('mergePartners: entra parceiro novo, sai o antigo e o que o jogador fez continua', () => {
  // O jogador tirou "b" e adicionou "meu"; os parceiros trocaram "c" por "d".
  const { list, added, removed } = store.mergePartners(['a', 'c', 'meu'], ['a', 'b', 'c'], ['a', 'b', 'd']);
  assert.deepEqual(list, ['a', 'meu', 'd']);
  assert.deepEqual(added, ['d']);
  assert.deepEqual(removed, ['c']);
});

test('mergePartners: parceiro novo que o jogador já tinha não repete', () => {
  assert.deepEqual(store.mergePartners(['a', 'd'], ['a'], ['a', 'd']), { list: ['a', 'd'], added: [], removed: [] });
});

test('applyPartners: usa a lista guardada em partners e atualiza ela', () => {
  const cfg = { channels: ['a', 'meu'], kickChannels: ['k'], partners: { channels: ['a', 'x'], kickChannels: ['k'] } };
  const changes = store.applyPartners(cfg, { channels: ['a', 'n'], kickChannels: ['k'] }, false);
  assert.deepEqual(cfg.channels, ['a', 'meu', 'n']);
  assert.deepEqual(changes, { channels: { added: ['n'], removed: [] } });
  assert.deepEqual(cfg.partners, { channels: ['a', 'n'], kickChannels: ['k'] });
  // Abrir de novo não muda nada, nem traz de volta canal que o jogador tirou.
  cfg.channels = ['meu', 'n'];
  assert.deepEqual(store.applyPartners(cfg, { channels: ['a', 'n'], kickChannels: ['k'] }, false), {});
  assert.deepEqual(cfg.channels, ['meu', 'n']);
});

test('applyPartners: config.json da versão 1.5.0 (sem partners) recebe as mudanças desde ela', () => {
  const cfg = { channels: ['rodil', 'meu'], kickChannels: ['rodil', 'yulla'] };
  const changes = store.applyPartners(cfg, { channels: ['rodil', 'fnblol9', 'brtt'], kickChannels: ['rodil', 'brtt'] }, false);
  assert.deepEqual(cfg.channels, ['rodil', 'meu', 'fnblol9', 'brtt']);
  assert.deepEqual(cfg.kickChannels, ['rodil', 'brtt']);
  assert.deepEqual(changes.kickChannels, { added: ['brtt'], removed: ['yulla'] });
});

test('readJson devolve o padrão quando o arquivo não existe', () => {
  const fallback = { a: 1 };
  assert.equal(readJson(file('nao-existe.json'), fallback), fallback);
});

test('readJson lê o JSON do arquivo', () => {
  fs.writeFileSync(file('ok.json'), '{"x":[1,2]}');
  assert.deepEqual(readJson(file('ok.json'), null), { x: [1, 2] });
});

test('readJson guarda o arquivo quebrado e devolve o padrão', (t) => {
  t.mock.method(console, 'log', () => {}); // a mensagem de aviso não precisa sujar a saída do teste
  fs.writeFileSync(file('quebrado.json'), '{"x": [1,');
  assert.deepEqual(readJson(file('quebrado.json'), []), []);
  assert.equal(fs.existsSync(file('quebrado.json')), false);
  const copies = fs.readdirSync(dataDir).filter((n) => n.startsWith('quebrado.json.quebrado-'));
  assert.equal(copies.length, 1);
  assert.match(copies[0], /^quebrado\.json\.quebrado-\d+$/);
  assert.equal(fs.readFileSync(file(copies[0]), 'utf8'), '{"x": [1,');
  assert.equal(console.log.mock.callCount(), 1);
});

test('writeJson grava o JSON e não deixa o .tmp para trás', () => {
  writeJson(file('w.json'), { a: [1] });
  assert.equal(fs.readFileSync(file('w.json'), 'utf8'), '{\n  "a": [\n    1\n  ]\n}\n');
  assert.equal(fs.existsSync(file('w.json.tmp')), false);
  // Espaçamento 0 (usado pelo stats.json) grava compacto.
  writeJson(file('w.json'), { b: 2 }, 0);
  assert.equal(fs.readFileSync(file('w.json'), 'utf8'), '{"b":2}\n');
  assert.equal(fs.existsSync(file('w.json.tmp')), false);
});

test('normalizeChannel tira espaços, # e maiúsculas', () => {
  assert.equal(normalizeChannel('  #CoGu '), 'cogu');
  assert.equal(normalizeChannel('guaxilol1'), 'guaxilol1');
  assert.equal(normalizeChannel(123), '123');
});

test('jogos: ligados por padrão; desligar grava no config.json', () => {
  assert.equal(store.gameEnabled('pokeidle'), true);
  assert.equal(store.gameEnabled('lolidle'), true);
  store.setGameEnabled('lolidle', false);
  assert.equal(store.gameEnabled('lolidle'), false);
  assert.equal(store.gameEnabled('pokeidle'), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file('config.json'), 'utf8')).games, { lolidle: false });
  store.setGameEnabled('lolidle', true);
  assert.equal(store.gameEnabled('lolidle'), true);
  assert.throws(() => store.setGameEnabled('outro', false), /Jogo desconhecido/);
});
