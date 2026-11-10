'use strict';

// Scheduled maintenance, published by mantenimiento.yml as the App bot. Inputs arrive only
// through environment variables, never interpolated into code.
//
// uptime-monitor v1.46.5 (src/update.ts) and the page (@upptime/status-page 1.17.0) read the
// first "<!--" ... "-->" block of every open "maintenance" issue, line by line, as "key: value"
// with i.split(/:(.+)/)[1].trim(). A line with a key and nothing after the colon has no [1], so
// the parser throws: in uptime-monitor that happens outside its per-site error handling, so every
// Uptime CI run fails, and the page sends every visitor to its error page. Empty keys are
// therefore left out entirely, never written bare.

const { ETIQUETAS, autorizar } = require('./constantes.js');
const { MAX_MENSAJE, MAX_TITULO, sanearMensaje, sanearTitulo } = require('./sanear.js');
const { bloquear, comentar } = require('./bloqueo.js');

const FECHA_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

function validarFecha(nombre, valor) {
  const texto = String(valor == null ? '' : valor).trim();
  if (!FECHA_UTC.test(texto)) {
    throw new Error(`${nombre} debe ser una fecha UTC como 2026-11-21T04:00:00Z.`);
  }
  const fecha = new Date(texto);
  // The round trip rejects dates that do not exist, such as February 30.
  if (Number.isNaN(fecha.getTime()) || fecha.toISOString() !== texto.replace('Z', '.000Z')) {
    throw new Error(`${nombre} no es una fecha válida: ${texto}.`);
  }
  return { texto, fecha };
}

// "a, b,,c" -> ["a", "b", "c"], without repeats.
function listaDeSlugs(valor) {
  const slugs = String(valor == null ? '' : valor)
    .split(',')
    .map((slug) => slug.trim())
    .filter((slug) => slug.length > 0);
  return [...new Set(slugs)];
}

// The slugs that .upptimerc.yml declares, read from its "slug:" lines. The runner has no YAML
// parser; validar.js parses the file with both of Upptime's parsers on every change, and a slug
// written any other way is simply not found here, so the check fails closed.
function extraerSlugs(textoYaml) {
  const slugs = [];
  for (const linea of String(textoYaml || '').split(/\r?\n/)) {
    const m = /^\s*(?:-\s+)?slug:\s*(["']?)([a-z0-9][a-z0-9-]*)\1\s*(?:#.*)?$/.exec(linea);
    if (m) slugs.push(m[2]);
  }
  return slugs;
}

function validarEntradas(entradas, slugsConfigurados, ahora) {
  const titulo = sanearTitulo(entradas.titulo);
  if (!titulo) throw new Error('El título está vacío.');
  if (titulo.length > MAX_TITULO) {
    throw new Error(`El título tiene ${titulo.length} caracteres; el máximo es ${MAX_TITULO}.`);
  }

  const inicio = validarFecha('inicio', entradas.inicio);
  const fin = validarFecha('fin', entradas.fin);
  if (fin.fecha.getTime() <= inicio.fecha.getTime()) {
    throw new Error('fin debe ser posterior a inicio.');
  }
  if (fin.fecha.getTime() <= ahora.getTime()) {
    throw new Error('fin ya pasó: Upptime cerraría el mantenimiento en su próxima corrida.');
  }

  const caidos = listaDeSlugs(entradas.caidos);
  const degradados = listaDeSlugs(entradas.degradados);
  for (const slug of [...caidos, ...degradados]) {
    if (!SLUG.test(slug) || !slugsConfigurados.includes(slug)) {
      throw new Error(
        `"${slug}" no es un componente de .upptimerc.yml (${slugsConfigurados.join(', ')}).`,
      );
    }
  }

  const descripcion = sanearMensaje(entradas.descripcion);
  if (descripcion.length > MAX_MENSAJE) {
    throw new Error(`La descripción tiene ${descripcion.length} caracteres; el máximo es ${MAX_MENSAJE}.`);
  }
  return { titulo, inicio: inicio.texto, fin: fin.texto, caidos, degradados, descripcion };
}

function construirTitulo(titulo) {
  return `Mantenimiento programado: ${titulo}`;
}

// The metadata block opens the body, so it is the first "<!--" both parsers find. The
// description cannot add another one: sanearMensaje strips "<" and ">".
function construirCuerpo({ inicio, fin, caidos, degradados, descripcion }) {
  const lineas = ['<!--', `start: ${inicio}`, `end: ${fin}`];
  if (caidos.length > 0) lineas.push(`expectedDown: ${caidos.join(', ')}`);
  if (degradados.length > 0) lineas.push(`expectedDegraded: ${degradados.join(', ')}`);
  lineas.push('-->');
  return `${lineas.join('\n')}\n\n${descripcion || 'Ventana de mantenimiento programada.'}\n`;
}

// The page shows comments, not the body, so the description is also the first comment.
function comentarioInicial(descripcion) {
  return descripcion ? `**Programado:** ${descripcion}` : null;
}

function leerEntradas(env) {
  return {
    titulo: env.TITULO,
    inicio: env.INICIO,
    fin: env.FIN,
    caidos: env.CAIDOS,
    degradados: env.DEGRADADOS,
    descripcion: env.DESCRIPCION,
  };
}

async function run({ github, context, core, env = process.env, leerConfig, ahora = () => new Date() }) {
  autorizar(env);
  const leer = leerConfig || (() => require('fs').readFileSync('.upptimerc.yml', 'utf8'));
  const slugs = extraerSlugs(leer());
  if (slugs.length === 0) throw new Error('No se encontraron componentes en .upptimerc.yml.');
  const entradas = validarEntradas(leerEntradas(env), slugs, ahora());

  const { owner, repo } = context.repo;
  const { data: issue } = await github.rest.issues.create({
    owner,
    repo,
    title: construirTitulo(entradas.titulo),
    body: construirCuerpo(entradas),
    labels: [ETIQUETAS.maintenance],
  });
  const ref = { owner, repo, issue_number: issue.number };
  try {
    const comentario = comentarioInicial(entradas.descripcion);
    if (comentario) await comentar(github, ref, comentario);
  } finally {
    await bloquear(github, ref);
  }
  core.notice(`Mantenimiento publicado en #${issue.number}.`);
}

module.exports = {
  validarFecha,
  listaDeSlugs,
  extraerSlugs,
  validarEntradas,
  construirTitulo,
  construirCuerpo,
  comentarioInicial,
  run,
};
