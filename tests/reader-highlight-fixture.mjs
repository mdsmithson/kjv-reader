import { wordParts } from "./detail-fixture.mjs";
export const readerHighlightFixture =
  (verses, catalogue, owners) => (book, chapter) => {
    const chapterKey = `${book} ${chapter}`;
    return {
      book,
      chapter,
      verses: verses
        .filter((verse) => verse.book === book && verse.chapter === chapter)
        .map((verse) => {
          const seen = new Set();
          const words = wordParts(verse.text).map((part) => {
            const data = catalogue.detail(part.word);
            const first = data.firstMention;
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
                owners.get(part.word).has(chapterKey),
              firstMention,
            };
          });
          return { number: verse.number, words };
        }),
    };
  };
