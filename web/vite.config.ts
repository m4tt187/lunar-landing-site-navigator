// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  root: here('.'),
  // Relative base: the same build works under any path (GitHub Pages project
  // site, a sub-folder of another site, or a local file server).
  base: './',
  resolve: {
    alias: {
      '@engine': here('../engine/src'),
    },
  },
  build: {
    outDir: here('./dist'),
    emptyOutDir: true,
    // No source maps in the published build: they would embed local build paths.
    sourcemap: false,
    target: 'es2022',
  },
});
