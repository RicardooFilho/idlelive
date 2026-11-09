import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Pasta temporária no lugar da raiz: stats.js lê stats.json assim que é importado.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idlelive-test-'));
process.env.IDLELIVE_DATA_DIR = dataDir;
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const { recordPoints, pointsHistory, recordMinute, liveHours } = await import('../src/stats.js');

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
  assert.deepEqual(pointsHistory().map((d) => d.day), ['2026-01-07', '2026-01-06', '2026-01-05']);
  assert.deepEqual(pointsHistory(2).map((d) => d.day), ['2026-01-07', '2026-01-06']);
});

test('guarda só os últimos 60 dias', () => {
  const start = new RealDate('2026-02-01T12:00:00');
  for (let i = 0; i < 70; i++) {
    const d = new RealDate(start);
    d.setDate(d.getDate() + i);
    fixDay(d.toLocaleDateString('sv-SE'));
    recordPoints('ana', 'WATCH', 1);
  }
  const days = pointsHistory(1000).map((d) => d.day);
  assert.equal(days.length, 60);
  assert.equal(days[0], new RealDate(2026, 1, 1 + 69).toLocaleDateString('sv-SE'));
});

test('recordMinute grava stats.json na pasta de dados e alimenta liveHours', () => {
  recordMinute({ twitchLive: ['cogu'], kickLive: null });
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'stats.json'), 'utf8'));
  const hour = new Date().getHours();
  assert.equal(saved.observed.twitch[hour], 1);
  assert.equal(saved.live.twitch.cogu[hour], 1);
  assert.equal(saved.observed.kick[hour], 0); // Kick sem resposta (null) não conta como observada
  // Com pouca observação, liveHours ainda não arrisca um palpite.
  assert.equal(liveHours('twitch', 'cogu')[hour], null);
  assert.equal(fs.existsSync(path.join(dataDir, 'stats.json.tmp')), false);
});
