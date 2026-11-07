// Pontos do canal (Twitch): até 4 contas, cada uma "assiste" até 2 lives dos canais oficiais e pega o bônus de pontos sozinha.
// Baseado no Twitch Channel Points Miner v2 (github.com/rdavydov/Twitch-Channel-Points-Miner-v2).
// Usa a API interna (GQL) da Twitch, que só aceita tokens dos apps da própria Twitch, por isso o login é o do app de TV.
import crypto from 'node:crypto';
import { startDeviceFlow, waitDeviceToken, refreshToken, validate, revoke, GQL_URL, TV_CLIENT_ID as CLIENT_ID } from './twitch.js';
import { pointsAccounts, savePoints, MAX_ACCOUNTS } from './store.js';

const SCOPES = 'channel_read chat:read user_blocks_edit user_blocks_read user_follows_edit user_read';
const TV_UA = 'Mozilla/5.0 (Linux; Android 7.1; Smart Box C1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36';
const PAGE_UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:85.0) Gecko/20100101 Firefox/85.0';
// Consultas salvas da GQL. Se a Twitch trocar alguma, o log mostra "PersistedQueryNotFound" e o hash precisa ser atualizado.
const HASHES = {
  PlaybackAccessToken: 'ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9',
  ChannelPointsContext: '7fe050e3761eb2cf258d70ee1a21cbd76fa8cf3d7e7b12fc437e7029d446b5e3',
  ClaimCommunityPoints: '46aaeebe02c99afdf4fc97c7c0cba964124bf6b0af229395f1f6d1feed05b3d0',
};

const MAX_WATCH = 2; // a Twitch só conta tempo assistido em 2 lives ao mesmo tempo, por conta
const WATCH_CYCLE = 20 * 1000; // cada live recebe um "minuto assistido" a cada 20 s, como no miner original
const CLAIM_INTERVAL = 60 * 1000;
const OFFLINE_INTERVAL = 10 * 60 * 1000; // saldo de canal offline quase não muda, então é lido menos vezes
const SITE_INTERVAL = 60 * 60 * 1000;
const STREAK_MS = 7 * 60 * 1000; // assistir uns minutos de cada live garante a sequência (watch streak), que dá +300 a +450 pontos

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lastUrl = (text) => text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).at(-1);

// O endereço que recebe os "minutos assistidos" e a versão do site ficam na página da Twitch; valem para todas as contas.
const site = { at: 0, spadeUrl: 'https://spade.twitch.tv/track', clientVersion: 'ef928475-9403-42f2-8a34-55784bd08e16' };

async function updateSite() {
  if (Date.now() - site.at < SITE_INTERVAL) return;
  site.at = Date.now();
  const page = await (await fetch('https://www.twitch.tv/', { headers: { 'User-Agent': PAGE_UA } })).text();
  const version = page.match(/window\.__twilightBuildID\s*=\s*"([0-9a-fA-F-]{36})"/)?.[1];
  if (version) site.clientVersion = version;
  const settingsUrl = page.match(/https:\/\/(?:static\.twitchcdn\.net|assets\.twitch\.tv)\/config\/settings.*?\.js/)?.[0];
  if (!settingsUrl) return;
  const settings = await (await fetch(settingsUrl, { headers: { 'User-Agent': PAGE_UA } })).text();
  const spade = settings.match(/"spade_url":"(.*?)"/)?.[1];
  if (spade) site.spadeUrl = spade;
}

// Uma conta de pontos: escolhe as próprias lives pelos próprios saldos.
class PointsAccount {
  constructor(account, log) {
    this.account = account; // objeto salvo em points.json
    this.baseLog = log;
    this.live = []; // [{ name, channelId, broadcastId }] na ordem da lista de canais oficiais
    this.all = []; // todos os canais oficiais, ao vivo ou não
    this.channels = new Map(); // canal -> { balance, startBalance, claims, watchedMs, broadcastId, error, checkedAt }
    this.watching = [];
    this.refreshing = null;
    this.stopped = false;
    this.sessionId = crypto.randomBytes(16).toString('hex');
  }

  log(msg) {
    this.baseLog(`Pontos (${this.account.login}): ${msg}`);
  }

  get active() {
    return !this.stopped && !!this.account.accessToken && !this.account.needsRelink;
  }

