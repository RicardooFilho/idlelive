// Pontos do canal (Kick): até 4 contas, cada uma "assiste" até 2 lives dos canais parceiros em segundo plano.
// Baseado no Kick Channel Points Miner (github.com/Baillora/Kick_Channel_Points_Miner): abre a mesma conexão de
// espectador que o player do site abre e manda o aviso de "assistindo" de tempos em tempos.
// Mesmas travas da Twitch (human.js): descanso diário, tempos aleatórios e poucas leituras de saldo.
import { kick, saveKick, MAX_ACCOUNTS } from './store.js';
import { fetchKickUser, fetchKickPoints, fetchViewerToken, followKickChannel, cleanKickToken } from './kick.js';
import { isNetworkError } from './twitch.js';
import { recordPoints } from './stats.js';
import { addEvent } from './events.js';
import { sleep, random, clock, restWindow, isResting, SWITCH_DELAY, START_DELAY, CHECK_OTHERS, CHECK_TICK, CHECKS_PER_TICK, FOLLOW_DELAY, FOLLOW_GAP } from './human.js';

const MAX_WATCH = 2; // lives por conta ao mesmo tempo (mais que isso a Kick começa a bloquear)
const LOOP = 20 * 1000;
const CHECK_WATCHING = [5 * 60 * 1000, 10 * 60 * 1000];
const TRACK_EVERY = [9.5 * 1000, 12.5 * 1000]; // aviso de "assistindo", como o player
const HANDSHAKE_EVERY = [25 * 1000, 35 * 1000]; // "ainda estou neste canal" + ping
const FAILS_ALERT = 3;
const SILENCE_LIMIT = 90 * 1000; // sem nada da Kick nesse tempo, a conexão está "morta" (PC hibernou, roteador caiu)
const STABLE_AFTER = 60 * 1000; // a espera entre reconexões só volta ao mínimo depois de a conexão ficar de pé esse tempo

// Uma conexão de espectador numa live (wss://websockets.kick.com/viewer/v1/connect).
class KickWatch {
  constructor({ token, live, log, report, onAuthError }) {
    this.token = token;
    this.live = live; // { slug, channelId, userId, livestreamId }
    this.log = log;
    this.report = report;
    this.onAuthError = onAuthError;
    this.ws = null;
    this.timers = [];
    this.stopped = false;
    this.connected = false;
    this.retryDelay = 5000;
    this.error = null;
  }

  async start() {
    if (this.stopped) return;
    try {
      const viewerToken = await fetchViewerToken(this.token(), this.live);
      if (this.stopped) return;
      this.open(viewerToken);
    } catch (err) {
      this.fail(err);
    }
  }

  open(viewerToken) {
    const ws = new WebSocket(`wss://websockets.kick.com/viewer/v1/connect?token=${encodeURIComponent(viewerToken)}`);
    this.ws = ws;
    const send = (data) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(data));
    const handshake = () => send({ type: 'channel_handshake', data: { message: { channelId: Number(this.live.channelId) } } });
    // Repete em intervalos aleatórios, cada um sorteado de novo.
    const every = (range, fn) => {
      const tick = () => {
        this.timers.push(setTimeout(() => {
          fn();
          tick();
        }, random(range)));
      };
      tick();
    };

    let lastData = Date.now();
    let stableTimer;
    ws.onopen = () => {
      this.connected = true;
      lastData = Date.now();
      // Se a Kick derrubar logo depois de aceitar, a espera continua crescendo em vez de virar um laço rápido.
      stableTimer = setTimeout(() => (this.retryDelay = 5000), STABLE_AFTER);
      if (this.error) this.log(`#${this.live.slug} voltou a contar`);
      this.error = null;
      handshake();
      send({ type: 'ping' });
      every(HANDSHAKE_EVERY, () => {
        // A Kick responde o ping; sem resposta nenhuma por muito tempo, derruba para reconectar.
        if (Date.now() - lastData > SILENCE_LIMIT) {
          this.report('bad', `#${this.live.slug}: sem resposta da Kick, refazendo a conexão`, this.live.slug);
          ws.close();
          return;
        }
        handshake();
        send({ type: 'ping' });
      });
      every(TRACK_EVERY, () => send({
        type: 'user_event',
        data: { message: { name: 'tracking.user.watch.livestream', channel_id: Number(this.live.channelId), livestream_id: Number(this.live.livestreamId) } },
      }));
    };
    ws.onmessage = (event) => {
      lastData = Date.now();
      const text = String(event.data).trim();
      if (text === 'ping') return ws.send('pong');
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (msg.type === 'ping') send({ type: 'pong' });
      else if (msg.type === 'error') this.fail(new Error(msg.data?.message ?? 'erro da Kick'));
    };
    ws.onclose = () => {
      this.clearTimers();
      clearTimeout(stableTimer);
      this.connected = false;
      if (this.stopped || this.ws !== ws) return;
      this.retry();
    };
    ws.onerror = () => {}; // o onclose cuida
  }

  fail(err) {
    if (err.status === 401) {
      this.onAuthError(err);
      return;
    }
    // A Kick responde 403 ao token de espectador quando o token da conta não vale mais; a conta confere antes de pedir outro.
    if (err.status === 403) this.onAuthError(err);
    const text = isNetworkError(err) ? 'sem internet' : err.message;
    if (this.error !== text) this.report('bad', `#${this.live.slug} não contou (${text})`, this.live.slug);
    this.error = text;
    if (!this.connected) this.retry();
  }

  retry() {
    if (this.stopped) return;
    this.timers.push(setTimeout(() => this.start(), this.retryDelay));
    this.retryDelay = Math.min(this.retryDelay * 2, 2 * 60 * 1000);
  }

  clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  stop() {
    this.stopped = true;
    this.clearTimers();
    this.ws?.close();
  }
}

