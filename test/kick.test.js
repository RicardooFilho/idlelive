import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cleanKickToken, followKickChannel, fetchKickUser, fetchKickPoints, fetchKickRewards, redeemKickReward, ulid } from '../src/kick.js';

// Nenhum teste fala com a Kick de verdade: o fetch é trocado por um falso que responde pelo endereço.
const realFetch = globalThis.fetch;
let calls;
let routes;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  calls = [];
  routes = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method ?? 'GET', headers: options.headers ?? {}, body: options.body });
    const route = routes.find(([match]) => String(url).endsWith(match));
    if (!route) throw new Error(`endereço não esperado no teste: ${url}`);
    return route[1](options);
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

test('cleanKickToken aceita o token como vem do navegador', () => {
  assert.equal(cleanKickToken('Bearer 123|abc'), '123|abc');
  assert.equal(cleanKickToken('bearer   123|abc'), '123|abc');
  assert.equal(cleanKickToken('123%7Cabc'), '123|abc');
  assert.equal(cleanKickToken('"123%7Cabc"'), '123|abc');
  assert.equal(cleanKickToken('  "123|abc"  '), '123|abc');
  assert.equal(cleanKickToken('  Bearer "123|abc" \n'), '123|abc');
  assert.equal(cleanKickToken(null), '');
  assert.equal(cleanKickToken(undefined), '');
  // "%" sozinho não decodifica: fica como estava, sem erro.
  assert.equal(cleanKickToken('abc%E0%A4%A'), 'abc%E0%A4%A');
});

test('followKickChannel não segue de novo quem já segue', async () => {
  routes.push(['/v2/channels/cogu/me', () => json({ is_following: true })]);
  assert.equal(await followKickChannel('cogu', 'tok'), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.Authorization, 'Bearer tok');
  assert.ok(!calls.some((c) => c.method === 'POST'));
});

test('followKickChannel segue com POST quando ainda não segue', async () => {
  routes.push(['/v2/channels/cogu/me', () => json({ is_following: false })]);
  routes.push(['/v2/channels/cogu/follow', () => json({})]);
  assert.equal(await followKickChannel('cogu', 'tok'), true);
  const post = calls.find((c) => c.method === 'POST');
  assert.ok(post, 'faltou o POST');
  assert.equal(post.url, 'https://kick.com/api/v2/channels/cogu/follow');
  assert.equal(post.headers.Authorization, 'Bearer tok');
});

test('followKickChannel codifica o nome do canal no endereço', async () => {
  routes.push(['/v2/channels/a%20b/me', () => json({ is_following: true })]);
  assert.equal(await followKickChannel('a b', 'tok'), false);
});

test('followKickChannel devolve erro 401 quando o token não vale (no /me)', async () => {
  routes.push(['/me', () => json({}, 401)]);
  await assert.rejects(followKickChannel('cogu', 'tok'), (err) => err.status === 401);
  assert.ok(!calls.some((c) => c.method === 'POST'));
});

test('followKickChannel devolve erro 401 quando o token não vale (no follow)', async () => {
  routes.push(['/me', () => json({ is_following: false })]);
  routes.push(['/follow', () => json({}, 401)]);
  await assert.rejects(followKickChannel('cogu', 'tok'), (err) => err.status === 401);
});

test('followKickChannel tenta seguir mesmo se o /me falhar com outro erro', async () => {
  for (const status of [403, 500]) {
    calls = [];
    routes = [['/me', () => json({}, status)], ['/follow', () => json({})]];
    assert.equal(await followKickChannel('cogu', 'tok'), true, `status ${status}`);
    assert.ok(calls.some((c) => c.method === 'POST'));
  }
});

test('followKickChannel tenta seguir mesmo sem internet no /me', async () => {
  routes.push(['/me', () => Promise.reject(new TypeError('fetch failed'))]);
  routes.push(['/follow', () => json({})]);
  assert.equal(await followKickChannel('cogu', 'tok'), true);
});

test('followKickChannel devolve o código quando o follow falha', async () => {
  routes.push(['/me', () => json({ is_following: false })]);
  routes.push(['/follow', () => json({}, 429)]);
  await assert.rejects(followKickChannel('cogu', 'tok'), (err) => err.status === 429 && /429/.test(err.message));
});

test('fetchKickUser devolve id e nome da conta', async () => {
  routes.push(['/v1/user', () => json({ id: 42, username: 'Fulano', email: 'x' })]);
  assert.deepEqual(await fetchKickUser('tok'), { id: 42, username: 'Fulano' });
  assert.equal(calls[0].url, 'https://kick.com/api/v1/user');
  assert.equal(calls[0].headers.Authorization, 'Bearer tok');
});

