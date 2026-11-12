import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CODIGO = readFileSync(new URL('../assets/estado-es.js', import.meta.url), 'utf8');

// Loads the page script with the test flag set: it hands back its pure functions and starts
// nothing on the page. Same realm as the tests, so arrays and objects compare normally.
function cargar() {
  const pruebas = {};
  const ventana = { __nueveonceEstadoPruebas: pruebas };
  const documento = { documentElement: { setAttribute() {} } };
  new Function('window', 'document', CODIGO)(ventana, documento);
  return pruebas.funciones;
}

const f = cargar();
const DIA = 24 * 60 * 60 * 1000;
const AHORA = Date.parse('2026-11-20T15:30:00Z');
const INICIO = Date.parse('2026-11-12T05:06:35Z');
const porClave = (dias) => Object.fromEntries(dias.map((d) => [d.key, d]));

test('dayKey uses the UTC day, like the keys of dailyMinutesDown', () => {
  assert.equal(f.dayKey(Date.parse('2026-11-12T23:59:59Z')), '2026-11-12');
  assert.equal(f.dayKey(Date.parse('2026-11-13T00:00:00Z')), '2026-11-13');
});

test('buildDays: 90 days, oldest first, today last', () => {
  const dias = f.buildDays(AHORA, INICIO, {});
  assert.equal(dias.length, 90);
  assert.equal(dias[0].key, '2026-08-23');
  assert.equal(dias[89].key, '2026-11-20');
});

test('buildDays: the days before monitoring started have no data, and the first day counts', () => {
  const dias = f.buildDays(AHORA, INICIO, {});
  const d = porClave(dias);
  assert.equal(d['2026-11-11'].state, 'sin-datos');
  assert.equal(d['2026-11-12'].state, 'ok');
  assert.equal(d['2026-11-20'].state, 'ok');
  assert.equal(dias.filter((x) => x.state === 'sin-datos').length, 81);
});

test('buildDays: the state follows the minutes without service of the day', () => {
  const minutos = { '2026-11-14': 5, '2026-11-15': 29, '2026-11-16': 30, '2026-11-17': 119, '2026-11-18': 120, '2026-11-19': 0 };
  const d = porClave(f.buildDays(AHORA, INICIO, minutos));
  assert.equal(d['2026-11-14'].state, 'menor');
  assert.equal(d['2026-11-14'].minutes, 5);
  assert.equal(d['2026-11-15'].state, 'menor');
  assert.equal(d['2026-11-16'].state, 'parcial');
  assert.equal(d['2026-11-17'].state, 'parcial');
  assert.equal(d['2026-11-18'].state, 'mayor');
  assert.equal(d['2026-11-19'].state, 'ok');
});

test('buildDays: a recorded outage shows even before the start, and unusable values count as none', () => {
  const d = porClave(f.buildDays(AHORA, INICIO, { '2026-11-10': 45, '2026-11-13': 'x', '2026-11-14': -3 }));
  assert.equal(d['2026-11-10'].state, 'parcial');
  assert.equal(d['2026-11-13'].state, 'ok');
  assert.equal(d['2026-11-14'].state, 'ok');
  assert.equal(d['2026-11-14'].minutes, 0);
});

test('buildDays: without minutes per day every monitored day is fine', () => {
  const d = porClave(f.buildDays(AHORA, INICIO, null));
  assert.equal(d['2026-11-15'].state, 'ok');
});

test('availability: no outage is 100 %', () => {
  assert.equal(f.availability(AHORA, INICIO, {}), 1);
});

test('availability: only the monitored minutes inside the 90-day window count', () => {
  const monitoreados = (AHORA - INICIO) / 60000;
  assert.equal(f.availability(AHORA, INICIO, { '2026-11-14': 60 }), 1 - 60 / monitoreados);
  // Monitored for longer than the window: the window starts the count, and an older outage
  // does not count.
  const inicioAntiguo = Date.parse('2026-01-01T00:00:00Z');
  const ventana = (AHORA - (Date.parse('2026-11-20T00:00:00Z') - 89 * DIA)) / 60000;
  assert.equal(f.availability(AHORA, inicioAntiguo, { '2026-08-01': 600, '2026-11-14': 60 }), 1 - 60 / ventana);
});

