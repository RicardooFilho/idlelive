// Texto da release no GitHub: as seções do CHANGELOG.md desde a release anterior.
// Uso: node scripts/release-notes.js [AAAA-MM-DD da release anterior]. Sem data, só a seção mais nova.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const since = process.argv[2];
const sections = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8').split(/^(?=## )/m).slice(1);

// "## 10/11/2026" -> "2026-11-10", para comparar como texto.
const dateOf = (section) => {
  const [, d, m, y] = section.match(/^## (\d{2})\/(\d{2})\/(\d{4})/) ?? [];
  return y ? `${y}-${m}-${d}` : '';
};
// Mesmo dia da release anterior entra também: pode ter mudado depois dela.
const picked = since ? sections.filter((s) => dateOf(s) >= since) : sections.slice(0, 1);
const body = (picked.length ? picked : sections.slice(0, 1)).join('').trim();
console.log(`${body}\n\n**Como atualizar:** no painel, clique em **Atualizar agora** no aviso do topo. Primeira vez? Baixe o **IdleLive.zip** abaixo, extraia e dê dois cliques no \`iniciar.bat\`.`);
