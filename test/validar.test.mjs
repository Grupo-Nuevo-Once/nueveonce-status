import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const v = require('../.github/scripts/validar.js');
const { COMPONENTES: VIVOS } = require('../.github/scripts/constantes.js');

const DIR_FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

// A fixed set of components, the same one the fixtures declare, so these tests do not change
// when a component is added to or removed from the page.
const COMPONENTES = v.leerManifiesto(DIR_FIXTURES).componentes;

// The parsers are stubbed: these tests check the rules on parsed values. scripts/validar.sh runs
// the same rules through the real js-yaml versions, over the fixtures in test/fixtures.
const parser = (valor) => ({ load: () => structuredClone(valor) });

const reglasDe = (errores) => [...new Set(errores.map((e) => e.regla))].sort();

const URLS = {
  'api-signo': 'https://api.signo.nueveonce.com/api/health/ready',
  'dashboard-signo': 'https://signo.nueveonce.com/',
  'api-integraciones': 'https://integrations.nueveonce.com/integrations/v1/health',
  'portal-desarrolladores': 'https://developers.nueveonce.com/',
  'telemedicina-web': 'https://telemedicine.nueveonce.com/',
  'aqui-contigo-web': 'https://aquicontigo.nueveonce.com/',
  'app-pacientes-web': 'https://app.nueveonce.com/',
  encuestas: 'https://encuestas.nueveonce.com/',
};

function base() {
  return {
    owner: 'Grupo-Nuevo-Once',
    repo: 'nueveonce-status',
    assignees: [],
    commitMessages: {
      commitAuthorName: 'nueveonce-status[bot]',
      commitAuthorEmail: '__BOT_USER_ID__+nueveonce-status[bot]@users.noreply.github.com',
    },
    sites: COMPONENTES.map(({ slug, nombre }) => ({
      name: nombre,
      slug,
      url: URLS[slug],
      expectedStatusCodes: [200],
      maxRedirects: 0,
      headers: ['User-Agent: NueveOnce-Estado/1.0 (+https://grupo-nuevo-once.github.io/nueveonce-status/)'],
      __dangerous__body_down_if_text_missing: 'ok',
      icon: 'https://grupo-nuevo-once.github.io/nueveonce-status/iconos/nueveonce.png',
    })),
    'status-website': {
      baseUrl: '/nueveonce-status',
      logoUrl: 'https://grupo-nuevo-once.github.io/nueveonce-status/logo-nueveonce.svg',
      navbar: [
        { title: 'Estado', href: 'https://grupo-nuevo-once.github.io/nueveonce-status/' },
        { title: 'Soporte', href: '__SUPPORT_URL__' },
        { title: 'Código', href: 'https://github.com/Grupo-Nuevo-Once/nueveonce-status' },
      ],
      links: [{ rel: 'stylesheet', href: 'https://grupo-nuevo-once.github.io/nueveonce-status/estado-es.css' }],
      scripts: [{ src: 'https://grupo-nuevo-once.github.io/nueveonce-status/estado-es.js' }],
    },
    i18n: { url: 'URL', locale: 'es-419', footer: 'Basado en [Upptime](https://upptime.js.org) y [GitHub]($REPO).' },
  };
}

function reglas(config, { texto = '', pagina = config, componentes = COMPONENTES } = {}) {
  return reglasDe(v.validarTextoConfig(texto, parser(config), parser(pagina), componentes));
}

function conSitio(cambio, i = 0) {
  const config = base();
  cambio(config.sites[i], config);
  return config;
}

function con(cambio) {
  const config = base();
  cambio(config);
  return config;
}

test('the baseline passes every rule', () => {
  assert.deepEqual(reglas(base()), []);
});

test('site URLs: plain https on an allowlisted host, compared exactly', () => {
  const casos = [
    ['http://api.signo.nueveonce.com/api/health/ready', ['url']],
    ['https://API.signo.nueveonce.com/api/health/ready', ['url']],
    ['https://api.signo.nueveonce.com:8443/api/health/ready', ['url']],
    ['https://api.signo.nueveonce.com/api/health/ready#x', ['url']],
    ['https://api.signo.nueveonce.com@example.com/', ['url']],
    ['https://api.signo.nueveonce.com\\@example.com/', ['url']],
    // The value also names "2esigno.nueveonce.com", which is not a component.
    ['https://api%2esigno.nueveonce.com/', ['host', 'url']],
    ['https://api.signo.nueveonce.com/ ', ['url']],
    ['https://example.com/', ['host']],
    ['https://api.signo.nueveonce.com.example.com/', ['host']],
    ['https://x.app.nueveonce.com/', ['host']],
    ['https://xapp.nueveonce.com/', ['host']],
    ['https://nueveonce.com/', ['host']],
    ['https://10.0.0.1/', ['host']],
    [42, ['url']],
  ];
  for (const [url, esperadas] of casos) {
    assert.deepEqual(reglas(conSitio((s) => (s.url = url))), esperadas, String(url));
  }
});

test('"$" is refused in every site field, keys included', () => {
  assert.deepEqual(reglas(conSitio((s) => s.headers.push('Authorization: Bearer $GH_PAT'))), ['dolar']);
  assert.deepEqual(reglas(conSitio((s) => (s.__dangerous__body_down_if_text_missing = '$SECRETO'))), ['dolar']);
  assert.deepEqual(reglas(conSitio((s) => (s.url = `${s.url}?t=$GH_PAT`))), ['dolar', 'url']);
  assert.deepEqual(reglas(conSitio((s) => (s.name = 'API $X'))), ['caracteres-nombre', 'dolar', 'nombres']);
  // Outside the sites, "$" is Upptime's own placeholder syntax and is allowed.
  assert.deepEqual(reglas(base()), []);
});

test('other site fields: icons and URLs inside text stay on allowlisted hosts', () => {
  assert.deepEqual(reglas(conSitio((s) => (s.icon = 'https://example.com/i.png'))), ['host']);
  assert.deepEqual(reglas(conSitio((s) => (s.icon = 'http://grupo-nuevo-once.github.io/nueveonce-status/i.png'))), ['url']);
  assert.deepEqual(reglas(conSitio((s) => s.headers.push('Referer: https://example.com/'))), ['host']);
  // Hosts that GitHub owns are fine on the page, but not in a site.
  assert.deepEqual(reglas(conSitio((s) => s.headers.push('Referer: https://github.com/'))), ['host']);
});

test('page fields: URL-valued keys are complete https URLs; scripts and styles come from /status/', () => {
  const pagina = (cambio) => reglas(con((config) => cambio(config['status-website'])));
  assert.deepEqual(pagina((p) => (p.logoUrl = 'javascript:alert(1)')), ['url']);
  assert.deepEqual(pagina((p) => (p.logoUrl = '//example.com/logo.svg')), ['url']);
  assert.deepEqual(pagina((p) => (p.navbar[1].href = 'https://example.com/soporte')), ['host']);
  assert.deepEqual(pagina((p) => (p.navbar[1].href = 'https://www.nueveonce.com/contacto')), []);
  assert.deepEqual(pagina((p) => (p.navbar[1].href = 'https://otro.nueveonce.com/contacto')), ['host']);
  assert.deepEqual(pagina((p) => (p.scripts[0].src = 'https://github.com/x.js')), ['host']);
  assert.deepEqual(pagina((p) => (p.links[0].href = 'https://grupo-nuevo-once.github.io/otro/x.css')), ['host']);
  assert.deepEqual(pagina((p) => (p.introMessage = 'Ver https://example.com/')), ['host']);
});

