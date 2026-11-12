'use strict';

// Checks .upptimerc.yml and the workflows before anything reaches master. scripts/validar.sh runs
// it with the two YAML parsers that read the file in production:
// - js-yaml 5.4.3, bundled in uptime-monitor v1.46.5: what the monitor requests and reports on;
// - js-yaml 4.3.2, what "js-yaml": "^4.1.0" in @upptime/status-page 1.17.0 installs today
//   (the site build runs "npm i" without a lockfile): what the page shows.
// js-yaml 5 does not apply YAML merge keys ("<<") and js-yaml 4 does, so a site written with
// them loses its checks in the monitor while the page still looks right.
//
//   node validar.js repo <repo-dir> --js-yaml <dir> --js-yaml-sitio <dir>
//   node validar.js negativos <fixtures-dir> --js-yaml <dir> --js-yaml-sitio <dir>
//
// validar.yml also runs master's copy of this file against every pull request, so a change
// cannot weaken the rules that judge it: a rule or allowlist change merges first, on its own.
// That includes the structure of the workflows (permissions, triggers, which secrets may be read
// and where the App key may, where GITHUB_TOKEN may be used and what it may write, and what may
// run next to the key: no npm, no code this file cannot read, only the run's own artifact, the
// App token for every action), which is checked here rather than in the change's own tests.
// The list of components is the exception: it is read from the checked repository's
// .github/scripts/componentes.json as data, so a new component takes one change once its host is
// in master's allowlist. The characters of its names are still master's rule.

const fs = require('fs');
const path = require('path');
const { COMPONENTES, BOT_LOGIN } = require('./constantes.js');
// The sanitizer's definition of a link target that snarkdown renders safely.
const { esUrlSegura } = require('./sanear.js');

// The public components. An allowlist, so that no internal name is ever written into the repo.
const HOSTS_COMPONENTES = Object.freeze([
  'api.signo.nueveonce.com',
  'signo.nueveonce.com',
  'integrations.nueveonce.com',
  'developers.nueveonce.com',
  'telemedicine.nueveonce.com',
  'aquicontigo.nueveonce.com',
  'app.nueveonce.com',
  'encuestas.nueveonce.com',
]);
// The repository whose issues the page shows, and the path GitHub Pages publishes it under. The
// page renders the comments of that repository's issues as raw HTML, so another owner or
// repository would publish on this page whatever anyone writes there.
const PROPIETARIO = 'Grupo-Nuevo-Once';
const REPOSITORIO = 'nueveonce-status';
const BASE_URL = '/nueveonce-status';
const HOST_PAGINA = 'grupo-nuevo-once.github.io';
// The page's own domain. With "cname" set to it, and no baseUrl, GitHub Pages serves the site from
// the domain's root and github.io redirects there. Any other value would hand the page, and that
// redirect, to whoever controls the domain.
const DOMINIO_PAGINA = 'status.nueveonce.com';
// The company's public contact page, the page's "Soporte" link. The only company host besides the
// components and the page's domain: allowed in page links and as a mention, never as a monitored
// site.
const HOST_SOPORTE = 'www.nueveonce.com';
// The support mailbox, behind the page's "Avisos por correo" link. A mailto to it with exactly this
// subject, as the href of a navbar entry, is the only link that is not https, and that whole link
// is the only place the bare company domain may appear in the file.
const CORREO_SOPORTE = 'soporte@nueveonce.com';
const ENLACE_AVISOS = `mailto:${CORREO_SOPORTE}?subject=Quiero%20recibir%20los%20avisos%20de%20estado%20de%20NueveOnce`;
const RUTA_PAGINA = `${BASE_URL}/`;
// Hosts a site may point at, in its URL or in any other field. Compared exactly.
const HOSTS_SITIOS = Object.freeze([...HOSTS_COMPONENTES, HOST_PAGINA, DOMINIO_PAGINA]);
// Hosts allowed in the rest of the configuration: page links, logo, footer.
const HOSTS_CONFIG = Object.freeze([
  ...HOSTS_SITIOS,
  HOST_SOPORTE,
  'github.com',
  'api.github.com',
  'docs.github.com',
  'upptime.js.org',
]);
// Placeholders that stand for a URL until a person fills them in. The real value then needs its
// host in HOSTS_CONFIG, added by an earlier change to this file.
const MARCADORES = Object.freeze(['__SUPPORT_URL__']);

// Keys the configuration may use. uptime-monitor and the page act on many more, and some of them
// hand control to whoever writes the file: raw HTML or script in the page (customHeadHtml,
// customBodyHtml, js, css), another npm package as the site (customStatusWebsitePackage), insecure
// TLS (__dangerous__insecure), extra issue labels (tags). "cname" is allowed with one value only,
// DOMINIO_PAGINA (validarRepositorio).
const CLAVES_RAIZ = Object.freeze([
  'owner',
  'repo',
  'user-agent',
  'assignees',
  'secrets',
  'skipDescriptionUpdate',
  'skipTopicsUpdate',
  'skipHomepageUpdate',
  'skipPoweredByReadme',
  'skipDeleteIssues',
  'commitMessages',
  'sites',
  'status-website',
  'i18n',
]);
const CLAVES_SITIO = Object.freeze([
  'name',
  'slug',
  'url',
  'expectedStatusCodes',
  'maxRedirects',
  'maxResponseTime',
  'connectTimeout',
  'requestTimeout',
  'maxRetries',
  'headers',
  '__dangerous__body_down_if_text_missing',
  'icon',
]);
const CLAVES_PAGINA = Object.freeze([
  'baseUrl',
  'cname',
  'name',
  'introTitle',
  'introMessage',
  'logoUrl',
  'favicon',
  'faviconSvg',
  'navbar',
  'productionCacheTime',
  'metaTags',
  'links',
  'scripts',
]);
// Keys whose whole value is a URL.
const CLAVES_URL = Object.freeze(['url', 'icon', 'href', 'src', 'logoUrl', 'favicon', 'faviconSvg']);

// commitMessages may only set who authors the commits, and it must be the App bot. The other
// keys rewrite the commit messages, which the page parses (Graph.svelte reads response times out
// of "... ms) [skip ci]") and whose "[skip ci]" keeps history commits from starting workflows.
const CLAVES_COMMITS = Object.freeze(['commitAuthorName', 'commitAuthorEmail']);

const CHEQUEO_CUERPO = '__dangerous__body_down_if_text_missing';

// What a component name may contain. Upptime writes the name into the issues it opens and into
// its "Resolved" comments, which the page renders as raw HTML through snarkdown, so a name with
// "<", a bracket or a "$" could carry markup or a link onto the page.
const NOMBRE_COMPONENTE = /^[\p{L}\p{N} .()-]+$/u;
const MOTIVO_NOMBRE =
  'solo puede tener letras, números, espacios, puntos, guiones y paréntesis: Upptime lo copia en los issues y comentarios que la página muestra como HTML.';

// Every text outside "sites" reaches the page's HTML unescaped: through {@html}, and for the
// footer, the title and the intro through snarkdown 2.0.0 first (_layout.svelte, index.svelte).
// snarkdown takes a link's or an image's target from "](", up to the next ")", and a reference
// definition "[name]: target", alone on its line, gives its target to any "[name]" of the text.
const DESTINO_ENLACE = /\]\(([^)]*)/g;
const DEFINICION_ENLACE = /^\[(.+?)\]:\s*(.+)$/gm;
// The footer's placeholder for this repository's address (_layout.svelte).
const MARCADOR_REPO = '$REPO';

// A site URL is https, has no user, port, fragment or unusual character, and its host is the one
// new URL() reads. The raw form is checked too, because libcurl, not new URL(), makes the request
// and the two parsers disagree on inputs such as backslashes.
const URL_SITIO = /^https:\/\/([a-z0-9.-]+)(\/[A-Za-z0-9._~%/-]*)?(\?[A-Za-z0-9._~%=&-]*)?$/;
const URL_EN_TEXTO = /https?:\/\/[^\s"'<>()[\]{}|\\^`]+/gi;
// Any name under the company domain, written anywhere in the file, comments included.
const MENCION_DOMINIO = /[A-Za-z0-9_.-]*nueveonce\.com(?![A-Za-z0-9_-])/gi;

const USO_ACCION = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./-]+)?@[0-9a-f]{40}$/;
const USO_LOCAL = /^\.\/[A-Za-z0-9_./-]+$/;
const USO_DOCKER = /^docker:\/\/[A-Za-z0-9_./:-]+@sha256:[0-9a-f]{64}$/;

