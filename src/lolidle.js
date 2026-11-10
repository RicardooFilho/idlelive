// LoLdle: até 5 contas da Twitch ficam no chat dos canais parceiros do LoLdle enquanto eles estão ao vivo.
// Só presença no chat (IRC), sem mandar mensagem e sem assistir a live. Contas e tokens ficam em lolidle.json.
import crypto from 'node:crypto';
import { startDeviceFlow, waitDeviceToken, refreshToken, validate, revoke, TV_CLIENT_ID as CLIENT_ID } from './twitch.js';
import { lolidle, saveLolidle, MAX_LOL_ACCOUNTS } from './store.js';
import { ChatConnection } from './chat.js';
import { addEvent } from './events.js';

const SCOPES = 'chat:read';

// Canais em que a conta deve estar: os da lista que estão ao vivo.
export const wantedChannels = (channels, live) => new Set(channels.filter((c) => live.has(c)));

export class LolIdleAccount {
  constructor(account, { log, makeConnection = (login, options) => new ChatConnection(login, options) }) {
    this.account = account;
    this.baseLog = log;
    this.makeConnection = makeConnection;
    this.wanted = new Set();
    this.conn = null;
    this.refreshing = null;
  }

  log(msg) {
    this.baseLog(`LoLdle (${this.account.login}): ${msg}`);
  }

  report(kind, text) {
    this.log(text);
    addEvent({ kind, platform: 'twitch', account: this.account.login, text: `LoLdle: ${text}` });
  }

  get active() {
    return !!this.account.accessToken && !this.account.needsRelink;
  }

  start() {
    if (!this.active || this.conn) return;
    this.conn = this.makeConnection(this.account.login, {
      getToken: () => this.account.accessToken,
      // Chat recusou o token: renova; se não der, a conta precisa ser vinculada de novo e sai do chat.
      onAuthFailed: () => this.ensureFresh(true).then((ok) => ok || this.stop()).catch((err) => this.log(`erro ao renovar o token (${err.message})`)),
      log: (msg) => this.baseLog(`LoLdle ${msg}`),
    });
    this.conn.setChannels(this.wanted);
  }

  stop() {
    this.conn?.close();
    this.conn = null;
  }

  setChannels(wanted) {
    this.wanted = wanted;
    this.conn?.setChannels(wanted);
  }

  // Mesmas regras do farm: o refresh token só vale uma vez (renovações simultâneas dividem a promessa)
  // e só 400/401 (refreshToken retorna null) pedem vincular de novo. Erro de rede só lança.
  ensureFresh(force = false) {
    if (!this.active) return Promise.resolve(false);
    this.refreshing ??= this.checkToken(force).finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  async checkToken(force) {
    const info = force ? null : await validate(this.account.accessToken);
    if (info && (info.expires_in === 0 || info.expires_in > 3600)) return true;
    if (!this.account.refreshToken) return info ? true : this.markRelink();
    const tokens = await refreshToken(CLIENT_ID, this.account.refreshToken);
    if (!tokens) return this.markRelink();
    this.account.accessToken = tokens.access_token;
    this.account.refreshToken = tokens.refresh_token ?? this.account.refreshToken;
    saveLolidle();
    this.log('token renovado');
    return true;
  }

  markRelink() {
    this.report('bad', 'não deu para renovar o login; vincule a conta de novo no painel');
    this.account.needsRelink = true;
    saveLolidle();
    return false;
  }

  updateTokens(tokens, login) {
    Object.assign(this.account, { login, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, needsRelink: false });
    saveLolidle();
    this.stop();
  }

  state() {
    const joined = this.conn ? [...this.conn.joined] : [];
    return {
      login: this.account.login,
      needsRelink: !!this.account.needsRelink,
      connected: !!this.conn?.connected,
      joined: joined.sort(),
    };
  }
}

export class LolIdleMiner {
  constructor({ log, makeConnection }) {
    this.log = log;
    this.makeConnection = makeConnection; // só os testes trocam (conexão falsa, sem socket)
    this.pendingLink = null; // { userCode, uri, error, cancelled }
    this.wanted = new Set();
    this.started = false;
    this.enabled = true; // LoLdle ligado em Configurações → Jogos
    this.accounts = lolidle.accounts.map((a) => this.makeAccount(a));
  }

  makeAccount(account) {
    return new LolIdleAccount(account, { log: this.log, ...(this.makeConnection && { makeConnection: this.makeConnection }) });
  }

  start() {
    this.started = true;
    if (this.enabled) for (const a of this.accounts) a.start();
  }

  // Jogo desligado: as contas saem dos chats (a conexão fecha) e voltam quando ele for ligado de novo.
  // O login continua sendo renovado (ensureFresh não depende da conexão).
  setEnabled(enabled) {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    for (const a of this.accounts) {
      if (!enabled) a.stop();
      else if (this.started) a.start();
    }
    if (!enabled) this.log('LoLdle desligado, contas fora dos chats');
  }

  setLive(channels, live) {
    this.wanted = wantedChannels(channels, live);
    for (const a of this.accounts) a.setChannels(this.wanted);
  }

  ensureFresh() {
    return Promise.all(this.accounts.map((a) => a.ensureFresh().catch((err) => a.log(`erro ao checar o login (${err.message})`))));
  }

  find(login) {
    const account = this.accounts.find((a) => a.account.login === login);
    if (!account) throw new Error('Conta não encontrada');
    return account;
  }

  async startLink() {
    if (this.pendingLink && !this.pendingLink.error) throw new Error('Já existe um vínculo em andamento');
    const flow = await startDeviceFlow(CLIENT_ID, SCOPES);
    const link = { userCode: flow.user_code, uri: flow.verification_uri };
    this.pendingLink = link;

    waitDeviceToken(CLIENT_ID, flow, () => link.cancelled, SCOPES)
      .then(async (tokens) => {
        const info = await validate(tokens.access_token);
        let account = this.accounts.find((a) => a.account.userId === info.user_id);
        if (account) {
          account.updateTokens(tokens, info.login);
          account.log('vinculada de novo');
        } else {
          if (this.accounts.length >= MAX_LOL_ACCOUNTS) throw new Error(`Limite de ${MAX_LOL_ACCOUNTS} contas atingido`);
          const saved = {
            login: info.login,
            userId: info.user_id,
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            id: crypto.randomBytes(8).toString('hex'),
          };
          lolidle.accounts.push(saved);
          saveLolidle();
          account = this.makeAccount(saved);
          this.accounts.push(account);
          account.log('vinculada');
        }
        account.setChannels(this.wanted);
        if (this.started && this.enabled) account.start();
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
    const account = this.find(login);
    account.stop();
    if (account.account.accessToken) revoke(CLIENT_ID, account.account.accessToken);
    account.log('desvinculada');
    this.accounts.splice(this.accounts.indexOf(account), 1);
    lolidle.accounts.splice(lolidle.accounts.indexOf(account.account), 1);
    saveLolidle();
  }

  state() {
    return {
      max: MAX_LOL_ACCOUNTS,
      pendingLink: this.pendingLink && { userCode: this.pendingLink.userCode, uri: this.pendingLink.uri, error: this.pendingLink.error },
      accounts: this.accounts.map((a) => a.state()),
    };
  }
}
