import { keydownHandler } from '@milkdown/kit/prose/keymap';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { Selection, type Command, type EditorState } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { suggestBooks, type BibleBook } from '../books.js';
import {
  cachedProvider,
  findTranslation,
  loadChapters,
  passageFromChapters,
  peekChapters,
  toBibleError,
  type BiblePassage,
  type BibleProvider,
  type BibleTranslation,
  type CachedBibleProvider,
  type LoadedChapters,
} from '../provider.js';
import { findReferences, formatReference, parseReference, type BibleReference } from '../reference.js';
import { currentTranslation, type BibleConfig } from './config.js';
import {
  REF_CLASS,
  bibleKey,
  inlineInsertTarget,
  loneReferenceBlock,
  referenceAt,
  type BibleMeta,
  type DocRange,
} from './detect.js';
import { citationFor, passageToNodes, passageToText } from './passage.js';
import { BiblePopover, type PopoverAction, type PopoverHandlers, type PopoverKind } from './popover.js';

export interface ControllerHost {
  getConfig(): BibleConfig;
  /** Remembers the translation the reader picked. */
  setTranslation(translation: BibleTranslation): void;
}

interface Session {
  kind: PopoverKind;
  popover: BiblePopover;
  reference: BibleReference | null;
  translation: BibleTranslation;
  /** The reference in the document, or the cursor for the picker. */
  anchor: DocRange;
  /** Stays open until dismissed, rather than closing when the pointer leaves. */
  pinned: boolean;
  /** Opened by a click on the reference, so it closes when the cursor moves off it. */
  followsSelection: boolean;
  context: boolean;
  loaded: LoadedChapters | null;
  /** Counts loads, so a slow answer can't replace a newer one. */
  loadId: number;
  insertWhenLoaded: boolean;
  suggestions: BibleBook[];
  activeSuggestion: number;
  queryTimer?: ReturnType<typeof setTimeout>;
}

interface InsertRange {
  from: number;
  to: number;
  /** Put the cursor on the line after the passage. */
  moveCursor: boolean;
}


const caches = new WeakMap<BibleProvider, CachedBibleProvider>();

function cacheFor(provider: BibleProvider) {
  let cached = caches.get(provider);
  if (!cached) {
    cached = cachedProvider(provider);
    caches.set(provider, cached);
  }
  return cached;
}

function sameRange(a: DocRange, b: DocRange) {
  return a.from === b.from && a.to === b.to;
}

function isRange(value: unknown): value is DocRange {
  return typeof value === 'object' && value !== null && 'from' in value && 'to' in value;
}

function afterTopBlock(doc: ProseNode, pos: number) {
  const $pos = doc.resolve(Math.min(pos, doc.content.size));
  return $pos.depth > 0 ? $pos.after(1) : $pos.pos;
}

/** Where a passage goes when asked for at the cursor: over an empty line, else below the current block. */
function cursorInsertRange(state: EditorState): InsertRange {
  const { $from, to } = state.selection;
  if ($from.depth === 1 && $from.parent.type.name === 'paragraph' && $from.parent.content.size === 0) {
    return { from: $from.before(1), to: $from.after(1), moveCursor: true };
  }
  const at = afterTopBlock(state.doc, to);
  return { from: at, to: at, moveCursor: true };
}

/**
 * Runs the plugin for one editor: watches the pointer and keyboard, opens and
 * closes the popover, loads passages and writes them into the document.
 */
export class BibleController {
  private session: Session | null = null;
  private hoverTimer: ReturnType<typeof setTimeout> | undefined;
  private closeTimer: ReturnType<typeof setTimeout> | undefined;
  private flashTimer: ReturnType<typeof setTimeout> | undefined;
  private hoverRange: DocRange | null = null;
  private pointer = { x: NaN, y: NaN };
  private pointerMovedSinceEdit = true;
  private keys: { id: string; handler: (view: EditorView, event: KeyboardEvent) => boolean } | null = null;
  private destroyed = false;

  constructor(
    private readonly view: EditorView,
    private readonly host: ControllerHost,
  ) {
    const { dom } = view;
    dom.addEventListener('pointerover', this.onPointerOver);
    dom.addEventListener('pointerout', this.onPointerOut);
    dom.addEventListener('click', this.onClick);
    dom.ownerDocument.addEventListener('pointerdown', this.onDocumentPointerDown, true);
    dom.ownerDocument.addEventListener('pointermove', this.onDocumentPointerMove, { passive: true });
  }

