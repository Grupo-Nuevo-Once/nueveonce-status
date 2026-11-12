import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import snarkdown from './snarkdown.mjs';

const require = createRequire(import.meta.url);
const { esUrlSegura, sanearMensaje, sanearTitulo, MAX_MENSAJE } = require('../.github/scripts/sanear.js');

// The fullwidth brackets the sanitizer leaves in place of bare ones.
const ABRE = '\uFF3B';
const CIERRA = '\uFF3D';
// The zero-width space it puts after an "@" that would mention an account.
const ESPACIO_CERO = '\u200B';

// How the browser reads an attribute value: it decodes character references first. Numeric ones
// need no closing ";", and neither do the legacy names, such as "amp" or "copy", unless "=" or a
// letter or digit follows them. Only the names the cases use are spelled out; any other name is
// taken as decoded into something else, which fails the checks that use this.
const NOMBRES = { amp: '&', commat: '@', copy: '\u00A9', gt: '>', lt: '<', quot: '"' };

function leerAtributo(valor) {
  return valor.replace(
    /&(?:#(?:[xX]([0-9A-Fa-f]+)|([0-9]+));?|([A-Za-z][A-Za-z0-9]*)(?:;|(?![A-Za-z0-9=])))/g,
    (referencia, hex, decimal, nombre) => {
      if (nombre !== undefined) return Object.hasOwn(NOMBRES, nombre) ? NOMBRES[nombre] : '\uFFFD';
      const punto = hex !== undefined ? parseInt(hex, 16) : parseInt(decimal, 10);
      const valido = punto > 0 && punto <= 0x10ffff && (punto < 0xd800 || punto > 0xdfff);
      return valido ? String.fromCodePoint(punto) : '\uFFFD';
    },
  );
}

// What the page does with a comment: snarkdown, then {@html}. The rendered HTML may contain only
// snarkdown's own tags, and links only to safe https URLs that the browser reads unchanged.
const ETIQUETAS_PERMITIDAS = new Set(['a', 'em', 'strong', 's', 'br', 'hr', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

function revisarHtml(html) {
  for (const [, nombre, atributos] of html.matchAll(/<\/?([A-Za-z][A-Za-z0-9]*)([^>]*)>/g)) {
    assert.ok(ETIQUETAS_PERMITIDAS.has(nombre.toLowerCase()), `tag <${nombre}> in ${JSON.stringify(html)}`);
    const resto = atributos.trim().replace(/\/$/, '').trim();
    if (resto === '') continue;
    if (nombre === 'a') {
      const m = /^href="([^"]*)"$/.exec(resto);
      assert.ok(m, `attributes ${JSON.stringify(resto)} in ${JSON.stringify(html)}`);
      const href = leerAtributo(m[1]);
      assert.equal(href, m[1], `the browser reads href ${JSON.stringify(m[1])} as ${JSON.stringify(href)}`);
      assert.ok(esUrlSegura(href), `href ${JSON.stringify(href)}`);
    } else {
      assert.ok(/^(pre|code)$/.test(nombre) && /^class="[a-z -]*"$/.test(resto), `attributes ${JSON.stringify(resto)} on <${nombre}>`);
    }
  }
}

const ATAQUES = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<a href="javascript:alert(1)">x</a>',
  '[x](javascript:alert(1))',
  '[x](JAVASCRIPT:alert(1))',
  '[x]( javascript:alert(1))',
  '[x](javascript&colon;alert(1))',
  '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
  '[x](vbscript:msgbox(1))',
  '[x](http://example.com/)',
  '[x](//example.com/)',
  '[x](https://usuario:clave@example.com/)',
  '[a [b] c](javascript:alert(1))',
  '[x](https://example.com/)](javascript:alert(1))',
  '[[x](https://example.com/)](javascript:alert(1))',
  'x](javascript:alert(1)) [y](https://example.com/)',
  '[x][y](javascript:alert(1))',
  '![x](https://example.com/rastreo.png)',
  '![x](javascript:alert(1))',
  '!![x](https://example.com/a.png)',
  '[!](http://example.com/)[x](https://example.com/rastreo.png)',
  '[x]: javascript:alert(1)\n\n[x]',
  '- [x]: javascript:alert(1)\n- [x]',
  'texto " onmouseover="alert(1)" [x](https://example.com/$`)',
  "texto ' onmouseover='alert(1)' [x](https://example.com/$')",
  '[x](https://example.com/"onmouseover="alert(1))',
  '\\[x](javascript:alert(1))',
  '[x\\](javascript:alert(1))',
  '[x](javascript:alert(1)',
  '```js\n<script>alert(1)</script>\n```',
  '`<img src=x onerror=alert(1)>`',
  '# <script>alert(1)</script> [x](javascript:alert(1))',
  '> [x](javascript:alert(1))',
  '1. [x](javascript:alert(1))',
  '[x](java\u0000script:alert(1))',
  '[x](https://example.com/\u202Eexe.txt)',
  '[x](https://example.com&#64;example.net/)',
  '[x](https://example.com&#64example.net/)',
  '[x](https://example.com&#x40;example.net/)',
  '[x](https://example.com&commat;example.net/)',
  '[x](https://example.com/?a=1&copy/)',
  '[Actualización] El servicio volvió.',
  '[constructor]',
  '[__proto__]',
  '[x](https://example.com/)[y]',
  '[a](b)](javascript:alert(1))',
];

