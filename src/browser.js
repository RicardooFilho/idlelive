// Abre lives numa janela pequena do navegador (Chrome, Brave ou Edge), no perfil (conta) escolhido.
// Os três são baseados no Chromium e aceitam os mesmos comandos (--profile-directory, --app).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const { LOCALAPPDATA = '', PROGRAMFILES, 'PROGRAMFILES(X86)': PROGRAMFILES_X86 } = process.env;
const INSTALL_DIRS = [PROGRAMFILES, PROGRAMFILES_X86, LOCALAPPDATA].filter(Boolean);

// process = nome do processo no Windows, usado para achar as janelas novas.
const BROWSERS = {
  chrome: { name: 'Chrome', dir: ['Google', 'Chrome'], exe: 'chrome.exe', process: 'chrome' },
  brave: { name: 'Brave', dir: ['BraveSoftware', 'Brave-Browser'], exe: 'brave.exe', process: 'brave' },
  edge: { name: 'Edge', dir: ['Microsoft', 'Edge'], exe: 'msedge.exe', process: 'msedge' },
};

const findExe = ({ dir, exe }) =>
  INSTALL_DIRS.map((base) => path.join(base, ...dir, 'Application', exe)).find((p) => fs.existsSync(p)) ?? null;

// Navegadores instalados, na ordem de preferência: [{ id: 'chrome', name: 'Chrome' }].
export const installedBrowsers = () =>
  Object.entries(BROWSERS).filter(([, b]) => findExe(b)).map(([id, b]) => ({ id, name: b.name }));

export const browserName = (id) => BROWSERS[id]?.name ?? id;

// Perfis do navegador: [{ dir: 'Profile 1', name: 'Pessoal' }].
export function listProfiles(browserId) {
  const browser = BROWSERS[browserId];
  if (!browser) return [];
  try {
    const localState = JSON.parse(fs.readFileSync(path.join(LOCALAPPDATA, ...browser.dir, 'User Data', 'Local State'), 'utf8'));
    return Object.entries(localState.profile?.info_cache ?? {})
      .map(([dir, info]) => ({ dir, name: info.name || dir }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));

function runScript(name, args) {
  return new Promise((resolve) => {
    let out = '';
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(SCRIPTS, name), ...args], {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    child.stdout.on('data', (chunk) => (out += chunk));
    child.on('exit', () => resolve(out));
    child.on('error', () => resolve(out));
  });
}

// Abre o endereço numa aba normal do navegador, no perfil (conta) escolhido. Sem perfil, no último perfil usado.
export function openInProfile(browserId, profileDir, url) {
  const browser = BROWSERS[browserId];
  const exe = browser && findExe(browser);
  if (!exe) throw new Error(`${browserName(browserId)} não encontrado neste PC`);
  const args = profileDir ? [`--profile-directory=${profileDir}`, url] : [url];
  spawn(exe, args, { detached: true, stdio: 'ignore' }).unref();
}

// Uma janela por vez: o script identifica a janela nova comparando antes/depois.
let queue = Promise.resolve();
const enqueue = (task) => (queue = queue.then(task));

// Janelas abertas pelo painel: lugar (0-3) -> { handles, profileDir, url }.
const windows = new Map();

export const openWindowCount = () => windows.size;
export const openWindowList = () => [...windows.values()].map(({ profileDir, url }) => ({ profileDir, url }));

function closeHandles(handles) {
  return handles.length ? runScript('close-windows.ps1', ['-Handles', handles.join(',')]) : Promise.resolve();
}

// Cada lugar tem uma janela só: abrir de novo no mesmo lugar fecha a anterior.
// Posição e tamanho em pixels físicos da tela.
export function openWatchWindow(browserId, slot, profileDir, url, { x, y, width, height }) {
  const browser = BROWSERS[browserId];
  const exe = browser && findExe(browser);
  if (!exe) throw new Error(`${browserName(browserId)} não encontrado neste PC`);
  const args = [
    '-Browser', exe, '-Process', browser.process, '-ProfileDir', profileDir, '-Url', url,
    '-X', x, '-Y', y, '-W', width, '-H', height,
  ].map((a) => (typeof a === 'number' ? String(Math.round(a)) : a));

  enqueue(async () => {
    const previous = windows.get(slot)?.handles ?? [];
    windows.delete(slot);
    await closeHandles(previous);
    const handles = (await runScript('open-window.ps1', args)).split(/\s+/).filter((h) => /^\d+$/.test(h));
    if (handles.length) windows.set(slot, { handles, profileDir, url });
  });
}

export function closeWatchWindows() {
  enqueue(() => {
    const handles = [...windows.values()].flatMap((w) => w.handles);
    windows.clear();
    return closeHandles(handles);
  });
}
