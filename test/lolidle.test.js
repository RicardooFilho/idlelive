import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Pasta temporária no lugar da raiz: lolidle.js importa store e events, que leem e gravam arquivos de dados.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idlelive-test-'));
process.env.IDLELIVE_DATA_DIR = dataDir;
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const { LolIdleAccount, wantedChannels } = await import('../src/lolidle.js');

// Nada de internet: o fetch é trocado por respostas montadas no teste.
const realFetch = globalThis.fetch;
afterEach(() => (globalThis.fetch = realFetch));

// Conexão de chat falsa: guarda os canais pedidos, sem abrir socket.
const fakeConnection = () => {
  const made = [];
  const make = (login, options) => {
    const conn = { login, options, wanted: null, joined: new Set(), connected: true, closed: false,
      setChannels(w) { this.wanted = w; }, close() { this.closed = true; } };
    made.push(conn);
    return conn;
  };
  return { made, make };
};

const makeAccount = (account = {}, makeConnection) =>
  new LolIdleAccount({ login: 'conta', userId: '1', accessToken: 'tok', refreshToken: 'ref', ...account }, { log: () => {}, makeConnection });

test('wantedChannels: só os canais da lista que estão ao vivo', () => {
  const live = new Map([['a', {}], ['c', {}], ['fora', {}]]);
  assert.deepEqual([...wantedChannels(['a', 'b', 'c'], live)], ['a', 'c']);
  assert.equal(wantedChannels([], live).size, 0);
});

test('start: abre uma conexão e entra nos canais ao vivo; troca de lista vai para a conexão', () => {
  const { made, make } = fakeConnection();
  const acc = makeAccount({}, make);
  acc.setChannels(new Set(['a']));
  acc.start();
  acc.start(); // não abre duas
  assert.equal(made.length, 1);
  assert.deepEqual([...made[0].wanted], ['a']);
  assert.equal(made[0].options.getToken(), 'tok');
  acc.setChannels(new Set(['b']));
  assert.deepEqual([...made[0].wanted], ['b']);
  acc.stop();
  assert.ok(made[0].closed);
});

test('start: conta sem token ou para vincular de novo não conecta', () => {
  const { made, make } = fakeConnection();
  makeAccount({ needsRelink: true }, make).start();
  makeAccount({ accessToken: null }, make).start();
  assert.equal(made.length, 0);
});

test('ensureFresh: renova uma vez só mesmo com chamadas ao mesmo tempo', async () => {
  let refreshes = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/validate')) return { ok: false, status: 401, json: async () => ({}) };
    refreshes++;
    return { ok: true, status: 200, json: async () => ({ access_token: 'novo', refresh_token: 'ref2' }) };
  };
  const acc = makeAccount();
  assert.deepEqual(await Promise.all([acc.ensureFresh(), acc.ensureFresh()]), [true, true]);
  assert.equal(refreshes, 1);
  assert.equal(acc.account.accessToken, 'novo');
  assert.equal(acc.account.refreshToken, 'ref2');
});

test('ensureFresh: refresh recusado (400) pede vincular de novo; erro de rede não', async () => {
  globalThis.fetch = async (url) => (String(url).includes('/validate')
    ? { ok: false, status: 401, json: async () => ({}) }
    : { ok: false, status: 400, json: async () => ({}) });
  const recusada = makeAccount();
  assert.equal(await recusada.ensureFresh(), false);
  assert.equal(recusada.account.needsRelink, true);

  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  const semInternet = makeAccount();
  await assert.rejects(semInternet.ensureFresh(), /fetch failed/);
  assert.equal(semInternet.account.needsRelink, undefined);
});

test('chat recusou o token e não deu para renovar: sai do chat', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 400, json: async () => ({}) });
  const { made, make } = fakeConnection();
  const acc = makeAccount({}, make);
  acc.start();
  await made[0].options.onAuthFailed();
  assert.ok(made[0].closed);
  assert.equal(acc.conn, null);
  assert.equal(acc.state().needsRelink, true);
});