  get isOpen() {
    return this.session !== null;
  }

  // --- Opening and closing -------------------------------------------------

  /** Opens the passage for the reference at the cursor. Returns false if there is none. */
  showAtSelection(focus = false): boolean {
    const { selection } = this.view.state;
    if (!selection.empty) return false;
    const found = referenceAt(this.view.state, selection.from);
    if (!found) return false;
    return this.openPreview(found, { pinned: true, followsSelection: !focus, focus });
  }

  /** Opens the search box for inserting a passage at the cursor. */
  openPicker(): boolean {
    if (!this.view.editable) return false;
    this.close();
    const config = this.host.getConfig();
    const translation = this.translationFor(undefined);
    if (!translation) return false;

    const { from } = this.view.state.selection;
    const session = this.open('picker', { from, to: from }, translation);
    session.pinned = true;
    session.popover.showMessage(config.labels.pickerEmpty);
    session.popover.focus();
    return true;
  }

  private openPreview(
    found: DocRange & { ref: string; version?: string },
    options: { pinned: boolean; followsSelection?: boolean; focus?: boolean },
  ): boolean {
    const reference = parseReference(found.ref);
    const translation = this.translationFor(found.version);
    if (!reference || !translation) return false;

    this.close();
    const session = this.open('preview', { from: found.from, to: found.to }, translation);
    session.reference = reference;
    session.pinned = options.pinned;
    session.followsSelection = options.followsSelection ?? false;
    session.popover.setTitle(found.ref);
    this.dispatchMeta({ active: session.anchor });
    this.load(session);
    if (options.focus) session.popover.focus();
    return true;
  }

  private open(kind: PopoverKind, anchor: DocRange, translation: BibleTranslation): Session {
    const config = this.host.getConfig();
    const popover = new BiblePopover({
      kind,
      root: config.root ?? this.view.dom.parentElement ?? this.view.dom.ownerDocument.body,
      labels: config.labels,
      translations: config.provider.translations,
      canInsert: this.view.editable,
      handlers: this.handlers,
    });
    const session: Session = {
      kind,
      popover,
      reference: null,
      translation,
      anchor,
      pinned: false,
      followsSelection: false,
      context: false,
      loaded: null,
      loadId: 0,
      insertWhenLoaded: false,
      suggestions: [],
      activeSuggestion: 0,
    };
    this.session = session;
    popover.setTranslation(translation.id);
    popover.attach(() => this.anchorRect(session.anchor), this.view.dom);
    return session;
  }

  /**
   * `quiet` skips the transaction that clears the highlighted reference, for
   * callers already inside an editor update.
   */
  close(options: { focusEditor?: boolean; quiet?: boolean } = {}) {
    const session = this.session;
    clearTimeout(this.hoverTimer);
    clearTimeout(this.closeTimer);
    this.hoverRange = null;
    if (!session) return;

    this.session = null;
    clearTimeout(session.queryTimer);
    const hadFocus = session.popover.hasFocus();
    session.popover.destroy();
    if (!options.quiet) this.dispatchMeta({ active: null });
    if (options.focusEditor ?? hadFocus) this.view.focus();
  }

  /** Called after every editor update. */
  update(previous: EditorState) {
    const { state } = this.view;
    if (state.doc !== previous.doc) this.pointerMovedSinceEdit = false;
    const session = this.session;
    if (!session) return;

    // Positions no longer mean what they did, and the reference may be gone.
    if (state.doc !== previous.doc) {
      this.close({ quiet: true, focusEditor: false });
      return;
    }

    if (session.followsSelection && !state.selection.eq(previous.selection)) {
      const { from, to } = state.selection;
      if (from < session.anchor.from || to > session.anchor.to) {
        // Dispatching from inside an update isn't allowed, so tidy up just after it.
        this.close({ quiet: true, focusEditor: false });
        queueMicrotask(() => this.dispatchMeta({ active: null }));
      }
    }
  }

  destroy() {
    this.close({ quiet: true, focusEditor: false });
    this.destroyed = true;
    clearTimeout(this.flashTimer);
    const { dom } = this.view;
    dom.removeEventListener('pointerover', this.onPointerOver);
    dom.removeEventListener('pointerout', this.onPointerOut);
    dom.removeEventListener('click', this.onClick);
    dom.ownerDocument.removeEventListener('pointerdown', this.onDocumentPointerDown, true);
    dom.ownerDocument.removeEventListener('pointermove', this.onDocumentPointerMove);
  }

