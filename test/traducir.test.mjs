import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { BOT, crearGithubFalso, crearCoreFalso, crearContexto } from './github-falso.mjs';

const require = createRequire(import.meta.url);
const t = require('../.github/scripts/traducir.js');

// The exact text uptime-monitor v1.46.5 writes (src/update.ts). lastCommit() returns the output
// of `git log --format=%H -n 1` untrimmed, so the commit URL ends in a newline.
const SHA = '0123456789abcdef0123456789abcdef01234567\n';
const CAIDO = '\u{1F6D1}';
const DEGRADADO = '\u26A0\uFE0F';

function tituloUpptime(nombre, estado) {
  return estado === 'down' ? `${CAIDO} ${nombre} is down` : `${DEGRADADO} ${nombre} has degraded performance`;
}

function cuerpoUpptime({ nombre, url, estado, codigo, ms }) {
  return `In [\`${SHA.substr(0, 7)}\`](https://github.com/Grupo-Nuevo-Once/status/commit/${SHA}), ${nombre} (${url}) ${
    estado === 'down' ? 'was **down**' : 'experienced **degraded performance**'
  }:
- HTTP code: ${codigo}
- Response time: ${ms} ms
`;
}

function resueltoUpptime({ nombre, titulo, duracion }) {
  return `**Resolved:** ${nombre} ${
    titulo.includes('degraded') ? 'performance has improved' : 'is back up'
  } in [\`${SHA.substr(0, 7)}\`](https://github.com/Grupo-Nuevo-Once/status/commit/${SHA}) after ${duracion}.`;
}

// getHumanReadableTimeDifference's format, with the runner's en-US toLocaleString().
function duracionUpptime(dias, horas, minutos) {
  const partes = [];
  if (dias > 0) partes.push(`${dias.toLocaleString('en-US')} ${dias > 1 ? 'days' : 'day'}`);
  if (horas > 0) partes.push(`${horas.toLocaleString('en-US')} ${horas > 1 ? 'hours' : 'hour'}`);
  if (minutos > 0) partes.push(`${minutos.toLocaleString('en-US')} ${minutos > 1 ? 'minutes' : 'minute'}`);
  return partes.join(', ');
}

test('the Upptime helpers reproduce the commit-link newline', () => {
  assert.match(cuerpoUpptime({ nombre: 'X', url: 'https://x/', estado: 'down', codigo: 0, ms: 0 }), /01234567\n\), X/);
});

test('titles: down and degraded become the Spanish wording, keeping the emoji the page strips', () => {
  assert.equal(t.traducirTitulo(tituloUpptime('API SIGNO', 'down')), `${CAIDO} API SIGNO: servicio no disponible`);
  assert.equal(
    t.traducirTitulo(tituloUpptime('Telemedicina (web)', 'degraded')),
    `${DEGRADADO} Telemedicina (web): rendimiento degradado`,
  );
  assert.equal(t.traducirTitulo(`\u26A0 X has degraded performance`), `${DEGRADADO} X: rendimiento degradado`);
});

test('titles: Spanish or unrelated titles are left alone', () => {
  assert.equal(t.traducirTitulo(`${CAIDO} API SIGNO: servicio no disponible`), null);
  assert.equal(t.traducirTitulo('Mantenimiento programado: algo'), null);
  assert.equal(t.traducirTitulo(''), null);
  assert.equal(t.traducirTitulo(undefined), null);
});

test('degraded titles are recognised in English and in Spanish', () => {
  assert.equal(t.esTituloDegradado(tituloUpptime('X', 'degraded')), true);
  assert.equal(t.esTituloDegradado(`${DEGRADADO} X: rendimiento degradado`), true);
  assert.equal(t.esTituloDegradado(`${CAIDO} X: servicio no disponible`), false);
  assert.equal(t.esTituloDegradado(tituloUpptime('X', 'down')), false);
});

