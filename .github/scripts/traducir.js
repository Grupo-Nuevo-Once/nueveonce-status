'use strict';

// Translates the incidents that uptime-monitor v1.46.5 writes in English (src/update.ts, as
// bundled in dist/index.js) into Spanish. Every run reconciles the whole issue, so running it
// twice changes nothing and a run dropped by the concurrency group is covered by the next one.
//
// Renaming is safe: Upptime finds its open incident by the labels "status,<slug>", never by the
// title. The title only decides its closing wording ("degraded" in the title gives "performance
// has improved"), which the Spanish title no longer contains, so the degraded case is read here
// from the title instead.

const { BOT_LOGIN, SLUGS, ETIQUETAS, nombresDeEtiquetas } = require('./constantes.js');
const { conDesbloqueo, reintentarDesbloqueando } = require('./bloqueo.js');

// The page strips exactly these two sequences from card titles (U+1F6D1, and U+26A0 U+FE0F).
const CAIDO = '\u{1F6D1}';
const DEGRADADO = '\u26A0\uFE0F';

const INVESTIGANDO =
  '**Investigando:** detectamos el problema y lo estamos revisando. Publicaremos novedades aquí.';

// Titles: `🛑 ${site.name} is down` and `⚠\uFE0F ${site.name} has degraded performance`.
const TITULO_CAIDO = /^\u{1F6D1} (.+) is down$/u;
const TITULO_DEGRADADO = /^\u26A0\uFE0F? (.+) has degraded performance$/u;
const TITULO_DEGRADADO_ES = /^\u26A0\uFE0F? .+: rendimiento degradado$/u;

// Body, after "In [`sha7`](commit URL), ": "NAME (URL) was **down**:" or "NAME (URL) experienced
// **degraded performance**:", then "- HTTP code: N" and "- Response time: N ms". The commit
// URL ends in a newline, because lastCommit() returns `git log` output untrimmed.
const CUERPO =
  /^In \[`[^`]*`\]\([^)]*\), ([\s\S]+?) \(([^\s)]*)\) (was \*\*down\*\*|experienced \*\*degraded performance\*\*):\r?\n- HTTP code: (\d+)\r?\n- Response time: (\d+) ms\s*$/;

// Closing comment: "**Resolved:** NAME is back up in [`sha7`](commit URL) after DURATION." or
// "... performance has improved in ...". DURATION is empty when it took under a minute.
const RESUELTO =
  /^\*\*Resolved:\*\* ([\s\S]+?) (is back up|performance has improved) in \[`[^`]*`\]\([^)]*\) after ([^\n]*)\.\s*$/;

// The issue events that can be the first to show a new incident with its labels. Upptime sets the
// labels in the same call that creates the issue, and the workflow's condition needs them, so
// whichever of these events first lists them posts the first comment. traducir-incidentes.yml
// listens to these and to "closed", and test/traducir.test.mjs keeps both lists in step.
const ACCIONES_DE_APERTURA = Object.freeze(['opened', 'labeled']);

const UNIDADES = Object.freeze({
  day: ['día', 'días'],
  hour: ['hora', 'horas'],
  minute: ['minuto', 'minutos'],
});

function traducirTitulo(titulo) {
  const texto = String(titulo || '');
  let m = TITULO_CAIDO.exec(texto);
  if (m) return `${CAIDO} ${m[1]}: servicio no disponible`;
  m = TITULO_DEGRADADO.exec(texto);
  if (m) return `${DEGRADADO} ${m[1]}: rendimiento degradado`;
  return null;
}

function esTituloDegradado(titulo) {
  const texto = String(titulo || '');
  return TITULO_DEGRADADO.test(texto) || TITULO_DEGRADADO_ES.test(texto);
}

