// snarkdown 2.0.0, the Markdown renderer the status page runs on every comment, for the tests that
// check the sanitizer against it. It is not copied into this repository: scripts/validar.sh
// downloads the npm package, checks it against the integrity npm publishes, and passes its folder
// in SNARKDOWN_DIR. Without that variable, every test file that imports this one fails.
//
// The file is dist/snarkdown.es.js. The page's client bundle resolves "snarkdown" with
// @rollup/plugin-node-resolve 11 and browser: true, which tries the fields browser, module and
// main in that order, and the package's "module" names that file. It is imported from the very
// bytes whose hash is compared below, as a data: URL.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SHA256 = 'c0340a36f28787aeec5a1ad112c6ff7396c38e9b98ae16dedc7a6641302b0b07';

const carpeta = process.env.SNARKDOWN_DIR;
if (!carpeta) {
  throw new Error(
    'Falta SNARKDOWN_DIR, la carpeta del paquete snarkdown 2.0.0. Ejecuta las pruebas con ' +
      'scripts/validar.sh, que lo descarga y verifica su suma, o define SNARKDOWN_DIR con la ' +
      'carpeta "package" de ese paquete ya verificado.',
  );
}

const archivo = join(carpeta, 'dist', 'snarkdown.es.js');
const fuente = readFileSync(archivo);
const obtenido = createHash('sha256').update(fuente).digest('hex');
if (obtenido !== SHA256) {
  throw new Error(`${archivo} no es el de snarkdown 2.0.0: su SHA-256 es ${obtenido} y se esperaba ${SHA256}.`);
}

const { default: snarkdown } = await import(`data:text/javascript;base64,${fuente.toString('base64')}`);

export default snarkdown;