test('body: becomes a Spanish summary with the HTTP code and the time, without the commit link', () => {
  const cuerpo = t.traducirCuerpo(
    cuerpoUpptime({ nombre: 'API SIGNO', url: 'https://api.signo.nueveonce.com/api/health/ready', estado: 'down', codigo: 503, ms: 1234 }),
  );
  assert.equal(cuerpo, 'Detectamos que **API SIGNO** no está disponible.\n\n- Código HTTP: 503\n- Tiempo de respuesta: 1234 ms\n');
  assert.doesNotMatch(cuerpo, /commit|github\.com|0123456/);
});

test('body: degraded, names with parentheses and a missing response', () => {
  assert.equal(
    t.traducirCuerpo(cuerpoUpptime({ nombre: 'Aquí Contigo (web)', url: 'https://aquicontigo.nueveonce.com/', estado: 'degraded', codigo: 200, ms: 4100 })),
    'Detectamos que **Aquí Contigo (web)** tiene un rendimiento degradado.\n\n- Código HTTP: 200\n- Tiempo de respuesta: 4100 ms\n',
  );
  assert.match(
    t.traducirCuerpo(cuerpoUpptime({ nombre: 'Encuestas', url: 'https://encuestas.nueveonce.com/', estado: 'down', codigo: 0, ms: 0 })),
    /- Código HTTP: sin respuesta\n/,
  );
});

test('body: a translated body or any other text is left alone', () => {
  assert.equal(t.traducirCuerpo('Detectamos que **X** no está disponible.\n'), null);
  assert.equal(t.traducirCuerpo(null), null);
});

test('durations: every shape getHumanReadableTimeDifference produces', () => {
  const casos = [
    [duracionUpptime(0, 0, 0), 'menos de un minuto'],
    [duracionUpptime(0, 0, 1), '1 minuto'],
    [duracionUpptime(0, 0, 5), '5 minutos'],
    [duracionUpptime(0, 1, 0), '1 hora'],
    [duracionUpptime(0, 1, 1), '1 hora y 1 minuto'],
    [duracionUpptime(1, 0, 0), '1 día'],
    [duracionUpptime(2, 3, 5), '2 días, 3 horas y 5 minutos'],
    [duracionUpptime(1234, 0, 2), '1234 días y 2 minutos'],
  ];
  for (const [ingles, espanol] of casos) assert.equal(t.traducirDuracion(ingles), espanol, JSON.stringify(ingles));
  assert.equal(t.traducirDuracion('an hour'), null);
});

test('resolved comment: back up, with and without a duration', () => {
  const titulo = tituloUpptime('API SIGNO', 'down');
  assert.equal(
    t.traducirComentario(resueltoUpptime({ nombre: 'API SIGNO', titulo, duracion: duracionUpptime(0, 1, 5) }), false),
    '**Resuelto:** API SIGNO volvió a funcionar con normalidad tras 1 hora y 5 minutos.',
  );
  assert.equal(
    t.traducirComentario(resueltoUpptime({ nombre: 'API SIGNO', titulo, duracion: '' }), false),
    '**Resuelto:** API SIGNO volvió a funcionar con normalidad tras menos de un minuto.',
  );
});

test('resolved comment: degraded, from Upptime wording or from the Spanish title', () => {
  const conTituloIngles = resueltoUpptime({ nombre: 'Encuestas', titulo: tituloUpptime('Encuestas', 'degraded'), duracion: '7 minutes' });
  assert.match(conTituloIngles, /performance has improved/);
  assert.equal(t.traducirComentario(conTituloIngles, false), '**Resuelto:** el rendimiento de Encuestas se normalizó tras 7 minutos.');

  // After the rename the title has no "degraded", so Upptime writes "is back up".
  const conTituloEspanol = resueltoUpptime({ nombre: 'Encuestas', titulo: `${DEGRADADO} Encuestas: rendimiento degradado`, duracion: '7 minutes' });
  assert.match(conTituloEspanol, /is back up/);
  assert.equal(t.traducirComentario(conTituloEspanol, true), '**Resuelto:** el rendimiento de Encuestas se normalizó tras 7 minutos.');
});

