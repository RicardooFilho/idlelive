import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { compareVersions, readTarball, applyFiles, fetchLatest, Updater } from '../src/update.js';

const tmpDirs = [];
const tmpDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'idlelive-update-'));
  tmpDirs.push(dir);
  return dir;
};
after(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const realFetch = globalThis.fetch;
afterEach(() => (globalThis.fetch = realFetch));

// Monta um .tar.gz como o do GitHub: cabeçalho global ("g"), pasta "<dono>-<repo>-<commit>/" e arquivos dentro.
function header(name, size, type) {
  const h = Buffer.alloc(512);
  h.write(name.slice(0, 100), 0);
  h.write(size.toString(8).padStart(11, '0'), 124);
  h.write(type, 156);
  h.write('ustar', 257);
  return h;
}
const pad = (buf) => Buffer.concat([buf, Buffer.alloc((512 - (buf.length % 512)) % 512)]);
function tarball(files, top = 'RicardooFilho-idlelive-abc123') {
  const parts = [];
  const comment = Buffer.from('52 comment=abc123abc123abc123abc123abc123abc123ab\n');
  parts.push(header('pax_global_header', comment.length, 'g'), pad(comment));
  parts.push(header(`${top}/`, 0, '5'));
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content);
    const full = `${top}/${name}`;
    if (full.length > 100) {
      const rec = `path=${full}\n`;
      let len = rec.length + 3;
      len = rec.length + String(len).length + 1;
      const pax = Buffer.from(`${len} ${rec}`);
      parts.push(header('PaxHeader', pax.length, 'x'), pad(pax));
    }
    parts.push(header(full, data.length, '0'), pad(data));
  }
  parts.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(parts));
}

test('compara versões por número, não por texto', () => {
  assert.equal(compareVersions('1.10.0', '1.9.2'), 1);
  assert.equal(compareVersions('v1.2.0', '1.2'), 0);
  assert.equal(compareVersions('1.2.0', '1.2.1'), -1);
  assert.equal(compareVersions('2.0.0', '1.99.99'), 1);
});

test('lê o .tar.gz do GitHub sem a pasta de cima e com caminho comprido', () => {
  const long = `public/${'a'.repeat(120)}.txt`;
  const files = readTarball(tarball({ 'server.js': 'oi', 'src/update.js': 'x', [long]: 'comprido' }));
  assert.deepEqual(files.map((f) => f.path), ['server.js', 'src/update.js', long]);
  assert.equal(files[0].data.toString(), 'oi');
  assert.equal(files[2].data.toString(), 'comprido');
});

test('grava só o que mudou e não toca nos dados do jogador', () => {
  const root = tmpDir();
  fs.writeFileSync(path.join(root, 'server.js'), 'velho');
  fs.writeFileSync(path.join(root, 'README.md'), 'igual');
  fs.writeFileSync(path.join(root, 'config.json'), '{"channels":["meu"]}');
  fs.writeFileSync(path.join(root, 'points.json'), 'tokens');
  const { written, launcherChanged } = applyFiles([
    { path: 'server.js', data: Buffer.from('novo') },
    { path: 'README.md', data: Buffer.from('igual') },
    { path: 'src/novo.js', data: Buffer.from('arquivo novo') },
    { path: 'config.json', data: Buffer.from('{"channels":[]}') },
    { path: 'points.json', data: Buffer.from('outro') },
  ], root);
  assert.deepEqual(written.sort(), ['server.js', 'src/novo.js']);
  assert.equal(launcherChanged, false);
  assert.equal(fs.readFileSync(path.join(root, 'server.js'), 'utf8'), 'novo');
  assert.equal(fs.readFileSync(path.join(root, 'src/novo.js'), 'utf8'), 'arquivo novo');
  assert.equal(fs.readFileSync(path.join(root, 'config.json'), 'utf8'), '{"channels":["meu"]}');
  assert.equal(fs.readFileSync(path.join(root, 'points.json'), 'utf8'), 'tokens');
  assert.equal(fs.readdirSync(root).some((f) => f.endsWith('.update-tmp')), false);
});

test('config.json é criado se ainda não existir', () => {
  const root = tmpDir();
  applyFiles([{ path: 'config.json', data: Buffer.from('{"channels":["x"]}') }], root);
  assert.equal(fs.readFileSync(path.join(root, 'config.json'), 'utf8'), '{"channels":["x"]}');
});

