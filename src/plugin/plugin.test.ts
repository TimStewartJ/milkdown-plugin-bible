/** @vitest-environment jsdom */
import { Editor, defaultValueCtx, editorViewCtx, editorViewOptionsCtx, rootCtx } from '@milkdown/kit/core';
import { history, undoCommand } from '@milkdown/kit/plugin/history';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { callCommand, getMarkdown } from '@milkdown/kit/utils';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BibleError, type BibleChapter, type BibleProvider, type ChapterRequest } from '../provider.js';
import { HELLOAO_TRANSLATIONS, readHelloaoChapter } from '../providers/helloao.js';
import { fixtures } from '../providers/helloao.fixtures.js';
import type { BibleConfig } from './config.js';
import {
  bible,
  bibleConfig,
  bibleMenuItem,
  insertBiblePassageCommand,
  openBiblePickerCommand,
  showBiblePassageCommand,
} from './index.js';

beforeAll(() => {
  // jsdom has no layout, and ProseMirror asks for it when placing the popover.
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

const JOHN_3_16 =
  'For God so loved the world that He gave His one and only Son, that everyone who believes in Him shall not perish but have eternal life.';

/** Serves John 3 and Psalm 23, counts requests, and can hold answers back. */
function fakeProvider() {
  const requests: ChapterRequest[] = [];
  let release: (() => void) | null = null;
  let gate: Promise<void> | null = null;
  let failure: Error | null = null;

  const provider: BibleProvider = {
    translations: HELLOAO_TRANSLATIONS,
    async getChapter(request): Promise<BibleChapter> {
      requests.push(request);
      if (gate) await gate;
      if (failure) throw failure;
      const where = { book: request.book, chapter: request.chapter, translation: request.translation };
      if (request.book === 'JHN' && request.chapter === 3) {
        return readHelloaoChapter(request.translation === 'eng_kjv' ? fixtures.kjvJohn3 : fixtures.bsbJohn3, where);
      }
      if (request.book === 'PSA' && request.chapter === 23) return readHelloaoChapter(fixtures.bsbPsalm23, where);
      throw new BibleError('not-found', 'That chapter isn’t in this translation.');
    },
  };

  return {
    provider,
    requests,
    hold() {
      gate = new Promise((resolve) => {
        release = resolve;
      });
    },
    release() {
      gate = null;
      release?.();
    },
    fail(error: Error | null) {
      failure = error;
    },
  };
}

const editors: Editor[] = [];

async function setup(markdown: string, overrides: Partial<BibleConfig> = {}, editable = true) {
  const source = fakeProvider();
  const root = document.createElement('div');
  document.body.append(root);
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, markdown);
      ctx.set(editorViewOptionsCtx, { editable: () => editable });
      ctx.update(bibleConfig.key, (config) => ({ ...config, provider: source.provider, hoverDelay: 0, ...overrides }));
    })
    .use(commonmark)
    .use(history)
    .use(bible)
    .create();
  editors.push(editor);

  const view = editor.action((ctx) => ctx.get(editorViewCtx));
  return {
    editor,
    view,
    root,
    source,
    markdown: () => editor.action(getMarkdown()),
    refs: () => [...root.querySelectorAll<HTMLElement>('.bible-ref')],
    popover: () => root.querySelector<HTMLElement>('.bible-popover'),
    config: () => editor.action((ctx) => ctx.get(bibleConfig.key)),
  };
}

afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
  document.body.replaceChildren();
  vi.useRealTimers();
});