test('URL-valued keys hold one text, never a list or a map', () => {
  const pagina = (cambio) => reglas(con((config) => cambio(config['status-website'])));
  // The page turns the value into text ("//example.com/x.js") and uses it as the URL.
  assert.deepEqual(pagina((p) => (p.scripts[0].src = ['//example.com/x.js'])), ['url']);
  assert.deepEqual(pagina((p) => (p.scripts[0].src = [['//example.com/x.js']])), ['url']);
  assert.deepEqual(pagina((p) => (p.navbar[0].href = ['javascript:alert(1)'])), ['url']);
  assert.deepEqual(pagina((p) => (p.logoUrl = { a: '//example.com/logo.svg' })), ['url']);
  assert.deepEqual(pagina((p) => (p.links[0].href = { '//example.com/x.css': null })), ['url']);
  // Even a list holding a URL that passes as text.
  assert.deepEqual(pagina((p) => (p.links[0].href = [p.links[0].href])), ['url']);
  assert.deepEqual(reglas(conSitio((s) => (s.icon = ['//example.com/i.png']))), ['url']);
  assert.deepEqual(reglas(conSitio((s) => (s.icon = { '//example.com/i.png': true }))), ['url']);
  // One message per key, however many values it holds.
  const config = con((c) => (c['status-website'].scripts[0].src = ['//example.com/a.js', '//example.com/b.js']));
  const errores = v.validarTextoConfig('', parser(config), parser(config), COMPONENTES);
  assert.equal(errores.filter((e) => e.regla === 'url').length, 1);
  // i18n is display text: its "url" label is not a URL key.
  assert.deepEqual(reglas(con((c) => (c.i18n.url = ['URL']))), []);
});

test('i18n is display text: a "url" label is not a URL, but links inside the text are checked', () => {
  assert.deepEqual(reglas(con((c) => (c.i18n.footer = 'Ver [esto](https://example.com/)'))), ['host']);
});

test('component names: letters, digits, spaces, dots, hyphens and parentheses, in both files', () => {
  // The case's own list carries the same name, as a change would, so only the characters count.
  const conNombre = (nombre) => {
    const lista = COMPONENTES.map((c) => (c.slug === 'encuestas' ? { ...c, nombre } : c));
    const config = base();
    config.sites[7].name = nombre;
    return { config, lista };
  };
  for (const nombre of ['Encuestas', 'Aquí Contigo (web)', 'Portal v2.0 - beta', 'Ñandú 3']) {
    const { config, lista } = conNombre(nombre);
    assert.deepEqual(reglas(config, { componentes: lista }), [], nombre);
    assert.deepEqual(v.revisarComponentes(JSON.stringify(lista)).errores, [], nombre);
  }
  const hostiles = [
    'Encuestas [detalle](javascript:alert(1)) <img src=x onerror=alert(1)>',
    'Encuestas <b>x</b>',
    'Encuestas [x]',
    'Encuestas "x"',
    'Encuestas_x',
    'Encuestas: hoy',
    'Encuestas & co',
    'Encuestas\nx',
    'Encuestas\tx',
    'Encuestas\u200bx',
  ];
  for (const nombre of hostiles) {
    const { config, lista } = conNombre(nombre);
    assert.deepEqual(reglas(config, { componentes: lista }), ['caracteres-nombre'], JSON.stringify(nombre));
    assert.deepEqual(reglasDe(v.revisarComponentes(JSON.stringify(lista)).errores), ['caracteres-nombre'], JSON.stringify(nombre));
  }
  // "$" is also the token rule's.
  const { config, lista } = conNombre('Encuestas $GH_PAT');
  assert.deepEqual(reglas(config, { componentes: lista }), ['caracteres-nombre', 'dolar']);
});

