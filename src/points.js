// Pontos do canal (Twitch): até 4 contas, cada uma "assiste" até 2 lives dos canais oficiais e pega o bônus de pontos sozinha.
// Baseado no Twitch Channel Points Miner v2 (github.com/rdavydov/Twitch-Channel-Points-Miner-v2).
// Usa a API interna (GQL) da Twitch, que só aceita tokens dos apps da própria Twitch, por isso o login é o do app de TV.
import crypto from 'node:crypto';
import { startDeviceFlow, waitDeviceToken, refreshToken, validate, revoke, isNetworkError, toReward, GQL_URL, CHANNEL_POINTS_HASH, TV_CLIENT_ID as CLIENT_ID } from './twitch.js';
import { pointsAccounts, savePoints, MAX_ACCOUNTS } from './store.js';
import { recordPoints } from './stats.js';
import { addEvent } from './events.js';
import { sleep, random, clock, restWindow, isResting, SWITCH_DELAY, START_DELAY, CHECK_OTHERS, CHECK_TICK, CHECKS_PER_TICK, FOLLOW_DELAY, FOLLOW_GAP } from './human.js';

const SCOPES = 'channel_read chat:read user_blocks_edit user_blocks_read user_follows_edit user_read';
const TV_UA = 'Mozilla/5.0 (Linux; Android 7.1; Smart Box C1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36';
const PAGE_UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:85.0) Gecko/20100101 Firefox/85.0';
// Consultas salvas da GQL. Se a Twitch trocar alguma, o log mostra "PersistedQueryNotFound" e o hash precisa ser atualizado.
const HASHES = {
  PlaybackAccessToken: 'ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9',
  ChannelPointsContext: CHANNEL_POINTS_HASH,
  ClaimCommunityPoints: '46aaeebe02c99afdf4fc97c7c0cba964124bf6b0af229395f1f6d1feed05b3d0',
  CommunityMomentCallout_Claim: 'e2d67415aead910f7f9ceb45a77b750a1e1d9622c936d832328a0689e054db62',
  JoinRaid: 'c6a332a86d1087fbbb1a8623aa01bd1313d2386e7c63be60fdb2d1901f01a4ae',
  FollowButton_FollowUser: '800e7346bdf7e5278a3c1d3f21b2b56e2639928f86815677a7126b093b2fdd08',
  RedeemCustomReward: 'd56249a7adb4978898ea3412e196688d4ac3cea1c0c2dfd65561d229ea5dcc42',
};

// Recusas do resgate que a Twitch devolve, em palavras simples. Código desconhecido aparece como veio.
const REDEEM_ERRORS = {
  NOT_ENOUGH_POINTS: 'pontos insuficientes',
  PROPERTIES_MISMATCH: 'o streamer mudou a recompensa; abra a loja de novo',
  DISABLED: 'a recompensa foi desativada',
  PAUSED: 'a recompensa está pausada',
  OUT_OF_STOCK: 'a recompensa esgotou',
  MAX_PER_STREAM: 'a recompensa atingiu o limite desta live',
  MAX_PER_USER_PER_STREAM: 'esta conta já resgatou o máximo permitido nesta live',
  GLOBAL_COOLDOWN: 'a recompensa está em tempo de espera',
  STREAM_NOT_LIVE: 'o canal precisa estar ao vivo',
  USER_BANNED: 'esta conta está banida do canal',
  FORBIDDEN: 'a Twitch não deixou esta conta resgatar',
  DUPLICATE_TRANSACTION: 'resgate repetido',
  TRANSACTION_IN_PROGRESS: 'já tem um resgate em andamento',
};
const REDEEM_TEXT_MAX = 200; // tamanho máximo do texto que algumas recompensas pedem

