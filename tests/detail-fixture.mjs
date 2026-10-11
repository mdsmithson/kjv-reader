import { equalCountRollup } from "./rollup-fixture.mjs";
export const wordParts = (text) =>
  [...text.matchAll(/[\p{L}\p{N}']+/gu)].flatMap((match) => {
    const word = match[0].replace(/^'+|'+$/g, "");
    if (!word) return [];
    const start = match.index + match[0].indexOf(word);
    return [{ start, end: start + word.length, word: word.toLowerCase() }];
  });
export const wordRows = (text, parts, catalogue) => {
  const unique = new Map();
  for (const part of parts)
    if (!unique.has(part.word)) {
      const word = catalogue.detail(part.word);
      unique.set(part.word, {
        word: part.word,
        display: text.slice(part.start, part.end),
        occurrences: word.count,
        letters: word.letters,
        books: word.books.length,
      });
    }
  return [...unique.values()].sort((a, b) =>
    a.word < b.word ? -1 : a.word > b.word ? 1 : 0,
  );
};
export const ordered = (
  entries,
  sort = { field: "phrase", direction: "asc" },
) =>
  [...entries].sort((a, b) => {
    const x = a[sort.field],
      y = b[sort.field];
    const primary = typeof x === "number" ? x - y : x < y ? -1 : x > y ? 1 : 0;
    const first = a.phrase ?? a.word,
      second = b.phrase ?? b.word;
    return (
      (primary || (first < second ? -1 : first > second ? 1 : 0)) *
      (sort.direction === "asc" ? 1 : -1)
    );
  });
export const phraseContents = (text, lines, tokenize, catalogue) => {
  const tokens = tokenize(text);
  const parts = wordParts(text);
  const metadata = new Map();
  for (let length = 2; length < tokens.length; length++)
    for (let start = 0; start + length <= tokens.length; start++) {
      const phrase = tokens.slice(start, start + length).join(" ");
      if (metadata.has(phrase)) continue;
      let begin = parts[start].start,
        end = parts[start + length - 1].end;
      while (begin > 0 && "[({'\"‘“".includes(text[begin - 1])) begin--;
      while (end < text.length && "])}'\".,;:!?‘’”".includes(text[end])) end++;
      metadata.set(phrase, {
        phrase,
        display: text.slice(begin, end),
        words: length,
        letters: (phrase.match(/\p{Alphabetic}/gu) ?? []).length,
        occurrences: 0,
        owners: new Set(),
      });
    }
  const locations = new Map();
  const lengths = [
    ...new Set([...metadata.values()].map((entry) => entry.words)),
  ];
  for (const length of lengths)
    for (const line of lines)
      for (let i = 0; i + length <= line.tokens.length; i++) {
        const entry = metadata.get(line.tokens.slice(i, i + length).join(" "));
        if (entry) {
          if (!locations.has(entry.phrase))
            locations.set(entry.phrase, { tokens: line.tokens, start: i });
          entry.occurrences++;
          entry.owners.add(line.book);
        }
      }
  const entries = [...metadata.values()].map(({ owners, ...entry }) => ({
    ...entry,
    books: owners.size,
  }));
  const isHidden = equalCountRollup(lines, tokenize);
  isHidden.prepare(entries, locations);
  const visible = entries.filter(
    (entry) => !isHidden(entry.phrase, entry.occurrences),
  );
  return {
    wordParts: parts,
    wordEntries: wordRows(text, parts, catalogue),
    subphraseResults: {
      total: visible.length,
      entries: ordered(visible),
      persistedLengths: [],
    },
  };
};
