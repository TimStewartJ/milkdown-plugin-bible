import { commandsCtx, editorViewCtx } from '@milkdown/kit/core';
import type { Ctx, MilkdownPlugin } from '@milkdown/kit/ctx';
import { clearTextInCurrentBlockCommand } from '@milkdown/kit/preset/commonmark';
import { Plugin } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $command, $ctx, $prose } from '@milkdown/kit/utils';
import { parseReference, type BibleReference } from '../reference.js';
import { defaultConfig, type BibleConfig } from './config.js';
import { BibleController, type ControllerHost } from './controller.js';
import { applyTransaction, bibleKey, decorationsFor, initialState, type BibleState } from './detect.js';
import { bibleIcon } from './popover.js';

const controllers = new WeakMap<EditorView, BibleController>();

/**
 * The plugin as plain ProseMirror, for editors that don't go through
 * Milkdown's context. `host` supplies the configuration each time it is needed.
 */
export function createBiblePlugin(host: ControllerHost): Plugin<BibleState> {
  return new Plugin<BibleState>({
    key: bibleKey,
    state: {
      init: (_config, state) => initialState(state.doc),
      apply: (tr, value) => applyTransaction(tr, value),
    },
    props: {
      decorations(state) {
        const { keys, labels } = host.getConfig();
        return decorationsFor(state, keys.insert ? labels.insertHint : null);
      },
      handleKeyDown: (view, event) => controllers.get(view)?.handleKeyDown(event) ?? false,
    },
    view(view) {
      const controller = new BibleController(view, host);
      controllers.set(view, controller);
      return {
        update: (_view, previous) => controller.update(previous),
        destroy: () => {
          controllers.delete(view);
          controller.destroy();
        },
      };
    },
  });
}

/** The controller behind an editor view, for driving the plugin from outside. */
export function getBibleController(view: EditorView): BibleController | undefined {
  return controllers.get(view);
}

/**
 * Configuration. Change it with
 * `ctx.update(bibleConfig.key, (config) => ({ ...config, translation: 'KJV' }))`.
 */
export const bibleConfig = $ctx<BibleConfig, 'bibleConfig'>(defaultConfig, 'bibleConfig');

/** Marks references in the text and runs the passage popover. */
export const biblePlugin = $prose((ctx) =>
  createBiblePlugin({
    getConfig: () => ctx.get(bibleConfig.key),
    setTranslation: (translation) => {
      const config = ctx.get(bibleConfig.key);
      if (typeof config.translation !== 'function') {
        ctx.update(bibleConfig.key, (previous) => ({ ...previous, translation: translation.id }));
      }
      config.onTranslationChange?.(translation);
    },
  }),
);

function controllerFrom(ctx: Ctx) {
  return controllers.get(ctx.get(editorViewCtx));
}

/** Opens the passage for the reference at the cursor and moves focus into it. */
export const showBiblePassageCommand = $command('ShowBiblePassage', (ctx) => () => () => {
  return controllerFrom(ctx)?.showAtSelection(true) ?? false;
});

/** Opens the search box for finding a passage and inserting it at the cursor. */
export const openBiblePickerCommand = $command('OpenBiblePicker', (ctx) => () => () => {
  return controllerFrom(ctx)?.openPicker() ?? false;
});

export interface InsertBiblePassagePayload {
  reference: string | BibleReference;
  /** Translation id or label. Defaults to the configured one. */
  translation?: string;
}

/**
 * Inserts a passage at the cursor. With no payload, it replaces a reference
 * that has a line to itself, which is what the insert key does.
 */
export const insertBiblePassageCommand = $command(
  'InsertBiblePassage',
  (ctx) => (payload?: string | InsertBiblePassagePayload) => () => {
    const controller = controllerFrom(ctx);
    if (!controller) return false;
    if (payload === undefined) return controller.insertAtCursor();

    const { reference, translation } = typeof payload === 'string' ? { reference: payload, translation: undefined } : payload;
    const parsed = typeof reference === 'string' ? parseReference(reference) : reference;
    if (!parsed) return false;
    controller.insertReference(parsed, translation).catch((error: unknown) => {
      console.error('[milkdown-plugin-bible] Could not insert the passage.', error);
    });
    return true;
  },
);

/**
 * An entry for Crepe's slash menu (or any menu shaped like it): clears the
 * typed "/…" and opens the passage search.
 *
 * ```ts
 * buildMenu: (builder) => builder.addGroup('bible', 'Bible').addItem('passage', bibleMenuItem)
 * ```
 */
export const bibleMenuItem = {
  label: 'Bible passage',
  icon: bibleIcon,
  onRun: (ctx: Ctx) => {
    const commands = ctx.get(commandsCtx);
    commands.call(clearTextInCurrentBlockCommand.key);
    commands.call(openBiblePickerCommand.key);
  },
};

/**
 * Everything, ready for `editor.use(bible)`: reference detection, the passage
 * popover, and the commands.
 */
export const bible: MilkdownPlugin[] = [
  bibleConfig,
  biblePlugin,
  showBiblePassageCommand,
  openBiblePickerCommand,
  insertBiblePassageCommand,
];
