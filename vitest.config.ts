// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@engine': here('./engine/src'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts', 'web/src/**/*.test.ts', 'terrain/**/*.test.ts'],
    environment: 'node',
  },
});