test('resolved comment: other comments are left alone', () => {
  assert.equal(t.traducirComentario(t.INVESTIGANDO, false), null);
  assert.equal(t.traducirComentario('**Resuelto:** X volvió a funcionar con normalidad tras 2 minutos.', false), null);
  assert.equal(t.traducirComentario('**Identificado:** Resolved: X is back up', false), null);
});

const UPPTIME = { number: 7, title: tituloUpptime('API SIGNO', 'down'), labels: ['status', 'api-signo'], state: 'open', locked: true };

test('only Upptime incidents from the bot are translated', () => {
  assert.equal(t.debeTraducir({ ...UPPTIME, labels: [{ name: 'status' }, { name: 'api-signo' }] }, BOT), true);
  assert.equal(t.debeTraducir(UPPTIME, 'alguien'), false);
  assert.equal(t.debeTraducir(UPPTIME, 'github-actions[bot]'), false);
  assert.equal(t.debeTraducir({ ...UPPTIME, labels: ['status', 'api-signo', 'manual'] }, BOT), false);
  assert.equal(t.debeTraducir({ ...UPPTIME, labels: ['status', 'api-signo', 'status-relay'] }, BOT), false);
  assert.equal(t.debeTraducir({ ...UPPTIME, labels: ['status', 'componente:api-signo'] }, BOT), false);
  assert.equal(t.debeTraducir({ ...UPPTIME, labels: ['api-signo'] }, BOT), false);
  assert.equal(t.debeTraducir({ ...UPPTIME, labels: ['status', 'otro-sitio'] }, BOT), false);
  assert.equal(t.debeTraducir({ ...UPPTIME, pull_request: {} }, BOT), false);
});

test('the run waits only for an open issue whose new comment is Upptime\'s resolution', () => {
  const resolved = { user: { login: BOT }, body: resueltoUpptime({ nombre: 'X', titulo: 'x', duracion: '' }) };
  assert.equal(t.esperaCierreDeUpptime('issue_comment', { state: 'open' }, resolved), true);
  assert.equal(t.esperaCierreDeUpptime('issue_comment', { state: 'closed' }, resolved), false);
  assert.equal(t.esperaCierreDeUpptime('issues', { state: 'open' }, resolved), false);
  assert.equal(t.esperaCierreDeUpptime('issue_comment', { state: 'open' }, { ...resolved, user: { login: 'alguien' } }), false);
  assert.equal(t.esperaCierreDeUpptime('issue_comment', { state: 'open' }, { user: { login: BOT }, body: '**Identificado:** algo' }), false);
});

test('plan: "Investigando" only on opened or labeled, while open, and never twice', () => {
  const issue = { ...UPPTIME, body: cuerpoUpptime({ nombre: 'API SIGNO', url: 'https://x/', estado: 'down', codigo: 404, ms: 10 }) };
  const yaInvestigando = [{ user: { login: 'github-actions[bot]' }, body: t.INVESTIGANDO }];
  const yaResuelto = [{ user: { login: BOT }, body: resueltoUpptime({ nombre: 'API SIGNO', titulo: issue.title, duracion: '' }) }];
  assert.deepEqual([...t.ACCIONES_DE_APERTURA], ['opened', 'labeled']);
  for (const accion of t.ACCIONES_DE_APERTURA) {
    const investiga = (datos) => t.planificarTraduccion({ issue, comentarios: [], evento: 'issues', accion, ...datos }).investigar;
    assert.equal(investiga({}), true, accion);
    assert.equal(investiga({ issue: { ...issue, state: 'closed' } }), false, accion);
    assert.equal(investiga({ comentarios: yaInvestigando }), false, accion);
    assert.equal(investiga({ comentarios: yaResuelto }), false, accion);
  }
  for (const [evento, accion] of [['issues', 'closed'], ['issues', 'unlabeled'], ['issues', 'edited'], ['issue_comment', 'created']]) {
    assert.equal(t.planificarTraduccion({ issue, comentarios: [], evento, accion }).investigar, false, `${evento}.${accion}`);
  }
});

