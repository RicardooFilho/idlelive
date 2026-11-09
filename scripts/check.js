// Confere a sintaxe de todos os .js do projeto (node --check), sem rodar nada.
// Script em vez de `find | xargs` para funcionar igual no Windows e no CI.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', '.git']);

const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) files.push(full);
  }
};
walk(ROOT);

let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    failed++;
    console.error(`✗ ${path.relative(ROOT, file)}\n${err.stderr}`);
  }
}
console.log(`${files.length - failed} de ${files.length} arquivos sem erro de sintaxe`);
process.exit(failed ? 1 : 0);