  start() {
    // Já lê os saldos ao abrir, para escolher as lives certas desde o começo.
    const check = () => this.checkBonuses().catch((err) => this.log(`erro ao checar bônus (${err.message})`));
    check();
    this.timer = setInterval(check, CLAIM_INTERVAL);
    this.watchLoop();
  }

  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    this.watching = [];
  }

  // Lives oficiais no ar agora: [{ name, channelId, broadcastId }]; `all`: todos os canais oficiais.
  setLive(list, all) {
    this.live = list;
    this.all = all;
    for (const { name, broadcastId } of list) {
      const ch = this.channel(name);
      // Live nova: zera o tempo assistido, para a sequência dela contar.
      if (ch.broadcastId !== broadcastId) Object.assign(ch, { broadcastId, watchedMs: 0 });
    }
  }

  channel(name) {
    if (!this.channels.has(name)) this.channels.set(name, { balance: null, startBalance: null, claims: 0, watchedMs: 0, broadcastId: null, error: null, checkedAt: 0 });
    return this.channels.get(name);
  }

  // A sequência já foi garantida nessa live? Fica salvo em points.json, para reiniciar o painel não assistir tudo de novo.
  streakDone(live) {
    return (this.account.streakDone ?? []).includes(live.broadcastId);
  }

  markStreak(live) {
    this.account.streakDone = [...(this.account.streakDone ?? []), live.broadcastId].slice(-100);
    savePoints();
  }

  // Primeiro as lives que ainda não garantiram a sequência (uns minutos bastam), depois as com mais pontos.
  // Dentro de cada grupo, mais pontos primeiro; saldo ainda desconhecido vai por último, na ordem da lista de canais.
  pickTargets() {
    const balance = (l) => this.channel(l.name).balance ?? -1;
    const sorted = [...this.live].sort((a, b) => balance(b) - balance(a));
    const streak = sorted.filter((l) => !this.streakDone(l));
    return [...streak, ...sorted.filter((l) => !streak.includes(l))].slice(0, MAX_WATCH);
  }

  // Login novo da mesma conta (vincular de novo).
  updateTokens(tokens, login) {
    Object.assign(this.account, { login, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, needsRelink: false });
    savePoints();
  }

  // O refresh token só vale uma vez, então renovações simultâneas dividem a promessa,
  // e só 400/401 (refreshToken retorna null) marcam a conta para vincular de novo. Erro de rede só lança.
  ensureFresh(force = false) {
    if (!this.active) return Promise.resolve(false);
    this.refreshing ??= this.checkToken(force).finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  async checkToken(force) {
    const info = force ? null : await validate(this.account.accessToken);
    if (info && (info.expires_in === 0 || info.expires_in > 3600)) return true; // 0 = token que não expira
    if (!this.account.refreshToken) {
      if (info) return true;
      return this.markRelink();
    }
    const tokens = await refreshToken(CLIENT_ID, this.account.refreshToken);
    if (!tokens) return this.markRelink();
    this.account.accessToken = tokens.access_token;
    this.account.refreshToken = tokens.refresh_token ?? this.account.refreshToken;
    savePoints();
    this.log('token renovado');
    return true;
  }

  markRelink() {
    this.log('não deu para renovar o token, vincule a conta de novo no painel');
    this.account.needsRelink = true;
    savePoints();
    this.watching = [];
    return false;
  }

  // ---------- Twitch ----------

  async gql(operationName, variables, retry = true) {
    const res = await fetch(GQL_URL, {
      method: 'POST',
      headers: {
        Authorization: `OAuth ${this.account.accessToken}`,
        'Client-Id': CLIENT_ID,
        'Client-Session-Id': this.sessionId,
        'Client-Version': site.clientVersion,
        'User-Agent': TV_UA,
        'X-Device-Id': this.account.deviceId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ operationName, variables, extensions: { persistedQuery: { version: 1, sha256Hash: HASHES[operationName] } } }),
    });
    const body = await res.json().catch(() => ({}));
    const unauthorized = res.status === 401 || body.error === 'Unauthorized' || body.errors?.some((e) => /unauthenticated|unauthorized/i.test(e.message));
    if (unauthorized) {
      if (retry && (await this.ensureFresh(true))) return this.gql(operationName, variables, false);
      throw new Error('token recusado');
    }
    if (body.errors?.length) throw new Error(body.errors[0].message);
    if (!res.ok || !body.data) throw new Error(`Twitch respondeu ${res.status}`);
    return body.data;
  }

  // Um "minuto assistido": pega um pedaço do vídeo na qualidade mais baixa e avisa a Twitch, como o player faz.
  async sendMinute(live) {
    const data = await this.gql('PlaybackAccessToken', {
      login: live.name, isLive: true, isVod: false, vodID: '', playerType: 'site', platform: 'web',
    });
    const { signature, value } = data.streamPlaybackAccessToken ?? {};
    if (!signature || !value) throw new Error('a Twitch não liberou o vídeo');

    const headers = { 'User-Agent': TV_UA };
    const master = await fetch(`https://usher.ttvnw.net/api/channel/hls/${live.name}.m3u8?${new URLSearchParams({ sig: signature, token: value })}`, { headers });
    if (!master.ok) throw new Error(`lista de qualidades respondeu ${master.status}`);
    const playlistUrl = lastUrl(await master.text());
    const playlist = await fetch(playlistUrl, { headers });
    if (!playlist.ok) throw new Error(`lista de vídeo respondeu ${playlist.status}`);
    const segment = await fetch(lastUrl(await playlist.text()), { method: 'HEAD', headers });
    if (!segment.ok) throw new Error(`pedaço do vídeo respondeu ${segment.status}`);

    const event = [{
      event: 'minute-watched',
      properties: { channel_id: live.channelId, broadcast_id: live.broadcastId, player: 'site', user_id: this.account.userId, live: true, channel: live.name },
    }];
    const res = await fetch(site.spadeUrl, {
      method: 'POST',
      headers,
      body: new URLSearchParams({ data: Buffer.from(JSON.stringify(event)).toString('base64') }),
    });
    if (res.status !== 204) throw new Error(`a Twitch respondeu ${res.status} ao minuto assistido`);
  }

  async watchLoop() {
    while (!this.stopped) {
      const targets = this.active ? this.pickTargets() : [];
      const names = targets.map((t) => t.name);
      if (names.join() !== this.watching.join()) {
        if (names.length) this.log(`assistindo ${names.map((n) => `#${n}`).join(' e ')}`);
        else if (this.watching.length) this.log('nenhuma live oficial para assistir agora');
      }
      // Erro de uma live que saiu da lista (ex.: acabou) não vale mais.
      for (const name of this.watching) if (!names.includes(name)) this.channel(name).error = null;
      this.watching = names;
      if (!targets.length) {
        await sleep(WATCH_CYCLE);
        continue;
      }
      await updateSite().catch((err) => this.log(`erro ao ler a página da Twitch (${err.message})`));
      for (const live of targets) {
        if (this.stopped) return;
        const started = Date.now();
        const ch = this.channel(live.name);
        try {
          await this.sendMinute(live);
          ch.watchedMs += WATCH_CYCLE;
          if (ch.watchedMs >= STREAK_MS && !this.streakDone(live)) this.markStreak(live);
          if (ch.error) this.log(`#${live.name} voltou a contar`);
          ch.error = null;
        } catch (err) {
          // Loga só quando o erro muda, para não encher a janela a cada 20 s.
          if (ch.error !== err.message) this.log(`#${live.name} não contou (${err.message})`);
          ch.error = err.message;
        }
        await sleep(Math.max(0, started + WATCH_CYCLE / targets.length - Date.now()));
      }
    }
  }

  // Atualiza o saldo dos canais oficiais (os offline a cada 10 min) e pega o bônus (o baú) quando ele aparece.
  async checkBonuses() {
    if (!this.active) return;
    for (const name of this.all) {
      const live = this.live.find((l) => l.name === name);
      const ch = this.channel(name);
      if (!live && Date.now() - ch.checkedAt < OFFLINE_INTERVAL) continue;
      ch.checkedAt = Date.now();
      let points, channelId;
      try {
        const data = await this.gql('ChannelPointsContext', { channelLogin: name });
        points = data.community?.channel?.self?.communityPoints;
        channelId = data.community?.channel?.id;
      } catch (err) {
        if (!this.active) return;
        this.log(`erro ao ver os pontos de #${name} (${err.message})`);
        continue;
      }
      if (!points) continue;
      ch.balance = points.balance;
      ch.startBalance ??= points.balance;
      if (!points.availableClaim) continue;
      try {
        await this.gql('ClaimCommunityPoints', { input: { channelID: live?.channelId ?? channelId, claimID: points.availableClaim.id } });
        ch.claims++;
        this.log(`bônus pego em #${name}`);
      } catch (err) {
        this.log(`não deu para pegar o bônus em #${name} (${err.message})`);
      }
    }
  }

  state() {
    const live = new Set(this.live.map((l) => l.name));
    return {
      login: this.account.login,
      needsRelink: !!this.account.needsRelink,
      watching: this.watching,
      // Todos os canais oficiais; balance fica null até a primeira leitura.
      channels: this.all.map((name) => {
        const c = this.channel(name);
        return {
          name,
          live: live.has(name),
          watching: this.watching.includes(name),
          balance: c.balance,
          gained: c.balance === null ? 0 : Math.max(0, c.balance - c.startBalance), // gastar pontos não conta como perda
          claims: c.claims,
          error: c.error,
        };
      }),
    };
  }
}

