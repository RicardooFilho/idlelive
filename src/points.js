// Pontos do canal (Twitch): até 4 contas, cada uma "assiste" até 2 lives dos canais oficiais e pega o bônus de pontos sozinha.
// Baseado no Twitch Channel Points Miner v2 (github.com/rdavydov/Twitch-Channel-Points-Miner-v2).
// Usa a API interna (GQL) da Twitch, que só aceita tokens dos apps da própria Twitch, por isso o login é o do app de TV.
import crypto from 'node:crypto';
import { startDeviceFlow, waitDeviceToken, refreshToken, validate, revoke, isNetworkError, GQL_URL, TV_CLIENT_ID as CLIENT_ID } from './twitch.js';
import { pointsAccounts, savePoints, MAX_ACCOUNTS } from './store.js';
import { recordPoints } from './stats.js';

const SCOPES = 'channel_read chat:read user_blocks_edit user_blocks_read user_follows_edit user_read';
const TV_UA = 'Mozilla/5.0 (Linux; Android 7.1; Smart Box C1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36';
const PAGE_UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:85.0) Gecko/20100101 Firefox/85.0';
// Consultas salvas da GQL. Se a Twitch trocar alguma, o log mostra "PersistedQueryNotFound" e o hash precisa ser atualizado.
const HASHES = {
  PlaybackAccessToken: 'ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9',
  ChannelPointsContext: '7fe050e3761eb2cf258d70ee1a21cbd76fa8cf3d7e7b12fc437e7029d446b5e3',
  ClaimCommunityPoints: '46aaeebe02c99afdf4fc97c7c0cba964124bf6b0af229395f1f6d1feed05b3d0',
  CommunityMomentCallout_Claim: 'e2d67415aead910f7f9ceb45a77b750a1e1d9622c936d832328a0689e054db62',
  JoinRaid: 'c6a332a86d1087fbbb1a8623aa01bd1313d2386e7c63be60fdb2d1901f01a4ae',
};

const MAX_WATCH = 2; // a Twitch só conta tempo assistido em 2 lives ao mesmo tempo, por conta
const WATCH_CYCLE = 20 * 1000; // cada live recebe um "minuto assistido" a cada ~20 s, como no miner original
const CHECK_TICK = 60 * 1000; // de quanto em quanto tempo vê se algum saldo precisa ser lido
const CHECKS_PER_TICK = 4; // poucas consultas por vez, como um navegador, em vez de todas de uma vez

// Para parecer uma pessoa e não um robô: tempos aleatórios em vez de exatos, e menos consultas.
// Um navegador lê o saldo quando abre a live e depois só recebe avisos; por isso, com a conexão em tempo real,
// o saldo das lives assistidas é lido a cada 5–10 min e o resto a cada ~30 min.
const CHECK_WATCHING = [5 * 60 * 1000, 10 * 60 * 1000];
const CHECK_WATCHING_NO_EVENTS = [50 * 1000, 70 * 1000]; // sem a conexão em tempo real, o baú só aparece consultando
const CHECK_OTHERS = [25 * 60 * 1000, 35 * 60 * 1000];
const CLAIM_DELAY = [5 * 1000, 40 * 1000]; // espera antes de pegar baú ou Momento, como alguém que vê e clica
const SWITCH_DELAY = [5 * 1000, 45 * 1000]; // espera antes de trocar de live
const START_DELAY = [0, 90 * 1000]; // cada conta começa num momento diferente

// Descanso diário (horário de Brasília): as contas param como quem vai dormir.
// Cada conta dorme e acorda até 20 min antes ou depois, num horário que muda todo dia.
// 3 horas: quebra o padrão de 24 h por dia perdendo só ~12% dos pontos (das 4h às 10h ainda tem parceiro ao vivo, ex.: cogu e guaxilol1).
const REST = { start: 5 * 60, end: 8 * 60, jitter: 20 }; // em minutos do dia
const TIMEZONE = 'America/Sao_Paulo';
const SITE_INTERVAL = 60 * 60 * 1000;
const STREAK_MS = 7 * 60 * 1000; // assistir uns minutos de cada live garante a sequência (watch streak), que dá +300 a +450 pontos
const GQL_FAILS_ALERT = 3; // falhas seguidas na API da Twitch antes de avisar no painel
const RAID_STAY = 5 * 60 * 1000; // depois de entrar numa raid, fica uns minutos na live que recebeu, como quem foi junto

