// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
//
// Writes THIRD-PARTY-NOTICES.txt: the copyright and permission notices of the
// open-source components that are built into the published application. Their
// licence (MIT) asks for these notices to accompany every copy, and the build
// removes the comments that carry them. The file is written twice: at the root
// of the repository and in web/public, from where the build copies it next to
// the application.
//
// Usage: npx tsx tools/notices.ts   (after npm ci; run again when a dependency changes)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const modules = root + 'node_modules/';

interface Component { name: string; version: string; licence: string; source: string; notice: string }

function manifest(name: string): { version: string; license: string; homepage?: string; repository?: { url?: string } | string } {
  return JSON.parse(readFileSync(`${modules}${name}/package.json`, 'utf8')) as ReturnType<typeof manifest>;
}

/** Where a package comes from, as its own manifest says. */
function sourceOf(name: string): string {
  const m = manifest(name);
  const repository = typeof m.repository === 'string' ? m.repository : m.repository?.url ?? '';
  return (m.homepage ?? repository).replace(/^git\+/, '').replace(/\.git$/, '').replace(/#readme$/, '');
}

/** The licence file shipped with the package. */
function fromLicenceFile(name: string): string {
  const path = `${modules}${name}/LICENSE`;
  if (!existsSync(path)) throw new Error(`${name} ships no LICENSE file; add how to find its notice.`);
  return readFileSync(path, 'utf8').trim();
}

/** Astronomy Engine carries its notice in the first comment of its source file. */
function fromAstronomyEngine(): string {
  const text = readFileSync(`${modules}astronomy-engine/astronomy.js`, 'utf8');
  const end = text.indexOf('*/');
  const comment = text.slice(0, end);
  const start = comment.indexOf('MIT License');
  if (end < 0 || start < 0 || !comment.includes('Permission is hereby granted')) throw new Error('The notice of Astronomy Engine is not where it used to be.');
  return comment.slice(start).split('\n').map((line) => line.replace(/^ {4}/, '').trimEnd()).join('\n').trim();
}

// Everything that ends up in the published JavaScript: the three dependencies of
// package.json and the one they bring with them.
const components: Component[] = [
  { name: 'astronomy-engine', notice: fromAstronomyEngine() },
  { name: 'preact', notice: fromLicenceFile('preact') },
  { name: '@preact/signals', notice: fromLicenceFile('@preact/signals') },
  { name: '@preact/signals-core', notice: fromLicenceFile('@preact/signals-core') },
].map((c) => ({
  ...c,
  // No personal contact details in this repository: an author's e-mail address is left out of the copy of the notice.
  notice: c.notice.replace(/\s*<[^<>\s]+@[^<>\s]+>/g, ''),
  version: manifest(c.name).version, licence: manifest(c.name).license, source: sourceOf(c.name),
}));

for (const c of components) {
  if (c.licence !== 'MIT') throw new Error(`${c.name} is no longer under the MIT License (${c.licence}): review this file.`);
  if (!/Copyright \(c\)/.test(c.notice)) throw new Error(`No copyright line found for ${c.name}.`);
}

const rule = '-'.repeat(78);
const text = [
  'Lunar Landing Site Navigator: third-party notices',
  '',
  'The application is licensed under the Apache License, Version 2.0 (see LICENSE in',
  'the source repository). It is built with the open-source components below, whose',
  'code is part of the published application. Each is used unmodified, under the MIT',
  'License; its copyright and permission notice follows (an author\'s e-mail address,',
  'where the original notice gives one, is left out: the original is at the address',
  'shown). The data used by the application and every other resource are listed in',
  'docs/references.md in the source repository.',
  '',
  ...components.flatMap((c) => [rule, `${c.name} ${c.version}`, c.source, rule, '', c.notice, '']),
  rule, 'Inter typeface (variable, Latin subset)', 'https://github.com/rsms/inter', rule, '',
  'Copyright 2016 The Inter Project Authors. Used unmodified under the SIL Open Font',
  'License, Version 1.1. The font file is fonts/inter-latin-wght-normal.woff2 next to',
  'the application (web/public/fonts/ in the source repository); the complete licence',
  'is beside it, in inter-LICENSE.txt.', '',
].join('\n');

for (const path of [root + 'THIRD-PARTY-NOTICES.txt', root + 'web/public/THIRD-PARTY-NOTICES.txt']) writeFileSync(path, text);
console.log(`THIRD-PARTY-NOTICES.txt written (${components.map((c) => `${c.name} ${c.version}`).join(', ')})`);
