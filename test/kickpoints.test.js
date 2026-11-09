import { test, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Pasta temporária no lugar da raiz: kickpoints.js importa store, stats e events, que leem e gravam arquivos de dados.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idlelive-test-'));
process.env.IDLELIVE_DATA_DIR = dataDir;
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const { KickAccount } = await import('../src/kickpoints.js');
const { recentEvents } = await import('../src/events.js');
const { pointsHistory } = await import('../src/stats.js');

// Nenhum teste fala com a Kick: o fetch falso responde pelo endereço (ver `respond`).
const realFetch = globalThis.fetch;
let posts;
let respond;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  posts = [];
  respond = () => json({});
  globalThis.fetch = async (url, options = {}) => {
    const slug = String(url).match(/\/v2\/channels\/([^/]+)\//)?.[1];
    if (options.method === 'POST') posts.push(slug);
    return respond(String(url), options, slug);
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

// Conta montada sem start(): nada de timers nem conexões. O descanso é desligado para não depender da hora.
const makeAccount = ({ account = {}, resting = false } = {}) => {
  const acc = new KickAccount({ id: 7, username: 'kconta', token: 'tok', ...account }, { log: () => {} });
  Object.defineProperty(acc, 'resting', { value: resting });
  return acc;
};

// ---------- pickTargets ----------

test('pickTargets: no máximo 2 lives, mais pontos primeiro', () => {
  const acc = makeAccount();
  acc.live = [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }];
  acc.channel('a').balance = 10;
  acc.channel('b').balance = 30;
  acc.channel('c').balance = 20;
  assert.deepEqual(acc.pickTargets().map((l) => l.slug), ['b', 'c']);
});

test('pickTargets: saldo desconhecido vai por último, na ordem da lista', () => {
  const acc = makeAccount();
  acc.live = [{ slug: 'x' }, { slug: 'y' }, { slug: 'z' }];
  acc.channel('z').balance = 0;
  assert.deepEqual(acc.pickTargets().map((l) => l.slug), ['z', 'x']);
  assert.deepEqual(makeAccount().pickTargets(), []);
});

// ---------- followNext ----------

// Conta com 3 canais: um assistido, um ao vivo e um offline.
const followSetup = (options) => {
  const acc = makeAccount(options);
  acc.all = ['offline', 'aovivo', 'assistido'];
  acc.live = [{ slug: 'aovivo' }, { slug: 'assistido' }];
  acc.watches.set('assistido', { stop: () => {} });
  return acc;
};

test('followNext: segue um por vez, assistindo → ao vivo → offline', async () => {
  const acc = followSetup();
  for (let i = 0; i < 4; i++) {
    acc.nextFollow = 0;
    await acc.followNext();
  }
  assert.deepEqual(posts, ['assistido', 'aovivo', 'offline']);
  assert.deepEqual(acc.account.followed, ['assistido', 'aovivo', 'offline']);
  assert.ok(recentEvents().good.some((e) => e.text === 'seguiu #assistido' && e.platform === 'kick'));
  // Anotado no kick.json da pasta temporária.
  assert.ok(fs.existsSync(path.join(dataDir, 'kick.json')));
});

test('followNext: espera o intervalo entre um follow e outro', async () => {
  const acc = followSetup();
  acc.nextFollow = 0;
  const before = Date.now();
  await acc.followNext();
  assert.ok(acc.nextFollow >= before + 3 * 60 * 1000 && acc.nextFollow <= Date.now() + 10 * 60 * 1000);
  await acc.followNext();
  assert.deepEqual(posts, ['assistido']);
});

test('followNext: canal que a conta já seguia é anotado sem POST e sem aviso', async () => {
  const acc = followSetup();
  respond = (url) => json(url.endsWith('/me') ? { is_following: true } : {});
  acc.nextFollow = 0;
  await acc.followNext();
  assert.deepEqual(posts, []);
  assert.deepEqual(acc.account.followed, ['assistido']);
});

test('followNext: pula os já seguidos', async () => {
  const acc = followSetup({ account: { followed: ['assistido', 'aovivo', 'offline'] } });
  acc.nextFollow = 0;
  await acc.followNext();
  assert.deepEqual(posts, []);
});

test('followNext: canal que deu erro não é tentado de novo', async () => {
  const acc = followSetup();
  respond = (url, options, slug) => json({}, options.method === 'POST' && slug === 'assistido' ? 422 : 200);
  acc.nextFollow = 0;
  await acc.followNext();
  assert.ok(acc.followFailed.has('assistido'));
  assert.ok(recentEvents().bad.some((e) => e.text === 'não deu para seguir #assistido (a Kick respondeu 422)'));
  acc.nextFollow = 0;
  await acc.followNext();
  assert.deepEqual(posts, ['assistido', 'aovivo']);
  assert.deepEqual(acc.account.followed, ['aovivo']);
});

test('followNext: token recusado (401) pede token novo', async () => {
  const acc = followSetup();
  respond = () => json({}, 401);
  acc.nextFollow = 0;
  await acc.followNext();
  assert.equal(acc.account.needsRelink, true);
  assert.equal(acc.followFailed.size, 0);
  assert.equal(acc.watches.size, 0);
});

test('followNext: sem internet tenta o mesmo canal na próxima vez', async () => {
  const acc = followSetup();
  respond = (url, options) => (options.method === 'POST' ? Promise.reject(new TypeError('fetch failed')) : json({}));
  acc.nextFollow = 0;
  await acc.followNext();
  assert.equal(acc.followFailed.size, 0);
  acc.nextFollow = 0;
  await acc.followNext();
  assert.deepEqual(posts, ['assistido', 'assistido']);
});

// Pontos de follow anotados no histórico de hoje para a conta de teste.
const followPoints = () => pointsHistory(1)[0]?.accounts?.['kconta (Kick)']?.FOLLOW?.points ?? 0;

test('followNext: bônus de follow entra no histórico como FOLLOW, mesmo sem saldo lido antes', async () => {
  const acc = followSetup();
  let balance = 100;
  respond = (url, options) => {
    if (options.method === 'POST') balance += 50; // a Kick dá o bônus ao seguir
    return json(url.endsWith('/points') ? { data: { points: balance } } : {});
  };
  const before = followPoints();
  acc.nextFollow = 0;
  await acc.followNext();
  assert.equal(acc.channel('assistido').balance, 100); // leu o saldo antes do follow
  assert.ok(acc.channel('assistido').nextCheck > Date.now()); // e marcou uma leitura logo depois
  await acc.checkChannel('assistido');
  assert.equal(followPoints() - before, 50);
  // Depois do bônus, o que sobe volta a ser tempo assistido.
  balance += 10;
  await acc.checkChannel('assistido');
  assert.equal(followPoints() - before, 50);
});

test('followNext: bônus atrasado ainda conta como follow nas leituras seguintes', async () => {
  const acc = followSetup();
  let balance = 0;
  respond = (url) => json(url.endsWith('/points') ? { points: balance } : {});
  const before = followPoints();
  acc.nextFollow = 0;
  await acc.followNext();
  await acc.checkChannel('assistido'); // bônus ainda não caiu
  assert.ok(acc.channel('assistido').nextCheck <= Date.now() + 90 * 1000); // olha de novo logo
  balance = 30;
  await acc.checkChannel('assistido');
  assert.equal(followPoints() - before, 30);
});

test('followNext: não segue no descanso, sem token ou com outro follow em andamento', async () => {
  for (const setup of [{ resting: true }, { account: { needsRelink: true } }, { account: { token: '' } }]) {
    const acc = followSetup(setup);
    acc.nextFollow = 0;
    await acc.followNext();
  }
  const acc = followSetup();
  acc.nextFollow = 0;
  acc.followBusy = true;
  await acc.followNext();
  assert.deepEqual(posts, []);
});
