import { autoUpdate, computePosition, flip, hide, offset, shift, size } from '@floating-ui/dom';
import { getBook, type BibleBook } from '../books.js';
import type { BibleChapter, BibleTranslation, PassageVerse } from '../provider.js';
import { referenceChapters, referenceIncludes, type BibleReference } from '../reference.js';
import type { BibleLabels } from './config.js';
import { groupParagraphs } from './passage.js';

export type PopoverKind = 'preview' | 'picker';
export type PopoverAction = 'insert' | 'copy' | 'context' | 'retry' | 'close';

export interface PopoverHandlers {
  onAction(action: PopoverAction): void;
  onTranslation(id: string): void;
  onEscape(): void;
  onPointerEnter(): void;
  onPointerLeave(): void;
  /** Any press inside the popover: the reader is using it. */
  onInteract(): void;
  onQuery(text: string): void;
  onSubmit(): void;
  onSuggestion(book: BibleBook): void;
  /** Arrow keys in the search box. Returns whether there was a list to move through. */
  onNavigate(step: 1 | -1): boolean;
}

export interface PopoverOptions {
  kind: PopoverKind;
  root: HTMLElement;
  labels: BibleLabels;
  translations: readonly BibleTranslation[];
  /** Offer to insert the passage. Off for read-only editors. */
  canInsert: boolean;
  handlers: PopoverHandlers;
}

const stroke = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
const ICONS = {
  insert: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 4v5.5A2.5 2.5 0 0 0 7 12h8.5m0 0L12 8.5m3.5 3.5L12 15.5" ${stroke}/></svg>`,
  copy: `<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="7" width="9" height="9" rx="2" ${stroke}/><path d="M13 4.5H6A1.5 1.5 0 0 0 4.5 6v7" ${stroke}/></svg>`,
  check: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4.5 10.5 3.5 3.5 7.5-8" ${stroke}/></svg>`,
  book: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 5.5C8.6 4.5 6.8 4 4.5 4v10.5c2.3 0 4.1.5 5.5 1.5 1.4-1 3.2-1.5 5.5-1.5V4c-2.3 0-4.1.5-5.5 1.5Zm0 0V16" ${stroke}/></svg>`,
  close: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5.5 5.5 9 9m0-9-9 9" ${stroke}/></svg>`,
  search: `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="4.75" ${stroke}/><path d="m12.5 12.5 3.5 3.5" ${stroke}/></svg>`,
};

/**
 * An open book, drawn as a filled 24px shape to sit beside Crepe's menu
 * icons. For hosts adding a "Bible passage" entry to their own menus.
 */
export const bibleIcon =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M12 6.3C10.3 5.1 8.1 4.5 5.25 4.5a.75.75 0 0 0-.75.75v12c0 .41.34.75.75.75 2.6 0 4.6.54 6.22 1.72.32.23.74.23 1.06 0 1.62-1.18 3.62-1.72 6.22-1.72a.75.75 0 0 0 .75-.75v-12a.75.75 0 0 0-.75-.75c-2.85 0-5.05.6-6.75 1.8Zm-.75 1.34v10.13C9.8 16.96 8.06 16.56 6 16.5V6.02c2.18.08 3.9.6 5.25 1.62Zm1.5 10.13V7.64C14.1 6.62 15.82 6.1 18 6.02V16.5c-2.06.06-3.8.46-5.25 1.27Z" fill="currentColor"/></svg>';
let nextId = 0;

/** Height in pixels that lets a passage be read comfortably. */
const ROOMY = 320;

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  attributes: Record<string, string> = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

function button(className: string, icon: string, label: string, attributes: Record<string, string> = {}) {
  const node = element('button', className, { type: 'button', ...attributes });
  node.innerHTML = icon;
  node.append(element('span', 'bible-popover__button-label'));
  node.lastElementChild!.textContent = label;
  return node;
}

/**
 * The floating card that shows a passage. It only draws what it is told to
 * and reports what the reader does; `BibleController` decides everything else.
 * Passage text comes from the network, so it is always set as text, never markup.
 */
