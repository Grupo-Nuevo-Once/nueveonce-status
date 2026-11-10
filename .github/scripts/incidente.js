'use strict';

// Manual incidents, published by incidente.yml as the App bot. Inputs arrive only through
// environment variables, never interpolated into code.

const {
  SLUGS,
  ETIQUETAS,
  autorizar,
  nombreDe,
  nombresDeEtiquetas,
} = require('./constantes.js');
const { MAX_MENSAJE, sanearMensaje } = require('./sanear.js');
const { bloquear, comentar, conDesbloqueo, reintentarDesbloqueando } = require('./bloqueo.js');

const ACCIONES = Object.freeze(['declarar', 'actualizar', 'resolver']);
const ESTADOS = Object.freeze(['Investigando', 'Identificado', 'Monitoreando', 'Resuelto']);

function validarEntradas(entradas) {
  const accion = String(entradas.accion || '').trim();
  const estado = String(entradas.estado || '').trim();
  const componente = String(entradas.componente || '').trim();
  const numeroTexto = String(entradas.numero == null ? '' : entradas.numero).trim();

  if (!ACCIONES.includes(accion)) {
    throw new Error(`La acción debe ser una de: ${ACCIONES.join(', ')}.`);
  }
  if (!ESTADOS.includes(estado)) {
    throw new Error(`El estado debe ser uno de: ${ESTADOS.join(', ')}.`);
  }
  if (accion === 'resolver' && estado !== 'Resuelto') {
    throw new Error('Para resolver un incidente, elige el estado Resuelto.');
  }
  if (accion !== 'resolver' && estado === 'Resuelto') {
    throw new Error('El estado Resuelto se publica con la acción resolver.');
  }

  let numero = null;
  if (accion === 'declarar') {
    if (!SLUGS.includes(componente)) {
      throw new Error(`Para declarar, elige un componente: ${SLUGS.join(', ')}.`);
    }
  } else {
    if (!/^[1-9]\d{0,9}$/.test(numeroTexto)) {
      throw new Error('Para actualizar o resolver, indica el número del issue.');
    }
    numero = Number(numeroTexto);
  }

  const mensaje = sanearMensaje(entradas.mensaje);
  if (!mensaje) throw new Error('El mensaje está vacío (o quedó vacío al quitarle el HTML).');
  if (mensaje.length > MAX_MENSAJE) {
    throw new Error(`El mensaje tiene ${mensaje.length} caracteres; el máximo es ${MAX_MENSAJE}.`);
  }
  return { accion, estado, componente: accion === 'declarar' ? componente : null, numero, mensaje };
}

function tituloDeclarado(slug) {
  return `\u{1F6D1} ${nombreDe(slug)}: servicio con incidencias`;
}

// The page reads the body of every incident it shows, and an issue without one breaks its
// incident page, so a declared incident always has one.
function cuerpoDeclarado(slug) {
  return `Seguimiento del incidente en **${nombreDe(slug)}**. Publicaremos las actualizaciones como comentarios.\n`;
}

function etiquetasDeclaradas(slug) {
  // Never the bare slug: that label belongs to Upptime, which would close this issue.
  return [ETIQUETAS.status, ETIQUETAS.manual, ETIQUETAS.componente(slug)];
}

function comentarioDeEstado(estado, mensaje) {
  return `**${estado}:** ${mensaje}`;
}

// Updates go only to incidents and maintenance, never to an arbitrary issue or pull request.
function admiteActualizaciones(issue) {
  if (!issue || issue.pull_request) return false;
  const etiquetas = nombresDeEtiquetas(issue);
  return etiquetas.includes(ETIQUETAS.status) || etiquetas.includes(ETIQUETAS.maintenance);
}

// Upptime and the alert relay close their own issues; this workflow closes only its own.
function debeCerrar(issue) {
  return nombresDeEtiquetas(issue).includes(ETIQUETAS.manual);
}

function leerEntradas(env) {
  return {
    accion: env.ACCION,
    numero: env.NUMERO,
    componente: env.COMPONENTE,
    estado: env.ESTADO,
    mensaje: env.MENSAJE,
  };
}

async function declarar({ github, owner, repo, core }, entradas) {
  const etiquetas = etiquetasDeclaradas(entradas.componente);
  const abiertos = await github.paginate(github.rest.issues.listForRepo, {
    owner,
    repo,
    state: 'open',
    labels: etiquetas.join(','),
    per_page: 100,
  });
  if (abiertos.length > 0) {
    throw new Error(
      `Ya hay un incidente manual abierto para ${entradas.componente} (#${abiertos[0].number}); usa actualizar.`,
    );
  }
  const { data: issue } = await github.rest.issues.create({
    owner,
    repo,
    title: tituloDeclarado(entradas.componente),
    body: cuerpoDeclarado(entradas.componente),
    labels: etiquetas,
  });
  const ref = { owner, repo, issue_number: issue.number };
  try {
    await comentar(github, ref, comentarioDeEstado(entradas.estado, entradas.mensaje));
  } finally {
    await bloquear(github, ref);
  }
  core.notice(`Incidente declarado en #${issue.number}.`);
}

async function publicarEstado({ github, owner, repo, core }, entradas) {
  const ref = { owner, repo, issue_number: entradas.numero };
  const { data: issue } = await github.rest.issues.get(ref);
  if (!admiteActualizaciones(issue)) {
    throw new Error(
      `#${entradas.numero} no es un incidente ni un mantenimiento (falta la etiqueta status o maintenance).`,
    );
  }
  const cerrar = entradas.accion === 'resolver' && debeCerrar(issue) && issue.state !== 'closed';
  await conDesbloqueo(github, ref, issue.locked, async () => {
    await comentar(github, ref, comentarioDeEstado(entradas.estado, entradas.mensaje));
    if (cerrar) {
      await reintentarDesbloqueando(github, ref, () =>
        github.rest.issues.update({ ...ref, state: 'closed', state_reason: 'completed' }),
      );
    }
  });
  if (entradas.accion === 'resolver' && !debeCerrar(issue)) {
    core.notice(
      `Se publicó la actualización en #${entradas.numero}; no es un incidente manual, así que lo cierra quien lo abrió.`,
    );
  } else {
    core.notice(`Actualización publicada en #${entradas.numero}${cerrar ? ' y cerrado' : ''}.`);
  }
}

async function run({ github, context, core, env = process.env }) {
  autorizar(env);
  const entradas = validarEntradas(leerEntradas(env));
  const { owner, repo } = context.repo;
  const contexto = { github, owner, repo, core };
  if (entradas.accion === 'declarar') return declarar(contexto, entradas);
  return publicarEstado(contexto, entradas);
}

module.exports = {
  ACCIONES,
  ESTADOS,
  validarEntradas,
  tituloDeclarado,
  cuerpoDeclarado,
  etiquetasDeclaradas,
  comentarioDeEstado,
  admiteActualizaciones,
  debeCerrar,
  run,
};
