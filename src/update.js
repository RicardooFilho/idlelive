// Atualizador: vê se saiu versão nova no GitHub Releases e instala sem o jogador mexer em git.
// A versão é a do package.json; a release é a tag "v<versão>" (criada pelo .github/workflows/release.yml).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const REPO = 'RicardooFilho/idlelive';
const APP_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_INTERVAL = 6 * 60 * 60 * 1000; // a API do GitHub aceita 60 pedidos por hora sem login; 4 por dia sobra
const LAUNCHER = 'iniciar.bat';

// Arquivos do jogador: nunca são trocados, mesmo se um dia vierem na release. O config.json vem com a lista de
// parceiros, mas depois é do jogador (canais que ele adicionou ou tirou), então só é criado se ainda não existir.
const PROTECTED = new Set(['accounts.json', 'kick.json', 'points.json', 'lolidle.json', 'stats.json', '.token.json', 'eventos.jsonl']);
const KEEP_IF_EXISTS = new Set(['config.json']);

// "1.10.0" > "1.9.2". Aceita "v" na frente; partes que faltam contam como 0.
export function compareVersions(a, b) {
  const parts = (v) => String(v).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff) return Math.sign(diff);
  }
  return 0;
}

// Lê um .tar.gz (o "Source code" que o GitHub gera para cada release) e devolve [{ path, data }] só com os arquivos.
// Tira a primeira pasta (o GitHub põe tudo dentro de "<dono>-<repo>-<commit>/").
export function readTarball(gz) {
  const tar = zlib.gunzipSync(gz);
  const files = [];
  const text = (start, len) => tar.subarray(start, start + len).toString('utf8').replace(/\0.*$/s, '');
  let longPath = null; // caminho comprido vem num cabeçalho PAX ("x") antes do arquivo
  for (let pos = 0; pos + 512 <= tar.length;) {
    const header = tar.subarray(pos, pos + 512);
    if (header.every((b) => b === 0)) break; // fim do arquivo
    const size = parseInt(text(pos + 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(header[156]);
    const prefix = text(pos + 257, 6) === 'ustar' ? text(pos + 345, 155) : '';
    const name = prefix ? `${prefix}/${text(pos, 100)}` : text(pos, 100);
    const data = tar.subarray(pos + 512, pos + 512 + size);
    pos += 512 + Math.ceil(size / 512) * 512;

    if (type === 'x') {
      longPath = data.toString('utf8').match(/^\d+ path=(.*)$/m)?.[1] ?? null;
      continue;
    }
    const full = longPath ?? name;
    longPath = null;
    if (type !== '0' && type !== '\0') continue; // pastas, links e o cabeçalho global ("g") do GitHub
    const rel = full.split('/').slice(1).join('/');
    if (rel) files.push({ path: rel, data: Buffer.from(data) });
  }
  return files;
}

// Caminho seguro: relativo, sem "..", sem letra de disco e fora do .git.
const safePath = (rel) => {
  const parts = rel.replace(/\\/g, '/').split('/');
  return !path.isAbsolute(rel) && !/^[a-z]:/i.test(rel) && parts.every((p) => p && p !== '.' && p !== '..') && parts[0] !== '.git';
};

// .bat e .ps1 precisam de CRLF no Windows (o cmd se perde com "goto" só com LF).
const fixLineEndings = (rel, data) => /\.(bat|ps1)$/i.test(rel) ? Buffer.from(data.toString('utf8').replace(/\r?\n/g, '\r\n')) : data;

// Grava os arquivos da versão nova na pasta. Só troca o que mudou, e grava cada um num .tmp antes de trocar.
// Devolve { written, launcherChanged }: com o iniciar.bat trocado, o cmd que está rodando ele pode se perder,
// então o painel pede para fechar a janela e abrir de novo em vez de reiniciar sozinho.
export function applyFiles(files, root = APP_ROOT) {
  const pending = [];
  for (const file of files) {
    if (!safePath(file.path)) throw new Error(`caminho estranho na atualização: ${file.path}`);
    const name = path.basename(file.path);
    if (PROTECTED.has(name) && !file.path.includes('/')) continue;
    const target = path.join(root, file.path);
    if (KEEP_IF_EXISTS.has(file.path) && fs.existsSync(target)) continue;
    const data = fixLineEndings(file.path, file.data);
    if (fs.existsSync(target) && fs.readFileSync(target).equals(data)) continue;
    pending.push({ rel: file.path.replace(/\\/g, '/'), target, data });
  }
  // Escreve tudo nos .tmp primeiro: se faltar espaço ou der erro no meio, nenhum arquivo de verdade foi trocado.
  for (const p of pending) {
    fs.mkdirSync(path.dirname(p.target), { recursive: true });
    fs.writeFileSync(`${p.target}.update-tmp`, p.data);
  }
  for (const p of pending) fs.renameSync(`${p.target}.update-tmp`, p.target);
  const written = pending.map((p) => p.rel);
  return { written, launcherChanged: written.includes(LAUNCHER) };
}

// Última release publicada, ou null se ainda não tem nenhuma.
export async function fetchLatest() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'IdleLive' },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub respondeu ${res.status}`);
  const data = await res.json();
  return {
    version: String(data.tag_name ?? '').replace(/^v/i, ''),
    url: data.html_url,
    notes: data.body ?? '',
    tarball: data.tarball_url,
  };
}

export class Updater {
  constructor({ log = () => {}, root = APP_ROOT } = {}) {
    this.log = log;
    this.root = root;
    this.current = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version ?? '0.0.0';
    // Pasta do git (quem programa): atualizar por cima bagunçaria o repositório, então só avisa.
    this.git = fs.existsSync(path.join(root, '.git'));
    this.latest = null;
    this.checkedAt = 0;
    this.checking = null;
    this.installing = false;
    this.installed = null; // versão já gravada, esperando reiniciar
    this.error = null;
  }

  get available() {
    return !!this.latest && compareVersions(this.latest.version, this.current) > 0;
  }

  state() {
    return {
      current: this.current,
      latest: this.latest?.version ?? null,
      url: this.latest?.url ?? `https://github.com/${REPO}/releases`,
      available: this.available && !this.installed,
      canInstall: !this.git,
      checking: !!this.checking,
      installing: this.installing,
      installed: this.installed,
      checkedAt: this.checkedAt || null,
      error: this.error,
    };
  }

  // Pedidos ao mesmo tempo (o automático e o botão) dividem a mesma consulta.
  check() {
    this.checking ??= fetchLatest()
      .then((latest) => {
        this.latest = latest;
        this.error = null;
        if (this.available) this.log(`Atualização: versão ${latest.version} disponível (esta é a ${this.current})`);
      })
      .catch((err) => {
        this.error = `não deu para procurar atualização (${err.message})`;
        this.log(`Atualização: ${this.error}`);
      })
      .finally(() => {
        this.checkedAt = Date.now();
        this.checking = null;
      });
    return this.checking;
  }

  start() {
    // Espera o painel abrir antes da primeira consulta.
    setTimeout(() => this.check(), 30 * 1000);
    setInterval(() => this.check(), CHECK_INTERVAL);
  }

  // Baixa e grava a versão nova. Devolve { version, launcherChanged }.
  async install() {
    if (this.git) throw new Error('esta pasta usa git; atualize com git pull ou baixe o zip da release');
    if (this.installing) throw new Error('a atualização já está em andamento');
    if (!this.available) throw new Error('não há versão nova');
    this.installing = true;
    const { version, tarball } = this.latest;
    try {
      this.log(`Atualização: baixando a versão ${version}…`);
      const res = await fetch(tarball, { headers: { 'User-Agent': 'IdleLive' } });
      if (!res.ok) throw new Error(`GitHub respondeu ${res.status} ao baixar`);
      const files = readTarball(Buffer.from(await res.arrayBuffer()));
      // Confere se veio mesmo o IdleLive na versão esperada antes de gravar qualquer coisa.
      const pkg = files.find((f) => f.path === 'package.json');
      const got = pkg && JSON.parse(pkg.data.toString('utf8')).version;
      if (!files.some((f) => f.path === 'server.js') || compareVersions(got, version) !== 0) {
        throw new Error('o arquivo baixado não é a versão esperada');
      }
      const { written, launcherChanged } = applyFiles(files, this.root);
      this.installed = version;
      this.log(`Atualização: versão ${version} instalada (${written.length} arquivo(s) trocado(s))`);
      return { version, launcherChanged };
    } finally {
      this.installing = false;
    }
  }
}