export class BiblePopover {
  readonly dom: HTMLElement;
  readonly kind: PopoverKind;
  readonly input: HTMLInputElement | null = null;

  private readonly labels: BibleLabels;
  private readonly handlers: PopoverHandlers;
  private readonly title: HTMLElement;
  private readonly translations: HTMLElement;
  private readonly body: HTMLElement;
  private readonly footer: HTMLElement;
  private readonly insertButton: HTMLButtonElement | null;
  private readonly copyButton: HTMLButtonElement;
  private readonly contextButton: HTMLButtonElement;
  private readonly listId = `bible-suggestions-${++nextId}`;
  private stopTracking: (() => void) | null = null;
  private copiedTimer: ReturnType<typeof setTimeout> | undefined;
  private destroyed = false;

  constructor(options: PopoverOptions) {
    const { kind, labels, handlers } = options;
    this.kind = kind;
    this.labels = labels;
    this.handlers = handlers;

    this.dom = element('div', 'bible-popover', {
      role: 'dialog',
      'data-kind': kind,
      'data-state': 'closed',
      'data-status': 'empty',
    });

    if (kind === 'picker') {
      const search = element('div', 'bible-popover__search');
      search.innerHTML = ICONS.search;
      this.input = element('input', 'bible-popover__input', {
        type: 'text',
        role: 'combobox',
        placeholder: labels.pickerPlaceholder,
        'aria-label': labels.pickerLabel,
        'aria-expanded': 'false',
        'aria-controls': this.listId,
        'aria-autocomplete': 'list',
        autocomplete: 'off',
        autocapitalize: 'words',
        autocorrect: 'off',
        spellcheck: 'false',
        enterkeyhint: 'done',
      });
      search.append(this.input);
      this.dom.append(search);
      this.input.addEventListener('input', () => handlers.onQuery(this.input!.value));
    }

    const header = element('div', 'bible-popover__header');
    this.title = element('div', 'bible-popover__title');
    this.translations = element('div', 'bible-popover__translations', {
      role: 'radiogroup',
      'aria-label': labels.translation,
    });
    for (const translation of options.translations) {
      const choice = element('button', 'bible-popover__translation', {
        type: 'button',
        role: 'radio',
        'aria-checked': 'false',
        'data-translation': translation.id,
        title: translation.name,
        tabindex: '-1',
      });
      choice.textContent = translation.label;
      this.translations.append(choice);
    }
    header.append(this.title, this.translations);
    if (options.translations.length < 2) this.translations.hidden = true;
    if (kind === 'preview') {
      header.append(button('bible-popover__close', ICONS.close, '', { 'data-action': 'close', 'aria-label': labels.close }));
    }

    this.body = element('div', 'bible-popover__body');

    this.footer = element('div', 'bible-popover__footer');
    this.insertButton = options.canInsert
      ? button('bible-popover__button bible-popover__button--primary', ICONS.insert, labels.insert, { 'data-action': 'insert' })
      : null;
    this.copyButton = button('bible-popover__button', ICONS.copy, labels.copy, { 'data-action': 'copy' });
    this.contextButton = button('bible-popover__button', ICONS.book, labels.showChapter, {
      'data-action': 'context',
      'aria-pressed': 'false',
    });
    if (this.insertButton) this.footer.append(this.insertButton);
    this.footer.append(this.copyButton, this.contextButton);
    if (kind === 'picker') {
      const hint = element('span', 'bible-popover__hint');
      hint.textContent = labels.pickerInsertHint;
      this.footer.append(hint);
    }

    this.dom.append(header, this.body, this.footer);
    this.setTitle('');
    this.setActionsEnabled(false);

    // Keep focus and the selection in the editor while the reader uses the card.
    this.dom.addEventListener('mousedown', (event) => {
      if (event.target !== this.input) event.preventDefault();
    });
    this.dom.addEventListener('pointerdown', () => handlers.onInteract());
    this.dom.addEventListener('pointerenter', () => handlers.onPointerEnter());
    this.dom.addEventListener('pointerleave', () => handlers.onPointerLeave());
    this.dom.addEventListener('click', this.onClick);
    this.dom.addEventListener('keydown', this.onKeyDown);

    options.root.append(this.dom);
  }

