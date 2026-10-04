import {
  NUMBERED_ALIASES,
  NUMBER_WORDS,
  UNNUMBERED_ALIASES,
  getBook,
  type BibleBook,
  type BookId,
} from './books.js';

/**
 * A run of verses or whole chapters within one book.
 * `verse` and `endVerse` are both set, or both left out for whole chapters.
 */
export interface VerseRange {
  chapter: number;
  verse?: number;
  endChapter: number;
  endVerse?: number;
}

/** One book and the parts of it being cited, e.g. Romans 8:28; 12:1–2. */
export interface BibleReference {
  book: BookId;
  ranges: VerseRange[];
}

export interface ReferenceMatch {
  /** Where the reference starts in the searched text. */
  index: number;
  /** Where it ends (exclusive). */
  end: number;
  text: string;
  reference: BibleReference;
  /** Translation named in parentheses right after it, e.g. `ESV` in "John 3:16 (ESV)". */
  version?: string;
}

export interface ParseOptions {
  /**
   * Accept what people type into a search box: any capitalisation, "jn3:16",
   * "john 3 16", "john 3.16". Off by default, because running text needs the
   * stricter rules to avoid marking ordinary words as references.
   */
  loose?: boolean;
}

const SPACES = ' \u00a0';
const DASHES = '-\u2010\u2011\u2012\u2013\u2014\u2212';
const WORD_CHAR = /[\p{L}\p{N}_]/u;

function alternatives(aliases: ReadonlyMap<string, unknown>) {
  return [...aliases.keys()]
    .sort((a, b) => b.length - a.length)
    .map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[ \\u00a0]+'))
    .join('|');
}

// Groups: 1 book number, 2 spacing after it, 3 numbered book, 4 unnumbered book.
const BOOK_PATTERN =
  `(?:(1st|2nd|3rd|first|second|third|iii|ii|i|[123])([ \\u00a0]*)(${alternatives(NUMBERED_ALIASES)})` +
  `|(${alternatives(UNNUMBERED_ALIASES)}))(?![\\p{L}_])\\.?`;

const BOOK_AHEAD = new RegExp(BOOK_PATTERN, 'iuy');

function isDigit(char: string | undefined) {
  return char !== undefined && char >= '0' && char <= '9';
}

function isWordChar(char: string | undefined) {
  return char !== undefined && WORD_CHAR.test(char);
}

function skipSpaces(text: string, pos: number, max = 2) {
  let end = pos;
  while (end - pos < max && SPACES.includes(text[end] ?? '\n')) end++;
  return end;
}

/** A chapter or verse number: one to three digits. */
function readNumber(text: string, pos: number) {
  let end = pos;
  while (isDigit(text[end])) end++;
  if (end === pos || end - pos > 3) return null;
  return { value: Number(text.slice(pos, end)), end };
}

function versesIn(book: BibleBook, chapter: number) {
  return book.verses[chapter - 1] ?? 0;
}

/** Position of the verse number if a chapter-verse separator starts at `pos`, else -1. */
function verseSeparator(text: string, pos: number, loose: boolean) {
  const char = text[pos];
  if (char === ':' && isDigit(text[pos + 1])) return pos + 1;
  if (!loose) return -1;
  if (char === ':' || char === '.') {
    const next = skipSpaces(text, pos + 1);
    return isDigit(text[next]) ? next : -1;
  }
  const next = skipSpaces(text, pos);
  if (next === pos) return -1;
  if (isDigit(text[next])) return next;
  const word = /^v{1,2}\.?[ \u00a0]*(?=\d)/i.exec(text.slice(next, next + 6));
  return word ? next + word[0].length : -1;
}

/** Position of the number after a dash at `pos` ("16-18", "16 – 18"), else -1. */
function rangeDash(text: string, pos: number) {
  let next = SPACES.includes(text[pos] ?? '\n') ? pos + 1 : pos;
  if (!DASHES.includes(text[next] ?? '\n')) return -1;
  next++;
  if (SPACES.includes(text[next] ?? '\n')) next++;
  return isDigit(text[next]) ? next : -1;
}

/** Skips a part-of-verse letter such as the "a" in "16a". */
function skipVersePart(text: string, pos: number) {
  return /[a-c]/.test(text[pos] ?? '') && !isWordChar(text[pos + 1]) ? pos + 1 : pos;
}

function startsBook(text: string, pos: number) {
  BOOK_AHEAD.lastIndex = pos;
  const match = BOOK_AHEAD.exec(text);
  if (!match) return false;
  return isDigit(text[skipSpaces(text, pos + match[0].length)]);
}