test('control: without the sanitizer, snarkdown lets the attacks through', () => {
  const pasan = (texto) => {
    try {
      revisarHtml(snarkdown(texto));
      return true;
    } catch {
      return false;
    }
  };
  for (const ataque of [
    '<script>alert(1)</script>',
    '[x](javascript:alert(1))',
    '[x]: javascript:alert(1)\n\n[x]',
    '![x](https://example.com/rastreo.png)',
    'texto " onmouseover="alert(1)" [x](https://example.com/$`)',
    '[x](https://example.com&#64;example.net/)',
    '[x](https://example.com&#64example.net/)',
    '[x](https://example.com&commat;example.net/)',
    '[Actualización]',
    '[constructor]',
  ]) {
    assert.equal(pasan(ataque), false, JSON.stringify(ataque));
  }
  assert.match(snarkdown('texto " onmouseover="alert(1)" [x](https://example.com/$`)'), /href="https:\/\/example\.com\/texto " onmouseover=/);
  assert.match(snarkdown('[x](https://example.com&#64;example.net/)'), /href="https:\/\/example\.com&#64;example\.net\/"/);
  assert.match(snarkdown('[Actualización]'), /href="undefined"/);
  assert.match(snarkdown('[constructor]'), /href="function Object\(\) \{ \[native code\] \}"/);
});

test('no attack survives the sanitizer and snarkdown', () => {
  for (const ataque of ATAQUES) {
    const limpio = sanearMensaje(ataque);
    assert.doesNotMatch(limpio, /[<>]/, JSON.stringify(ataque));
    // Outside the safe links that are left, no bracket remains for snarkdown to read.
    const fuera = limpio.replace(/\[[^[\]]*\]\(([^)]+?)\)/g, (enlace, url) => (esUrlSegura(url) ? '' : enlace));
    assert.doesNotMatch(fuera, /[[\]]/, JSON.stringify(ataque));
    revisarHtml(snarkdown(limpio));
  }
});

test('markup is stripped, the text stays', () => {
  assert.equal(sanearMensaje('<script>alert(1)</script>'), 'scriptalert(1)/script');
  assert.equal(sanearMensaje('Hola <b>mundo</b>'), 'Hola bmundo/b');
});

test('unsafe links become their text, safe https links stay', () => {
  assert.equal(sanearMensaje('[aquí](javascript:void)'), 'aquí');
  // Like snarkdown, the target ends at the first ")", so the rest stays as text.
  assert.equal(sanearMensaje('[aquí](javascript:alert(1))'), 'aquí)');
  assert.equal(sanearMensaje('[aquí](http://example.com/)'), 'aquí');
  assert.equal(sanearMensaje('Más detalles [aquí](https://example.com/estado?id=1#x).'), 'Más detalles [aquí](https://example.com/estado?id=1#x).');
  assert.equal(snarkdown(sanearMensaje('[aquí](https://example.com/a)')), '<a href="https://example.com/a">aquí</a>');
});

