// The plugin inside Crepe, with each of Crepe's themes: `npm run dev`.
import { Crepe } from '@milkdown/crepe';
import '@milkdown/crepe/theme/common/style.css';
import { bible, bibleConfig, bibleMenuItem } from '../src/index.js';
import '../src/style.css';
import { sample, shared } from './sample.js';

const themes = {
  frame: () => import('@milkdown/crepe/theme/frame.css'),
  'frame-dark': () => import('@milkdown/crepe/theme/frame-dark.css'),
  nord: () => import('@milkdown/crepe/theme/nord.css'),
  'nord-dark': () => import('@milkdown/crepe/theme/nord-dark.css'),
  classic: () => import('@milkdown/crepe/theme/classic.css'),
  'classic-dark': () => import('@milkdown/crepe/theme/classic-dark.css'),
};

const requested = new URLSearchParams(location.search).get('theme') ?? 'frame';
const theme = (requested in themes ? requested : 'frame') as keyof typeof themes;
if (theme.endsWith('-dark')) document.documentElement.dataset.dark = '';
await themes[theme]();

const crepe = new Crepe({
  root: '#crepe',
  defaultValue: sample,
  featureConfigs: {
    [Crepe.Feature.BlockEdit]: {
      buildMenu: (builder) => {
        builder.addGroup('bible', 'Bible').addItem('passage', bibleMenuItem);
      },
    },
  },
});
crepe.editor
  .config((ctx) => {
    ctx.update(bibleConfig.key, (config) => ({ ...config, ...shared }));
  })
  .use(bible);
await crepe.create();