test('the workflow listens to the opening actions the plan knows, to the close and to new comments', () => {
  const texto = readFileSync(new URL('../.github/workflows/traducir-incidentes.yml', import.meta.url), 'utf8');
  const tipos = /^ {2}issues:\n {4}types: \[([a-z, ]+)\]$/m.exec(texto);
  assert.ok(tipos, 'issues.types');
  assert.deepEqual(tipos[1].split(', '), [...t.ACCIONES_DE_APERTURA, 'closed']);
  assert.match(texto, /^ {2}issue_comment:\n {4}types: \[created\]$/m);
});

test('plan: only the bot\'s own comments are edited', () => {
  const ajeno = { id: 1, user: { login: 'alguien' }, body: resueltoUpptime({ nombre: 'X', titulo: 'x', duracion: '' }) };
  const plan = t.planificarTraduccion({ issue: { ...UPPTIME, title: 'otro' }, comentarios: [ajeno], evento: 'issues', accion: 'closed' });
  assert.equal(plan.ediciones.length, 0);
  assert.equal(t.planVacio(plan), true);
});

function escenarioAbierto() {
  return crearGithubFalso({
    issues: [
      {
        ...UPPTIME,
        body: cuerpoUpptime({ nombre: 'API SIGNO', url: 'https://api.signo.nueveonce.com/api/health/ready', estado: 'down', codigo: 404, ms: 321 }),
      },
    ],
  });
}

const abierto = () => crearContexto({ eventName: 'issues', payload: { action: 'opened', issue: { number: 7 }, sender: { login: BOT } } });

test('run on "opened": translates, posts "Investigando" while unlocked, and ends locked', async () => {
  const github = escenarioAbierto();
  await t.run({ github, context: abierto(), core: crearCoreFalso() });

  const issue = github.estado.issues.get(7);
  assert.equal(issue.title, `${CAIDO} API SIGNO: servicio no disponible`);
  assert.match(issue.body, /^Detectamos que \*\*API SIGNO\*\* no está disponible\./);
  assert.deepEqual(github.comentariosDe(7).map((c) => c.body), [t.INVESTIGANDO]);
  assert.equal(issue.locked, true);
  assert.deepEqual(github.escrituras(), ['unlock', 'update', 'createComment', 'lock']);
});

test('run twice: the second run changes nothing', async () => {
  const github = escenarioAbierto();
  await t.run({ github, context: abierto(), core: crearCoreFalso() });
  const antes = github.escrituras().length;
  await t.run({ github, context: abierto(), core: crearCoreFalso() });
  assert.equal(github.escrituras().length, antes);
  assert.equal(github.comentariosDe(7).length, 1);
});