test('a bare [text] stays text: its brackets turn fullwidth, while safe links keep theirs', () => {
  assert.equal(sanearMensaje('[Actualización] El servicio volvió.'), `${ABRE}Actualización${CIERRA} El servicio volvió.`);
  assert.equal(sanearMensaje('[constructor]'), `${ABRE}constructor${CIERRA}`);
  assert.equal(sanearMensaje('[x](https://example.com/)[y]'), `[x](https://example.com/)${ABRE}y${CIERRA}`);
  assert.equal(snarkdown(sanearMensaje('[x](https://example.com/)[y]')), `<a href="https://example.com/">x</a>${ABRE}y${CIERRA}`);
  assert.equal(sanearMensaje('[a [b] c](javascript:alert(1))'), `${ABRE}a ${ABRE}b${CIERRA} c${CIERRA}(javascript:alert(1))`);
  for (const texto of ['[Actualización] El servicio volvió.', '[constructor]', '[__proto__]', '[a [b] c](javascript:alert(1))']) {
    assert.doesNotMatch(snarkdown(sanearMensaje(texto)), /<a/, texto);
  }
});

test('a link target with a character reference is refused: the browser would follow another URL', () => {
  const conReferencia = [
    'https://example.com&#64;example.net/',
    'https://example.com&#64example.net/',
    'https://example.com&#x40;example.net/',
    'https://example.com&commat;example.net/',
    'https://example.com/?a=1&copy/',
  ];
  for (const url of conReferencia) {
    assert.notEqual(leerAtributo(url), url, url);
    assert.equal(esUrlSegura(url), false, url);
    assert.equal(sanearMensaje(`[x](${url})`), 'x', url);
  }
  // Decoded, the first four carry a user name and lead to another host.
  for (const url of conReferencia.slice(0, 4)) {
    const leida = new URL(leerAtributo(url));
    assert.deepEqual([leida.username, leida.hostname], ['example.com', 'example.net'], url);
  }
  // A name followed by "=" is no reference, so query strings still pass.
  for (const url of ['https://example.com/?a=1&b=2', 'https://example.com/?a=1&copy=2', 'https://example.com/?x=1&']) {
    assert.equal(leerAtributo(url), url, url);
    assert.equal(esUrlSegura(url), true, url);
  }
});

test('a "$" never reaches a link target, where snarkdown would expand it', () => {
  assert.equal(esUrlSegura('https://example.com/$`'), false);
  assert.equal(esUrlSegura("https://example.com/$'"), false);
  assert.equal(esUrlSegura('https://example.com/a$b'), false);
  const html = snarkdown(sanearMensaje('" onmouseover="alert(1)" [x](https://example.com/$`)'));
  assert.doesNotMatch(html, /href="[^"]*onmouseover/);
});

test('images become their alt text', () => {
  assert.equal(sanearMensaje('Ver ![captura](https://example.com/a.png) aquí'), 'Ver captura aquí');
  assert.doesNotMatch(snarkdown(sanearMensaje('![a](https://example.com/a.png)')), /<img/);
  // Removing a link whose text is "!" must not turn the next link into an image.
  assert.equal(sanearMensaje('[!](http://example.com/)[x](https://example.com/rastreo.png)'), 'x');
});

test('reference definitions are broken everywhere', () => {
  assert.doesNotMatch(sanearMensaje('[x]: https://example.com/\n[x]'), /[[\]]/);
  for (const texto of ['[x]: javascript:alert(1)\n\n[x]', '- [x]: javascript:alert(1)\n- [x]']) {
    // The definition stays as plain text; no link points at it.
    const html = snarkdown(sanearMensaje(texto));
    assert.doesNotMatch(html, /<a/, html);
  }
  // Without the sanitizer, snarkdown would link it.
  assert.match(snarkdown('[x]: javascript:alert(1)\n\n[x]'), /href="javascript:alert\(1\)"/);
});