  /** Places the card beside `anchor` and keeps it there as the page scrolls and resizes. */
  attach(anchor: () => DOMRect, context?: Element) {
    const reference = { getBoundingClientRect: anchor, contextElement: context };
    const update = () => {
      if (this.destroyed) return;
      // Open towards the roomier side. Left to itself the card would shrink to
      // fit below the reference before ever trying above it.
      const rect = anchor();
      const viewport = window.visualViewport;
      const below = (viewport ? viewport.offsetTop + viewport.height : window.innerHeight) - rect.bottom;
      const above = rect.top - (viewport?.offsetTop ?? 0);
      void computePosition(reference, this.dom, {
        placement: below < ROOMY && above > below ? 'top-start' : 'bottom-start',
        middleware: [
          offset(8),
          flip({ padding: 8 }),
          shift({ padding: 8 }),
          size({
            padding: 8,
            apply: ({ availableHeight, elements }) => {
              elements.floating.style.setProperty('--bible-available-height', `${Math.max(160, Math.floor(availableHeight))}px`);
            },
          }),
          hide(),
        ],
      }).then(({ x, y, placement, middlewareData }) => {
        if (this.destroyed) return;
        this.dom.style.left = `${x}px`;
        this.dom.style.top = `${y}px`;
        this.dom.dataset.placement = placement.startsWith('top') ? 'top' : 'bottom';
        // Don't leave the card hanging once its reference has scrolled out of view.
        this.dom.style.visibility = middlewareData.hide?.referenceHidden ? 'hidden' : '';
      });
    };
    this.stopTracking?.();
    this.stopTracking = autoUpdate(reference, this.dom, update);
    requestAnimationFrame(() => {
      if (!this.destroyed) this.dom.dataset.state = 'open';
    });
  }

  contains(target: EventTarget | null) {
    return target instanceof Node && this.dom.contains(target);
  }

  hasFocus() {
    return this.dom.contains(document.activeElement);
  }

  /** Moves focus into the card, for readers using the keyboard. */
  focus() {
    const target =
      this.input ??
      this.dom.querySelector<HTMLElement>('.bible-popover__button:not(:disabled)') ??
      this.translations.querySelector<HTMLElement>('[aria-checked="true"]') ??
      this.dom.querySelector<HTMLElement>('button');
    target?.focus({ preventScroll: true });
  }

  setTitle(text: string) {
    this.title.textContent = text;
    this.dom.setAttribute('aria-label', text || this.labels.pickerLabel);
  }

  setTranslation(id: string) {
    for (const choice of this.translations.children) {
      const checked = choice.getAttribute('data-translation') === id;
      choice.setAttribute('aria-checked', String(checked));
      choice.setAttribute('tabindex', checked ? '0' : '-1');
    }
  }

  showLoading() {
    this.setStatus('loading');
    this.setActionsEnabled(false);
    const skeleton = element('div', 'bible-popover__skeleton', { role: 'status', 'aria-label': this.labels.loading });
    for (let line = 0; line < 3; line++) skeleton.append(element('span', 'bible-popover__skeleton-line'));
    this.body.replaceChildren(skeleton);
  }

  showMessage(text: string) {
    this.setStatus('empty');
    this.setActionsEnabled(false);
    const message = element('p', 'bible-popover__message');
    message.textContent = text;
    this.body.replaceChildren(message);
  }

  showError(text: string, canRetry: boolean) {
    this.setStatus('error');
    this.setActionsEnabled(false);
    const message = element('p', 'bible-popover__message bible-popover__message--error', { role: 'alert' });
    message.textContent = text;
    this.body.replaceChildren(message);
    if (canRetry) {
      const retry = element('button', 'bible-popover__retry', { type: 'button', 'data-action': 'retry' });
      retry.textContent = this.labels.retry;
      this.body.append(retry);
    }
  }

