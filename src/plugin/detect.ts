import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { PluginKey, type EditorState, type Transaction } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { findReferences, formatReference, type BibleReference } from '../reference.js';

export const REF_CLASS = 'bible-ref';

interface RefSpec {
  bible: 'ref';
  /** The reference written the standard way; `parseReference` reads it back. */
  ref: string;
  version?: string;
}

export interface FoundReference {
  from: number;
  to: number;
  reference: BibleReference;
  /** Translation named after the reference, e.g. "(KJV)". */
  version?: string;
}

export interface DocRange {
  from: number;
  to: number;
}

export interface BibleState {
  decorations: DecorationSet;
  /** The reference whose passage is open. */
  active: DocRange | null;
  /** Start of a paragraph being replaced by its passage once the text arrives. */
  pending: number | null;
  /** Start of a passage that was just inserted, so it can be pointed out. */
  flash: number | null;
}

export type BibleMeta = Partial<Pick<BibleState, 'active' | 'pending' | 'flash'>>;

export const bibleKey = new PluginKey<BibleState>('MILKDOWN_BIBLE');

// Stands in for text that must not match (code, links) and for inline nodes,
// so offsets into the scanned text still line up with document positions.
const OPAQUE = '\ufffc';

function scanText(block: ProseNode) {
  let text = '';
  block.forEach((child) => {
    const hidden =
      !child.isText || child.marks.some((mark) => mark.type.spec.code || mark.type.name === 'link');
    text += hidden ? OPAQUE.repeat(child.nodeSize) : child.text!;
  });
  return text;
}

function isProse(block: ProseNode) {
  return block.isTextblock && !block.type.spec.code;
}

/** References in a text block that starts at `pos`. */
export function referencesIn(block: ProseNode, pos: number): FoundReference[] {
  if (!isProse(block)) return [];
  return findReferences(scanText(block)).map((match) => ({
    from: pos + 1 + match.index,
    to: pos + 1 + match.end,
    reference: match.reference,
    ...(match.version ? { version: match.version } : {}),
  }));
}

/** The reference a text block consists of, if it holds nothing else. */
export function loneReference(block: ProseNode, pos: number): FoundReference | null {
  if (!isProse(block) || block.content.size > 80) return null;
  const text = scanText(block);
  const [match, ...others] = findReferences(text);
  if (!match || others.length > 0) return null;
  if (text.slice(0, match.index).trim() || text.slice(match.end).trim()) return null;
  return { from: pos + 1 + match.index, to: pos + 1 + match.end, reference: match.reference };
}

const CITATION_LEAD = /^\s*[—–-]\s*$/;
const CITATION_TAIL = /^(\s*\([^)]*\))?\s*$/;

/** Whether a paragraph is the "— John 3:16 (BSB)" line that closes a quoted passage. */
function isCitation(block: ProseNode, parent: ProseNode | null) {
  if (parent?.type.name !== 'blockquote' || parent.childCount < 2 || parent.lastChild !== block) return false;
  const text = scanText(block);
  const [match, ...others] = findReferences(text);
  if (!match || others.length > 0) return false;
  return CITATION_LEAD.test(text.slice(0, match.index)) && CITATION_TAIL.test(text.slice(match.end));
}

// Verse numbers in an inserted passage: "¹⁶" or, across chapters, "⁴:¹".
const VERSE_NUMBER = /[⁰¹²³⁴-⁹]+(?::[⁰¹²³⁴-⁹]+)?/g;

function decorate(doc: ProseNode, from: number, to: number) {
  const decorations: Decoration[] = [];
  doc.nodesBetween(from, to, (node, pos, parent) => {
    if (!node.isTextblock) return true;
    for (const found of referencesIn(node, pos)) {
      const ref = formatReference(found.reference);
      const spec: RefSpec = { bible: 'ref', ref, ...(found.version ? { version: found.version } : {}) };
      decorations.push(Decoration.inline(found.from, found.to, { class: REF_CLASS, 'data-bible-ref': ref }, spec));
    }
    if (isCitation(node, parent)) {
      const quoteStart = doc.resolve(pos).before();
      decorations.push(
        Decoration.node(quoteStart, quoteStart + parent!.nodeSize, { class: 'bible-passage' }),
        Decoration.node(pos, pos + node.nodeSize, { class: 'bible-passage-cite' }),
      );
    } else if (parent?.lastChild && parent.lastChild !== node && isCitation(parent.lastChild, parent)) {
      // Superscript digits come from whichever font has them, often two
      // different ones side by side; marking them lets the stylesheet settle it.
      for (const match of scanText(node).matchAll(VERSE_NUMBER)) {
        const start = pos + 1 + match.index;
        decorations.push(Decoration.inline(start, start + match[0].length, { class: 'bible-verse-number' }));
      }
    }
    return false;
  });
  return decorations;
}

/** Widens a changed range to the top-level blocks it touches. */
function blockRange(doc: ProseNode, from: number, to: number): DocRange {
  const size = doc.content.size;
  const $from = doc.resolve(Math.min(Math.max(from, 0), size));
  const $to = doc.resolve(Math.min(Math.max(to, 0), size));
  return {
    from: $from.depth > 0 ? $from.before(1) : $from.pos - ($from.nodeBefore?.nodeSize ?? 0),
    to: $to.depth > 0 ? $to.after(1) : $to.pos + ($to.nodeAfter?.nodeSize ?? 0),
  };
}

