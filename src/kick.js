// Kick: a API oficial diz quais canais estão ao vivo (token de app, sem login de usuário);
// a API do site (kick.com/api) dá os números do canal e da live, a conta e o saldo de pontos.
import crypto from 'node:crypto';
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

async function siteGet(path, token, method = 'GET') {
  const res = await fetch(`${SITE_URL}${path}`, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
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

// Segue o canal com a conta. Se ela já segue, não faz nada (para não trocar nada que a pessoa ajustou).
// Retorna true se seguiu agora, false se já seguia.
export async function followKickChannel(slug, token) {
  const path = `/v2/channels/${encodeURIComponent(slug)}`;
  const me = await siteGet(`${path}/me`, token).catch((err) => {
    if (err.status === 401) throw err;
    return null; // sem a resposta, tenta seguir mesmo assim
  });
  if (me?.is_following) return false;
  const res = await fetch(`${SITE_URL}${path}/follow`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) throw new KickError('token da Kick recusado', 401);
  if (!res.ok) throw new KickError(`a Kick respondeu ${res.status}`, res.status);
  return true;
}

// Recompensa da Kick no mesmo formato da Twitch (toReward em twitch.js), para o painel usar a mesma loja.
// A Kick não tem estoque, tempo de espera nem imagem por recompensa: só a cor.
export const toKickReward = (r) => ({
  id: r.id,
  title: r.title,
  prompt: r.description ?? '',
  inputPrompt: r.prompt ?? '',
  cost: r.cost,
  color: r.background_color ?? null,
  image: null,
  paused: !!r.is_paused,
  inStock: true,
  subOnly: false,
  inputRequired: !!r.is_user_input_required,
  cooldownUntil: null,
});

// Loja de um canal: as recompensas ativas, da mais barata para a mais cara. Sem login, como na Twitch.
export async function fetchKickRewards(slug) {
  const data = await siteGet(`/v2/channels/${encodeURIComponent(slug)}/rewards`);
  return {
    pointsName: 'pontos',
    pointsIcon: null,
    rewards: (data?.data ?? [])
      .filter((r) => r.is_enabled !== false)
      .map(toKickReward)
      .sort((a, b) => a.cost - b.cost),
  };
}

// Identificador do resgate no formato que o site da Kick usa (ULID): horário em ms + parte aleatória, em base32.
// Cada resgate leva um novo, para a Kick não contar o mesmo pedido duas vezes.
const ULID_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function ulid(now = Date.now()) {
  let time = '';
  for (let t = now, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = ULID_CHARS[t % 32] + time;
  return time + [...crypto.randomBytes(16)].map((b) => ULID_CHARS[b % 32]).join('');
}

// Resgata uma recompensa com a conta, com o mesmo corpo que o site manda: { transaction_id, message }.
// A Kick explica a recusa no corpo da resposta ("message" e, na validação, "errors"); ela aparece como veio.
export async function redeemKickReward(slug, rewardId, token, text = '') {
  const res = await fetch(`${SITE_URL}/v2/channels/${encodeURIComponent(slug)}/rewards/${encodeURIComponent(rewardId)}/redeem`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction_id: ulid(), message: text }),
  });
  if (res.status === 401) throw new KickError('token da Kick recusado', 401);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const details = Object.values(body?.errors ?? {}).flat().join(' ');
    const reason = [body?.message ?? body?.error, details].filter(Boolean).join(' ');
    throw new KickError(reason ? `a Kick recusou: ${reason}` : `a Kick respondeu ${res.status}`, res.status);
  }
  return res.json().catch(() => ({}));
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
