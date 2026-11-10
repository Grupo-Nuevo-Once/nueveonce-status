import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { crearGithubFalso, crearCoreFalso, crearContexto } from './github-falso.mjs';

const require = createRequire(import.meta.url);
const inc = require('../.github/scripts/incidente.js');

const PERMITIDO = { GITHUB_ACTOR: 'fcastro-nueveonce', GITHUB_TRIGGERING_ACTOR: 'fcastro-nueveonce' };
const contexto = crearContexto({ eventName: 'workflow_dispatch' });

function entorno(entradas) {
  return { ...PERMITIDO, ...entradas };
}

test('inputs: a declaration needs a known component', () => {
  const ok = inc.validarEntradas({ accion: 'declarar', componente: 'api-signo', estado: 'Investigando', mensaje: 'Revisamos fallas.' });
  assert.deepEqual(ok, { accion: 'declarar', estado: 'Investigando', componente: 'api-signo', numero: null, mensaje: 'Revisamos fallas.' });
  assert.throws(() => inc.validarEntradas({ accion: 'declarar', componente: 'otro', estado: 'Investigando', mensaje: 'x' }), /componente/);
});

test('inputs: updates and resolutions need a positive issue number', () => {
  assert.equal(inc.validarEntradas({ accion: 'actualizar', numero: ' 42 ', estado: 'Identificado', mensaje: 'x' }).numero, 42);
  for (const numero of ['', '0', '-1', '1e3', '12abc', '01', undefined]) {
    assert.throws(() => inc.validarEntradas({ accion: 'actualizar', numero, estado: 'Identificado', mensaje: 'x' }), /número/, String(numero));
  }
});

test('inputs: action, state and their combinations', () => {
  assert.throws(() => inc.validarEntradas({ accion: 'borrar', numero: '1', estado: 'Investigando', mensaje: 'x' }), /acción/);
  assert.throws(() => inc.validarEntradas({ accion: 'actualizar', numero: '1', estado: 'Caído', mensaje: 'x' }), /estado/);
  assert.throws(() => inc.validarEntradas({ accion: 'resolver', numero: '1', estado: 'Monitoreando', mensaje: 'x' }), /Resuelto/);
  assert.throws(() => inc.validarEntradas({ accion: 'actualizar', numero: '1', estado: 'Resuelto', mensaje: 'x' }), /resolver/);
});

test('inputs: the message is sanitized, and an empty or oversized one is refused', () => {
  const { mensaje } = inc.validarEntradas({
    accion: 'actualizar',
    numero: '1',
    estado: 'Identificado',
    mensaje: '<script>alert(1)</script> [x](javascript:void) <img src=x onerror=alert(1)> [ok](https://example.com/)',
  });
  assert.doesNotMatch(mensaje, /[<>]|\]\(javascript/);
  assert.match(mensaje, /\[ok\]\(https:\/\/example\.com\/\)/);
  assert.throws(() => inc.validarEntradas({ accion: 'actualizar', numero: '1', estado: 'Identificado', mensaje: '<>' }), /vacío/);
  assert.throws(() => inc.validarEntradas({ accion: 'actualizar', numero: '1', estado: 'Identificado', mensaje: 'a'.repeat(4001) }), /máximo/);
});

test('a declared incident: Spanish title, a body, and never the bare slug label', () => {
  assert.equal(inc.tituloDeclarado('aqui-contigo-web'), '\u{1F6D1} Aquí Contigo (web): servicio con incidencias');
  assert.match(inc.cuerpoDeclarado('encuestas'), /\*\*Encuestas\*\*/);
  assert.deepEqual(inc.etiquetasDeclaradas('encuestas'), ['status', 'manual', 'componente:encuestas']);
  assert.equal(inc.comentarioDeEstado('Monitoreando', 'Todo estable.'), '**Monitoreando:** Todo estable.');
});

test('only incidents and maintenance accept updates; only manual incidents are closed', () => {
  assert.equal(inc.admiteActualizaciones({ labels: [{ name: 'status' }, { name: 'api-signo' }] }), true);
  assert.equal(inc.admiteActualizaciones({ labels: ['maintenance'] }), true);
  assert.equal(inc.admiteActualizaciones({ labels: ['bug'] }), false);
  assert.equal(inc.admiteActualizaciones({ labels: ['status'], pull_request: {} }), false);
  assert.equal(inc.debeCerrar({ labels: ['status', 'manual'] }), true);
  assert.equal(inc.debeCerrar({ labels: ['status', 'api-signo'] }), false);
});