/** Lets pending promises (passage loads) settle. */
async function settle() {
  for (let turn = 0; turn < 6; turn++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function click(target: Element) {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
}

function pressIn(target: Element, key: string, init: KeyboardEventInit = {}) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}

/** Sends a key to the editor the way ProseMirror would receive it. */
function press(view: EditorView, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  return Boolean(view.someProp('handleKeyDown', (handler) => handler(view, event)));
}

function cursorTo(view: EditorView, pos: number) {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
}

function cursorToEndOfBlock(view: EditorView, index: number) {
  let pos = 0;
  for (let child = 0; child < index; child++) pos += view.state.doc.child(child).nodeSize;
  cursorTo(view, pos + view.state.doc.child(index).nodeSize - 1);
}

function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('marking references', () => {
  it('marks references in prose and records what they point to', async () => {
    const { refs } = await setup('Reading John 3:16 and then Ps 23:1-3 today.');
    expect(refs().map((ref) => [ref.textContent, ref.dataset.bibleRef])).toEqual([
      ['John 3:16', 'John 3:16'],
      ['Ps 23:1-3', 'Psalm 23:1–3'],
    ]);
  });

  it('leaves code and links alone', async () => {
    const { refs } = await setup(
      'Inline `John 3:16` and [Romans 8:28](https://example.com) but Acts 2:38.\n\n```\nJohn 3:16\n```\n',
    );
    expect(refs().map((ref) => ref.textContent)).toEqual(['Acts 2:38']);
  });

  it('never changes the Markdown', async () => {
    const source = 'Reading John 3:16 and *Romans 8:28* today.\n\n> Psalm 23\n';
    const { markdown } = await setup(source);
    expect(markdown()).toBe(source);
  });

  it('keeps up as the text changes', async () => {
    const { view, refs } = await setup('First line.\n\nSecond line.');
    view.dispatch(view.state.tr.insertText(' See John 3:16', 12));
    expect(refs().map((ref) => ref.textContent)).toEqual(['John 3:16']);

    // Typing more of the reference extends it in place.
    view.dispatch(view.state.tr.insertText('-18', 26));
    expect(refs().map((ref) => ref.dataset.bibleRef)).toEqual(['John 3:16–18']);

    // A new paragraph elsewhere leaves the first one's marks in place.
    const before = refs()[0];
    view.dispatch(view.state.tr.insertText(' Also Romans 8:1.', view.state.doc.content.size - 1));
    expect(refs().map((ref) => ref.textContent)).toEqual(['John 3:16-18', 'Romans 8:1']);
    expect(refs()[0]).toBe(before);

    view.dispatch(view.state.tr.delete(17, 22));
    expect(refs().map((ref) => ref.textContent)).toEqual(['Romans 8:1']);
  });

  it('reacts when text becomes a link or stops being one', async () => {
    const { view, refs } = await setup('See John 3:16 here.');
    const link = view.state.schema.marks.link!.create({ href: 'https://example.com' });
    view.dispatch(view.state.tr.addMark(5, 14, link));
    expect(refs()).toHaveLength(0);
    view.dispatch(view.state.tr.removeMark(5, 14, link));
    expect(refs()).toHaveLength(1);
  });

  it('styles a quote that ends in a citation as a passage', async () => {
    const { root } = await setup(`> ${JOHN_3_16}\n>\n> — John 3:16 (BSB)\n\n> Just a quote about John 3:16.\n`);
    const quotes = [...root.querySelectorAll('blockquote')];
    expect(quotes[0]!.classList.contains('bible-passage')).toBe(true);
    expect(quotes[0]!.lastElementChild!.classList.contains('bible-passage-cite')).toBe(true);
    expect(quotes[1]!.classList.contains('bible-passage')).toBe(false);
  });

  it('marks the verse numbers of a passage, and only there', async () => {
    const { root } = await setup('x² is not a verse.\n\n> ¹⁶ For God so loved the world. ¹⁷ For God did not send.\n>\n> — John 3:16–17 (BSB)\n');
    expect([...root.querySelectorAll('.bible-verse-number')].map((number) => number.textContent)).toEqual(['¹⁶', '¹⁷']);
  });
});

describe('the passage popover', () => {
  it('opens on a click and shows the passage', async () => {
    const { refs, popover, source, root } = await setup('Reading John 3:16 today.');
    click(refs()[0]!);
    expect(popover()).not.toBeNull();
    expect(popover()!.dataset.status).toBe('loading');
    await settle();

    expect(popover()!.dataset.status).toBe('ready');
    expect(popover()!.querySelector('.bible-popover__title')!.textContent).toBe('John 3:16');
    expect(popover()!.querySelector('.bible-text')!.textContent).toContain(JOHN_3_16);
    expect(popover()!.querySelector('[aria-checked="true"]')!.textContent).toBe('BSB');
    expect(source.requests).toMatchObject([{ book: 'JHN', chapter: 3, translation: 'BSB' }]);
    expect(root.querySelector('.bible-ref--active')!.textContent).toBe('John 3:16');
  });

  it('opens on hover and closes when the pointer leaves', async () => {
    vi.useFakeTimers();
    const { refs, popover, source } = await setup('Reading John 3:16 today.');
    const over = new Event('pointerover', { bubbles: true }) as PointerEvent;
    Object.assign(over, { pointerType: 'mouse', buttons: 0 });
    refs()[0]!.dispatchEvent(over);
    // The text is requested straight away, before the card opens.
    expect(source.requests).toHaveLength(1);
    expect(popover()).toBeNull();
    await vi.advanceTimersByTimeAsync(10);
    expect(popover()).not.toBeNull();

    const out = new Event('pointerout', { bubbles: true }) as PointerEvent;
    Object.assign(out, { pointerType: 'mouse', relatedTarget: null });
    refs()[0]!.dispatchEvent(out);
    await vi.advanceTimersByTimeAsync(400);
    expect(popover()).toBeNull();
  });

  it('does not open over text that is being typed', async () => {
    vi.useFakeTimers();
    const { view, refs, popover } = await setup('Reading John 3:16 today.');
    view.dispatch(view.state.tr.insertText('!', view.state.doc.content.size - 1));
    const over = new Event('pointerover', { bubbles: true }) as PointerEvent;
    Object.assign(over, { pointerType: 'mouse', buttons: 0 });
    refs()[0]!.dispatchEvent(over);
    await vi.advanceTimersByTimeAsync(500);
    expect(popover()).toBeNull();

    // Once the pointer really moves, hovering works again.
    const move = new Event('pointermove', { bubbles: true }) as PointerEvent;
    Object.assign(move, { clientX: 40, clientY: 12 });
    document.dispatchEvent(move);
    refs()[0]!.dispatchEvent(over);
    await vi.advanceTimersByTimeAsync(10);
    expect(popover()).not.toBeNull();
  });

  it('switches translation, remembers the choice and tells the host', async () => {
    const onTranslationChange = vi.fn();
    const { refs, popover, config, source } = await setup('Reading John 3:16 today.', { onTranslationChange });
    click(refs()[0]!);
    await settle();
    click(popover()!.querySelector('[data-translation="eng_kjv"]')!);
    await settle();

    expect(popover()!.querySelector('.bible-text')!.textContent).toContain('only begotten Son');
    expect(config().translation).toBe('eng_kjv');
    expect(onTranslationChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'eng_kjv', label: 'KJV' }));
    expect(source.requests.at(-1)).toMatchObject({ translation: 'eng_kjv' });
  });

  it('reads a shared translation setting without overwriting it', async () => {
    let shared = 'eng_kjv';
    const { refs, popover, config } = await setup('Reading John 3:16 today.', {
      translation: () => shared,
      onTranslationChange: (translation) => {
        shared = translation.id;
      },
    });
    click(refs()[0]!);
    await settle();
    expect(popover()!.querySelector('[aria-checked="true"]')!.textContent).toBe('KJV');
    click(popover()!.querySelector('[data-translation="BSB"]')!);
    expect(shared).toBe('BSB');
    expect(typeof config().translation).toBe('function');
  });

  it('opens in the translation a reference names', async () => {
    const { refs, popover } = await setup('As John 3:16 (KJV) says.');
    click(refs()[0]!);
    await settle();
    expect(popover()!.querySelector('[aria-checked="true"]')!.textContent).toBe('KJV');
  });

  it('shows the whole chapter with the cited verses marked', async () => {
    const { refs, popover } = await setup('Reading John 3:16-17 today.');
    click(refs()[0]!);
    await settle();
    expect(popover()!.querySelectorAll('.bible-verse')).toHaveLength(2);

    click(popover()!.querySelector('[data-action="context"]')!);
    expect(popover()!.querySelectorAll('.bible-verse')).toHaveLength(5);
    expect(popover()!.querySelectorAll('.bible-verse--cited')).toHaveLength(2);
    expect(popover()!.querySelector('.bible-text__chapter')!.textContent).toBe('John 3');
  });

  it('explains a failure and tries again', async () => {
    const { refs, popover, source } = await setup('Reading John 3:16 today.');
    source.fail(new Error('network down'));
    click(refs()[0]!);
    await settle();
    expect(popover()!.dataset.status).toBe('error');
    expect(popover()!.querySelector('[role="alert"]')!.textContent).toBe('Couldn’t load this passage.');

    source.fail(null);
    click(popover()!.querySelector('[data-action="retry"]')!);
    await settle();
    expect(popover()!.dataset.status).toBe('ready');
  });

  it('says when a passage does not exist in the translation', async () => {
    const { refs, popover } = await setup('Reading Romans 8:28 today.');
    click(refs()[0]!);
    await settle();
    expect(popover()!.querySelector('[role="alert"]')!.textContent).toBe('That chapter isn’t in this translation.');
    expect(popover()!.querySelector('[data-action="retry"]')).toBeNull();
  });

  it('closes on Escape, on a press elsewhere, and when the text changes', async () => {
    const { view, refs, popover } = await setup('Reading John 3:16 today.');
    click(refs()[0]!);
    expect(press(view, 'Escape')).toBe(true);
    expect(popover()).toBeNull();
    expect(press(view, 'Escape')).toBe(false);

    click(refs()[0]!);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(popover()).toBeNull();

    click(refs()[0]!);
    view.dispatch(view.state.tr.insertText('!', 1));
    expect(popover()).toBeNull();
  });

  it('opens from the keyboard and takes focus', async () => {
    const { editor, view, popover } = await setup('Reading John 3:16 today.');
    cursorTo(view, 3);
    expect(press(view, 'Enter', { ctrlKey: true })).toBe(false);

    cursorTo(view, 12);
    expect(editor.action(callCommand(showBiblePassageCommand.key))).toBe(true);
    await settle();
    expect(popover()!.contains(document.activeElement)).toBe(true);

    pressIn(document.activeElement!, 'Escape');
    expect(popover()).toBeNull();
  });

  it('offers no insert button in a read-only editor', async () => {
    const { refs, popover } = await setup('Reading John 3:16 today.', {}, false);
    click(refs()[0]!);
    await settle();
    expect(popover()!.dataset.status).toBe('ready');
    expect(popover()!.querySelector('[data-action="insert"]')).toBeNull();
    expect(popover()!.querySelector('[data-action="copy"]')).not.toBeNull();
  });
});

