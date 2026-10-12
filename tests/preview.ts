import { chaptersFixture } from "./chapters-fixture.mjs";
import chapterHeader from "../src-tauri/data/precomputed/chapters.json";
import { searchCount as countSearchMatches } from "./search-count-fixture.mjs";
import { copyBrowserText } from "./preview-clipboard";
import { numberFixture } from "./number-fixture.mjs";
import {
  readerHighlightFixture,
  preparedHighlightSpans,
} from "./reader-highlight-fixture.mjs";
// Development-only visual fixture. Not included in the production entry point.
import source from "../src-tauri/data/kjv.json";
import savedVerses from "../src-tauri/data/precomputed/verses.json";
import savedPhraseFrequencies from "../src-tauri/data/precomputed/verse-phrase-frequency.json";
import type { Query, OccurrenceQuery } from "../src/model";
import { exclusiveFixture } from "./exclusive-fixture.mjs";
import { wordFixture } from "./word-fixture.mjs";
import { verseFixture } from "./verse-fixture.mjs";
import { phraseFixture } from "./phrase-fixture.mjs";
import { summarize } from "./spatial-fixture.mjs";
const verses = Object.entries(source).map(([reference, text]) => {
  const [, book, chapter, number] = /^(.*) (\d+):(\d+)$/.exec(reference)!;
  return { book, chapter: Number(chapter), number: Number(number), text };
});
const tokenize = (text: string) =>
  (text.match(/[\p{L}\p{N}']+/gu) ?? [])
    .map((word) => word.replace(/^'+|'+$/g, "").toLowerCase())
    .filter(Boolean);
const chapterCatalogue = chaptersFixture(chapterHeader, async (id: number) => {
  const response = await fetch(
    `/src-tauri/data/precomputed/chapter-profiles/${id}.json`,
  );
  return response.json();
});
const wordCatalogue = wordFixture(verses, tokenize);
const numberCatalogue = numberFixture(wordCatalogue);
const phraseCatalogue = phraseFixture(verses, tokenize, wordCatalogue);
const verseCatalogue = verseFixture(
  verses,
  tokenize,
  wordCatalogue,
  savedPhraseFrequencies.counts,
);
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
// A real repeated passage exercises full-length equal-count rollups in the preview.
const rollupExample =
  "band of iron and brass in the tender grass of the field and let it be";
const rollupParent =
  "in the earth even with a band of iron and brass in the tender grass of the field and let it be wet with the dew of heaven and let his portion be with the beasts";
saved.set(
  "[36,null]",
  new Map(
    [rollupExample, rollupParent, "band of iron and brass"].map((phrase) => [
      phrase,
      { count: 2, books: new Set(["Daniel"]), positions: new Map() },
    ]),
  ),
);
const letterCount = (text: string) =>
  (text.match(/\p{Alphabetic}/gu) ?? []).length;
const [displayBytes, phraseCountBytes] = await Promise.all([
  fetch(
    new URL("../src-tauri/data/precomputed/verse-display.bin", import.meta.url),
  ).then((response) => response.arrayBuffer()),
  fetch(
    new URL(
      "../src-tauri/data/precomputed/reader-phrase-counts.bin",
      import.meta.url,
    ),
  ).then((response) => response.arrayBuffer()),
]);
const chapterHighlights = readerHighlightFixture(
  verses,
  wordCatalogue,
  chapterWordOwners,
  preparedHighlightSpans(
    savedVerses.entries,
    new DataView(displayBytes),
    new DataView(phraseCountBytes),
  ),
);
window.__TAURI__ = {
  core: {
    invoke: async <T>(
      command: string,
      args?: Record<string, unknown>,
    ): Promise<T> => {
      if (command === "chapters_catalogue")
        return chapterCatalogue.list(
          args?.book,
          args?.offset,
          args?.sort,
          args?.filters,
        ) as T;
      if (command === "chapter_profile")
        return (await chapterCatalogue.detail(args?.query)) as T;
      if (command === "reader_highlights")
        return chapterHighlights(
          String(args?.book),
          Number(args?.chapter),
        ) as T;
      if (command === "verse_catalogue")
        return verseCatalogue.catalogue(
          args?.query as Record<string, unknown>,
        ) as T;
      if (command === "verse_list")
        return verseCatalogue.list(
          args?.book,
          Number(args?.offset),
          args?.filters,
        ) as T;
      if (command === "verse_details") {
        const query = args?.query as Record<string, unknown>;
        return verseCatalogue.detail(
          String(query.book),
          Number(query.chapter),
          Number(query.verse),
          Number(query.offset),
          query.sort,
        ) as T;
      }
      if (command === "number_list")
        return numberCatalogue.list(Number(args?.offset)) as T;
      if (command === "number_words")
        return numberCatalogue.words(
          Number(args?.number),
          Number(args?.offset),
        ) as T;
      if (command === "word_list")
        return wordCatalogue.list(
          String(args?.text),
          Number(args?.offset),
          args?.books,
          args?.count,
        ) as T;
      if (command === "saved_phrases")
        return phraseCatalogue.list(
          saved,
          exclusiveCache,
          Number(args?.offset),
          args?.filters,
        ) as T;
      if (command === "phrase_details")
        return phraseCatalogue.detail(
          String(args?.phrase),
          Number(args?.offset),
        ) as T;
      if (command === "word_details")
        return wordCatalogue.detail(String(args?.word)) as T;
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
      if (command === "book_stats" || command === "books_stats") {
        const selected =
          command === "books_stats"
            ? (args!.books as readonly string[])
            : [String(args?.book)];
        const counts = new Map<string, number>();
        const lines = verses.filter((verse) => selected.includes(verse.book));
        lines
          .flatMap((verse) => tokenize(verse.text))
          .forEach((word) => counts.set(word, (counts.get(word) ?? 0) + 1));
        const outside = new Set(
          verses
            .filter((verse) => !selected.includes(verse.book))
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
          name: selected.join(", "),
          chapters:
            command === "books_stats"
              ? []
              : [...new Set(lines.map((verse) => verse.chapter))]
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
                        .filter(
                          (word) => chapterWordOwners.get(word)!.size === 1,
                        )
                        .map((word) => ({
                          word,
                          count: tokens.filter((token) => token === word)
                            .length,
                        }))
                        .sort(
                          (a, b) =>
                            b.count - a.count || a.word.localeCompare(b.word),
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
              : !query.partial
                ? tokenize(query.text).length > 0 &&
                  (query.phrase
                    ? ` ${tokenize(verse.text).join(" ")} `.includes(
                        ` ${tokenize(query.text).join(" ")} `,
                      )
                    : tokenize(query.text).every((word) =>
                        tokenize(verse.text).includes(word),
                      ))
                : query.phrase
                  ? verse.text.toLowerCase().includes(text)
                  : text
                      .split(/\s+/)
                      .every((term) =>
                        verse.text.toLowerCase().includes(term),
                      )),
        );
        const counted = matches.map((verse) => ({
          ...verse,
          occurrences: countSearchMatches(verse.text, query, tokenize),
        }));
        if (query.countSort)
          counted.sort(
            (a, b) =>
              (a.occurrences - b.occurrences) *
              (query.countSort === "asc" ? 1 : -1),
          );
        return {
          total: matches.length,
          verses: counted.slice(query.offset, query.offset + 50),
        } as T;
      }
      if (command === "copy_occurrence_csv") {
        const csv = await window.__TAURI__!.core.invoke<string>(
          "occurrence_csv",
          args,
        );
        await copyBrowserText(csv);
        return undefined as T;
      }
      if (command === "occurrences" || command === "occurrence_csv") {
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
                (query.chapters == null || entry.chapters === query.chapters) &&
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
        if (command === "occurrence_csv")
          return ("phrase/word,count\n" +
            [...entries]
              .sort((a, b) =>
                a.phrase < b.phrase ? -1 : a.phrase > b.phrase ? 1 : 0,
              )
              .map((entry) => `${entry.phrase},${entry.count}\n`)
              .join("")) as T;
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