function changedRanges(tr: Transaction): DocRange[] {
  const ranges: DocRange[] = [];
  tr.mapping.maps.forEach((map, index) => {
    const rest = tr.mapping.slice(index + 1);
    let mapped = false;
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      mapped = true;
      ranges.push(blockRange(tr.doc, rest.map(newStart, -1), rest.map(newEnd, 1)));
    });
    // Adding or removing a mark (a link, inline code) changes what counts as
    // a reference without moving any positions.
    const step = tr.steps[index] as { from?: unknown; to?: unknown } | undefined;
    if (!mapped && typeof step?.from === 'number' && typeof step.to === 'number') {
      ranges.push(blockRange(tr.doc, rest.map(step.from, -1), rest.map(step.to, 1)));
    }
  });
  return ranges;
}

export function initialState(doc: ProseNode): BibleState {
  return {
    decorations: DecorationSet.create(doc, decorate(doc, 0, doc.content.size)),
    active: null,
    pending: null,
    flash: null,
  };
}

/** Keeps the marked references in step with the document, rescanning only blocks that changed. */
export function applyTransaction(tr: Transaction, value: BibleState): BibleState {
  const meta = tr.getMeta(bibleKey) as BibleMeta | undefined;
  if (!tr.docChanged && !meta) return value;

  let { decorations, active, pending, flash } = value;

  if (tr.docChanged) {
    decorations = decorations.map(tr.mapping, tr.doc);
    for (const range of changedRanges(tr)) {
      const stale = decorations.find(range.from, range.to).filter((item) => item.from >= range.from && item.to <= range.to);
      decorations = decorations.remove(stale).add(tr.doc, decorate(tr.doc, range.from, range.to));
    }
    active = null;
    flash = null;
    if (pending !== null) {
      const mapped = tr.mapping.mapResult(pending, 1);
      pending = mapped.deleted ? null : mapped.pos;
    }
  }

  if (meta?.active !== undefined) active = meta.active;
  if (meta?.pending !== undefined) pending = meta.pending;
  if (meta?.flash !== undefined) flash = meta.flash;

  return { decorations, active, pending, flash };
}

/** The marked reference at a document position, if there is one. */
export function referenceAt(state: EditorState, pos: number): (DocRange & { ref: string; version?: string }) | null {
  const found = bibleKey
    .getState(state)
    ?.decorations.find(pos, pos, (spec) => (spec as RefSpec).bible === 'ref')
    .find((item) => item.from <= pos && pos <= item.to);
  if (!found) return null;
  const spec = found.spec as RefSpec;
  return { from: found.from, to: found.to, ref: spec.ref, ...(spec.version ? { version: spec.version } : {}) };
}

export interface InsertTarget extends FoundReference {
  /** Start of the paragraph the reference fills. */
  pos: number;
  node: ProseNode;
}

/** The top-level paragraph at `pos` if a reference is all it holds. */
export function loneReferenceBlock(doc: ProseNode, pos: number): InsertTarget | null {
  const $pos = doc.resolve(Math.min(Math.max(pos, 0), doc.content.size));
  if ($pos.depth !== 1) return null;
  const node = $pos.parent;
  const start = $pos.before(1);
  const found = loneReference(node, start);
  return found ? { ...found, pos: start, node } : null;
}

/**
 * Where the insert key applies: the cursor sits at the end of a top-level
 * paragraph that holds a reference and nothing else.
 */
export function inlineInsertTarget(state: EditorState): InsertTarget | null {
  const { selection } = state;
  if (!selection.empty) return null;
  const { $from } = selection;
  if ($from.depth !== 1 || $from.parentOffset !== $from.parent.content.size) return null;
  return loneReferenceBlock(state.doc, $from.pos);
}

/** The plugin's decorations: marked references plus whatever follows the current state. */
export function decorationsFor(state: EditorState, hint: string | null): DecorationSet | null {
  const value = bibleKey.getState(state);
  if (!value) return null;

  const extra: Decoration[] = [];
  if (value.active) {
    extra.push(Decoration.inline(value.active.from, value.active.to, { class: 'bible-ref--active' }));
  }
  const flashNode = value.flash === null ? null : state.doc.nodeAt(value.flash);
  if (flashNode) {
    extra.push(Decoration.node(value.flash!, value.flash! + flashNode.nodeSize, { class: 'bible-passage--new' }));
  }
  const pendingNode = value.pending === null ? null : state.doc.nodeAt(value.pending);
  if (pendingNode) {
    extra.push(Decoration.node(value.pending!, value.pending! + pendingNode.nodeSize, { class: 'bible-loading' }));
  } else if (hint) {
    const target = inlineInsertTarget(state);
    if (target) {
      extra.push(
        Decoration.node(target.pos, target.pos + target.node.nodeSize, { class: 'bible-hint', 'data-bible-hint': hint }),
      );
    }
  }
  return extra.length > 0 ? value.decorations.add(state.doc, extra) : value.decorations;
}
