import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cleanKickToken, followKickChannel, fetchKickUser, fetchKickPoints } from '../src/kick.js';

// Nenhum teste fala com a Kick de verdade: o fetch é trocado por um falso que responde pelo endereço.
const realFetch = globalThis.fetch;
let calls;
let routes;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  calls = [];
  routes = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method ?? 'GET', headers: options.headers ?? {} });
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