function traducirCuerpo(cuerpo) {
  const m = CUERPO.exec(String(cuerpo || ''));
  if (!m) return null;
  const [, nombre, , estado, codigo, milisegundos] = m;
  const resumen = estado.startsWith('was')
    ? `Detectamos que **${nombre}** no está disponible.`
    : `Detectamos que **${nombre}** tiene un rendimiento degradado.`;
  const codigoHttp = codigo === '0' ? 'sin respuesta' : codigo;
  return `${resumen}\n\n- Código HTTP: ${codigoHttp}\n- Tiempo de respuesta: ${milisegundos} ms\n`;
}

// "2 days, 3 hours, 5 minutes" -> "2 días, 3 horas y 5 minutos"; empty -> "menos de un minuto".
// The numbers come from toLocaleString() on the runner, so thousands separators are dropped.
// Returns null when the text has another shape.
function traducirDuracion(duracion) {
  const texto = String(duracion == null ? '' : duracion).trim();
  if (texto === '') return 'menos de un minuto';
  const partes = [];
  for (const parte of texto.split(', ')) {
    const m = /^(\d[\d.,\u00A0\u202F]*) (day|days|hour|hours|minute|minutes)$/.exec(parte);
    if (!m) return null;
    const cantidad = Number(m[1].replace(/\D/g, ''));
    const [singular, plural] = UNIDADES[m[2].replace(/s$/, '')];
    partes.push(`${cantidad} ${cantidad === 1 ? singular : plural}`);
  }
  if (partes.length === 1) return partes[0];
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
}

function traducirComentario(cuerpo, tituloDegradado) {
  const m = RESUELTO.exec(String(cuerpo || ''));
  if (!m) return null;
  const [, nombre, frase, duracionIngles] = m;
  const degradado = frase === 'performance has improved' || Boolean(tituloDegradado);
  const duracion = traducirDuracion(duracionIngles);
  const tras = duracion ? ` tras ${duracion}` : '';
  return degradado
    ? `**Resuelto:** el rendimiento de ${nombre} se normalizó${tras}.`
    : `**Resuelto:** ${nombre} volvió a funcionar con normalidad${tras}.`;
}

// Only Upptime's own incidents: the event comes from the bot, the issue is labelled status plus
// one of the bare slugs, and it is neither a manual incident nor one from the alert relay
// (incidente.yml posts as the same bot and must not get a second "Investigando").
function debeTraducir(issue, remitente) {
  if (!issue || issue.pull_request) return false;
  if (remitente !== BOT_LOGIN) return false;
  const etiquetas = nombresDeEtiquetas(issue);
  return (
    etiquetas.includes(ETIQUETAS.status) &&
    etiquetas.some((etiqueta) => SLUGS.includes(etiqueta)) &&
    !etiquetas.includes(ETIQUETAS.manual) &&
    !etiquetas.includes(ETIQUETAS.relay)
  );
}

function empiezaCon(comentario, prefijo) {
  return String((comentario && comentario.body) || '').startsWith(prefijo);
}

// Upptime resolves in four calls: unlock, comment "**Resolved:**", close, lock. A run started by
// that comment while the issue is still open waits for the close, so its own final lock never
// lands between Upptime's comment and Upptime's close.
function esperaCierreDeUpptime(evento, issue, comentario) {
  return (
    evento === 'issue_comment' &&
    Boolean(issue) &&
    issue.state === 'open' &&
    Boolean(comentario && comentario.user && comentario.user.login === BOT_LOGIN) &&
    RESUELTO.test(String(comentario.body || ''))
  );
}

