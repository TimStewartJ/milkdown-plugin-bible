import type { BookId } from './books.js';
import { formatReference, referenceChapters, referenceIncludes, type BibleReference } from './reference.js';

export interface BibleTranslation {
  /** What the provider calls it, e.g. `eng_kjv`. */
  id: string;
  /** Short name used in citations and on the translation switch, e.g. `KJV`. */
  label: string;
  /** Full name, e.g. `King James Version`. */
  name: string;
}

/** One line of poetry. `indent` is 0 for a first line and 1 or more for lines hung under it. */
export interface BibleLine {
  text: string;
  indent: number;
}

export interface BibleVerse {
  number: number;
  /** The whole verse as running text. */
  text: string;
  /** Set for poetry: the same words, line by line. */
  lines?: BibleLine[];
  /** The verse opens a new paragraph or stanza. */
  paragraph?: boolean;
  /** Section heading printed above the verse. */
  heading?: string;
}

export interface BibleChapter {
  book: BookId;
  chapter: number;
  translation: string;
  verses: BibleVerse[];
}

export interface ChapterRequest {
  book: BookId;
  chapter: number;
  translation: string;
  signal?: AbortSignal;
}

/**
 * Where passage text comes from. Text is fetched a chapter at a time, so one
 * request serves every reference into that chapter.
 */
export interface BibleProvider {
  /** Translations offered, in the order to show them. The first is the fallback. */
  translations: readonly BibleTranslation[];
  getChapter(request: ChapterRequest): Promise<BibleChapter>;
}

export type BibleErrorCode = 'not-found' | 'too-long' | 'offline' | 'failed';

export class BibleError extends Error {
  readonly code: BibleErrorCode;

  constructor(code: BibleErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'BibleError';
    this.code = code;
  }
}

export interface PassageVerse extends BibleVerse {
  chapter: number;
}

export interface BiblePassage {
  reference: BibleReference;
  translation: BibleTranslation;
  verses: PassageVerse[];
}

/** Persistent storage for fetched chapters, e.g. IndexedDB. Failures are ignored. */
export interface ChapterStorage {
  get(key: string): Promise<BibleChapter | undefined> | BibleChapter | undefined;
  set(key: string, chapter: BibleChapter): Promise<unknown> | unknown;
}

export interface CachedBibleProvider extends BibleProvider {
  /** A chapter already in memory, without waiting. */
  peekChapter(request: ChapterRequest): BibleChapter | undefined;
}

export interface CacheOptions {
  /** Chapters kept in memory. Default 150. */
  max?: number;
  /** Keeps chapters between visits, so passages already read work offline. */
  storage?: ChapterStorage;
}

export function chapterKey(request: Pick<ChapterRequest, 'book' | 'chapter' | 'translation'>) {
  return `${request.translation}/${request.book}/${request.chapter}`;
}

function isCached(provider: BibleProvider): provider is CachedBibleProvider {
  return typeof (provider as CachedBibleProvider).peekChapter === 'function';
}

/**
 * Remembers chapters so each is fetched once, and shares one request between
 * callers that ask at the same time. The plugin wraps its provider with this
 * already; call it yourself to add persistent `storage`.
 */
export function cachedProvider(provider: BibleProvider, options: CacheOptions = {}): CachedBibleProvider {
  if (isCached(provider) && !options.storage) return provider;

  const max = options.max ?? 150;
  const { storage } = options;
  const chapters = new Map<string, BibleChapter>();
  const pending = new Map<string, Promise<BibleChapter>>();

  const remember = (key: string, chapter: BibleChapter) => {
    chapters.delete(key);
    chapters.set(key, chapter);
    if (chapters.size > max) chapters.delete(chapters.keys().next().value!);
  };

  const load = async (key: string, request: ChapterRequest) => {
    if (storage) {
      try {
        const stored = await storage.get(key);
        if (stored) return stored;
      } catch {
        // A broken store must not stop passages loading.
      }
    }
    // The request is shared, so one caller giving up must not cancel it for the rest.
    const chapter = await provider.getChapter({ ...request, signal: undefined });
    if (storage) {
      try {
        await storage.set(key, chapter);
      } catch {
        // Same as above.
      }
    }
    return chapter;
  };

  return {
    translations: provider.translations,
    peekChapter: (request) => chapters.get(chapterKey(request)),
    getChapter(request) {
      const key = chapterKey(request);
      const known = chapters.get(key);
      if (known) {
        remember(key, known);
        return Promise.resolve(known);
      }
      let loading = pending.get(key);
      if (!loading) {
        loading = load(key, request)
          .then((chapter) => {
            remember(key, chapter);
            return chapter;
          })
          .finally(() => pending.delete(key));
        pending.set(key, loading);
      }
      return loading;
    },
  };
}

