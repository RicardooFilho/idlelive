import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import tls from 'node:tls';
import { ChatConnection } from '../src/chat.js';

// Nada de internet: o tls.connect é trocado por um socket falso, que guarda o que foi escrito.
const realConnect = tls.connect;
let sockets;
let open;

const fakeSocket = () => {
  const socket = new EventEmitter();
  Object.assign(socket, {
    written: [],
    destroyed: false,
    setEncoding() {},
    write(data) { this.written.push(data); },
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.emit('close');
    },
  });
  return socket;
};

const install = () => {
  sockets = [];
  open = [];
  tls.connect = () => {
    const socket = fakeSocket();
    sockets.push(socket);
    return socket;
  };
};

// Fecha tudo no fim de cada teste: cada conexão tem um PING a cada minuto, que seguraria o processo.
afterEach(() => {
  for (const conn of open) conn.close();
  tls.connect = realConnect;
});

const makeConnection = (options = {}) => {
  install();
  const conn = new ChatConnection('conta', { getToken: () => 'tok', onAuthFailed: () => {}, log: () => {}, ...options });
  open.push(conn);
  return conn;
};

const receive = (socket, line) => socket.emit('data', `${line}\r\n`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('entra com o token, entra nos canais pedidos e sai dos que saíram da lista', () => {
  const conn = makeConnection();
  const [socket] = sockets;
  socket.emit('secureConnect');
  assert.deepEqual(socket.written, ['PASS oauth:tok\r\n', 'NICK conta\r\n']);

  conn.setChannels(new Set(['a'])); // ainda sem o 001: espera conectar
  assert.equal(socket.written.length, 2);
  receive(socket, ':tmi.twitch.tv 001 conta :Welcome, GLHF!');
  assert.ok(conn.connected);
  assert.equal(socket.written.at(-1), 'JOIN #a\r\n');
  receive(socket, ':conta.tmi.twitch.tv 366 conta #a :End of /NAMES list');
  assert.deepEqual([...conn.joined], ['a']);

  conn.setChannels(new Set(['a'])); // já está: não pede de novo
  assert.equal(socket.written.at(-1), 'JOIN #a\r\n');
  conn.setChannels(new Set());
  assert.equal(socket.written.at(-1), 'PART #a\r\n');
  assert.equal(conn.joined.size, 0);
});

test('responde o PING da Twitch e junta as linhas que chegam cortadas', () => {
  makeConnection();
  const [socket] = sockets;
  socket.emit('data', 'PING :tmi.tw');
  assert.equal(socket.written.length, 0);
  socket.emit('data', 'itch.tv\r\n');
  assert.deepEqual(socket.written, ['PONG :tmi.twitch.tv\r\n']);
});

test('token recusado pelo chat: derruba a conexão e avisa a conta', () => {
  let failed = 0;
  makeConnection({ onAuthFailed: () => failed++ });
  receive(sockets[0], ':tmi.twitch.tv NOTICE * :Login authentication failed');
  assert.ok(sockets[0].destroyed);
  assert.equal(failed, 1);
});

test('conexão que caiu é refeita, com a espera dobrando', async () => {
  const conn = makeConnection();
  receive(sockets[0], ':tmi.twitch.tv 001 conta :Welcome, GLHF!');
  conn.retryDelay = 5; // depois do 001, que volta a espera para 1 s
  sockets[0].destroy();
  assert.equal(conn.connected, false);
  assert.equal(conn.retryDelay, 10);
  await wait(30);
  assert.equal(sockets.length, 2);
});

test('fechada no meio da espera de reconexão, não abre conexão nova', async () => {
  const conn = makeConnection();
  conn.retryDelay = 5;
  sockets[0].destroy(); // caiu: reconexão agendada
  conn.close(); // conta desvinculada ou jogo desligado antes de ela acontecer
  await wait(30);
  assert.equal(sockets.length, 1);
  conn.connect(); // nem se alguém chamar direto
  assert.equal(sockets.length, 1);
});