test('repeated issue events: one "Investigando" and one translation, whichever arrive', async () => {
  // GitHub can deliver "opened" and one "labeled" per label for the same new issue, and the
  // concurrency group runs them one after another. When the "opened" payload lacks the labels,
  // the workflow skips that run and the "labeled" ones do the work.
  const evento = (accion) => crearContexto({ eventName: 'issues', payload: { action: accion, issue: { number: 7 }, sender: { login: BOT } } });
  for (const acciones of [['opened', 'labeled', 'labeled'], ['labeled', 'labeled'], ['labeled', 'opened', 'labeled']]) {
    const caso = acciones.join(', ');
    const github = crearGithubFalso({
      issues: [{ ...UPPTIME, body: cuerpoUpptime({ nombre: 'API SIGNO', url: 'https://x/', estado: 'down', codigo: 503, ms: 321 }) }],
      // The script comments with GITHUB_TOKEN, so its comments carry this author.
      autorComentarios: 'github-actions[bot]',
    });
    const porCorrida = [];
    for (const accion of acciones) {
      const antes = github.escrituras().length;
      await t.run({ github, context: evento(accion), core: crearCoreFalso() });
      porCorrida.push(github.escrituras().slice(antes));
    }
    assert.deepEqual(porCorrida[0], ['unlock', 'update', 'createComment', 'lock'], caso);
    for (const escrituras of porCorrida.slice(1)) assert.deepEqual(escrituras, [], caso);
    assert.deepEqual(github.comentariosDe(7).map((c) => c.body), [t.INVESTIGANDO], caso);
    assert.equal(github.estado.issues.get(7).title, `${CAIDO} API SIGNO: servicio no disponible`, caso);
    assert.match(github.estado.issues.get(7).body, /^Detectamos que \*\*API SIGNO\*\* no está disponible\./, caso);
    assert.equal(github.estado.issues.get(7).locked, true, caso);
  }
});

test('a "labeled" event after Upptime resolved the incident posts no "Investigando"', async () => {
  const titulo = tituloUpptime('Encuestas', 'down');
  const github = crearGithubFalso({
    issues: [{ number: 9, title: titulo, labels: ['status', 'encuestas'], state: 'closed', locked: true, body: '' }],
    comentarios: [{ id: 61, issue_number: 9, user: { login: BOT }, body: resueltoUpptime({ nombre: 'Encuestas', titulo, duracion: '5 minutes' }) }],
  });
  const context = crearContexto({ eventName: 'issues', payload: { action: 'labeled', issue: { number: 9 }, sender: { login: BOT } } });
  await t.run({ github, context, core: crearCoreFalso() });
  assert.deepEqual(github.comentariosDe(9).map((c) => c.body), ['**Resuelto:** Encuestas volvió a funcionar con normalidad tras 5 minutos.']);
  const antes = github.escrituras().length;
  await t.run({ github, context, core: crearCoreFalso() });
  assert.equal(github.escrituras().length, antes);
});

test('run: something locks the issue between the read and the comment, and the comment still lands', async () => {
  let bloqueado = false;
  const github = crearGithubFalso({
    issues: [{ ...UPPTIME, locked: false, body: '' }],
    antes: {
      createComment: (params, estado) => {
        if (!bloqueado) {
          bloqueado = true;
          estado.issues.get(7).locked = true;
        }
      },
    },
  });
  await t.run({ github, context: abierto(), core: crearCoreFalso() });
  assert.deepEqual(github.comentariosDe(7).map((c) => c.body), [t.INVESTIGANDO]);
  assert.equal(github.estado.issues.get(7).locked, true);
});

test('run on Upptime\'s resolution comment: waits for the close before touching the lock', async () => {
  const titulo = `${DEGRADADO} API SIGNO: rendimiento degradado`;
  const resolucion = resueltoUpptime({ nombre: 'API SIGNO', titulo, duracion: duracionUpptime(0, 0, 12) });
  let lecturas = 0;
  let llamadaDelCierre = -1;
  const github = crearGithubFalso({
    issues: [{ ...UPPTIME, title: titulo, locked: false }],
    comentarios: [{ id: 50, issue_number: 7, user: { login: BOT }, body: resolucion }],
    antes: {
      get: (params, estado, llamadas) => {
        lecturas += 1;
        // Upptime closes and locks the issue just before the third read.
        if (lecturas === 3) {
          Object.assign(estado.issues.get(7), { state: 'closed', locked: true });
          llamadaDelCierre = llamadas.length - 1;
        }
      },
    },
  });
  const esperas = [];
  const context = crearContexto({
    eventName: 'issue_comment',
    payload: { action: 'created', issue: { number: 7 }, comment: { id: 50, user: { login: BOT }, body: resolucion }, sender: { login: BOT } },
  });
  await t.run({ github, context, core: crearCoreFalso(), esperar: async (ms) => esperas.push(ms), pausaMs: 1 });

  assert.equal(esperas.length, 2);
  assert.equal(github.estado.comentarios[0].body, '**Resuelto:** el rendimiento de API SIGNO se normalizó tras 12 minutos.');
  const primeraEscritura = github.llamadas.findIndex((l) => !['get', 'listComments'].includes(l.nombre));
  assert.ok(llamadaDelCierre >= 0 && primeraEscritura > llamadaDelCierre, 'no write before Upptime closes');
  assert.deepEqual(github.escrituras(), ['unlock', 'updateComment', 'lock']);
  assert.equal(github.estado.issues.get(7).locked, true);
});

