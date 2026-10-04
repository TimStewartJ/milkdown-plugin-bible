import { describe, expect, it } from 'vitest';
import { BOOKS, suggestBooks } from './books.js';
import {
  findReferences,
  formatReference,
  parseReference,
  referenceChapters,
  referenceIncludes,
  type BibleReference,
} from './reference.js';

/** The references found in running text, written back out the standard way. */
function found(text: string) {
  return findReferences(text).map((match) => formatReference(match.reference));
}

describe('findReferences', () => {
  it.each([
    ['John 3:16', 'John 3:16'],
    ['John 3:16-18', 'John 3:16–18'],
    ['John 3:16–18', 'John 3:16–18'],
    ['John 3:16 - 18', 'John 3:16–18'],
    ['John 3:16,18', 'John 3:16, 18'],
    ['John 3:16, 18-20', 'John 3:16, 18–20'],
    ['John 3:16-4:2', 'John 3:16–4:2'],
    ['John 3', 'John 3'],
    ['John 3-4', 'John 3–4'],
    ['Rom 8:28; 12:1-2', 'Romans 8:28; 12:1–2'],
    ['Rom. 8:28', 'Romans 8:28'],
    ['Gen.1:1', 'Genesis 1:1'],
    ['Genesis 1:1-2:3', 'Genesis 1:1–2:3'],
    ['Ps 23', 'Psalm 23'],
    ['Psalm 119:105', 'Psalm 119:105'],
    ['Psalms 1-2', 'Psalms 1–2'],
    ['1 Cor 13:4-7', '1 Corinthians 13:4–7'],
    ['1Cor 13', '1 Corinthians 13'],
    ['I Corinthians 13:13', '1 Corinthians 13:13'],
    ['II Tim 3:16', '2 Timothy 3:16'],
    ['First John 4:8', '1 John 4:8'],
    ['2nd Peter 3:9', '2 Peter 3:9'],
    ['3 John 4', '3 John 4'],
    ['Song of Solomon 2:1', 'Song of Solomon 2:1'],
    ['Song of Songs 2:1', 'Song of Solomon 2:1'],
    ['Rev 21:4', 'Revelation 21:4'],
    ['Revelations 21:1-4', 'Revelation 21:1–4'],
    ['Phil 4:13', 'Philippians 4:13'],
    ['Philemon 6', 'Philemon 6'],
    ['Jude 5-7', 'Jude 5–7'],
    ['Jude 1:5', 'Jude 5'],
    ['Jude 1', 'Jude 1'],
    ['Obadiah 3, 5', 'Obadiah 3, 5'],
    ['Matt 5:3-12', 'Matthew 5:3–12'],
    ['Mt 5:3', 'Matthew 5:3'],
    ['JOHN 3:16', 'John 3:16'],
    ['john 3:16', 'John 3:16'],
    ['1 john 4:8', '1 John 4:8'],
    ['John\u00a03:16', 'John 3:16'],
    ['John 3:16a', 'John 3:16'],
    ['John 3:16ff', 'John 3:16–36'],
    ['John 3:16f', 'John 3:16–17'],
    ['Isaiah 53:5', 'Isaiah 53:5'],
    ['Ezek 37:1-14', 'Ezekiel 37:1–14'],
  ])('reads %j as %s', (text, expected) => {
    const matches = findReferences(text);
    expect(matches.map((match) => formatReference(match.reference))).toEqual([expected]);
    expect(matches[0]).toMatchObject({ index: 0, end: text.length, text });
  });

  it('finds references inside sentences and reports where they are', () => {
    const text = 'This morning I read Psalm 23:1-3 and then (Rom 8:28).';
    const matches = findReferences(text);
    expect(matches.map((match) => match.text)).toEqual(['Psalm 23:1-3', 'Rom 8:28']);
    expect(text.slice(matches[1]!.index, matches[1]!.end)).toBe('Rom 8:28');
  });

  it('keeps neighbouring references apart', () => {
    expect(found('John 3:16, 1 John 4:8 and Romans 8:1, 2 Corinthians 5:17')).toEqual([
      'John 3:16',
      '1 John 4:8',
      'Romans 8:1',
      '2 Corinthians 5:17',
    ]);
    expect(found('John 3:16; 1 John 4:8')).toEqual(['John 3:16', '1 John 4:8']);
    expect(found('See John 3:16;Acts 2:38.')).toEqual(['John 3:16', 'Acts 2:38']);
  });

  it('stops before parts that cannot be verses', () => {
    expect(findReferences('John 3:16-99 is not a range')[0]).toMatchObject({ text: 'John 3:16' });
    expect(findReferences('John 3:16, 12 came later')[0]).toMatchObject({ text: 'John 3:16' });
    expect(findReferences('John 3:16, 2024')[0]).toMatchObject({ text: 'John 3:16' });
    expect(findReferences('John 3:16; 40 people')[0]).toMatchObject({ text: 'John 3:16' });
  });

  it('reads the translation named after a reference', () => {
    expect(findReferences('John 3:16 (ESV)')[0]).toMatchObject({ text: 'John 3:16', version: 'ESV' });
    expect(findReferences('— Psalm 23:1–3 (BSB)')[0]).toMatchObject({ text: 'Psalm 23:1–3', version: 'BSB' });
    expect(findReferences('John 3:16 (see below)')[0]!.version).toBeUndefined();
  });

  it.each([
    'John 22:1',
    'John 3:99',
    'Jude 30',
    '3 Kings 4:2',
    'Psalm 151',
    'John 2024',
    'John 3rd',
    'Mark 2.5 hours',
    'Acts 50% done',
    'Johnny 3:16',
    'XJohn 3:16',
    'John3:16',
    'Is 5:30 too late?',
    'I am 3:16',
  ])('ignores %j', (text) => {
    expect(found(text)).toEqual([]);
  });

  it('wants a verse before trusting an ambiguous spelling', () => {
    expect(found('Dan 3 times')).toEqual([]);
    expect(found('Phil 4 beers')).toEqual([]);
    expect(found('Ex 3')).toEqual([]);
    expect(found('mark 2 as done')).toEqual([]);
    expect(found('Dan 3:16')).toEqual(['Daniel 3:16']);
    expect(found('Ex 3:14')).toEqual(['Exodus 3:14']);
    expect(found('Mark 2')).toEqual(['Mark 2']);
    expect(found('1 Co 13')).toEqual(['1 Corinthians 13']);
  });

  it('falls back to the unnumbered book when the number does not fit', () => {
    expect(found('page 3 John 3:16')).toEqual(['John 3:16']);
    expect(found('i John 3:16')).toEqual(['John 3:16']);
  });

  it('reads one long text quickly', () => {
    const text = 'Today John 3:16 and Psalm 23 shaped my thinking about Romans 8:28-30. '.repeat(3000);
    const started = performance.now();
    expect(findReferences(text)).toHaveLength(9000);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('parseReference', () => {
  it.each([
    ['jn 3 16', 'John 3:16'],
    ['jn3:16', 'John 3:16'],
    ['john 3.16', 'John 3:16'],
    ['john 3 v 16', 'John 3:16'],
    ['  ps 23  ', 'Psalm 23'],
    ['1cor 13 4-7', '1 Corinthians 13:4–7'],
    ['i john 4:8', '1 John 4:8'],
    ['dan 3', 'Daniel 3'],
    ['gen 1-2', 'Genesis 1–2'],
    ['Romans 8:28; 12:1–2', 'Romans 8:28; 12:1–2'],
  ])('reads typed input %j as %s', (text, expected) => {
    const reference = parseReference(text);
    expect(reference && formatReference(reference)).toBe(expected);
  });

  it.each(['', 'john', 'john 3:16 and more', 'hello', 'john 99'])('rejects %j', (text) => {
    expect(parseReference(text)).toBeNull();
  });

  it('can apply the strict rules', () => {
    expect(parseReference('john 3', { loose: false })).toBeNull();
    expect(parseReference('John 3', { loose: false })).not.toBeNull();
  });
});

describe('formatReference', () => {
  const references: BibleReference[] = [
    { book: 'JHN', ranges: [{ chapter: 3, endChapter: 3 }] },
    { book: 'JHN', ranges: [{ chapter: 3, endChapter: 5 }] },
    { book: 'JHN', ranges: [{ chapter: 3, verse: 16, endChapter: 3, endVerse: 16 }] },
    { book: 'JHN', ranges: [{ chapter: 3, verse: 16, endChapter: 4, endVerse: 2 }, { chapter: 4, verse: 5, endChapter: 4, endVerse: 5 }] },
    { book: 'ROM', ranges: [{ chapter: 8, verse: 28, endChapter: 8, endVerse: 30 }, { chapter: 8, verse: 38, endChapter: 8, endVerse: 39 }, { chapter: 12, verse: 1, endChapter: 12, endVerse: 2 }] },
    { book: 'PSA', ranges: [{ chapter: 23, endChapter: 24 }] },
    { book: 'JUD', ranges: [{ chapter: 1, endChapter: 1 }] },
    { book: 'JUD', ranges: [{ chapter: 1, verse: 1, endChapter: 1, endVerse: 4 }] },
    { book: '2JN', ranges: [{ chapter: 1, verse: 4, endChapter: 1, endVerse: 4 }, { chapter: 1, verse: 6, endChapter: 1, endVerse: 6 }] },
  ];

  it.each(references)('round-trips %j', (reference) => {
    expect(parseReference(formatReference(reference))).toEqual(reference);
    expect(parseReference(formatReference(reference), { loose: false })).toEqual(reference);
  });

  it('round-trips the first and last verse of every chapter', () => {
    for (const book of BOOKS) {
      book.verses.forEach((count, index) => {
        const reference: BibleReference = {
          book: book.id,
          ranges: [{ chapter: index + 1, verse: 1, endChapter: index + 1, endVerse: count }],
        };
        const text = formatReference(reference);
        expect(parseReference(text, { loose: false }), text).toEqual(count === 1 ? null : reference);
      });
    }
  });
});

describe('reference helpers', () => {
  const reference = parseReference('John 3:16-4:2, 5')!;

  it('lists the chapters a reference touches', () => {
    expect(referenceChapters(reference)).toEqual([3, 4]);
    expect(referenceChapters(parseReference('Psalms 1-3')!)).toEqual([1, 2, 3]);
  });

  it('knows which verses a reference includes', () => {
    expect(referenceIncludes(reference, 3, 15)).toBe(false);
    expect(referenceIncludes(reference, 3, 36)).toBe(true);
    expect(referenceIncludes(reference, 4, 2)).toBe(true);
    expect(referenceIncludes(reference, 4, 3)).toBe(false);
    expect(referenceIncludes(reference, 4, 5)).toBe(true);
    expect(referenceIncludes(parseReference('John 3')!, 3, 20)).toBe(true);
  });
});

describe('suggestBooks', () => {
  const names = (query: string) => suggestBooks(query).map((book) => book.name);

  it('suggests books by the start of their name or abbreviation', () => {
    expect(names('ro')).toEqual(['Romans']);
    expect(names('jn')).toEqual(['Jonah', 'John', '1 John', '2 John', '3 John']);
    expect(names('1 c')).toEqual(['1 Chronicles', '1 Corinthians']);
    expect(names('2cor')).toEqual(['2 Corinthians']);
    expect(names('phil')).toEqual(['Philippians', 'Philemon']);
    expect(names('song')).toEqual(['Song of Solomon']);
    expect(names('zzz')).toEqual([]);
    expect(names('')).toEqual([]);
  });

  it('treats a leading "i" as either a book number or a letter', () => {
    expect(names('i')).toContain('Isaiah');
    expect(names('i k')).toEqual(['1 Kings']);
  });
});