  // --- Keyboard ------------------------------------------------------------

  handleKeyDown(event: KeyboardEvent): boolean {
    if (event.key === 'Escape' && this.session && !event.isComposing) {
      this.close();
      return true;
    }

    const { keys } = this.host.getConfig();
    const id = `${keys.preview}|${keys.insert}`;
    if (this.keys?.id !== id) {
      const bindings: Record<string, Command> = {};
      if (keys.preview) bindings[keys.preview] = () => this.showAtSelection(true);
      if (keys.insert) bindings[keys.insert] = () => this.insertAtCursor();
      this.keys = { id, handler: keydownHandler(bindings) };
    }
    return this.keys.handler(this.view, event);
  }

  // --- Inserting -----------------------------------------------------------

  /**
   * Replaces a reference that has a line to itself with its passage. Returns
   * false, leaving the key for others, when the cursor isn't on such a line.
   */
  insertAtCursor(): boolean {
    if (!this.view.editable) return false;
    const target = inlineInsertTarget(this.view.state);
    const translation = this.translationFor(undefined);
    if (!target || !translation) return false;

    this.close();
    const options = { maxChapters: this.host.getConfig().maxChapters };
    const ref = formatReference(target.reference);
    const finish = (loaded: LoadedChapters, pos: number) => {
      const current = loneReferenceBlock(this.view.state.doc, pos + 1);
      if (!current || formatReference(current.reference) !== ref) return false;
      const passage = passageFromChapters(current.reference, loaded.translation, loaded.chapters);
      const { from, to } = this.view.state.selection;
      const range = { from: current.pos, to: current.pos + current.node.nodeSize };
      // Only move a cursor that is still on the line being replaced.
      return this.insertPassage(passage, { ...range, moveCursor: from >= range.from && to <= range.to });
    };

    const provider = cacheFor(this.host.getConfig().provider);
    const ready = peekChapters(provider, target.reference, translation.id, options);
    if (ready) {
      try {
        if (finish(ready, target.pos)) return true;
      } catch {
        // Fall through to loading, which reports the problem.
      }
    }

    this.dispatchMeta({ pending: target.pos });
    loadChapters(provider, target.reference, translation.id, options).then(
      (loaded) => {
        if (this.destroyed) return;
        const pos = bibleKey.getState(this.view.state)?.pending ?? null;
        if (pos === null) return;
        try {
          // False means the line was edited meanwhile; it is no longer ours to replace.
          if (!finish(loaded, pos)) this.dispatchMeta({ pending: null });
        } catch {
          this.failPending(pos);
        }
      },
      () => {
        if (this.destroyed) return;
        const pos = bibleKey.getState(this.view.state)?.pending ?? null;
        if (pos !== null) this.failPending(pos);
      },
    );
    return true;
  }

  /** Inserts a passage at the cursor once its text has loaded. */
  async insertReference(reference: BibleReference, translationId?: string): Promise<boolean> {
    const translation = this.translationFor(translationId);
    if (!translation || !this.view.editable) return false;
    const config = this.host.getConfig();
    const loaded = await loadChapters(cacheFor(config.provider), reference, translation.id, {
      maxChapters: config.maxChapters,
    });
    if (this.destroyed || !this.view.editable) return false;
    const passage = passageFromChapters(reference, loaded.translation, loaded.chapters);
    return this.insertPassage(passage, cursorInsertRange(this.view.state));
  }

  /** The line stays as it was; open its passage so the reader sees what went wrong. */
  private failPending(pos: number) {
    this.dispatchMeta({ pending: null });
    const found = referenceAt(this.view.state, pos + 1);
    if (found) this.openPreview(found, { pinned: true });
  }

  private insertFromSession() {
    const session = this.session;
    if (!session?.reference || !session.loaded || !this.view.editable) return;
    let passage: BiblePassage;
    try {
      passage = passageFromChapters(session.reference, session.loaded.translation, session.loaded.chapters);
    } catch {
      return;
    }

    const { state } = this.view;
    let range: InsertRange;
    if (session.kind === 'picker') {
      range = cursorInsertRange(state);
    } else {
      const lone = loneReferenceBlock(state.doc, session.anchor.from);
      const below = afterTopBlock(state.doc, session.anchor.from);
      range = lone
        ? { from: lone.pos, to: lone.pos + lone.node.nodeSize, moveCursor: true }
        : { from: below, to: below, moveCursor: false };
    }

    this.close({ focusEditor: true });
    this.insertPassage(passage, range);
  }

