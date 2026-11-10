#!/usr/bin/env bash
# Runs every check that guards this repository, in order:
#   1. the unit tests of the target (node --test), given in SNARKDOWN_DIR the npm package of the
#      Markdown renderer the page runs on comments, which the sanitizer's tests render with;
#   2. .upptimerc.yml and the workflows, with the checker that sits next to this script;
#   3. the negative fixtures of that same checker, which prove that each of its rules fires;
#   4. actionlint over the target's workflows, with this script's (empty) configuration rather
#      than any .github/actionlint.yaml the target brings, which could silence its findings.
#
#   scripts/validar.sh [--sin-pruebas] [repo-dir]
#
# repo-dir defaults to the repository that holds this script. validar.yml also runs master's copy
# of this script against a pull request, in a job of its own and with --sin-pruebas: the unit
# tests are the pull request's code, and anything it runs could rewrite the checker on disk, so
# that job only reads the pull request's files. Downloads go to $HERRAMIENTAS_DIR (by default a
# temporary directory removed on exit), never into the repository, and each one is checked
# against the checksum pinned below before use.
set -euo pipefail

pruebas_del_objetivo=1
if [ "${1:-}" = "--sin-pruebas" ]; then
  pruebas_del_objetivo=0
  shift
fi

JS_YAML_MONITOR=5.4.3 # bundled in upptime/uptime-monitor v1.46.5 (its package-lock.json)
JS_YAML_MONITOR_SHA512='yzzNtgczwgoVHNigCyKTXcQJU4Y8t/ikU4UxXW0BvrLfHTGWZhsNcOT2s/a7vn81/4KqVnNmHjaUEPlvWnNwVw=='
JS_YAML_SITIO=4.3.2 # what "js-yaml": "^4.1.0" in @upptime/status-page 1.17.0 resolves to
JS_YAML_SITIO_SHA512='SFNOvSJ+Dgf/9An904Yx+CgSlIPCkIpao4qo51lpee25TIRejdH3rhR4EZMGoNx3/TP3O+wzWuiTFl4sqbltzA=='
SNARKDOWN=2.0.0 # what "snarkdown": "^2.0.0" in @upptime/status-page 1.17.0 resolves to
SNARKDOWN_SHA512='MgL/7k/AZdXCTJiNgrO7chgDqaB9FGM/1Tvlcenenb7div6obaDATzs16JhFyHHBGodHT3B7RzRc5qk8pFhg3A=='
ACTIONLINT=1.7.12

raiz_verificador="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
objetivo="$(cd "${1:-$raiz_verificador}" && pwd)"
trabajo="$(mktemp -d)"
trap 'rm -rf "$trabajo"' EXIT
herramientas="${HERRAMIENTAS_DIR:-$trabajo/descargas}"
mkdir -p "$herramientas"

en_actions() { [ "${GITHUB_ACTIONS:-}" = "true" ]; }

titulo() {
  echo
  echo "== $1"
}

error() {
  if en_actions; then echo "::error title=validar::$1"; else echo "✗ $1"; fi
}

# resumen <sha256|sha512> <file> <hex|base64>
resumen() {
  node -e 'const c = require("crypto"); const f = require("fs");
process.stdout.write(c.createHash(process.argv[1]).update(f.readFileSync(process.argv[2])).digest(process.argv[3]));' "$1" "$2" "$3"
}

# descargar <url> <file>; reuses a file already downloaded, which is verified like a new one.
descargar() {
  if [ ! -f "$2" ]; then
    curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 --retry 3 --output "$2.tmp" "$1"
    mv "$2.tmp" "$2"
  fi
}

# verificar <file> <sha256|sha512> <hex|base64> <expected>
verificar() {
  local obtenido
  obtenido="$(resumen "$2" "$1" "$3")"
  if [ "$obtenido" != "$4" ]; then
    error "$(basename "$1") no coincide con su suma de verificación ($2): se esperaba $4 y se obtuvo $obtenido."
    rm -f "$1"
    exit 1
  fi
}

