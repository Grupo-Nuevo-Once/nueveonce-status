'use strict';

// Values shared by the workflow scripts and by the checker. The workflows repeat the bot login,
// the publisher allowlist and the slugs in their job conditions, which GitHub evaluates before
// any of this code runs; test/flujos.test.mjs keeps both copies in agreement.

// Public components, in the order .upptimerc.yml lists them. validar.js checks that the
// configuration has exactly these slugs and names, so manual incidents carry the page's names.
// The list is data (componentes.json), so that master's copy of the checker can read a change's
// list without running the change's code: adding a component takes one change, once its host is
// in master's allowlist.
const COMPONENTES = Object.freeze(
  require('./componentes.json').map(({ slug, nombre }) => Object.freeze({ slug, nombre })),
);

const SLUGS = Object.freeze(COMPONENTES.map((componente) => componente.slug));

// The GitHub App bot that runs Upptime and publishes manual incidents and maintenance.
const BOT_LOGIN = 'nueveonce-status[bot]';

// Accounts allowed to dispatch incidente.yml and mantenimiento.yml.
const PUBLICADORES = Object.freeze(['fcastro-nueveonce']);

const ETIQUETAS = Object.freeze({
  status: 'status',
  maintenance: 'maintenance',
  manual: 'manual',
  relay: 'status-relay',
  // Manual and relay incidents never carry the bare slug: that label is Upptime's, and Upptime
  // closes the open "status,<slug>" issue as soon as the site is up again.
  componente: (slug) => `componente:${slug}`,
});

// Both the account that dispatched the run and the one that re-ran it must be allowed. The
// workflows check this before the job that holds the App key starts; the scripts check again.
function autorizar(env) {
  for (const variable of ['GITHUB_ACTOR', 'GITHUB_TRIGGERING_ACTOR']) {
    if (!PUBLICADORES.includes(env[variable])) {
      throw new Error('Esta cuenta no está autorizada para publicar en la página de estado.');
    }
  }
}

function nombreDe(slug) {
  const componente = COMPONENTES.find((c) => c.slug === slug);
  return componente ? componente.nombre : null;
}

// Label names of an issue, whether the API returned label objects or plain strings.
function nombresDeEtiquetas(issue) {
  const etiquetas = (issue && issue.labels) || [];
  return etiquetas
    .map((etiqueta) => (typeof etiqueta === 'string' ? etiqueta : etiqueta && etiqueta.name))
    .filter((nombre) => typeof nombre === 'string');
}

module.exports = {
  COMPONENTES,
  SLUGS,
  BOT_LOGIN,
  PUBLICADORES,
  ETIQUETAS,
  autorizar,
  nombreDe,
  nombresDeEtiquetas,
};
