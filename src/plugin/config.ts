import type { BibleProvider, BibleTranslation } from '../provider.js';
import { helloaoProvider } from '../providers/helloao.js';

/** Every piece of text the plugin shows. Replace any of it to translate the UI. */
export interface BibleLabels {
  insert: string;
  copy: string;
  copied: string;
  showChapter: string;
  showPassage: string;
  close: string;
  retry: string;
  loading: string;
  translation: string;
  /** Shown beside a reference on a line of its own. */
  insertHint: string;
  pickerLabel: string;
  pickerPlaceholder: string;
  pickerEmpty: string;
  pickerNoMatch: string;
  /** Shown once a book is chosen. `{book}` is replaced by its name. */
  pickerChapterHint: string;
  /** Under the search box once it holds a reference. */
  pickerInsertHint: string;
}

export const defaultLabels: BibleLabels = {
  insert: 'Insert passage',
  copy: 'Copy',
  copied: 'Copied',
  showChapter: 'Whole chapter',
  showPassage: 'Just the passage',
  close: 'Close',
  retry: 'Try again',
  loading: 'Loading passage',
  translation: 'Translation',
  insertHint: 'Tab to insert the passage',
  pickerLabel: 'Bible reference',
  pickerPlaceholder: 'John 3:16, Ps 23, Rom 8:28–30',
  pickerEmpty: 'Type a book, chapter and verse.',
  pickerNoMatch: 'No book or passage matches that.',
  pickerChapterHint: 'Add a chapter, like {book} 1, or a verse, like {book} 1:1.',
  pickerInsertHint: 'Enter to insert',
};

export interface BibleConfig {
  /** Where passage text comes from. Defaults to the Free Use Bible API. */
  provider: BibleProvider;
  /**
   * Translation to show, by id or label. Pass a function to read it from
   * somewhere shared, so several editors follow one preference.
   */
  translation: string | (() => string);
  /** Called when the reader picks another translation in the popover. */
  onTranslationChange?: (translation: BibleTranslation) => void;
  /** Milliseconds the pointer rests on a reference before its passage opens. */
  hoverDelay: number;
  /** Most chapters one passage may span. */
  maxChapters: number;
  /** Number the verses of inserted passages that have more than one. */
  verseNumbers: boolean;
  /** The last line of an inserted passage. */
  citation: (reference: string, translation: BibleTranslation) => string;
  /**
   * Keys, in ProseMirror keymap syntax; `null` turns one off. `preview` opens
   * the passage for the reference at the cursor. `insert` replaces a
   * reference that has a line to itself with its passage.
   */
  keys: { preview: string | null; insert: string | null };
  /** Element the popover is added to. Defaults to the editor's parent. */
  root?: HTMLElement | null;
  labels: BibleLabels;
}

export const defaultConfig: BibleConfig = {
  provider: helloaoProvider(),
  translation: 'BSB',
  hoverDelay: 350,
  maxChapters: 3,
  verseNumbers: true,
  citation: (reference, translation) => `— ${reference} (${translation.label})`,
  keys: { preview: 'Mod-Enter', insert: 'Tab' },
  labels: defaultLabels,
};

export function currentTranslation(config: BibleConfig): string {
  return typeof config.translation === 'function' ? config.translation() : config.translation;
}
