import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchRewards, toReward } from '../src/twitch.js';

// Nada de internet: o fetch é trocado por uma resposta montada no teste.
const realFetch = globalThis.fetch;
afterEach(() => (globalThis.fetch = realFetch));

const reward = (over = {}) => ({
  id: 'r1', title: 'Bônus de XP', prompt: '5 horas de XP', cost: 1500, backgroundColor: '#9146FF',
  image: null, defaultImage: { url2x: 'padrao.png' }, isEnabled: true, isPaused: false, isInStock: true,
  isSubOnly: false, isUserInputRequired: false, cooldownExpiresAt: null, pricingType: 'POINTS', ...over,
});

const answer = (body, status = 200) => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body), headers: options.headers });
    return { ok: status < 400, status, json: async () => body };
  };
  return calls;
};

test('toReward: traduz a recompensa da Twitch', () => {
  assert.deepEqual(toReward(reward({ isUserInputRequired: true, cooldownExpiresAt: '2026-11-09T20:00:00Z' })), {
    id: 'r1', title: 'Bônus de XP', prompt: '5 horas de XP', cost: 1500, color: '#9146FF', image: 'padrao.png',
    paused: false, inStock: true, subOnly: false, inputRequired: true, cooldownUntil: '2026-11-09T20:00:00Z',
  });
  assert.equal(toReward(reward({ image: { url2x: 'propria.png' } })).image, 'propria.png');
});

test('fetchRewards: só as ativas pagas com pontos, da mais barata para a mais cara', async () => {
  const calls = answer({
    data: {
      community: {
        channel: {
          id: '42',
          communityPointsSettings: {
            name: 'Rodoletas',
            image: { url2x: 'moeda.png' },
            customRewards: [
              reward({ id: 'cara', cost: 9000 }),
              reward({ id: 'desligada', isEnabled: false }),
              reward({ id: 'bits', pricingType: 'BITS' }),
              reward({ id: 'barata', cost: 100 }),
            ],
          },
        },
      },
    },
  });
  const shop = await fetchRewards('rodil');
  assert.equal(shop.channelId, '42');
  assert.equal(shop.pointsName, 'Rodoletas');
  assert.equal(shop.pointsIcon, 'moeda.png');
  assert.deepEqual(shop.rewards.map((r) => r.id), ['barata', 'cara']);
  // Sem login: abrir a loja não usa nenhuma conta.
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.equal(calls[0].body.variables.channelLogin, 'rodil');
});

test('fetchRewards: canal sem recompensas e erros da Twitch', async () => {
  answer({ data: { community: { channel: { id: '1', communityPointsSettings: null } } } });
  assert.deepEqual(await fetchRewards('x'), { channelId: '1', pointsName: 'pontos', pointsIcon: null, rewards: [] });

  answer({ data: { community: { channel: null } } });
  await assert.rejects(fetchRewards('x'), /canal não encontrado/);

  answer({ errors: [{ message: 'PersistedQueryNotFound' }] });
  await assert.rejects(fetchRewards('x'), /PersistedQueryNotFound/);

  answer({}, 500);
  await assert.rejects(fetchRewards('x'), /Twitch respondeu 500/);
});
