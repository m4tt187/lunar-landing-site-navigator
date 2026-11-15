// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

const here = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

// The build removes the comments that carry the notices of the open-source
// components it includes; this line at the top of every script says where they are.
const banner = '/*! Lunar Landing Site Navigator. Apache-2.0. Includes open-source components under the MIT License: ' +
  'their notices are in THIRD-PARTY-NOTICES.txt, next to index.html. */';

/** Puts the line at the top of every script of the build, the page's and the workers'. */
const noticeBanner: Plugin = {
  name: 'notice-banner',
  generateBundle(_options, bundle) {
    for (const file of Object.values(bundle))
      if (file.type === 'chunk' && !file.code.startsWith(banner)) file.code = `${banner}\n${file.code}`;
  },
};

export default defineConfig({
  root: here('.'),
  // Relative base: the same build works under any path (GitHub Pages project
  // site, a sub-folder of another site, or a local file server).
  base: './',
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
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
  plugins: [noticeBanner],
  worker: { plugins: () => [noticeBanner] },
});