  private insertPassage(passage: BiblePassage, range: InsertRange): boolean {
    const { state } = this.view;
    const config = this.host.getConfig();
    const nodes = passageToNodes(state.schema, passage, {
      verseNumbers: config.verseNumbers,
      citation: citationFor(passage, config.citation),
    });
    if (nodes.length === 0) return false;

    const tr = state.tr.replaceWith(range.from, range.to, nodes);
    const end = range.from + nodes.reduce((size, node) => size + node.nodeSize, 0);
    const paragraph = state.schema.nodes.paragraph;
    const next = tr.doc.resolve(end).nodeAfter;
    const emptyLineFollows = next !== null && next.type === paragraph && next.content.size === 0;
    // Writing carries on from an empty line under the passage, not from inside
    // whatever came next. A passage also can't end the document: there would
    // be nowhere to write on.
    if (paragraph && !emptyLineFollows && (range.moveCursor || !next)) tr.insert(end, paragraph.create());
    if (range.moveCursor) tr.setSelection(Selection.near(tr.doc.resolve(end), 1)).scrollIntoView();
    tr.setMeta(bibleKey, { flash: range.from, pending: null } satisfies BibleMeta);
    this.view.dispatch(tr);

    if (!range.moveCursor) {
      const inserted = this.view.nodeDOM(range.from);
      if (inserted instanceof HTMLElement) inserted.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    }
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => this.dispatchMeta({ flash: null }), 1400);
    return true;
  }

  // --- Loading -------------------------------------------------------------

  private translationFor(idOrLabel: string | undefined) {
    const config = this.host.getConfig();
    return (
      findTranslation(config.provider, idOrLabel) ??
      findTranslation(config.provider, currentTranslation(config)) ??
      config.provider.translations[0]
    );
  }

  private prefetch(ref: string, version: string | undefined) {
    const reference = parseReference(ref);
    const translation = this.translationFor(version);
    const config = this.host.getConfig();
    if (!reference || !translation) return;
    loadChapters(cacheFor(config.provider), reference, translation.id, { maxChapters: config.maxChapters }).catch(
      () => {},
    );
  }

  private load(session: Session) {
    const { reference } = session;
    if (!reference) return;
    const config = this.host.getConfig();
    const provider = cacheFor(config.provider);
    const options = { maxChapters: config.maxChapters };
    const loadId = ++session.loadId;

    const ready = peekChapters(provider, reference, session.translation.id, options);
    if (ready) {
      this.show(session, ready);
      return;
    }

    session.loaded = null;
    session.popover.showLoading();
    loadChapters(provider, reference, session.translation.id, options).then(
      (loaded) => {
        if (this.session === session && session.loadId === loadId) this.show(session, loaded);
      },
      (error: unknown) => {
        if (this.session === session && session.loadId === loadId) this.showError(session, error);
      },
    );
  }

  private show(session: Session, loaded: LoadedChapters) {
    try {
      passageFromChapters(session.reference!, loaded.translation, loaded.chapters);
    } catch (error) {
      this.showError(session, error);
      return;
    }
    session.loaded = loaded;
    session.popover.showPassage(session.reference!, loaded.chapters, session.context);
    if (session.insertWhenLoaded) {
      session.insertWhenLoaded = false;
      this.insertFromSession();
    }
  }

  private showError(session: Session, error: unknown) {
    const failure = toBibleError(error);
    session.loaded = null;
    session.insertWhenLoaded = false;
    session.popover.showError(failure.message, failure.code === 'failed' || failure.code === 'offline');
  }

  // --- What the reader does in the popover -----------------------------------

  private readonly handlers: PopoverHandlers = {
    onAction: (action: PopoverAction) => {
      const session = this.session;
      if (!session) return;
      if (action === 'insert') this.insertFromSession();
      else if (action === 'copy') this.copy(session);
      else if (action === 'retry') this.load(session);
      else if (action === 'close') this.close();
      else if (action === 'context' && session.loaded) {
        session.context = !session.context;
        session.popover.showPassage(session.reference!, session.loaded.chapters, session.context);
      }
    },
    onTranslation: (id) => {
      const session = this.session;
      const translation = findTranslation(this.host.getConfig().provider, id);
      if (!session || !translation || translation.id === session.translation.id) return;
      session.translation = translation;
      session.popover.setTranslation(translation.id);
      this.host.setTranslation(translation);
      if (session.reference) this.load(session);
    },
    onEscape: () => this.close({ focusEditor: true }),
    onPointerEnter: () => clearTimeout(this.closeTimer),
    onPointerLeave: () => {
      if (this.session && !this.session.pinned) this.scheduleClose();
    },
    onInteract: () => {
      if (this.session) this.session.pinned = true;
    },
    onQuery: (text) => this.query(text),
    onSubmit: () => {
      const session = this.session;
      if (!session) return;
      const suggestion = session.suggestions[session.activeSuggestion];
      if (suggestion) this.chooseBook(session, suggestion);
      else if (session.loaded) this.insertFromSession();
      else if (session.reference) {
        // Enter came before the text did: insert as soon as it arrives.
        session.insertWhenLoaded = true;
        if (session.queryTimer !== undefined) {
          clearTimeout(session.queryTimer);
          session.queryTimer = undefined;
          this.load(session);
        }
      }
    },
    onSuggestion: (book) => {
      if (this.session) this.chooseBook(this.session, book);
    },
    onNavigate: (step) => {
      const session = this.session;
      if (!session || session.suggestions.length === 0) return false;
      const count = session.suggestions.length;
      session.activeSuggestion = (session.activeSuggestion + step + count) % count;
      session.popover.showSuggestions(session.suggestions, session.activeSuggestion);
      return true;
    },
  };

  private copy(session: Session) {
    if (!session.reference || !session.loaded) return;
    const config = this.host.getConfig();
    const passage = passageFromChapters(session.reference, session.loaded.translation, session.loaded.chapters);
    const text = passageToText(passage, {
      verseNumbers: config.verseNumbers,
      citation: citationFor(passage, config.citation),
    });
    navigator.clipboard?.writeText(text).then(
      () => session.popover.flashCopied(),
      () => {},
    );
  }

  private chooseBook(session: Session, book: BibleBook) {
    const input = session.popover.input;
    if (!input) return;
    input.value = `${book.name} `;
    input.focus({ preventScroll: true });
    this.query(input.value);
  }

  /** Follows the search box: a passage once the text reads as a reference, book suggestions until then. */
  private query(text: string) {
    const session = this.session;
    if (!session || session.kind !== 'picker') return;
    const { labels, maxChapters, provider } = this.host.getConfig();
    const { popover } = session;
    clearTimeout(session.queryTimer);
    session.queryTimer = undefined;
    session.insertWhenLoaded = false;
    session.suggestions = [];
    session.activeSuggestion = 0;

    const typed = text.trim();
    const match = typed ? findReferences(typed, { loose: true })[0] : undefined;
    if (match && match.index === 0) {
      session.reference = match.reference;
      popover.setTitle(formatReference(match.reference));
      const ready = peekChapters(cacheFor(provider), match.reference, session.translation.id, { maxChapters });
      if (ready) {
        this.show(session, ready);
        return;
      }
      // Wait for a pause in typing before asking the network.
      session.loaded = null;
      session.loadId++;
      popover.showLoading();
      session.queryTimer = setTimeout(() => {
        session.queryTimer = undefined;
        this.load(session);
      }, 200);
      return;
    }

    session.reference = null;
    session.loaded = null;
    session.loadId++;
    popover.setTitle('');
    if (!typed) {
      popover.showMessage(labels.pickerEmpty);
      return;
    }

    const books = suggestBooks(typed);
    const chosen = /\s$/.test(text) ? books.find((book) => book.name.toLowerCase() === typed.toLowerCase()) : undefined;
    if (chosen) popover.showMessage(labels.pickerChapterHint.replaceAll('{book}', chosen.name));
    else if (books.length === 0) popover.showMessage(labels.pickerNoMatch);
    else {
      session.suggestions = books;
      popover.showSuggestions(books, 0);
    }
  }

  // --- Pointer -------------------------------------------------------------

  private referenceFromTarget(target: EventTarget | null) {
    const element = target instanceof Element ? target.closest(`.${REF_CLASS}`) : null;
    if (!element || !this.view.dom.contains(element)) return null;
    try {
      return referenceAt(this.view.state, this.view.posAtDOM(element, 0));
    } catch {
      return null;
    }
  }

  private scheduleClose() {
    clearTimeout(this.closeTimer);
    this.closeTimer = setTimeout(() => {
      if (this.session && !this.session.pinned) this.close();
    }, 220);
  }

  private readonly onPointerOver = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse' || event.buttons !== 0) return;
    // A reference typed under a resting pointer counts as hovered; don't pop up over the writing.
    if (!this.pointerMovedSinceEdit) return;
    const found = this.referenceFromTarget(event.target);
    if (found) this.hover(found);
  };

  private hover(found: DocRange & { ref: string; version?: string }) {
    const session = this.session;
    if (session?.kind === 'picker' || session?.pinned) return;
    if (session && sameRange(session.anchor, found)) {
      clearTimeout(this.closeTimer);
      return;
    }
    if (this.hoverRange && sameRange(this.hoverRange, found)) return;

    // Fetch while the pointer settles, so the text is usually there when the card opens.
    clearTimeout(this.hoverTimer);
    this.hoverRange = { from: found.from, to: found.to };
    this.prefetch(found.ref, found.version);
    this.hoverTimer = setTimeout(() => {
      this.hoverRange = null;
      const current = referenceAt(this.view.state, found.from);
      if (current?.ref === found.ref) this.openPreview(current, { pinned: false });
    }, this.host.getConfig().hoverDelay);
  }

  private readonly onPointerOut = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    const found = this.referenceFromTarget(event.target);
    if (!found) return;
    // A reference with bold or italic inside it is several elements; moving between them isn't leaving.
    const next = this.referenceFromTarget(event.relatedTarget);
    if (next && sameRange(next, found)) return;

    clearTimeout(this.hoverTimer);
    this.hoverRange = null;
    if (this.session && !this.session.pinned) this.scheduleClose();
  };

  private readonly onClick = (event: MouseEvent) => {
    if (event.button !== 0) return;
    const found = this.referenceFromTarget(event.target);
    // A click that ends a drag has selected text; leave it alone.
    if (!found || !this.view.state.selection.empty) return;

    clearTimeout(this.hoverTimer);
    clearTimeout(this.closeTimer);
    this.hoverRange = null;
    const session = this.session;
    if (session?.kind === 'preview' && sameRange(session.anchor, found)) {
      session.pinned = true;
      session.followsSelection = true;
      return;
    }
    this.openPreview(found, { pinned: true, followsSelection: true });
  };

  // Browsers re-send the last position when the page changes under a still
  // pointer, so only a new position counts as movement.
  private readonly onDocumentPointerMove = (event: PointerEvent) => {
    if (event.clientX === this.pointer.x && event.clientY === this.pointer.y) return;
    this.pointer = { x: event.clientX, y: event.clientY };
    if (this.pointerMovedSinceEdit) return;
    this.pointerMovedSinceEdit = true;
    // The move may have landed on a reference; its "over" event came first and was ignored.
    if (event.pointerType !== 'mouse' || event.buttons !== 0) return;
    const found = this.referenceFromTarget(event.target);
    if (found) this.hover(found);
  };

  private readonly onDocumentPointerDown = (event: PointerEvent) => {
    const session = this.session;
    if (!session || session.popover.contains(event.target)) return;
    // A press on the open reference is about to pin it, not dismiss it.
    const found = session.kind === 'preview' ? this.referenceFromTarget(event.target) : null;
    if (found && sameRange(found, session.anchor)) return;
    this.close({ focusEditor: false });
  };

  // --- Helpers -------------------------------------------------------------

  private dispatchMeta(meta: BibleMeta) {
    if (this.destroyed || this.view.isDestroyed) return;
    const value = bibleKey.getState(this.view.state);
    if (!value) return;
    const unchanged = (Object.keys(meta) as (keyof BibleMeta)[]).every((key) => {
      const next: unknown = meta[key];
      const current: unknown = value[key];
      return next === current || (isRange(next) && isRange(current) && sameRange(next, current));
    });
    if (!unchanged) this.view.dispatch(this.view.state.tr.setMeta(bibleKey, meta));
  }

  private lastRect: DOMRect | null = null;

  private anchorRect(range: DocRange): DOMRect {
    try {
      const start = this.view.coordsAtPos(range.from, 1);
      const end = range.to > range.from ? this.view.coordsAtPos(range.to, -1) : start;
      const left = Math.min(start.left, end.left);
      const right = Math.max(start.right, end.right);
      this.lastRect = new DOMRect(left, start.top, Math.max(1, right - left), Math.max(1, end.bottom - start.top));
    } catch {
      // The position may be gone mid-update; keep the card where it was.
      this.lastRect ??= this.view.dom.getBoundingClientRect();
    }
    return this.lastRect;
  }
}