describe('inserting a passage', () => {
  it('adds the passage below the paragraph that cites it', async () => {
    const { refs, popover, markdown } = await setup('Reading John 3:16 today.\n\nNext thought.');
    click(refs()[0]!);
    await settle();
    click(popover()!.querySelector('[data-action="insert"]')!);

    expect(popover()).toBeNull();
    expect(markdown()).toBe(
      `Reading John 3:16 today.\n\n> ${JOHN_3_16}\n>\n> — John 3:16 (BSB)\n\nNext thought.\n`,
    );
  });

  it('numbers the verses of a longer passage and keeps its paragraphs', async () => {
    const { editor, markdown } = await setup('');
    editor.action(callCommand(insertBiblePassageCommand.key, 'John 3:15-17'));
    await settle();
    const lines = markdown().split('\n');
    expect(lines[0]).toMatch(/^> ¹⁵ that everyone who believes in Him may have eternal life\.$/);
    expect(lines[2]).toMatch(/^> ¹⁶ For God so loved .* ¹⁷ For God did not send/);
    expect(lines.at(-2)).toBe('> — John 3:15–17 (BSB)');
  });

  it('keeps the lines of poetry', async () => {
    const { editor, markdown, root } = await setup('');
    editor.action(callCommand(insertBiblePassageCommand.key, { reference: 'Psalm 23:1-2', translation: 'BSB' }));
    await settle();
    expect(markdown()).toBe(
      [
        '> ¹ The LORD is my shepherd;\\',
        '> I shall not want.\\',
        '> ² He makes me lie down in green pastures;\\',
        '> He leads me beside quiet waters.',
        '>',
        '> — Psalm 23:1–2 (BSB)',
        '',
      ].join('\n'),
    );
    expect(root.querySelector('blockquote')!.classList.contains('bible-passage')).toBe(true);
  });

  it('replaces a reference that has a line to itself when the insert key is pressed', async () => {
    const { view, markdown, root } = await setup('Thoughts.\n\nJohn 3:16\n\nMore.');
    cursorToEndOfBlock(view, 1);
    expect(root.querySelector('p.bible-hint')!.getAttribute('data-bible-hint')).toBe('Tab to insert the passage');

    expect(press(view, 'Tab')).toBe(true);
    expect(root.querySelector('p.bible-loading')).not.toBeNull();
    await settle();

    // The cursor waits on an empty line under the quote, ready to keep writing.
    const { $from } = view.state.selection;
    expect($from.parent.type.name).toBe('paragraph');
    expect($from.parent.content.size).toBe(0);
    expect($from.index(0)).toBe(2);
    expect(view.state.doc.child(3).textContent).toBe('More.');
    expect(root.querySelector('.bible-passage--new')).not.toBeNull();

    view.dispatch(view.state.tr.insertText('Amen.'));
    expect(markdown()).toBe(`Thoughts.\n\n> ${JOHN_3_16}\n>\n> — John 3:16 (BSB)\n\nAmen.\n\nMore.\n`);
  });

  it('uses the empty line that is already under the reference', async () => {
    const { view } = await setup('John 3:16\n\n<br />\n\nMore.');
    const blocks = () => view.state.doc.childCount;
    cursorToEndOfBlock(view, 0);
    const before = blocks();
    press(view, 'Tab');
    await settle();
    expect(view.state.doc.firstChild!.type.name).toBe('blockquote');
    expect(blocks()).toBe(before);
    expect(view.state.selection.$from.index(0)).toBe(1);
  });

  it('never drops the cursor into a quote or list that follows', async () => {
    const { view } = await setup('John 3:16\n\n> An older quote.\n\n- item');
    cursorToEndOfBlock(view, 0);
    press(view, 'Tab');
    await settle();
    const { $from } = view.state.selection;
    expect($from.depth).toBe(1);
    expect($from.parent.content.size).toBe(0);
    expect(view.state.doc.child(2).textContent).toBe('An older quote.');
  });

  it('leaves the insert key alone anywhere else', async () => {
    const { view, root } = await setup('Reading John 3:16 today.\n\nJohn 3:16');
    cursorToEndOfBlock(view, 0);
    expect(root.querySelector('.bible-hint')).toBeNull();
    expect(press(view, 'Tab')).toBe(false);

    // Not at the end of the line.
    cursorTo(view, view.state.doc.content.size - 3);
    expect(press(view, 'Tab')).toBe(false);
  });

  it('gives up quietly if the line changes while the passage loads', async () => {
    const { view, markdown, source, root } = await setup('John 3:16');
    cursorToEndOfBlock(view, 0);
    source.hold();
    expect(press(view, 'Tab')).toBe(true);
    view.dispatch(view.state.tr.insertText(' is my favourite', view.state.doc.content.size - 1));
    source.release();
    await settle();
    expect(markdown()).toBe('John 3:16 is my favourite\n');
    expect(root.querySelector('.bible-loading')).toBeNull();
  });

  it('does not insert a passage the line no longer asks for', async () => {
    const { view, markdown, source, popover, root } = await setup('John 3:16');
    cursorToEndOfBlock(view, 0);
    source.hold();
    expect(press(view, 'Tab')).toBe(true);
    view.dispatch(view.state.tr.insertText('7', view.state.doc.content.size - 2, view.state.doc.content.size - 1));
    source.release();
    await settle();
    expect(markdown()).toBe('John 3:17\n');
    expect(popover()).toBeNull();
    expect(root.querySelector('.bible-loading')).toBeNull();
  });

  it('leaves a line to write on when the passage ends the document', async () => {
    const { view, markdown } = await setup('John 3:16');
    cursorToEndOfBlock(view, 0);
    press(view, 'Tab');
    await settle();
    expect(markdown()).toContain('— John 3:16 (BSB)');
    expect(view.state.doc.lastChild!.type.name).toBe('paragraph');
    expect(view.state.selection.$from.parent).toBe(view.state.doc.lastChild);
  });

  it('shows what went wrong when the passage cannot be inserted', async () => {
    const { view, markdown, popover, root } = await setup('Romans 8:28');
    cursorToEndOfBlock(view, 0);
    expect(press(view, 'Tab')).toBe(true);
    await settle();
    await settle();
    expect(markdown()).toBe('Romans 8:28\n');
    expect(root.querySelector('.bible-loading')).toBeNull();
    expect(popover()!.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('can turn the keys off', async () => {
    const { view, root } = await setup('John 3:16', { keys: { preview: null, insert: null } });
    cursorToEndOfBlock(view, 0);
    expect(root.querySelector('.bible-hint')).toBeNull();
    expect(press(view, 'Tab')).toBe(false);
  });

  it('undoes as one step', async () => {
    const { editor, refs, popover, markdown } = await setup('Reading John 3:16 today.');
    click(refs()[0]!);
    await settle();
    click(popover()!.querySelector('[data-action="insert"]')!);
    expect(markdown()).toContain('— John 3:16 (BSB)');
    editor.action(callCommand(undoCommand.key));
    expect(markdown()).toBe('Reading John 3:16 today.\n');
  });
});

describe('the passage picker', () => {
  it('suggests books, completes one, previews the passage and inserts it', async () => {
    const { editor, view, popover, markdown } = await setup('Intro.\n\n');
    cursorToEndOfBlock(view, 0);
    expect(editor.action(callCommand(openBiblePickerCommand.key))).toBe(true);

    const input = popover()!.querySelector<HTMLInputElement>('.bible-popover__input')!;
    expect(document.activeElement).toBe(input);
    expect(popover()!.querySelector('.bible-popover__message')!.textContent).toBe('Type a book, chapter and verse.');

    type(input, 'jo');
    const options = () => [...popover()!.querySelectorAll('[role="option"]')];
    expect(options().map((option) => option.querySelector('.bible-popover__suggestion-name')!.textContent)).toEqual([
      'Joshua', 'Job', 'Joel', 'Jonah', 'John', '1 John', '2 John', '3 John',
    ]);
    for (let step = 0; step < 4; step++) pressIn(input, 'ArrowDown');
    expect(options()[4]!.getAttribute('aria-selected')).toBe('true');
    expect(input.getAttribute('aria-activedescendant')).toBe(options()[4]!.id);

    pressIn(input, 'Enter');
    expect(input.value).toBe('John ');
    expect(popover()!.querySelector('.bible-popover__message')!.textContent).toContain('John 1:1');

    type(input, 'John 3 16');
    expect(popover()!.querySelector('.bible-popover__title')!.textContent).toBe('John 3:16');
    await new Promise((resolve) => setTimeout(resolve, 260));
    await settle();
    expect(popover()!.querySelector('.bible-text')!.textContent).toContain(JOHN_3_16);

    pressIn(input, 'Enter');
    expect(popover()).toBeNull();
    expect(markdown()).toBe(`Intro.\n\n> ${JOHN_3_16}\n>\n> — John 3:16 (BSB)\n`);
  });

  it('inserts as soon as the text arrives when Enter comes first', async () => {
    const { editor, popover, markdown } = await setup('');
    editor.action(callCommand(openBiblePickerCommand.key));
    const input = popover()!.querySelector<HTMLInputElement>('.bible-popover__input')!;
    type(input, 'john 3:16');
    pressIn(input, 'Enter');
    expect(popover()!.dataset.status).toBe('loading');
    await settle();
    expect(popover()).toBeNull();
    expect(markdown()).toContain('— John 3:16 (BSB)');
  });

  it('says when nothing matches and closes on Escape', async () => {
    const { editor, popover, view } = await setup('');
    editor.action(callCommand(openBiblePickerCommand.key));
    const input = popover()!.querySelector<HTMLInputElement>('.bible-popover__input')!;
    type(input, 'zzz');
    expect(popover()!.querySelector('.bible-popover__message')!.textContent).toBe('No book or passage matches that.');
    pressIn(input, 'Escape');
    expect(popover()).toBeNull();
    expect(view.hasFocus()).toBe(true);
  });

  it('is not offered in a read-only editor', async () => {
    const { editor, popover } = await setup('', {}, false);
    expect(editor.action(callCommand(openBiblePickerCommand.key))).toBe(false);
    expect(popover()).toBeNull();
  });

  it('comes with a menu entry that clears the typed command first', async () => {
    const { editor, view, popover, markdown } = await setup('/bib');
    cursorToEndOfBlock(view, 0);
    editor.action((ctx) => bibleMenuItem.onRun(ctx));
    expect(markdown()).toBe('');
    expect(popover()!.dataset.kind).toBe('picker');
    expect(bibleMenuItem.icon).toContain('<svg');
  });
});
