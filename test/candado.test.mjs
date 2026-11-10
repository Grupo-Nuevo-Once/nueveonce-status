import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { crearGithubFalso, crearCoreFalso, crearContexto } from './github-falso.mjs';

const require = createRequire(import.meta.url);
const c = require('../.github/scripts/candado.js');

test('desbloqueados lists the numbers of unlocked items only', () => {
  assert.deepEqual(c.desbloqueados([{ number: 1, locked: true }, { number: 2, locked: false }, { number: 3 }, null]), [2, 3]);
});

test('an opened issue is locked; one that is already locked is left alone', async () => {
  const github = crearGithubFalso({ issues: [{ number: 4, locked: false }, { number: 5, locked: true }] });
  await c.run({ github, context: crearContexto({ eventName: 'issues', payload: { issue: { number: 4 } } }), core: crearCoreFalso() });
  await c.run({ github, context: crearContexto({ eventName: 'issues', payload: { issue: { number: 5 } } }), core: crearCoreFalso() });
  assert.equal(github.estado.issues.get(4).locked, true);
  assert.deepEqual(github.escrituras(), ['lock']);
});

test('an opened pull request is locked through its issue number', async () => {
  const github = crearGithubFalso({ issues: [{ number: 6, locked: false, pull_request: {} }] });
  await c.run({ github, context: crearContexto({ eventName: 'pull_request', payload: { pull_request: { number: 6 } } }), core: crearCoreFalso() });
  assert.equal(github.estado.issues.get(6).locked, true);
});

test('the sweep waits for the grace period and locks what is still unlocked, open or closed', async () => {
  const github = crearGithubFalso({
    issues: [
      { number: 1, locked: true },
      { number: 2, locked: false, state: 'closed' },
      { number: 3, locked: false, pull_request: {} },
      { number: 4, locked: false },
    ],
  });
  const esperas = [];
  const context = crearContexto({ eventName: 'schedule', payload: { schedule: '*/15 * * * *' } });
  const bloqueados = await c.run({
    github,
    context,
    core: crearCoreFalso(),
    // A bot locks #4 itself during the grace period.
    esperar: async (ms) => {
      esperas.push(ms);
      github.estado.issues.get(4).locked = true;
    },
  });
  assert.deepEqual(esperas, [c.GRACIA_MS]);
  assert.deepEqual(bloqueados, [2, 3]);
  assert.ok([...github.estado.issues.values()].every((issue) => issue.locked));
  assert.deepEqual(github.escrituras(), ['lock', 'lock']);
  const listado = github.llamadas.find((l) => l.nombre === 'listForRepo');
  assert.equal(listado.state, 'all');
});

test('the sweep does not wait when everything is locked', async () => {
  const github = crearGithubFalso({ issues: [{ number: 1, locked: true }] });
  let esperas = 0;
  const bloqueados = await c.run({
    github,
    context: crearContexto({ eventName: 'workflow_dispatch' }),
    core: crearCoreFalso(),
    esperar: async () => {
      esperas += 1;
    },
  });
  assert.deepEqual(bloqueados, []);
  assert.equal(esperas, 0);
});

test('an unexpected event is refused', async () => {
  await assert.rejects(
    c.run({ github: crearGithubFalso(), context: crearContexto({ eventName: 'push' }), core: crearCoreFalso() }),
    /Evento no previsto/,
  );
});
