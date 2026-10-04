import { VERSE_COUNTS } from './data/versification.js';

// prettier-ignore
export const BOOK_IDS = [
  'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA', '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH',
  'EST', 'JOB', 'PSA', 'PRO', 'ECC', 'SNG', 'ISA', 'JER', 'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO', 'OBA', 'JON',
  'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL', 'MAT', 'MRK', 'LUK', 'JHN', 'ACT', 'ROM', '1CO', '2CO', 'GAL',
  'EPH', 'PHP', 'COL', '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAS', '1PE', '2PE', '1JN', '2JN', '3JN',
  'JUD', 'REV',
] as const;

/** USFM book code, e.g. `JHN` or `1CO`. */
export type BookId = (typeof BOOK_IDS)[number];

export interface BibleBook {
  id: BookId;
  /** English name, e.g. `1 Corinthians`. */
  name: string;
  /** Position in the canon, starting at 1. */
  order: number;
  /** 1, 2 or 3 for numbered books such as `2 Kings`. */
  number?: 1 | 2 | 3;
  /** Verses in each chapter; `verses[0]` is chapter 1. */
  verses: readonly number[];
}

/**
 * How a book can be written. `names` may stand alone with just a chapter
 * ("Gen 1"). `short` forms double as ordinary words or first names ("Dan",
 * "Song"), so in running text they only count when a verse follows
 * ("Dan 3:16").
 */
interface BookSpelling {
  id: BookId;
  name: string;
  names?: string;
  short?: string;
}

// For numbered books the spellings leave the number off; it is matched separately.
const SPELLINGS: BookSpelling[] = [
  { id: 'GEN', name: 'Genesis', names: 'Gen', short: 'Ge Gn' },
  { id: 'EXO', name: 'Exodus', names: 'Exod', short: 'Exo Ex' },
  { id: 'LEV', name: 'Leviticus', names: 'Lev', short: 'Lv Le' },
  { id: 'NUM', name: 'Numbers', short: 'Num Nm Nu' },
  { id: 'DEU', name: 'Deuteronomy', names: 'Deut', short: 'Deu Dt' },
  { id: 'JOS', name: 'Joshua', short: 'Josh Jos' },
  { id: 'JDG', name: 'Judges', names: 'Judg', short: 'Jdg Jgs Jg' },
  { id: 'RUT', name: 'Ruth', short: 'Rth Ru' },
  { id: '1SA', name: 'Samuel', names: 'Sam', short: 'Sa Sm' },
  { id: '1KI', name: 'Kings', names: 'Kgs', short: 'Kin Ki' },
  { id: '1CH', name: 'Chronicles', names: 'Chron Chr', short: 'Ch' },
  { id: 'EZR', name: 'Ezra', short: 'Ezr' },
  { id: 'NEH', name: 'Nehemiah', names: 'Neh', short: 'Ne' },
  { id: 'EST', name: 'Esther', names: 'Esth', short: 'Est Es' },
  { id: 'JOB', name: 'Job', short: 'Jb' },
  { id: 'PSA', name: 'Psalms', names: 'Psalm Psa Pss Ps', short: 'Pslm Psm' },
  { id: 'PRO', name: 'Proverbs', names: 'Prov', short: 'Pro Prv Pr' },
  { id: 'ECC', name: 'Ecclesiastes', names: 'Eccles Eccl Ecc', short: 'Ec Qoh' },
  { id: 'SNG', name: 'Song of Solomon', names: 'Song of Songs|Canticles', short: 'Song|Songs|SoS|Cant|Sg' },
  { id: 'ISA', name: 'Isaiah', names: 'Isa' },
  { id: 'JER', name: 'Jeremiah', short: 'Jer Je Jr' },
  { id: 'LAM', name: 'Lamentations', short: 'Lam La' },
  { id: 'EZK', name: 'Ezekiel', names: 'Ezek', short: 'Eze Ezk' },
  { id: 'DAN', name: 'Daniel', short: 'Dan Dn Da' },
  { id: 'HOS', name: 'Hosea', names: 'Hos', short: 'Ho' },
  { id: 'JOL', name: 'Joel', short: 'Jl' },
  { id: 'AMO', name: 'Amos', short: 'Amo' },
  { id: 'OBA', name: 'Obadiah', names: 'Obad', short: 'Oba Ob' },
  { id: 'JON', name: 'Jonah', short: 'Jon Jnh' },
  { id: 'MIC', name: 'Micah', short: 'Mic' },
  { id: 'NAM', name: 'Nahum', names: 'Nah', short: 'Nam Na' },
  { id: 'HAB', name: 'Habakkuk', short: 'Hab Hb' },
  { id: 'ZEP', name: 'Zephaniah', names: 'Zeph', short: 'Zep Zp' },
  { id: 'HAG', name: 'Haggai', short: 'Hag Hg' },
  { id: 'ZEC', name: 'Zechariah', names: 'Zech', short: 'Zec Zc' },
  { id: 'MAL', name: 'Malachi', short: 'Mal Ml' },
  { id: 'MAT', name: 'Matthew', names: 'Matt', short: 'Mat Mt' },
  { id: 'MRK', name: 'Mark', short: 'Mrk Mk Mr' },
  { id: 'LUK', name: 'Luke', short: 'Luk Lk Lu' },
  { id: 'JHN', name: 'John', short: 'Jhn Joh Jn' },
  { id: 'ACT', name: 'Acts', names: 'Acts of the Apostles', short: 'Act Ac' },
  { id: 'ROM', name: 'Romans', names: 'Rom', short: 'Ro Rm' },
  { id: '1CO', name: 'Corinthians', names: 'Cor', short: 'Co' },
  { id: 'GAL', name: 'Galatians', short: 'Gal Ga' },
  { id: 'EPH', name: 'Ephesians', names: 'Ephes Eph', short: 'Ep' },
  { id: 'PHP', name: 'Philippians', short: 'Phil Php Pp' },
  { id: 'COL', name: 'Colossians', short: 'Col' },
  { id: '1TH', name: 'Thessalonians', names: 'Thess Thes', short: 'Th' },
  { id: '1TI', name: 'Timothy', names: 'Tim', short: 'Ti Tm' },
  { id: 'TIT', name: 'Titus', short: 'Tit' },
  { id: 'PHM', name: 'Philemon', names: 'Philem Phlm', short: 'Phm' },
  { id: 'HEB', name: 'Hebrews', names: 'Heb' },
  { id: 'JAS', name: 'James', short: 'Jas Jm' },
  { id: '1PE', name: 'Peter', names: 'Pet', short: 'Pe Pt' },
  { id: '1JN', name: 'John', names: 'Jhn Joh Jn' },
  { id: 'JUD', name: 'Jude', short: 'Jud Jd' },
  { id: 'REV', name: 'Revelation', names: 'Revelations Rev', short: 'Rv Re' },
];