// The environment that holds the GitHub App key, and the key's secret. The key may only meet
// pinned code: the jobs that build with unpinned npm packages run without any environment.
const ENTORNO_LLAVE = 'estado';
const SECRETO_LLAVE = 'GH_APP_PRIVATE_KEY';
// Triggers that run master's workflow, where the "estado" environment opens, on events anyone can
// cause: pull_request_target for a fork's pull request, with secrets and a write token, and
// workflow_run after any other workflow, a fork's pull request run included.
const DISPARADORES_PROHIBIDOS = Object.freeze(['pull_request_target', 'workflow_run']);
// uptime-monitor commands that run only the action's pinned code, git and the GitHub API
// (src/index.ts at v1.46.5, whose default command is "update"): "site" installs and builds
// @upptime/status-page with npm, and "graphs" runs npx @upptime/graphs and imagemin-cli.
const COMANDOS_UPTIME_SIN_NPM = Object.freeze(['update', 'response-time', 'readme']);
const ACCION_UPTIME = /^upptime\/uptime-monitor@/i;
const ACCION_SETUP_NODE = /^actions\/setup-node@/i;
// Package managers that fetch and run npm code, and the folder they install it into.
const CODIGO_NPM = /\b(?:npm|npx|yarn|pnpm|pnpx|bun|bunx|corepack|node_modules)\b/i;
// The secrets a workflow may read: the App key, and GITHUB_TOKEN where that rule allows it. Any
// other one, a personal token for example, would be a second identity with write access.
const SECRETOS_PERMITIDOS = Object.freeze([SECRETO_LLAVE.toLowerCase(), 'github_token']);
// The one documented exception to the App being the only identity with write access: a job
// without an environment that runs no npm code may let GITHUB_TOKEN write these, and nothing else.
const ESCRITURAS_DE_EXCEPCION = Object.freeze(['issues', 'pull-requests']);
// The step that mints the App token, and the only value that names its token.
const ACCION_TOKEN_APP = /^actions\/create-github-app-token@/i;
const TOKEN_DE_LA_APP = /^\$\{\{\s*steps\s*\.\s*([A-Za-z_][\w-]*)\s*\.\s*outputs\s*\.\s*token\s*\}\}$/i;
// The actions of this repository's workflows with a token input whose default is github.token,
// read in each action.yml at its pinned SHA. An action added later with such a default goes here.
const ENTRADAS_DE_TOKEN = Object.freeze([
  Object.freeze({ accion: 'actions/checkout', patron: /^actions\/checkout@/i, entrada: 'token' }),
  Object.freeze({ accion: 'actions/github-script', patron: /^actions\/github-script@/i, entrada: 'github-token' }),
  Object.freeze({ accion: 'benc-uk/workflow-dispatch', patron: /^benc-uk\/workflow-dispatch@/i, entrada: 'token' }),
  Object.freeze({ accion: 'actions/setup-node', patron: ACCION_SETUP_NODE, entrada: 'token' }),
]);
// download-artifact reads another run's or another repository's artifacts only through these
// inputs; without them it downloads what the same run uploaded.
const ACCION_DESCARGA = /^actions\/download-artifact@/i;
const ENTRADAS_DE_OTRA_EJECUCION = Object.freeze(['run-id', 'github-token', 'repository']);
// What runs next to the key without this file reading it: a container image or service containers
// around the steps, a local action (an action.yml of the change itself), and a cache, which a job
// running npm code may have written.
const CLAVES_OCULTAS = Object.freeze(['container', 'services']);
const NOMBRE_CACHE = /cache/i;

const PERMISOS_VACIOS = /^permissions:[ \t]*\{[ \t]*\}[ \t]*(?:#.*)?$/;
const DISPARADOR_EN_TEXTO = /\b(pull_request_target|workflow_run)\b/gi;
// A "run:" or "script:" key followed by its value on the same line ("|", ">" or the code). Input
// names are matched without case, as GitHub does.
const CLAVE_DE_CODIGO = /^(\s*)(-\s+)?(run|script)\s*:(.*)$/i;

const MOTIVO_PERMISOS = 'la raíz del workflow debe declarar "permissions: {}", para que cada job pida solo los permisos que usa.';
const MOTIVO_EXPRESIONES = 'no interpoles expresiones "${{ }}" en run ni en script; pásalas por env.';
const MOTIVO_LLAVE = `${SECRETO_LLAVE} solo se puede leer en un job con el environment "${ENTORNO_LLAVE}", y nunca mediante toJSON(secrets), un nombre calculado ni "secrets: inherit".`;
const MOTIVO_NPM = `un job con el environment "${ENTORNO_LLAVE}" no puede ejecutar npm, npx, yarn ni otro gestor de paquetes: el código de npm sin fijar quedaría junto a la llave de la App.`;
const MOTIVO_NPM_RAIZ = 'los "defaults" y el "env" de la raíz llegan a todos los jobs, también a los que tienen la llave';
const MOTIVO_TOKEN =
  'github.token y secrets.GITHUB_TOKEN solo se pueden usar en un job sin environment cuyos permisos sean exactamente "contents: read", o en la única excepción: un job sin environment ni npm cuyo GITHUB_TOKEN solo escribe en issues y pull-requests.';
const MOTIVO_SECRETOS = `solo se pueden leer los secretos ${SECRETO_LLAVE} y GITHUB_TOKEN: la App es la única identidad con escritura, sin ningún otro token de respaldo.`;
const MOTIVO_ESCRITURA =
  'GITHUB_TOKEN solo puede escribir en issues y pull-requests, y solo en un job sin environment que no ejecuta npm; para todo lo demás, la App es la única identidad con escritura.';
const MOTIVO_TOKEN_APP =
  'en un job con la llave, el token de la App es la única fuente de token: GITHUB_TOKEN no recibe permisos, y cada acción que lo usaría por defecto recibe steps.<id>.outputs.token de un paso anterior de actions/create-github-app-token.';
const MOTIVO_ARTEFACTO =
  'un job con la llave publica solo lo que subió esta misma ejecución: actions/download-artifact sin run-id, github-token ni repository, y de otro job solo needs.<job>.result, porque sus salidas las elige el código que corrió sin la llave.';
const MOTIVO_OCULTO =
  'un job con la llave no puede usar contenedores, servicios, acciones locales ni cachés: este verificador no lee el código que corre ahí, y una caché la puede haber escrito el código de npm de otro job.';

const MAX_HOJAS = 100_000;

// Every rule this file can report. Each one needs a negative fixture that proves it fires.
const REGLAS = Object.freeze([
  'yaml',
  'slugs-esperados',
  'slug-duplicado',
  'nombres',
  'caracteres-nombre',
  'codigos',
  'redirecciones',
  'chequeo-cuerpo',
  'campos',
  'url',
  'host',
  'dolar',
  'marcado',
  'repositorio',
  'mensajes-commit',
  'idioma',
  'fusion',
  'parsers',
  'pin',
  'permisos',
  'disparadores',
  'expresiones',
  'llave',
  'secretos',
  'npm-con-llave',
  'codigo-oculto',
  'artefacto',
  'token-github',
  'escritura-github',
  'token-app',
]);

// The kinds of negative fixture: a .upptimerc.yml, a componentes.json and a workflow.
const TIPOS_DE_CASO = Object.freeze(['config', 'componentes', 'workflow']);

const ARCHIVO_COMPONENTES = '.github/scripts/componentes.json';

function esObjeto(valor) {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor) && !(valor instanceof Date);
}

// Quotes a value for a message, on one line and short.
function mostrar(valor) {
  const texto = String(valor);
  return JSON.stringify(texto.length > 80 ? `${texto.slice(0, 80)}…` : texto);
}

function primeraLinea(texto) {
  return String(texto || '').split('\n')[0];
}

// ["a", "b", "c"] and "o" -> "a, b o c".
function enumerar(lista, conjuncion) {
  return lista.length < 2 ? lista.join('') : `${lista.slice(0, -1).join(', ')} ${conjuncion} ${lista[lista.length - 1]}`;
}