// Por que a conta não pode resgatar a recompensa agora (null = pode). Só inscritos fica para a Twitch dizer.
export function redeemProblem(reward, balance, text = '', now = Date.now()) {
  if (reward.paused) return 'a recompensa está pausada';
  if (!reward.inStock) return 'a recompensa esgotou';
  if (reward.cooldownUntil && Date.parse(reward.cooldownUntil) > now) return 'a recompensa está em tempo de espera';
  if (typeof balance !== 'number') return 'não deu para ler o saldo da conta';
  const missing = reward.cost - balance;
  if (missing > 0) return missing === 1 ? 'falta 1 ponto' : `faltam ${missing.toLocaleString('pt-BR')} pontos`;
  if (reward.inputRequired && !text.trim()) return 'esta recompensa pede um texto';
  if (text.length > REDEEM_TEXT_MAX) return `o texto passa de ${REDEEM_TEXT_MAX} letras`;
  return null;
}

// Saldo novo de um canal (o `ch` dos cards de pontos, na Twitch e na Kick). O saldo só cai quando a conta gasta
// (resgate, pelo painel ou fora dele): o saldo inicial desce junto, para o "+ganho" não cair com o resgate.
export function setBalance(ch, balance) {
  if (ch.balance !== null && ch.startBalance !== null && balance < ch.balance) ch.startBalance -= ch.balance - balance;
  ch.balance = balance;
  ch.startBalance ??= balance;
}

const MAX_WATCH = 2; // a Twitch só conta tempo assistido em 2 lives ao mesmo tempo, por conta
const WATCH_CYCLE = 20 * 1000; // cada live recebe um "minuto assistido" a cada ~20 s, como no miner original

// Para parecer uma pessoa e não um robô (o resto das travas fica em human.js).
// Um navegador lê o saldo quando abre a live e depois só recebe avisos; por isso, com a conexão em tempo real,
// o saldo das lives assistidas é lido a cada 5–10 min e o resto a cada ~30 min.
const CHECK_WATCHING = [5 * 60 * 1000, 10 * 60 * 1000];
const CHECK_WATCHING_NO_EVENTS = [50 * 1000, 70 * 1000]; // sem a conexão em tempo real, o baú só aparece consultando
const CLAIM_DELAY = [5 * 1000, 40 * 1000]; // espera antes de pegar baú ou Momento, como alguém que vê e clica
const SITE_INTERVAL = 60 * 60 * 1000;
const STREAK_MS = 7 * 60 * 1000; // assistir uns minutos de cada live garante a sequência (watch streak), que dá +300 a +450 pontos
const GQL_FAILS_ALERT = 3; // falhas seguidas na API da Twitch antes de avisar no painel
const NET_FAILS_REPORT = 2; // falhas de rede seguidas no "minuto assistido" de uma live antes de virar erro no painel
const RAID_STAY = 5 * 60 * 1000; // depois de entrar numa raid, fica uns minutos na live que recebeu, como quem foi junto

