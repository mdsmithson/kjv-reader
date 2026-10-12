import { wordParts } from "./detail-fixture.mjs";
// Independent word first/final occurrences; phrase spans come from prepared resources.
export const readerHighlightFixture = (
  verses,
  catalogue,
  owners,
  phraseSpans = () => [],
) => {
  const last = new Map();
  for (const verse of verses)
    for (const part of wordParts(verse.text))
      last.set(part.word, {
        book: verse.book,
        chapter: verse.chapter,
        number: verse.number,
        start: part.start,
      });
  return (book, chapter) => ({
    book,
    chapter,
    verses: verses
      .filter((verse) => verse.book === book && verse.chapter === chapter)
      .map((verse) => {
        const seen = new Set();
        const words = wordParts(verse.text).map((part) => {
          const data = catalogue.detail(part.word),
            first = data.firstMention,
            final = last.get(part.word);
          const firstMention =
            first.book === book &&
            first.chapter === chapter &&
            first.number === verse.number &&
            !seen.has(part.word);
          seen.add(part.word);
          return {
            ...part,
            count: data.count,
            exclusive:
              owners.get(part.word).size === 1 &&
              owners.get(part.word).has(`${book} ${chapter}`),
            firstMention,
            lastMention:
              final.book === book &&
              final.chapter === chapter &&
              final.number === verse.number &&
              final.start === part.start,
          };
        });
        return { number: verse.number, words, phrases: phraseSpans(verse) };
      }),
  });
};
export const preparedHighlightSpans = (entries, display, counts) => {
  const locations = new Map(
    entries.map((entry) => [
      `${entry.verse.book} ${entry.verse.chapter}:${entry.verse.number}`,
      entry,
    ]),
  );
  return (verse) => {
    const entry = locations.get(
      `${verse.book} ${verse.chapter}:${verse.number}`,
    );
    return Array.from({ length: entry.display_phrases }, (_, i) => {
      const rank = entry.display_start + i;
      return {
        start: display.getUint32(rank * 12 + 4, true),
        end: display.getUint32(rank * 12 + 8, true),
        count: counts.getUint32(rank * 4, true),
      };
    });
  };
};
