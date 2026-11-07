// Kick: a API oficial diz quais canais estão ao vivo (token de app, sem login de usuário);
// a API do site (kick.com/api) dá os números do canal e da live, a conta e o saldo de pontos.
const TOKEN_URL = 'https://id.kick.com/oauth/token';
const API_URL = 'https://api.kick.com/public/v1';

let appToken = null; // { token, expiresAt, clientId }

async function getAppToken(clientId, clientSecret) {
  if (appToken && appToken.clientId === clientId && appToken.expiresAt > Date.now() + 60000) return appToken.token;
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
  });
  if (!res.ok) throw new Error('Client ID ou Client Secret da Kick recusados');
  const data = await res.json();
  appToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000, clientId };
  return appToken.token;
}

export function resetKickToken() {
  appToken = null;
}

// Retorna Map(slug -> { viewers, startTime }) só com os canais ao vivo.
export async function fetchKickLive({ clientId, clientSecret }, slugs) {
  const live = new Map();
  for (let i = 0; i < slugs.length; i += 50) {
    const query = slugs.slice(i, i + 50).map((s) => `slug=${encodeURIComponent(s)}`).join('&');
    const request = async () =>
      fetch(`${API_URL}/channels?${query}`, {
        headers: { Authorization: `Bearer ${await getAppToken(clientId, clientSecret)}` },
      });
    let res = await request();
    if (res.status === 401) {
      resetKickToken();
      res = await request();
    }
    if (!res.ok) throw new Error(`API da Kick respondeu ${res.status}`);
    for (const channel of (await res.json()).data) {
      if (channel.stream?.is_live) live.set(channel.slug, { viewers: channel.stream.viewer_count, startTime: channel.stream.start_time });
    }
  }
  return live;
}

// ---------- API do site (a mesma que o kick.com usa) ----------
// Sem fingir ser o Chrome: a Kick bloqueia pedidos que dizem ser um navegador mas não são ("Request blocked by security policy").
const SITE_URL = 'https://kick.com/api';
// Token fixo do site da Kick, igual para todo mundo, pedido ao gerar o token de espectador.
const CLIENT_TOKEN = 'e1393935a959b4020a4491574f6490129f678acdaa92760471263db43487f823';

// Erro com o código HTTP, para quem chama saber se o token foi recusado (401) ou a Kick bloqueou (403).
class KickError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function siteGet(path, token) {
  const res = await fetch(`${SITE_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (res.status === 401) throw new KickError('token da Kick recusado', 401);
  if (res.status === 403) throw new KickError('a Kick bloqueou o pedido', 403);
  if (!res.ok) throw new KickError(`a Kick respondeu ${res.status}`, res.status);
  return res.json();
}

// Números do canal e da live atual: { channelId, userId, livestreamId (null se offline), viewers }.
export async function fetchKickChannel(slug) {
  const data = await siteGet(`/v2/channels/${encodeURIComponent(slug)}`);
  return {
    channelId: data.id,
    userId: data.user_id ?? data.user?.id,
    livestreamId: data.livestream?.id ?? null,
    viewers: data.livestream?.viewer_count ?? 0,
  };
}

// Conta dona do token: { id, username }. Erro se o token não vale.
export async function fetchKickUser(token) {
  const data = await siteGet('/v1/user', token);
  if (!data?.id) throw new KickError('token da Kick recusado', 401);
  return { id: data.id, username: data.username };
}

// Saldo de pontos da conta no canal.
export async function fetchKickPoints(slug, token) {
  const data = await siteGet(`/v2/channels/${encodeURIComponent(slug)}/points`, token);
  return data?.data?.points ?? data?.points ?? 0;
}

// Token da conexão de espectador (websockets.kick.com), ligado à conta e ao canal.
export async function fetchViewerToken(token, { channelId, userId }) {
  const res = await fetch('https://websockets.kick.com/viewer/v1/token', {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Client-Token': CLIENT_TOKEN,
      'X-Chatroom': String(channelId),
      'X-User-Id': String(userId),
    },
  });
  if (res.status === 401) throw new KickError('token da Kick recusado', 401);
  if (!res.ok) throw new KickError(`a Kick respondeu ${res.status} ao pedir a conexão`, res.status);
  const data = await res.json();
  const viewerToken = data?.data?.token ?? data?.token;
  if (!viewerToken) throw new KickError('a Kick não deu o token de espectador', res.status);
  return viewerToken;
}

// Aceita o token como vem do navegador: cabeçalho "Bearer …" ou cookie session_token (com %7C no lugar de |).
export function cleanKickToken(raw) {
  let token = String(raw ?? '').trim().replace(/^bearer\s+/i, '');
  try {
    token = decodeURIComponent(token);
  } catch {
    // já estava decodificado
  }
  return token.replace(/^"|"$/g, '').trim();
}