test('availability: nothing monitored yet is null, and the result stays between 0 and 1', () => {
  assert.equal(f.availability(INICIO - 1000, INICIO, {}), null);
  assert.equal(f.availability(AHORA, INICIO, { '2026-11-14': 1e9 }), 0);
});

test('formatPercent never rounds up to 100 and uses a decimal comma', () => {
  assert.equal(f.formatPercent(1), '100 %');
  assert.equal(f.formatPercent(0.99999), '99,99 %');
  assert.equal(f.formatPercent(0.9999), '99,99 %');
  assert.equal(f.formatPercent(0.5), '50,00 %');
  assert.equal(f.formatPercent(0), '0,00 %');
  assert.equal(f.formatPercent(null), null);
});

test('describeDay explains each bar in Spanish', () => {
  const d = porClave(f.buildDays(AHORA, INICIO, { '2026-11-14': 1, '2026-11-15': 95 }));
  assert.match(f.describeDay(d['2026-11-11']), /^11 nov\.? 2026: sin datos$/);
  assert.match(f.describeDay(d['2026-11-13']), /^13 nov\.? 2026: sin interrupciones registradas$/);
  assert.match(f.describeDay(d['2026-11-14']), /: 1 minuto sin servicio$/);
  assert.match(f.describeDay(d['2026-11-15']), /: 95 minutos sin servicio$/);
});

test('describePeriod sums up the bars for screen readers', () => {
  const sinProblemas = f.buildDays(AHORA, INICIO, {});
  assert.equal(f.describePeriod(sinProblemas, 1), 'Disponibilidad en los últimos 90 días: 100 %. Ningún día con interrupciones.');
  const conProblemas = f.buildDays(AHORA, INICIO, { '2026-11-14': 1, '2026-11-15': 95 });
  assert.match(f.describePeriod(conProblemas, 0.99), /: 99,00 %\. 2 días con interrupciones\.$/);
  const uno = f.buildDays(AHORA, INICIO, { '2026-11-14': 1 });
  assert.match(f.describePeriod(uno, 0.999), /\. 1 día con interrupciones\.$/);
  assert.equal(f.describePeriod(sinProblemas, null), 'Sin datos de disponibilidad en los últimos 90 días.');
});

test('startFromHistory reads startTime from a history file', () => {
  const yml = 'url: https://example.test\nstatus: up\nstartTime: 2026-11-12T05:06:35.240Z\ngenerator: Upptime\n';
  assert.equal(f.startFromHistory(yml), Date.parse('2026-11-12T05:06:35.240Z'));
  assert.ok(Number.isNaN(f.startFromHistory('status: up\n')));
  assert.ok(Number.isNaN(f.startFromHistory('startTime: ayer\n')));
  assert.ok(Number.isNaN(f.startFromHistory(null)));
});

test('slugFromLink takes the slug of a component page only', () => {
  assert.equal(f.slugFromLink('https://Grupo-Nuevo-Once.github.io/nueveonce-status/history/api-signo'), 'api-signo');
  assert.equal(f.slugFromLink('/nueveonce-status/history/encuestas/'), 'encuestas');
  assert.equal(f.slugFromLink('https://grupo-nuevo-once.github.io/nueveonce-status/incident/7'), null);
  assert.equal(f.slugFromLink(null), null);
});

test('stripLeadingSymbols removes the emoji in front of the banner text', () => {
  assert.equal(f.stripLeadingSymbols('✅   Todos los servicios funcionan con normalidad'), 'Todos los servicios funcionan con normalidad');
  assert.equal(f.stripLeadingSymbols('\u{1F7E7} Interrupción parcial'), 'Interrupción parcial');
  assert.equal(f.stripLeadingSymbols('Él ya no tiene'), 'Él ya no tiene');
  assert.equal(f.stripLeadingSymbols('✅ '), '');
});