test('mentions do not notify; an "@" after a letter or in a URL path is left alone', () => {
  assert.equal(sanearMensaje('Avisamos a @alguien y @equipo/soporte.'), 'Avisamos a @\u200Balguien y @\u200Bequipo/soporte.');
  assert.equal(sanearMensaje('texto@algo'), 'texto@algo');
  assert.equal(sanearMensaje('[perfil](https://example.com/@alguien)'), '[perfil](https://example.com/@alguien)');
});

// The six inputs on which the idempotence pass of the re-review's fuzzer (seed 999) found that
// sanitizing the output again changed it. In each, a link the sanitizer kept had an "@" after
// "*", "#", "?", "~" or "&" in its target, and the mention step put a zero-width space there.
const NO_IDEMPOTENTES = [
  '![ ]([[&]())\u00F1]: )`[*`\\JaVaScRiPt:x`)[[&#x6a;[!]([\uFF3D[&#106;\uFF3B  ](\u00F1![https://example.com/](#))]: @user$\'  $&)](https://example.com/@user)][!](![\\]([$\'&#64))[!](https://example.com/![ ](&#64![`](![[>[#]\u0000]([![[  ](https://example.com/<)\']([@user&copy](https://example.com/&commat;)![(x]($\'[_]//example.org/)\n\n)@]: ```?<https:)]([---[&amp&commat;](https://example.com/*@user)]: [[!](\t`*   x`)&#x6a;](https://example.com/&#64;_)`<texto&commat;`&data:text/html,x)&amp*)[\u00F1\n](https://example.com/&#64;)))https://example.com/https:$&[&amp;?]:   \'?`\uFF3B[*===]: #`',
  '\u200B&onerror=alert(1)[!](//example.org/$\')[!]($&![[[!]: [` ]: \u00E9[\u00E9\\](https://example.com/![[!](x&commat;)](\u00E9\\&amp;)[=[@user]\uFF3D](\u00E9@user#))~~JaVaScRiPt:xhttp://example.com/](&lt;onerror=alert(1)onerror=alert(1))[&commat; ](\t[`````#](https://example.com/$&https:))]([[[&lt;&#106;]($&`\\&amp`=)]`&amp;\u0000~~`javascript:alert(1)](\')\tJaVaScRiPt:x))https:)[@](https://example.com/#@user)http://example.com/![?\u00F1](:![([ ](https://example.com/&lt;()](\u0000[%\n](https://example.com/[!](\u0000))[[[]]: \u00F1:[!](\u200B)]](https://example.com/---)))&commat;[!](__[*https://example.net/a[![[&copy][!](%)](\u00E9\uFF3D))data:text/html,x]: ![&#106;img](x)`\u200B_1. `[&#64](https://example.com/__)](![\tonerror=alert(1)](https://example.net/a)))',
  '[[__proto__[![>]([\uFF3D__](https://example.com/#[[\u00F1]: 1. ?[\u202E]$\'](https://example.com/$`)))\u0000]][=```](=**~~)](https://example.com/[[__@]: constructor>[)](https://example.com/?@user)](\\[!](`)$1)https://example.com/)onerror=alert(1)$1\'\'&lt;[:$&  ]($\')*',
  'https:([&lt;]: &#106;$&[`[//example.org/](https://example.com/* )\uFF3D`]: [\n\n]: <$1`[![https:]([\uFF3B?*]( ```)[data:text/html,xtexto](https://example.com/~~@user))javascript:alert(1)](https://example.com/![  ](texto- \u202E)&lt;)`[\n\n![$&]([\uFF3D][&copyJaVaScRiPt:x](---&copy&copy)[//example.org/https://example.com/](# ))]: \u202EJaVaScRiPt:x)$1',
  'http://example.com/`\uFF3D[&#64](https://example.com/&@user)`1. \n\nhttps://example.net/a',
  '?)![(](x\')- \uFF3D__proto__[!]())&commat;[[![onerror=alert(1)](---$1![[[javascript:alert(1)]([![&copy]($\'`&#x40;&#64<`)](\t![`\t]([[`\\[\u0000]---`](https://example.com/[&amp;]  )![texto](:&amp[1. \u0000](https://example.com/:\t))]https:)))\u00F1]: )&commat;&#64;[&#x40;[!](&#106;)](https://example.com/[&@user===](&#x40;`http://example.com/`))](![__](*\uFF3B)\u200B%))]\t](https://example.com/data:text/html,x)=[$1[!](~~`)]  ',
];

