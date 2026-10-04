// The plugin in a bare Milkdown editor: commonmark only, no theme, so the
// stylesheet has only the browser's own colours to work with.
import { Editor, defaultValueCtx, editorViewOptionsCtx, rootCtx } from '@milkdown/kit/core';
import { history } from '@milkdown/kit/plugin/history';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { bible, bibleConfig } from '../src/index.js';
import '../src/style.css';
import { sample, shared } from './sample.js';

if (new URLSearchParams(location.search).has('dark')) document.documentElement.dataset.dark = '';

function create(root: string, editable: boolean) {
  return Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, sample);
      ctx.set(editorViewOptionsCtx, { editable: () => editable });
      ctx.update(bibleConfig.key, (config) => ({ ...config, ...shared }));
    })
    .use(commonmark)
    .use(history)
    .use(bible)
    .create();
}

await create('#plain', true);
await create('#readonly', false);