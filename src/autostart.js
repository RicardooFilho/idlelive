// "Iniciar com o Windows": um atalho na pasta Inicializar do usuário que abre o painel minimizado.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const STARTUP = path.join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const LINK = path.join(STARTUP, 'Painel de Lives.lnk');

export const autostartEnabled = () => fs.existsSync(LINK);

export function setAutostart(enabled) {
  if (!enabled) {
    fs.rmSync(LINK, { force: true });
    return;
  }
  // WindowStyle 7 = minimizado. "--windows" faz o iniciar.bat não abrir o navegador ao ligar o PC.
  const script = `
    $s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:LINK)
    $s.TargetPath = $env:TARGET
    $s.Arguments = '--windows'
    $s.WorkingDirectory = $env:DIR
    $s.WindowStyle = 7
    $s.Save()`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, LINK, TARGET: path.join(ROOT, 'iniciar.bat'), DIR: ROOT },
    windowsHide: true,
  });
  if (result.status !== 0 || !autostartEnabled()) throw new Error('Não deu para criar o atalho de inicialização');
}