/** Numbered book families: the id of each family's books by number. */
const NUMBERED: Record<string, BookId[]> = {
  '1SA': ['1SA', '2SA'],
  '1KI': ['1KI', '2KI'],
  '1CH': ['1CH', '2CH'],
  '1CO': ['1CO', '2CO'],
  '1TH': ['1TH', '2TH'],
  '1TI': ['1TI', '2TI'],
  '1PE': ['1PE', '2PE'],
  '1JN': ['1JN', '2JN', '3JN'],
};

function list(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(value.includes('|') ? '|' : ' ');
}

const byId = new Map<BookId, BibleBook>();
for (const spelling of SPELLINGS) {
  const family = NUMBERED[spelling.id];
  if (!family) {
    byId.set(spelling.id, { id: spelling.id, name: spelling.name, order: 0, verses: VERSE_COUNTS[spelling.id]! });
    continue;
  }
  family.forEach((id, index) => {
    const number = (index + 1) as 1 | 2 | 3;
    byId.set(id, { id, name: `${number} ${spelling.name}`, order: 0, number, verses: VERSE_COUNTS[id]! });
  });
}

/** The 66 books of the Protestant canon, in order. */
export const BOOKS: readonly BibleBook[] = BOOK_IDS.map((id, index) => {
  const book = byId.get(id)!;
  book.order = index + 1;
  return book;
});

export function getBook(id: BookId): BibleBook {
  return byId.get(id)!;
}

export function isBookId(value: unknown): value is BookId {
  return typeof value === 'string' && byId.has(value as BookId);
}

export interface BookAlias {
  /** Lower-case spelling without any book number, e.g. `cor`. */
  key: string;
  /** Books this spelling names, by number. Unnumbered books sit at index 0. */
  books: BookId[];
  numbered: boolean;
  /** Needs a verse after it to count as a reference in running text. */
  needsVerse: boolean;
}

function aliasKey(spelling: string) {
  return spelling.toLowerCase();
}

const unnumbered = new Map<string, BookAlias>();
const numbered = new Map<string, BookAlias>();

for (const spelling of SPELLINGS) {
  const family = NUMBERED[spelling.id];
  const target = family ? numbered : unnumbered;
  const add = (text: string, needsVerse: boolean) => {
    target.set(aliasKey(text), {
      key: aliasKey(text),
      books: family ?? [spelling.id],
      numbered: Boolean(family),
      needsVerse,
    });
  };
  add(spelling.name, false);
  list(spelling.names).forEach((text) => add(text, false));
  // After a book number ("1 Co 13") even the shortest forms are unambiguous.
  list(spelling.short).forEach((text) => add(text, !family));
}

export const UNNUMBERED_ALIASES: ReadonlyMap<string, BookAlias> = unnumbered;
export const NUMBERED_ALIASES: ReadonlyMap<string, BookAlias> = numbered;

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[.\u00a0]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const NUMBER_WORDS: Readonly<Record<string, 1 | 2 | 3>> = {
  '1': 1, '2': 2, '3': 3,
  i: 1, ii: 2, iii: 3,
  '1st': 1, '2nd': 2, '3rd': 3,
  first: 1, second: 2, third: 3,
};

/**
 * Books whose name or abbreviation starts with what was typed, in canon
 * order. For suggestions while someone types a reference: `"1 c"` gives
 * 1 Chronicles and 1 Corinthians.
 */
export function suggestBooks(query: string, limit = 8): BibleBook[] {
  const text = normalize(query);
  if (!text) return [];

  const prefixed = /^(1st|2nd|3rd|first|second|third|iii|ii|i|[123])\s*(.*)$/.exec(text);
  const results = new Set<BibleBook>();

  const collect = (rest: string, number: number | undefined) => {
    for (const book of BOOKS) {
      if (number !== undefined && book.number !== number) continue;
      const base = normalize(book.number ? book.name.slice(2) : book.name);
      if (base.startsWith(rest)) results.add(book);
    }
    const aliases = number === undefined ? [unnumbered, numbered] : [numbered];
    for (const map of aliases) {
      for (const alias of map.values()) {
        if (!alias.key.startsWith(rest)) continue;
        for (const id of alias.books) {
          const book = getBook(id);
          if (number === undefined || book.number === number) results.add(book);
        }
      }
    }
  };

  // "1 c" names a numbered book, but "i" alone may also be the start of "Isaiah".
  if (!prefixed || !/^[123]/.test(text)) collect(text, undefined);
  if (prefixed) collect(prefixed[2]!, NUMBER_WORDS[prefixed[1]!]);

  return [...results].sort((a, b) => a.order - b.order).slice(0, limit);
}