// Uma conta da Kick: escolhe as próprias lives pelos próprios saldos.
export class KickAccount {
  constructor(account, { log }) {
    this.account = account; // objeto salvo em kick.json: { id, username, token, profile, needsRelink }
    this.baseLog = log;
    this.live = []; // [{ slug, channelId, userId, livestreamId }]
    this.all = [];
    this.channels = new Map(); // canal -> { balance, startBalance, nextCheck }
    this.watches = new Map(); // canal -> KickWatch
    this.followFailed = new Set(); // canais em que o follow falhou nesta sessão (tenta de novo quando o painel reiniciar)
    this.nextFollow = 0;
    this.followBusy = false;
    this.stopped = false;
    this.wasResting = false;
    this.checking = false;
    this.netFails = 0;
    this.siteFails = 0;
    this.siteError = null;
  }

  log(msg) {
    this.baseLog(`Kick (${this.account.username}): ${msg}`);
  }

  // Escreve na janela preta e anota na lista de erros do topo do painel.
  report(kind, msg, channel = null) {
    this.log(msg);
    addEvent({ kind, platform: 'kick', account: this.account.username, channel, text: msg });
  }

  get active() {
    return !this.stopped && !!this.account.token && !this.account.needsRelink;
  }

  get resting() {
    return isResting(`kick:${this.account.id}`);
  }

  get farming() {
    return this.active && !this.resting;
  }

  get offline() {
    return this.farming && this.netFails >= FAILS_ALERT;
  }

  get watching() {
    return [...this.watches.keys()];
  }

  channel(slug) {
    if (!this.channels.has(slug)) this.channels.set(slug, { balance: null, startBalance: null, nextCheck: 0 });
    return this.channels.get(slug);
  }

