// Chamadas à API da Twitch: login (Device Code Flow), tokens e status das lives.
const ID_URL = 'https://id.twitch.tv/oauth2';
const SCOPES = 'chat:read';

async function postForm(url, params) {
  const res = await fetch(url, { method: 'POST', body: new URLSearchParams(params) });
  const text = await res.text();
  return { ok: res.ok, data: text ? JSON.parse(text) : {} };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retorna { device_code, user_code, verification_uri, expires_in, interval }.
export async function startDeviceFlow(clientId) {
  const { ok, data } = await postForm(`${ID_URL}/device`, { client_id: clientId, scopes: SCOPES });
  if (!ok) throw new Error(data.message || 'Falha ao iniciar o login');
  return data;
}

// Espera o usuário confirmar o código. `isCancelled` permite abortar a espera.
export async function waitDeviceToken(clientId, flow, isCancelled) {
  const deadline = Date.now() + flow.expires_in * 1000;
  while (Date.now() < deadline) {
    await sleep(flow.interval * 1000);
    if (isCancelled()) throw new Error('Cancelado');
    const { ok, data } = await postForm(`${ID_URL}/token`, {
      client_id: clientId,
      scopes: SCOPES,
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

// Retorna Map(login -> { viewers }) só com os canais ao vivo, ou null se o token foi recusado.
export async function fetchLive(clientId, accessToken, logins) {
  const live = new Map();
  for (let i = 0; i < logins.length; i += 100) {
    const query = logins.slice(i, i + 100).map((l) => `user_login=${encodeURIComponent(l)}`).join('&');
    const res = await fetch(`https://api.twitch.tv/helix/streams?first=100&${query}`, {
      headers: { 'Client-Id': clientId, Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 401) return null;
    if (!res.ok) throw new Error(`Helix respondeu ${res.status}`);
    for (const stream of (await res.json()).data) {
      live.set(stream.user_login, { viewers: stream.viewer_count });
    }
  }
  return live;
}
