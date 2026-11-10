import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { SLUGS, BOT_LOGIN, PUBLICADORES } = require('../.github/scripts/constantes.js');
const { ACCIONES, ESTADOS } = require('../.github/scripts/incidente.js');
const { validarWorkflow } = require('../.github/scripts/validar.js');

// The workflows repeat values that the scripts also hold, because GitHub evaluates job conditions
// before any script runs. These checks read the YAML as text and keep both copies equal.
const DIR = new URL('../.github/workflows/', import.meta.url);
const leer = (nombre) => readFileSync(new URL(nombre, DIR), 'utf8');
const TODOS = readdirSync(DIR).filter((nombre) => /\.ya?ml$/.test(nombre));
const PROPIOS = ['traducir-incidentes.yml', 'incidente.yml', 'mantenimiento.yml', 'candado.yml', 'validar.yml'];

const sangria = (linea) => linea.length - linea.trimStart().length;

// The lines nested under the first line that matches `cabecera`.
function bloque(texto, cabecera) {
  const lineas = texto.split('\n');
  const inicio = lineas.findIndex((linea) => cabecera.test(linea));
  assert.ok(inicio >= 0, `no line matches ${cabecera}`);
  const base = sangria(lineas[inicio]);
  const resultado = [];
  for (const linea of lineas.slice(inicio + 1)) {
    if (linea.trim() !== '' && sangria(linea) <= base) break;
    resultado.push(linea);
  }
  return resultado;
}

// The "- value" items of a workflow_dispatch choice input.
function opciones(texto, entrada) {
  const lineas = bloque(texto, new RegExp(`^ {6}${entrada}:\\s*$`));
  const desde = lineas.findIndex((linea) => /^\s+options:\s*$/.test(linea));
  assert.ok(desde >= 0, `${entrada} has no options`);
  const items = [];
  for (const linea of lineas.slice(desde + 1)) {
    const m = /^\s+- (\S+)\s*$/.exec(linea);
    if (!m) break;
    items.push(m[1]);
  }
  return items;
}

// The structure rules (root permissions, triggers, expressions in code, secrets and the App key,
// what may run next to the key, the artifact handoff, GITHUB_TOKEN and the App token) live in
// validar.js, whose master copy also judges every pull request. Without a YAML parser, as here,
// it applies the rules it reads on the text (pins, "permissions: {}", pull_request_target and
// workflow_run, "${{" in run or script); scripts/validar.sh applies all of them, the per-job ones
// included, with js-yaml 5.4.3.
test('every workflow passes the rules of validar.js that read the text', () => {
  for (const nombre of TODOS) {
    assert.deepEqual(validarWorkflow(leer(nombre), nombre), [], nombre);
  }
});

test('the bot e-mail is one string in the three workflows that commit and in .upptimerc.yml', () => {
  const escapar = (texto) => texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // The App bot's noreply address, before or after its numeric user id replaces the placeholder.
  const sufijo = `\\+${escapar(BOT_LOGIN)}@users\\.noreply\\.github\\.com`;
  const correo = new RegExp(`[^\\s"']*${sufijo}`, 'g');
  const archivos = new Map([
    ...TODOS.map((nombre) => [nombre, leer(nombre)]),
    ['.upptimerc.yml', readFileSync(new URL('../.upptimerc.yml', import.meta.url), 'utf8')],
  ]);
  const encontrados = [...archivos].flatMap(([nombre, texto]) => (texto.match(correo) || []).map((valor) => ({ nombre, valor })));
  assert.deepEqual(encontrados.map((e) => e.nombre).sort(), ['.upptimerc.yml', 'graphs.yml', 'setup.yml', 'site.yml']);
  const valores = [...new Set(encontrados.map((e) => e.valor))];
  assert.equal(valores.length, 1, valores.join(' | '));
  assert.match(valores[0], new RegExp(`^(?:__BOT_USER_ID__|[1-9][0-9]*)${sufijo}$`));
  // The placeholder appears in those addresses and nowhere else.
  for (const [nombre, texto] of archivos) {
    const enCorreos = encontrados.filter((e) => e.nombre === nombre && e.valor.includes('__BOT_USER_ID__')).length;
    assert.equal(texto.split('__BOT_USER_ID__').length - 1, enCorreos, nombre);
  }
});

test('the hand-written workflows bound every job and set a concurrency group', () => {
  for (const nombre of PROPIOS) {
    const texto = leer(nombre);
    const trabajos = (texto.match(/^\s+runs-on:/gm) || []).length;
    assert.ok(trabajos > 0, nombre);
    assert.equal((texto.match(/^\s+timeout-minutes: \d+$/gm) || []).length, trabajos, nombre);
    assert.match(texto, /^\s*concurrency:\s*$/m, nombre);
  }
});

