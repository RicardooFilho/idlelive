// Chamadas à Twitch: login por código (Device Code Flow), tokens e status das lives.
// Tudo usa o Client ID do app de TV da Twitch, porque a API interna (GQL) só aceita os apps da própria Twitch.
const ID_URL = 'https://id.twitch.tv/oauth2';
export const GQL_URL = 'https://gql.twitch.tv/gql';

// Falha de rede (sem internet, DNS, conexão recusada…), e não uma resposta da Twitch.
// O fetch do Node lança TypeError("fetch failed") com o motivo em `cause`.
export const isNetworkError = (err) => err instanceof TypeError && /fetch failed/i.test(err.message);
export const TV_CLIENT_ID = 'ue6666qo983tsx6so1t0vnawi233wa';
const STREAM_INFO_HASH = '198492e0857f6aedead9665c81c5a06d67b25b58034649687124083ff288597d';

async function postForm(url, params) {
  const res = await fetch(url, { method: 'POST', body: new URLSearchParams(params) });
  const text = await res.text();
  return { ok: res.ok, data: text ? JSON.parse(text) : {} };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retorna { device_code, user_code, verification_uri, expires_in, interval }.
export async function startDeviceFlow(clientId, scopes) {
  const { ok, data } = await postForm(`${ID_URL}/device`, { client_id: clientId, scopes });
  if (!ok) throw new Error(data.message || 'Falha ao iniciar o login');
  return data;
}

// Espera o usuário confirmar o código. `isCancelled` permite abortar a espera.
export async function waitDeviceToken(clientId, flow, isCancelled, scopes) {
  const deadline = Date.now() + flow.expires_in * 1000;
  while (Date.now() < deadline) {
    await sleep(flow.interval * 1000);
    if (isCancelled()) throw new Error('Cancelado');
    const { ok, data } = await postForm(`${ID_URL}/token`, {
      client_id: clientId,
      scopes,
      device_code: flow.device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    if (ok) return data;
    if (data.message !== 'authorization_pending') throw new Error(data.message || 'Login recusado');
  }
  throw new Error('O código expirou');
}

// Retorna os tokens novos, ou null se o refresh token foi recusado (aí só vinculando de novo).
// Falhas de rede/servidor lançam erro, para não confundir uma queda de internet com token inválido.
export async function refreshToken(clientId, token) {
  const res = await fetch(`${ID_URL}/token`, {
    method: 'POST',
    body: new URLSearchParams({ client_id: clientId, grant_type: 'refresh_token', refresh_token: token }),
  });
  if (res.ok) return res.json();
  if (res.status === 400 || res.status === 401) return null;
  throw new Error(`Twitch respondeu ${res.status} ao renovar o token`);
}

// Retorna { login, user_id, expires_in } ou null se o token não vale mais.
export async function validate(accessToken) {
  const res = await fetch(`${ID_URL}/validate`, { headers: { Authorization: `OAuth ${accessToken}` } });
  return res.ok ? res.json() : null;
}

export async function revoke(clientId, accessToken) {
  await postForm(`${ID_URL}/revoke`, { client_id: clientId, token: accessToken }).catch(() => {});
}

// Retorna Map(login -> { viewers, userId, streamId }) só com os canais ao vivo.
// Usa a API interna (GQL) sem login, então a lista de lives funciona mesmo sem conta vinculada.
export async function fetchLive(logins) {
  const live = new Map();
  for (let i = 0; i < logins.length; i += 30) {
    const batch = logins.slice(i, i + 30).map((channel) => ({
      operationName: 'VideoPlayerStreamInfoOverlayChannel',
      variables: { channel },
      extensions: { persistedQuery: { version: 1, sha256Hash: STREAM_INFO_HASH } },
    }));
    const res = await fetch(GQL_URL, { method: 'POST', headers: { 'Client-Id': TV_CLIENT_ID }, body: JSON.stringify(batch) });
    if (!res.ok) throw new Error(`Twitch respondeu ${res.status}`);
    const results = await res.json();
    if (!Array.isArray(results)) throw new Error('resposta inesperada da Twitch');
    for (const { data, errors } of results) {
      if (errors?.length) throw new Error(errors[0].message);
      const user = data?.user;
      if (user?.stream) live.set(user.login, { viewers: user.stream.viewersCount, userId: user.id, streamId: user.stream.id });
    }
  }
  return live;
}