test("the review's change: one hostile name in componentes.json and in .upptimerc.yml", () => {
  const dir = mkdtempSync(join(tmpdir(), 'validar-'));
  try {
    const nombre = 'Encuestas [detalle](javascript:alert(1)) <img src=x onerror=alert(1)>';
    const lista = COMPONENTES.map((c) => (c.slug === 'encuestas' ? { ...c, nombre } : c));
    const config = base();
    config.sites[7].name = nombre;
    mkdirSync(join(dir, '.github', 'scripts'), { recursive: true });
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(dir, '.upptimerc.yml'), 'config');
    writeFileSync(join(dir, '.github', 'scripts', 'componentes.json'), JSON.stringify(lista));
    writeFileSync(join(dir, '.github', 'workflows', 'x.yml'), 'permissions: {}\n');
    const documentos = new Map([
      ['config', config],
      ['permissions: {}\n', { on: 'workflow_dispatch', permissions: {}, jobs: {} }],
    ]);
    const yaml = { load: (texto) => structuredClone(documentos.get(texto)) };
    const errores = v.validarRepo(dir, yaml, yaml);
    assert.deepEqual(reglasDe(errores), ['caracteres-nombre']);
    assert.equal(errores.length, 2, 'once for each file');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('texts outside the sites: no "<" or ">", and links only to https URLs or $REPO', () => {
  const casos = [
    [(c) => (c.i18n.footer = '<img src=x onerror=alert(1)>'), ['marcado']],
    [(c) => (c.i18n.footer = '[x](javascript:alert(1))'), ['marcado']],
    [(c) => (c.i18n.footer = 'texto ](javascript:alert(1)'), ['marcado']],
    // snarkdown builds the link with a string replace, so "$`" would splice page text into it.
    [(c) => (c.i18n.footer = '[x](https://upptime.js.org/$`)'), ['marcado']],
    [(c) => (c.i18n.footer = "[x](https://upptime.js.org/$')"), ['marcado']],
    // Only the exact placeholder, which the footer replaces with this repository's address.
    [(c) => (c.i18n.footer = '[x]($REPO/issues)'), ['marcado']],
    // The browser decodes "&#64;" inside the attribute; the host the checker reads is not real.
    [(c) => (c.i18n.footer = '[x](https://upptime.js.org&#64;example.com/)'), ['host', 'marcado']],
    [(c) => (c['status-website'].introTitle = '![x](http://example.com/x.png)'), ['host', 'marcado']],
    [(c) => (c['status-website'].introMessage = 'Ver [detalle].\n[detalle]: javascript:alert(1)'), ['marcado']],
    [(c) => (c.i18n.incidentCommentSummary = '<svg onload=alert(1)> $DATE'), ['marcado']],
    [(c) => (c.i18n.overallUptime = 'Disponibilidad > $UPTIME'), ['marcado']],
    [(c) => (c['status-website'].metaTags = [{ name: 'description', content: '<script>' }]), ['marcado']],
    [(c) => (c.i18n['<b>'] = 'x'), ['marcado']],
    [(c) => (c['user-agent'] = 'x<y'), ['marcado']],
    // The host of a link target as written: the page's href keeps the punctuation that the URLs
    // found in the text lose.
    [(c) => (c.i18n.footer = 'Basado en [Upptime](https://upptime.js.org!).'), ['host']],
    [(c) => (c.i18n.footer = 'Basado en [Upptime](https://upptime.js.org.).'), ['host']],
    [(c) => (c['status-website'].introMessage = 'Ver [detalle].\n[detalle]: https://upptime.js.org!'), ['host']],
    // The page's HTML turns a character reference back into the character it names, after the
    // rules have read the text: "&#46;" and "&period;" are dots, with or without the ";" for a
    // numeric one.
    [(c) => (c['status-website'].introMessage = 'Ver ejemplo&#46;nueveonce&#46;com'), ['marcado']],
    [(c) => (c.i18n.footer = 'Ver ejemplo&period;nueveonce&period;com'), ['marcado']],
    [(c) => (c.i18n.footer = 'Ver ejemplo.nueveonce&#x2E;com'), ['marcado']],
    [(c) => (c.i18n.footer = 'Ver ejemplo.nueveonce&#46com'), ['marcado']],
  ];
  for (const [cambio, esperadas] of casos) {
    const config = con(cambio);
    assert.deepEqual(reglas(config), esperadas, JSON.stringify(config.i18n) + JSON.stringify(config['status-website'].introTitle));
  }
  const permitidos = [
    (c) => (c.i18n.footer = 'Página de estado. [Código abierto]($REPO), basado en [Upptime](https://upptime.js.org).'),
    (c) => (c.i18n.incidentReport = 'Ver detalle (#$NUMBER) →'),
    (c) => (c['status-website'].introMessage = 'Consulta [el estado](https://grupo-nuevo-once.github.io/nueveonce-status/) cuando quieras.'),
    (c) => (c.i18n.incidentBack = '← Volver al inicio'),
    (c) => (c.i18n.footer = 'Ver [la guía](https://upptime.js.org/docs/), [el código]($REPO).'),
    // An "&" that starts no reference.
    (c) => (c.i18n.footer = 'Investigación y desarrollo (I+D, R&D)'),
    (c) => (c['status-website'].navbar[2].href = 'https://github.com/Grupo-Nuevo-Once/nueveonce-status/issues?q=is%3Aissue&state=closed'),
  ];
  for (const cambio of permitidos) assert.deepEqual(reglas(con(cambio)), []);
  // A site's body check is raw HTML on purpose; it never reaches the page.
  assert.deepEqual(reglas(conSitio((s) => (s.__dangerous__body_down_if_text_missing = '<title>SIGNO</title>'))), []);
});

test('the page reads this repository and is published under /status', () => {
  const casos = [
    (c) => (c.owner = 'otra-organizacion'),
    (c) => (c.owner = 'grupo-nuevo-once'),
    (c) => delete c.owner,
    (c) => (c.repo = 'otro-repositorio'),
    (c) => delete c.repo,
    (c) => (c['status-website'].baseUrl = '/otro'),
    (c) => (c['status-website'].baseUrl = '/status/'),
    (c) => delete c['status-website'].baseUrl,
    (c) => delete c['status-website'],
  ];
  for (const cambio of casos) assert.deepEqual(reglas(con(cambio)), ['repositorio'], String(cambio));
});

test('commitMessages only names the App bot as the author', () => {
  const casos = [
    (c) => (c.commitMessages.statusChange = '$PREFIX $SITE_NAME cambió a $STATUS'),
    (c) => (c.commitMessages.summaryJson = 'resumen'),
    (c) => delete c.commitMessages,
    (c) => (c.commitMessages = 'nueveonce-status[bot]'),
    (c) => (c.commitMessages.commitAuthorName = 'Upptime Bot'),
    (c) => delete c.commitMessages.commitAuthorName,
    (c) => (c.commitMessages.commitAuthorEmail = 'nadie'),
    (c) => (c.commitMessages.commitAuthorEmail = '+nueveonce-status[bot]@users.noreply.github.com'),
    (c) => (c.commitMessages.commitAuthorEmail = '0+nueveonce-status[bot]@users.noreply.github.com'),
  ];
  for (const cambio of casos) assert.deepEqual(reglas(con(cambio)), ['mensajes-commit'], String(cambio));
  // Once the bot's numeric user id replaces the placeholder.
  assert.deepEqual(reglas(con((c) => (c.commitMessages.commitAuthorEmail = '123+nueveonce-status[bot]@users.noreply.github.com'))), []);
});

test('i18n.locale, when present, is a well-formed language tag', () => {
  for (const locale of ['es_419', '', 'xx_invalid!!', 42, ['es-419'], { length: 1e9 }]) {
    assert.deepEqual(reglas(con((c) => (c.i18n.locale = locale))), ['idioma'], JSON.stringify(locale));
  }
  for (const locale of ['es-419', 'es', 'es-MX']) {
    assert.deepEqual(reglas(con((c) => (c.i18n.locale = locale))), [], locale);
  }
  assert.deepEqual(reglas(con((c) => delete c.i18n.locale)), []);
});

test('names under the company domain must be public components, comments included', () => {
  assert.deepEqual(reglas(base(), { texto: '# api.signo.nueveonce.com y signo.nueveonce.com' }), []);
  assert.deepEqual(reglas(base(), { texto: '# ejemplo.nueveonce.com' }), ['host']);
  assert.deepEqual(reglas(base(), { texto: 'ver NUEVEONCE.COM' }), ['host']);
  assert.deepEqual(reglas(base(), { texto: 'x.api.signo.nueveonce.com' }), ['host']);
  assert.deepEqual(reglas(base(), { texto: 'nueveonce.community' }), []);
  // Every key and value as the parser reads it counts too: an escape in the raw text
  // ("nueveonce\x2ecom") hides the name from the first reading, not from the parser. These
  // cases pass no raw text at all.
  assert.deepEqual(reglas(con((c) => (c['status-website'].introMessage = 'Ver ejemplo.nueveonce.com'))), ['host']);
  assert.deepEqual(reglas(con((c) => (c.i18n['ejemplo.nueveonce.com'] = 'x'))), ['host']);
  assert.deepEqual(reglas(con((c) => (c['status-website'].introMessage = 'Escribe a soporte@nueveonce.com'))), ['host']);
  // The exact support link is not a name, read either way.
  const enlace = 'mailto:soporte@nueveonce.com?subject=Quiero%20recibir%20los%20avisos%20de%20estado%20de%20NueveOnce';
  assert.deepEqual(reglas(con((c) => (c['status-website'].navbar[2].href = enlace)), { texto: enlace }), []);
});

test('"Avisos por correo": a mailto to either mailbox, with the exact subject, only as a navbar href', () => {
  const asunto = 'Quiero%20recibir%20los%20avisos%20de%20estado%20de%20NueveOnce';
  for (const correo of ['josuna@nueveonce.com', 'soporte@nueveonce.com']) {
    const enlace = `mailto:${correo}?subject=${asunto}`;
    assert.deepEqual(reglas(con((c) => (c['status-website'].navbar[2].href = enlace)), { texto: enlace }), [], correo);
    assert.deepEqual(reglas(con((c) => (c['status-website'].logoUrl = enlace)), { texto: enlace }), ['url'], correo);
    const conCopia = `${enlace}&bcc=alguien@example.org`;
    assert.deepEqual(reglas(con((c) => (c['status-website'].navbar[2].href = conCopia)), { texto: conCopia }), ['url'], correo);
    // The address alone, anywhere else, is a name under the company domain.
    assert.deepEqual(reglas(base(), { texto: `# Escribe a ${correo}` }), ['host'], correo);
  }
  // Any other mailbox is refused like any other link that is not https.
  const otro = `mailto:alguien@example.org?subject=${asunto}`;
  assert.deepEqual(reglas(con((c) => (c['status-website'].navbar[2].href = otro)), { texto: otro }), ['url']);
});

test('keys outside the allowlists are refused', () => {
  assert.deepEqual(reglas(conSitio((s) => (s.tags = ['manual']))), ['campos']);
  assert.deepEqual(reglas(conSitio((s) => (s.__dangerous__insecure = true))), ['campos']);
  assert.deepEqual(reglas(con((c) => (c.customStatusWebsitePackage = 'otro-paquete'))), ['campos']);
});

// The page on its own domain: cname set to that domain and no baseUrl, since GitHub Pages then
// serves the site from the domain's root.
function conDominio(config) {
  const pagina = config['status-website'];
  delete pagina.baseUrl;
  pagina.cname = 'status.nueveonce.com';
  pagina.links[0].href = 'https://status.nueveonce.com/estado-es.css';
  pagina.scripts[0].src = 'https://status.nueveonce.com/estado-es.js';
}

test('the page may move to its own domain, and only to status.nueveonce.com', () => {
  assert.deepEqual(reglas(con(conDominio)), []);
  // Any other domain would hand the page, and github.io's redirect, to whoever controls it.
  const otros = [
    ['status.example.com', ['repositorio']],
    // The bare company domain is also a name that is not a public component.
    ['nueveonce.com', ['host', 'repositorio']],
    ['Status.nueveonce.com', ['repositorio']],
    ['', ['repositorio']],
    [true, ['repositorio']],
  ];
  for (const [cname, esperadas] of otros) {
    assert.deepEqual(reglas(con((c) => { conDominio(c); c['status-website'].cname = cname; })), esperadas, String(cname));
  }
  // A domain and a path at once: the domain's site is served from its root.
  for (const baseUrl of ['/nueveonce-status', '/']) {
    assert.deepEqual(reglas(con((c) => { conDominio(c); c['status-website'].baseUrl = baseUrl; })), ['repositorio'], baseUrl);
  }
});

test('scripts and styles load from where the page is served', () => {
  const enGithub = 'https://grupo-nuevo-once.github.io/nueveonce-status/estado-es.js';
  assert.deepEqual(reglas(con((c) => { conDominio(c); c['status-website'].scripts[0].src = enGithub; })), ['host']);
  assert.deepEqual(reglas(con((c) => (c['status-website'].scripts[0].src = 'https://status.nueveonce.com/estado-es.js'))), ['host']);
  // The other page URLs may name either host: github.io redirects to the domain.
  const logo = (url) => (c) => { conDominio(c); c['status-website'].logoUrl = url; };
  assert.deepEqual(reglas(con(logo('https://status.nueveonce.com/logo-nueveonce.svg'))), []);
  assert.deepEqual(reglas(con(logo('https://grupo-nuevo-once.github.io/nueveonce-status/logo-nueveonce.svg'))), []);
  assert.deepEqual(reglas(conSitio((s) => (s.headers[0] = 'User-Agent: NueveOnce-Estado/1.0 (+https://status.nueveonce.com/)'))), []);
  // Named anywhere in the file, the page's domain is not an internal name.
  assert.deepEqual(reglas(base(), { texto: 'cname: status.nueveonce.com' }), []);
});

test('merge keys and parser disagreements', () => {
  // Both stubs return the same object here; the real parsers also disagree (configs/fusion.yml).
  assert.deepEqual(reglas(conSitio((s) => (s['<<'] = { maxRetries: 2 }))), ['fusion']);
  const otra = base();
  otra.sites[0].maxRetries = 2;
  assert.deepEqual(reglas(base(), { pagina: otra }), ['parsers']);
  const conFecha = base();
  conFecha['status-website'].introTitle = new Date('2026-11-21T00:00:00Z');
  const conTexto = base();
  conTexto['status-website'].introTitle = '2026-11-21';
  assert.deepEqual(reglas(conTexto, { pagina: conFecha }), ['parsers']);
});

test('slugs: exactly the eight components, in order, each once', () => {
  const desordenada = base();
  desordenada.sites.reverse();
  assert.deepEqual(reglas(desordenada), ['slugs-esperados']);
  const sinUno = base();
  sinUno.sites.pop();
  assert.deepEqual(reglas(sinUno), ['slugs-esperados']);
  const repetida = base();
  repetida.sites[7] = structuredClone(repetida.sites[6]);
  assert.deepEqual(reglas(repetida), ['slug-duplicado', 'slugs-esperados']);
  assert.deepEqual(reglas(conSitio((s) => delete s.slug)), ['slugs-esperados']);
  assert.deepEqual(reglas(conSitio((s) => (s.name = 'Otra cosa'))), ['nombres']);
});

test('status codes, redirects and the body check', () => {
  for (const codigos of [[200, 301], ['200'], [], undefined, 200]) {
    assert.deepEqual(reglas(conSitio((s) => (s.expectedStatusCodes = codigos))), ['codigos'], JSON.stringify(codigos));
  }
  for (const redirecciones of [3, '0', undefined, null]) {
    assert.deepEqual(reglas(conSitio((s) => (s.maxRedirects = redirecciones))), ['redirecciones'], String(redirecciones));
  }
  for (const chequeo of ['', '   ', undefined, 5]) {
    assert.deepEqual(reglas(conSitio((s) => (s.__dangerous__body_down_if_text_missing = chequeo))), ['chequeo-cuerpo'], String(chequeo));
  }
});

test('documents that are not a configuration', () => {
  assert.deepEqual(reglas([]), ['yaml']);
  assert.deepEqual(reglas({ owner: 'x' }), ['yaml']);
  assert.deepEqual(reglas(conSitio((s, config) => (config.sites[0] = 'texto'))), ['slugs-esperados', 'yaml']);
  const roto = { load: () => { throw new Error('bad indentation\nmore'); } };
  assert.deepEqual(v.validarTextoConfig('x', roto, parser(base())).map((e) => e.regla), ['yaml']);
});

// Workflows. The parsed half of a rule is checked with a stubbed document and a text that passes
// every rule read on the text; the text half, without a parser, as test/flujos.test.mjs calls it.
const SHA = 'd23441a48e516b6c34aea4fa41551a30e30af803';
const NEUTRO = 'permissions: {}\n';
const enDoc = (doc, texto = NEUTRO) => reglasDe(v.validarWorkflow(texto, 'x.yml', () => structuredClone(doc)));
const enTexto = (texto) => reglasDe(v.validarWorkflow(texto, 'x.yml'));
const LECTURA = { contents: 'read' };
const ESTADO = { name: 'estado', deployment: false };
const flujo = (jobs, extra = {}) => ({ name: 'x', on: 'workflow_dispatch', permissions: {}, ...extra, jobs });
const sinEntorno = (steps, permissions = LECTURA) => ({ 'runs-on': 'ubuntu-latest', permissions, steps });
const conEntorno = (steps, environment = ESTADO) => ({ 'runs-on': 'ubuntu-latest', environment, steps });
const PASO_LLAVE = {
  id: 'app_token',
  uses: `actions/create-github-app-token@${SHA}`,
  with: { 'client-id': '${{ vars.GH_APP_ID }}', 'private-key': '${{ secrets.GH_APP_PRIVATE_KEY }}' },
};
// The token PASO_LLAVE mints.
const APP = '${{ steps.app_token.outputs.token }}';
const uptime = (comando) => ({
  uses: `upptime/uptime-monitor@${SHA}`,
  ...(comando === undefined ? {} : { with: { command: comando } }),
  env: { GH_PAT: '${{ steps.app_token.outputs.token }}' },
});
const paso = (campos) => ({ name: 'Paso', ...campos });
const unJob = (job) => enDoc(flujo({ j: job }));

test('workflows: every "uses:" names a full commit SHA', () => {
  const fijado = [
    NEUTRO,
    `      - uses: actions/checkout@${SHA} # v6.1.0`,
    `      - uses: "actions/github-script@${SHA}"`,
    `    uses: actions/reusable/.github/workflows/x.yml@${SHA}`,
    '      - uses: ./.github/actions/local',
    `      - uses: docker://alpine@sha256:${'a'.repeat(64)}`,
  ].join('\n');
  assert.deepEqual(v.validarWorkflow(fijado, 'x.yml'), []);
  for (const uso of ['actions/checkout@v6.1.0', 'actions/checkout@main', 'actions/checkout@d23441a', `actions/checkout@${SHA.toUpperCase()}`, 'docker://alpine:3', 'actions/checkout']) {
    assert.deepEqual(enTexto(`${NEUTRO}      - uses: ${uso}`), ['pin'], uso);
  }
});

test('workflows: the parsed document is walked too, and each bad value is reported once', () => {
  const doc = flujo({ a: { steps: [{ uses: 'actions/checkout@v6' }] }, b: { uses: 'org/repo/.github/workflows/w.yml@main' } });
  const errores = v.validarWorkflow(`${NEUTRO}jobs: {a: {steps: [{uses: actions/checkout@v6}]}}`, 'x.yml', () => doc);
  assert.deepEqual(reglasDe(errores), ['pin']);
  assert.deepEqual(errores.map((e) => e.mensaje.match(/"([^"]+)"/)[1]).sort(), ['actions/checkout@v6', 'org/repo/.github/workflows/w.yml@main']);
  const ilegible = v.validarWorkflow('x', 'x.yml', () => {
    throw new Error('bad');
  });
  assert.deepEqual(ilegible.map((e) => e.regla), ['yaml']);
  assert.deepEqual(enDoc('texto'), ['yaml']);
});

test('workflows: the build and deploy split passes every rule', () => {
  const doc = flujo({
    construir: sinEntorno([
      { uses: `actions/checkout@${SHA}`, with: { token: '${{ github.token }}', 'persist-credentials': false } },
      { uses: `actions/setup-node@${SHA}`, with: { 'node-version': '20' } },
      paso({ env: { GH_PAT: '${{ github.token }}' }, run: 'npx --yes @upptime/graphs' }),
    ]),
    publicar: {
      needs: 'construir',
      if: "github.ref == 'refs/heads/master'",
      ...conEntorno([
        { uses: `actions/download-artifact@${SHA}`, with: { name: 'site', path: '${{ runner.temp }}/site' } },
        PASO_LLAVE,
        { uses: `actions/checkout@${SHA}`, with: { token: APP } },
        { uses: `benc-uk/workflow-dispatch@${SHA}`, with: { workflow: 'Graphs CI', token: APP } },
        uptime('update'),
        uptime('response-time'),
        uptime('readme'),
        uptime(),
        { uses: `actions/github-script@${SHA}`, with: { 'github-token': '${{ steps.app_token.outputs.token }}', script: "require('./x.js')" } },
      ]),
    },
  });
  assert.deepEqual(enDoc(doc), []);
});

test('workflows: the root grants no permissions', () => {
  for (const permissions of [undefined, 'write-all', 'read-all', { contents: 'read' }, null]) {
    const doc = flujo({});
    if (permissions === undefined) delete doc.permissions;
    else doc.permissions = permissions;
    assert.deepEqual(enDoc(doc), ['permisos'], JSON.stringify(permissions));
  }
  assert.deepEqual(enTexto('name: x\n'), ['permisos']);
  assert.deepEqual(enTexto('permissions:\n  contents: read\n'), ['permisos']);
  assert.deepEqual(enTexto('  permissions: {}\n'), ['permisos']);
  assert.deepEqual(enTexto('permissions: { } # nada\n'), []);
});

test('workflows: no pull_request_target or workflow_run trigger, in any form', () => {
  for (const on of ['pull_request_target', ['push', 'workflow_run'], { Pull_Request_Target: { types: ['opened'] } }, { workflow_run: null }]) {
    assert.deepEqual(enDoc(flujo({}, { on })), ['disparadores'], JSON.stringify(on));
  }
  assert.deepEqual(enDoc(flujo({}, { on: { workflow_dispatch: {}, push: { branches: ['master'] } } })), []);
  assert.deepEqual(enTexto(`${NEUTRO}on: [push, pull_request_target]\n`), ['disparadores']);
  assert.deepEqual(enTexto(`${NEUTRO}on:\n  workflow_run:\n`), ['disparadores']);
  assert.deepEqual(enTexto(`${NEUTRO}# pull_request_target is not used on purpose.\non: push # nor workflow_run\n`), []);
});

test('workflows: no expression inside run or script', () => {
  const titulo = '${{ github.event.issue.title }}';
  assert.deepEqual(unJob(sinEntorno([paso({ run: `echo "${titulo}"` })])), ['expresiones']);
  assert.deepEqual(unJob(sinEntorno([{ uses: `actions/github-script@${SHA}`, with: { script: `core.info('${titulo}')` } }])), ['expresiones']);
  // GitHub matches input names without case, so "SCRIPT" is github-script's script.
  assert.deepEqual(unJob(sinEntorno([{ uses: `actions/github-script@${SHA}`, with: { SCRIPT: `core.info('${titulo}')` } }])), ['expresiones']);
  assert.deepEqual(enTexto(`${NEUTRO}          SCRIPT: core.info('${titulo}')\n`), ['expresiones']);
  assert.deepEqual(unJob(sinEntorno([paso({ env: { TITULO: titulo }, run: 'echo "$TITULO"' })])), []);
  // The text half reads "run:" and "script:" blocks, but not a mapping under such a key, and a
  // sibling key ends the block.
  assert.deepEqual(enTexto(`${NEUTRO}      - run: echo "${titulo}"\n`), ['expresiones']);
  assert.deepEqual(enTexto(`${NEUTRO}        run: |\n          echo hola\n          echo "${titulo}"\n`), ['expresiones']);
  assert.deepEqual(enTexto(`${NEUTRO}          script: |\n            core.info('${titulo}')\n`), ['expresiones']);
  assert.deepEqual(enTexto(`${NEUTRO}jobs:\n  run:\n    steps:\n      - uses: ./x\n        with:\n          token: ${titulo}\n`), []);
  assert.deepEqual(enTexto(`${NEUTRO}      - run: |\n          echo "$A"\n        env:\n          A: ${titulo}\n`), []);
});

test('workflows: no merge keys', () => {
  const doc = flujo({ uno: sinEntorno([]) });
  doc.jobs.dos = { '<<': doc.jobs.uno };
  assert.deepEqual(enDoc(doc), ['fusion']);
});

test('workflows: the App key only in jobs with the "estado" environment', () => {
  assert.deepEqual(unJob(conEntorno([PASO_LLAVE])), []);
  assert.deepEqual(unJob(conEntorno([PASO_LLAVE], 'estado')), []);
  assert.deepEqual(unJob(conEntorno([PASO_LLAVE], { name: 'Estado' })), []);
  for (const entorno of ['produccion', { name: 'github-pages' }, '${{ inputs.entorno }}', null]) {
    assert.deepEqual(unJob(conEntorno([PASO_LLAVE], entorno)), ['llave'], JSON.stringify(entorno));
  }
  assert.deepEqual(unJob(sinEntorno([PASO_LLAVE])), ['llave']);
  const lecturas = [
    ["${{ secrets['GH_APP_PRIVATE_KEY'] }}", ['llave']],
    ['${{ secrets.gh_app_private_key }}', ['llave']],
    ['${{ secrets . GH_APP_PRIVATE_KEY }}', ['llave']],
    // The whole context and a computed name read every other secret as well.
    ['${{ toJSON(secrets) }}', ['llave', 'secretos']],
    ["${{ secrets[format('GH_APP_{0}', 'PRIVATE_KEY')] }}", ['llave', 'secretos']],
  ];
  for (const [lectura, esperadas] of lecturas) {
    assert.deepEqual(unJob(sinEntorno([paso({ env: { X: lectura }, run: 'true' })])), esperadas, lectura);
  }
  // An "if" is an expression without "${{".
  assert.deepEqual(unJob(sinEntorno([paso({ if: "secrets.GH_APP_PRIVATE_KEY != ''", run: 'true' })])), ['llave']);
  assert.deepEqual(enDoc(flujo({}, { env: { LLAVE: '${{ secrets.GH_APP_PRIVATE_KEY }}' } })), ['llave']);
  assert.deepEqual(unJob({ uses: `org/repo/.github/workflows/x.yml@${SHA}`, secrets: 'inherit' }), ['llave', 'secretos']);
  // Another secret is not the key; the "secretos" rule refuses it.
  assert.deepEqual(unJob(sinEntorno([paso({ env: { X: '${{ secrets.OTRO }}' }, run: 'true' })])), ['secretos']);
});

test('workflows: no secret but the App key and GITHUB_TOKEN, in any job or at the root', () => {
  const desplegar = (entradas) =>
    unJob(conEntorno([PASO_LLAVE, { uses: `peaceiris/actions-gh-pages@${SHA}`, with: { publish_dir: '/tmp/x', ...entradas } }]));
  assert.deepEqual(desplegar({ github_token: APP }), []);
  // The review's two forms: a fallback to a personal token, and a personal token instead of the App's.
  assert.deepEqual(desplegar({ github_token: '${{ steps.app_token.outputs.token || secrets.GH_PAT }}' }), ['secretos']);
  assert.deepEqual(desplegar({ personal_token: '${{ secrets.GH_PAT }}' }), ['secretos']);
  for (const lectura of ["${{ secrets['GH_PAT'] }}", '${{ secrets.Otro_Token }}']) {
    assert.deepEqual(desplegar({ github_token: lectura }), ['secretos'], lectura);
  }
  // The whole context and a computed name read secrets.GITHUB_TOKEN as well.
  for (const lectura of ['${{ toJSON(secrets) }}', '${{ secrets[inputs.nombre] }}']) {
    assert.deepEqual(desplegar({ github_token: lectura }), ['secretos', 'token-github'], lectura);
  }
  assert.deepEqual(unJob(conEntorno([PASO_LLAVE, paso({ if: "secrets.GH_PAT != ''", run: 'true' })])), ['secretos']);
  assert.deepEqual(unJob(sinEntorno([paso({ env: { X: '${{ secrets.GH_PAT }}' }, run: 'true' })])), ['secretos']);
  assert.deepEqual(enDoc(flujo({}, { env: { X: '${{ secrets.GH_PAT }}' } })), ['secretos']);
  assert.deepEqual(enDoc(flujo({}, { env: { X: '${{ toJSON(secrets) }}' } })), ['llave', 'secretos', 'token-github']);
  // GITHUB_TOKEN is the "token-github" rule's: here it is a read-only build's one token.
  assert.deepEqual(unJob(sinEntorno([paso({ env: { GH_PAT: '${{ secrets.GITHUB_TOKEN }}' }, run: 'true' })])), []);
  // Names that only contain the word.
  assert.deepEqual(unJob(sinEntorno([paso({ env: { X: '${{ github.event.secrets_url }}', Y: '${{ steps.secrets.outputs.x }}' }, run: 'true' })])), []);
});

test('workflows: a job with the "estado" environment runs no npm code', () => {
  const llave = (pasos, entorno) => unJob(conEntorno([PASO_LLAVE, ...pasos], entorno));
  for (const run of ['npx --yes @upptime/graphs', 'npm ci', 'yarn install', 'pnpm i', 'bunx x', 'corepack enable', 'node node_modules/x/cli.js']) {
    assert.deepEqual(llave([paso({ run })]), ['npm-con-llave'], run);
  }
  assert.deepEqual(
    llave([{ uses: `actions/github-script@${SHA}`, with: { 'github-token': APP, script: "require('child_process').execSync('npx x')" } }]),
    ['npm-con-llave'],
  );
  for (const comando of ['site', 'graphs', 'update-template', '${{ inputs.comando }}']) {
    assert.deepEqual(llave([uptime(comando)]), ['npm-con-llave'], comando);
  }
  for (const comando of ['update', 'response-time', 'readme', undefined]) {
    assert.deepEqual(llave([uptime(comando)]), [], String(comando));
  }
  // GitHub matches input names without case: "COMMAND: site" runs the site build.
  assert.deepEqual(llave([{ ...uptime(), with: { COMMAND: 'site' } }]), ['npm-con-llave']);
  assert.deepEqual(llave([{ ...uptime(), with: { command: 'update', Command: 'graphs' } }]), ['npm-con-llave']);
  assert.deepEqual(llave([{ uses: `actions/setup-node@${SHA}`, with: { 'node-version': '20', token: APP } }]), ['npm-con-llave']);
  assert.deepEqual(llave([paso({ name: 'Instalar con npm', run: 'true' })]), ['npm-con-llave']);
  assert.deepEqual(llave([paso({ run: 'echo npmjs snpm' })]), []);
  // An expression may pick "estado"; without the key nothing else fires.
  assert.deepEqual(unJob(conEntorno([paso({ run: 'npm ci' })], '${{ inputs.entorno }}')), ['npm-con-llave']);
  assert.deepEqual(unJob(conEntorno([paso({ run: 'npm ci' })], 'github-pages')), []);
  assert.deepEqual(unJob(sinEntorno([paso({ run: 'npm ci' }), { uses: `actions/setup-node@${SHA}` }, uptime('site')])), []);
});

test('workflows: npm code in the root defaults or env reaches the jobs with the key', () => {
  const conRaiz = (extra, job = conEntorno([PASO_LLAVE, uptime('update')])) => enDoc(flujo({ j: job }, extra));
  const casos = [
    { defaults: { run: { shell: 'npx --yes some-shell {0}' } } },
    { env: { NODE_OPTIONS: '--require ./node_modules/x/index.js' } },
    { env: { INSTALAR: 'pnpm install' } },
  ];
  for (const extra of casos) {
    assert.deepEqual(conRaiz(extra), ['npm-con-llave'], JSON.stringify(extra));
    // An environment chosen by an expression may be "estado".
    assert.deepEqual(conRaiz(extra, conEntorno([uptime('update')], '${{ inputs.entorno }}')), ['npm-con-llave'], JSON.stringify(extra));
    // Without a job that may hold the key, the root may name npm.
    assert.deepEqual(conRaiz(extra, sinEntorno([paso({ run: 'npm ci' })])), [], JSON.stringify(extra));
    assert.deepEqual(conRaiz(extra, conEntorno([paso({ run: 'true' })], 'github-pages')), [], JSON.stringify(extra));
  }
  assert.deepEqual(conRaiz({ env: { TZ: 'UTC' }, defaults: { run: { shell: 'bash' } } }), []);
});

test('workflows: GITHUB_TOKEN named only where it is the job\'s one token', () => {
  const token = (valor) => paso({ env: { GH_PAT: valor }, run: 'true' });
  assert.deepEqual(unJob(sinEntorno([token('${{ github.token }}')])), []);
  // The documented exception: its only token, so it may name it.
  for (const permisos of [{ contents: 'read', issues: 'write' }, { contents: 'read', issues: 'write', 'pull-requests': 'write' }, { 'pull-requests': 'write' }]) {
    assert.deepEqual(unJob(sinEntorno([token('${{ github.token }}')], permisos)), [], JSON.stringify(permisos));
  }
  const otros = [
    [{ contents: 'write' }, ['escritura-github', 'token-github']],
    [{}, ['token-github']],
    ['read-all', ['token-github']],
    [{ contents: 'read', actions: 'read' }, ['token-github']],
    [{ contents: 'read', issues: 'read' }, ['token-github']],
    // The exception reads nothing but the contents.
    [{ issues: 'write', actions: 'read' }, ['token-github']],
  ];
  for (const [permisos, esperadas] of otros) {
    assert.deepEqual(unJob(sinEntorno([token('${{ github.token }}')], permisos)), esperadas, JSON.stringify(permisos));
  }
  // The exception does not hold in a job that runs npm.
  assert.deepEqual(unJob(sinEntorno([token('${{ github.token }}'), paso({ run: 'npm ci' })], { contents: 'read', issues: 'write' })), ['escritura-github', 'token-github']);
  assert.deepEqual(unJob({ 'runs-on': 'ubuntu-latest', steps: [token('${{ github.token }}')] }), ['token-github']);
  assert.deepEqual(unJob({ ...conEntorno([token('${{ github.token }}')], 'github-pages'), permissions: LECTURA }), ['token-github']);
  assert.deepEqual(unJob({ ...conEntorno([token('${{ github.token }}')], ESTADO), permissions: LECTURA }), ['token-app', 'token-github']);
  const lecturas = [
    '${{ steps.app_token.outputs.token || github.token }}',
    '${{ secrets.GITHUB_TOKEN }}',
    "${{ github['token'] }}",
    '${{ GITHUB.TOKEN }}',
    '${{ toJSON(github) }}',
  ];
  for (const lectura of lecturas) {
    assert.deepEqual(unJob(conEntorno([PASO_LLAVE, token(lectura)])), ['token-github'], lectura);
  }
  assert.deepEqual(enDoc(flujo({}, { env: { GH_PAT: '${{ github.token }}' } })), ['token-github']);
  const ajenos = [
    '${{ github.event.issue.number }}',
    '${{ steps.x.outputs.github-token }}',
    "${{ format('https://github.com/{0}', github.repository) }}",
    '${{ steps.app_token.outputs.token }}',
  ];
  for (const ajeno of ajenos) assert.deepEqual(unJob(conEntorno([PASO_LLAVE, token(ajeno)])), [], ajeno);
});

test('workflows: GITHUB_TOKEN writes only issues and pull requests, in key-less jobs without npm', () => {
  const SCRIPT = { uses: `actions/github-script@${SHA}`, with: { script: "require('./x.js')" } };
  const conPermisos = (permissions, pasos = [SCRIPT]) => unJob({ 'runs-on': 'ubuntu-latest', permissions, steps: pasos });
  // The documented exception, as candado.yml and traducir-incidentes.yml use it. Scopes and levels
  // are compared without case.
  for (const permisos of [{ contents: 'read', issues: 'write' }, { contents: 'read', issues: 'write', 'pull-requests': 'write' }, { 'pull-requests': 'write' }, { Contents: 'Read', Issues: 'Write' }]) {
    assert.deepEqual(conPermisos(permisos), [], JSON.stringify(permisos));
  }
  // Reading is not writing.
  for (const permisos of [{}, LECTURA, { issues: 'read', contents: 'none' }, { contents: 'READ' }, 'read-all']) {
    assert.deepEqual(conPermisos(permisos), [], JSON.stringify(permisos));
  }
  const ajenos = [
    { contents: 'write' },
    { contents: 'read', actions: 'write' },
    { 'id-token': 'write' },
    { issues: 'write', pages: 'write' },
    { Contents: 'WRITE' },
    { contents: 'admin' },
    'write-all',
    null,
  ];
  for (const permisos of ajenos) assert.deepEqual(conPermisos(permisos), ['escritura-github'], JSON.stringify(permisos));
  // Not in a job with an environment, of any kind.
  assert.deepEqual(unJob({ ...conEntorno([SCRIPT], 'github-pages'), permissions: { issues: 'write' } }), ['escritura-github']);
  assert.deepEqual(unJob({ ...conEntorno([paso({ run: 'true' })]), permissions: { issues: 'write' } }), ['escritura-github', 'token-app']);
  // Not in a job that runs npm, nor in one whose workflow's root defaults or env name it.
  assert.deepEqual(conPermisos({ contents: 'read', issues: 'write' }, [paso({ run: 'npx --yes otro-paquete' })]), ['escritura-github']);
  assert.deepEqual(conPermisos({ issues: 'write' }, [{ uses: `actions/setup-node@${SHA}` }]), ['escritura-github']);
  assert.deepEqual(conPermisos({ issues: 'write' }, [uptime('site')]), ['escritura-github']);
  const raiz = { env: { NODE_OPTIONS: '--require ./node_modules/x.js' } };
  assert.deepEqual(enDoc(flujo({ j: { 'runs-on': 'ubuntu-latest', permissions: { issues: 'write' }, steps: [SCRIPT] } }, raiz)), ['escritura-github']);
});

test('workflows: in a job with the key, the App token is the one token', () => {
  const acciones = [
    ['actions/checkout', 'token'],
    ['actions/github-script', 'github-token'],
    ['benc-uk/workflow-dispatch', 'token'],
  ];
  for (const [accion, entrada] of acciones) {
    const con = (valor, antes = [PASO_LLAVE]) =>
      unJob(conEntorno([...antes, { uses: `${accion}@${SHA}`, with: valor === undefined ? {} : { [entrada]: valor } }]));
    assert.deepEqual(con(APP), [], accion);
    assert.deepEqual(con('${{ STEPS.App_Token.OUTPUTS.TOKEN }}'), [], accion);
    // The action's default, GITHUB_TOKEN.
    assert.deepEqual(con(undefined), ['token-app'], accion);
    assert.deepEqual(con(''), ['token-app'], accion);
    // The App token and nothing else around it.
    assert.deepEqual(con(`x${APP}`), ['token-app'], accion);
    assert.deepEqual(con(`${APP}x`), ['token-app'], accion);
    // No App token step by that id before it.
    assert.deepEqual(con('${{ steps.otro.outputs.token }}'), ['token-app'], accion);
    assert.deepEqual(con(APP, []), ['token-app'], accion);
    assert.deepEqual(con(APP, [{ ...PASO_LLAVE, uses: `actions/otra-accion@${SHA}` }]), ['token-app'], accion);
    assert.deepEqual(con('${{ steps.app_token.outputs.token || github.token }}'), ['token-app', 'token-github'], accion);
    assert.deepEqual(con('${{ secrets.GH_PAT }}'), ['secretos', 'token-app'], accion);
  }
  // Minted after the step that uses it, the token is still empty there.
  assert.deepEqual(unJob(conEntorno([{ uses: `actions/checkout@${SHA}`, with: { token: APP } }, PASO_LLAVE])), ['token-app']);
  // Input names are matched without case, and every spelling must be the App token.
  assert.deepEqual(unJob(conEntorno([PASO_LLAVE, { uses: `actions/checkout@${SHA}`, with: { TOKEN: APP } }])), []);
  assert.deepEqual(unJob(conEntorno([PASO_LLAVE, { uses: `actions/checkout@${SHA}`, with: { token: APP, Token: '${{ steps.x.outputs.y }}' } }])), ['token-app']);
  // setup-node is npm-con-llave's too.
  assert.deepEqual(unJob(conEntorno([PASO_LLAVE, { uses: `actions/setup-node@${SHA}` }])), ['npm-con-llave', 'token-app']);
  // GITHUB_TOKEN gets no permissions there.
  for (const permisos of [LECTURA, { issues: 'read' }, 'read-all']) {
    assert.deepEqual(unJob({ ...conEntorno([PASO_LLAVE]), permissions: permisos }), ['token-app'], JSON.stringify(permisos));
  }
  for (const permisos of [{}, { contents: 'none' }]) assert.deepEqual(unJob({ ...conEntorno([PASO_LLAVE]), permissions: permisos }), []);
  // Without the key, GITHUB_TOKEN is the job's one token.
  assert.deepEqual(unJob(sinEntorno([{ uses: `actions/checkout@${SHA}`, with: { 'persist-credentials': false } }])), []);
});

test('workflows: nothing next to the key that this file cannot read', () => {
  const casos = [
    [[], { container: 'node:24' }],
    [[], { container: { image: `node@sha256:${'a'.repeat(64)}` } }],
    [[], { services: { base: { image: 'redis:7' } } }],
    [[{ uses: './.github/actions/publicar' }], {}],
    [[{ uses: `actions/cache@${SHA}`, with: { path: '/tmp/x', key: 'k' } }], {}],
    [[{ uses: `actions/cache/restore@${SHA}`, with: { path: '/tmp/x', key: 'k' } }], {}],
    [[{ uses: `Actions/Cache@${SHA}`, with: { path: '/tmp/x', key: 'k' } }], {}],
    [[{ uses: `actions/setup-python@${SHA}`, with: { 'python-version': '3.13', cache: 'pip' } }], {}],
    [[{ uses: `actions/setup-go@${SHA}`, with: { 'cache-dependency-path': 'go.sum' } }], {}],
  ];
  for (const [pasos, extra] of casos) {
    assert.deepEqual(unJob({ ...conEntorno([PASO_LLAVE, ...pasos]), ...extra }), ['codigo-oculto'], JSON.stringify([pasos, extra]));
    assert.deepEqual(unJob({ ...conEntorno(pasos, '${{ inputs.entorno }}'), ...extra }), ['codigo-oculto'], JSON.stringify([pasos, extra]));
    // A job without the key may use them.
    assert.deepEqual(unJob({ ...sinEntorno(pasos), ...extra }), [], JSON.stringify([pasos, extra]));
  }
});

test('workflows: a job with the key publishes only what its own run uploaded', () => {
  const descarga = (extra = {}) => ({ id: 'site', uses: `actions/download-artifact@${SHA}`, with: { name: 'site', path: '/tmp/site', ...extra } });
  const publicar = (pasos, extra = {}) => unJob({ needs: 'construir', ...conEntorno([PASO_LLAVE, ...pasos]), ...extra });
  assert.deepEqual(publicar([descarga()]), []);
  for (const extra of [{ 'run-id': '123' }, { 'github-token': APP }, { repository: 'otra/organizacion' }, { 'Run-Id': '123' }]) {
    assert.deepEqual(publicar([descarga(extra)]), ['artefacto'], JSON.stringify(extra));
  }
  const lecturas = [
    '${{ needs.construir.outputs.dir }}',
    "${{ needs['construir'].outputs.dir }}",
    "${{ needs.construir['outputs'].dir }}",
    '${{ NEEDS.construir.OUTPUTS.dir }}',
    '${{ toJSON(needs) }}',
    '${{ fromJSON(toJSON(needs.construir)).outputs.dir }}',
    '${{ needs.*.outputs.dir }}',
  ];
  for (const lectura of lecturas) {
    assert.deepEqual(publicar([paso({ env: { DIR: lectura }, run: 'true' })]), ['artefacto'], lectura);
  }
  assert.deepEqual(publicar([paso({ run: 'true' })], { if: "needs.construir.outputs.ok == 'true'" }), ['artefacto']);
  // A result is a status, which the job that ran without the key cannot choose.
  for (const condicion of ["needs.construir.result == 'success'", "!contains(needs.*.result, 'failure')", "needs['construir'].result == 'success'"]) {
    assert.deepEqual(publicar([paso({ run: 'true' })], { if: condicion }), [], condicion);
  }
  // A job without the key is not this rule's concern.
  const sinLlave = { needs: 'construir', ...sinEntorno([descarga({ 'run-id': '123' }), paso({ env: { DIR: '${{ needs.construir.outputs.dir }}' }, run: 'true' })]) };
  assert.deepEqual(unJob(sinLlave), []);
});

test('the negative manifest proves every rule, with files that exist and valid controls', () => {
  const manifiesto = v.leerManifiesto(DIR_FIXTURES);
  const probadas = new Set(manifiesto.casos.flatMap((caso) => caso.reglas));
  for (const regla of v.REGLAS) assert.ok(probadas.has(regla), regla);
  for (const caso of manifiesto.casos) {
    assert.ok(existsSync(join(DIR_FIXTURES, caso.archivo)), caso.archivo);
    if (caso.componentes !== undefined) assert.ok(existsSync(join(DIR_FIXTURES, caso.componentes)), caso.componentes);
    assert.ok(v.TIPOS_DE_CASO.includes(caso.tipo), caso.archivo);
    for (const regla of caso.reglas) assert.ok(v.REGLAS.includes(regla), `${caso.archivo}: ${regla}`);
  }
  for (const tipo of v.TIPOS_DE_CASO) {
    assert.ok(manifiesto.casos.some((caso) => caso.tipo === tipo && caso.reglas.length === 0), tipo);
  }
  const nombres = manifiesto.casos.map((caso) => caso.archivo);
  const pedidos = [
    'configs/dolar-url.yml',
    'configs/host-sitio.yml',
    'configs/sin-chequeo.yml',
    'configs/slug-duplicado.yml',
    'configs/nombre-html.yml',
    'configs/componentes-html.json',
    'configs/host-enlace.yml',
    'workflows/sin-pin.yml',
    'workflows/separado.yml',
    'workflows/excepcion.yml',
    'workflows/artefacto-ejecucion.yml',
    'workflows/artefacto-salida.yml',
    'workflows/secretos-respaldo.yml',
    'workflows/secretos-personal.yml',
    'workflows/oculto-contenedor.yml',
    'workflows/oculto-servicio.yml',
    'workflows/oculto-accion-local.yml',
    'workflows/oculto-cache.yml',
    'workflows/oculto-entrada-cache.yml',
    'workflows/npm-raiz.yml',
    'workflows/npm-raiz-env.yml',
    'workflows/escritura-contenido.yml',
    'workflows/escritura-entorno.yml',
    'workflows/escritura-npm.yml',
    'workflows/token-app-checkout.yml',
  ];
  for (const pedido of pedidos) assert.ok(nombres.includes(pedido), pedido);
});

test('component lists: data of a fixed shape', () => {
  assert.equal(v.comoComponentes(COMPONENTES), COMPONENTES);
  for (const malo of [[], {}, null, [{ slug: 'x' }], [{ slug: 'X Y', nombre: 'n' }], [{ slug: 'x', nombre: '' }], [{ slug: 'x', nombre: 'n', extra: 1 }]]) {
    assert.equal(v.comoComponentes(malo), null, JSON.stringify(malo));
  }
  assert.deepEqual(reglasDe(v.revisarComponentes('module.exports = []').errores), ['slugs-esperados']);
  assert.equal(v.revisarComponentes('module.exports = []').componentes, null);
});

test('the checked repository brings its own component list, read as data', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validar-'));
  try {
    assert.deepEqual(v.leerComponentes(dir), { componentes: VIVOS, errores: [] });
    mkdirSync(join(dir, '.github', 'scripts'), { recursive: true });
    const archivo = join(dir, '.github', 'scripts', 'componentes.json');
    const nueve = [...COMPONENTES, { slug: 'nuevo', nombre: 'Nuevo' }];
    writeFileSync(archivo, JSON.stringify(nueve));
    assert.deepEqual(v.leerComponentes(dir), { componentes: nueve, errores: [] });
    writeFileSync(archivo, 'module.exports = []');
    const roto = v.leerComponentes(dir);
    assert.equal(roto.componentes, VIVOS);
    assert.deepEqual(roto.errores.map((e) => e.regla), ['slugs-esperados']);
    // A list with a hostile name is still the change's list; the name is reported.
    const hostil = [...COMPONENTES.slice(0, 7), { slug: 'encuestas', nombre: 'Encuestas <b>' }];
    writeFileSync(archivo, JSON.stringify(hostil));
    const conNombre = v.leerComponentes(dir);
    assert.deepEqual(conNombre.componentes, hostil);
    assert.deepEqual(conNombre.errores.map((e) => e.regla), ['caracteres-nombre']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('adding a component: the configuration and the list change together; the host stays master\'s', () => {
  const nueve = [...COMPONENTES, { slug: 'nuevo', nombre: 'Nuevo' }];
  const config = base();
  config.sites.push({ ...structuredClone(config.sites[7]), name: 'Nuevo', slug: 'nuevo' });
  assert.deepEqual(v.validarTextoConfig('', parser(config), parser(config), nueve), []);
  assert.deepEqual(reglas(config), ['slugs-esperados']);
  config.sites[8].url = 'https://nuevo.example.com/';
  assert.deepEqual(reglasDe(v.validarTextoConfig('', parser(config), parser(config), nueve)), ['host']);
});

test('annotations escape what would break a workflow command', () => {
  assert.equal(v.anotacion('host', '50% de\r\nesto'), '::error title=validar (host)::50%25 de%0D%0Aesto');
});