function escaparRegex(texto) {
  return String(texto).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The App bot's noreply address; its numeric user id replaces the placeholder once it is known.
const CORREO_BOT = new RegExp(`^(?:__BOT_USER_ID__|[1-9][0-9]*)\\+${escaparRegex(BOT_LOGIN)}@users\\.noreply\\.github\\.com$`);

function rutaComoTexto(ruta) {
  return ruta.reduce(
    (texto, parte) => (typeof parte === 'number' ? `${texto}[${parte}]` : texto ? `${texto}.${parte}` : String(parte)),
    '',
  );
}

// Every key and every scalar under a value, with its path. A value reached twice through a YAML
// alias is visited in each place, because the rules depend on where it sits; only a cycle stops
// the walk.
function* hojas(valor, ruta, ancestros = new Set(), cuenta = { n: 0 }) {
  cuenta.n += 1;
  if (cuenta.n > MAX_HOJAS) throw new Error('el archivo tiene demasiados valores para revisarlo');
  if (valor instanceof Date) {
    yield { ruta, texto: valor.toISOString(), esClave: false };
    return;
  }
  if (Array.isArray(valor) || esObjeto(valor)) {
    if (ancestros.has(valor)) return;
    ancestros.add(valor);
    const entradas = Array.isArray(valor) ? valor.map((v, i) => [i, v]) : Object.entries(valor);
    for (const [clave, hijo] of entradas) {
      const rutaHijo = [...ruta, clave];
      if (!Array.isArray(valor)) yield { ruta: rutaHijo, texto: String(clave), esClave: true };
      yield* hojas(hijo, rutaHijo, ancestros, cuenta);
    }
    ancestros.delete(valor);
    return;
  }
  if (valor !== null && valor !== undefined) yield { ruta, texto: String(valor), esClave: false };
}

function extraerUrls(texto) {
  return (String(texto).match(URL_EN_TEXTO) || []).map((url) => url.replace(/[.,;:!?]+$/, ''));
}

function parsearUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

// The hostname when the URL parses and has no credentials, otherwise null.
function hostDe(url) {
  const parsed = parsearUrl(url);
  if (!parsed || parsed.username || parsed.password) return null;
  return parsed.hostname;
}

function esClaveUrl(ruta) {
  const ultima = ruta[ruta.length - 1];
  return typeof ultima === 'string' && CLAVES_URL.includes(ultima);
}

// status-website.navbar[<n>].href, the only place the support mailto may go.
function esEnlaceDelMenu(ruta) {
  return (
    ruta.length === 4 &&
    ruta[0] === 'status-website' &&
    ruta[1] === 'navbar' &&
    typeof ruta[2] === 'number' &&
    ruta[3] === 'href'
  );
}

function validarUrlSitio(url, donde, reportar) {
  if (typeof url !== 'string') {
    reportar('url', `${donde}.url falta o no es texto.`);
    return;
  }
  const m = URL_SITIO.exec(url);
  const parsed = parsearUrl(url);
  if (!m || !parsed || parsed.protocol !== 'https:' || parsed.port !== '' || parsed.hostname !== m[1]) {
    reportar('url', `${donde}.url ${mostrar(url)} no es una URL https simple (sin usuario, puerto, fragmento ni caracteres especiales).`);
    return;
  }
  if (!HOSTS_SITIOS.includes(parsed.hostname)) {
    reportar('host', `${donde}.url usa el host ${mostrar(parsed.hostname)}, que no está en la lista permitida.`);
  }
}

// Where GitHub Pages serves the site: the page's domain when the configuration sets cname (which
// validarRepositorio only accepts as DOMINIO_PAGINA), this repository's path on github.io otherwise.
function origenPagina(config) {
  const pagina = esObjeto(config) ? config['status-website'] : undefined;
  if (esObjeto(pagina) && pagina.cname !== undefined) return { host: DOMINIO_PAGINA, ruta: '/' };
  return { host: HOST_PAGINA, ruta: RUTA_PAGINA };
}

// A value that must be a whole https URL (icon, logo, favicon, link targets). Scripts and
// stylesheets run in the page, so they may only come from where the page itself is served.
function validarUrlCompleta(valor, ruta, permitidos, reportar, origen = origenPagina(null)) {
  const donde = rutaComoTexto(ruta);
  if (MARCADORES.includes(valor)) return;
  if (valor === ENLACE_AVISOS && esEnlaceDelMenu(ruta)) return;
  const parsed = parsearUrl(valor);
  if (!parsed || parsed.protocol !== 'https:' || parsed.username || parsed.password || !/^https:\/\//i.test(valor)) {
    reportar('url', `${donde}: ${mostrar(valor)} no es una URL https completa.`);
    return;
  }
  if (!permitidos.includes(parsed.hostname)) {
    reportar('host', `${donde} usa el host ${mostrar(parsed.hostname)}, que no está en la lista permitida.`);
    return;
  }
  const carga = ruta[0] === 'status-website' && (ruta[1] === 'scripts' || ruta[1] === 'links');
  if (carga && (parsed.hostname !== origen.host || !parsed.pathname.startsWith(origen.ruta))) {
    reportar('host', `${donde}: los scripts y hojas de estilo solo pueden venir de https://${origen.host}${origen.ruta}.`);
  }
}

function validarUrlsEnTexto(hoja, permitidos, reportar) {
  for (const url of extraerUrls(hoja.texto)) {
    const host = hostDe(url);
    if (!host || !permitidos.includes(host)) {
      reportar('host', `${rutaComoTexto(hoja.ruta)}: la URL ${mostrar(url)} usa un host que no está en la lista permitida.`);
    }
  }
}

// A text outside "sites" carries no markup: no "<" or ">", and every link, image or reference
// definition points at the footer's $REPO or at a plain https URL, as the sanitizer defines it,
// on an allowed host. The host is the one of the target exactly as written, which is what
// snarkdown puts in the attribute: the URLs found in the text lose their trailing punctuation
// first, so "](https://upptime.js.org!)" passes that check with a host the page never meant.
function validarMarcado(hoja, reportar) {
  const donde = rutaComoTexto(hoja.ruta);
  if (/[<>]/.test(hoja.texto)) {
    reportar('marcado', `${donde}: ${mostrar(hoja.texto)} contiene "<" o ">"; la página muestra este texto como HTML.`);
  }
  const destinos = [
    ...[...hoja.texto.matchAll(DESTINO_ENLACE)].map((m) => m[1]),
    ...[...hoja.texto.matchAll(DEFINICION_ENLACE)].map((m) => m[2]),
  ];
  for (const destino of destinos) {
    if (destino === MARCADOR_REPO) continue;
    if (!esUrlSegura(destino)) {
      reportar('marcado', `${donde}: el enlace a ${mostrar(destino)} no es una URL https simple ni ${MARCADOR_REPO}; la página lo convertiría en un enlace o una imagen.`);
    } else if (!HOSTS_CONFIG.includes(hostDe(destino))) {
      reportar('host', `${donde}: el enlace a ${mostrar(destino)} usa el host ${mostrar(hostDe(destino))}, tal como está escrito, y no está en la lista permitida.`);
    }
  }
}

function validarClaves(objeto, permitidas, donde, reportar) {
  for (const clave of Object.keys(objeto)) {
    if (clave === '<<') continue; // the "fusion" rule reports it
    if (!permitidas.includes(clave)) {
      reportar('campos', `${donde}${clave}: campo no permitido (los permitidos son ${permitidas.join(', ')}).`);
    }
  }
}

function validarSitio(sitio, i, componentes, reportar) {
  const donde = `sites[${i}]`;
  if (!esObjeto(sitio)) {
    reportar('yaml', `${donde} no es un mapa.`);
    return null;
  }
  validarClaves(sitio, CLAVES_SITIO, `${donde}.`, reportar);

  for (const hoja of hojas(sitio, ['sites', i])) {
    // uptime-monitor replaces "$NAME" in site fields with environment variables, and its token
    // is one of them: a "$" could send the token to whatever host the site requests.
    if (hoja.texto.includes('$')) {
      reportar('dolar', `${rutaComoTexto(hoja.ruta)}: los campos de un sitio no pueden contener "$" (uptime-monitor lo reemplaza por variables de entorno, entre ellas su token).`);
    }
    if (hoja.esClave) continue;
    if (esClaveUrl(hoja.ruta)) {
      if (hoja.ruta.length > 3 || hoja.ruta[2] !== 'url') validarUrlCompleta(hoja.texto, hoja.ruta, HOSTS_SITIOS, reportar);
    } else {
      validarUrlsEnTexto(hoja, HOSTS_SITIOS, reportar);
    }
  }
  validarUrlSitio(sitio.url, donde, reportar);

  const codigos = sitio.expectedStatusCodes;
  if (!(Array.isArray(codigos) && codigos.length === 1 && codigos[0] === 200)) {
    reportar('codigos', `${donde}.expectedStatusCodes debe ser [200].`);
  }
  if (sitio.maxRedirects !== 0) {
    reportar('redirecciones', `${donde}.maxRedirects debe ser 0.`);
  }
  const chequeo = sitio[CHEQUEO_CUERPO];
  if (typeof chequeo !== 'string' || chequeo.trim() === '') {
    reportar('chequeo-cuerpo', `${donde} necesita ${CHEQUEO_CUERPO} con el texto que confirma que responde bien.`);
  }
  if (typeof sitio.name === 'string' && !NOMBRE_COMPONENTE.test(sitio.name)) {
    reportar('caracteres-nombre', `${donde}.name ${mostrar(sitio.name)} ${MOTIVO_NOMBRE}`);
  }

  if (typeof sitio.slug !== 'string' || sitio.slug.trim() === '') {
    reportar('slugs-esperados', `${donde} no tiene "slug".`);
    return null;
  }
  const esperado = componentes.find((componente) => componente.slug === sitio.slug);
  if (esperado && sitio.name !== esperado.nombre) {
    reportar('nombres', `${donde}.name es ${mostrar(sitio.name)}; para ${sitio.slug} se espera ${mostrar(esperado.nombre)} (componentes.json).`);
  }
  return sitio.slug;
}

function validarRepositorio(config, reportar) {
  if (config.owner !== PROPIETARIO) {
    reportar('repositorio', `owner es ${mostrar(config.owner)} y debe ser ${PROPIETARIO}: la página muestra como HTML los comentarios de los issues de ese repositorio.`);
  }
  if (config.repo !== REPOSITORIO) {
    reportar('repositorio', `repo es ${mostrar(config.repo)} y debe ser ${REPOSITORIO}: la página muestra como HTML los comentarios de los issues de ese repositorio.`);
  }
  const pagina = config['status-website'];
  const baseUrl = esObjeto(pagina) ? pagina.baseUrl : undefined;
  const cname = esObjeto(pagina) ? pagina.cname : undefined;
  if (cname === undefined) {
    if (baseUrl !== BASE_URL) {
      reportar('repositorio', `status-website.baseUrl es ${mostrar(baseUrl)} y debe ser ${BASE_URL}, la ruta en la que GitHub Pages publica este repositorio.`);
    }
    return;
  }
  if (cname !== DOMINIO_PAGINA) {
    reportar('repositorio', `status-website.cname es ${mostrar(cname)} y solo puede ser ${DOMINIO_PAGINA}: con otro dominio, GitHub Pages llevaría la página a quien lo controle.`);
  }
  if (baseUrl !== undefined) {
    reportar('repositorio', `status-website.baseUrl es ${mostrar(baseUrl)} y no va junto a cname: GitHub Pages sirve el dominio desde la raíz.`);
  }
}

function validarCommits(config, reportar) {
  const mensajes = config.commitMessages;
  if (!esObjeto(mensajes)) {
    reportar('mensajes-commit', `commitMessages debe ser un mapa con solo ${enumerar(CLAVES_COMMITS, 'y')}, para que los commits salgan a nombre del bot.`);
    return;
  }
  for (const clave of Object.keys(mensajes)) {
    if (clave === '<<') continue; // the "fusion" rule reports it
    if (!CLAVES_COMMITS.includes(clave)) {
      reportar('mensajes-commit', `commitMessages.${clave}: solo se permiten ${enumerar(CLAVES_COMMITS, 'y')}; Upptime y la página leen los demás mensajes de commit tal como vienen por defecto.`);
    }
  }
  if (mensajes.commitAuthorName !== BOT_LOGIN) {
    reportar('mensajes-commit', `commitMessages.commitAuthorName es ${mostrar(mensajes.commitAuthorName)} y debe ser ${BOT_LOGIN}.`);
  }
  if (typeof mensajes.commitAuthorEmail !== 'string' || !CORREO_BOT.test(mensajes.commitAuthorEmail)) {
    reportar('mensajes-commit', `commitMessages.commitAuthorEmail es ${mostrar(mensajes.commitAuthorEmail)} y debe ser la dirección noreply del bot (<id>+${BOT_LOGIN}@users.noreply.github.com).`);
  }
}

// The page formats every date with toLocaleString(i18n.locale), which throws on a malformed tag.
// Only a text is checked: Intl walks any array-like value up to its "length".
function validarIdioma(config, reportar) {
  if (!esObjeto(config.i18n) || config.i18n.locale === undefined) return;
  const locale = config.i18n.locale;
  let problema = typeof locale === 'string' ? null : 'no es texto';
  if (!problema) {
    try {
      Intl.getCanonicalLocales(locale);
    } catch (error) {
      problema = primeraLinea(error.message);
    }
  }
  if (problema) {
    reportar('idioma', `i18n.locale ${mostrar(locale)} no es una etiqueta de idioma válida (${problema}); la página fallaría al mostrar cada fecha.`);
  }
}

function validarConfig(config, componentes, reportar) {
  if (!esObjeto(config)) {
    reportar('yaml', 'El archivo no es un mapa YAML.');
    return;
  }
  const sitios = config.sites;
  if (!Array.isArray(sitios) || sitios.length === 0) {
    reportar('yaml', '"sites" debe ser una lista con al menos un sitio.');
    return;
  }
  validarClaves(config, CLAVES_RAIZ, '', reportar);

  for (const hoja of hojas(config, [])) {
    if (hoja.esClave && hoja.texto === '<<') {
      reportar('fusion', `${rutaComoTexto(hoja.ruta)}: js-yaml 5.4.3, el de uptime-monitor, no aplica las claves de fusión "<<"; escribe cada campo en su lugar.`);
    }
  }

  const slugs = sitios.map((sitio, i) => validarSitio(sitio, i, componentes, reportar)).filter((slug) => slug !== null);
  const conteo = new Map();
  for (const slug of slugs) conteo.set(slug, (conteo.get(slug) || 0) + 1);
  for (const [slug, veces] of conteo) {
    if (veces > 1) reportar('slug-duplicado', `El slug ${mostrar(slug)} aparece ${veces} veces.`);
  }
  const esperados = componentes.map((componente) => componente.slug);
  if (slugs.length !== esperados.length || slugs.some((slug, i) => slug !== esperados[i])) {
    reportar('slugs-esperados', `Los sitios deben ser exactamente ${esperados.join(', ')}, en ese orden; hay: ${slugs.map(mostrar).join(', ')}.`);
  }

  const pagina = config['status-website'];
  if (pagina !== undefined && !esObjeto(pagina)) {
    reportar('yaml', '"status-website" debe ser un mapa.');
  } else if (pagina !== undefined) {
    validarClaves(pagina, CLAVES_PAGINA, 'status-website.', reportar);
  }
  validarRepositorio(config, reportar);
  validarCommits(config, reportar);
  validarIdioma(config, reportar);

  // Everything outside "sites" ends up on the page too. Only "status-website" has URL-valued
  // keys; elsewhere ("i18n" included, which has a "url" label) values are display text.
  const origen = origenPagina(config);
  for (const [clave, valor] of Object.entries(config)) {
    if (clave === 'sites') continue;
    for (const hoja of hojas(valor, [clave])) {
      validarMarcado(hoja, reportar);
      if (hoja.esClave) continue;
      if (clave === 'status-website' && esClaveUrl(hoja.ruta)) {
        validarUrlCompleta(hoja.texto, hoja.ruta, HOSTS_CONFIG, reportar, origen);
      } else {
        validarUrlsEnTexto(hoja, HOSTS_CONFIG, reportar);
      }
    }
  }
}

// Names under the company domain that are not public components, in the raw text so that YAML
// comments count too. The support link is not such a name, so each exact copy of it goes first;
// the address anywhere else still counts.
function validarMenciones(texto, reportar) {
  const vistas = new Set();
  for (const mencion of String(texto).split(ENLACE_AVISOS).join(' ').match(MENCION_DOMINIO) || []) {
    const host = mencion.toLowerCase();
    if (HOSTS_COMPONENTES.includes(host) || host === HOST_SOPORTE || host === DOMINIO_PAGINA || vistas.has(host)) continue;
    vistas.add(host);
    reportar('host', `${mostrar(mencion)} no es uno de los componentes públicos; no escribas otros nombres del dominio.`);
  }
}

// A value with its keys sorted, so two parsers that order keys differently still compare equal.
function canonico(valor) {
  if (valor instanceof Date) return { fecha: valor.toISOString() };
  if (Array.isArray(valor)) return valor.map(canonico);
  if (esObjeto(valor)) {
    return Object.fromEntries(Object.keys(valor).sort().map((clave) => [clave, canonico(valor[clave])]));
  }
  return valor;
}

function compararParsers(documentoMonitor, documentoPagina, reportar) {
  if (JSON.stringify(canonico(documentoMonitor)) === JSON.stringify(canonico(documentoPagina))) return;
  reportar(
    'parsers',
    'js-yaml 5.4.3 (uptime-monitor) y js-yaml 4.3.2 (la página) leen el archivo distinto; evita las claves de fusión "<<", las fechas sin comillas y las etiquetas YAML especiales.',
  );
}

function validarTextoConfig(texto, yamlMonitor, yamlPagina, componentes = COMPONENTES) {
  const errores = [];
  const reportar = (regla, mensaje) => errores.push({ regla, mensaje });
  let monitor;
  let pagina;
  try {
    monitor = yamlMonitor.load(texto);
  } catch (error) {
    return [{ regla: 'yaml', mensaje: `js-yaml 5.4.3 no pudo leer el archivo: ${primeraLinea(error.message)}` }];
  }
  try {
    pagina = yamlPagina.load(texto);
  } catch (error) {
    return [{ regla: 'yaml', mensaje: `js-yaml 4.3.2 no pudo leer el archivo: ${primeraLinea(error.message)}` }];
  }
  try {
    validarMenciones(texto, reportar);
    validarConfig(monitor, componentes, reportar);
    compararParsers(monitor, pagina, reportar);
  } catch (error) {
    reportar('yaml', `No se pudo revisar el archivo: ${primeraLinea(error.message)}.`);
  }
  return errores;
}

function usoFijado(valor) {
  return typeof valor === 'string' && (USO_ACCION.test(valor) || USO_LOCAL.test(valor) || USO_DOCKER.test(valor));
}

// "owner/repo@sha # v1.2.3" -> "owner/repo@sha"; quotes removed.
function limpiarUso(texto) {
  const sinComentario = String(texto).replace(/\s+#.*$/, '').trim();
  return sinComentario.replace(/^(["'])(.*)\1$/, '$2');
}

function sangria(linea) {
  return linea.length - linea.trimStart().length;
}

// A line without its YAML comment. A "#" inside quotes may be cut too, which only hides text
// from the checks on the text; the parsed document still has it.
function sinComentario(linea) {
  return linea.replace(/(^|\s)#.*$/, '$1');
}

// Every "uses:" must name a full commit SHA: in the parsed document, and on every "uses:" line of
// the text, in case one sits where the walk does not look. Each bad value is reported once.
function revisarUsos(texto, doc, archivo, reportar) {
  const usos = [];
  if (esObjeto(doc) && esObjeto(doc.jobs)) {
    for (const [id, job] of Object.entries(doc.jobs)) {
      if (!esObjeto(job)) continue;
      if (job.uses !== undefined) usos.push({ donde: `jobs.${id}.uses`, valor: job.uses });
      if (Array.isArray(job.steps)) {
        job.steps.forEach((paso, i) => {
          if (esObjeto(paso) && paso.uses !== undefined) {
            usos.push({ donde: `jobs.${id}.steps[${i}].uses`, valor: paso.uses });
          }
        });
      }
    }
  }
  String(texto)
    .split(/\r?\n/)
    .forEach((linea, i) => {
      const m = /^\s*(?:-\s+)?uses\s*:\s*(.*)$/.exec(linea);
      if (m) usos.push({ donde: `línea ${i + 1}`, valor: limpiarUso(m[1]) });
    });
  const vistos = new Set();
  for (const uso of usos) {
    const clave = String(uso.valor);
    if (usoFijado(uso.valor) || vistos.has(clave)) continue;
    vistos.add(clave);
    reportar('pin', `${archivo} (${uso.donde}): ${mostrar(uso.valor)} no está fijado a un commit (SHA de 40 caracteres).`);
  }
}

function motivoDisparador(nombre) {
  return `el disparador ${nombre} no está permitido: corre el workflow de master, que puede abrir el environment "${ENTORNO_LLAVE}", ante eventos que cualquiera puede provocar, como el pull request de un fork.`;
}

// Three of the rules are read on the text as well, as the workflow tests once did: the text
// shows what another YAML parser could read differently, and works without a parser. The
// parsed document catches what the text spells differently (escapes, flow style, quoted keys).
function revisarTextoDelWorkflow(texto, archivo, reportar) {
  const lineas = String(texto).split(/\r?\n/);
  if (!lineas.some((linea) => PERMISOS_VACIOS.test(linea))) {
    reportar('permisos', `${archivo}: ${MOTIVO_PERMISOS}`);
  }
  lineas.forEach((linea, i) => {
    for (const m of sinComentario(linea).matchAll(DISPARADOR_EN_TEXTO)) {
      reportar('disparadores', `${archivo}: ${motivoDisparador(m[1].toLowerCase())}`);
    }
    // A key with nothing after it holds a mapping (a job named "run", for example), not code.
    const codigo = CLAVE_DE_CODIGO.exec(linea);
    if (!codigo || sinComentario(codigo[4]).trim() === '') return;
    const columna = codigo[1].length + (codigo[2] || '').length;
    const bloque = [linea];
    for (const siguiente of lineas.slice(i + 1)) {
      if (siguiente.trim() !== '' && sangria(siguiente) <= columna) break;
      bloque.push(siguiente);
    }
    if (bloque.some((parte) => parte.includes('${{'))) {
      reportar('expresiones', `${archivo} (línea ${i + 1}): ${MOTIVO_EXPRESIONES}`);
    }
  });
}

// The triggers of a workflow, in any of the forms "on:" takes.
function disparadoresDe(on) {
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on.filter((nombre) => typeof nombre === 'string');
  if (esObjeto(on)) return Object.keys(on);
  return [];
}

// "ninguno" without an environment, "estado" for the one with the App key (GitHub compares
// environment names without case), "dinamico" when an expression picks it, which may be
// "estado", and "otro" for any other.
function entornoDe(job) {
  if (!Object.prototype.hasOwnProperty.call(job, 'environment')) return 'ninguno';
  const nombre = esObjeto(job.environment) ? job.environment.name : job.environment;
  if (typeof nombre !== 'string') return 'otro';
  if (nombre.includes('${{')) return 'dinamico';
  return nombre.trim().toLowerCase() === ENTORNO_LLAVE ? 'estado' : 'otro';
}

// A job where the App key may be: its environment is "estado", or an expression that may pick it.
function tieneLlave(entorno) {
  return entorno === 'estado' || entorno === 'dinamico';
}

function soloLeeContenido(permisos) {
  return esObjeto(permisos) && Object.keys(permisos).length === 1 && permisos.contents === 'read';
}

// A job's GITHUB_TOKEN permissions as [scope, level] pairs, lowercased.
function nivelesDePermiso(permisos) {
  return Object.entries(permisos).map(([alcance, nivel]) => [alcance.trim().toLowerCase(), String(nivel).trim().toLowerCase()]);
}

// The scopes a job lets GITHUB_TOKEN write: any level other than "read" or "none" counts, and "*"
// stands for write-all or any value that is not a map of scopes. A job without "permissions"
// takes the root's, which the "permisos" rule holds at {}.
function escriturasDelToken(permisos) {
  if (permisos === undefined) return [];
  if (typeof permisos === 'string' && permisos.trim().toLowerCase() === 'read-all') return [];
  if (!esObjeto(permisos)) return ['*'];
  return nivelesDePermiso(permisos)
    .filter(([, nivel]) => nivel !== 'read' && nivel !== 'none')
    .map(([alcance]) => alcance);
}

// The documented exception's permissions: GITHUB_TOKEN writes issues, pull requests or both, and
// reads at most the contents.
function esPermisoDeExcepcion(permisos) {
  if (!esObjeto(permisos)) return false;
  const niveles = nivelesDePermiso(permisos);
  const escribe = ([alcance, nivel]) => ESCRITURAS_DE_EXCEPCION.includes(alcance) && nivel === 'write';
  return niveles.some(escribe) && niveles.every((par) => escribe(par) || (par[0] === 'contents' && par[1] === 'read'));
}

// No permissions at all: none declared (the root's {} applies), or every scope "none".
function sinPermisos(permisos) {
  return permisos === undefined || (esObjeto(permisos) && nivelesDePermiso(permisos).every(([, nivel]) => nivel === 'none'));
}

// A text GitHub evaluates as an expression: one with "${{ }}", or the value of an "if".
function esExpresion(hoja) {
  return !hoja.esClave && (hoja.texto.includes('${{') || hoja.ruta[hoja.ruta.length - 1] === 'if');
}

// The properties an expression reads from a context, lowercased: NAME for "ctx.NAME" or
// "ctx['NAME']", and "*" for the whole context or a computed name ("toJSON(secrets)",
// "secrets[x]"). GitHub compares context properties without case.
function propiedadesLeidas(texto, contexto) {
  const patron = new RegExp(
    `(?<![\\w.-])${contexto}(?![\\w-])(?:\\s*\\.\\s*([A-Za-z_][\\w-]*)|\\s*\\[\\s*'([^']*)'\\s*\\]|\\s*\\[\\s*"([^"]*)"\\s*\\])?`,
    'gi',
  );
  return [...String(texto).matchAll(patron)].map((m) => (m[1] ?? m[2] ?? m[3] ?? '*').trim().toLowerCase());
}

function leeLlave(texto) {
  return propiedadesLeidas(texto, 'secrets').some((nombre) => nombre === '*' || nombre === SECRETO_LLAVE.toLowerCase());
}

function leeTokenGithub(texto) {
  return (
    propiedadesLeidas(texto, 'github').some((nombre) => nombre === '*' || nombre === 'token') ||
    propiedadesLeidas(texto, 'secrets').some((nombre) => nombre === '*' || nombre === 'github_token')
  );
}

// The secrets an expression reads besides the allowed ones; "*" for the whole context or a
// computed name, which read every secret.
function secretosAjenos(texto) {
  return propiedadesLeidas(texto, 'secrets').filter((nombre) => !SECRETOS_PERMITIDOS.includes(nombre));
}

function describirSecreto(nombre) {
  return nombre === '*'
    ? 'lee todos los secretos (toJSON(secrets), un nombre calculado o "secrets: inherit")'
    : `lee secrets.${nombre}`;
}

// Every read of the needs context in an expression, as its chain of properties, lowercased:
// ["build", "outputs", "dir"] for needs.build.outputs.dir, [] for the whole context, and "?" for
// a computed property.
function lecturasDeNeeds(texto) {
  const lectura = /(?<![\w.-])needs(?![\w-])((?:\s*(?:\.\s*(?:[A-Za-z_][\w-]*|\*)|\[[^\]]*\]))*)/gi;
  const propiedad = /\.\s*([A-Za-z_][\w-]*|\*)|\[\s*(?:'([^']*)'|"([^"]*)"|[^\]]*)\s*\]/g;
  return [...String(texto).matchAll(lectura)].map((m) =>
    [...m[1].matchAll(propiedad)].map((p) => (p[1] ?? p[2] ?? p[3] ?? '?').trim().toLowerCase()),
  );
}

// Whether an expression reads nothing from other jobs but their result, a status that the job
// itself cannot choose.
function soloLeeResultados(texto) {
  return lecturasDeNeeds(texto).every((cadena) => cadena.length === 2 && cadena[1] === 'result');
}

function usoDe(paso) {
  return esObjeto(paso) && typeof paso.uses === 'string' ? paso.uses.trim() : '';
}

// The values a step passes to an input. GitHub matches input names without case, so "COMMAND"
// sets the "command" input; every spelling counts.
function valoresDeEntrada(paso, entrada) {
  if (!esObjeto(paso) || !esObjeto(paso.with)) return [];
  return Object.entries(paso.with)
    .filter(([clave]) => clave.trim().toLowerCase() === entrada)
    .map(([, valor]) => valor);
}

// The code a step hands to GitHub to run: its shell script and github-script's script.
function codigoDePaso(paso) {
  return [['run', paso.run], ...valoresDeEntrada(paso, 'script').map((valor) => ['with.script', valor])].filter(
    ([, valor]) => typeof valor === 'string',
  );
}

// Where a job runs npm code: a package manager or node_modules named anywhere in it,
// actions/setup-node, or an uptime-monitor command other than the three that run none.
function usosDeNpm(id, job) {
  const usos = [];
  const pasos = Array.isArray(job.steps) ? job.steps : [];
  pasos.forEach((paso, i) => {
    const uso = usoDe(paso);
    const lugar = `jobs.${id}.steps[${i}]`;
    if (ACCION_SETUP_NODE.test(uso)) {
      usos.push({ lugar: `${lugar}.uses`, detalle: 'actions/setup-node sirve para ejecutar npm' });
    }
    if (!ACCION_UPTIME.test(uso)) return;
    const comandos = valoresDeEntrada(paso, 'command');
    for (const comando of comandos.length > 0 ? comandos.map(String) : ['update']) {
      if (!COMANDOS_UPTIME_SIN_NPM.includes(comando)) {
        usos.push({
          lugar: `${lugar}.with.command`,
          detalle: `junto a la llave, uptime-monitor solo puede correr ${enumerar(COMANDOS_UPTIME_SIN_NPM, 'o')}, no ${mostrar(comando)}`,
        });
      }
    }
  });
  for (const hoja of hojas(job, ['jobs', id])) {
    if (CODIGO_NPM.test(hoja.texto)) usos.push({ lugar: rutaComoTexto(hoja.ruta), detalle: mostrar(hoja.texto) });
  }
  return usos;
}

// GITHUB_TOKEN writes nothing but issues and pull requests, and those only in a job without an
// environment that runs no npm code.
function revisarEscrituras(archivo, donde, job, entorno, correNpm, reportar) {
  const escrituras = escriturasDelToken(job.permissions);
  const lugar = `${archivo} (${donde}.permissions)`;
  const ajenas = escrituras.filter((alcance) => !ESCRITURAS_DE_EXCEPCION.includes(alcance));
  if (ajenas.length > 0) {
    const cuales = ajenas.includes('*') ? mostrar(job.permissions) : enumerar(ajenas, 'y');
    reportar('escritura-github', `${lugar}: GITHUB_TOKEN no puede escribir en ${cuales}; ${MOTIVO_ESCRITURA}`);
  }
  if (!escrituras.some((alcance) => ESCRITURAS_DE_EXCEPCION.includes(alcance))) return;
  if (entorno !== 'ninguno') reportar('escritura-github', `${lugar}: el job tiene un environment; ${MOTIVO_ESCRITURA}`);
  if (correNpm) reportar('escritura-github', `${lugar}: el job ejecuta npm; ${MOTIVO_ESCRITURA}`);
}

// In a job with the key: no container, services, local action or cache.
function revisarCodigoOculto(archivo, donde, job, pasos, reportar) {
  for (const clave of CLAVES_OCULTAS) {
    if (job[clave] !== undefined) reportar('codigo-oculto', `${archivo} (${donde}.${clave}): ${MOTIVO_OCULTO}`);
  }
  pasos.forEach((paso, i) => {
    if (!esObjeto(paso)) return;
    const lugar = `${archivo} (${donde}.steps[${i}]`;
    const uso = usoDe(paso);
    if (uso.startsWith('.')) reportar('codigo-oculto', `${lugar}.uses): ${mostrar(uso)} es una acción local; ${MOTIVO_OCULTO}`);
    if (NOMBRE_CACHE.test(uso.split('@')[0])) {
      reportar('codigo-oculto', `${lugar}.uses): ${mostrar(uso)} restaura o guarda una caché; ${MOTIVO_OCULTO}`);
    }
    for (const clave of esObjeto(paso.with) ? Object.keys(paso.with) : []) {
      if (NOMBRE_CACHE.test(clave)) reportar('codigo-oculto', `${lugar}.with.${clave}): ${MOTIVO_OCULTO}`);
    }
  });
}

// In a job with the key: the artifact comes from this run (other jobs' outputs are read with the
// expressions, in revisarJob).
function revisarDescargas(archivo, donde, pasos, reportar) {
  pasos.forEach((paso, i) => {
    if (!ACCION_DESCARGA.test(usoDe(paso)) || !esObjeto(paso.with)) return;
    for (const clave of Object.keys(paso.with)) {
      if (ENTRADAS_DE_OTRA_EJECUCION.includes(clave.trim().toLowerCase())) {
        reportar('artefacto', `${archivo} (${donde}.steps[${i}].with.${clave}): ${MOTIVO_ARTEFACTO}`);
      }
    }
  });
}

// In a job with the key: GITHUB_TOKEN gets no permissions, and every action that would take it by
// default gets the token of an App token step that runs before it.
function revisarTokensDeLaApp(archivo, donde, job, pasos, reportar) {
  if (!sinPermisos(job.permissions)) {
    reportar('token-app', `${archivo} (${donde}.permissions): GITHUB_TOKEN recibe permisos; ${MOTIVO_TOKEN_APP}`);
  }
  const pasosDeLaApp = new Set();
  pasos.forEach((paso, i) => {
    const uso = usoDe(paso);
    const conToken = ENTRADAS_DE_TOKEN.find(({ patron }) => patron.test(uso));
    if (conToken) {
      const valores = valoresDeEntrada(paso, conToken.entrada);
      const deLaApp = (valor) => {
        const m = typeof valor === 'string' ? TOKEN_DE_LA_APP.exec(valor.trim()) : null;
        return m !== null && pasosDeLaApp.has(m[1].toLowerCase());
      };
      if (valores.length === 0 || !valores.every(deLaApp)) {
        reportar(
          'token-app',
          `${archivo} (${donde}.steps[${i}].with.${conToken.entrada}): ${conToken.accion} no recibe en "${conToken.entrada}" el token de la App de un paso anterior; ${MOTIVO_TOKEN_APP}`,
        );
      }
    }
    if (ACCION_TOKEN_APP.test(uso) && typeof paso.id === 'string') pasosDeLaApp.add(paso.id.trim().toLowerCase());
  });
}

// npmEnLaRaiz: whether the root's defaults or env name npm code, which then reaches this job too.
function revisarJob(archivo, id, job, npmEnLaRaiz, reportar) {
  const donde = `jobs.${id}`;
  const entorno = entornoDe(job);
  const conLlave = tieneLlave(entorno);
  const pasos = Array.isArray(job.steps) ? job.steps : [];
  const npm = usosDeNpm(id, job);
  const correNpm = npm.length > 0 || npmEnLaRaiz;
  // GITHUB_TOKEN may be named where it is the job's one token: a key-less build that only reads
  // the contents, or the documented exception.
  const tokenPermitido =
    entorno === 'ninguno' && (soloLeeContenido(job.permissions) || (esPermisoDeExcepcion(job.permissions) && !correNpm));

  pasos.forEach((paso, i) => {
    if (!esObjeto(paso)) return;
    for (const [campo, codigo] of codigoDePaso(paso)) {
      if (codigo.includes('${{')) reportar('expresiones', `${archivo} (${donde}.steps[${i}].${campo}): ${MOTIVO_EXPRESIONES}`);
    }
  });
  revisarEscrituras(archivo, donde, job, entorno, correNpm, reportar);
  if (conLlave) {
    for (const uso of npm) reportar('npm-con-llave', `${archivo} (${uso.lugar}): ${uso.detalle}; ${MOTIVO_NPM}`);
    revisarCodigoOculto(archivo, donde, job, pasos, reportar);
    revisarDescargas(archivo, donde, pasos, reportar);
    revisarTokensDeLaApp(archivo, donde, job, pasos, reportar);
  }

  for (const hoja of hojas(job, ['jobs', id])) {
    if (!esExpresion(hoja)) continue;
    const lugar = `${archivo} (${rutaComoTexto(hoja.ruta)})`;
    if (entorno !== 'estado' && leeLlave(hoja.texto)) reportar('llave', `${lugar}: ${MOTIVO_LLAVE}`);
    if (!tokenPermitido && leeTokenGithub(hoja.texto)) reportar('token-github', `${lugar}: ${MOTIVO_TOKEN}`);
    for (const nombre of secretosAjenos(hoja.texto)) reportar('secretos', `${lugar}: ${describirSecreto(nombre)}; ${MOTIVO_SECRETOS}`);
    if (conLlave && !soloLeeResultados(hoja.texto)) {
      reportar('artefacto', `${lugar}: lee de otro job algo más que needs.<job>.result; ${MOTIVO_ARTEFACTO}`);
    }
  }
  // A caller of a reusable workflow hands it every secret it can read.
  if (typeof job.secrets === 'string' && job.secrets.trim().toLowerCase() === 'inherit') {
    if (entorno !== 'estado') reportar('llave', `${archivo} (${donde}.secrets): ${MOTIVO_LLAVE}`);
    reportar('secretos', `${archivo} (${donde}.secrets): ${describirSecreto('*')}; ${MOTIVO_SECRETOS}`);
  }
}

function revisarDocumentoDelWorkflow(doc, archivo, reportar) {
  if (!esObjeto(doc)) {
    reportar('yaml', `${archivo}: el workflow no es un mapa YAML.`);
    return;
  }
  for (const hoja of hojas(doc, [])) {
    if (hoja.esClave && hoja.texto === '<<') {
      reportar('fusion', `${archivo} (${rutaComoTexto(hoja.ruta)}): no uses claves de fusión "<<" en un workflow; js-yaml 5.4.3 no las aplica, así que este verificador leería el archivo distinto de GitHub.`);
    }
  }
  if (!(esObjeto(doc.permissions) && Object.keys(doc.permissions).length === 0)) {
    reportar('permisos', `${archivo}: ${MOTIVO_PERMISOS}`);
  }
  for (const nombre of disparadoresDe(doc.on)) {
    if (DISPARADORES_PROHIBIDOS.includes(nombre.toLowerCase())) {
      reportar('disparadores', `${archivo}: ${motivoDisparador(nombre.toLowerCase())}`);
    }
  }
  // Outside the jobs (env, defaults, concurrency at the root) a value reaches every job.
  for (const [clave, valor] of Object.entries(doc)) {
    if (clave === 'jobs') continue;
    for (const hoja of hojas(valor, [clave])) {
      if (!esExpresion(hoja)) continue;
      const lugar = `${archivo} (${rutaComoTexto(hoja.ruta)})`;
      if (leeLlave(hoja.texto)) reportar('llave', `${lugar}: ${MOTIVO_LLAVE}`);
      if (leeTokenGithub(hoja.texto)) reportar('token-github', `${lugar}: ${MOTIVO_TOKEN}`);
      for (const nombre of secretosAjenos(hoja.texto)) reportar('secretos', `${lugar}: ${describirSecreto(nombre)}; ${MOTIVO_SECRETOS}`);
    }
  }
  const jobs = esObjeto(doc.jobs) ? Object.entries(doc.jobs).filter(([, job]) => esObjeto(job)) : [];
  // The root's defaults (a run shell, for one) and env (NODE_OPTIONS, for one) apply in every job.
  const npmEnLaRaiz = ['defaults', 'env'].flatMap((clave) => [...hojas(doc[clave], [clave])].filter((hoja) => CODIGO_NPM.test(hoja.texto)));
  if (jobs.some(([, job]) => tieneLlave(entornoDe(job)))) {
    for (const hoja of npmEnLaRaiz) {
      reportar('npm-con-llave', `${archivo} (${rutaComoTexto(hoja.ruta)}): ${mostrar(hoja.texto)}: ${MOTIVO_NPM_RAIZ}; ${MOTIVO_NPM}`);
    }
  }
  for (const [id, job] of jobs) revisarJob(archivo, id, job, npmEnLaRaiz.length > 0, reportar);
}

// Checks a workflow: SHA pins, "permissions: {}" at the root, no trigger that runs master's
// workflow for a fork, no expression inside code, no secret but the App key and GITHUB_TOKEN, and
// the key only where the "estado" environment is. A job with the key runs no npm code (its own or
// the root's defaults and env), no container, services, local action or cache, publishes only its
// run's artifact, and has the App token as its one token. GITHUB_TOKEN is named only where it is a
// job's one token, and writes nothing, except in the documented exception: issues and pull
// requests, in a job without an environment that runs no npm code.
// cargar is the YAML loader; without it only the rules that read the text run, which is how the
// change's own workflow tests call it. scripts/validar.sh always passes js-yaml 5.4.3.
function validarWorkflow(texto, archivo, cargar) {
  let doc;
  if (cargar) {
    try {
      doc = cargar(texto);
    } catch (error) {
      return [{ regla: 'yaml', mensaje: `${archivo}: no se pudo leer como YAML (${primeraLinea(error.message)}).` }];
    }
  }
  const errores = [];
  const vistos = new Set();
  const reportar = (regla, mensaje) => {
    const clave = `${regla}|${mensaje}`;
    if (vistos.has(clave)) return;
    vistos.add(clave);
    errores.push({ regla, mensaje });
  };
  try {
    revisarUsos(texto, doc, archivo, reportar);
    revisarTextoDelWorkflow(texto, archivo, reportar);
    if (cargar) revisarDocumentoDelWorkflow(doc, archivo, reportar);
  } catch (error) {
    reportar('yaml', `${archivo}: no se pudo revisar (${primeraLinea(error.message)}).`);
  }
  return errores;
}

function archivosDeWorkflows(dirRepo) {
  const dir = path.join(dirRepo, '.github', 'workflows');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((nombre) => /\.ya?ml$/.test(nombre))
    .sort()
    .map((nombre) => path.join(dir, nombre));
}

// A component list given as data: [{ "slug": "...", "nombre": "..." }, ...]. Returns null when
// it has another shape.
function comoComponentes(valor) {
  if (!Array.isArray(valor) || valor.length === 0) return null;
  const valido = valor.every(
    (c) =>
      esObjeto(c) &&
      Object.keys(c).sort().join(',') === 'nombre,slug' &&
      typeof c.slug === 'string' &&
      /^[a-z0-9][a-z0-9-]*$/.test(c.slug) &&
      typeof c.nombre === 'string' &&
      c.nombre.trim() !== '',
  );
  return valido ? valor : null;
}

// The text of a componentes.json: its list when it has the right shape (null otherwise) and the
// problems found, the characters of each name included.
function revisarComponentes(texto) {
  let valor;
  try {
    valor = JSON.parse(texto);
  } catch {
    valor = null;
  }
  const componentes = comoComponentes(valor);
  if (!componentes) {
    return {
      componentes: null,
      errores: [{ regla: 'slugs-esperados', mensaje: `${ARCHIVO_COMPONENTES} debe ser una lista de { "slug", "nombre" }.` }],
    };
  }
  const errores = [];
  componentes.forEach(({ nombre }, i) => {
    if (!NOMBRE_COMPONENTE.test(nombre)) {
      errores.push({ regla: 'caracteres-nombre', mensaje: `${ARCHIVO_COMPONENTES}[${i}].nombre ${mostrar(nombre)} ${MOTIVO_NOMBRE}` });
    }
  });
  return { componentes, errores };
}

// The component list of the repository being checked, read as JSON, never run: with master's
// checker it is the change's own list. The rules that protect the page (hosts, "$", keys, pins,
// the characters of a name) stay master's; this list only keeps the configuration, the scripts
// and the workflows in step.
function leerComponentes(dirRepo) {
  const archivo = path.join(dirRepo, ARCHIVO_COMPONENTES);
  if (!fs.existsSync(archivo)) return { componentes: COMPONENTES, errores: [] };
  const { componentes, errores } = revisarComponentes(fs.readFileSync(archivo, 'utf8'));
  return { componentes: componentes || COMPONENTES, errores };
}

function validarRepo(dirRepo, yamlMonitor, yamlPagina) {
  const { componentes, errores } = leerComponentes(dirRepo);
  const archivoConfig = path.join(dirRepo, '.upptimerc.yml');
  if (!fs.existsSync(archivoConfig)) {
    errores.push({ regla: 'yaml', mensaje: 'Falta .upptimerc.yml.' });
  } else {
    for (const error of validarTextoConfig(fs.readFileSync(archivoConfig, 'utf8'), yamlMonitor, yamlPagina, componentes)) {
      errores.push({ ...error, mensaje: `.upptimerc.yml: ${error.mensaje}` });
    }
  }
  const workflows = archivosDeWorkflows(dirRepo);
  if (workflows.length === 0) errores.push({ regla: 'yaml', mensaje: 'No hay workflows en .github/workflows.' });
  for (const archivo of workflows) {
    const relativo = path.relative(dirRepo, archivo);
    errores.push(...validarWorkflow(fs.readFileSync(archivo, 'utf8'), relativo, yamlMonitor.load));
  }
  return errores;
}

// A config case may bring its own component list, as a change brings its componentes.json: the
// path of a JSON file next to the fixtures. Its names are not checked here, so a case can show a
// hostile name in both files.
function componentesDelCaso(caso, dirFixtures, componentes) {
  if (caso.componentes === undefined) return componentes;
  const propios = comoComponentes(JSON.parse(fs.readFileSync(path.join(dirFixtures, caso.componentes), 'utf8')));
  if (!propios) throw new Error(`${caso.archivo}: "componentes" debe apuntar a una lista de { slug, nombre }.`);
  return propios;
}

function validarCaso(caso, dirFixtures, yamlMonitor, yamlPagina, componentes) {
  const texto = fs.readFileSync(path.join(dirFixtures, caso.archivo), 'utf8');
  if (caso.tipo === 'config') {
    return validarTextoConfig(texto, yamlMonitor, yamlPagina, componentesDelCaso(caso, dirFixtures, componentes));
  }
  if (caso.tipo === 'componentes') return revisarComponentes(texto).errores;
  if (caso.tipo === 'workflow') return validarWorkflow(texto, caso.archivo, yamlMonitor.load);
  throw new Error(`Tipo de caso desconocido: ${mostrar(caso.tipo)}.`);
}

function leerManifiesto(dirFixtures) {
  return JSON.parse(fs.readFileSync(path.join(dirFixtures, 'negativos.json'), 'utf8'));
}

// Runs each fixture of negativos.json and compares the rules that fire with the expected ones.
// Returns a list of problems: empty means every rule is proven and the valid fixtures pass.
function comprobarNegativos(dirFixtures, yamlMonitor, yamlPagina) {
  const problemas = [];
  const resultados = [];
  const manifiesto = leerManifiesto(dirFixtures);
  // The fixtures describe their own fixed set of components, so they do not change when a
  // component is added to or removed from the page.
  const componentes = comoComponentes(manifiesto.componentes);
  if (!componentes) throw new Error('negativos.json debe declarar "componentes" como una lista de { slug, nombre }.');
  const probadas = new Set();
  for (const caso of manifiesto.casos) {
    const esperadas = [...new Set(caso.reglas)].sort();
    const errores = validarCaso(caso, dirFixtures, yamlMonitor, yamlPagina, componentes);
    const obtenidas = [...new Set(errores.map((e) => e.regla))].sort();
    const coincide = JSON.stringify(esperadas) === JSON.stringify(obtenidas);
    resultados.push({ archivo: caso.archivo, esperadas, obtenidas, coincide, errores });
    if (!coincide) {
      problemas.push(`${caso.archivo}: se esperaban [${esperadas.join(', ')}] y saltaron [${obtenidas.join(', ')}].`);
    } else {
      esperadas.forEach((regla) => probadas.add(regla));
    }
  }
  for (const regla of REGLAS) {
    if (!probadas.has(regla)) problemas.push(`La regla ${regla} no tiene un caso negativo que la demuestre.`);
  }
  for (const tipo of TIPOS_DE_CASO) {
    if (!manifiesto.casos.some((caso) => caso.tipo === tipo && caso.reglas.length === 0)) {
      problemas.push(`Falta un caso ${tipo} válido (sin reglas) que demuestre que las reglas no saltan siempre.`);
    }
  }
  return { problemas, resultados };
}

function cargarJsYaml(dir) {
  if (!dir) throw new Error('Faltan --js-yaml y --js-yaml-sitio.');
  const modulo = require(path.resolve(dir));
  if (typeof modulo.load !== 'function') throw new Error(`${dir} no es js-yaml.`);
  return modulo;
}

// Escapes a message for a GitHub Actions annotation.
function anotacion(regla, mensaje) {
  const datos = String(mensaje).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  return `::error title=validar (${regla})::${datos}`;
}

function imprimir(errores) {
  for (const error of errores) {
    console.log(`✗ [${error.regla}] ${error.mensaje}`);
    if (process.env.GITHUB_ACTIONS === 'true') console.log(anotacion(error.regla, error.mensaje));
  }
}

function main(argv) {
  const [modo, objetivo, ...resto] = argv;
  const opciones = {};
  for (let i = 0; i < resto.length; i += 2) opciones[resto[i].replace(/^--/, '')] = resto[i + 1];
  if (!['repo', 'negativos'].includes(modo) || !objetivo) {
    console.error('Uso: node validar.js repo|negativos <dir> --js-yaml <dir> --js-yaml-sitio <dir>');
    return 2;
  }
  const yamlMonitor = cargarJsYaml(opciones['js-yaml']);
  const yamlPagina = cargarJsYaml(opciones['js-yaml-sitio']);

  if (modo === 'repo') {
    const errores = validarRepo(path.resolve(objetivo), yamlMonitor, yamlPagina);
    imprimir(errores);
    console.log(errores.length === 0 ? '✓ .upptimerc.yml y workflows en orden.' : `${errores.length} problema(s).`);
    return errores.length === 0 ? 0 : 1;
  }

  const { problemas, resultados } = comprobarNegativos(path.resolve(objetivo), yamlMonitor, yamlPagina);
  for (const r of resultados) {
    console.log(`${r.coincide ? '✓' : '✗'} ${r.archivo}: [${r.obtenidas.join(', ')}]`);
    if (!r.coincide) r.errores.forEach((e) => console.log(`    [${e.regla}] ${e.mensaje}`));
  }
  for (const problema of problemas) {
    console.log(`✗ ${problema}`);
    if (process.env.GITHUB_ACTIONS === 'true') console.log(anotacion('negativos', problema));
  }
  if (problemas.length === 0) console.log(`✓ ${resultados.length} casos: cada regla salta donde debe.`);
  return problemas.length === 0 ? 0 : 1;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = {
  HOSTS_COMPONENTES,
  HOST_PAGINA,
  DOMINIO_PAGINA,
  HOSTS_SITIOS,
  HOSTS_CONFIG,
  CLAVES_RAIZ,
  CLAVES_SITIO,
  CLAVES_PAGINA,
  CLAVES_COMMITS,
  PROPIETARIO,
  REPOSITORIO,
  BASE_URL,
  ENTORNO_LLAVE,
  SECRETO_LLAVE,
  REGLAS,
  TIPOS_DE_CASO,
  comoComponentes,
  revisarComponentes,
  leerComponentes,
  extraerUrls,
  validarTextoConfig,
  usoFijado,
  limpiarUso,
  validarWorkflow,
  validarRepo,
  leerManifiesto,
  comprobarNegativos,
  anotacion,
  main,
};
