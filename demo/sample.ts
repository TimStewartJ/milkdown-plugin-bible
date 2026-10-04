export const sample = `Reading John 3:16-17 this morning, and it sent me back to Ps 23 and Romans 8:28; 12:1-2.

Rom 5:8

> ¹ The LORD is my shepherd;\\
> I shall not want.\\
> ² He makes me lie down in green pastures;\\
> He leads me beside quiet waters.
>
> — Psalm 23:1–2 (BSB)

Not references: John 45:3, at 12:30, mark 2 as done, \`John 3:16\` in code.
`;

// One translation setting for every editor on the page, kept between visits.
export const shared = {
  translation: () => localStorage.getItem('bible-translation') ?? 'BSB',
  onTranslationChange: (chosen: { id: string }) => localStorage.setItem('bible-translation', chosen.id),
};