// The characters a safe link target may hold that the mention step took for the start of a
// mention when an "@" and a letter came after them.
const ANTES_DE_ARROBA = ['~', ':', '?', '#', '!', '&', '*', '+', ',', ';', '=', '%'];

test('a kept link reaches the page exactly as written, whatever "@" its target holds', () => {
  const destinos = [
    'https://example.com/?a=@b',
    'https://:@example.com/',
    ...ANTES_DE_ARROBA.map((caracter) => `https://example.com/a${caracter}@alguien`),
  ];
  for (const url of destinos) {
    assert.equal(esUrlSegura(url), true, url);
    const texto = `[x](${url})`;
    assert.equal(sanearMensaje(texto), texto, url);
    assert.equal(snarkdown(sanearMensaje(texto)), `<a href="${url}">x</a>`, url);
  }
  // Around the link and in its text, mentions still stop notifying.
  assert.equal(
    sanearMensaje('@alguien [@equipo](https://example.com/?a=@b) @otro'),
    `@${ESPACIO_CERO}alguien [@${ESPACIO_CERO}equipo](https://example.com/?a=@b) @${ESPACIO_CERO}otro`,
  );
});

test('sanitizing a sanitized text again changes nothing', () => {
  const casos = [
    ...NO_IDEMPOTENTES,
    '[x](https://example.com/?a=@b)',
    '[x](https://:@example.com/)',
    '@alguien [@equipo](https://example.com/?a=@b) @otro',
    ...ANTES_DE_ARROBA.map((caracter) => `[@alguien](https://example.com/a${caracter}@alguien)`),
    ...ATAQUES,
  ];
  assert.equal(NO_IDEMPOTENTES.length, 6);
  for (const texto of casos) {
    const una = sanearMensaje(texto);
    assert.equal(sanearMensaje(una), una, JSON.stringify(texto));
  }
});

test('control and bidirectional characters are removed, line breaks normalised', () => {
  assert.equal(sanearMensaje('a\u202Eb\u2066c\u0007d\uFEFFe'), 'abcde');
  assert.equal(sanearMensaje('uno\r\ndos\rtres\u2028cuatro'), 'uno\ndos\ntres\ncuatro');
  assert.equal(sanearMensaje('uno\n\n\n\n\ndos'), 'uno\n\ndos');
  assert.equal(sanearMensaje('  \n hola \n '), 'hola');
});

test('empty and missing input give an empty text', () => {
  assert.equal(sanearMensaje(undefined), '');
  assert.equal(sanearMensaje(null), '');
  assert.equal(sanearMensaje('<><>'), '');
  assert.equal(typeof MAX_MENSAJE, 'number');
});

test('safe URLs: https only, a host, no credentials, no quoting characters', () => {
  for (const url of ['https://example.com/', 'https://example.com/a?b=1&c=2#d', 'https://example.com:8443/x']) {
    assert.equal(esUrlSegura(url), true, url);
  }
  for (const url of [
    'http://example.com/',
    'javascript:alert(1)',
    'https://',
    'https://usuario@example.com/',
    'https://example.com/"x',
    'https://example.com/(x)',
    'https://example.com/ x',
    'HTTPS://example.com/',
    ' https://example.com/',
    null,
  ]) {
    assert.equal(esUrlSegura(url), false, String(url));
  }
});

test('titles stay on one line and free of markup', () => {
  assert.equal(sanearTitulo('  Ventana <b>nocturna</b>\n de   base  '), 'Ventana bnocturna/b de base');
  assert.equal(sanearTitulo('a\u202Eb'), 'ab');
  assert.equal(sanearTitulo(undefined), '');
});
