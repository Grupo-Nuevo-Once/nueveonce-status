// In-memory stand-in for the parts of github-script's `github` (octokit) and `core` that the
// scripts use. It enforces the one rule that shapes them: a comment on a locked issue fails, as
// GitHub refuses it to GitHub Apps. `antes` hooks run before a method, to stage races.

export const BOT = 'nueveonce-estado[bot]';

function error(status, message) {
  return Object.assign(new Error(message), { status });
}

export function crearGithubFalso({ issues = [], comentarios = [], antes = {}, autorComentarios = BOT } = {}) {
  const estado = {
    issues: new Map(
      issues.map((issue) => [
        issue.number,
        { state: 'open', locked: false, title: '', body: '', ...structuredClone(issue), labels: (issue.labels || []).map((l) => (typeof l === 'string' ? { name: l } : l)) },
      ]),
    ),
    comentarios: comentarios.map((comentario) => structuredClone(comentario)),
    siguienteIssue: Math.max(0, ...issues.map((issue) => issue.number)) + 1,
    siguienteComentario: 1000,
  };
  const llamadas = [];

  const buscar = (numero) => {
    const issue = estado.issues.get(numero);
    if (!issue) throw error(404, 'Not Found');
    return issue;
  };
  const metodo = (nombre, cuerpo) => async (params = {}) => {
    llamadas.push({ nombre, ...params });
    if (antes[nombre]) await antes[nombre](params, estado, llamadas);
    return cuerpo(params);
  };

  const api = {
    get: metodo('get', ({ issue_number }) => ({ data: structuredClone(buscar(issue_number)) })),
    lock: metodo('lock', ({ issue_number }) => {
      buscar(issue_number).locked = true;
      return { status: 204 };
    }),
    unlock: metodo('unlock', ({ issue_number }) => {
      const issue = buscar(issue_number);
      if (!issue.locked) throw error(404, 'Not Found');
      issue.locked = false;
      return { status: 204 };
    }),
    create: metodo('create', ({ title, body, labels = [] }) => {
      const number = estado.siguienteIssue++;
      estado.issues.set(number, {
        number,
        title,
        body,
        labels: labels.map((name) => ({ name })),
        state: 'open',
        locked: false,
      });
      return { data: structuredClone(estado.issues.get(number)) };
    }),
    update: metodo('update', ({ issue_number, owner, repo, ...cambios }) => {
      const issue = buscar(issue_number);
      Object.assign(issue, cambios);
      return { data: structuredClone(issue) };
    }),
    createComment: metodo('createComment', ({ issue_number, body }) => {
      const issue = buscar(issue_number);
      if (issue.locked) throw error(403, 'Unable to create comment because issue is locked.');
      const comentario = { id: estado.siguienteComentario++, issue_number, body, user: { login: autorComentarios } };
      estado.comentarios.push(comentario);
      return { data: structuredClone(comentario) };
    }),
    updateComment: metodo('updateComment', ({ comment_id, body }) => {
      const comentario = estado.comentarios.find((c) => c.id === comment_id);
      if (!comentario) throw error(404, 'Not Found');
      comentario.body = body;
      return { data: structuredClone(comentario) };
    }),
    listComments: metodo('listComments', ({ issue_number }) => ({
      data: estado.comentarios.filter((c) => c.issue_number === issue_number).map((c) => structuredClone(c)),
    })),
    listForRepo: metodo('listForRepo', ({ state = 'open', labels }) => {
      const requeridas = labels ? labels.split(',') : [];
      const data = [...estado.issues.values()]
        .filter((issue) => state === 'all' || issue.state === state)
        .filter((issue) => requeridas.every((l) => issue.labels.some((x) => x.name === l)))
        .map((issue) => structuredClone(issue));
      return { data };
    }),
  };

  return {
    rest: { issues: api },
    paginate: async (llamar, params) => (await llamar(params)).data,
    llamadas,
    estado,
    // The names of the calls that write, in order.
    escrituras: () => llamadas.filter((l) => !['get', 'listComments', 'listForRepo'].includes(l.nombre)).map((l) => l.nombre),
    comentariosDe: (numero) => estado.comentarios.filter((c) => c.issue_number === numero),
  };
}

export function crearCoreFalso() {
  const mensajes = [];
  const registrar = (tipo) => (texto) => mensajes.push({ tipo, texto: String(texto) });
  return {
    mensajes,
    info: registrar('info'),
    notice: registrar('notice'),
    warning: registrar('warning'),
    error: registrar('error'),
    setFailed: registrar('setFailed'),
  };
}

export function crearContexto({ eventName, payload = {} }) {
  return { eventName, payload, repo: { owner: 'Grupo-Nuevo-Once', repo: 'status' } };
}