  showSuggestions(books: readonly BibleBook[], active: number) {
    this.setStatus('suggest');
    this.setActionsEnabled(false);
    const list = element('ul', 'bible-popover__suggestions', { role: 'listbox', id: this.listId });
    books.forEach((book, index) => {
      const item = element('li', 'bible-popover__suggestion', {
        role: 'option',
        id: `${this.listId}-${index}`,
        'data-book': book.id,
        'aria-selected': String(index === active),
      });
      const name = element('span', 'bible-popover__suggestion-name');
      name.textContent = book.name;
      const chapters = element('span', 'bible-popover__suggestion-meta');
      chapters.textContent = book.verses.length === 1 ? '1 chapter' : `${book.verses.length} chapters`;
      item.append(name, chapters);
      list.append(item);
    });
    this.body.replaceChildren(list);
    this.input?.setAttribute('aria-expanded', 'true');
    this.input?.setAttribute('aria-activedescendant', `${this.listId}-${active}`);
    list.children[active]?.scrollIntoView?.({ block: 'nearest' });
  }

  /**
   * Draws the passage. With `context` on it shows the whole of each chapter
   * and marks the cited verses; otherwise just the cited verses.
   */
  showPassage(reference: BibleReference, chapters: readonly BibleChapter[], context: boolean) {
    this.setStatus('ready');
    this.setActionsEnabled(true);

    const wholeChapters = reference.ranges.every((range) => range.verse === undefined);
    this.contextButton.hidden = wholeChapters;
    this.contextButton.setAttribute('aria-pressed', String(context));
    this.contextButton.lastElementChild!.textContent = context ? this.labels.showPassage : this.labels.showChapter;

    const text = element('div', 'bible-text');
    const showChapterTitles = context || referenceChapters(reference).length > 1;
    let shown = 0;

    for (const chapter of chapters) {
      const verses: (PassageVerse & { cited: boolean })[] = chapter.verses
        .map((verse) => ({
          ...verse,
          chapter: chapter.chapter,
          cited: referenceIncludes(reference, chapter.chapter, verse.number),
        }))
        .filter((verse) => context || verse.cited);
      if (verses.length === 0) continue;
      shown += verses.length;

      if (showChapterTitles) {
        const heading = element('div', 'bible-text__chapter');
        const book = getBook(reference.book);
        heading.textContent = `${reference.book === 'PSA' ? 'Psalm' : book.name} ${chapter.chapter}`;
        text.append(heading);
      }

      for (const paragraph of groupParagraphs(verses)) {
        const first = paragraph[0]!;
        if (context && first.heading) {
          const heading = element('div', 'bible-text__heading');
          heading.textContent = first.heading;
          text.append(heading);
        }
        const block = element('p', 'bible-text__paragraph');
        if (paragraph.some((verse) => verse.lines)) block.classList.add('bible-text__paragraph--poetry');
        for (const verse of paragraph) block.append(this.renderVerse(verse, context && verse.cited), ' ');
        text.append(block);
      }
    }

    text.classList.toggle('bible-text--single', shown === 1);
    text.classList.toggle('bible-text--context', context);
    this.body.replaceChildren(text);
    this.body.scrollTop = 0;
    if (context && !wholeChapters) {
      const cited = text.querySelector<HTMLElement>('.bible-verse--cited');
      if (cited) this.body.scrollTop = Math.max(0, cited.offsetTop - this.body.offsetTop - 28);
    }
  }