function planificarTraduccion({ issue, comentarios, evento, accion }) {
  const plan = { titulo: null, cuerpo: null, ediciones: [], investigar: false };

  const titulo = traducirTitulo(issue.title);
  if (titulo && titulo !== issue.title) plan.titulo = titulo;

  const cuerpo = traducirCuerpo(issue.body);
  if (cuerpo && cuerpo !== issue.body) plan.cuerpo = cuerpo;

  const degradado = esTituloDegradado(plan.titulo || issue.title);
  for (const comentario of comentarios) {
    if (!comentario || !comentario.user || comentario.user.login !== BOT_LOGIN) continue;
    const traducido = traducirComentario(comentario.body, degradado);
    if (traducido && traducido !== comentario.body) {
      plan.ediciones.push({ id: comentario.id, cuerpo: traducido });
    }
  }

  // The page shows comments, not the issue body, so a new incident gets a first comment. Only on
  // an event that opens or labels the issue, while the incident is open, and never twice: GitHub
  // may deliver several of those events for one issue, and the runs that come after the first
  // find the comment already there.
  if (evento === 'issues' && ACCIONES_DE_APERTURA.includes(accion) && issue.state === 'open') {
    const yaInvestigando = comentarios.some((c) => empiezaCon(c, '**Investigando:**'));
    const yaResuelto = comentarios.some(
      (c) => empiezaCon(c, '**Resolved:**') || empiezaCon(c, '**Resuelto:**'),
    );
    plan.investigar = !yaInvestigando && !yaResuelto;
  }
  return plan;
}

function planVacio(plan) {
  return !plan.titulo && !plan.cuerpo && plan.ediciones.length === 0 && !plan.investigar;
}

const pausa = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run({ github, context, core, esperar = pausa, esperasDeCierre = 12, pausaMs = 5000 }) {
  const { owner, repo } = context.repo;
  const numero = context.payload.issue && context.payload.issue.number;
  if (!numero) {
    core.info('El evento no trae un issue.');
    return;
  }
  const remitente = context.payload.sender && context.payload.sender.login;
  const ref = { owner, repo, issue_number: numero };

  // The issue is read again: the event payload is a snapshot from when it fired.
  let { data: issue } = await github.rest.issues.get(ref);
  if (!debeTraducir(issue, remitente)) {
    core.info(`#${numero} no es un incidente de Upptime para traducir.`);
    return;
  }

  if (esperaCierreDeUpptime(context.eventName, issue, context.payload.comment)) {
    for (let i = 0; i < esperasDeCierre && issue.state === 'open'; i += 1) {
      await esperar(pausaMs);
      ({ data: issue } = await github.rest.issues.get(ref));
    }
    if (issue.state === 'open') {
      core.warning(`#${numero} sigue abierto después del comentario de cierre de Upptime; se traduce igual.`);
    }
  }

  const comentarios = await github.paginate(github.rest.issues.listComments, {
    ...ref,
    per_page: 100,
  });
  const plan = planificarTraduccion({
    issue,
    comentarios,
    evento: context.eventName,
    accion: context.payload.action,
  });
  if (planVacio(plan)) {
    core.info(`#${numero} ya está en español.`);
    return;
  }

  await conDesbloqueo(github, ref, issue.locked, async () => {
    const cambios = {};
    if (plan.titulo) cambios.title = plan.titulo;
    if (plan.cuerpo) cambios.body = plan.cuerpo;
    if (Object.keys(cambios).length > 0) {
      await reintentarDesbloqueando(github, ref, () =>
        github.rest.issues.update({ ...ref, ...cambios }),
      );
    }
    for (const edicion of plan.ediciones) {
      await reintentarDesbloqueando(github, ref, () =>
        github.rest.issues.updateComment({ owner, repo, comment_id: edicion.id, body: edicion.cuerpo }),
      );
    }
    if (plan.investigar) {
      await reintentarDesbloqueando(github, ref, () =>
        github.rest.issues.createComment({ ...ref, body: INVESTIGANDO }),
      );
    }
  });
  core.info(
    `#${numero} traducido: título ${plan.titulo ? 'sí' : 'no'}, cuerpo ${plan.cuerpo ? 'sí' : 'no'}, ` +
      `comentarios ${plan.ediciones.length}, aviso inicial ${plan.investigar ? 'sí' : 'no'}.`,
  );
}

module.exports = {
  ACCIONES_DE_APERTURA,
  INVESTIGANDO,
  traducirTitulo,
  esTituloDegradado,
  traducirCuerpo,
  traducirDuracion,
  traducirComentario,
  debeTraducir,
  esperaCierreDeUpptime,
  planificarTraduccion,
  planVacio,
  run,
};
