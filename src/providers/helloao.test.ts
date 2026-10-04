import { describe, expect, it, vi } from 'vitest';
import {
  BibleError,
  cachedProvider,
  loadPassage,
  type BibleChapter,
  type BibleProvider,
  type ChapterRequest,
} from '../provider.js';
import { parseReference } from '../reference.js';
import { fixtures } from './helloao.fixtures.js';
import { HELLOAO_TRANSLATIONS, helloaoProvider, readHelloaoChapter } from './helloao.js';

const john3 = { book: 'JHN', chapter: 3, translation: 'BSB' } as const;

function respond(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

describe('readHelloaoChapter', () => {
  it('joins the pieces a footnote splits a verse into', () => {
    const chapter = readHelloaoChapter(fixtures.bsbJohn3, john3);
    expect(chapter.verses.map((verse) => verse.number)).toEqual([14, 15, 16, 17, 18]);
    expect(chapter.verses[2]!.text).toBe(
      'For God so loved the world that He gave His one and only Son, that everyone who believes in Him shall not perish but have eternal life.',
    );
    expect(chapter.verses[2]!.lines).toBeUndefined();
  });

  it('marks where paragraphs start and keeps section headings', () => {
    const chapter = readHelloaoChapter(fixtures.bsbJohn3, john3);
    expect(chapter.verses.map((verse) => Boolean(verse.paragraph))).toEqual([true, false, true, false, false]);

    const genesis = readHelloaoChapter(fixtures.bsbGenesis1, { book: 'GEN', chapter: 1, translation: 'BSB' });
    expect(genesis.verses[0]).toMatchObject({ number: 1, paragraph: true, heading: 'The Creation' });
    expect(genesis.verses[2]).toMatchObject({ number: 3, heading: 'The First Day' });
  });

  it('keeps poetry line by line', () => {
    const psalm = readHelloaoChapter(fixtures.bsbPsalm23, { book: 'PSA', chapter: 23, translation: 'BSB' });
    expect(psalm.verses).toHaveLength(6);
    expect(psalm.verses[0]).toMatchObject({
      text: 'The LORD is my shepherd; I shall not want.',
      lines: [
        { text: 'The LORD is my shepherd;', indent: 0 },
        { text: 'I shall not want.', indent: 1 },
      ],
    });
    expect(psalm.verses[2]!.lines).toHaveLength(3);
    expect(psalm.verses[4]!.paragraph).toBe(true);
  });

  it('reads the King James paragraph marks and drops them from the text', () => {
    const chapter = readHelloaoChapter(fixtures.kjvJohn3, { ...john3, translation: 'eng_kjv' });
    expect(chapter.verses[1]!.text.startsWith('For God so loved the world')).toBe(true);
    expect(chapter.verses.map((verse) => Boolean(verse.paragraph))).toEqual([true, true, false]);
  });

  it('rejects a response that is not a chapter', () => {
    expect(() => readHelloaoChapter({ nope: true }, john3)).toThrow(BibleError);
  });
});

describe('helloaoProvider', () => {
  it('asks for one chapter of one translation', async () => {
    const fetch = vi.fn((_url: string | URL | Request, _init?: RequestInit) => respond(fixtures.bsbJohn3));
    const provider = helloaoProvider({ fetch });
    const chapter = await provider.getChapter(john3);
    expect(fetch.mock.calls[0]![0]).toBe('https://bible.helloao.org/api/BSB/JHN/3.json');
    expect(chapter).toMatchObject({ book: 'JHN', chapter: 3, translation: 'BSB' });
    expect(provider.translations).toBe(HELLOAO_TRANSLATIONS);
  });

  it('can be pointed at another host', async () => {
    const fetch = vi.fn((_url: string | URL | Request, _init?: RequestInit) => respond(fixtures.bsbJohn3));
    await helloaoProvider({ fetch, baseUrl: '/api/bible/' }).getChapter(john3);
    expect(fetch.mock.calls[0]![0]).toBe('/api/bible/BSB/JHN/3.json');
  });

  it('says so when the chapter is missing or the service fails', async () => {
    const missing = helloaoProvider({ fetch: () => respond({}, 404) });
    await expect(missing.getChapter(john3)).rejects.toMatchObject({ code: 'not-found' });
    const broken = helloaoProvider({ fetch: () => respond({}, 503) });
    await expect(broken.getChapter(john3)).rejects.toMatchObject({ code: 'failed' });
  });
});

describe('cachedProvider', () => {
  function counting() {
    const chapter = readHelloaoChapter(fixtures.bsbJohn3, john3);
    const getChapter = vi.fn(async (_request: ChapterRequest): Promise<BibleChapter> => chapter);
    const provider: BibleProvider = { translations: HELLOAO_TRANSLATIONS, getChapter };
    return { provider, getChapter, chapter };
  }

  it('fetches each chapter once, even when asked twice at the same time', async () => {
    const { provider, getChapter } = counting();
    const cached = cachedProvider(provider);
    expect(cached.peekChapter(john3)).toBeUndefined();
    await Promise.all([cached.getChapter(john3), cached.getChapter(john3)]);
    await cached.getChapter(john3);
    expect(getChapter).toHaveBeenCalledTimes(1);
    expect(cached.peekChapter(john3)?.verses).toHaveLength(5);
  });

  it('does not remember failures', async () => {
    const { provider, getChapter } = counting();
    getChapter.mockRejectedValueOnce(new Error('offline'));
    const cached = cachedProvider(provider);
    await expect(cached.getChapter(john3)).rejects.toThrow('offline');
    await expect(cached.getChapter(john3)).resolves.toBeDefined();
  });

  it('forgets the chapters used longest ago', async () => {
    const { provider, getChapter } = counting();
    const cached = cachedProvider(provider, { max: 2 });
    await cached.getChapter({ ...john3, chapter: 1 });
    await cached.getChapter({ ...john3, chapter: 2 });
    await cached.getChapter({ ...john3, chapter: 1 });
    await cached.getChapter({ ...john3, chapter: 3 });
    expect(cached.peekChapter({ ...john3, chapter: 1 })).toBeDefined();
    expect(cached.peekChapter({ ...john3, chapter: 2 })).toBeUndefined();
    expect(getChapter).toHaveBeenCalledTimes(3);
  });

  it('reads from and writes to persistent storage, and survives it breaking', async () => {
    const { provider, getChapter, chapter } = counting();
    const stored = new Map<string, BibleChapter>();
    const storage = { get: (key: string) => stored.get(key), set: (key: string, value: BibleChapter) => stored.set(key, value) };
    await cachedProvider(provider, { storage }).getChapter(john3);
    expect(stored.get('BSB/JHN/3')).toBe(chapter);

    await cachedProvider(provider, { storage }).getChapter(john3);
    expect(getChapter).toHaveBeenCalledTimes(1);

    const broken = {
      get: () => Promise.reject(new Error('blocked')),
      set: () => Promise.reject(new Error('blocked')),
    };
    await expect(cachedProvider(provider, { storage: broken }).getChapter(john3)).resolves.toBe(chapter);
  });
});

describe('loadPassage', () => {
  const provider = helloaoProvider({ fetch: () => respond(fixtures.bsbJohn3) });

  it('returns just the verses a reference cites', async () => {
    const passage = await loadPassage(provider, parseReference('John 3:16-17')!, 'BSB');
    expect(passage.verses.map((verse) => `${verse.chapter}:${verse.number}`)).toEqual(['3:16', '3:17']);
    expect(passage.translation.label).toBe('BSB');
  });

  it('accepts a translation by label and falls back to the first one', async () => {
    expect((await loadPassage(provider, parseReference('John 3:16')!, 'kjv')).translation.id).toBe('eng_kjv');
    expect((await loadPassage(provider, parseReference('John 3:16')!, 'NIV')).translation.id).toBe('BSB');
  });

  it('refuses passages that span too many chapters', async () => {
    await expect(loadPassage(provider, parseReference('John 1-5')!, 'BSB')).rejects.toMatchObject({ code: 'too-long' });
  });

  it('reports verses the translation does not have', async () => {
    await expect(loadPassage(provider, parseReference('John 3:30')!, 'BSB')).rejects.toMatchObject({
      code: 'not-found',
    });
  });
});
