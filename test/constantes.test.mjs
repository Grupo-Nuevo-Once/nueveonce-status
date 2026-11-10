import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const k = require('../.github/scripts/constantes.js');

test('the eight components, in the page\'s order, with unique slugs', () => {
  assert.deepEqual(k.SLUGS, [
    'api-signo',
    'dashboard-signo',
    'api-integraciones',
    'portal-desarrolladores',
    'telemedicina-web',
    'aqui-contigo-web',
    'app-pacientes-web',
    'encuestas',
  ]);
  assert.equal(new Set(k.SLUGS).size, 8);
  assert.equal(k.nombreDe('aqui-contigo-web'), 'Aquí Contigo (web)');
  assert.equal(k.nombreDe('otro'), null);
  assert.ok(Object.isFrozen(k.COMPONENTES) && Object.isFrozen(k.SLUGS));
});

test('labels: manual and relay incidents use componente:<slug>, never the bare slug', () => {
  assert.equal(k.ETIQUETAS.componente('encuestas'), 'componente:encuestas');
  assert.deepEqual([k.ETIQUETAS.status, k.ETIQUETAS.maintenance, k.ETIQUETAS.manual, k.ETIQUETAS.relay], ['status', 'maintenance', 'manual', 'status-relay']);
});

test('label names come out of objects and plain strings alike', () => {
  assert.deepEqual(k.nombresDeEtiquetas({ labels: [{ name: 'status' }, 'api-signo', null, {}] }), ['status', 'api-signo']);
  assert.deepEqual(k.nombresDeEtiquetas(undefined), []);
});

test('only the allowlisted account, both as actor and as triggering actor', () => {
  assert.equal(k.BOT_LOGIN, 'nueveonce-estado[bot]');
  assert.doesNotThrow(() => k.autorizar({ GITHUB_ACTOR: 'fcastro-nueveonce', GITHUB_TRIGGERING_ACTOR: 'fcastro-nueveonce' }));
  assert.throws(() => k.autorizar({ GITHUB_ACTOR: 'fcastro-nueveonce', GITHUB_TRIGGERING_ACTOR: 'nueveonce-estado[bot]' }), /no está autorizada/);
  assert.throws(() => k.autorizar({}), /no está autorizada/);
});