const PUBSUB_URL = 'wss://pubsub-edge.twitch.tv/v1';
const PUBSUB_PING = 4 * 60 * 1000; // a Twitch pede um PING a cada 5 min no máximo
const PUBSUB_DOWN_ALERT = 2 * 60 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const random = ([min, max]) => min + Math.random() * (max - min);

// Minutos do dia e data (AAAA-MM-DD) no horário de Brasília, seja qual for o fuso do PC.
function brasiliaNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { minutes: Number(parts.hour) * 60 + Number(parts.minute), day: `${parts.year}-${parts.month}-${parts.day}` };
}

// Número entre -jitter e +jitter, fixo para a mesma conta no mesmo dia.
const dailyOffset = (seed) => (crypto.createHash('sha256').update(seed).digest().readUInt16BE(0) % (2 * REST.jitter + 1)) - REST.jitter;
const clock = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
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

// Conexão em tempo real (PubSub) da Twitch: avisos de Momento, raid, baú e pontos ganhos.
// Uma conexão por conta, como um navegador logado faz (misturar contas numa conexão só seria um sinal estranho para a Twitch).
// Precisa do WebSocket do Node 22+. Sem ele, o resto continua funcionando, só sem Momentos, raids e o detalhe dos pontos.
class PubSub {
  static supported = typeof WebSocket !== 'undefined';

  constructor({ log, onMessage }) {
    this.log = log;
    this.onMessage = onMessage;
    this.topics = new Map(); // tópico -> função que devolve o token (ou null nos tópicos públicos)
    this.failed = new Map(); // tópico -> erro da Twitch ao escutar
    this.ws = null;
    this.connected = false;
    this.downSince = Date.now();
    this.retryDelay = 1000;
    this.closed = false;
  }

  start() {
    if (!PubSub.supported || (this.ws && !this.closed)) return;
    this.closed = false;
    this.downSince = Date.now();
    this.connect();
  }

  // Fecha (desvincular ou descanso). start() abre de novo e escuta os mesmos tópicos.
  close() {
    this.closed = true;
    this.connected = false;
    this.ws?.close();
  }

  connect() {
    const ws = new WebSocket(PUBSUB_URL);
    this.ws = ws;
    let pinger;
    let pongTimer;

    ws.onopen = () => {
      this.connected = true;
      this.downSince = null;
      this.retryDelay = 1000;
      for (const topic of this.topics.keys()) this.sendListen(topic);
      // Sem PONG em 10 s, a conexão está morta: derruba para reconectar.
      pinger = setInterval(() => {
        this.send({ type: 'PING' });
        pongTimer = setTimeout(() => ws.close(), 10 * 1000);
      }, PUBSUB_PING);
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.type === 'PONG') clearTimeout(pongTimer);
      else if (msg.type === 'RECONNECT') ws.close();
      else if (msg.type === 'RESPONSE') {
        // O nonce é o próprio tópico, para saber qual deu erro.
        if (msg.error) this.failed.set(msg.nonce, msg.error);
        else this.failed.delete(msg.nonce);
      } else if (msg.type === 'MESSAGE') {
        try {
          this.onMessage(msg.data.topic, JSON.parse(msg.data.message));
        } catch (err) {
          this.log(`erro ao tratar aviso da Twitch (${err.message})`);
        }
      }
    };

    ws.onclose = () => {
      clearInterval(pinger);
      clearTimeout(pongTimer);
      if (this.ws !== ws || this.closed) return;
      if (this.connected) this.log(`conexão em tempo real caiu, reconectando em ${this.retryDelay / 1000}s`);
      this.connected = false;
      this.downSince ??= Date.now();
      setTimeout(() => this.connect(), this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, 60 * 1000);
    };
    ws.onerror = () => {}; // o onclose cuida da reconexão
  }

  send(data) {
    if (this.connected) this.ws.send(JSON.stringify(data));
  }

  sendListen(topic) {
    const token = this.topics.get(topic)?.();
    this.send({ type: 'LISTEN', nonce: topic, data: { topics: [topic], ...(token ? { auth_token: token } : {}) } });
  }

  listen(topic, getToken = () => null) {
    if (this.topics.has(topic)) return;
    this.topics.set(topic, getToken);
    this.sendListen(topic);
  }

  unlisten(topic) {
    if (!this.topics.delete(topic)) return;
    this.failed.delete(topic);
    this.send({ type: 'UNLISTEN', nonce: topic, data: { topics: [topic] } });
  }

  // Avisos para o painel: conexão caída há um tempo.
  get down() {
    return PubSub.supported && !this.closed && !this.connected && this.downSince !== null && Date.now() - this.downSince > PUBSUB_DOWN_ALERT;
  }
}

