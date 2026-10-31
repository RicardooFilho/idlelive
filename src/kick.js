// API oficial da Kick: só consulta quais canais estão ao vivo (token de app, sem login de usuário).
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

// Retorna Map(slug -> { viewers }) só com os canais ao vivo.
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
      if (channel.stream?.is_live) live.set(channel.slug, { viewers: channel.stream.viewer_count });
    }
  }
  return live;
}
