import type { Node as ProseNode, Schema } from '@milkdown/kit/prose/model';
import type { BiblePassage, PassageVerse } from '../provider.js';
import { formatReference, referenceChapters } from '../reference.js';

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';

/** "16" becomes "¹⁶": verse numbers that stay plain text in Markdown. */
export function toSuperscript(label: string) {
  return label.replace(/\d/g, (digit) => SUPERSCRIPT[Number(digit)]!);
}

/**
 * Splits verses into the paragraphs they are printed in. A new one starts
 * where the translation breaks, at a new chapter, and after skipped verses.
 */
export function groupParagraphs<T extends PassageVerse>(verses: readonly T[]): T[][] {
  const paragraphs: T[][] = [];
  let previous: T | undefined;
  for (const verse of verses) {
    const continues =
      previous !== undefined &&
      !verse.paragraph &&
      verse.chapter === previous.chapter &&
      verse.number === previous.number + 1;
    if (continues) paragraphs[paragraphs.length - 1]!.push(verse);
    else paragraphs.push([verse]);
    previous = verse;
  }
  return paragraphs;
}

/**
 * How verses are numbered in a passage: not at all for a single verse, and
 * with the chapter ("4:1") where a passage crosses into a new one.
 */
export function verseLabeller(passage: Pick<BiblePassage, 'reference' | 'verses'>, enabled = true) {
  const numbered = enabled && passage.verses.length > 1;
  const multiChapter = referenceChapters(passage.reference).length > 1;
  let chapter: number | undefined;
  return (verse: PassageVerse) => {
    if (!numbered) return '';
    const label = multiChapter && verse.chapter !== chapter ? `${verse.chapter}:${verse.number}` : `${verse.number}`;
    chapter = verse.chapter;
    return label;
  };
}

/** A paragraph as pieces of text, with `null` wherever a line breaks. */
function paragraphPieces(paragraph: readonly PassageVerse[], label: (verse: PassageVerse) => string) {
  const pieces: (string | null)[] = [];
  paragraph.forEach((verse, index) => {
    const previous = paragraph[index - 1];
    if (previous) pieces.push(verse.lines || previous.lines ? null : ' ');
    const number = label(verse);
    const prefix = number ? `${toSuperscript(number)} ` : '';
    if (verse.lines) {
      verse.lines.forEach((line, lineIndex) => {
        if (lineIndex > 0) pieces.push(null);
        pieces.push((lineIndex === 0 ? prefix : '') + line.text);
      });
    } else {
      pieces.push(prefix + verse.text);
    }
  });
  return pieces;
}

export interface PassageTextOptions {
  verseNumbers: boolean;
  citation: string;
}

export function citationFor(
  passage: BiblePassage,
  citation: (reference: string, translation: BiblePassage['translation']) => string,
) {
  return citation(formatReference(passage.reference), passage.translation);
}

/** The passage as plain text, for the clipboard. */
export function passageToText(passage: BiblePassage, options: PassageTextOptions): string {
  const label = verseLabeller(passage, options.verseNumbers);
  const paragraphs = groupParagraphs(passage.verses).map((paragraph) =>
    paragraphPieces(paragraph, label)
      .map((piece) => piece ?? '\n')
      .join(''),
  );
  return [...paragraphs, options.citation].join('\n\n');
}

/**
 * The passage as editor content: a block quote of its paragraphs, closed by
 * the citation. It is ordinary Markdown, so it reads the same anywhere.
 * Poetry keeps its lines with hard breaks.
 */
export function passageToNodes(schema: Schema, passage: BiblePassage, options: PassageTextOptions): ProseNode[] {
  const paragraphType = schema.nodes.paragraph;
  if (!paragraphType) return [];
  const breakType = schema.nodes.hardbreak ?? schema.nodes.hard_break;
  const label = verseLabeller(passage, options.verseNumbers);

  const paragraphs = groupParagraphs(passage.verses).map((paragraph) => {
    const content: ProseNode[] = [];
    let text = '';
    const flush = () => {
      if (text) content.push(schema.text(text));
      text = '';
    };
    for (const piece of paragraphPieces(paragraph, label)) {
      if (piece !== null) {
        text += piece;
      } else if (breakType) {
        flush();
        content.push(breakType.create());
      } else {
        text += ' ';
      }
    }
    flush();
    return paragraphType.create(null, content);
  });
  paragraphs.push(paragraphType.create(null, schema.text(options.citation)));

  const quoteType = schema.nodes.blockquote;
  return quoteType ? [quoteType.create(null, paragraphs)] : paragraphs;
}
