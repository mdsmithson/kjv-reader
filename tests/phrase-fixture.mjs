import { equalCountRollup } from "./rollup-fixture.mjs";
import { phraseContents } from "./detail-fixture.mjs";
// Independent string-based oracle for saved phrase browsing and verse details.
export const phraseFixture = (verses, tokenize, wordCatalogue) => {
  const lines = verses.map((verse) => ({
    ...verse,
    tokens: tokenize(verse.text),
  }));
  const isHidden = equalCountRollup(lines, tokenize);
  const contentsCache = new Map();
  const detail = (phrase, offset = 0) => {
    const original = phrase;
    if (!contentsCache.has(original))
      contentsCache.set(
        original,
        phraseContents(original, lines, tokenize, wordCatalogue),
      );
    const tokens = tokenize(phrase);
    phrase = tokens.join(" ");
    const matches = lines.filter((line) =>
      line.tokens.some(
        (_, i) => line.tokens.slice(i, i + tokens.length).join(" ") === phrase,
      ),
    );
    return {
      ...contentsCache.get(original),
      phrase,
      words: tokens.length,
      letters: (phrase.match(/\p{Alphabetic}/gu) ?? []).length,
      books: new Set(matches.map((line) => line.book)).size,
      occurrences: matches.reduce(
        (total, line) =>
          total +
          line.tokens.filter(
            (_, i) =>
              line.tokens.slice(i, i + tokens.length).join(" ") === phrase,
          ).length,
        0,
      ),
      results: {
        total: matches.length,
        verses: matches
          .slice(offset, offset + 50)
          .map(({ tokens, ...verse }) => verse),
      },
    };
  };
  const list = (saved, exclusive, offset, filters = {}) => {
    const candidates = new Set();
    for (const cache of saved.values())
      for (const phrase of cache.keys())
        if (tokenize(phrase).length >= 2) candidates.add(phrase);
    for (const entries of exclusive.values())
      for (const entry of entries)
        if (tokenize(entry.phrase).length >= 2) candidates.add(entry.phrase);
    const lengths = [
      ...new Set([...candidates].map((phrase) => tokenize(phrase).length)),
    ].sort((a, b) => a - b);
    const locations = new Map();
    const books = new Map();
    const occurrences = new Map();
    for (const length of lengths)
      for (const line of lines) {
        for (let i = 0; i + length <= line.tokens.length; i++) {
          const phrase = line.tokens.slice(i, i + length).join(" ");
          if (!candidates.has(phrase)) continue;
          if (!locations.has(phrase))
            locations.set(phrase, { tokens: line.tokens, start: i });
          const owners = books.get(phrase) ?? new Set();
          owners.add(line.book);
          books.set(phrase, owners);
          occurrences.set(phrase, (occurrences.get(phrase) ?? 0) + 1);
        }
      }
    isHidden.prepare(
      [...occurrences].map(([phrase, occurrences]) => ({
        phrase,
        occurrences,
      })),
      locations,
    );
    const entries = [...candidates]
      .sort()
      .map((phrase) => ({
        phrase,
        words: tokenize(phrase).length,
        letters: (phrase.match(/\p{Alphabetic}/gu) ?? []).length,
        books: books.get(phrase)?.size ?? 0,
        occurrences: occurrences.get(phrase) ?? 0,
      }))
      .filter((entry) => !isHidden(entry.phrase, entry.occurrences))
      .filter((entry) =>
        Object.entries(filters).every(([field, value]) => {
          if (field === "partial") return true;
          if (field === "text") {
            if (!value?.trim()) return true;
            const query = tokenize(value);
            const tokens = tokenize(entry.phrase);
            return (
              query.length > 0 &&
              tokens.some(
                (_, start) =>
                  start + query.length <= tokens.length &&
                  query.every((term, i) =>
                    filters.partial
                      ? tokens[start + i].includes(term)
                      : tokens[start + i] === term,
                  ),
              )
            );
          }
          return value == null || entry[field] === value;
        }),
      );
    return {
      total: entries.length,
      persistedLengths: lengths,
      entries: entries.slice(offset, offset + 50),
    };
  };
  return { detail, list };
};
