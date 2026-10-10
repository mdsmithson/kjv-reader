// Independent string-based catalogue for the preview and UI command transport.
export const wordFixture = (verses, tokenize) => {
  const entries = new Map();
  for (const verse of verses) {
    for (const word of tokenize(verse.text)) {
      const entry = entries.get(word) ?? {
        word,
        count: 0,
        books: [],
        firstMention: verse,
        letters: (word.match(/\p{Alphabetic}/gu) ?? []).length,
      };
      entry.count++;
      const book = entry.books.find((book) => book.name === verse.book);
      if (book) book.count++;
      else entry.books.push({ name: verse.book, count: 1 });
      entries.set(word, entry);
    }
  }
  const words = [...entries.values()].sort((a, b) =>
    a.word < b.word ? -1 : a.word > b.word ? 1 : 0,
  );
  return {
    detail: (word) => entries.get(word.trim().toLowerCase()),
    list: (text, offset, books = null, count = null) => {
      const matches = words.filter(
        (entry) =>
          entry.word.includes(text.trim().toLowerCase()) &&
          (books == null || entry.books.length === books) &&
          (count == null || entry.count === count),
      );
      return {
        total: matches.length,
        entries: matches.slice(offset, offset + 50).map((entry) => ({
          word: entry.word,
          count: entry.count,
          books: entry.books.length,
        })),
      };
    },
  };
};
