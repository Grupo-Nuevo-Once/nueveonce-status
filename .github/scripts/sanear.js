'use strict';

// The status page (@upptime/status-page 1.17.0, src/components/Incident.svelte) renders issue
// comments with snarkdown 2.0.0 inside Svelte's {@html}, and neither escapes anything:
// - raw HTML passes through untouched;
// - [text](url) becomes a link with whatever scheme the URL has, javascript: included;
// - a bare [text] becomes a link to the reference definition "[text]: url", whatever its scheme,
//   and without one to the result of an object lookup: "undefined", or for "[constructor]" the
//   source text of Object;
// - snarkdown builds each link with out.replace('<a>', '<a href="' + url + '">'), a string
//   replacement, so "$`" or "$'" inside a URL would splice raw page text into the attribute;
// - it escapes only quotes and angle brackets in that attribute, so the browser decodes any
//   character reference the URL carries: "&#64;" becomes "@".
// Every text this repository publishes goes through here first.

const MAX_MENSAJE = 4000;
const MAX_TITULO = 120;

// C0 and C1 control characters except tab and newline, the byte order mark, and the Unicode
// controls that reorder text (a published line could read differently from what was written).
const CONTROLES = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const SEPARADORES_DE_LINEA = /[\u2028\u2029]/g;

// Characters a published link may contain. Brackets, parentheses, quotes, backticks,
// backslashes, angle brackets, "$" and whitespace are left out, so a link target can never end
// early, carry markup, trigger a replacement pattern or contain the "](" that snarkdown reads
// as the start of another link.
const URL_SEGURA = /^https:\/\/[A-Za-z0-9\-._~:/?#@!&*+,;=%]+$/;

// A character reference as the browser reads one inside an attribute: "&#" starts a numeric one,
// which needs no closing ";" ("&#64" is "@" as well); a name closed by ";" is a named one
// ("&commat;"); and the legacy names, such as "&amp" or "&copy", need no ";" unless "=" or a
// letter or digit follows them. The table of names is long, so any name counts unless "="
// follows it: "?a=1&b=2" passes, "?a=1&b" does not, although "b" is no legacy name.
const REFERENCIA_DE_CARACTER = /&(?:#|[A-Za-z][A-Za-z0-9]*(?![A-Za-z0-9=]))/;

function esUrlSegura(url) {
  if (typeof url !== 'string' || !URL_SEGURA.test(url)) return false;
  // The browser follows the decoded URL, not the one checked below:
  // "https://example.com&#64;example.net/" parses with the host "example.com&" and opens
  // example.net.
  if (REFERENCIA_DE_CARACTER.test(url)) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === 'https:' &&
    parsed.hostname !== '' &&
    parsed.username === '' &&
    parsed.password === ''
  );
}

// Images and links as snarkdown reads them: its own image pattern, and a link whose text holds no
// bracket, which is the innermost one.
const IMAGEN = /!\[([^\]]*?)\]\(([^)]+?)\)/g;
const ENLACE = /\[([^[\]]*)\]\(([^)]+?)\)/g;
// The same link, or any other single bracket.
const ENLACE_O_CORCHETE = /\[([^[\]]*)\]\(([^)]+?)\)|[[\]]/g;
// A link the bracket step kept, or a stretch of text without "[". After that step every "[" left
// starts a kept link, so these pieces make up the whole text.
const ENLACE_O_TEXTO = /\[([^[\]]*)\]\(([^)]+?)\)|[^[]+/g;
// An "@" before a login, unless a letter, a digit or one of "_-./@" comes right before it, as in
// an e-mail address or a URL path.
const MENCION = /(^|[^A-Za-z0-9_\-./@])@(?=[A-Za-z0-9])/g;

// Applies a rewrite until the text stops changing: removing one link can join the pieces
// around it into a new one.
function hastaFijar(texto, reescribir) {
  let actual = texto;
  for (let i = 0; i < 50; i += 1) {
    const siguiente = reescribir(actual);
    if (siguiente === actual) return actual;
    actual = siguiente;
  }
  throw new Error('El texto tiene demasiados enlaces anidados para publicarlo.');
}

// A zero-width space after "@" keeps GitHub from notifying the account with that login.
function neutralizarMenciones(texto) {
  return texto.replace(MENCION, '$1@\u200B');
}

// Returns the text as it may be published. It strips "<" and ">", keeps only https links,
// turns images into their alt text, leaves no other bracket that snarkdown reads, and stops
// @mentions from notifying. Sanitizing the result again leaves it unchanged.
function sanearMensaje(texto) {
  let t = String(texto == null ? '' : texto)
    .replace(/\r\n?/g, '\n')
    .replace(SEPARADORES_DE_LINEA, '\n')
    .replace(CONTROLES, '')
    .replace(/[<>]/g, '');

  // Images become their alt text, so no comment makes visitors load anything from another host,
  // and a link to anything but a safe https URL becomes its text. Both repeat together, because
  // removing one can make the other: a link whose text is "!" leaves that "!" right before the
  // next link, which snarkdown would then render as an image.
  t = hastaFijar(t, (s) =>
    s
      .replace(IMAGEN, '$1')
      .replace(ENLACE, (enlace, textoEnlace, url) => (esUrlSegura(url) ? enlace : textoEnlace)),
  );

  // The safe links keep their brackets, and every other bracket becomes its fullwidth form,
  // which snarkdown does not read. snarkdown pairs any "[" with any later "](target)", whatever
  // lies between, and turns a bare "[text]" into a link to its reference definition; with no
  // "[" or "]" left, "[x]: target" is no definition either.
  t = t.replace(ENLACE_O_CORCHETE, (pieza, textoEnlace, url) =>
    url !== undefined && esUrlSegura(url)
      ? pieza
      : pieza.replace(/\[/g, '\uFF3B').replace(/\]/g, '\uFF3D'),
  );

  // Mentions stop notifying, both in the text and in the text of each link left. A link's target
  // stays exactly as checked above: an edited target could fail that check, and then sanitizing
  // the result again would change it.
  t = t.replace(ENLACE_O_TEXTO, (pieza, textoEnlace, url) =>
    url === undefined ? neutralizarMenciones(pieza) : `[${neutralizarMenciones(textoEnlace)}](${url})`,
  );

  return t.replace(/\n{3,}/g, '\n\n').trim();
}

// Titles are shown as plain text, but they also stay on one line and free of markup.
function sanearTitulo(texto) {
  return String(texto == null ? '' : texto)
    .replace(CONTROLES, '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = {
  MAX_MENSAJE,
  MAX_TITULO,
  esUrlSegura,
  sanearMensaje,
  sanearTitulo,
};
