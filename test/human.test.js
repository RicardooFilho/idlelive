import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { restWindow, isResting, clock, random } from '../src/human.js';

const RealDate = Date;

// Troca o relógio do Date por um horário fixo. Feito à mão (e não com mock.timers) para rodar igual no Node 20 e 22.
const fixDate = (ms) => {
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

// Horário de Brasília (UTC-3, sem horário de verão desde 2019) em minutos do dia.
const brasilia = (day, minutes) => new RealDate(`${day}T00:00:00-03:00`).getTime() + minutes * 60 * 1000;

afterEach(() => {
  globalThis.Date = RealDate;
});

test('restWindow fica entre 5h e 8h, com até 20 min de variação', () => {
  fixDate(brasilia('2026-03-10', 12 * 60));
  for (let i = 0; i < 200; i++) {
    const { start, end } = restWindow(`conta-${i}`);
    assert.ok(start >= 5 * 60 - 20 && start <= 5 * 60 + 20, `início fora: ${start}`);
    assert.ok(end >= 8 * 60 - 20 && end <= 8 * 60 + 20, `fim fora: ${end}`);
    assert.ok(Number.isInteger(start) && Number.isInteger(end));
  }
});

test('restWindow é o mesmo para a mesma conta durante o dia todo', () => {
  fixDate(brasilia('2026-03-10', 1));
  const morning = restWindow('abc');
  fixDate(brasilia('2026-03-10', 23 * 60 + 58));
  assert.deepEqual(restWindow('abc'), morning);
});

test('restWindow muda entre contas e entre dias', () => {
  fixDate(brasilia('2026-03-10', 12 * 60));
  const seeds = Array.from({ length: 30 }, (_, i) => `conta-${i}`);
  const today = seeds.map((s) => restWindow(s));
  assert.ok(new Set(today.map((w) => w.start)).size > 1, 'todas as contas dormem na mesma hora');
  fixDate(brasilia('2026-03-11', 12 * 60));
  const tomorrow = seeds.map((s) => restWindow(s));
  assert.notDeepEqual(tomorrow, today);
});

test('restWindow usa o dia de Brasília, não o do UTC', () => {
  // 22h de Brasília já é o dia seguinte no UTC; tem que dar o mesmo horário das 12h.
  fixDate(brasilia('2026-03-10', 12 * 60));
  const noon = restWindow('abc');
  fixDate(brasilia('2026-03-10', 22 * 60));
  assert.deepEqual(restWindow('abc'), noon);
});

test('isResting segue a janela da conta, com início incluído e fim não', () => {
  fixDate(brasilia('2026-03-10', 12 * 60));
  const { start, end } = restWindow('conta-x');
  const at = (minutes) => {
    fixDate(brasilia('2026-03-10', minutes));
    return isResting('conta-x');
  };
  assert.equal(at(start - 1), false);
  assert.equal(at(start), true);
  assert.equal(at(6 * 60 + 30), true);
  assert.equal(at(end - 1), true);
  assert.equal(at(end), false);
  assert.equal(at(3 * 60), false);
  assert.equal(at(12 * 60), false);
});

test('clock formata minutos do dia como HH:MM', () => {
  assert.equal(clock(0), '00:00');
  assert.equal(clock(305), '05:05');
  assert.equal(clock(8 * 60 + 20), '08:20');
  assert.equal(clock(1439), '23:59');
});

test('random fica dentro do intervalo', (t) => {
  for (let i = 0; i < 1000; i++) {
    const n = random([10, 20]);
    assert.ok(n >= 10 && n <= 20, `fora do intervalo: ${n}`);
  }
  // Nas pontas do Math.random, dá exatamente o mínimo e quase o máximo.
  t.mock.method(Math, 'random', () => 0);
  assert.equal(random([10, 20]), 10);
  Math.random.mock.mockImplementation(() => 0.5);
  assert.equal(random([10, 20]), 15);
});
