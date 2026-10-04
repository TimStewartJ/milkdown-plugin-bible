# Changelog

## 0.1.2

- References are marked with a thin solid underline in the colour of the surrounding text, and turn the accent colour when pointed at or open. The dotted accent-coloured underline looked like a spelling or grammar mark.

## 0.1.1

No code changes. This is the first release published by GitHub Actions, so it carries a provenance statement linking it to the commit and workflow run that built it.

- README: npm and CI badges, and the screenshot now shows on npmjs.com.

## 0.1.0

First release.

- Finds Bible references in running text and underlines them, without changing the document.
- Passage popover on hover, click, tap or `Mod-Enter`, with a translation switch, the whole chapter in context, and copy.
- Inserts passages as block quotes: from the popover, with `Tab` after a reference on a line of its own, or from a search box that can be added to a slash menu.
- Passage text from the Free Use Bible API (BSB, WEB, KJV, ASV), behind a provider interface, with in-memory and optional persistent caching.
