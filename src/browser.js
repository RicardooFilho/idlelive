// Navegadores instalados (Chrome, Brave ou Edge), seus perfis e o botão ▶ que abre uma live no perfil de uma conta.
// Os três são baseados no Chromium e aceitam os mesmos comandos (--profile-directory).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const { LOCALAPPDATA = '', PROGRAMFILES, 'PROGRAMFILES(X86)': PROGRAMFILES_X86 } = process.env;
const INSTALL_DIRS = [PROGRAMFILES, PROGRAMFILES_X86, LOCALAPPDATA].filter(Boolean);

const BROWSERS = {
  chrome: { name: 'Chrome', dir: ['Google', 'Chrome'], exe: 'chrome.exe' },
  brave: { name: 'Brave', dir: ['BraveSoftware', 'Brave-Browser'], exe: 'brave.exe' },
  edge: { name: 'Edge', dir: ['Microsoft', 'Edge'], exe: 'msedge.exe' },
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

// Abre o endereço numa aba normal do navegador, no perfil (conta) escolhido. Sem perfil, no último perfil usado.
export function openInProfile(browserId, profileDir, url) {
  const browser = BROWSERS[browserId];
  const exe = browser && findExe(browser);
  if (!exe) throw new Error(`${browserName(browserId)} não encontrado neste PC`);
  const args = profileDir ? [`--profile-directory=${profileDir}`, url] : [url];
  const child = spawn(exe, args, { detached: true, stdio: 'ignore' });
  // Ex.: navegador sendo atualizado ou bloqueado pelo antivírus. Sem isso, o erro derrubaria o servidor.
  child.on('error', (err) => console.log(`Não deu para abrir o ${browserName(browserId)} (${err.message})`));
  child.unref();
}