// Uma conta de pontos: escolhe as próprias lives pelos próprios saldos.
class PointsAccount {
  constructor(account, { log, channelNames }) {
    this.account = account; // objeto salvo em points.json
    this.baseLog = log;
    this.pubsub = new PubSub({ log: (msg) => this.log(msg), onMessage: (topic, msg) => this.onMessage(topic, msg) });
    this.channelNames = channelNames; // id do canal -> nome, compartilhado entre as contas
    this.raidTarget = null; // { name, until }: live que recebeu uma raid em que a conta entrou
    this.joinedRaids = new Set();
    this.live = []; // [{ name, channelId, broadcastId }] na ordem da lista de canais oficiais
    this.all = []; // todos os canais oficiais, ao vivo ou não
    this.channels = new Map(); // canal -> { balance, startBalance, claims, moments, watchedMs, broadcastId, error, nextCheck }
    this.claiming = new Set(); // baús e Momentos esperando para serem pegos
    this.wasResting = false;
    this.checking = false;
    this.watching = [];
    this.refreshing = null;
    this.stopped = false;
    this.gqlFails = 0;
    this.gqlError = null;
    this.netFails = 0; // falhas seguidas por falta de internet (separadas das recusas da Twitch)
    this.sessionId = crypto.randomBytes(16).toString('hex');
  }

  log(msg) {
    this.baseLog(`Pontos (${this.account.login}): ${msg}`);
  }

  get active() {
    return !this.stopped && !!this.account.accessToken && !this.account.needsRelink;
  }

  // Horário de descanso de hoje desta conta, em minutos do dia (Brasília).
  restWindow() {
    const { day } = brasiliaNow();
    return {
      start: REST.start + dailyOffset(`${this.account.userId}:${day}:start`),
      end: REST.end + dailyOffset(`${this.account.userId}:${day}:end`),
    };
  }

  get resting() {
    const { minutes } = brasiliaNow();
    const { start, end } = this.restWindow();
    return minutes >= start && minutes < end;
  }

  // Está farmando agora: conta ativa e fora do descanso.
  get farming() {
    return this.active && !this.resting;
  }

  get userTopic() {
    return `community-points-user-v1.${this.account.userId}`;
  }

  // Os pontos ganhos chegam pela conexão em tempo real? Se não, o histórico usa a diferença de saldo.
  get liveEvents() {
    return this.pubsub.connected && this.pubsub.topics.has(this.userTopic) && !this.pubsub.failed.has(this.userTopic);
  }

