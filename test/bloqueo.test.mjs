import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { crearGithubFalso } from './github-falso.mjs';

const require = createRequire(import.meta.url);
const b = require('../.github/scripts/bloqueo.js');

const REF = { owner: 'Grupo-Nuevo-Once', repo: 'status', issue_number: 3 };
const conError = (status, message) => Object.assign(new Error(message), { status });

test('lock errors are recognised by status and message', () => {
  assert.equal(b.esErrorDeBloqueo(conError(403, 'Unable to create comment because issue is locked.')), true);
  assert.equal(b.esErrorDeBloqueo(conError(422, 'Issue is locked')), true);
  assert.equal(b.esErrorDeBloqueo(conError(403, 'Resource not accessible by integration')), false);
  assert.equal(b.esErrorDeBloqueo(conError(500, 'locked')), false);
  assert.equal(b.esErrorDeBloqueo(undefined), false);
});

test('bloquear: a refusal on an issue that is already locked is fine', async () => {
  const github = crearGithubFalso({
    issues: [{ number: 3, locked: true }],
    antes: { lock: () => { throw conError(422, 'already locked'); } },
  });
  await b.bloquear(github, REF);
  assert.equal(github.estado.issues.get(3).locked, true);
});

test('bloquear: a refusal on an unlocked issue is reported', async () => {
  const github = crearGithubFalso({
    issues: [{ number: 3, locked: false }],
    antes: { lock: () => { throw conError(403, 'Resource not accessible by integration'); } },
  });
  await assert.rejects(b.bloquear(github, REF), /not accessible/);
});

test('desbloquear: an issue that is already unlocked is fine', async () => {
  const github = crearGithubFalso({ issues: [{ number: 3, locked: false }] });
  await b.desbloquear(github, REF);
  assert.equal(github.estado.issues.get(3).locked, false);
});

test('reintentarDesbloqueando: unlocks and retries after a lock error, up to the limit', async () => {
  const github = crearGithubFalso({ issues: [{ number: 3, locked: true }] });
  let intentos = 0;
  const resultado = await b.reintentarDesbloqueando(github, REF, async () => {
    intentos += 1;
    if (github.estado.issues.get(3).locked) throw conError(403, 'Unable to create comment because issue is locked.');
    return 'ok';
  });
  assert.equal(resultado, 'ok');
  assert.equal(intentos, 2);

  let siempre = 0;
  await assert.rejects(
    b.reintentarDesbloqueando(github, REF, async () => {
      siempre += 1;
      throw conError(403, 'issue is locked');
    }),
    /locked/,
  );
  assert.equal(siempre, 3);
});

test('reintentarDesbloqueando: other errors are not retried', async () => {
  const github = crearGithubFalso({ issues: [{ number: 3, locked: true }] });
  let intentos = 0;
  await assert.rejects(
    b.reintentarDesbloqueando(github, REF, async () => {
      intentos += 1;
      throw conError(500, 'Server Error');
    }),
    /Server Error/,
  );
  assert.equal(intentos, 1);
  assert.deepEqual(github.escrituras(), []);
});

test('conDesbloqueo: unlocks, writes and always locks again', async () => {
  const github = crearGithubFalso({ issues: [{ number: 3, locked: true }] });
  await b.conDesbloqueo(github, REF, true, () => b.comentar(github, REF, 'hola'));
  assert.deepEqual(github.escrituras(), ['unlock', 'createComment', 'lock']);
  assert.equal(github.estado.issues.get(3).locked, true);
});

test('conDesbloqueo: locks again when the write fails, and reports the write error', async () => {
  const github = crearGithubFalso({ issues: [{ number: 3, locked: true }] });
  await assert.rejects(
    b.conDesbloqueo(github, REF, true, async () => {
      throw conError(500, 'write failed');
    }),
    /write failed/,
  );
  assert.equal(github.estado.issues.get(3).locked, true);

  const sinLock = crearGithubFalso({
    issues: [{ number: 3, locked: true }],
    antes: { lock: () => { throw conError(500, 'lock failed'); } },
  });
  await assert.rejects(
    b.conDesbloqueo(sinLock, REF, true, async () => {
      throw conError(500, 'write failed');
    }),
    /write failed/,
  );
});

test('conDesbloqueo: a failed final lock is reported when the writes worked', async () => {
  const github = crearGithubFalso({
    issues: [{ number: 3, locked: false }],
    antes: { lock: () => { throw conError(500, 'lock failed'); } },
  });
  await assert.rejects(b.conDesbloqueo(github, REF, false, async () => 'ok'), /lock failed/);
});