  async start() {
    await sleep(random(START_DELAY));
    if (this.stopped) return;
    this.nextFollow = Date.now() + random(FOLLOW_DELAY);
    const check = () => {
      this.checkBalances().catch((err) => this.report('bad', `erro ao ler saldos (${err.message})`));
      this.followNext();
    };
    check();
    this.timer = setInterval(check, CHECK_TICK);
    this.loop();
  }

  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    for (const w of this.watches.values()) w.stop();
    this.watches.clear();
  }

  setLive(list, all) {
    this.live = list;
    this.all = all;
  }

  // Mais pontos primeiro; saldo ainda desconhecido vai por último, na ordem da lista.
  pickTargets() {
    const balance = (l) => this.channel(l.slug).balance ?? -1;
    return [...this.live].sort((a, b) => balance(b) - balance(a)).slice(0, MAX_WATCH);
  }

  markRelink() {
    if (this.account.needsRelink) return;
    this.netFails = 0;
    this.report('bad', 'o token foi recusado; cole um token novo na página Kick');
    this.account.needsRelink = true;
    saveKick();
    for (const w of this.watches.values()) w.stop();
    this.watches.clear();
  }

  // Token recusado (401) ou suspeito (403): confere na conta antes de pedir um token novo,
  // para um bloqueio passageiro da Kick não virar "cole um token novo".
  async checkAuth(err) {
    if (err.status === 401) return this.markRelink();
    if (this.verifying) return;
    this.verifying = true;
    try {
      await fetchKickUser(this.account.token);
    } catch (e) {
      if (e.status === 401) this.markRelink();
    } finally {
      this.verifying = false;
    }
  }

  updateToken(token, username) {
    Object.assign(this.account, { token, username, needsRelink: false });
    saveKick();
  }

  // Entra e sai do descanso.
  updateRest() {
    const resting = this.active && this.resting;
    if (resting === this.wasResting) return;
    this.wasResting = resting;
    if (resting) this.netFails = 0; // no descanso nada é lido, então as falhas de rede antigas não valem mais
    this.log(resting ? `descansando até ${clock(restWindow(`kick:${this.account.id}`).end)} (horário de Brasília)` : 'voltou do descanso');
  }

  async loop() {
    while (!this.stopped) {
      this.updateRest();
      const targets = this.farming ? this.pickTargets() : [];
      const wanted = new Map(targets.map((t) => [t.slug, t]));
      // Fecha as lives que saíram da escolha ou que viraram outra transmissão.
      for (const [slug, w] of this.watches) {
        const t = wanted.get(slug);
        if (!t || t.livestreamId !== w.live.livestreamId) {
          w.stop();
          this.watches.delete(slug);
        }
      }
      const added = targets.filter((t) => !this.watches.has(t.slug));
      if (added.length) {
        // Antes de trocar de live, espera um pouco, como alguém que demora para clicar.
        if (this.watches.size || this.lastWatched) await sleep(random(SWITCH_DELAY));
        if (this.stopped) return;
        for (const live of added) {
          const watch = new KickWatch({ token: () => this.account.token, live, log: (m) => this.log(m), report: (...a) => this.report(...a), onAuthError: (err) => this.checkAuth(err).catch((e) => this.report('bad', `erro ao conferir o token (${e.message})`)) });
          this.watches.set(live.slug, watch);
          this.channel(live.slug).nextCheck = 0; // lê o saldo logo, como o site faz ao abrir a live
          watch.start();
        }
      }
      const names = this.watching;
      if (names.join() !== (this.lastWatched ?? []).join()) {
        if (names.length) this.log(`assistindo ${names.map((n) => `#${n}`).join(' e ')}`);
        else if (this.lastWatched?.length && !this.wasResting) this.log('nenhuma live parceira para assistir agora');
        this.lastWatched = names;
      }
      await sleep(LOOP * random([0.85, 1.15]));
    }
  }

  // Segue os canais da lista, um por vez e com intervalos aleatórios, até seguir todos (inclusive os que a conta
  // quase nunca assiste). Ordem: lives assistidas, depois as outras ao vivo, depois as offline.
  // Cada canal seguido fica anotado em kick.json: se a pessoa deixar de seguir depois, a conta não segue de novo.
  async followNext() {
    if (!this.farming || this.followBusy || Date.now() < this.nextFollow) return;
    const followed = this.account.followed ?? [];
    const rank = (slug) => (this.watches.has(slug) ? 0 : this.live.some((l) => l.slug === slug) ? 1 : 2);
    const slug = this.all.filter((s) => !followed.includes(s) && !this.followFailed.has(s)).sort((a, b) => rank(a) - rank(b))[0];
    if (!slug) return;
    this.followBusy = true;
    try {
      const now = await followKickChannel(slug, this.account.token);
      this.account.followed = [...(this.account.followed ?? []), slug];
      saveKick();
      if (now) this.report('good', `seguiu #${slug}`, slug);
    } catch (err) {
      if (err.status === 401) return this.markRelink();
      if (isNetworkError(err)) return; // sem internet: tenta o mesmo canal na próxima vez
      this.followFailed.add(slug);
      this.report('bad', `não deu para seguir #${slug} (${err.message})`, slug);
    } finally {
      this.followBusy = false;
      this.nextFollow = Date.now() + random(FOLLOW_GAP);
    }
  }

  // Lê os saldos que estão na hora (poucos por vez): lives assistidas a cada 5–10 min, o resto a cada ~30.
  async checkBalances() {
    if (!this.farming || this.checking) return;
    this.checking = true;
    try {
      const now = Date.now();
      const isLive = (slug) => this.live.some((l) => l.slug === slug);
      const rank = (slug) => (this.watches.has(slug) ? 0 : isLive(slug) ? 1 : 2) * 2 + (this.channel(slug).balance === null ? 0 : 1);
      const due = this.all.filter((slug) => this.channel(slug).nextCheck <= now).sort((a, b) => rank(a) - rank(b)).slice(0, CHECKS_PER_TICK);
      for (const slug of due) {
        if (!this.farming) return;
        await this.checkChannel(slug);
        await sleep(random([1000, 4000]));
      }
    } finally {
      this.checking = false;
    }
  }

  async checkChannel(slug) {
    const ch = this.channel(slug);
    ch.nextCheck = Date.now() + random(this.watches.has(slug) ? CHECK_WATCHING : CHECK_OTHERS);
    let balance;
    try {
      balance = await fetchKickPoints(slug, this.account.token);
      this.netFails = 0;
      this.siteFails = 0;
      this.siteError = null;
    } catch (err) {
      if (err.status === 401) return this.markRelink();
      if (isNetworkError(err)) this.netFails++;
      else {
        this.siteFails++;
        this.siteError = err.message;
        this.report('bad', `erro ao ver os pontos de #${slug} (${err.message})`, slug);
      }
      return;
    }
    // A Kick não avisa o motivo dos pontos: o histórico anota a diferença de saldo como tempo assistido.
    if (ch.balance !== null && balance > ch.balance) recordPoints(`${this.account.username} (Kick)`, 'WATCH', balance - ch.balance);
    ch.balance = balance;
    ch.startBalance ??= balance;
  }

  alerts({ offline = false } = {}) {
    const who = this.account.username;
    if (this.account.needsRelink) return [{ variant: 'danger', text: `O token da conta ${who} da Kick foi recusado. Cole um token novo na página Kick.` }];
    if (offline) return [];
    if (this.siteFails >= FAILS_ALERT) return [{ variant: 'danger', text: `A Kick está recusando os pedidos da conta ${who}: ${this.siteError}. Os pontos dela podem não estar contando.` }];
    return [];
  }

  state() {
    const live = new Set(this.live.map((l) => l.slug));
    return {
      id: this.account.id,
      login: this.account.username,
      needsRelink: !!this.account.needsRelink,
      resting: this.active && this.resting,
      restUntil: clock(restWindow(`kick:${this.account.id}`).end),
      profile: this.account.profile ?? null,
      watching: this.watching,
      channels: this.all.map((slug) => {
        const c = this.channel(slug);
        return {
          name: slug,
          live: live.has(slug),
          watching: this.watches.has(slug),
          balance: c.balance,
          gained: c.balance === null ? 0 : Math.max(0, c.balance - c.startBalance),
          error: this.watches.get(slug)?.error ?? null,
          followed: (this.account.followed ?? []).includes(slug),
        };
      }),
    };
  }
}