  async start() {
    this.pubsub.listen(this.userTopic, () => this.account.accessToken);
    // Cada conta começa num momento diferente, para não agirem todas juntas.
    await sleep(random(START_DELAY));
    if (this.stopped) return;
    if (!this.resting) this.pubsub.start();
    const check = () => this.checkBonuses().catch((err) => this.log(`erro ao checar bônus (${err.message})`));
    check();
    this.timer = setInterval(check, CHECK_TICK);
    this.watchLoop();
  }

  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    this.pubsub.close();
    this.watching = [];
  }

  // Lives oficiais no ar agora: [{ name, channelId, broadcastId }]; `all`: todos os canais oficiais.
  setLive(list, all) {
    this.live = list;
    this.all = all;
    for (const { name, broadcastId } of list) {
      const ch = this.channel(name);
      // Live nova: zera o tempo assistido, para a sequência dela contar.
      if (ch.broadcastId !== broadcastId) Object.assign(ch, { broadcastId, watchedMs: 0, nextCheck: 0 });
    }
    // Momentos e raids só acontecem com a live no ar: escuta só os canais ao vivo.
    const wanted = new Set(list.filter((l) => l.channelId).flatMap((l) => [`community-moments-channel-v1.${l.channelId}`, `raid.${l.channelId}`]));
    for (const topic of this.pubsub.topics.keys()) {
      if ((topic.startsWith('community-moments-channel-v1.') || topic.startsWith('raid.')) && !wanted.has(topic)) this.pubsub.unlisten(topic);
    }
    for (const topic of wanted) this.pubsub.listen(topic);
  }

  channel(name) {
    if (!this.channels.has(name)) {
      this.channels.set(name, { balance: null, startBalance: null, claims: 0, moments: 0, watchedMs: 0, broadcastId: null, error: null, nextCheck: 0 });
    }
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
  // Logo depois de uma raid, a live que recebeu vem antes de tudo.
  pickTargets() {
    const balance = (l) => this.channel(l.name).balance ?? -1;
    const sorted = [...this.live].sort((a, b) => balance(b) - balance(a));
    if (this.raidTarget && Date.now() > this.raidTarget.until) this.raidTarget = null;
    const raid = sorted.filter((l) => l.name === this.raidTarget?.name);
    const streak = sorted.filter((l) => !raid.includes(l) && !this.streakDone(l));
    return [...raid, ...streak, ...sorted.filter((l) => !raid.includes(l) && !streak.includes(l))].slice(0, MAX_WATCH);
  }

  // Login novo da mesma conta (vincular de novo).
  updateTokens(tokens, login) {
    Object.assign(this.account, { login, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, needsRelink: false });
    savePoints();
    // Escuta de novo com o token novo.
    this.pubsub.unlisten(this.userTopic);
    this.pubsub.listen(this.userTopic, () => this.account.accessToken);
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
    try {
      const data = await this.rawGql(operationName, variables, retry);
      this.gqlFails = 0;
      this.gqlError = null;
      this.netFails = 0;
      return data;
    } catch (err) {
      if (isNetworkError(err)) this.netFails++;
      else {
        this.gqlFails++;
        this.gqlError = err.message;
      }
      throw err;
    }
  }

  async rawGql(operationName, variables, retry) {
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
      if (retry && (await this.ensureFresh(true))) return this.rawGql(operationName, variables, false);
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

  // Entra e sai do descanso: para tudo e fecha a conexão em tempo real, como um navegador fechado.
  updateRest() {
    const resting = this.active && this.resting;
    if (resting === this.wasResting) return;
    this.wasResting = resting;
    if (resting) {
      this.log(`descansando até ${clock(this.restWindow().end)} (horário de Brasília)`);
      this.pubsub.close();
    } else {
      this.log('voltou do descanso');
      this.pubsub.start();
    }
  }

  async watchLoop() {
    while (!this.stopped) {
      this.updateRest();
      const targets = this.farming ? this.pickTargets() : [];
      const names = targets.map((t) => t.name);
      if (names.join() !== this.watching.join()) {
        // Antes de trocar de live, espera um pouco, como alguém que demora para clicar.
        if (this.watching.length && names.length) {
          await sleep(random(SWITCH_DELAY));
          if (this.stopped) return;
        }
        if (names.length) this.log(`assistindo ${names.map((n) => `#${n}`).join(' e ')}`);
        else if (this.watching.length && !this.wasResting) this.log('nenhuma live oficial para assistir agora');
      }
      // Erro de uma live que saiu da lista (ex.: acabou) não vale mais.
      for (const name of this.watching) if (!names.includes(name)) this.channel(name).error = null;
      // Live que a conta acabou de abrir: lê o saldo logo, como o navegador faz ao abrir a página.
      for (const name of names) if (!this.watching.includes(name)) this.channel(name).nextCheck = 0;
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
        // Intervalo com uma variação aleatória de até 15%, para não ser sempre exato.
        await sleep(Math.max(0, started + (WATCH_CYCLE / targets.length) * random([0.85, 1.15]) - Date.now()));
      }
    }
  }

  // De quanto em quanto tempo ler o saldo deste canal.
  checkInterval(name) {
    if (this.watching.includes(name)) return random(this.liveEvents ? CHECK_WATCHING : CHECK_WATCHING_NO_EVENTS);
    return random(CHECK_OTHERS);
  }

  // Lê os saldos que estão na hora (poucos por vez) e pega o baú quando ele aparece.
  // Ordem: lives assistidas, depois as outras ao vivo, depois as offline; saldo nunca lido vem antes.
  async checkBonuses() {
    if (!this.farming || this.checking) return;
    this.checking = true;
    try {
      const now = Date.now();
      const isLive = (name) => this.live.some((l) => l.name === name);
      const rank = (name) => (this.watching.includes(name) ? 0 : isLive(name) ? 1 : 2) * 2 + (this.channel(name).balance === null ? 0 : 1);
      const due = this.all.filter((name) => this.channel(name).nextCheck <= now).sort((a, b) => rank(a) - rank(b)).slice(0, CHECKS_PER_TICK);
      for (const name of due) {
        if (!this.farming) return;
        await this.checkChannel(name);
        await sleep(random([1000, 4000]));
      }
    } finally {
      this.checking = false;
    }
  }

  async checkChannel(name) {
    const live = this.live.find((l) => l.name === name);
    const ch = this.channel(name);
    ch.nextCheck = Date.now() + this.checkInterval(name);
    let points, channelId;
    try {
      const data = await this.gql('ChannelPointsContext', { channelLogin: name });
      points = data.community?.channel?.self?.communityPoints;
      channelId = data.community?.channel?.id;
    } catch (err) {
      if (!this.active) return;
      this.log(`erro ao ver os pontos de #${name} (${err.message})`);
      return;
    }
    if (channelId) this.channelNames.set(channelId, name);
    if (!points) return;
    // Sem a conexão em tempo real, o histórico anota a diferença de saldo (sem saber o motivo).
    if (!this.liveEvents && ch.balance !== null && points.balance > ch.balance) {
      recordPoints(this.account.login, 'OTHER', points.balance - ch.balance);
    }
    ch.balance = points.balance;
    ch.startBalance ??= points.balance;
    if (points.availableClaim) this.claimBonus(name, live?.channelId ?? channelId, points.availableClaim.id);
  }

  // Espera um tempo aleatório antes de pegar (baú ou Momento). Cada um é pego uma vez só, mesmo se avisado duas vezes.
  async humanPause(id) {
    if (this.claiming.has(id)) return false;
    this.claiming.add(id);
    await sleep(random(CLAIM_DELAY));
    this.claiming.delete(id);
    return this.farming;
  }

  async claimBonus(name, channelId, claimId) {
    if (!(await this.humanPause(claimId))) return;
    try {
      await this.gql('ClaimCommunityPoints', { input: { channelID: channelId, claimID: claimId } });
      this.channel(name).claims++;
      this.log(`bônus pego em #${name}`);
    } catch (err) {
      this.log(`não deu para pegar o bônus em #${name} (${err.message})`);
    }
  }

  async claimMoment(name, momentId) {
    if (!this.farming || !(await this.humanPause(momentId))) return;
    try {
      await this.gql('CommunityMomentCallout_Claim', { input: { momentID: momentId } });
      this.channel(name).moments++;
      this.log(`Momento pego em #${name}`);
    } catch (err) {
      this.log(`não deu para pegar o Momento em #${name} (${err.message})`);
    }
  }

  // Raid de um canal oficial: só entra se ela vai para outro canal oficial e se a conta estava assistindo quem fez a raid.
  async joinRaid(fromId, raid) {
    const from = this.channelNames.get(fromId);
    const to = raid?.target_login?.toLowerCase();
    if (!this.farming || !raid?.id || this.joinedRaids.has(raid.id)) return;
    if (!from || !this.watching.includes(from) || !this.all.includes(to) || to === from) return;
    this.joinedRaids.add(raid.id);
    try {
      await this.gql('JoinRaid', { input: { raidID: raid.id } });
      this.raidTarget = { name: to, until: Date.now() + RAID_STAY };
      this.log(`entrou na raid de #${from} para #${to}`);
    } catch (err) {
      this.log(`não deu para entrar na raid de #${from} para #${to} (${err.message})`);
    }
  }

  onMessage(topic, msg) {
    const [kind, id] = topic.split('.');
    if (kind === 'community-points-user-v1') this.onUserMessage(msg);
    else if (kind === 'community-moments-channel-v1' && msg.type === 'active' && msg.data?.moment_id) {
      this.claimMoment(this.channelNames.get(id) ?? id, msg.data.moment_id);
    } else if (kind === 'raid' && msg.type === 'raid_update_v2') this.joinRaid(id, msg.raid);
  }

  // Aviso em tempo real da Twitch sobre esta conta.
  onUserMessage(msg) {
    const data = msg.data ?? {};
    const channelId = data.channel_id ?? data.claim?.channel_id ?? data.balance?.channel_id;
    const name = this.channelNames.get(channelId);
    if (msg.type === 'points-earned') {
      const { total_points: points, reason_code: reason } = data.point_gain ?? {};
      if (points) recordPoints(this.account.login, reason ?? 'OTHER', points);
      if (name && data.balance) {
        const ch = this.channel(name);
        ch.balance = data.balance.balance;
        ch.startBalance ??= ch.balance - points;
      }
    } else if (msg.type === 'claim-available' && name && data.claim?.id) {
      // Pega o baú assim que avisado (depois da espera de "pessoa"), sem esperar a próxima leitura de saldo.
      this.claimBonus(name, channelId, data.claim.id);
    }
  }

  // Sem internet: várias falhas de rede seguidas.
  get offline() {
    return this.netFails >= GQL_FAILS_ALERT;
  }

  // Problemas para mostrar no topo do painel. Sem internet, os avisos de Twitch e conexão caída ficam de fora:
  // o painel mostra um aviso só, de internet.
  alerts({ offline = false } = {}) {
    const who = this.account.login;
    if (this.account.needsRelink) return [{ variant: 'danger', text: `A conta ${who} precisa ser vinculada de novo (página Twitch).` }];
    const list = [];
    if (offline) return list;
    if (this.gqlFails >= GQL_FAILS_ALERT || /PersistedQueryNotFound/.test(this.gqlError ?? '')) {
      list.push({ variant: 'danger', text: `A Twitch está recusando os pedidos da conta ${who}: ${this.gqlError}. Os pontos dela podem não estar contando.` });
    }
    if (this.pubsub.down) {
      list.push({ variant: 'warning', text: `A conexão em tempo real da conta ${who} caiu e está tentando voltar. Momentos, raids e baús na hora ficam pausados (os baús ainda são pegos nas leituras de saldo).` });
    }
    if (this.pubsub.connected && this.pubsub.failed.has(this.userTopic)) {
      list.push({ variant: 'warning', text: `A Twitch não liberou os avisos em tempo real da conta ${who} (${this.pubsub.failed.get(this.userTopic)}). Baús continuam sendo pegos a cada minuto, mas o histórico fica sem o motivo dos pontos.` });
    }
    return list;
  }

  state() {
    const live = new Set(this.live.map((l) => l.name));
    return {
      login: this.account.login,
      needsRelink: !!this.account.needsRelink,
      resting: this.active && this.resting,
      restUntil: clock(this.restWindow().end),
      profile: this.account.profile ?? null,
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
          moments: c.moments,
          // Sequência da live atual já garantida (só faz sentido com o canal ao vivo).
          streak: live.has(name) && !!c.broadcastId && (this.account.streakDone ?? []).includes(c.broadcastId),
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
    this.channelNames = new Map(); // id do canal -> nome
    this.accounts = pointsAccounts.map((a) => this.makeAccount(a));
  }

  makeAccount(account) {
    return new PointsAccount(account, { log: this.log, channelNames: this.channelNames });
  }

  start() {
    this.started = true;
    if (!PubSub.supported) this.log('Pontos: este Node.js não tem WebSocket (precisa da versão 22 ou mais nova), então Momentos e raids ficam desligados');
    for (const a of this.accounts) a.start();
  }

  setLive(list, all) {
    this.live = list;
    this.all = all;
    for (const l of list) if (l.channelId) this.channelNames.set(l.channelId, l.name);
    for (const a of this.accounts) a.setLive(list, all);
  }

  ensureFresh() {
    return Promise.all(this.accounts.map((a) => a.ensureFresh().catch((err) => a.log(`erro ao checar token (${err.message})`))));
  }

  find(login) {
    const miner = this.accounts.find((a) => a.account.login === login);
    if (!miner) throw new Error('Conta não encontrada');
    return miner;
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
          const miner = this.makeAccount(account);
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
    const miner = this.find(login);
    miner.stop();
    if (miner.account.accessToken) revoke(CLIENT_ID, miner.account.accessToken);
    miner.log('desvinculada');
    this.accounts.splice(this.accounts.indexOf(miner), 1);
    pointsAccounts.splice(pointsAccounts.indexOf(miner.account), 1);
    savePoints();
  }

  // Perfil do navegador logado nesta conta da Twitch, usado pelo botão ▶ (null = navegador padrão).
  setProfile(login, profile) {
    this.find(login).account.profile = profile || null;
    savePoints();
  }

  profileOf(login) {
    return this.find(login).account.profile ?? null;
  }

  get offline() {
    return this.accounts.some((a) => a.offline);
  }

  alerts(options) {
    const list = this.accounts.flatMap((a) => a.alerts(options));
    if (this.accounts.length && !PubSub.supported) {
      list.push({ variant: 'warning', text: 'Atualize o Node.js para a versão 22 ou mais nova para pegar Momentos, entrar nas raids e ver o motivo dos pontos no histórico.' });
    }
    return list;
  }

  state() {
    return {
      max: MAX_ACCOUNTS,
      pendingLink: this.pendingLink && { userCode: this.pendingLink.userCode, uri: this.pendingLink.uri, error: this.pendingLink.error },
      accounts: this.accounts.map((a) => a.state()),
    };
  }
}
