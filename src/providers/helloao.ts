import { isBookId } from '../books.js';
import {
  BibleError,
  type BibleChapter,
  type BibleLine,
  type BibleProvider,
  type BibleTranslation,
  type BibleVerse,
} from '../provider.js';

/**
 * Public-domain English translations served by the Free Use Bible API.
 * Any translation id from https://bible.helloao.org/api/available_translations.json works.
 */
export const HELLOAO_TRANSLATIONS: readonly BibleTranslation[] = [
  { id: 'BSB', label: 'BSB', name: 'Berean Standard Bible' },
  { id: 'ENGWEBP', label: 'WEB', name: 'World English Bible' },
  { id: 'eng_kjv', label: 'KJV', name: 'King James Version' },
  { id: 'eng_asv', label: 'ASV', name: 'American Standard Version' },
];

export interface HelloaoOptions {
  /** Default `https://bible.helloao.org/api`. Point it at your own mirror or proxy. */
  baseUrl?: string;
  translations?: readonly BibleTranslation[];
  fetch?: typeof globalThis.fetch;
}

type VerseContent =
  | string
  | { text: string; poem?: number }
  | { heading: string }
  | { lineBreak: true }
  | { noteId: number };

type ChapterContent =
  | { type: 'heading'; content: string[] }
  | { type: 'line_break' }
  | { type: 'hebrew_subtitle'; content: VerseContent[] }
  | { type: 'verse'; number: number; content: VerseContent[] };

interface ChapterResponse {
  chapter: { number: number; content: ChapterContent[] };
}

function tidy(text: string) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/ ([,.;:!?”)\]])/g, '$1')
    .trim();
}

function readVerse(number: number, content: VerseContent[]): BibleVerse & { marksParagraph: boolean } {
  const lines: BibleLine[] = [];
  let poetry = false;
  let breakNext = true;

  for (const item of content) {
    if (typeof item === 'string' || 'text' in item) {
      const isPoem = typeof item !== 'string' && item.poem !== undefined;
      const text = typeof item === 'string' ? item : item.text;
      poetry ||= isPoem;
      const last = lines[lines.length - 1];
      // Footnote markers split a line into pieces; only poem lines and breaks start a new one.
      if (last && !isPoem && !breakNext) last.text += ` ${text}`;
      else lines.push({ text, indent: isPoem ? Math.max(0, (item as { poem: number }).poem - 1) : 0 });
      breakNext = false;
    } else if ('lineBreak' in item) {
      breakNext = true;
    }
  }

  // The King James text marks paragraphs with a pilcrow at the start of the verse.
  const first = lines[0];
  const marksParagraph = Boolean(first && /^\s*¶/.test(first.text));
  if (first && marksParagraph) first.text = first.text.replace(/^\s*¶\s*/, '');

  const tidied = lines.map((line) => ({ ...line, text: tidy(line.text) })).filter((line) => line.text);
  return {
    number,
    text: tidy(tidied.map((line) => line.text).join(' ')),
    ...(poetry ? { lines: tidied } : {}),
    marksParagraph,
  };
}

/** Converts a chapter from the Free Use Bible API's standard JSON format. */
export function readHelloaoChapter(
  data: unknown,
  request: { book: BibleChapter['book']; chapter: number; translation: string },
): BibleChapter {
  const content = (data as ChapterResponse | undefined)?.chapter?.content;
  if (!Array.isArray(content)) throw new BibleError('failed', 'The Bible service sent something unexpected.');

  const verses: BibleVerse[] = [];
  let paragraph = true;
  let heading: string | undefined;

  for (const item of content) {
    if (item.type === 'line_break') {
      paragraph = true;
    } else if (item.type === 'heading') {
      heading = tidy(item.content.join(' '));
      paragraph = true;
    } else if (item.type === 'verse') {
      const { marksParagraph, ...verse } = readVerse(item.number, item.content);
      if (!verse.text) continue;
      if (paragraph || marksParagraph) verse.paragraph = true;
      if (heading) verse.heading = heading;
      verses.push(verse);
      paragraph = false;
      heading = undefined;
    }
  }

  return { book: request.book, chapter: request.chapter, translation: request.translation, verses };
}

/**
 * Passage text from the Free Use Bible API (https://bible.helloao.org): no key,
 * no rate limit, and it allows requests from browsers.
 */
export function helloaoProvider(options: HelloaoOptions = {}): BibleProvider {
  const baseUrl = (options.baseUrl ?? 'https://bible.helloao.org/api').replace(/\/+$/, '');
  const translations = options.translations ?? HELLOAO_TRANSLATIONS;

  return {
    translations,
    async getChapter({ book, chapter, translation, signal }) {
      if (!isBookId(book) || !Number.isInteger(chapter) || chapter < 1) {
        throw new BibleError('not-found', 'That chapter doesn’t exist.');
      }
      const doFetch = options.fetch ?? globalThis.fetch;
      const url = `${baseUrl}/${encodeURIComponent(translation)}/${book}/${chapter}.json`;
      const response = await doFetch(url, { signal });
      if (response.status === 404) {
        throw new BibleError('not-found', 'That chapter isn’t in this translation.');
      }
      if (!response.ok) throw new BibleError('failed', `The Bible service answered ${response.status}.`);
      return readHelloaoChapter(await response.json(), { book, chapter, translation });
    },
  };
}