test('traducir-incidentes runs only for Upptime incidents sent by the bot, with GITHUB_TOKEN', () => {
  const texto = leer('traducir-incidentes.yml');
  const condicion = bloque(texto, /^ {4}if: >-\s*$/).join('\n');
  assert.ok(condicion.includes(`github.event.sender.login == '${BOT_LOGIN}'`));
  assert.ok(condicion.includes("contains(github.event.issue.labels.*.name, 'status')"));
  assert.ok(condicion.includes("!contains(github.event.issue.labels.*.name, 'manual')"));
  assert.ok(condicion.includes("!contains(github.event.issue.labels.*.name, 'status-relay')"));
  const slugs = [...condicion.matchAll(/\|\| contains\(github\.event\.issue\.labels\.\*\.name, '([a-z-]+)'\)|&& \(contains\(github\.event\.issue\.labels\.\*\.name, '([a-z-]+)'\)/g)].map((m) => m[1] || m[2]);
  assert.deepEqual(slugs, [...SLUGS]);
  assert.doesNotMatch(texto, /secrets\.|environment:|create-github-app-token/);
  assert.match(texto, /^ {6}issues: write$/m);
  assert.match(texto, /group: traducir-incidentes-\$\{\{ github\.event\.issue\.number \}\}/);
});

test('incidente and mantenimiento: same allowlist as constantes.js, App key only after it', () => {
  for (const nombre of ['incidente.yml', 'mantenimiento.yml']) {
    const texto = leer(nombre);
    assert.equal(PUBLICADORES.length, 1, 'the workflows compare against a single account');
    const [cuenta] = PUBLICADORES;
    assert.ok(texto.includes(`if: github.actor == '${cuenta}' && github.triggering_actor == '${cuenta}'`), nombre);
    assert.ok(texto.includes(`if [ "$cuenta" != "${cuenta}" ]; then`), nombre);
    assert.match(texto, /^ {4}needs: autorizar$/m, nombre);
    assert.match(texto, /^ {4}environment: estado$/m, nombre);
    // The App token, the job's only one: read access to the contents for the checkout of the
    // scripts, write access to issues for the script, and nothing else.
    const permisos = (texto.match(/permission-[a-z-]+:[^\n]*/g) || []).map((linea) => linea.trim());
    assert.deepEqual(permisos, ['permission-contents: read', 'permission-issues: write'], nombre);
    assert.equal((texto.match(/secrets\.GH_APP_PRIVATE_KEY/g) || []).length, 1, nombre);
    assert.doesNotMatch(texto, /fromJSON\(|toJSON\(/, nombre);
  }
});

test('incidente offers exactly the actions, components and states the script accepts', () => {
  const texto = leer('incidente.yml');
  assert.deepEqual(opciones(texto, 'accion'), [...ACCIONES]);
  assert.deepEqual(opciones(texto, 'componente'), [...SLUGS]);
  assert.deepEqual(opciones(texto, 'estado'), [...ESTADOS]);
  for (const variable of ['ACCION', 'NUMERO', 'COMPONENTE', 'ESTADO', 'MENSAJE']) {
    assert.match(texto, new RegExp(`^ {10}${variable}: \\$\\{\\{ inputs\\.[a-z]+ \\}\\}$`, 'm'), variable);
  }
});

test('mantenimiento passes every input through the environment', () => {
  const texto = leer('mantenimiento.yml');
  for (const variable of ['TITULO', 'INICIO', 'FIN', 'CAIDOS', 'DEGRADADOS', 'DESCRIPCION']) {
    assert.match(texto, new RegExp(`^ {10}${variable}: \\$\\{\\{ inputs\\.[a-z]+ \\}\\}$`, 'm'), variable);
  }
});

test('candado locks on open and sweeps every 15 minutes, with master\'s script', () => {
  const texto = leer('candado.yml');
  assert.match(texto, /^ {2}issues:\n {4}types: \[opened\]$/m);
  assert.match(texto, /^ {2}pull_request:\n {4}types: \[opened\]$/m);
  assert.match(texto, /cron: "\*\/15 \* \* \* \*"/);
  assert.match(texto, /^ {6}issues: write$/m);
  assert.match(texto, /^ {6}pull-requests: write$/m);
  assert.match(texto, /^ {10}ref: master$/m);
});

test('validar runs the change\'s checker and, in a separate job, master\'s without the change\'s code', () => {
  const texto = leer('validar.yml');
  assert.match(texto, /run: bash cambio\/scripts\/validar\.sh cambio$/m);
  assert.match(texto, /bash base\/scripts\/validar\.sh --sin-pruebas cambio$/m);
  assert.match(texto, /^ {2}validar-master:$/m);
});