test('iniciar.bat ganha CRLF e só conta como trocado se mudou de verdade', () => {
  const root = tmpDir();
  fs.writeFileSync(path.join(root, 'iniciar.bat'), '@echo off\r\nnode server.js\r\n');
  assert.equal(applyFiles([{ path: 'iniciar.bat', data: Buffer.from('@echo off\nnode server.js\n') }], root).launcherChanged, false);
  const result = applyFiles([{ path: 'iniciar.bat', data: Buffer.from('@echo off\nnode server.js\npause\n') }], root);
  assert.equal(result.launcherChanged, true);
  assert.equal(fs.readFileSync(path.join(root, 'iniciar.bat'), 'utf8'), '@echo off\r\nnode server.js\r\npause\r\n');
});

test('recusa caminho para fora da pasta ou para o .git', () => {
  const root = tmpDir();
  for (const bad of ['../fora.js', 'src/../../fora.js', '.git/config', 'C:/Windows/x.js']) {
    assert.throws(() => applyFiles([{ path: bad, data: Buffer.from('x') }], root), /caminho estranho/);
  }
});

test('lê a release mais nova do GitHub, e sem release devolve null', async () => {
  globalThis.fetch = async (url, opts) => {
    assert.match(url, /api\.github\.com\/repos\/RicardooFilho\/idlelive\/releases\/latest/);
    assert.ok(opts.headers['User-Agent']);
    return new Response(JSON.stringify({ tag_name: 'v1.2.0', html_url: 'https://x/rel', body: 'notas', tarball_url: 'https://x/tar' }));
  };
  assert.deepEqual(await fetchLatest(), { version: '1.2.0', url: 'https://x/rel', notes: 'notas', tarball: 'https://x/tar' });
  globalThis.fetch = async () => new Response('{}', { status: 404 });
  assert.equal(await fetchLatest(), null);
});

// Pasta de um jogador: package.json na versão 1.0.0, sem .git.
function appDir(version = '1.0.0') {
  const root = tmpDir();
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version }));
  fs.writeFileSync(path.join(root, 'server.js'), 'velho');
  return root;
}
const fakeGitHub = (version, files) => async (url) => url.includes('/releases/latest')
  ? new Response(JSON.stringify({ tag_name: `v${version}`, html_url: 'https://x/rel', tarball_url: 'https://x/tar' }))
  : new Response(tarball(files));

test('procura e instala a versão nova', async () => {
  const root = appDir();
  const updater = new Updater({ root });
  globalThis.fetch = fakeGitHub('1.1.0', { 'package.json': JSON.stringify({ version: '1.1.0' }), 'server.js': 'novo' });
  await updater.check();
  assert.equal(updater.state().available, true);
  assert.equal(updater.state().latest, '1.1.0');
  assert.deepEqual(await updater.install(), { version: '1.1.0', launcherChanged: false });
  assert.equal(fs.readFileSync(path.join(root, 'server.js'), 'utf8'), 'novo');
  assert.equal(updater.state().installed, '1.1.0');
  assert.equal(updater.state().available, false);
});

test('sem versão nova, não instala', async () => {
  const updater = new Updater({ root: appDir('1.1.0') });
  globalThis.fetch = fakeGitHub('1.1.0', {});
  await updater.check();
  assert.equal(updater.state().available, false);
  await assert.rejects(updater.install(), /não há versão nova/);
});

test('download com versão diferente da release não grava nada', async () => {
  const root = appDir();
  const updater = new Updater({ root });
  globalThis.fetch = fakeGitHub('1.1.0', { 'package.json': JSON.stringify({ version: '1.0.5' }), 'server.js': 'errado' });
  await updater.check();
  await assert.rejects(updater.install(), /não é a versão esperada/);
  assert.equal(fs.readFileSync(path.join(root, 'server.js'), 'utf8'), 'velho');
  assert.equal(updater.state().installing, false);
});

test('pasta com git só avisa, não instala', async () => {
  const root = appDir();
  fs.mkdirSync(path.join(root, '.git'));
  const updater = new Updater({ root });
  globalThis.fetch = fakeGitHub('1.1.0', {});
  await updater.check();
  assert.equal(updater.state().available, true);
  assert.equal(updater.state().canInstall, false);
  await assert.rejects(updater.install(), /git/);
});

test('erro de rede ao procurar vira aviso, sem derrubar nada', async () => {
  const updater = new Updater({ root: appDir() });
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };
  await updater.check();
  assert.match(updater.state().error, /fetch failed/);
  assert.equal(updater.state().available, false);
  assert.equal(updater.state().checking, false);
});