# preparar_npm <package> <version> <sha512> <destination>: the package's npm tarball, checked
# against the integrity npm publishes (npm view <package>@<version> dist.integrity) and unpacked
# into <destination>/package.
preparar_npm() {
  local tgz="$herramientas/$1-$2.tgz"
  descargar "https://registry.npmjs.org/$1/-/$1-$2.tgz" "$tgz"
  verificar "$tgz" sha512 base64 "$3"
  mkdir -p "$4"
  tar -xzf "$tgz" -C "$4"
}

preparar_actionlint() {
  local plataforma sha
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) plataforma=linux_amd64 sha=8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8 ;;
    Linux-aarch64 | Linux-arm64) plataforma=linux_arm64 sha=325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6 ;;
    Darwin-x86_64) plataforma=darwin_amd64 sha=5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644 ;;
    Darwin-arm64) plataforma=darwin_arm64 sha=aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f ;;
    *)
      error "No hay un actionlint verificado para $(uname -s)-$(uname -m)."
      exit 1
      ;;
  esac
  local tgz="$herramientas/actionlint_${ACTIONLINT}_${plataforma}.tar.gz"
  descargar "https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT}/actionlint_${ACTIONLINT}_${plataforma}.tar.gz" "$tgz"
  verificar "$tgz" sha256 hex "$sha"
  tar -xzf "$tgz" -C "$trabajo" actionlint
}

echo "Verificador: $raiz_verificador"
echo "Objetivo:    $objetivo"
echo "Node:        $(node --version)"

preparar_npm js-yaml "$JS_YAML_MONITOR" "$JS_YAML_MONITOR_SHA512" "$trabajo/js-yaml-monitor"
preparar_npm js-yaml "$JS_YAML_SITIO" "$JS_YAML_SITIO_SHA512" "$trabajo/js-yaml-sitio"
if [ "$pruebas_del_objetivo" -eq 1 ]; then
  preparar_npm snarkdown "$SNARKDOWN" "$SNARKDOWN_SHA512" "$trabajo/snarkdown"
fi
preparar_actionlint

verificador="$raiz_verificador/.github/scripts/validar.js"
parsers=(--js-yaml "$trabajo/js-yaml-monitor/package" --js-yaml-sitio "$trabajo/js-yaml-sitio/package")
fallos=()

titulo "1. Pruebas unitarias"
# An explicit list of files: since Node 21, "node --test <dir>" no longer searches a directory.
pruebas=()
for archivo in "$objetivo"/test/*.test.mjs; do
  if [ -f "$archivo" ]; then pruebas+=("$archivo"); fi
done
if [ "$pruebas_del_objetivo" -eq 0 ]; then
  echo "Omitidas (--sin-pruebas): corren en el job que usa la copia del propio cambio."
elif [ "${#pruebas[@]}" -eq 0 ]; then
  error "No hay pruebas en test/*.test.mjs."
  fallos+=("pruebas")
elif ! (cd "$objetivo" && SNARKDOWN_DIR="$trabajo/snarkdown/package" node --test "${pruebas[@]}"); then
  fallos+=("pruebas")
fi

titulo "2. .upptimerc.yml y workflows"
if ! node "$verificador" repo "$objetivo" "${parsers[@]}"; then
  fallos+=("configuración")
fi

titulo "3. Casos negativos del verificador"
if ! node "$verificador" negativos "$raiz_verificador/test/fixtures" "${parsers[@]}"; then
  fallos+=("casos negativos")
fi

titulo "4. actionlint $ACTIONLINT"
: >"$trabajo/actionlint.yaml"
if (cd "$objetivo" && "$trabajo/actionlint" -color=false -config-file "$trabajo/actionlint.yaml"); then
  echo "✓ actionlint sin observaciones."
else
  fallos+=("actionlint")
fi

echo
if [ "${#fallos[@]}" -gt 0 ]; then
  error "Falló: ${fallos[*]}."
  exit 1
fi
echo "✓ Todo en orden."
