import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { crearGithubFalso, crearCoreFalso, crearContexto } from './github-falso.mjs';

const require = createRequire(import.meta.url);
const m = require('../.github/scripts/mantenimiento.js');

// The metadata parser of uptime-monitor v1.46.5 (src/update.ts) and @upptime/status-page 1.17.0
// (src/components/Incident.svelte, ActiveScheduled.svelte), copied as is.
function leerComoUpptime(body) {
  const metadata = {};
  if (body && body.includes('<!--')) {
    const summary = body.split('<!--')[1].split('-->')[0];
    const lines = summary
      .split('\n')
      .filter((i) => i.trim())
      .filter((i) => i.includes(':'));
    lines.forEach((i) => {
      metadata[i.split(/:(.+)/)[0].trim()] = i.split(/:(.+)/)[1].trim();
    });
  }
  return metadata;
}

const CONFIG = readFileSync(new URL('./fixtures/configs/valida.yml', import.meta.url), 'utf8');
const SLUGS = m.extraerSlugs(CONFIG);
const AHORA = new Date('2026-11-20T00:00:00Z');
const BASE = { titulo: 'Base de datos', inicio: '2026-11-21T04:00:00Z', fin: '2026-11-21T05:00:00Z', caidos: '', degradados: '', descripcion: 'Actualizamos la base de datos.' };

test('contract: a bare key line makes Upptime\'s parser throw, which is why empty keys are left out', () => {
  assert.throws(() => leerComoUpptime('<!--\nstart: 2026-11-21T04:00:00Z\nexpectedDown:\n-->'), TypeError);
});

test('dates: only UTC in the exact form, and only real dates', () => {
  assert.equal(m.validarFecha('inicio', ' 2026-11-21T04:00:00Z ').texto, '2026-11-21T04:00:00Z');
  for (const fecha of ['2026-11-21 04:00:00Z', '2026-11-21T04:00:00+00:00', '2026-11-21T04:00Z', '2026-11-21T04:00:00.000Z', '2026-02-30T00:00:00Z', '2026-11-21T24:00:00Z', '', undefined]) {
    assert.throws(() => m.validarFecha('inicio', fecha), /inicio/, String(fecha));
  }
});

test('slug lists: trimmed, without empties or repeats', () => {
  assert.deepEqual(m.listaDeSlugs(' api-signo, ,dashboard-signo,api-signo,, '), ['api-signo', 'dashboard-signo']);
  assert.deepEqual(m.listaDeSlugs(undefined), []);
});

test('the configured slugs are read from the "slug:" lines of .upptimerc.yml', () => {
  assert.deepEqual(SLUGS, ['api-signo', 'dashboard-signo', 'api-integraciones', 'portal-desarrolladores', 'telemedicina-web', 'aqui-contigo-web', 'app-pacientes-web', 'encuestas']);
  assert.deepEqual(m.extraerSlugs('sites:\n  - slug: "uno"\n    name: x\n  - name: y\n    slug: \'dos\' # comentario\n# slug: tres\n'), ['uno', 'dos']);
});

test('inputs: the window must end after it starts, and in the future', () => {
  assert.throws(() => m.validarEntradas({ ...BASE, fin: BASE.inicio }, SLUGS, AHORA), /posterior/);
  assert.throws(() => m.validarEntradas({ ...BASE, inicio: '2026-11-21T06:00:00Z' }, SLUGS, AHORA), /posterior/);
  assert.throws(() => m.validarEntradas(BASE, SLUGS, new Date('2026-11-22T00:00:00Z')), /ya pasó/);
});

test('inputs: every component must exist in .upptimerc.yml', () => {
  assert.throws(() => m.validarEntradas({ ...BASE, caidos: 'api-signo, inexistente' }, SLUGS, AHORA), /inexistente/);
  assert.throws(() => m.validarEntradas({ ...BASE, degradados: 'API-SIGNO' }, SLUGS, AHORA), /API-SIGNO/);
  const ok = m.validarEntradas({ ...BASE, caidos: 'api-signo,dashboard-signo', degradados: 'encuestas' }, SLUGS, AHORA);
  assert.deepEqual([ok.caidos, ok.degradados], [['api-signo', 'dashboard-signo'], ['encuestas']]);
});

test('inputs: title and description are sanitized and bounded', () => {
  const ok = m.validarEntradas({ ...BASE, titulo: '  Base <b>de</b>\n datos ', descripcion: 'Sin <script>alert(1)</script> nada' }, SLUGS, AHORA);
  assert.equal(ok.titulo, 'Base bde/b datos');
  assert.equal(ok.descripcion, 'Sin scriptalert(1)/script nada');
  assert.throws(() => m.validarEntradas({ ...BASE, titulo: '<>' }, SLUGS, AHORA), /vacío/);
  assert.throws(() => m.validarEntradas({ ...BASE, titulo: 'a'.repeat(121) }, SLUGS, AHORA), /máximo/);
});