const PUBSUB_URL = 'wss://pubsub-edge.twitch.tv/v1';
const PUBSUB_PING = 4 * 60 * 1000; // a Twitch pede um PING a cada 5 min no máximo
const PUBSUB_DOWN_ALERT = 2 * 60 * 1000;
const STABLE_AFTER = 60 * 1000; // a espera entre reconexões só volta ao mínimo depois de a conexão ficar de pé esse tempo

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
    this.closed = true;
    this.reconnectTimer = null;
  }

  start() {
    if (!PubSub.supported || !this.closed) return;
    this.closed = false;
    this.downSince = Date.now();
    this.connect();
  }

  // Fecha (desvincular ou descanso). start() abre de novo e escuta os mesmos tópicos.
  // Cancela também a reconexão agendada, senão ela abriria uma conexão que ninguém fecha.
  close() {
    this.closed = true;
    this.connected = false;
    clearTimeout(this.reconnectTimer);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  connect() {
    if (this.closed) return;
    const ws = new WebSocket(PUBSUB_URL);
    this.ws = ws;
    let pinger;
    let pongTimer;
    let stableTimer;

    ws.onopen = () => {
      this.connected = true;
      this.downSince = null;
      // Se a Twitch derrubar logo depois de aceitar, a espera continua crescendo em vez de virar um laço rápido.
      stableTimer = setTimeout(() => (this.retryDelay = 1000), STABLE_AFTER);
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
      clearTimeout(stableTimer);
      if (this.ws !== ws || this.closed) return;
      if (this.connected) this.log(`conexão em tempo real caiu, reconectando em ${this.retryDelay / 1000}s`);
      this.connected = false;
      this.downSince ??= Date.now();
      this.reconnectTimer = setTimeout(() => this.connect(), this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, 2 * 60 * 1000);
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
export class PointsAccount {
  constructor(account, { log, channelNames }) {
    this.account = account; // objeto salvo em points.json
    this.baseLog = log;
    this.pubsub = new PubSub({ log: (msg) => this.log(msg), onMessage: (topic, msg) => this.onMessage(topic, msg) });
    this.channelNames = channelNames; // id do canal -> nome, compartilhado entre as contas
    this.raidTarget = null; // { name, until }: live que recebeu uma raid em que a conta entrou
    this.joinedRaids = new Set();
    this.live = []; // [{ name, channelId, broadcastId }] na ordem da lista de canais oficiais
    this.all = []; // todos os canais oficiais, ao vivo ou não
    this.channels = new Map(); // canal -> { balance, startBalance, claims, moments, watchedMs, broadcastId, error, fails, reported, nextCheck }
    this.claiming = new Set(); // baús e Momentos esperando para serem pegos
    this.followFailed = new Set(); // canais em que o follow falhou nesta sessão (tenta de novo quando o painel reiniciar)
    this.nextFollow = 0;
    this.followBusy = false;
    this.redeeming = false; // um resgate por vez, para dois cliques não gastarem duas vezes
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

  // Escreve na janela preta e anota na lista do topo do painel (good = baú, Momento, raid; bad = erro).
  report(kind, msg, channel = null) {
    this.log(msg);
    addEvent({ kind, platform: 'twitch', account: this.account.login, channel, text: msg });
  }

  get active() {
    return !this.stopped && !!this.account.accessToken && !this.account.needsRelink;
  }

  // Horário de descanso de hoje desta conta, em minutos do dia (Brasília).
  restWindow() {
    return restWindow(this.account.userId);
  }

  get resting() {
    return isResting(this.account.userId);
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
    if (this.active && !this.resting) this.pubsub.start();
    this.nextFollow = Date.now() + random(FOLLOW_DELAY);
    const check = () => {
      this.checkBonuses().catch((err) => this.report('bad', `erro ao checar bônus (${err.message})`));
      this.followNext();
    };
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
      this.channels.set(name, { balance: null, startBalance: null, claims: 0, moments: 0, watchedMs: 0, broadcastId: null, error: null, fails: 0, reported: null, nextCheck: 0 });
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
    // Se os avisos da conta tinham sido recusados com o token velho, pede de novo com o novo.
    this.pubsub.unlisten(this.userTopic);
    this.pubsub.listen(this.userTopic, () => this.account.accessToken);
    return true;
  }

  markRelink() {
    this.report('bad', 'não deu para renovar o login; vincule a conta de novo no painel');
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
    // 404 = a live acabou e a lista de lives (lida a cada minuto) ainda não sabe. Não é erro: vem marcado para não ir ao painel.
    if (master.status === 404) throw Object.assign(new Error('a live acabou'), { ended: true });
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

  // O minuto contou: soma o tempo assistido (para a sequência) e esquece as falhas desta live.
  minuteOk(live) {
    const ch = this.channel(live.name);
    ch.watchedMs += WATCH_CYCLE;
    if (ch.watchedMs >= STREAK_MS && !this.streakDone(live)) this.markStreak(live);
    if (ch.error) this.log(`#${live.name} voltou a contar`);
    Object.assign(ch, { error: null, fails: 0, reported: null });
  }

  // O minuto não contou. Para a lista de erros do painel só vai o que é problema de verdade. Ficam só na janela preta:
  // - a live que acabou;
  // - uma falha de rede sozinha, que acontece de vez em quando sem a internet ter caído (perder um aviso de 20 s
  //   não custa nada). Se ela se repetir na vez seguinte, aí vira erro.
  minuteFailed(live, err) {
    const ch = this.channel(live.name);
    ch.fails++;
    const text = `#${live.name} não contou (${err.message})`;
    const quiet = err.ended || (isNetworkError(err) && ch.fails < NET_FAILS_REPORT);
    if (!quiet && ch.reported !== err.message) {
      this.report('bad', text, live.name);
      ch.reported = err.message;
    } else if (ch.error !== err.message) this.log(text); // só quando o erro muda, para não encher a janela a cada 20 s
    ch.error = err.message;
  }

  // Entra e sai da pausa (descanso ou conta precisando vincular de novo): para tudo e fecha a conexão
  // em tempo real, como um navegador fechado. Na pausa nada é lido, então as falhas de rede antigas não valem mais.
  updateRest() {
    const paused = !this.active || this.resting;
    if (paused === this.wasResting) return;
    this.wasResting = paused;
    if (paused) {
      this.pausedForRest = this.active;
      if (this.pausedForRest) this.log(`descansando até ${clock(this.restWindow().end)} (horário de Brasília)`);
      this.pubsub.close();
      this.netFails = 0;
    } else {
      this.log(this.pausedForRest ? 'voltou do descanso' : 'voltou a farmar');
      this.pubsub.start();
    }
  }

  async watchLoop() {
    while (!this.stopped) {
      this.updateRest();
      const targets = this.farming ? this.pickTargets() : [];
      const names = targets.map((t) => t.name);
      const sameLives = [...names].sort().join() === [...this.watching].sort().join();
      if (!sameLives) {
        // Antes de trocar de live, espera um pouco, como alguém que demora para clicar.
        if (this.watching.length && names.length) {
          await sleep(random(SWITCH_DELAY));
          if (this.stopped) return;
        }
        if (names.length) this.log(`assistindo ${names.map((n) => `#${n}`).join(' e ')}`);
        else if (this.watching.length && !this.wasResting) this.log('nenhuma live oficial para assistir agora');
      }
      // Erro de uma live que saiu da lista (ex.: acabou) não vale mais.
      for (const name of this.watching) if (!names.includes(name)) Object.assign(this.channel(name), { error: null, fails: 0, reported: null });
      // Live que a conta acabou de abrir: lê o saldo logo, como o navegador faz ao abrir a página.
      for (const name of names) if (!this.watching.includes(name)) this.channel(name).nextCheck = 0;
      this.watching = names;
      if (!targets.length) {
        await sleep(WATCH_CYCLE);
        continue;
      }
      await updateSite().catch((err) => this.report('bad', `erro ao ler a página da Twitch (${err.message})`));
      for (const live of targets) {
        if (this.stopped) return;
        const started = Date.now();
        try {
          await this.sendMinute(live);
          this.minuteOk(live);
        } catch (err) {
          this.minuteFailed(live, err);
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
      const text = `erro ao ver os pontos de #${name} (${err.message})`;
      // Sem internet, a leitura falha em todos os canais, um por um: fica só na janela preta,
      // porque o aviso do topo do painel já diz que a internet caiu.
      if (isNetworkError(err)) this.log(text);
      else this.report('bad', text, name);
      return;
    }
    if (channelId) this.channelNames.set(channelId, name);
    if (!points) return;
    // Sem a conexão em tempo real, o histórico anota a diferença de saldo (sem saber o motivo).
    if (!this.liveEvents && ch.balance !== null && points.balance > ch.balance) {
      recordPoints(this.account.login, 'OTHER', points.balance - ch.balance);
    }
    setBalance(ch, points.balance);
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
      this.report('good', `baú pego em #${name}`, name);
    } catch (err) {
      this.report('bad', `não deu para pegar o baú em #${name} (${err.message})`, name);
    }
  }

  async claimMoment(name, momentId) {
    if (!this.farming || !(await this.humanPause(momentId))) return;
    try {
      await this.gql('CommunityMomentCallout_Claim', { input: { momentID: momentId } });
      this.channel(name).moments++;
      this.report('good', `Momento pego em #${name}`, name);
    } catch (err) {
      this.report('bad', `não deu para pegar o Momento em #${name} (${err.message})`, name);
    }
  }

  // Resgate pedido pelo jogador na loja do painel (nunca sozinho). Lê saldo e recompensa de novo antes,
  // como o navegador ao abrir a loja: o preço e a situação podem ter mudado desde que a loja abriu.
  // As recusas que dá para ver antes (sem pontos, pausada…) só voltam para o painel; as da Twitch vão também para os erros.
  async redeem(name, rewardId, text = '') {
    if (!this.active) throw new Error('a conta precisa ser vinculada de novo');
    if (this.redeeming) throw new Error('já tem um resgate em andamento nesta conta');
    this.redeeming = true;
    try {
      const data = await this.gql('ChannelPointsContext', { channelLogin: name });
      const channel = data.community?.channel;
      const raw = channel?.communityPointsSettings?.customRewards?.find((r) => r.id === rewardId);
      if (!channel?.id || !raw || raw.isEnabled === false) throw new Error('a recompensa não existe mais neste canal');
      const reward = toReward(raw);
      const balance = channel.self?.communityPoints?.balance;
      const ch = this.channel(name);
      if (typeof balance === 'number') setBalance(ch, balance);
      const problem = redeemProblem(reward, balance, text);
      if (problem) throw new Error(problem);
      try {
        const result = await this.gql('RedeemCustomReward', {
          input: {
            channelID: channel.id,
            cost: reward.cost,
            // A Twitch confere título, preço e descrição (prompt) com a recompensa atual; se algum mudar,
            // responde PROPERTIES_MISMATCH. O texto que a pessoa escreve vai em textInput.
            prompt: raw.prompt ?? null,
            rewardID: reward.id,
            textInput: reward.inputRequired ? text.trim() : null,
            title: reward.title,
            transactionID: crypto.randomBytes(16).toString('hex'),
          },
        });
        const outcome = result.redeemCommunityPointsCustomReward;
        if (outcome?.error?.code) throw new Error(REDEEM_ERRORS[outcome.error.code] ?? outcome.error.code);
        if (!outcome) throw new Error('a Twitch não confirmou o resgate');
      } catch (err) {
        this.report('bad', `não deu para resgatar "${reward.title}" em #${name} (${err.message})`, name);
        throw err;
      }
      // O aviso em tempo real do gasto pode ter chegado antes e já baixado o saldo: aí não desconta de novo.
      setBalance(ch, Math.min(ch.balance, balance - reward.cost));
      this.report('good', `resgatou "${reward.title}" em #${name} por ${reward.cost.toLocaleString('pt-BR')} pontos`, name);
      return reward;
    } finally {
      this.redeeming = false;
    }
  }

  // Segue os canais da lista, um por vez e com intervalos aleatórios, até seguir todos (inclusive os que a conta
  // quase nunca assiste). Ordem: lives assistidas, depois as outras ao vivo, depois as offline.
  // Cada canal seguido fica anotado em points.json: se a pessoa deixar de seguir depois, a conta não segue de novo.
  async followNext() {
    if (!this.farming || this.followBusy || Date.now() < this.nextFollow) return;
    const followed = this.account.followed ?? [];
    const rank = (name) => (this.watching.includes(name) ? 0 : this.live.some((l) => l.name === name) ? 1 : 2);
    // O follow precisa do id do canal, que vem da lista de lives ou da leitura de saldo; sem ele, o canal espera.
    const name = this.all
      .filter((n) => !followed.includes(n) && !this.followFailed.has(n) && this.channelId(n))
      .sort((a, b) => rank(a) - rank(b))[0];
    if (!name) return;
    this.followBusy = true;
    try {
      const data = await this.gql('FollowButton_FollowUser', { input: { targetID: this.channelId(name), disableNotifications: false } });
      const code = data.followUser?.error?.code;
      if (code) throw new Error(code);
      this.account.followed = [...(this.account.followed ?? []), name];
      savePoints();
      this.report('good', `seguiu #${name}`, name);
    } catch (err) {
      if (!this.active || isNetworkError(err)) return; // sem internet: tenta o mesmo canal na próxima vez
      this.followFailed.add(name);
      this.report('bad', `não deu para seguir #${name} (${err.message})`, name);
    } finally {
      this.followBusy = false;
      this.nextFollow = Date.now() + random(FOLLOW_GAP);
    }
  }

  channelId(name) {
    const live = this.live.find((l) => l.name === name)?.channelId;
    if (live) return live;
    for (const [id, n] of this.channelNames) if (n === name) return id;
    return null;
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
      this.report('good', `entrou na raid de #${from} para #${to}`, to);
    } catch (err) {
      this.report('bad', `não deu para entrar na raid de #${from} para #${to} (${err.message})`, to);
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
    const balance = data.balance?.balance;
    if (msg.type === 'points-earned') {
      const { total_points: points, reason_code: reason } = data.point_gain ?? {};
      if (points) recordPoints(this.account.login, reason ?? 'OTHER', points);
      if (name && typeof balance === 'number') {
        const ch = this.channel(name);
        // Primeiro saldo conhecido deste canal: o inicial é o de antes deste ganho, para ele já aparecer no card.
        ch.startBalance ??= balance - (points ?? 0);
        setBalance(ch, balance);
      }
    } else if (msg.type === 'points-spent') {
      // Resgate feito fora do painel (no navegador, por exemplo): o saldo cai na hora, sem esperar a próxima leitura.
      if (name && typeof balance === 'number') setBalance(this.channel(name), balance);
    } else if (msg.type === 'claim-available' && name && data.claim?.id) {
      // Pega o baú assim que avisado (depois da espera de "pessoa"), sem esperar a próxima leitura de saldo.
      this.claimBonus(name, channelId, data.claim.id);
    }
  }

  // Sem internet: várias falhas de rede seguidas.
  get offline() {
    return this.farming && this.netFails >= GQL_FAILS_ALERT;
  }

  // Problemas para mostrar no topo do painel. Sem internet, os avisos de Twitch e conexão caída ficam de fora:
  // o painel mostra um aviso só, de internet.
  alerts({ offline = false } = {}) {
    const who = this.account.login;
    if (this.account.needsRelink) return [{ variant: 'danger', text: `A conta ${who} precisa ser vinculada de novo (Pokeidle → Twitch).` }];
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
          followed: (this.account.followed ?? []).includes(name),
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
    this.enabled = true; // Pokeidle ligado em Configurações → Jogos
    this.channelNames = new Map(); // id do canal -> nome
    this.accounts = pointsAccounts.map((a) => this.makeAccount(a));
  }

  makeAccount(account) {
    return new PointsAccount(account, { log: this.log, channelNames: this.channelNames });
  }

  start() {
    this.started = true;
    if (!PubSub.supported) this.log('Pontos: este Node.js não tem WebSocket (precisa da versão 22 ou mais nova), então Momentos e raids ficam desligados');
    if (this.enabled) for (const a of this.accounts) a.start();
  }

  // Jogo desligado: as contas param (sem assistir, baú, follow nem PubSub) e ficam esperando, sem apagar nada.
  // Uma conta parada não volta (stop é para sempre), então ela é trocada por uma nova que ainda não começou:
  // essa continua renovando o login (ensureFresh) e começa quando o jogo for ligado de novo.
  setEnabled(enabled) {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (enabled) {
      if (this.started) for (const a of this.accounts) a.start();
      return;
    }
    for (const a of this.accounts) a.stop();
    this.accounts = this.accounts.map((old) => {
      const fresh = this.makeAccount(old.account);
      // Renovação em andamento continua valendo: o refresh token só pode ser usado uma vez.
      fresh.refreshing = old.refreshing;
      const done = () => fresh.refreshing === old.refreshing && (fresh.refreshing = null);
      old.refreshing?.then(done, done); // then com os dois lados: uma falha aqui não vira erro solto
      return fresh;
    });
    for (const a of this.accounts) a.setLive(this.live, this.all);
    this.log('Pontos: Pokeidle desligado, contas da Twitch paradas');
  }

  setLive(list, all) {
    this.live = list;
    this.all = all;
    for (const l of list) if (l.channelId) this.channelNames.set(l.channelId, l.name);
    for (const a of this.accounts) a.setLive(list, all);
  }

  ensureFresh() {
    return Promise.all(this.accounts.map((a) => a.ensureFresh().catch((err) => a.report('bad', `erro ao checar o login (${err.message})`))));
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
          if (this.started && this.enabled) miner.start();
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
