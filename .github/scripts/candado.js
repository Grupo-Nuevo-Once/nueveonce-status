'use strict';

// Keeps every issue and pull request locked. The status page renders the comments of any issue or
// pull request number at /incident/<number> as raw HTML, so an unlocked conversation would let
// anyone with a GitHub account publish script on the page.

const { bloquear } = require('./bloqueo.js');

// Bots unlock their own issues for a moment to comment on them (uptime-monitor: unlock, comment,
// close, lock). The sweep locks only what is still unlocked after this grace period, so it never
// closes that window under a writer and makes its next call fail.
const GRACIA_MS = 30_000;

function desbloqueados(items) {
  return items.filter((item) => item && !item.locked).map((item) => item.number);
}

async function bloquearSiHaceFalta(github, ref, core) {
  const { data } = await github.rest.issues.get(ref);
  if (data.locked) {
    core.info(`#${ref.issue_number} ya está bloqueado.`);
    return false;
  }
  await bloquear(github, ref);
  core.info(`#${ref.issue_number} bloqueado.`);
  return true;
}

async function barrer({ github, owner, repo, core, esperar, graciaMs = GRACIA_MS }) {
  // The issues list includes pull requests, open and closed.
  const items = await github.paginate(github.rest.issues.listForRepo, {
    owner,
    repo,
    state: 'all',
    per_page: 100,
  });
  const candidatos = desbloqueados(items);
  if (candidatos.length === 0) {
    core.info(`Revisados ${items.length} issues y pull requests: todos bloqueados.`);
    return [];
  }
  core.info(
    `Desbloqueados: ${candidatos.map((n) => `#${n}`).join(', ')}. Se revisan de nuevo en ${graciaMs / 1000} s.`,
  );
  await esperar(graciaMs);
  const bloqueados = [];
  for (const numero of candidatos) {
    if (await bloquearSiHaceFalta(github, { owner, repo, issue_number: numero }, core)) {
      bloqueados.push(numero);
    }
  }
  core.info(`Bloqueados en este barrido: ${bloqueados.length}.`);
  return bloqueados;
}

const pausa = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run({ github, context, core, esperar = pausa, graciaMs = GRACIA_MS }) {
  const { owner, repo } = context.repo;
  switch (context.eventName) {
    case 'issues':
      return bloquearSiHaceFalta(github, { owner, repo, issue_number: context.payload.issue.number }, core);
    case 'pull_request':
      return bloquearSiHaceFalta(
        github,
        { owner, repo, issue_number: context.payload.pull_request.number },
        core,
      );
    case 'schedule':
    case 'workflow_dispatch':
      return barrer({ github, owner, repo, core, esperar, graciaMs });
    default:
      throw new Error(`Evento no previsto: ${context.eventName}.`);
  }
}

module.exports = { GRACIA_MS, desbloqueados, bloquearSiHaceFalta, barrer, run };