// Todas as contas de pontos + o vínculo por código (um de cada vez).
export class PointsMiner {
  constructor({ log }) {
    this.log = log;
    this.pendingLink = null; // { userCode, uri, error, cancelled }
    this.live = [];
    this.all = [];
    this.started = false;
    this.accounts = pointsAccounts.map((a) => new PointsAccount(a, log));
  }

  start() {
    this.started = true;
    for (const a of this.accounts) a.start();
  }

  setLive(list, all) {
    this.live = list;
    this.all = all;
    for (const a of this.accounts) a.setLive(list, all);
  }

  ensureFresh() {
    return Promise.all(this.accounts.map((a) => a.ensureFresh().catch((err) => a.log(`erro ao checar token (${err.message})`))));
  }

  async startLink() {
    if (this.pendingLink && !this.pendingLink.error) throw new Error('Já existe um vínculo em andamento');
    const flow = await startDeviceFlow(CLIENT_ID, SCOPES);
    const link = { userCode: flow.user_code, uri: flow.verification_uri };
    this.pendingLink = link;

    waitDeviceToken(CLIENT_ID, flow, () => link.cancelled, SCOPES)
      .then(async (tokens) => {
        const info = await validate(tokens.access_token);
        const existing = this.accounts.find((a) => a.account.userId === info.user_id);
        if (existing) {
          // Vincular de novo uma conta que já está aqui: só troca os tokens.
          existing.updateTokens(tokens, info.login);
          existing.log('vinculada de novo');
        } else {
          if (this.accounts.length >= MAX_ACCOUNTS) throw new Error(`Limite de ${MAX_ACCOUNTS} contas atingido`);
          const account = {
            login: info.login,
            userId: info.user_id,
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            deviceId: crypto.randomBytes(16).toString('hex'),
          };
          pointsAccounts.push(account);
          savePoints();
          const miner = new PointsAccount(account, this.log);
          this.accounts.push(miner);
          miner.setLive(this.live, this.all);
          if (this.started) miner.start();
          miner.log('vinculada');
        }
        if (this.pendingLink === link) this.pendingLink = null;
      })
      .catch((err) => {
        if (this.pendingLink === link) this.pendingLink = link.cancelled ? null : { ...link, error: err.message };
      });
  }

  cancelLink() {
    if (this.pendingLink) this.pendingLink.cancelled = true;
    this.pendingLink = null;
  }

  unlink(login) {
    const miner = this.accounts.find((a) => a.account.login === login);
    if (!miner) throw new Error('Conta não encontrada');
    miner.stop();
    if (miner.account.accessToken) revoke(CLIENT_ID, miner.account.accessToken);
    miner.log('desvinculada');
    this.accounts.splice(this.accounts.indexOf(miner), 1);
    pointsAccounts.splice(pointsAccounts.indexOf(miner.account), 1);
    savePoints();
  }

  state() {
    return {
      max: MAX_ACCOUNTS,
      pendingLink: this.pendingLink && { userCode: this.pendingLink.userCode, uri: this.pendingLink.uri, error: this.pendingLink.error },
      accounts: this.accounts.map((a) => a.state()),
    };
  }
}
