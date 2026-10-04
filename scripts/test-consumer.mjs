// Installs the packed tarball into a fresh project, the way a user would, and
// checks that it type-checks, bundles and runs there.
//
//   npm run build && npm run test:consumer
//
// Pass --keep to leave the project on disk and print its path.
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const keep = process.argv.includes('--keep');
const dir = mkdtempSync(join(tmpdir(), 'milkdown-plugin-bible-consumer-'));

function run(command, cwd = dir) {
  return execSync(command, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
}

function step(name, fn) {
  process.stdout.write(`${name} ... `);
  const result = fn();
  console.log('ok');
  return result;
}

const files = {
  'package.json': JSON.stringify({ name: 'consumer', private: true, type: 'module' }, null, 2),

  // Uses the public API with its types, as an app would.
  'src/plain.ts': `
import { Editor, defaultValueCtx, rootCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { callCommand } from '@milkdown/kit/utils';
import {
  bible,
  bibleConfig,
  cachedProvider,
  findReferences,
  formatReference,
  helloaoProvider,
  insertBiblePassageCommand,
  parseReference,
  type BibleConfig,
  type BibleProvider,
  type BibleReference,
} from 'milkdown-plugin-bible';
import 'milkdown-plugin-bible/style.css';

const provider: BibleProvider = cachedProvider(helloaoProvider());
const overrides: Partial<BibleConfig> = { provider, translation: () => 'KJV', keys: { preview: 'Mod-Enter', insert: null } };
const reference: BibleReference | null = parseReference('jn 3 16');
export const found: string[] = findReferences('See Rom 8:28.').map((match) => formatReference(match.reference));

export async function mount(root: HTMLElement) {
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, 'Reading John 3:16 today.');
      ctx.update(bibleConfig.key, (config) => ({ ...config, ...overrides }));
    })
    .use(commonmark)
    .use(bible)
    .create();
  if (reference) editor.action(callCommand(insertBiblePassageCommand.key, { reference, translation: 'BSB' }));
  return editor;
}
`,

  'src/crepe.ts': `
import { Crepe } from '@milkdown/crepe';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';
import { bible, bibleMenuItem } from 'milkdown-plugin-bible';
import 'milkdown-plugin-bible/style.css';

export async function mount(root: HTMLElement) {
  const crepe = new Crepe({
    root,
    defaultValue: 'Reading John 3:16 today.\\n\\nRom 5:8\\n',
    featureConfigs: {
      [Crepe.Feature.BlockEdit]: {
        buildMenu: (builder) => {
          builder.addGroup('bible', 'Bible').addItem('passage', bibleMenuItem);
        },
      },
    },
  });
  crepe.editor.use(bible);
  await crepe.create();
  return crepe;
}
`,

  'src/main.ts': `
import { mount as mountCrepe } from './crepe.js';
import { mount as mountPlain } from './plain.js';

await mountCrepe(document.querySelector<HTMLElement>('#crepe')!);
await mountPlain(document.querySelector<HTMLElement>('#plain')!);
document.documentElement.dataset.ready = 'true';
`,

  // What a Vite app has: declarations for stylesheet imports.
  'src/env.d.ts': `/// <reference types="vite/client" />
`,

  'index.html': `<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>consumer</title></head>
  <body>
    <div id="crepe"></div>
    <div id="plain"></div>
    <script type="module" src="./src/main.ts"></script>
  </body>
</html>
`,

  'tsconfig.json': JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        strict: true,
        skipLibCheck: true,
        noEmit: true,
      },
      include: ['src'],
    },
    null,
    2,
  ),

  // Node's own resolution rules are stricter about a package's type
  // declarations. Milkdown's own don't resolve under them, so this checks the
  // part of the API that doesn't involve the editor.
  'src/node.ts': `
import { findReferences, helloaoProvider, loadPassage, parseReference, type BiblePassage, type ReferenceMatch } from 'milkdown-plugin-bible';

export const matches: ReferenceMatch[] = findReferences('See Rom 8:28.');
export function load(): Promise<BiblePassage> {
  return loadPassage(helloaoProvider({ baseUrl: '/bible' }), parseReference('John 3:16')!, 'BSB');
}
`,
  'tsconfig.nodenext.json': JSON.stringify(
    {
      extends: './tsconfig.json',
      compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext' },
      include: ['src/node.ts'],
    },
    null,
    2,
  ),

  // The package loaded by Node itself, with no bundler and no DOM.
  'node-check.mjs': `
import { BOOKS, findReferences, formatReference, parseReference } from 'milkdown-plugin-bible';
import assert from 'node:assert/strict';

assert.equal(BOOKS.length, 66);
assert.equal(formatReference(parseReference('1 cor 13 4-7')), '1 Corinthians 13:4–7');
assert.deepEqual(findReferences('Ps 23, John 45:3 and Rom 8:28.').map((match) => match.text), ['Ps 23', 'Rom 8:28']);
`,
};

try {
  const tarball = step('pack', () => {
    const [packed] = JSON.parse(run(`npm pack --json --pack-destination "${dir}"`, root));
    return join(dir, packed.filename);
  });

  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), content.trimStart());
  }

  step('install', () =>
    run(`npm install --no-audit --no-fund "${tarball}" @milkdown/kit @milkdown/crepe typescript vite`),
  );
  step('type-check (bundler resolution)', () => run('npx tsc -p tsconfig.json'));
  step('type-check (NodeNext resolution)', () => run('npx tsc -p tsconfig.nodenext.json'));
  step('load in Node', () => run('node node-check.mjs'));
  step('bundle with Vite', () => run('npx vite build'));

  const assets = readdirSync(join(dir, 'dist', 'assets'));
  if (!assets.some((name) => name.endsWith('.css'))) throw new Error('The build produced no stylesheet.');
  console.log(`\nThe packed package works in a fresh project${keep ? `: ${dir}` : '.'}`);
} catch (error) {
  console.log('FAILED');
  console.error(error.stdout || '', error.stderr || '', error.message);
  process.exitCode = 1;
} finally {
  if (!keep) rmSync(dir, { recursive: true, force: true });
}
