// Uma conexão de chat (IRC) por conta, que entra e sai de vários canais em silêncio.
import tls from 'node:tls';

const HOST = 'irc.chat.twitch.tv';

// Quando a internet cai, o Windows nem sempre avisa que a conexão morreu.
// Mandamos um PING de tempos em tempos; se nada chegar em IDLE_TIMEOUT, a conexão é derrubada e refeita.
const PING_INTERVAL = 60 * 1000;
const IDLE_TIMEOUT = 150 * 1000;

export class ChatConnection {
  constructor(login, { getToken, onAuthFailed, log }) {
    this.login = login;
    this.getToken = getToken;
    this.onAuthFailed = onAuthFailed;
    this.log = log;
    this.wanted = new Set();
    this.joined = new Set();
    this.pending = new Set();
    this.connected = false;
    this.closed = false;
    this.retryDelay = 1000;
    this.reconnectTimer = null;
    this.connect();
  }

  connect() {
    if (this.closed) return;
    const socket = tls.connect(6697, HOST, { servername: HOST });
    this.socket = socket;
    socket.setEncoding('utf8');
    let buffer = '';
    let lastData = Date.now();

    socket.on('secureConnect', () => {
      socket.write(`PASS oauth:${this.getToken()}\r\n`);
      socket.write(`NICK ${this.login}\r\n`);
    });

    // Só conta o que chega: o socket.setTimeout do Node também conta o que enviamos, e aí o próprio PING o manteria vivo.
    const pinger = setInterval(() => {
      if (socket.destroyed) return;
      if (Date.now() - lastData > IDLE_TIMEOUT) {
        this.log(`${this.login}: sem resposta do chat há mais de ${IDLE_TIMEOUT / 1000}s, refazendo a conexão`);
        socket.destroy();
        return;
      }
      socket.write('PING :tmi.twitch.tv\r\n');
    }, PING_INTERVAL);

    socket.on('data', (chunk) => {
      lastData = Date.now();
      buffer += chunk;
      const lines = buffer.split('\r\n');
      buffer = lines.pop();
      for (const line of lines) this.handleLine(line);
    });

    socket.on('error', (err) => this.log(`${this.login}: erro de conexão (${err.message})`));
    socket.on('close', () => {
      clearInterval(pinger);
      this.connected = false;
      this.joined.clear();
      this.pending.clear();
      if (this.closed) return;
      this.log(`${this.login}: conexão caiu, reconectando em ${this.retryDelay / 1000}s`);
      this.reconnectTimer = setTimeout(() => this.connect(), this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, 60000);
    });
  }

  handleLine(line) {
    const parts = line.split(' ');
    if (parts[0] === 'PING') {
      this.socket.write(line.replace('PING', 'PONG') + '\r\n');
    } else if (parts[1] === '001') {
      this.connected = true;
      this.retryDelay = 1000;
      this.log(`${this.login}: conectado ao chat`);
      this.sync();
    } else if (parts[1] === '366') {
      // Fim da lista de nomes = entrou no canal.
      const channel = parts[3].slice(1);
      this.pending.delete(channel);
      this.joined.add(channel);
      this.log(`${this.login}: entrou em #${channel}`);
    } else if (parts[1] === 'NOTICE' && /authentication failed|improperly formatted auth/i.test(line)) {
      this.log(`${this.login}: token recusado pelo chat`);
      this.socket.destroy();
      this.onAuthFailed();
    }
  }

  setChannels(channels) {
    this.wanted = channels;
    if (this.connected) this.sync();
  }

  sync() {
    for (const channel of this.wanted) {
      if (this.joined.has(channel) || this.pending.has(channel)) continue;
      this.pending.add(channel);
      this.socket.write(`JOIN #${channel}\r\n`);
    }
    for (const channel of [...this.joined, ...this.pending]) {
      if (this.wanted.has(channel)) continue;
      this.joined.delete(channel);
      this.pending.delete(channel);
      this.socket.write(`PART #${channel}\r\n`);
      this.log(`${this.login}: saiu de #${channel}`);
    }
  }

  // Cancela também a reconexão agendada: fechada no meio da espera (conta desvinculada, jogo desligado),
  // ela abriria uma conexão que ninguém fecha, e a conta continuaria nos chats.
  close() {
    this.closed = true;
    clearTimeout(this.reconnectTimer);
    this.socket.destroy();
  }
}
