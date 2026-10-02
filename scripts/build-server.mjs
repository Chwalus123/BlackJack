// Bundles the server (and the workspace engine/protocol sources it imports) into one ESM file.
// Third-party dependencies stay external and are installed in the runtime image.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../apps/server/package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith('@casino/'));

await build({
  entryPoints: ['apps/server/src/index.ts'],
  outfile: 'apps/server/dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external,
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