  flashCopied() {
    clearTimeout(this.copiedTimer);
    this.copyButton.innerHTML = ICONS.check;
    this.copyButton.append(element('span', 'bible-popover__button-label'));
    this.copyButton.lastElementChild!.textContent = this.labels.copied;
    this.copyButton.dataset.copied = 'true';
    this.copiedTimer = setTimeout(() => {
      this.copyButton.innerHTML = ICONS.copy;
      this.copyButton.append(element('span', 'bible-popover__button-label'));
      this.copyButton.lastElementChild!.textContent = this.labels.copy;
      delete this.copyButton.dataset.copied;
    }, 1600);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopTracking?.();
    clearTimeout(this.copiedTimer);
    this.dom.dataset.state = 'closed';
    this.dom.style.pointerEvents = 'none';
    // It stays in the page while it fades out; keep it out of the accessibility tree meanwhile.
    this.dom.setAttribute('aria-hidden', 'true');
    const animated =
      typeof matchMedia === 'function' && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (animated) setTimeout(() => this.dom.remove(), 140);
    else this.dom.remove();
  }

  private renderVerse(verse: PassageVerse, cited: boolean) {
    const node = element('span', cited ? 'bible-verse bible-verse--cited' : 'bible-verse');
    const number = element('sup', 'bible-verse__number');
    number.textContent = String(verse.number);
    if (!verse.lines) {
      node.append(number, verse.text);
      return node;
    }
    verse.lines.forEach((line, index) => {
      const row = element('span', 'bible-verse__line');
      if (line.indent > 0) row.style.setProperty('--bible-indent', String(line.indent));
      if (index === 0) row.append(number);
      row.append(line.text);
      node.append(row);
    });
    return node;
  }

  private setStatus(status: 'empty' | 'loading' | 'ready' | 'error' | 'suggest') {
    this.dom.dataset.status = status;
    if (status !== 'suggest') {
      this.input?.setAttribute('aria-expanded', 'false');
      this.input?.removeAttribute('aria-activedescendant');
    }
  }

  private setActionsEnabled(enabled: boolean) {
    for (const control of [this.insertButton, this.copyButton, this.contextButton]) {
      if (control) control.disabled = !enabled;
    }
  }

  private onClick = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    const action = target?.closest<HTMLElement>('[data-action]');
    if (action && !(action as HTMLButtonElement).disabled) {
      this.handlers.onAction(action.dataset.action as PopoverAction);
      return;
    }
    const translation = target?.closest<HTMLElement>('[data-translation]');
    if (translation) {
      this.handlers.onTranslation(translation.dataset.translation!);
      return;
    }
    const suggestion = target?.closest<HTMLElement>('[data-book]');
    if (suggestion) this.handlers.onSuggestion(getBook(suggestion.dataset.book as BibleBook['id']));
  };

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.handlers.onEscape();
      return;
    }

    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.getAttribute('role') === 'radio' && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
      const choices = [...this.translations.querySelectorAll<HTMLElement>('[role="radio"]')];
      const step = event.key === 'ArrowRight' ? 1 : -1;
      const next = choices[(choices.indexOf(target) + step + choices.length) % choices.length]!;
      event.preventDefault();
      next.focus();
      this.handlers.onTranslation(next.dataset.translation!);
      return;
    }

    if (target === this.input) {
      const suggesting = this.dom.dataset.status === 'suggest';
      if (event.key === 'Enter' || (event.key === 'Tab' && suggesting && !event.shiftKey)) {
        event.preventDefault();
        this.handlers.onSubmit();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (this.handlers.onNavigate(event.key === 'ArrowDown' ? 1 : -1)) event.preventDefault();
        return;
      }
    }

    // Focus that came in by keyboard stays in the card until it closes.
    if (event.key === 'Tab') {
      const stops = [...this.dom.querySelectorAll<HTMLElement>('input, button')].filter(
        (stop) => !(stop as HTMLButtonElement).disabled && !stop.hidden && stop.tabIndex >= 0,
      );
      if (stops.length === 0) return;
      const index = stops.indexOf(document.activeElement as HTMLElement);
      const next = stops[(index + (event.shiftKey ? -1 : 1) + stops.length) % stops.length]!;
      event.preventDefault();
      next.focus();
    }
  };
}