// Todas as contas da Kick. O login é o token da conta, colado no painel (a Kick não tem login por código).
export class KickMiner {
  constructor({ log }) {
    this.log = log;
    this.live = [];
    this.all = [];
    this.started = false;
    kick.accounts ??= [];
    this.accounts = kick.accounts.map((a) => new KickAccount(a, { log }));
  }

  start() {
    this.started = true;
    if (typeof WebSocket === 'undefined') this.log('Kick: este Node.js não tem WebSocket (precisa da versão 22 ou mais nova), então o farm da Kick fica desligado');
    else for (const a of this.accounts) a.start();
  }

  setLive(list, all) {
    this.live = list;
    this.all = all;
    for (const a of this.accounts) a.setLive(list, all);
  }

  find(id) {
    const miner = this.accounts.find((a) => String(a.account.id) === String(id));
    if (!miner) throw new Error('Conta não encontrada');
    return miner;
  }

  // Adiciona (ou atualiza) uma conta a partir do token colado no painel.
  async addAccount(rawToken) {
    const token = cleanKickToken(rawToken);
    if (!token) throw new Error('Cole o token da conta');
    let user;
    try {
      user = await fetchKickUser(token);
    } catch (err) {
      throw new Error(err.status === 401 ? 'A Kick recusou esse token. Confira se copiou ele inteiro.' : `Não deu para conferir o token: ${err.message}`);
    }
    const existing = this.accounts.find((a) => a.account.id === user.id);
    if (existing) {
      existing.updateToken(token, user.username);
      existing.log('token atualizado');
      return;
    }
    if (this.accounts.length >= MAX_ACCOUNTS) throw new Error(`Limite de ${MAX_ACCOUNTS} contas atingido`);
    const account = { id: user.id, username: user.username, token };
    kick.accounts.push(account);
    saveKick();
    const miner = new KickAccount(account, { log: this.log });
    this.accounts.push(miner);
    miner.setLive(this.live, this.all);
    if (this.started && typeof WebSocket !== 'undefined') miner.start();
    miner.log('vinculada');
  }

  removeAccount(id) {
    const miner = this.find(id);
    miner.stop();
    miner.log('desvinculada');
    this.accounts.splice(this.accounts.indexOf(miner), 1);
    kick.accounts.splice(kick.accounts.indexOf(miner.account), 1);
    saveKick();
  }

  setProfile(id, profile) {
    this.find(id).account.profile = profile || null;
    saveKick();
  }

  profileOf(id) {
    return this.find(id).account.profile ?? null;
  }

  get offline() {
    return this.accounts.some((a) => a.offline);
  }

  alerts(options) {
    return this.accounts.flatMap((a) => a.alerts(options));
  }

  state() {
    return { max: MAX_ACCOUNTS, accounts: this.accounts.map((a) => a.state()) };
  }
}