test('fetchKickUser marca 401 quando a resposta não tem conta', async () => {
  routes.push(['/v1/user', () => json({})]);
  await assert.rejects(fetchKickUser('tok'), (err) => err.status === 401);
});

test('fetchKickUser separa token recusado (401) de bloqueio (403)', async () => {
  routes.push(['/v1/user', () => json({}, 401)]);
  await assert.rejects(fetchKickUser('tok'), (err) => err.status === 401);
  routes = [['/v1/user', () => json({}, 403)]];
  await assert.rejects(fetchKickUser('tok'), (err) => err.status === 403);
});

test('fetchKickPoints lê o saldo nos dois formatos da Kick', async () => {
  routes.push(['/v2/channels/cogu/points', () => json({ data: { points: 1500 } })]);
  assert.equal(await fetchKickPoints('cogu', 'tok'), 1500);
  routes = [['/v2/channels/cogu/points', () => json({ points: 7 })]];
  assert.equal(await fetchKickPoints('cogu', 'tok'), 7);
  routes = [['/v2/channels/cogu/points', () => json({})]];
  assert.equal(await fetchKickPoints('cogu', 'tok'), 0);
});

test('fetchKickPoints repassa erro com o status', async () => {
  routes.push(['/points', () => json({}, 500)]);
  await assert.rejects(fetchKickPoints('cogu', 'tok'), (err) => err.status === 500);
});

// ---------- Loja ----------

const kickReward = (over = {}) => ({
  id: 'r1', title: 'Bônus +15% XP PokeIdle', cost: 300, description: '1 hora de XP', is_enabled: true, is_paused: false,
  is_user_input_required: false, prompt: '', background_color: '#53FC18', ...over,
});

test('fetchKickRewards lê sem login, tira as desativadas e ordena pelo preço', async () => {
  routes.push(['/v2/channels/canal/rewards', () => json({ data: [
    kickReward({ id: 'cara', cost: 500 }),
    kickReward({ id: 'off', cost: 10, is_enabled: false }),
    kickReward({ id: 'barata', cost: 100, is_paused: true, is_user_input_required: true, prompt: 'Seu nick' }),
  ] })]);
  const { rewards } = await fetchKickRewards('canal');
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.deepEqual(rewards.map((r) => r.id), ['barata', 'cara']);
  assert.deepEqual(rewards[0], {
    id: 'barata', title: 'Bônus +15% XP PokeIdle', prompt: '1 hora de XP', inputPrompt: 'Seu nick', cost: 100, color: '#53FC18',
    image: null, paused: true, inStock: true, subOnly: false, inputRequired: true, cooldownUntil: null,
  });
});

test('redeemKickReward manda o token, um transaction_id novo e o texto, como o site', async () => {
  routes.push(['/v2/channels/canal/rewards/r1/redeem', () => json({ data: {} })]);
  await redeemKickReward('canal', 'r1', 'tok');
  await redeemKickReward('canal', 'r1', 'tok', 'meu nick');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers.Authorization, 'Bearer tok');
  const [first, second] = calls.map((c) => JSON.parse(c.body));
  assert.equal(first.message, '');
  assert.equal(second.message, 'meu nick');
  assert.match(first.transaction_id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.notEqual(first.transaction_id, second.transaction_id);
});

test('ulid: 26 letras, começando pelo horário (ordena pelo tempo)', () => {
  assert.equal(ulid(0).slice(0, 10), '0000000000');
  assert.equal(ulid(1469918176385).slice(0, 10), '01ARYZ6S41'); // exemplo da especificação do ULID
  assert.ok(ulid(1000) < ulid(2000));
});

test('redeemKickReward mostra o motivo da recusa (com os campos da validação) e marca o 401', async () => {
  routes.push(['/v2/channels/canal/rewards/r1/redeem', () => json({ message: 'The given data was invalid.', errors: { transaction_id: ['The transaction id field is required.'] } }, 422)]);
  await assert.rejects(redeemKickReward('canal', 'r1', 'tok'), (err) => err.status === 422 && err.message === 'a Kick recusou: The given data was invalid. The transaction id field is required.');
  routes[0] = ['/v2/channels/canal/rewards/r1/redeem', () => json({}, 401)];
  await assert.rejects(redeemKickReward('canal', 'r1', 'tok'), (err) => err.status === 401);
});