export function findTranslation(provider: BibleProvider, idOrLabel: string | undefined) {
  if (!idOrLabel) return undefined;
  const wanted = idOrLabel.toLowerCase();
  return provider.translations.find(
    (translation) => translation.id.toLowerCase() === wanted || translation.label.toLowerCase() === wanted,
  );
}

/** Picks the verses a reference cites out of the chapters that hold them. */
export function passageFromChapters(
  reference: BibleReference,
  translation: BibleTranslation,
  chapters: readonly BibleChapter[],
): BiblePassage {
  const verses: PassageVerse[] = [];
  for (const chapter of chapters) {
    for (const verse of chapter.verses) {
      if (referenceIncludes(reference, chapter.chapter, verse.number)) {
        verses.push({ ...verse, chapter: chapter.chapter });
      }
    }
  }
  if (verses.length === 0) {
    throw new BibleError('not-found', `${formatReference(reference)} isn’t in the ${translation.label}.`);
  }
  return { reference, translation, verses };
}

export interface LoadOptions {
  signal?: AbortSignal;
  /** Most chapters one passage may span. Default 3. */
  maxChapters?: number;
}

export interface LoadedChapters {
  translation: BibleTranslation;
  chapters: BibleChapter[];
}

function plan(provider: BibleProvider, reference: BibleReference, translationId: string, maxChapters = 3) {
  const translation = findTranslation(provider, translationId) ?? provider.translations[0];
  if (!translation) throw new BibleError('failed', 'No Bible translation is available.');
  const chapters = referenceChapters(reference);
  if (chapters.length > maxChapters) {
    throw new BibleError(
      'too-long',
      `${formatReference(reference)} covers ${chapters.length} chapters. Choose ${maxChapters} or fewer.`,
    );
  }
  return {
    translation,
    requests: chapters.map((chapter) => ({ book: reference.book, chapter, translation: translation.id })),
  };
}

/** Fetches every chapter a reference touches. */
export async function loadChapters(
  provider: BibleProvider,
  reference: BibleReference,
  translationId: string,
  options: LoadOptions = {},
): Promise<LoadedChapters> {
  const { translation, requests } = plan(provider, reference, translationId, options.maxChapters);
  const chapters = await Promise.all(
    requests.map((request) => provider.getChapter({ ...request, signal: options.signal })),
  );
  return { translation, chapters };
}

/** The chapters a reference touches if all of them are already in memory, else undefined. */
export function peekChapters(
  provider: CachedBibleProvider,
  reference: BibleReference,
  translationId: string,
  options: LoadOptions = {},
): LoadedChapters | undefined {
  try {
    const { translation, requests } = plan(provider, reference, translationId, options.maxChapters);
    const chapters = requests.map((request) => provider.peekChapter(request));
    if (chapters.some((chapter) => !chapter)) return undefined;
    return { translation, chapters: chapters as BibleChapter[] };
  } catch {
    return undefined;
  }
}

/** The text of a reference, fetching whichever chapters it needs. */
export async function loadPassage(
  provider: BibleProvider,
  reference: BibleReference,
  translationId: string,
  options: LoadOptions = {},
): Promise<BiblePassage> {
  const { translation, chapters } = await loadChapters(provider, reference, translationId, options);
  return passageFromChapters(reference, translation, chapters);
}

/** Turns anything thrown while loading into a `BibleError` with a message fit to show. */
export function toBibleError(error: unknown): BibleError {
  if (error instanceof BibleError) return error;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return new BibleError('offline', 'You’re offline. Passages you’ve opened before still work.', { cause: error });
  }
  return new BibleError('failed', 'Couldn’t load this passage.', { cause: error });
}
