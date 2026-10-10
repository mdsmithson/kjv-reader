// Development-only visual fixture. Not included in the production entry point.
import source from "../src-tauri/data/kjv.json";
import type { Query, OccurrenceQuery } from "../src/model";
import { exclusiveFixture } from "./exclusive-fixture.mjs";
import { summarize } from "./spatial-fixture.mjs";
const verses = Object.entries(source).map(([reference, text]) => {
  const [, book, chapter, number] = /^(.*) (\d+):(\d+)$/.exec(reference)!;
  return { book, chapter: Number(chapter), number: Number(number), text };
});
const tokenize = (text: string) =>
  (text.match(/[\p{L}\p{N}']+/gu) ?? [])
    .map((word) => word.replace(/^'+|'+$/g, "").toLowerCase())
    .filter(Boolean);
const tokenLines = verses.map((verse) => ({
  book: verse.book,
  tokens: tokenize(verse.text),
}));
const chapterWordOwners = new Map<string, Set<string>>();
for (const verse of verses) {
  for (const word of tokenize(verse.text)) {
    const owners = chapterWordOwners.get(word) ?? new Set<string>();
    owners.add(`${verse.book} ${verse.chapter}`);
    chapterWordOwners.set(word, owners);
  }
}
const exclusiveCache = new Map<string, { phrase: string; count: number }[]>();
// Preview-only in-memory transport; persistent indexing is exercised in Rust.
const saved = new Map<
  string,
  Map<
    string,
    {
      count: number;
      books: Set<string>;
      positions: Map<
        string,
        { book: string; chapter: number; number: number; count: number }
      >;
    }
  >
>();
const letterCount = (text: string) =>
  (text.match(/\p{Alphabetic}/gu) ?? []).length;
window.__TAURI__ = {
  core: {
    invoke: async <T>(
      command: string,
      args?: Record<string, unknown>,
    ): Promise<T> => {
      if (command === "catalog")
        return [...new Set(verses.map((verse) => verse.book))].map((name) => ({
          name,
          chapters: Math.max(
            ...verses
              .filter((verse) => verse.book === name)
              .map((verse) => verse.chapter),
          ),
        })) as T;
      if (command === "exclusive_count" || command === "exclusive_phrases") {
        const book = String(args!.book);
        const length = Number(args!.length);
        const key = JSON.stringify([book, length]);
        if (!exclusiveCache.has(key)) {
          if (exclusiveCache.size >= 4)
            exclusiveCache.delete(exclusiveCache.keys().next().value!);
          exclusiveCache.set(key, exclusiveFixture(tokenLines, book, length));
        }
        const entries = exclusiveCache.get(key)!;
        const offset = Number(args!.offset ?? 0);
        return (
          command === "exclusive_count"
            ? entries.length
            : {
                total: entries.length,
                entries: entries.slice(offset, offset + 50),
              }
        ) as T;
      }
      if (command === "book_stats") {
        const counts = new Map<string, number>();
        const lines = verses.filter((verse) => verse.book === args?.book);
        lines
          .flatMap((verse) => tokenize(verse.text))
          .forEach((word) => counts.set(word, (counts.get(word) ?? 0) + 1));
        const outside = new Set(
          verses
            .filter((verse) => verse.book !== args?.book)
            .flatMap((verse) => tokenize(verse.text)),
        );
        const leaders = (entries: [string, number][]) => {
          const maximum = Math.max(0, ...entries.map(([, count]) => count));
          return entries
            .filter(([, count]) => count === maximum)
            .sort()
            .map(([word, count]) => ({ word, count }));
        };
        return {
          name: args?.book,
          chapters: [...new Set(lines.map((verse) => verse.chapter))]
            .sort((a, b) => a - b)
            .map((chapter) => {
              const tokens = lines
                .filter((verse) => verse.chapter === chapter)
                .flatMap((verse) => tokenize(verse.text));
              const unique = new Set(tokens);
              return {
                chapter,
                words: tokens.length,
                uniqueWords: unique.size,
                exclusiveWords: [...unique]
                  .filter((word) => chapterWordOwners.get(word)!.size === 1)
                  .map((word) => ({
                    word,
                    count: tokens.filter((token) => token === word).length,
                  }))
                  .sort(
                    (a, b) => b.count - a.count || a.word.localeCompare(b.word),
                  ),
              };
            }),
          words: [...counts.values()].reduce((a, b) => a + b, 0),
          uniqueWords: counts.size,
          verses: lines.length,
          mostCommon: leaders([...counts]),
          exclusiveWords: [...counts]
            .filter(([word]) => !outside.has(word))
            .sort(([left, a], [right, b]) => b - a || left.localeCompare(right))
            .map(([word, count]) => ({ word, count })),
          mostCommonExclusive: leaders(
            [...counts].filter(([word]) => !outside.has(word)),
          ),
        } as T;
      }
      if (command === "chapter")
        return verses.filter(
          (verse) =>
            verse.book === args?.book && verse.chapter === args?.chapter,
        ) as T;
      if (command === "search") {
        const query = args!.query as Query;
        const text = query.text.toLowerCase();
        const matches = verses.filter(
          (verse) =>
            (!query.book || query.book === verse.book) &&
            (!query.includedBooks ||
              query.includedBooks.includes(verse.book)) &&
            (query.normalizedWords
              ? ` ${tokenize(verse.text).join(" ")} `.includes(
                  ` ${tokenize(query.text).join(" ")} `,
                )
              : query.phrase
                ? verse.text.toLowerCase().includes(text)
                : text
                    .split(/\s+/)
                    .every((term) => verse.text.toLowerCase().includes(term))),
        );
        return {
          total: matches.length,
          verses: matches.slice(query.offset, query.offset + 50),
        } as T;
      }
      if (command === "occurrences") {
        const query = args!.query as OccurrenceQuery;
        const scopeKey = (length: number) =>
          JSON.stringify([length, query.includedBooks?.slice().sort() ?? null]);
        const lengths = query.upTo
          ? Array.from({ length: query.words }, (_, index) => index + 1)
          : [query.words];
        const builtLengths: number[] = [];
        const entries = lengths.flatMap((length) => {
          if (!saved.has(scopeKey(length))) {
            const counts = new Map<
              string,
              {
                count: number;
                books: Set<string>;
                positions: Map<
                  string,
                  {
                    book: string;
                    chapter: number;
                    number: number;
                    count: number;
                  }
                >;
              }
            >();
            for (const verse of verses) {
              if (
                query.includedBooks &&
                !query.includedBooks.includes(verse.book)
              )
                continue;
              const tokens = tokenize(verse.text);
              for (let index = 0; index <= tokens.length - length; index++) {
                const phrase = tokens.slice(index, index + length).join(" ");
                const frequency = counts.get(phrase) ?? {
                  count: 0,
                  books: new Set<string>(),
                  positions: new Map(),
                };
                frequency.count += 1;
                frequency.books.add(verse.book);
                const reference = `${verse.book} ${verse.chapter}:${verse.number}`;
                const position = frequency.positions.get(reference) ?? {
                  book: verse.book,
                  chapter: verse.chapter,
                  number: verse.number,
                  count: 0,
                };
                position.count += 1;
                frequency.positions.set(reference, position);
                counts.set(phrase, frequency);
              }
            }
            saved.set(scopeKey(length), counts);
            builtLengths.push(length);
          }
          return [...saved.get(scopeKey(length))!]
            .filter(
              ([phrase, frequency]) =>
                (query.countUpTo
                  ? frequency.count <= query.count
                  : frequency.count === query.count) &&
                (query.books == null ||
                  (query.booksUpTo
                    ? frequency.books.size <= query.books
                    : frequency.books.size === query.books)) &&
                (query.letters == null ||
                  (query.lettersUpTo
                    ? letterCount(phrase) <= query.letters
                    : letterCount(phrase) === query.letters)),
            )
            .map(([phrase, frequency]) => ({
              phrase,
              words: length,
              count: frequency.count,
              books: frequency.books.size,
              letters: letterCount(phrase),
              ...summarize(frequency.positions.values()),
            }))
            .filter(
              (entry) =>
                (!query.consecutiveVerses ||
                  entry.maxVerseRun >= query.consecutiveVerses) &&
                (!query.consecutiveChapters ||
                  entry.maxChapterRun >= query.consecutiveChapters) &&
                (!query.chapterFrequency ||
                  entry.chapterFrequencies.includes(query.chapterFrequency)),
            )
            .sort(
              (left, right) =>
                left.count - right.count ||
                left.books - right.books ||
                left.letters - right.letters ||
                (left.phrase < right.phrase
                  ? -1
                  : left.phrase > right.phrase
                    ? 1
                    : 0),
            );
        });
        return {
          total: entries.length,
          entries: entries.slice(query.offset, query.offset + 50),
          builtLengths,
          elapsedMs: 0,
        } as T;
      }
      throw new Error(`Unknown command: ${command}`);
    },
  },
};
await import("../src/main");