test('declarar: creates, comments while unlocked, and locks', async () => {
  const github = crearGithubFalso();
  const core = crearCoreFalso();
  await inc.run({
    github,
    context: contexto,
    core,
    env: entorno({ ACCION: 'declarar', COMPONENTE: 'api-signo', ESTADO: 'Investigando', MENSAJE: 'Detectamos errores <b>al ingresar</b>.' }),
  });
  const [issue] = github.estado.issues.values();
  assert.equal(issue.title, '\u{1F6D1} API SIGNO: servicio con incidencias');
  assert.deepEqual(issue.labels.map((l) => l.name), ['status', 'manual', 'componente:api-signo']);
  assert.ok(issue.body.length > 0);
  assert.equal(issue.locked, true);
  assert.deepEqual(github.comentariosDe(issue.number).map((c) => c.body), ['**Investigando:** Detectamos errores bal ingresar/b.']);
  assert.deepEqual(github.escrituras(), ['create', 'createComment', 'lock']);
});

test('declarar: refuses a second open manual incident for the same component', async () => {
  const github = crearGithubFalso({ issues: [{ number: 8, labels: ['status', 'manual', 'componente:api-signo'] }] });
  await assert.rejects(
    inc.run({ github, context: contexto, core: crearCoreFalso(), env: entorno({ ACCION: 'declarar', COMPONENTE: 'api-signo', ESTADO: 'Investigando', MENSAJE: 'x' }) }),
    /#8/,
  );
  assert.deepEqual(github.escrituras(), []);
});

test('actualizar on an Upptime incident: unlock, comment, lock, and it stays open', async () => {
  const github = crearGithubFalso({ issues: [{ number: 7, labels: ['status', 'api-signo'], locked: true }] });
  await inc.run({ github, context: contexto, core: crearCoreFalso(), env: entorno({ ACCION: 'actualizar', NUMERO: '7', ESTADO: 'Identificado', MENSAJE: 'La causa es la base de datos.' }) });
  assert.deepEqual(github.escrituras(), ['unlock', 'createComment', 'lock']);
  assert.equal(github.estado.issues.get(7).state, 'open');
  assert.equal(github.comentariosDe(7)[0].body, '**Identificado:** La causa es la base de datos.');
});

test('resolver closes a manual incident, but not one of Upptime\'s', async () => {
  const github = crearGithubFalso({
    issues: [
      { number: 8, labels: ['status', 'manual', 'componente:encuestas'], locked: true },
      { number: 9, labels: ['status', 'encuestas'], locked: true },
    ],
  });
  await inc.run({ github, context: contexto, core: crearCoreFalso(), env: entorno({ ACCION: 'resolver', NUMERO: '8', ESTADO: 'Resuelto', MENSAJE: 'Funciona.' }) });
  assert.equal(github.estado.issues.get(8).state, 'closed');
  assert.equal(github.estado.issues.get(8).state_reason, 'completed');
  assert.equal(github.estado.issues.get(8).locked, true);

  const core = crearCoreFalso();
  await inc.run({ github, context: contexto, core, env: entorno({ ACCION: 'resolver', NUMERO: '9', ESTADO: 'Resuelto', MENSAJE: 'Funciona.' }) });
  assert.equal(github.estado.issues.get(9).state, 'open');
  assert.equal(github.estado.issues.get(9).locked, true);
  assert.ok(core.mensajes.some((m) => m.tipo === 'notice' && /no es un incidente manual/.test(m.texto)));
});

test('updates to anything but an incident or maintenance are refused before writing', async () => {
  const github = crearGithubFalso({ issues: [{ number: 3, labels: ['pregunta'] }, { number: 4, labels: ['status'], pull_request: {} }] });
  for (const numero of ['3', '4']) {
    await assert.rejects(
      inc.run({ github, context: contexto, core: crearCoreFalso(), env: entorno({ ACCION: 'actualizar', NUMERO: numero, ESTADO: 'Identificado', MENSAJE: 'x' }) }),
      /no es un incidente/,
    );
  }
  assert.deepEqual(github.escrituras(), []);
});

test('only the allowlisted account may publish, also on a re-run', async () => {
  for (const env of [
    { GITHUB_ACTOR: 'alguien', GITHUB_TRIGGERING_ACTOR: 'fcastro-nueveonce' },
    { GITHUB_ACTOR: 'fcastro-nueveonce', GITHUB_TRIGGERING_ACTOR: 'alguien' },
    { GITHUB_ACTOR: 'fcastro-nueveonce' },
    {},
  ]) {
    const github = crearGithubFalso();
    await assert.rejects(
      inc.run({ github, context: contexto, core: crearCoreFalso(), env: { ...env, ACCION: 'declarar', COMPONENTE: 'api-signo', ESTADO: 'Investigando', MENSAJE: 'x' } }),
      /no está autorizada/,
    );
    assert.deepEqual(github.llamadas, []);
  }
});
