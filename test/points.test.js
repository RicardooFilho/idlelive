import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Pasta temporária no lugar da raiz: points.js importa store, stats e events, que leem e gravam arquivos de dados.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idlelive-test-'));
process.env.IDLELIVE_DATA_DIR = dataDir;
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const { PointsAccount } = await import('../src/points.js');
const { recentEvents } = await import('../src/events.js');

// Conta montada sem start(): nada de timers, PubSub ou rede. O descanso é desligado para não depender da hora.
const makeAccount = ({ account = {}, resting = false } = {}) => {
  const acc = new PointsAccount(
    { login: 'conta', userId: '99', accessToken: 'tok', ...account },
    { log: () => {}, channelNames: new Map() },
  );
  Object.defineProperty(acc, 'resting', { value: resting });
  return acc;
};

const live = (name, channelId = `id-${name}`) => ({ name, channelId, broadcastId: `b-${name}` });
const setBalances = (acc, balances) => {
  for (const [name, balance] of Object.entries(balances)) acc.channel(name).balance = balance;
};
const names = (list) => list.map((l) => l.name);

// ---------- pickTargets ----------

test('pickTargets: no máximo 2 lives, mais pontos primeiro', () => {
  const acc = makeAccount();
  acc.live = [live('a'), live('b'), live('c')];
  acc.account.streakDone = ['b-a', 'b-b', 'b-c'];
  setBalances(acc, { a: 10, b: 30, c: 20 });
  assert.deepEqual(names(acc.pickTargets()), ['b', 'c']);
});

test('pickTargets: lives sem a sequência garantida vêm antes', () => {
  const acc = makeAccount();
  acc.live = [live('a'), live('b'), live('c')];
  acc.account.streakDone = ['b-b'];
  setBalances(acc, { a: 10, b: 30, c: 20 });
  assert.deepEqual(names(acc.pickTargets()), ['c', 'a']);
});

test('pickTargets: saldo desconhecido vai por último, na ordem da lista', () => {
  const acc = makeAccount();
  acc.live = [live('x'), live('y'), live('z')];
  acc.account.streakDone = ['b-x', 'b-y', 'b-z'];
  setBalances(acc, { z: 5 });
  assert.deepEqual(names(acc.pickTargets()), ['z', 'x']);
});

test('pickTargets: a live que recebeu a raid vem antes de tudo', () => {
  const acc = makeAccount();
  acc.live = [live('a'), live('b'), live('c')];
  acc.account.streakDone = ['b-a'];
  setBalances(acc, { a: 1, b: 30, c: 20 });
  acc.raidTarget = { name: 'a', until: Date.now() + 60000 };
  assert.deepEqual(names(acc.pickTargets()), ['a', 'b']);
});

test('pickTargets: raid vencida é esquecida', () => {
  const acc = makeAccount();
  acc.live = [live('a'), live('b'), live('c')];
  acc.account.streakDone = ['b-a', 'b-b', 'b-c'];
  setBalances(acc, { a: 1, b: 30, c: 20 });
  acc.raidTarget = { name: 'a', until: Date.now() - 1 };
  assert.deepEqual(names(acc.pickTargets()), ['b', 'c']);
  assert.equal(acc.raidTarget, null);
});

test('pickTargets: sem lives, nada para assistir', () => {
  assert.deepEqual(makeAccount().pickTargets(), []);
});

// ---------- followNext ----------

// Conta com 3 canais: um assistido, um ao vivo e um offline (o id do offline vem do mapa de nomes).
const followSetup = (options) => {
  const acc = makeAccount(options);
  acc.all = ['offline', 'aovivo', 'assistido'];
  acc.live = [live('aovivo', '2'), live('assistido', '3')];
  acc.watching = ['assistido'];
  acc.channelNames.set('4', 'offline');
  const calls = [];
  acc.gql = async (operation, variables) => {
    calls.push({ operation, variables });
    return { followUser: { follow: {} } };
  };
  return { acc, calls };
};

test('followNext: segue um por vez, assistindo → ao vivo → offline', async () => {
  const { acc, calls } = followSetup();
  for (let i = 0; i < 4; i++) {
    acc.nextFollow = 0;
    await acc.followNext();
  }
  assert.deepEqual(calls.map((c) => c.variables.input.targetID), ['3', '2', '4']);
  assert.ok(calls.every((c) => c.operation === 'FollowButton_FollowUser'));
  assert.deepEqual(acc.account.followed, ['assistido', 'aovivo', 'offline']);
  assert.ok(recentEvents().good.some((e) => e.text === 'seguiu #assistido' && e.account === 'conta'));
});

test('followNext: espera o intervalo entre um follow e outro', async () => {
  const { acc, calls } = followSetup();
  acc.nextFollow = 0;
  const before = Date.now();
  await acc.followNext();
  // O próximo só depois de 3 a 10 min.
  assert.ok(acc.nextFollow >= before + 3 * 60 * 1000 && acc.nextFollow <= Date.now() + 10 * 60 * 1000);
  await acc.followNext();
  assert.equal(calls.length, 1);
});

test('followNext: pula os já seguidos e os sem id do canal', async () => {
  const { acc, calls } = followSetup({ account: { followed: ['assistido', 'aovivo'] } });
  acc.channelNames.clear(); // sem o id do canal offline
  acc.nextFollow = 0;
  await acc.followNext();
  assert.equal(calls.length, 0);
});

test('followNext: canal que deu erro não é tentado de novo', async () => {
  const { acc, calls } = followSetup();
  acc.gql = async (operation, variables) => {
    calls.push({ operation, variables });
    return { followUser: { error: { code: 'FORBIDDEN' } } };
  };
  acc.nextFollow = 0;
  await acc.followNext();
  assert.ok(acc.followFailed.has('assistido'));
  assert.equal(acc.account.followed, undefined);
  assert.ok(recentEvents().bad.some((e) => e.text === 'não deu para seguir #assistido (FORBIDDEN)'));
  acc.nextFollow = 0;
  await acc.followNext();
  assert.equal(calls.at(-1).variables.input.targetID, '2');
});

test('followNext: sem internet tenta o mesmo canal na próxima vez', async () => {
  const { acc } = followSetup();
  const targets = [];
  acc.gql = async (_, variables) => {
    targets.push(variables.input.targetID);
    throw new TypeError('fetch failed');
  };
  acc.nextFollow = 0;
  await acc.followNext();
  assert.equal(acc.followFailed.size, 0);
  acc.nextFollow = 0;
  await acc.followNext();
  assert.deepEqual(targets, ['3', '3']);
});

test('followNext: não segue no descanso, sem token ou com outro follow em andamento', async () => {
  for (const setup of [{ resting: true }, { account: { needsRelink: true } }, { account: { accessToken: null } }]) {
    const { acc, calls } = followSetup(setup);
    acc.nextFollow = 0;
    await acc.followNext();
    assert.equal(calls.length, 0, JSON.stringify(setup));
  }
  const { acc, calls } = followSetup();
  acc.nextFollow = 0;
  acc.followBusy = true;
  await acc.followNext();
  assert.equal(calls.length, 0);
});