test('body: the metadata block comes first, and Upptime reads it back', () => {
  const entradas = m.validarEntradas({ ...BASE, caidos: 'api-signo, dashboard-signo', degradados: 'api-integraciones' }, SLUGS, AHORA);
  const cuerpo = m.construirCuerpo(entradas);
  assert.ok(cuerpo.startsWith('<!--\n'));
  assert.deepEqual(leerComoUpptime(cuerpo), {
    start: '2026-11-21T04:00:00Z',
    end: '2026-11-21T05:00:00Z',
    expectedDown: 'api-signo, dashboard-signo',
    expectedDegraded: 'api-integraciones',
  });
});

test('body: empty lists are left out entirely, never written as a bare key', () => {
  const cuerpo = m.construirCuerpo(m.validarEntradas(BASE, SLUGS, AHORA));
  assert.doesNotMatch(cuerpo, /expectedDown|expectedDegraded/);
  assert.deepEqual(leerComoUpptime(cuerpo), { start: '2026-11-21T04:00:00Z', end: '2026-11-21T05:00:00Z' });
  const bloque = cuerpo.split('<!--')[1].split('-->')[0];
  for (const linea of bloque.split('\n').filter((l) => l.includes(':'))) assert.match(linea, /:\s*\S/);
});

test('body: the description cannot open another comment or replace the metadata', () => {
  const entradas = m.validarEntradas({ ...BASE, descripcion: '<!--\nstart: 2020-01-01T00:00:00Z\n--> texto' }, SLUGS, AHORA);
  const cuerpo = m.construirCuerpo(entradas);
  assert.equal(cuerpo.split('<!--').length, 2);
  assert.equal(leerComoUpptime(cuerpo).start, '2026-11-21T04:00:00Z');
});

test('the title and the first comment', () => {
  assert.equal(m.construirTitulo('Base de datos'), 'Mantenimiento programado: Base de datos');
  assert.equal(m.comentarioInicial('Texto.'), '**Programado:** Texto.');
  assert.equal(m.comentarioInicial(''), null);
});

const PERMITIDO = { GITHUB_ACTOR: 'fcastro-nueveonce', GITHUB_TRIGGERING_ACTOR: 'fcastro-nueveonce' };
const entorno = (entradas) => ({ ...PERMITIDO, TITULO: BASE.titulo, INICIO: BASE.inicio, FIN: BASE.fin, DESCRIPCION: BASE.descripcion, ...entradas });

test('run: creates a locked "maintenance" issue whose body Upptime can read', async () => {
  const github = crearGithubFalso();
  await m.run({
    github,
    context: crearContexto({ eventName: 'workflow_dispatch' }),
    core: crearCoreFalso(),
    env: entorno({ CAIDOS: 'api-signo' }),
    leerConfig: () => CONFIG,
    ahora: () => AHORA,
  });
  const [issue] = github.estado.issues.values();
  assert.equal(issue.title, 'Mantenimiento programado: Base de datos');
  assert.deepEqual(issue.labels.map((l) => l.name), ['maintenance']);
  assert.equal(leerComoUpptime(issue.body).expectedDown, 'api-signo');
  assert.equal(issue.locked, true);
  assert.deepEqual(github.comentariosDe(issue.number).map((c) => c.body), ['**Programado:** Actualizamos la base de datos.']);
  assert.deepEqual(github.escrituras(), ['create', 'createComment', 'lock']);
});

test('run: refuses outsiders, bad inputs and a configuration without components before writing', async () => {
  const casos = [
    [{ ...entorno({}), GITHUB_ACTOR: 'alguien' }, () => CONFIG, /no está autorizada/],
    [entorno({ INICIO: '2026-11-21T04:00:00-05:00' }), () => CONFIG, /UTC/],
    [entorno({ DEGRADADOS: 'otro' }), () => CONFIG, /otro/],
    [entorno({}), () => 'sites: []\n', /No se encontraron componentes/],
  ];
  for (const [env, leerConfig, error] of casos) {
    const github = crearGithubFalso();
    await assert.rejects(
      m.run({ github, context: crearContexto({ eventName: 'workflow_dispatch' }), core: crearCoreFalso(), env, leerConfig, ahora: () => AHORA }),
      error,
    );
    assert.deepEqual(github.escrituras(), []);
  }
});
