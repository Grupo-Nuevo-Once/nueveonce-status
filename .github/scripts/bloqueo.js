'use strict';

// Lock helpers. Every issue and pull request in this repository stays locked, because the status
// page renders comments as raw HTML. A GitHub App cannot comment on a locked issue, so writers
// unlock, write and lock again, the same way uptime-monitor does.

// GitHub answers 403 or 422 with a message about the lock when an issue is locked.
function esErrorDeBloqueo(error) {
  const estado = error && error.status;
  const mensaje = String((error && error.message) || '');
  return (estado === 403 || estado === 422) && /lock/i.test(mensaje);
}

async function estaBloqueado(github, ref) {
  const { data } = await github.rest.issues.get(ref);
  return Boolean(data.locked);
}

// Locks the item. If GitHub refuses, it re-reads the item: being locked already is fine.
async function bloquear(github, ref) {
  try {
    await github.rest.issues.lock(ref);
  } catch (error) {
    if (await estaBloqueado(github, ref)) return;
    throw error;
  }
}

async function desbloquear(github, ref) {
  try {
    await github.rest.issues.unlock(ref);
  } catch (error) {
    if (!(await estaBloqueado(github, ref))) return;
    throw error;
  }
}

// Runs a write. If something locked the item in the meantime (candado.yml reacts to the same
// "opened" event), it unlocks and tries again.
async function reintentarDesbloqueando(github, ref, escribir, intentos = 3) {
  for (let intento = 1; ; intento += 1) {
    try {
      return await escribir();
    } catch (error) {
      if (!esErrorDeBloqueo(error) || intento >= intentos) throw error;
      await desbloquear(github, ref);
    }
  }
}

function comentar(github, ref, body) {
  return reintentarDesbloqueando(github, ref, () =>
    github.rest.issues.createComment({ ...ref, body }),
  );
}

// Unlocks (when the caller knows the item is locked), runs the writes and always locks again.
// If both the writes and the final lock fail, the writes' error is the one reported.
async function conDesbloqueo(github, ref, bloqueado, escribir) {
  if (bloqueado) await desbloquear(github, ref);
  let falloAlEscribir = false;
  try {
    return await escribir();
  } catch (error) {
    falloAlEscribir = true;
    throw error;
  } finally {
    try {
      await bloquear(github, ref);
    } catch (error) {
      if (!falloAlEscribir) throw error;
    }
  }
}

module.exports = {
  esErrorDeBloqueo,
  bloquear,
  desbloquear,
  reintentarDesbloqueando,
  comentar,
  conDesbloqueo,
};
