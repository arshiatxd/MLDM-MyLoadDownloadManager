import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const distMain = path.resolve('dist/main');
const distPreload = path.resolve('dist/preload');

fs.mkdirSync(distMain, { recursive: true });
fs.mkdirSync(distPreload, { recursive: true });

await esbuild.build({
  entryPoints: ['src/main/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  outfile: 'dist/main/index.mjs',
  sourcemap: false,
  logLevel: 'info',
});

await esbuild.build({
  entryPoints: ['src/preload/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['electron'],
  outfile: 'dist/preload/index.cjs',
  sourcemap: false,
  logLevel: 'info',
});

await esbuild.build({
  entryPoints: ['src/main/native-host-cli.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: 'dist/main/native-host.cjs',
  sourcemap: false,
  logLevel: 'info',
});