test('run: if Upptime never closes the issue, it translates anyway after the wait', async () => {
  const resolucion = resueltoUpptime({ nombre: 'API SIGNO', titulo: UPPTIME.title, duracion: '' });
  const github = crearGithubFalso({
    issues: [{ ...UPPTIME, title: `${CAIDO} API SIGNO: servicio no disponible`, locked: false }],
    comentarios: [{ id: 50, issue_number: 7, user: { login: BOT }, body: resolucion }],
  });
  const core = crearCoreFalso();
  const context = crearContexto({
    eventName: 'issue_comment',
    payload: { action: 'created', issue: { number: 7 }, comment: { id: 50, user: { login: BOT }, body: resolucion }, sender: { login: BOT } },
  });
  await t.run({ github, context, core, esperar: async () => {}, esperasDeCierre: 3, pausaMs: 1 });
  assert.equal(github.estado.comentarios[0].body, '**Resuelto:** API SIGNO volvió a funcionar con normalidad tras menos de un minuto.');
  assert.ok(core.mensajes.some((m) => m.tipo === 'warning'));
});

test('run on "closed": translates the resolution of an already closed and locked issue', async () => {
  const titulo = tituloUpptime('Encuestas', 'down');
  const github = crearGithubFalso({
    issues: [{ number: 9, title: titulo, labels: ['status', 'encuestas'], state: 'closed', locked: true, body: '' }],
    comentarios: [
      { id: 60, issue_number: 9, user: { login: 'github-actions[bot]' }, body: t.INVESTIGANDO },
      { id: 61, issue_number: 9, user: { login: BOT }, body: resueltoUpptime({ nombre: 'Encuestas', titulo, duracion: '2 days, 1 hour' }) },
    ],
  });
  const context = crearContexto({ eventName: 'issues', payload: { action: 'closed', issue: { number: 9 }, sender: { login: BOT } } });
  await t.run({ github, context, core: crearCoreFalso() });
  assert.equal(github.estado.issues.get(9).title, `${CAIDO} Encuestas: servicio no disponible`);
  assert.equal(github.estado.comentarios[1].body, '**Resuelto:** Encuestas volvió a funcionar con normalidad tras 2 días y 1 hora.');
  assert.equal(github.estado.comentarios[0].body, t.INVESTIGANDO);
  assert.equal(github.estado.issues.get(9).locked, true);
});

test('run: events from people, manual incidents and other issues are not touched', async () => {
  for (const [issue, remitente] of [
    [UPPTIME, 'alguien'],
    [{ ...UPPTIME, labels: ['status', 'manual', 'componente:api-signo'] }, BOT],
    [{ ...UPPTIME, labels: ['maintenance'] }, BOT],
  ]) {
    const github = crearGithubFalso({ issues: [issue] });
    const context = crearContexto({ eventName: 'issues', payload: { action: 'opened', issue: { number: 7 }, sender: { login: remitente } } });
    await t.run({ github, context, core: crearCoreFalso() });
    assert.deepEqual(github.escrituras(), []);
  }
});
