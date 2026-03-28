// Build script for the GNOME Shell extension.
// Run with: tsx gnome-extension/build.ts

import * as esbuild from 'esbuild';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, 'src');
const outDir = resolve(__dirname, 'pencast-overlay@pencast');

const gjsExternal = ['gi://*', 'resource://*'];

const shared = {
  format: 'esm' as const,
  bundle: true,
  platform: 'neutral' as const,
};

await Promise.all([
  esbuild.build({
    ...shared,
    entryPoints: [`${srcDir}/extension.ts`],
    outfile: `${outDir}/extension.js`,
    external: [...gjsExternal, './lib/ws.js', './lib/renderer.js'],
  }),
  esbuild.build({
    ...shared,
    entryPoints: [`${srcDir}/lib/ws.ts`],
    outfile: `${outDir}/lib/ws.js`,
    external: gjsExternal,
  }),
  esbuild.build({
    ...shared,
    entryPoints: [`${srcDir}/lib/renderer.ts`],
    outfile: `${outDir}/lib/renderer.js`,
    external: [...gjsExternal, './draw-cairo.js'],
  }),
  esbuild.build({
    ...shared,
    entryPoints: [`${srcDir}/lib/draw-cairo.ts`],
    outfile: `${outDir}/lib/draw-cairo.js`,
    external: gjsExternal,
  }),
]);

console.log('Extension built successfully.');