/** One verse or verse range starting at `pos`, which must follow `after` in `chapter`. */
function scanVerseItem(text: string, pos: number, book: BibleBook, chapter: number, after: number) {
  const verse = readNumber(text, pos);
  const count = versesIn(book, chapter);
  if (!verse || verse.value < 1 || verse.value > count || verse.value <= after) return null;

  let end = skipVersePart(text, verse.end);
  const single: VerseRange = { chapter, verse: verse.value, endChapter: chapter, endVerse: verse.value };

  if (isWordChar(text[end])) {
    // "16ff" runs to the end of the chapter, "16f" takes in the next verse.
    if (text.startsWith('ff', end) && !isWordChar(text[end + 2])) {
      return { range: { ...single, endVerse: count }, end: end + 2 };
    }
    if (text[end] === 'f' && !isWordChar(text[end + 1])) {
      return { range: { ...single, endVerse: Math.min(verse.value + 1, count) }, end: end + 1 };
    }
    return null;
  }

  const dash = rangeDash(text, end);
  const last = dash === -1 ? null : readNumber(text, dash);
  if (last) {
    const crossChapter = verseSeparator(text, last.end, false);
    if (crossChapter !== -1) {
      const lastVerse = readNumber(text, crossChapter);
      if (lastVerse && last.value > chapter && lastVerse.value >= 1 && lastVerse.value <= versesIn(book, last.value)) {
        end = skipVersePart(text, lastVerse.end);
        if (!isWordChar(text[end])) {
          return { range: { ...single, endChapter: last.value, endVerse: lastVerse.value }, end };
        }
      }
    } else if (last.value > verse.value && last.value <= count) {
      end = skipVersePart(text, last.end);
      if (!isWordChar(text[end])) return { range: { ...single, endVerse: last.value }, end };
    }
    end = skipVersePart(text, verse.end);
  }

  return { range: single, end };
}

/**
 * Verses starting at `pos`, then any that continue the list: ", 18" (same
 * chapter), ", 4:2" and "; 4:2" (another chapter). Stops before anything that
 * doesn't fit. Returns where the list ends, or -1 if it has no valid start.
 */
function scanVerses(text: string, pos: number, book: BibleBook, chapter: number, ranges: VerseRange[]) {
  let current = chapter;
  let after = 0;
  let end = -1;

  for (;;) {
    const item = scanVerseItem(text, pos, book, current, after);
    if (!item) return end;
    ranges.push(item.range);
    end = item.end;
    current = item.range.endChapter;
    after = item.range.endVerse!;

    const separator = text[end];
    if (separator !== ',' && separator !== ';') return end;
    const next = skipSpaces(text, end + 1);
    const number = readNumber(text, next);
    if (!number || startsBook(text, next)) return end;

    const verseStart = verseSeparator(text, number.end, false);
    if (verseStart !== -1) {
      if (versesIn(book, number.value) === 0) return end;
      current = number.value;
      after = 0;
      pos = verseStart;
    } else if (separator === ',') {
      pos = next;
    } else {
      return end;
    }
  }
}

function scanRanges(text: string, pos: number, book: BibleBook, loose: boolean) {
  const first = readNumber(text, pos);
  if (!first) return null;

  const ranges: VerseRange[] = [];
  const singleChapter = book.verses.length === 1;
  const verseStart = verseSeparator(text, first.end, loose);

  if (verseStart !== -1) {
    if (versesIn(book, first.value) === 0) return null;
    const end = scanVerses(text, verseStart, book, first.value, ranges);
    return end === -1 ? null : { ranges, end };
  }

  // In a one-chapter book a lone number is a verse: "Jude 5". "Jude 1" is the chapter.
  if (singleChapter) {
    const listFollows = rangeDash(text, first.end) !== -1 || /^,[ \u00a0]{0,2}\d/.test(text.slice(first.end, first.end + 4));
    if (first.value !== 1 || listFollows) {
      const end = scanVerses(text, pos, book, 1, ranges);
      return end === -1 ? null : { ranges, end };
    }
  }

  if (versesIn(book, first.value) === 0) return null;
  // "John 3rd", "Mark 2.5", "Acts 5%" are not chapters.
  if (isWordChar(text[first.end]) || text[first.end] === '%') return null;
  if (text[first.end] === '.' && isDigit(text[first.end + 1])) return null;

  const dash = rangeDash(text, first.end);
  const last = dash === -1 ? null : readNumber(text, dash);
  if (
    last &&
    last.value > first.value &&
    versesIn(book, last.value) > 0 &&
    !isWordChar(text[last.end]) &&
    text[last.end] !== ':'
  ) {
    return { ranges: [{ chapter: first.value, endChapter: last.value }], end: last.end };
  }
  return { ranges: [{ chapter: first.value, endChapter: first.value }], end: first.end };
}

const VERSION_AFTER = /^[ \u00a0]?\(([A-Za-z][A-Za-z0-9]{1,9})\)/;

