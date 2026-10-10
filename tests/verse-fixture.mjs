import { wordRows, ordered } from "./detail-fixture.mjs";
// Independent string-based verse oracle for preview and UI command tests.
export const verseFixture = (corpus, tokenize, wordCatalogue) => {
  const lines = corpus.map((verse) => ({
    verse,
    tokens: tokenize(verse.text),
  }));
  const summaries = new Map();
  const details = new Map();
  const phrasesFor = (tokens) => {
    const phrases = new Set();
    for (let length = 2; length <= Math.min(32, tokens.length); length++)
      for (let start = 0; start + length <= tokens.length; start++)
        phrases.add(tokens.slice(start, start + length).join(" "));
    return [...phrases].sort();
  };
  const key = (verse) => `${verse.book} ${verse.chapter}:${verse.number}`;
  const summary = (line) => {
    if (!summaries.has(key(line.verse)))
      summaries.set(key(line.verse), {
        verse: line.verse,
        words: line.tokens.length,
        letters: (line.verse.text.match(/\p{Alphabetic}/gu) ?? []).length,
        phrases: phrasesFor(line.tokens).length,
      });
    return summaries.get(key(line.verse));
  };
  return {
    list: (book, offset) => {
      const matches = lines.filter(
        (line) => book == null || line.verse.book === book,
      );
      return {
        total: matches.length,
        entries: matches.slice(offset, offset + 50).map(summary),
      };
    },
    detail: (book, chapter, verse, offset, sort) => {
      const line = lines.find(
        (line) =>
          line.verse.book === book &&
          line.verse.chapter === chapter &&
          line.verse.number === verse,
      );
      if (!line) throw new Error("Verse not found");
      if (!details.has(key(line.verse))) {
        const candidates = phrasesFor(line.tokens);
        const metadata = new Map(
          candidates.map((phrase) => [
            phrase,
            {
              phrase,
              words: tokenize(phrase).length,
              letters: (phrase.match(/\p{Alphabetic}/gu) ?? []).length,
              occurrences: 0,
              owners: new Set(),
            },
          ]),
        );
        const lengths = [
          ...new Set(candidates.map((phrase) => tokenize(phrase).length)),
        ];
        for (const length of lengths)
          for (const other of lines)
            for (let i = 0; i + length <= other.tokens.length; i++) {
              const found = metadata.get(
                other.tokens.slice(i, i + length).join(" "),
              );
              if (found) {
                found.occurrences++;
                found.owners.add(other.verse.book);
              }
            }
        const allEntries = [...metadata.values()].map(
          ({ owners, ...entry }) => ({
            ...entry,
            books: owners.size,
          }),
        );
        const wordParts = [
          ...line.verse.text.matchAll(/[\p{L}\p{N}']+/gu),
        ].flatMap((match) => {
          const word = match[0].replace(/^'+|'+$/g, "");
          if (!word) return [];
          const start = match.index + match[0].indexOf(word);
          return [
            { start, end: start + word.length, word: word.toLowerCase() },
          ];
        });
        const visible = allEntries.filter(
          (entry) =>
            entry.occurrences !== 1 ||
            !allEntries.some(
              (parent) =>
                parent.occurrences === 1 &&
                parent.words > entry.words &&
                ` ${parent.phrase} `.includes(` ${entry.phrase} `),
            ),
        );
        const entries = visible.map((entry) => {
          const start = line.tokens.findIndex(
            (_, index) =>
              line.tokens.slice(index, index + entry.words).join(" ") ===
              entry.phrase,
          );
          let begin = wordParts[start].start;
          let end = wordParts[start + entry.words - 1].end;
          while (begin > 0 && "[({'\"‘“".includes(line.verse.text[begin - 1]))
            begin--;
          while (
            end < line.verse.text.length &&
            "])}'\".,;:!?‘’”".includes(line.verse.text[end])
          )
            end++;
          return { ...entry, display: line.verse.text.slice(begin, end) };
        });
        details.set(key(line.verse), {
          ...summary(line),
          wordParts,
          entries,
          wordEntries: wordRows(line.verse.text, wordParts, wordCatalogue),
        });
      }
      const { entries, ...detail } = details.get(key(line.verse));
      return {
        ...detail,
        phraseResults: {
          total: entries.length,
          entries: ordered(entries, sort).slice(offset, offset + 50),
          persistedLengths: [],
        },
      };
    },
  };
};
