import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Pasta temporária no lugar da raiz: stats.js lê stats.json assim que é importado.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idlelive-test-'));
process.env.IDLELIVE_DATA_DIR = dataDir;
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

// Arquivo de uma versão antiga: além dos pontos, tinha os horários das lives e o tempo com boost.
const statsFile = path.join(dataDir, 'stats.json');
const readSaved = () => JSON.parse(fs.readFileSync(statsFile, 'utf8'));
fs.writeFileSync(statsFile, JSON.stringify({
  boost: { ana: 1 },
  observed: { twitch: Array(24).fill(5), kick: Array(24).fill(0) },
  live: { twitch: { cogu: Array(24).fill(1) }, kick: {} },
  points: { '2026-01-01': { ana: { WATCH: { points: 7, count: 1 } } } },
}));

const { recordPoints, pointsHistory, saveStats } = await import('../src/stats.js');

const RealDate = Date;

// Fixa o "agora" no meio-dia local do dia pedido (recordPoints anota pelo dia do horário local).
const fixDay = (day) => {
  const ms = new RealDate(`${day}T12:00:00`).getTime();
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      if (args.length) super(...args);
      else super(ms);
    }
    static now() {
      return ms;
    }
  };
};

afterEach(() => {
  globalThis.Date = RealDate;
});

test('ao abrir, tira os restos de versões antigas e mantém os pontos', () => {
  saveStats();
  assert.deepEqual(readSaved(), { points: { '2026-01-01': { ana: { WATCH: { points: 7, count: 1 } } } } });
});

test('saveStats grava só quando algo mudou', () => {
  fs.rmSync(statsFile);
  saveStats();
  assert.equal(fs.existsSync(statsFile), false);
  fixDay('2026-01-02');
  recordPoints('ana', 'WATCH', 3);
  saveStats();
  assert.deepEqual(readSaved().points['2026-01-02'], { ana: { WATCH: { points: 3, count: 1 } } });
  assert.equal(fs.existsSync(`${statsFile}.tmp`), false);
});

test('recordPoints soma pontos e vezes por conta, dia e motivo', () => {
  fixDay('2026-01-05');
  recordPoints('ana', 'WATCH', 10);
  recordPoints('ana', 'WATCH', 12);
  recordPoints('ana', 'CLAIM', 50);
  recordPoints('bia', 'WATCH', 10);
  const [today] = pointsHistory();
  assert.equal(today.day, '2026-01-05');
  assert.deepEqual(today.accounts, {
    ana: { WATCH: { points: 22, count: 2 }, CLAIM: { points: 50, count: 1 } },
    bia: { WATCH: { points: 10, count: 1 } },
  });
});

test('pointsHistory vem do dia mais recente e respeita o limite', () => {
  fixDay('2026-01-06');
  recordPoints('ana', 'WATCH', 1);
  fixDay('2026-01-07');
  recordPoints('ana', 'WATCH', 2);
  assert.deepEqual(pointsHistory().map((d) => d.day), ['2026-01-07', '2026-01-06', '2026-01-05', '2026-01-02', '2026-01-01']);
  assert.deepEqual(pointsHistory(2).map((d) => d.day), ['2026-01-07', '2026-01-06']);
});

test('guarda só os últimos 30 dias', () => {
  const start = new RealDate('2026-02-01T12:00:00');
  for (let i = 0; i < 70; i++) {
    const d = new RealDate(start);
    d.setDate(d.getDate() + i);
    fixDay(d.toLocaleDateString('sv-SE'));
    recordPoints('ana', 'WATCH', 1);
  }
  const days = pointsHistory(1000).map((d) => d.day);
  assert.equal(days.length, 30);
  assert.equal(days[0], new RealDate(2026, 1, 1 + 69).toLocaleDateString('sv-SE'));
  assert.equal(pointsHistory().length, 30); // sem limite pedido, manda tudo o que guarda
});