/** Finds every Bible reference in a piece of text. */
export function findReferences(text: string, options: ParseOptions = {}): ReferenceMatch[] {
  const loose = options.loose ?? false;
  const matches: ReferenceMatch[] = [];
  const pattern = new RegExp(BOOK_PATTERN, 'giu');

  let found: RegExpExecArray | null;
  while ((found = pattern.exec(text))) {
    const retry = () => {
      pattern.lastIndex = found!.index + 1;
    };
    if (isWordChar(text[found.index - 1])) {
      retry();
      continue;
    }

    const [whole, numberWord, numberGap, numberedName, plainName] = found;
    const name = numberedName ?? plainName!;
    const alias = (numberedName ? NUMBERED_ALIASES : UNNUMBERED_ALIASES).get(
      name.toLowerCase().replace(/[ \u00a0]+/g, ' '),
    );
    const number = numberWord ? NUMBER_WORDS[numberWord.toLowerCase()] : undefined;
    const bookId = alias?.books[(number ?? 1) - 1];
    if (!alias || !bookId) {
      retry();
      continue;
    }

    let needsVerse = alias.needsVerse;
    if (numberWord) {
      const digits = isDigit(numberWord[0]) && numberWord.length === 1;
      const roman = /^i+$/i.test(numberWord);
      // "1John" is fine, but "I John" and "First John" need the space.
      if (!digits && numberGap === '') {
        retry();
        continue;
      }
      if (!loose && roman && numberWord !== numberWord.toUpperCase()) {
        retry();
        continue;
      }
    }
    // Names written in lower case ("john 3:16") only count with a verse.
    if (!/^\p{Lu}/u.test(name)) needsVerse = true;

    const afterName = found.index + whole.length;
    const start = skipSpaces(text, afterName);
    const spaced = start > afterName || whole.endsWith('.');
    if ((!loose && !spaced) || !isDigit(text[start])) {
      retry();
      continue;
    }

    const scanned = scanRanges(text, start, getBook(bookId), loose);
    if (!scanned || (!loose && needsVerse && scanned.ranges[0]!.verse === undefined)) {
      retry();
      continue;
    }

    const version = VERSION_AFTER.exec(text.slice(scanned.end, scanned.end + 14))?.[1];
    matches.push({
      index: found.index,
      end: scanned.end,
      text: text.slice(found.index, scanned.end),
      reference: { book: bookId, ranges: scanned.ranges },
      ...(version ? { version } : {}),
    });
    pattern.lastIndex = scanned.end;
  }

  return matches;
}

/**
 * Reads a whole string as one reference, or returns null. Loose by default,
 * since this is for text someone typed as a reference.
 */
export function parseReference(text: string, options: ParseOptions = {}): BibleReference | null {
  const trimmed = text.trim();
  const [match] = findReferences(trimmed, { loose: options.loose ?? true });
  if (!match || match.index !== 0 || match.end !== trimmed.length) return null;
  return match.reference;
}

/**
 * Writes a reference the usual way: "John 3:16–18", "Romans 8:28; 12:1–2",
 * "Psalm 23", "Jude 5". `parseReference` reads the result back unchanged.
 */
export function formatReference(reference: BibleReference): string {
  const book = getBook(reference.book);
  const singleChapter = book.verses.length === 1;
  const name = reference.book === 'PSA' && referenceChapters(reference).length === 1 ? 'Psalm' : book.name;

  let text = '';
  let context: number | undefined;
  for (const range of reference.ranges) {
    if (range.verse === undefined) {
      text += text ? '; ' : '';
      text += range.endChapter === range.chapter ? `${range.chapter}` : `${range.chapter}–${range.endChapter}`;
      context = undefined;
      continue;
    }

    const sameChapter = context === range.chapter;
    if (text) text += sameChapter ? ', ' : '; ';
    if (!sameChapter && !singleChapter) text += `${range.chapter}:`;
    text += `${range.verse}`;
    if (range.endChapter !== range.chapter) text += `–${range.endChapter}:${range.endVerse}`;
    else if (range.endVerse !== range.verse) text += `–${range.endVerse}`;
    context = range.endChapter;
  }

  return `${name} ${text}`;
}

/** The chapters a reference touches, in order and without repeats. */
export function referenceChapters(reference: BibleReference): number[] {
  const chapters = new Set<number>();
  for (const range of reference.ranges) {
    for (let chapter = range.chapter; chapter <= range.endChapter; chapter++) chapters.add(chapter);
  }
  return [...chapters].sort((a, b) => a - b);
}

/** Whether a verse falls inside a reference. */
export function referenceIncludes(reference: BibleReference, chapter: number, verse: number): boolean {
  return reference.ranges.some((range) => {
    if (chapter < range.chapter || chapter > range.endChapter) return false;
    if (range.verse === undefined) return true;
    if (chapter === range.chapter && verse < range.verse) return false;
    if (chapter === range.endChapter && verse > range.endVerse!) return false;
    return true;
  });
}
