// Abre lives numa janela pequena do Chrome, no perfil (conta) escolhido.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const USER_DATA = path.join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'User Data');

const CHROME_PATHS = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
  .filter(Boolean)
  .map((dir) => path.join(dir, 'Google', 'Chrome', 'Application', 'chrome.exe'));

export const findChrome = () => CHROME_PATHS.find((p) => fs.existsSync(p)) ?? null;

// Perfis do Chrome: [{ dir: 'Profile 1', name: 'Pessoal' }].
export function listProfiles() {
  try {
    const localState = JSON.parse(fs.readFileSync(path.join(USER_DATA, 'Local State'), 'utf8'));
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

// Uma janela por vez: o script identifica a janela nova comparando antes/depois.
let queue = Promise.resolve();
const enqueue = (task) => (queue = queue.then(task));

// Janelas abertas pelo painel: lugar (0-3) -> handles da janela.
const windows = new Map();

export const openWindowCount = () => windows.size;

function closeHandles(handles) {
  return handles.length ? runScript('close-windows.ps1', ['-Handles', handles.join(',')]) : Promise.resolve();
}

// Cada lugar tem uma janela só: abrir de novo no mesmo lugar fecha a anterior.
// Posição e tamanho em pixels físicos da tela.
export function openWatchWindow(slot, profileDir, url, { x, y, width, height }) {
  const chrome = findChrome();
  if (!chrome) throw new Error('Chrome não encontrado');
  const args = [
    '-Chrome', chrome, '-ProfileDir', profileDir, '-Url', url,
    '-X', x, '-Y', y, '-W', width, '-H', height,
  ].map((a) => (typeof a === 'number' ? String(Math.round(a)) : a));

  enqueue(async () => {
    const previous = windows.get(slot) ?? [];
    windows.delete(slot);
    await closeHandles(previous);
    const handles = (await runScript('open-window.ps1', args)).split(/\s+/).filter((h) => /^\d+$/.test(h));
    if (handles.length) windows.set(slot, handles);
  });
}

export function closeWatchWindows() {
  enqueue(() => {
    const handles = [...windows.values()].flat();
    windows.clear();
    return closeHandles(handles);
  });
}
