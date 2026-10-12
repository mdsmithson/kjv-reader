import { searchCount as countSearchMatches } from "./search-count-fixture.mjs";
import { numberFixture } from "./number-fixture.mjs";
import {
  readerHighlightFixture,
  preparedHighlightSpans,
} from "./reader-highlight-fixture.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { exclusiveFixture } from "./exclusive-fixture.mjs";
import { wordFixture } from "./word-fixture.mjs";
import { verseFixture } from "./verse-fixture.mjs";
import { phraseFixture } from "./phrase-fixture.mjs";
import { summarize } from "./spatial-fixture.mjs";

// Exercise the actual UI bundle through the same command boundary as Tauri.
// The fake transport deliberately delays replies to check stale-request handling.
const bundle = await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  write: false,
  format: "iife",
  plugins: [
    {
      name: "omit-css-in-dom-test",
      setup(builder) {
        builder.onLoad({ filter: /\.css$/ }, () => ({
          contents: "",
          loader: "js",
        }));
      },
    },
  ],
});
const source = JSON.parse(readFileSync("src-tauri/data/kjv.json", "utf8"));
const corpus = Object.entries(source).map(([reference, text]) => {
  const [, book, chapter, number] = /^(.*) (\d+):(\d+)$/.exec(reference);
  return { book, chapter: Number(chapter), number: Number(number), text };
});
const tokenize = (text) =>
  (text.match(/[\p{L}\p{N}']+/gu) ?? [])
    .map((word) => word.replace(/^'+|'+$/g, "").toLowerCase())
    .filter(Boolean);
const wordCatalogue = wordFixture(corpus, tokenize);
const numberCatalogue = numberFixture(wordCatalogue);
const phraseCatalogue = phraseFixture(corpus, tokenize, wordCatalogue);
const savedVisibleCounts = JSON.parse(
  readFileSync("src-tauri/data/precomputed/verses.json", "utf8"),
).entries.map((entry) => entry.display_phrases);
const verseCatalogue = verseFixture(
  corpus,
  tokenize,
  wordCatalogue,
  JSON.parse(
    readFileSync(
      "src-tauri/data/precomputed/verse-phrase-frequency.json",
      "utf8",
    ),
  ).counts,
  savedVisibleCounts,
);
const tokenLines = corpus.map((verse) => ({
  book: verse.book,
  chapter: verse.chapter,
  number: verse.number,
  tokens: tokenize(verse.text),
}));
const chapterWordOwners = new Map();
for (const line of tokenLines) {
  for (const word of line.tokens) {
    const owners = chapterWordOwners.get(word) ?? new Set();
    owners.add(`${line.book} ${line.chapter}`);
    chapterWordOwners.set(word, owners);
  }
}
const savedLengths = new Map();
const letterCount = (text) => (text.match(/\p{Alphabetic}/gu) ?? []).length;
const occurrenceRequests = [];
const bookGroupRequests = [];
const exclusiveRequests = [];
const exclusiveSaved = new Map();

const highlightBundle = await build({
  entryPoints: ["src/highlight.ts"],
  bundle: true,
  write: false,
  format: "esm",
});
const { highlighted } = await import(
  `data:text/javascript;base64,${Buffer.from(highlightBundle.outputFiles[0].text).toString("base64")}`
);
const highlightQuery = {
  text: "God word",
  book: null,
  phrase: false,
  offset: 0,
  partial: true,
};
assert.equal(
  highlighted("God, WORD & godhead", highlightQuery),
  "<mark>God</mark>, <mark>WORD</mark> &amp; <mark>god</mark>head",
);
assert.equal(
  highlighted("God, WORD & godhead God's", {
    ...highlightQuery,
    partial: false,
  }),
  "<mark>God</mark>, <mark>WORD</mark> &amp; godhead God&#39;s",
);
assert.equal(
  highlighted("a+b <script>", { ...highlightQuery, text: "a+b" }),
  "<mark>a+b</mark> &lt;script&gt;",
);
assert.equal(
  highlighted("God, [word] God; word.", {
    ...highlightQuery,
    phrase: true,
    normalizedWords: true,
  }),
  "<mark>God, [word</mark>] <mark>God; word</mark>.",
);
assert.equal(
  highlighted("<script>alert(1)</script>", {
    ...highlightQuery,
    text: "<script>",
    phrase: true,
  }),
  "<mark>&lt;script&gt;</mark>alert(1)&lt;/script&gt;",
);
assert.equal(
  highlighted("a a a", {
    ...highlightQuery,
    text: "a a",
    normalizedWords: true,
  }),
  "<mark>a a a</mark>",
);
// Invalid saved values cannot become CSS or corrupt occurrence settings.
const readerHighlightBundle = await build({
  entryPoints: ["src/reader-highlights.ts"],
  bundle: true,
  write: false,
  format: "esm",
});
const { parseReaderHighlights, readerWordHighlights } = await import(
  `data:text/javascript;base64,${Buffer.from(readerHighlightBundle.outputFiles[0].text).toString("base64")}`
);
const invalidSaved = parseReaderHighlights({
  version: 1,
  options: {
    exclusive: { enabled: true, color: "red;display:none" },
    firstMention: { enabled: "yes", color: "#ABCDEF" },
    occurrences: { enabled: true, color: "#000000", count: -1 },
  },
});
assert.equal(invalidSaved[0].color, "#f6d887");
assert.equal(invalidSaved[1].enabled, false);
assert.equal(invalidSaved[1].color, "#abcdef");
assert.equal(invalidSaved[2].count, 7);
const sanitized = parseReaderHighlights({
  version: 2,
  filters: Array.from({ length: 12 }, (_, i) => ({
    id: "duplicate",
    kind: "wordCount",
    count: i === 0 ? -1 : 1,
    color: "bad",
    enabled: true,
  })),
});
assert.equal(sanitized.length, 10);
assert.equal(new Set(sanitized.map((rule) => rule.id)).size, 10);
assert.equal(sanitized[0].count, 1);
const sampleWords = [
  {
    start: 0,
    end: 3,
    word: "god",
    count: 7,
    exclusive: false,
    firstMention: true,
    lastMention: false,
  },
];
const darkMarkup = readerWordHighlights(
  "God & godhead",
  sampleWords,
  invalidSaved.map((rule) => ({ ...rule, enabled: rule.kind === "wordCount" })),
);
assert.match(darkMarkup, /background:#000000;color:#ffffff/);
assert.match(darkMarkup, /God<\/mark> &amp; godhead/);
const segmented = readerWordHighlights(
  "God",
  sampleWords,
  Array.from({ length: 10 }, (_, i) => ({
    id: `rule-${i}`,
    kind: "wordCount",
    count: 7,
    enabled: true,
    color: `#${String(i).repeat(6)}`,
  })),
);
assert.match(segmented, /linear-gradient\(to right/);
assert.match(segmented, /90%,#999999 100%/);
const books = [...new Set(corpus.map((verse) => verse.book))].map((name) => ({
  name,
  chapters: Math.max(
    ...corpus
      .filter((verse) => verse.book === name)
      .map((verse) => verse.chapter),
  ),
}));
const dom = new JSDOM('<div id="app"></div>', {
  runScripts: "outside-only",
  url: "http://localhost",
});
const { window } = dom;
window.HTMLElement.prototype.scrollTo = function (options) {
  this.scrollTop = options?.top ?? this.scrollTop;
  this.scrollLeft = options?.left ?? this.scrollLeft;
};
window.HTMLElement.prototype.scrollIntoView = () => {};
const pause = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const viewBuffer = (path) => {
  const bytes = readFileSync(path);
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
};
const chapterHighlights = readerHighlightFixture(
  corpus,
  wordCatalogue,
  chapterWordOwners,
  preparedHighlightSpans(
    JSON.parse(readFileSync("src-tauri/data/precomputed/verses.json", "utf8"))
      .entries,
    viewBuffer("src-tauri/data/precomputed/verse-display.bin"),
    viewBuffer("src-tauri/data/precomputed/reader-phrase-counts.bin"),
  ),
);
window.__TAURI__ = {
  core: {
    invoke: async (command, args) => {
      if (command === "reader_highlights")
        return chapterHighlights(String(args.book), Number(args.chapter));
      if (command === "verse_catalogue")
        return verseCatalogue.catalogue(args.query);
      if (command === "verse_list")
        return verseCatalogue.list(
          args.book,
          Number(args.offset),
          args.filters,
        );
      if (command === "verse_details") {
        const query = args.query;
        if (query.sort?.field !== "phrase") await pause(10);
        return verseCatalogue.detail(
          String(query.book),
          Number(query.chapter),
          Number(query.verse),
          Number(query.offset),
          query.sort,
        );
      }
      if (command === "number_list")
        return numberCatalogue.list(Number(args.offset));
      if (command === "number_words")
        return numberCatalogue.words(Number(args.number), Number(args.offset));
      if (command === "word_list")
        return wordCatalogue.list(
          String(args.text),
          Number(args.offset),
          args.books,
          args.count,
        );
      if (command === "saved_phrases")
        return phraseCatalogue.list(
          savedLengths,
          exclusiveSaved,
          Number(args.offset),
          args.filters,
        );
      if (command === "phrase_details")
        return phraseCatalogue.detail(String(args.phrase), Number(args.offset));
      if (command === "word_details")
        return wordCatalogue.detail(String(args.word));
      if (command === "catalog") return books;
      if (command === "exclusive_count" || command === "exclusive_phrases") {
        exclusiveRequests.push({ command, ...args });
        const key = JSON.stringify([args.book, args.length]);
        // Exercise real corpus lengths 1–2; higher-length empty transport fixtures
        // keep DOM tests fast. Rust tests verify boundaries and indexing rules.
        if (!exclusiveSaved.has(key))
          exclusiveSaved.set(
            key,
            args.length <= 2
              ? exclusiveFixture(tokenLines, args.book, args.length)
              : [],
          );
        const entries = exclusiveSaved.get(key);
        return command === "exclusive_count"
          ? entries.length
          : {
              total: entries.length,
              entries: entries.slice(args.offset, args.offset + 50),
            };
      }
      if (command === "book_stats" || command === "books_stats") {
        if (command === "books_stats") bookGroupRequests.push(args.books);
        const selected = command === "books_stats" ? args.books : [args.book];
        const lines = corpus.filter((verse) => selected.includes(verse.book));
        const counts = new Map();
        lines
          .flatMap((verse) => tokenize(verse.text))
          .forEach((word) => counts.set(word, (counts.get(word) ?? 0) + 1));
        const outside = new Set(
          corpus
            .filter((verse) => !selected.includes(verse.book))
            .flatMap((verse) => tokenize(verse.text)),
        );
        const leaders = (entries) => {
          const max = Math.max(0, ...entries.map(([, count]) => count));
          return entries
            .filter(([, count]) => count === max)
            .sort()
            .map(([word, count]) => ({ word, count }));
        };
        return {
          name: selected.join(", "),
          chapters:
            command === "books_stats"
              ? []
              : Array.from(
                  {
                    length: books.find((book) => book.name === args.book)
                      .chapters,
                  },
                  (_, index) => {
                    const tokens = lines
                      .filter((verse) => verse.chapter === index + 1)
                      .flatMap((verse) => tokenize(verse.text));
                    const unique = new Set(tokens);
                    return {
                      chapter: index + 1,
                      words: tokens.length,
                      uniqueWords: unique.size,
                      exclusiveWords: [...unique]
                        .filter(
                          (word) => chapterWordOwners.get(word).size === 1,
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
                  },
                ),
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
        };
      }
      if (command === "chapter") {
        await pause(args.chapter === 2 ? 80 : 5);
        return corpus.filter(
          (verse) => verse.book === args.book && verse.chapter === args.chapter,
        );
      }
      if (command === "search") {
        const query = args.query;
        const text = query.text.toLowerCase();
        const verses = corpus.filter(
          (verse) =>
            (!query.book || verse.book === query.book) &&
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
                      .every((word) =>
                        verse.text.toLowerCase().includes(word),
                      )),
        );
        const counted = verses.map((verse) => ({
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
          total: verses.length,
          verses: counted.slice(query.offset, query.offset + 50),
        };
      }
      if (command === "copy_occurrence_csv") {
        const csv = await window.__TAURI__.core.invoke("occurrence_csv", args);
        await window.navigator.clipboard.writeText(csv);
        return;
      }
      if (command === "occurrences" || command === "occurrence_csv") {
        const query = args.query;
        if (command === "occurrences") occurrenceRequests.push(query);
        if (query.anyLength) {
          // A real verse keeps the all-length transport fixture small; Rust
          // verifies the engine's full supported range independently.
          const counts = new Map();
          const tokens = tokenize(corpus[0].text);
          for (let length = 1; length <= query.words; length++) {
            for (let i = 0; i <= tokens.length - length; i++) {
              const phrase = tokens.slice(i, i + length).join(" ");
              counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
            }
          }
          const entries = [...counts]
            .filter(([, count]) =>
              query.countUpTo ? count <= query.count : count === query.count,
            )
            .map(([phrase, count]) => ({
              phrase,
              count,
              words: tokenize(phrase).length,
              books: 1,
              letters: letterCount(phrase),
              chapters: 1,
              maxVerseRun: 1,
              maxChapterRun: 1,
              maxChapterFrequency: count,
            }))
            .sort(
              (a, b) =>
                a.words - b.words ||
                a.count - b.count ||
                a.letters - b.letters ||
                a.phrase.localeCompare(b.phrase),
            );
          if (command === "occurrence_csv")
            return (
              "phrase/word,count\n" +
              [...entries]
                .sort((a, b) =>
                  a.phrase < b.phrase ? -1 : a.phrase > b.phrase ? 1 : 0,
                )
                .map((entry) => `${entry.phrase},${entry.count}\n`)
                .join("")
            );
          return {
            total: entries.length,
            entries: entries.slice(query.offset, query.offset + 50),
            builtLengths: [],
            elapsedMs: 1,
          };
        }
        const scopeKey = (length) =>
          JSON.stringify([length, query.includedBooks?.slice().sort() ?? null]);
        const lengths = query.upTo
          ? Array.from({ length: query.words }, (_, index) => index + 1)
          : [query.words];
        const builtLengths = [];
        const entries = lengths.flatMap((length) => {
          if (!savedLengths.has(scopeKey(length))) {
            const counts = new Map();
            for (const { book, chapter, number, tokens } of tokenLines) {
              if (query.includedBooks && !query.includedBooks.includes(book))
                continue;
              for (let index = 0; index <= tokens.length - length; index++) {
                const phrase = tokens.slice(index, index + length).join(" ");
                const frequency = counts.get(phrase) ?? {
                  count: 0,
                  books: new Set(),
                  positions: new Map(),
                };
                frequency.count += 1;
                frequency.books.add(book);
                const reference = `${book} ${chapter}:${number}`;
                const position = frequency.positions.get(reference) ?? {
                  book,
                  chapter,
                  number,
                  count: 0,
                };
                position.count += 1;
                frequency.positions.set(reference, position);
                counts.set(phrase, frequency);
              }
            }
            savedLengths.set(scopeKey(length), counts);
            builtLengths.push(length);
          }
          return [...savedLengths.get(scopeKey(length))]
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
              count: frequency.count,
              words: length,
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
          return (
            "phrase/word,count\n" +
            [...entries]
              .sort((a, b) =>
                a.phrase < b.phrase ? -1 : a.phrase > b.phrase ? 1 : 0,
              )
              .map((entry) => `${entry.phrase},${entry.count}\n`)
              .join("")
          );
        return {
          total: entries.length,
          entries: entries.slice(query.offset, query.offset + 50),
          builtLengths,
          elapsedMs: 1,
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    },
  },
};
let copiedCsv = "";
let clipboardFails = false;
Object.defineProperty(window.navigator, "clipboard", {
  value: {
    writeText: async (text) => {
      if (clipboardFails) throw new Error("Clipboard unavailable");
      copiedCsv = text;
    },
  },
});
window.eval(bundle.outputFiles[0].text);
const find = (selector) => window.document.querySelector(selector);
const change = (selector, value) => {
  find(selector).value = value;
  find(selector).dispatchEvent(new window.Event("change", { bubbles: true }));
};
const initializationDeadline = Date.now() + 2000;
while (
  !window.document.querySelectorAll(".verse").length &&
  Date.now() < initializationDeadline
)
  await pause(10);
assert.equal(
  window.document.querySelectorAll(".verse").length,
  31,
  find("[role=alert]")?.textContent ?? "Reader did not initialize",
);
assert.match(find(".verse").textContent, /In the beginning God/);
// Highlights now live on their own page and saved custom filters follow every chapter.
assert.equal(window.document.querySelector("#highlight-options-toggle"), null);
const editHighlights = () => find('[data-page="highlights"]').click();
const backToReader = () =>
  find('.highlights-page [data-page="reader"]').click();
const highlightRows = () => [
  ...window.document.querySelectorAll("[data-highlight-id]"),
];
const setHighlight = (id, field, value) => {
  const input = find(
    `[data-highlight-id="${id}"] [data-highlight-field="${field}"]`,
  );
  if (input.type === "checkbox") input.checked = value;
  else input.value = String(value);
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
};
const addHighlight = (kind, count = 1) => {
  find('[data-action="highlight-add"]').click();
  const id = highlightRows().at(-1).dataset.highlightId;
  setHighlight(id, "kind", kind);
  if (kind === "wordCount" || kind === "phraseCount")
    setHighlight(id, "count", count);
  return id;
};
find("main").scrollTop = 450;
editHighlights();
assert.ok(find(".highlights-page"));
assert.equal(find("main").scrollTop, 0);
const firstFilter = addHighlight("firstMention");
setHighlight(firstFilter, "color", "#ffccdd");
assert.equal(
  find(`[data-highlight-id="${firstFilter}"] [data-highlight-field="count"]`)
    .disabled,
  true,
);
backToReader();
assert.equal(find("main").scrollTop, 450);
assert.equal(
  window.document.querySelectorAll(
    '#verse-1 [data-highlight-rules~="firstMention"]',
  ).length,
  8,
);
assert.equal(
  [
    ...window.document.querySelectorAll(
      '#verse-1 [data-highlight-rules~="firstMention"]',
    ),
  ].filter((mark) => mark.textContent.toLowerCase() === "the").length,
  1,
);
assert.equal(
  find('#verse-1 [data-highlight-rules~="firstMention"]').style.backgroundColor,
  "rgb(255, 204, 221)",
);
editHighlights();
const wordFilter = addHighlight("wordCount", 63919);
backToReader();
assert.ok(
  [
    ...window.document.querySelectorAll('[data-highlight-rules~="wordCount"]'),
  ].every((mark) => mark.textContent.toLowerCase() === "the"),
);
assert.ok(
  find(
    '#verse-1 [data-highlight-rules="firstMention wordCount"]',
  ).style.background.includes("linear-gradient(to right"),
);
editHighlights();
const exclusiveFilter = addHighlight("exclusive");
setHighlight(exclusiveFilter, "color", "#ffed00");
const phraseFilter = addHighlight("phraseCount", 1);
const lastFilter = addHighlight("lastMention");
const saveHighlights = () =>
  find("#reader-highlights-form").dispatchEvent(
    new window.Event("submit", { bubbles: true, cancelable: true }),
  );
saveHighlights();
assert.match(find("#highlight-save-status").textContent, /options saved/);
const savedHighlights = JSON.parse(
  window.localStorage.getItem("kjv-reader:highlight-settings:v2"),
);
assert.equal(savedHighlights.version, 2);
assert.equal(savedHighlights.filters.length, 5);
assert.equal(
  savedHighlights.filters.find((rule) => rule.id === wordFilter).count,
  63919,
);
backToReader();
assert.equal(
  window.document.querySelectorAll(
    '#verse-1 [data-highlight-rules~="phraseCount"]',
  ).length,
  10,
);
change("#chapter", "2");
await pause(110);
assert.ok(
  [
    ...window.document.querySelectorAll('[data-highlight-rules~="exclusive"]'),
  ].some((mark) => mark.textContent === "Pison"),
);
editHighlights();
setHighlight(wordFilter, "count", 1);
backToReader();
const pison = [
  ...window.document.querySelectorAll(".reader-word-highlight"),
].find((mark) => mark.textContent === "Pison");
assert.equal(
  pison.dataset.highlightRules,
  "firstMention wordCount exclusive phraseCount lastMention",
);
assert.ok(pison.style.background.includes("linear-gradient(to right"));
editHighlights();
for (let n = 0; n < 5; n++) addHighlight("wordCount", 1);
assert.equal(highlightRows().length, 10);
assert.equal(find('[data-action="highlight-add"]').disabled, true);
find(`[data-highlight-remove="${lastFilter}"]`).click();
assert.equal(highlightRows().length, 9);
assert.equal(find('[data-action="highlight-add"]').disabled, false);
// Unsaved edits do not replace saved settings when the app restarts.
const restoredDom = new JSDOM('<div id="app"></div>', {
  runScripts: "outside-only",
  url: "http://localhost",
});
restoredDom.window.HTMLElement.prototype.scrollTo = () => {};
restoredDom.window.HTMLElement.prototype.scrollIntoView = () => {};
restoredDom.window.__TAURI__ = window.__TAURI__;
restoredDom.window.localStorage.setItem(
  "kjv-reader:highlight-settings:v2",
  JSON.stringify(savedHighlights),
);
restoredDom.window.eval(bundle.outputFiles[0].text);
const restoreDeadline = Date.now() + 3000;
while (
  !restoredDom.window.document.querySelector(".reader-word-highlight") &&
  Date.now() < restoreDeadline
)
  await pause(10);
assert.ok(restoredDom.window.document.querySelector(".reader-word-highlight"));
restoredDom.window.document.querySelector('[data-page="highlights"]').click();
assert.equal(
  restoredDom.window.document.querySelectorAll("[data-highlight-id]").length,
  5,
);
assert.equal(
  restoredDom.window.document.querySelector(
    `[data-highlight-id="${wordFilter}"] [data-highlight-field="count"]`,
  ).value,
  "63919",
);
restoredDom.window.close();
// Existing v1 settings migrate, including disabled rules and custom colors/counts.
const legacyDom = new JSDOM('<div id="app"></div>', {
  runScripts: "outside-only",
  url: "http://localhost",
});
legacyDom.window.HTMLElement.prototype.scrollTo = () => {};
legacyDom.window.HTMLElement.prototype.scrollIntoView = () => {};
legacyDom.window.__TAURI__ = window.__TAURI__;
legacyDom.window.localStorage.setItem(
  "kjv-reader:highlight-settings:v1",
  JSON.stringify({
    version: 1,
    options: {
      exclusive: { enabled: false, color: "#ffed00" },
      firstMention: { enabled: true, color: "#ffccdd" },
      occurrences: { enabled: true, color: "#abcdef", count: 63919 },
    },
  }),
);
legacyDom.window.eval(bundle.outputFiles[0].text);
const legacyDeadline = Date.now() + 3000;
while (
  !legacyDom.window.document.querySelector(".reader-word-highlight") &&
  Date.now() < legacyDeadline
)
  await pause(10);
assert.ok(legacyDom.window.document.querySelector(".reader-word-highlight"));
legacyDom.window.document.querySelector('[data-page="highlights"]').click();
assert.equal(
  legacyDom.window.document.querySelectorAll("[data-highlight-id]").length,
  3,
);
assert.equal(
  legacyDom.window.document.querySelector(
    '[data-highlight-id="legacy-occurrences"] [data-highlight-field="count"]',
  ).value,
  "63919",
);
assert.equal(
  legacyDom.window.document.querySelector(
    '[data-highlight-id="legacy-firstMention"] [data-highlight-field="color"]',
  ).value,
  "#ffccdd",
);
legacyDom.window.close();
// Last mention flags mark the final token, even if a word repeats in its final verse.
backToReader();
change("#book", "Revelation");
await pause(30);
change("#chapter", "22");
await pause(30);
editHighlights();
for (const row of highlightRows())
  setHighlight(row.dataset.highlightId, "enabled", false);
const finalFilter = addHighlight("lastMention");
backToReader();
assert.ok(
  window.document.querySelectorAll('[data-highlight-rules~="lastMention"]')
    .length > 0,
);
assert.deepEqual(
  [
    ...window.document.querySelectorAll(
      '[data-highlight-rules~="lastMention"]',
    ),
  ].map((mark) => mark.textContent),
  chapterHighlights("Revelation", 22).verses.flatMap((verse) =>
    verse.words
      .filter((word) => word.lastMention)
      .map((word) =>
        corpus
          .find(
            (v) =>
              v.book === "Revelation" &&
              v.chapter === 22 &&
              v.number === verse.number,
          )
          .text.slice(word.start, word.end),
      ),
  ),
);
editHighlights();
for (const row of highlightRows())
  setHighlight(row.dataset.highlightId, "enabled", false);
backToReader();
change("#book", "Genesis");
await pause(30);
change("#chapter", "1");
await pause(30);
// Reader verses open prepared verse details; every word links to its Word page.
find("#verse-1").click();
await pause(30);
assert.equal(find(".verse-detail-page h1").textContent, "Genesis 1:1");
const genesisDetail = verseCatalogue.detail("Genesis", 1, 1, 0);
assert.deepEqual(
  [...window.document.querySelectorAll(".verse-detail-page dd")].map((cell) =>
    Number(cell.textContent.replaceAll(",", "")),
  ),
  [genesisDetail.words, genesisDetail.letters, genesisDetail.phrases],
);
assert.equal(find(".interactive-verse").textContent, corpus[0].text);
assert.equal(
  window.document.querySelectorAll(".verse-word").length,
  genesisDetail.words,
);
assert.deepEqual(
  [...window.document.querySelectorAll(".verse-phrase-row")].map(
    (row) => row.dataset.savedPhrase,
  ),
  genesisDetail.phraseResults.entries.map((entry) => entry.phrase),
);
assert.deepEqual(
  [...window.document.querySelectorAll(".verse-phrase-row .scripture")].map(
    (cell) => cell.textContent,
  ),
  genesisDetail.phraseResults.entries.map((entry) => entry.display),
);
assert.equal(genesisDetail.phraseResults.total, genesisDetail.phrases);
assert.equal(genesisDetail.phrases, 15);
assert.ok(
  !genesisDetail.phraseResults.entries.some(
    (entry) => entry.phrase === "beginning god",
  ),
);
assert.ok(
  genesisDetail.phraseResults.entries.some(
    (entry) => entry.display === corpus[0].text,
  ),
);
assert.ok(
  genesisDetail.phraseResults.entries.some(
    (entry) => entry.occurrences > 1 && entry.display.includes("God"),
  ),
);
// Every detail-list sort changes the entire list and supports both directions.
const assertSortPosition = () => {
  assert.equal(find("main").scrollTop, 725);
  assert.equal(find("main").scrollLeft, 12);
};
const sortClick = (owner, field) => {
  const button = find(
    `[data-sort-owner="${owner}"][data-sort-field="${field}"]`,
  );
  button.focus();
  find("main").scrollTop = 725;
  find("main").scrollLeft = 12;
  button.click();
  assertSortPosition();
  assert.equal(window.document.activeElement.dataset.sortOwner, owner);
  assert.equal(window.document.activeElement.dataset.sortField, field);
  if (owner === "verse-phrases")
    assert.ok(
      find(".verse-phrase-row"),
      "Keep existing rows visible while the sort loads",
    );
};
const wordRows = () => [
  ...window.document.querySelectorAll(".verse-detail-page .context-word-row"),
];
assert.equal(wordRows().length, 8);
assert.deepEqual(
  wordRows().map((row) => row.dataset.word),
  genesisDetail.wordEntries.map((entry) => entry.word),
);
for (const [field, column] of [
  ["occurrences", 1],
  ["letters", 2],
  ["books", 3],
]) {
  sortClick("verse-words", field);
  let values = wordRows().map((row) =>
    Number(row.children[column].textContent.replaceAll(",", "")),
  );
  assert.ok(values.every((value, i) => !i || values[i - 1] <= value));
  sortClick("verse-words", field);
  values = wordRows().map((row) =>
    Number(row.children[column].textContent.replaceAll(",", "")),
  );
  assert.ok(values.every((value, i) => !i || values[i - 1] >= value));
}
sortClick("verse-words", "word");
assert.deepEqual(
  wordRows().map((row) => row.dataset.word),
  genesisDetail.wordEntries.map((entry) => entry.word),
);
sortClick("verse-words", "word");
assert.deepEqual(
  wordRows().map((row) => row.dataset.word),
  genesisDetail.wordEntries.map((entry) => entry.word).reverse(),
);
for (const [field, column] of [
  ["occurrences", 1],
  ["books", 2],
]) {
  sortClick("verse-phrases", field);
  await pause(30);
  assertSortPosition();
  let values = [...window.document.querySelectorAll(".verse-phrase-row")].map(
    (row) => Number(row.children[column].textContent.replaceAll(",", "")),
  );
  assert.ok(values.every((value, i) => !i || values[i - 1] <= value));
  sortClick("verse-phrases", field);
  await pause(30);
  assertSortPosition();
  values = [...window.document.querySelectorAll(".verse-phrase-row")].map(
    (row) => Number(row.children[column].textContent.replaceAll(",", "")),
  );
  assert.ok(values.every((value, i) => !i || values[i - 1] >= value));
}
sortClick("verse-phrases", "phrase");
await pause(30);
assertSortPosition();
assert.deepEqual(
  [...window.document.querySelectorAll(".verse-phrase-row")].map(
    (row) => row.dataset.savedPhrase,
  ),
  genesisDetail.phraseResults.entries.map((entry) => entry.phrase),
);
find('.verse-detail-page .context-word-row[data-word="god"]').click();
await pause(30);
assert.equal(find(".word-detail-page h1").textContent, "god");
find('nav [data-page="reader"]').click();
find("#verse-1").click();
await pause(30);
find('.verse-word[data-word="god"]').click();
await pause(30);
assert.equal(find(".word-detail-page h1").textContent, "god");
find('nav [data-page="verses"]').click();
await pause(30);
assert.equal(window.document.querySelectorAll(".verse-row").length, 50);
assert.equal(find(".verse-row strong").textContent, "Genesis 1:1");
find('[data-action="verses-next"]').click();
await pause(30);
assert.equal(
  find(".verse-row strong").textContent,
  `${corpus[50].book} ${corpus[50].chapter}:${corpus[50].number}`,
);
change("#verses-book", "John");
await pause(30);
assert.equal(find(".verse-row strong").textContent, "John 1:1");
// Header-selected counts combine, persist while paging, and remain editable with no matches.
change("#verses-book", "");
await pause(30);
const submitVerseFilters = () =>
  find("#verses-form").dispatchEvent(
    new window.Event("submit", { bubbles: true, cancelable: true }),
  );
find('[data-verse-filter="words"]').click();
assert.ok(!find("#verse-words-filter").closest("label").hidden);
find("#verse-words-filter").value = "10";
submitVerseFilters();
await pause(30);
const tenWords = verseCatalogue.list(null, 0, { words: 10 });
assert.deepEqual(
  [...window.document.querySelectorAll(".verse-row strong")].map(
    (node) => node.textContent,
  ),
  tenWords.entries.map(
    (entry) =>
      `${entry.verse.book} ${entry.verse.chapter}:${entry.verse.number}`,
  ),
);
assert.ok(tenWords.total > 50);
find('[data-action="verses-next"]').click();
await pause(30);
assert.equal(find("#verse-words-filter").value, "10");
assert.deepEqual(
  [...window.document.querySelectorAll(".verse-row strong")].map(
    (node) => node.textContent,
  ),
  verseCatalogue
    .list(null, 50, { words: 10 })
    .entries.map(
      (entry) =>
        `${entry.verse.book} ${entry.verse.chapter}:${entry.verse.number}`,
    ),
);
find('[data-verse-filter="letters"]').click();
find("#verse-letters-filter").value = "44";
find('[data-verse-filter="phrases"]').click();
assert.equal(find("#verse-letters-filter").value, "44");
find("#verse-phrases-filter").value = "15";
submitVerseFilters();
await pause(30);
assert.ok(
  [...window.document.querySelectorAll(".verse-row")].every(
    (row) =>
      Number(row.children[1].textContent) === 10 &&
      Number(row.children[2].textContent) === 44 &&
      Number(row.children[3].textContent) === 15,
  ),
);
change("#verses-book", "Genesis");
await pause(30);
assert.equal(find(".verse-row strong").textContent, "Genesis 1:1");
find(".verse-row").click();
await pause(30);
find('.verse-detail-page [data-page="verses"]').click();
await pause(30);
assert.equal(find("#verse-phrases-filter").value, "15");
find("#verse-phrases-filter").value = "999999";
submitVerseFilters();
await pause(30);
assert.match(find(".notice").textContent, /No verses match/);
assert.ok(find('[data-verse-filter="phrases"]'));
for (const field of ["words", "letters", "phrases"])
  find(`#verse-${field}-filter`).value = "";
submitVerseFilters();
await pause(30);
assert.equal(window.document.querySelectorAll(".verse-row").length, 50);
// Added columns use global frequencies and sort the complete filtered catalogue.
const addVerseFrequency = async (n) => {
  find('[data-action="verse-add-filter"]').click();
  find("#verse-frequency-input").value = String(n);
  find("#verse-frequency-form").dispatchEvent(
    new window.Event("submit", { bubbles: true, cancelable: true }),
  );
  await pause(30);
};
await addVerseFrequency(1);
const shownFrequencyRows = () =>
  [...window.document.querySelectorAll(".verse-row")].map((row) => ({
    ref: row.querySelector("strong").textContent,
    counts: [...row.querySelectorAll(".verse-frequency-value")].map((cell) =>
      Number(cell.textContent),
    ),
  }));
const frequencyExpected = (
  frequencies,
  sort = null,
  offset = 0,
  book = "Genesis",
  filters = {},
) =>
  verseCatalogue
    .catalogue({ book, offset, filters, frequencies, sort })
    .entries.map((entry) => ({
      ref: `${entry.verse.book} ${entry.verse.chapter}:${entry.verse.number}`,
      counts: entry.frequencyCounts,
    }));
assert.deepEqual(shownFrequencyRows(), frequencyExpected([1]));
find("main").scrollTop = 1400;
find('[data-verse-frequency-sort="1"]').click();
await pause(30);
assert.equal(find("main").scrollTop, 1400);
assert.deepEqual(
  shownFrequencyRows(),
  frequencyExpected([1], { frequency: 1, direction: "desc" }),
);
find('[data-verse-frequency-sort="1"]').click();
await pause(30);
assert.equal(find("main").scrollTop, 1400);
assert.deepEqual(
  shownFrequencyRows(),
  frequencyExpected([1], { frequency: 1, direction: "asc" }),
);
find('[data-action="verse-add-filter"]').click();
find("#verse-frequency-input").value = "1";
find("#verse-frequency-form").dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
assert.equal(
  find("#verse-frequency-input").validationMessage,
  "This frequency column is already present.",
);
find("#verse-frequency-input").value = "2";
find("#verse-frequency-input").dispatchEvent(
  new window.Event("input", { bubbles: true }),
);
find("#verse-frequency-form").dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
await pause(30);
for (const n of [7, 22, 63919]) await addVerseFrequency(n);
assert.equal(find('[data-action="verse-add-filter"]').disabled, false);
assert.equal(
  window.document.querySelectorAll(".verse-frequency-heading").length,
  5,
);
find(".verse-catalogue-scroll").scrollLeft = 220;
find('[data-verse-frequency-sort="63919"]').click();
await pause(30);
assert.equal(find(".verse-catalogue-scroll").scrollLeft, 220);
assert.deepEqual(
  shownFrequencyRows(),
  frequencyExpected([1, 2, 7, 22, 63919], {
    frequency: 63919,
    direction: "desc",
  }),
);
change("#verses-book", "");
await pause(30);
find('[data-action="verses-next"]').click();
await pause(30);
assert.deepEqual(
  shownFrequencyRows(),
  frequencyExpected(
    [1, 2, 7, 22, 63919],
    { frequency: 63919, direction: "desc" },
    50,
    null,
  ),
);
find(".verse-row").click();
await pause(30);
find('.verse-detail-page [data-page="verses"]').click();
await pause(30);
assert.deepEqual(
  shownFrequencyRows(),
  frequencyExpected(
    [1, 2, 7, 22, 63919],
    { frequency: 63919, direction: "desc" },
    50,
    null,
  ),
);
find('[data-verse-filter="words"]').click();
find("#verse-words-filter").value = "10";
submitVerseFilters();
await pause(30);
assert.deepEqual(
  shownFrequencyRows(),
  frequencyExpected(
    [1, 2, 7, 22, 63919],
    { frequency: 63919, direction: "desc" },
    0,
    null,
    { words: 10 },
  ),
);
find('[data-verse-frequency-remove="63919"]').click();
await pause(30);
assert.equal(
  window.document.querySelectorAll(".verse-frequency-heading").length,
  4,
);
assert.deepEqual(
  shownFrequencyRows(),
  frequencyExpected([1, 2, 7, 22], null, 0, null, { words: 10 }),
);
for (const n of [1, 2, 7, 22]) {
  find(`[data-verse-frequency-remove="${n}"]`).click();
  await pause(30);
}
find("#verse-words-filter").value = "";
submitVerseFilters();
await pause(30);
// Word and phrase columns can share X while sorting independently.
await addVerseFrequency(1);
const addPhraseFrequency = async (n) => {
  find('[data-action="verse-add-filter"]').click();
  find("#verse-frequency-kind").value = "phrases";
  find("#verse-frequency-input").value = String(n);
  find("#verse-frequency-form").dispatchEvent(
    new window.Event("submit", { bubbles: true, cancelable: true }),
  );
  await pause(30);
};
await addPhraseFrequency(1);
assert.equal(
  find('.verse-row [data-frequency-kind="phrases"]').textContent,
  "1",
);
assert.equal(find(".verse-row").children[3].textContent, "15");
const phraseExpected = (sort = null, offset = 0, book = null, filters = {}) =>
  verseCatalogue
    .catalogue({
      book,
      filters,
      offset,
      frequencies: [1],
      phraseFrequencies: [1],
      sort,
    })
    .entries.map((entry) => ({
      ref: `${entry.verse.book} ${entry.verse.chapter}:${entry.verse.number}`,
      counts: [...entry.frequencyCounts, ...entry.phraseFrequencyCounts],
    }));
assert.deepEqual(shownFrequencyRows(), phraseExpected());
find("main").scrollTop = 1400;
find(".verse-catalogue-scroll").scrollLeft = 210;
find('[data-verse-frequency-sort="phrase:1"]').click();
await pause(30);
assert.equal(find("main").scrollTop, 1400);
assert.equal(find(".verse-catalogue-scroll").scrollLeft, 210);
assert.deepEqual(
  shownFrequencyRows(),
  phraseExpected({ kind: "phrases", frequency: 1, direction: "desc" }),
);
find('[data-verse-frequency-sort="phrase:1"]').click();
await pause(30);
assert.deepEqual(
  shownFrequencyRows(),
  phraseExpected({ kind: "phrases", frequency: 1, direction: "asc" }),
);
find('[data-action="verses-next"]').click();
await pause(30);
assert.deepEqual(
  shownFrequencyRows(),
  phraseExpected({ kind: "phrases", frequency: 1, direction: "asc" }, 50),
);
find(".verse-row").click();
await pause(30);
find('.verse-detail-page [data-page="verses"]').click();
await pause(30);
assert.deepEqual(
  shownFrequencyRows(),
  phraseExpected({ kind: "phrases", frequency: 1, direction: "asc" }, 50),
);
change("#verses-book", "Genesis");
await pause(30);
find('[data-verse-filter="words"]').click();
find("#verse-words-filter").value = "10";
submitVerseFilters();
await pause(30);
assert.deepEqual(
  shownFrequencyRows(),
  phraseExpected(
    { kind: "phrases", frequency: 1, direction: "asc" },
    0,
    "Genesis",
    { words: 10 },
  ),
);
for (const n of [2, 7, 22]) await addPhraseFrequency(n);
assert.equal(find('[data-action="verse-add-filter"]').disabled, false);
assert.equal(
  window.document.querySelectorAll(".verse-frequency-heading").length,
  5,
);
find('[data-verse-frequency-remove="1"]').click();
await pause(30);
assert.equal(
  find('[data-verse-frequency-sort="phrase:1"]')
    .closest('[role="columnheader"]')
    .getAttribute("aria-sort"),
  "ascending",
);
find('[data-verse-frequency-remove="phrase:1"]').click();
await pause(30);
assert.equal(
  window.document.querySelector('[data-action="verse-bible-order"]'),
  null,
);
for (const n of [2, 7, 22]) {
  find(`[data-verse-frequency-remove="phrase:${n}"]`).click();
  await pause(30);
}
find("#verse-words-filter").value = "";
submitVerseFilters();
await pause(30);

find('nav [data-page="reader"]').click();
find("#verse-14").click();
await pause(30);
assert.ok(verseCatalogue.detail("Genesis", 1, 14, 0).phraseResults.total > 50);
find('[data-action="verse-phrases-next"]').click();
await pause(30);
assert.deepEqual(
  [...window.document.querySelectorAll(".verse-phrase-row")].map(
    (row) => row.dataset.savedPhrase,
  ),
  verseCatalogue
    .detail("Genesis", 1, 14, 50)
    .phraseResults.entries.map((entry) => entry.phrase),
);
// Sort before paging, not just the current 50 rows.
sortClick("verse-phrases", "occurrences");
await pause(30);
assertSortPosition();
const numericPage = verseCatalogue.detail("Genesis", 1, 14, 0, {
  field: "occurrences",
  direction: "asc",
});
assert.deepEqual(
  [...window.document.querySelectorAll(".verse-phrase-row")].map(
    (row) => row.dataset.savedPhrase,
  ),
  numericPage.phraseResults.entries.map((entry) => entry.phrase),
);
find('[data-action="verse-phrases-next"]').click();
await pause(30);
assert.deepEqual(
  [...window.document.querySelectorAll(".verse-phrase-row")].map(
    (row) => row.dataset.savedPhrase,
  ),
  verseCatalogue
    .detail("Genesis", 1, 14, 50, { field: "occurrences", direction: "asc" })
    .phraseResults.entries.map((entry) => entry.phrase),
);
find('[data-action="verse-phrases-previous"]').click();
await pause(30);
const chosenPhraseRow = [
  ...window.document.querySelectorAll(".verse-phrase-row"),
].sort(
  (a, b) =>
    tokenize(b.querySelector(".scripture").textContent).length -
    tokenize(a.querySelector(".scripture").textContent).length,
)[0];
const chosenPhraseLabel =
  chosenPhraseRow.querySelector(".scripture").textContent;
chosenPhraseRow.click();
await pause(30);
assert.ok(find(".phrase-detail-page"));
assert.equal(find(".phrase-detail-page h1").textContent, chosenPhraseLabel);
assert.ok(
  window.document.querySelector(".phrase-interactive-title [data-word]"),
);
const phraseContents = phraseCatalogue.detail(chosenPhraseLabel);
assert.equal(
  window.document.querySelectorAll(".phrase-detail-page .context-word-row")
    .length,
  phraseContents.wordEntries.length,
);
for (const [owner, rowSelector, fields] of [
  [
    "phrase-words",
    ".phrase-detail-page .context-word-row",
    [
      ["occurrences", 1],
      ["letters", 2],
      ["books", 3],
    ],
  ],
  [
    "subphrases",
    ".subphrases-section .verse-phrase-row",
    [
      ["occurrences", 1],
      ["books", 2],
    ],
  ],
]) {
  for (const [field, column] of fields) {
    sortClick(owner, field);
    let values = [...window.document.querySelectorAll(rowSelector)].map((row) =>
      Number(row.children[column].textContent.replaceAll(",", "")),
    );
    assert.ok(values.every((value, i) => !i || values[i - 1] <= value));
    sortClick(owner, field);
    values = [...window.document.querySelectorAll(rowSelector)].map((row) =>
      Number(row.children[column].textContent.replaceAll(",", "")),
    );
    assert.ok(values.every((value, i) => !i || values[i - 1] >= value));
  }
}
find(".phrase-interactive-title [data-word]").click();
await pause(30);
assert.ok(find(".word-detail-page"));

find('nav [data-page="reader"]').click();
find("#verse-1").click();
await pause(30);
sortClick("verse-phrases", "phrase");
await pause(30);
assertSortPosition();
find('[data-action="verse-reader"]').click();
await pause(30);
assert.equal(find(".selected-verse").id, "verse-1");
change("#chapter", "2");
change("#chapter", "3");
await pause(120);
assert.match(find(".chapter-heading").textContent, /CHAPTER 3/);
assert.match(find(".verse").textContent, /Now the serpent/);
change("#book", "Revelation");
await pause(20);
change("#chapter", "22");
await pause(20);
assert.ok(find('[data-action="next"]').disabled);
find('[data-page="search"]').click();
find("#query").value = "God";
find("#search-form").dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
await pause(30);
assert.equal(window.document.querySelectorAll(".result").length, 50);
assert.ok(window.document.querySelectorAll(".result mark").length >= 50);
assert.equal(find(".result mark").textContent.toLowerCase(), "god");
const wholeGodVerses = corpus.filter((verse) =>
  tokenize(verse.text).includes("god"),
).length;
assert.match(
  find(".result-summary").textContent,
  new RegExp(wholeGodVerses.toLocaleString()),
);
find('[name="partial"]').checked = true;
find("#search-form").dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
await pause(30);
const partialGodVerses = corpus.filter((verse) =>
  verse.text.toLowerCase().includes("god"),
).length;
assert.ok(partialGodVerses > wholeGodVerses);
assert.match(
  find(".result-summary").textContent,
  new RegExp(partialGodVerses.toLocaleString()),
);
assert.ok(find('[name="partial"]').checked);
find('[name="partial"]').checked = false;
find("#search-form").dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
await pause(30);
find('[data-action="search-next"]').click();
await pause(30);
assert.match(find(".chapter-navigation").textContent, /Page 2/);
const result = find(".result");
const target = { ...result.dataset };
result.click();
await pause(30);
assert.equal(find("#book").value, target.book);
assert.equal(find("#chapter").value, target.chapter);
assert.equal(find(".selected-verse").id, `verse-${target.verse}`);
find('[data-page="search"]').click();
find("#query").value = "beginning God";
find("#search-book").value = "Genesis";
find('[name="phrase"]').checked = true;
find("#search-form").dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
await pause(30);
assert.equal(window.document.querySelectorAll(".result").length, 1);
assert.equal(find(".result mark").textContent, "beginning God");
find("#query").value = "<script>missing</script>";
find("#search-form").dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
await pause(30);
assert.match(find(".notice").textContent, /No verses found/);
assert.equal(window.document.querySelectorAll("script").length, 0);
find('[data-page="occurrences"]').click();
assert.ok(find(".occurrence-parameters-pane #occurrence-form"));
assert.ok(find(".occurrence-results-pane"));
find("#occurrence-words").value = "3";
change("#occurrence-mode", "any");
assert.ok(find("#occurrence-words").disabled);
assert.ok(find("#occurrence-words").closest("label").hidden);
change("#occurrence-mode", "exact");
assert.ok(!find("#occurrence-words").disabled);
assert.ok(!find("#occurrence-words").closest("label").hidden);
assert.equal(find("#occurrence-words").value, "3");
change("#occurrence-mode", "any");
change("#occurrence-mode", "upTo");
assert.ok(!find("#occurrence-words").closest("label").hidden);
assert.equal(find("#occurrence-words").value, "3");
find("#occurrence-words").value = "2";
for (const id of [
  "#occurrence-books",
  "#occurrence-letters",
  "#occurrence-verses",
  "#occurrence-chapters",
  "#occurrence-chapter-frequency",
])
  assert.ok(find(id).disabled);
change("#occurrence-book-mode", "exact");
assert.ok(!find("#occurrence-books").disabled);
change("#occurrence-book-mode", "any");
assert.ok(find("#occurrence-books").disabled);
find("#occurrence-books").value = "0";
find("#occurrence-form").dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
await pause(30);
assert.equal(occurrenceRequests.at(-1).count, 7);
assert.equal(occurrenceRequests.at(-1).countUpTo, false);
assert.equal(occurrenceRequests.at(-1).upTo, true);
assert.equal(window.document.querySelectorAll(".occurrence-result").length, 50);
assert.match(find(".cache-status").textContent, /Built and saved/);
find('[data-action="occurrence-next"]').click();
await pause(30);
assert.equal(occurrenceRequests.at(-1).offset, 50);
assert.match(find(".cache-status").textContent, /Saved data reused/);
assert.match(find(".chapter-navigation").textContent, /Page 2/);
find('[data-action="occurrence-copy"]').click();
await pause(30);
assert.match(find("#occurrence-copy-status").textContent, /Copied/);
const csvRows = copiedCsv.trim().split("\n");
assert.equal(csvRows.shift(), "phrase/word,count");
assert.ok(csvRows.length > 50);
assert.ok(csvRows.every((row) => row.endsWith(",7")));
const csvNames = csvRows.map((row) => row.slice(0, row.lastIndexOf(",")));
assert.deepEqual(csvNames, [...csvNames].sort());
const expectedCsvNames = [1, 2]
  .flatMap((length) =>
    [...savedLengths.get(JSON.stringify([length, null]))]
      .filter(([, data]) => data.count === 7)
      .map(([phrase]) => phrase),
  )
  .sort();
assert.deepEqual(csvNames, expectedCsvNames);
clipboardFails = true;
find('[data-action="occurrence-copy"]').click();
await pause(30);
assert.match(find("#occurrence-copy-status").textContent, /Unable to copy/);
assert.ok(!find('[data-action="occurrence-copy"]').disabled);
clipboardFails = false;
for (const [mode, id] of [
  ["#occurrence-book-mode", "#occurrence-books"],
  ["#occurrence-letter-mode", "#occurrence-letters"],
  ["#occurrence-verse-mode", "#occurrence-verses"],
  ["#occurrence-chapter-mode", "#occurrence-chapters"],
  ["#occurrence-chapter-frequency-mode", "#occurrence-chapter-frequency"],
]) {
  assert.ok(find(id).closest("label").hidden);
  const value = find(id).value;
  change(mode, "exact");
  assert.ok(!find(id).closest("label").hidden);
  change(mode, "any");
  assert.ok(find(id).disabled && find(id).closest("label").hidden);
  assert.equal(find(id).value, value);
}
change("#occurrence-count-mode", "any");
assert.ok(
  find("#occurrence-count").disabled &&
    find("#occurrence-count").closest("label").hidden,
);
assert.equal(find("#occurrence-count").value, "7");
change("#occurrence-mode", "exact");
find("#occurrence-words").value = "1";
find("#occurrence-form").dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
await pause(30);
assert.equal(occurrenceRequests.at(-1).anyCount, true);
assert.equal(occurrenceRequests.at(-1).count, 4294967295);
assert.equal(occurrenceRequests.at(-1).countUpTo, true);
assert.ok(find("#occurrence-count").closest("label").hidden);
assert.equal(find("#occurrence-count").value, "7");
change("#occurrence-count-mode", "exact");
assert.ok(!find("#occurrence-count").closest("label").hidden);
assert.equal(find("#occurrence-count").value, "7");
change("#occurrence-mode", "upTo");
find("#occurrence-words").value = "2";
change("#occurrence-count-mode", "upTo");
assert.equal(find("#occurrence-count").value, "7");
find("#occurrence-form").dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
await pause(30);
assert.equal(occurrenceRequests.at(-1).countUpTo, true);
assert.equal(occurrenceRequests.at(-1).offset, 0);
assert.ok(
  [...window.document.querySelectorAll(".occurrence-result")].every((row) =>
    /[1-7] occurrences/.test(row.textContent),
  ),
);
find('[data-action="occurrence-next"]').click();
await pause(30);
assert.equal(occurrenceRequests.at(-1).countUpTo, true);
change("#occurrence-count-mode", "exact");
find("#occurrence-form").dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
await pause(30);
assert.equal(occurrenceRequests.at(-1).countUpTo, false);
find("#occurrence-mode").value = "exact";
find("#occurrence-form").dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
await pause(30);
assert.equal(occurrenceRequests.at(-1).words, 2);
assert.equal(occurrenceRequests.at(-1).upTo, false);
assert.equal(occurrenceRequests.at(-1).offset, 0);
assert.ok(
  [...window.document.querySelectorAll(".occurrence-result")].every(
    (row) => tokenize(row.dataset.phrase).length === 2,
  ),
);
const countedPhrase = find(".occurrence-result").dataset.phrase;
find(".occurrence-result").click();
await pause(30);
assert.equal(find("#query").value, countedPhrase);
assert.ok(find(".result mark"));
assert.match(find(".counting-note").textContent, /whole, consecutive words/);
find('[data-page="occurrences"]').click();
find("#occurrence-words").value = "1";
find("#occurrence-form").dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
await pause(30);
assert.ok(
  [...window.document.querySelectorAll(".occurrence-result")].every(
    (row) => tokenize(row.dataset.phrase).length === 1,
  ),
);
find("#occurrence-book-mode").value = "exact";
find("#occurrence-books").value = "3";
find("#occurrence-form").dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
await pause(30);
assert.equal(occurrenceRequests.at(-1).books, 3);
assert.equal(occurrenceRequests.at(-1).booksUpTo, false);
assert.ok(window.document.querySelectorAll(".occurrence-result").length > 0);
assert.ok(
  [...window.document.querySelectorAll(".book-count")].every(
    (label) => label.textContent === "3 books",
  ),
);
assert.match(find(".cache-status").textContent, /Saved data reused/);
find("#occurrence-book-mode").value = "upTo";
find("#occurrence-form").dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
await pause(30);
assert.equal(occurrenceRequests.at(-1).booksUpTo, true);
assert.ok(
  [...window.document.querySelectorAll(".book-count")].every(
    (label) => Number.parseInt(label.textContent) <= 3,
  ),
);
find("#occurrence-book-mode").value = "any";
find("#occurrence-form").dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
await pause(30);
assert.equal(occurrenceRequests.at(-1).books, null);
find("#occurrence-letter-mode").value = "exact";
find("#occurrence-letters").value = "7";
find("#occurrence-form").dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
await pause(30);
assert.equal(occurrenceRequests.at(-1).letters, 7);
assert.equal(occurrenceRequests.at(-1).lettersUpTo, false);
assert.ok(window.document.querySelectorAll(".occurrence-result").length > 0);
assert.ok(
  [...window.document.querySelectorAll(".letter-count")].every(
    (label) => label.textContent === "7 letters",
  ),
);
assert.match(find(".cache-status").textContent, /Saved data reused/);
find("#occurrence-letter-mode").value = "upTo";
find("#occurrence-book-mode").value = "upTo";
find("#occurrence-books").value = "3";
find("#occurrence-form").dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
await pause(30);
assert.equal(occurrenceRequests.at(-1).lettersUpTo, true);
assert.ok(
  [...window.document.querySelectorAll(".letter-count")].every(
    (label) => Number.parseInt(label.textContent) <= 7,
  ),
);
assert.ok(
  [...window.document.querySelectorAll(".book-count")].every(
    (label) => Number.parseInt(label.textContent) <= 3,
  ),
);
find("#occurrence-letter-mode").value = "any";
find("#occurrence-form").dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
await pause(30);
assert.equal(occurrenceRequests.at(-1).letters, null);
change("#occurrence-book-mode", "any");
change("#occurrence-verse-mode", "exact");
find("#occurrence-verses").value = "2";
assert.ok(!find("#occurrence-verses").disabled);
find("#occurrence-form").dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
await pause(30);
assert.equal(occurrenceRequests.at(-1).consecutiveVerses, 2);
assert.ok(window.document.querySelectorAll(".occurrence-result").length > 0);
assert.ok(
  [...window.document.querySelectorAll(".verse-run")].every(
    (label) => Number(label.textContent) >= 2,
  ),
);
change("#occurrence-verse-mode", "any");
assert.ok(find("#occurrence-verses").disabled);
change("#occurrence-chapter-mode", "exact");
find("#occurrence-chapters").value = "2";
find("#occurrence-form").dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
await pause(30);
assert.equal(occurrenceRequests.at(-1).consecutiveChapters, 2);
assert.ok(
  [...window.document.querySelectorAll(".chapter-run")].every(
    (label) => Number(label.textContent) >= 2,
  ),
);
change("#occurrence-chapter-mode", "any");
change("#occurrence-chapter-frequency-mode", "exact");
find("#occurrence-chapter-frequency").value = "2";
find("#occurrence-form").dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
await pause(30);
assert.equal(occurrenceRequests.at(-1).chapterFrequency, 2);
assert.ok(window.document.querySelectorAll(".occurrence-result").length > 0);
change("#occurrence-chapter-frequency-mode", "any");
assert.ok(find("#occurrence-chapter-frequency").disabled);
find("#occurrence-count").value = "4294967295";
find("#occurrence-form").dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
await pause(30);
assert.match(find(".notice").textContent, /No words or phrases/);
find('[data-page="books"]').click();
await pause(30);
assert.equal(find(".books-page h2").textContent, "Genesis");
assert.match(find(".book-statistics").textContent, /1,533/);
assert.equal(
  window.document.querySelectorAll("[data-statistics-chapter]").length,
  50,
);
find('[data-statistics-chapter="1"]').click();
assert.equal(find(".chapter-statistics-page h1").textContent, "Chapter 1");
const expectedChapterCounts = (book, chapter) => {
  const tokens = corpus
    .filter((verse) => verse.book === book && verse.chapter === chapter)
    .flatMap((verse) => tokenize(verse.text));
  const unique = new Set(tokens);
  const outside = new Set(
    corpus
      .filter((verse) => verse.book !== book || verse.chapter !== chapter)
      .flatMap((verse) => tokenize(verse.text)),
  );
  return [
    tokens.length,
    unique.size,
    [...unique].filter((word) => !outside.has(word)).length,
  ];
};
const displayedChapterCounts = () =>
  [...window.document.querySelectorAll(".chapter-statistics-page dd")].map(
    (entry) =>
      Number(entry.textContent.match(/^[\d,]+/)[0].replaceAll(",", "")),
  );
const expectedChapterWords = (book, chapter) => {
  const counts = new Map();
  corpus
    .filter((verse) => verse.book === book && verse.chapter === chapter)
    .flatMap((verse) => tokenize(verse.text))
    .forEach((word) => counts.set(word, (counts.get(word) ?? 0) + 1));
  const outside = new Set(
    corpus
      .filter((verse) => verse.book !== book || verse.chapter !== chapter)
      .flatMap((verse) => tokenize(verse.text)),
  );
  return [...counts]
    .filter(([word]) => !outside.has(word))
    .sort(([left, a], [right, b]) => b - a || left.localeCompare(right));
};
assert.deepEqual(displayedChapterCounts(), expectedChapterCounts("Genesis", 1));
find('[data-action="chapter-exclusive-words"]').click();
assert.equal(
  find(".exclusive-words-page h1").textContent,
  "Words only found in this chapter",
);
assert.deepEqual(
  [...window.document.querySelectorAll(".exclusive-word-list li")].map(
    (row) => [
      row.querySelector(".scripture").textContent,
      Number(
        row
          .querySelector(".exclusive-frequency")
          .textContent.replaceAll(",", ""),
      ),
    ],
  ),
  expectedChapterWords("Genesis", 1),
);
find('.exclusive-words-page [data-page="book-chapter"]').click();
assert.equal(find(".chapter-statistics-page h1").textContent, "Chapter 1");
assert.equal(
  find('nav [data-page="books"]').getAttribute("aria-current"),
  "page",
);
assert.match(find(".counting-note").textContent, /entire Bible/);
find('[data-statistics-chapter="50"]').click();
assert.equal(find(".chapter-statistics-page h1").textContent, "Chapter 50");
assert.deepEqual(
  displayedChapterCounts(),
  expectedChapterCounts("Genesis", 50),
);
find('.chapter-statistics-page [data-book="Genesis"]').click();
await pause(30);
assert.equal(find("#chapter").value, "50");
find('nav [data-page="books"]').click();
await pause(30);
find('[data-statistics-chapter="2"]').click();
find('.chapter-statistics-page [data-page="books"]').click();
await pause(30);
assert.equal(find(".books-page h2").textContent, "Genesis");
assert.equal(
  window.document.querySelectorAll("[data-phrase-length]").length,
  32,
);
find('[data-phrase-length="2"]').click();
await pause(30);
const expectedPhrases = exclusiveFixture(tokenLines, "Genesis", 2);
assert.match(
  find(".exclusive-phrases-page h1").textContent,
  /Phrases only found/,
);
const displayedPhrases = () =>
  [...window.document.querySelectorAll(".exclusive-word-list li")].map(
    (row) => ({
      phrase: row.querySelector(".scripture").textContent,
      count: Number(
        row
          .querySelector(".exclusive-frequency")
          .textContent.replaceAll(",", ""),
      ),
    }),
  );
assert.deepEqual(displayedPhrases(), expectedPhrases.slice(0, 50));
assert.match(
  find('[data-phrase-length="2"] .phrase-length-count').textContent,
  new RegExp(expectedPhrases.length.toLocaleString()),
);
find('[data-action="phrase-next"]').click();
await pause(20);
assert.deepEqual(displayedPhrases(), expectedPhrases.slice(50, 100));
find('[data-action="phrase-previous"]').click();
await pause(20);
assert.deepEqual(displayedPhrases(), expectedPhrases.slice(0, 50));
find('[data-phrase-length="32"]').click();
await pause(20);
assert.match(find(".notice").textContent, /No phrases/);
assert.ok(
  exclusiveRequests.some(
    (request) =>
      request.command === "exclusive_phrases" && request.length === 32,
  ),
);
find('.exclusive-phrases-page [data-page="books"]').click();
await pause(30);
const genesisCounts = new Map();
corpus
  .filter((verse) => verse.book === "Genesis")
  .flatMap((verse) => tokenize(verse.text))
  .forEach((word) =>
    genesisCounts.set(word, (genesisCounts.get(word) ?? 0) + 1),
  );
const nonGenesisWords = new Set(
  corpus
    .filter((verse) => verse.book !== "Genesis")
    .flatMap((verse) => tokenize(verse.text)),
);
const expectedExclusive = [...genesisCounts]
  .filter(([word]) => !nonGenesisWords.has(word))
  .sort(([left, a], [right, b]) => b - a || left.localeCompare(right));
assert.equal(
  Number(
    find(".exclusive-count")
      .textContent.match(/^[\d,]+/)[0]
      .replaceAll(",", ""),
  ),
  expectedExclusive.length,
);
find(".exclusive-count").click();
assert.match(find(".exclusive-words-page h1").textContent, /Words only found/);
const displayedExclusive = () =>
  [...window.document.querySelectorAll(".exclusive-word-list li")].map(
    (row) => [
      row.querySelector(".scripture").textContent,
      Number(
        row
          .querySelector(".exclusive-frequency")
          .textContent.replaceAll(",", ""),
      ),
    ],
  );
assert.deepEqual(displayedExclusive(), expectedExclusive.slice(0, 50));
if (expectedExclusive.length > 50) {
  find('[data-action="exclusive-next"]').click();
  assert.deepEqual(displayedExclusive(), expectedExclusive.slice(50, 100));
  find('[data-action="exclusive-previous"]').click();
  assert.deepEqual(displayedExclusive(), expectedExclusive.slice(0, 50));
}
find(".exclusive-word-link").click();
await pause(30);
assert.equal(find(".word-detail-page h1").textContent, expectedExclusive[0][0]);
assert.equal(
  Number(find(".word-detail-page dd").textContent.replaceAll(",", "")),
  expectedExclusive[0][1],
);
assert.deepEqual(
  [
    ...window.document.querySelectorAll(
      ".word-book-list button span:first-child",
    ),
  ].map((entry) => entry.textContent),
  ["Genesis"],
);
find('nav [data-page="books"]').click();
await pause(30);
find(".exclusive-count").click();
find('.exclusive-words-page [data-page="books"]').click();
await pause(30);
assert.equal(find(".books-page h2").textContent, "Genesis");

find('[data-statistics-book="Exodus"]').click();
await pause(30);
assert.equal(find(".books-page h2").textContent, "Exodus");
assert.match(find(".book-statistics").textContent, /1,213/);
assert.equal(
  window.document.querySelectorAll("[data-statistics-chapter]").length,
  40,
);
find('[data-statistics-chapter="1"]').click();
assert.deepEqual(displayedChapterCounts(), expectedChapterCounts("Exodus", 1));
find('nav [data-page="books"]').click();
await pause(30);
find('[data-statistics-book="1 Chronicles"]').click();
await pause(30);
find('[data-statistics-chapter="4"]').click();
const chapterExclusive = expectedChapterWords("1 Chronicles", 4);
assert.ok(chapterExclusive.length > 50);
find('[data-action="chapter-exclusive-words"]').click();
assert.match(
  find(".result-summary").textContent,
  /Appearances in 1 Chronicles 4/,
);
assert.deepEqual(displayedExclusive(), chapterExclusive.slice(0, 50));
find('[data-action="exclusive-next"]').click();
assert.deepEqual(displayedExclusive(), chapterExclusive.slice(50, 100));
assert.ok(find('[data-action="exclusive-next"]').disabled);
find('[data-action="exclusive-previous"]').click();
assert.deepEqual(displayedExclusive(), chapterExclusive.slice(0, 50));
find('.exclusive-words-page [data-page="book-chapter"]').click();
assert.equal(find(".chapter-statistics-page h1").textContent, "Chapter 4");
find('[data-statistics-chapter="1"]').click();
find('[data-action="chapter-exclusive-words"]').click();
assert.deepEqual(
  displayedExclusive(),
  expectedChapterWords("1 Chronicles", 1).slice(0, 50),
);
find('[data-page="occurrences"]').click();
const chooser = find("#choose-books");
chooser.checked = true;
chooser.dispatchEvent(new window.Event("change", { bubbles: true }));
assert.equal(find("#included-books").disabled, false);
assert.equal(find("#included-books").hidden, false);
find('[name="includedBooks"][value="Genesis"]').checked = true;
find("#occurrence-count").value = "7";
find("#occurrence-form").dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
await pause(30);
assert.deepEqual(occurrenceRequests.at(-1).includedBooks, ["Genesis"]);
assert.ok(window.document.querySelectorAll(".occurrence-result").length > 0);
find(".occurrence-result").click();
await pause(30);
assert.ok(
  [...window.document.querySelectorAll(".result-reference")].every((label) =>
    label.textContent.startsWith("Genesis"),
  ),
);
find('[data-page="occurrences"]').click();
change("#occurrence-mode", "any");
find("#occurrence-count").value = "1";
find("#occurrence-form").dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
await pause(30);
assert.equal(occurrenceRequests.at(-1).words, 32);
assert.equal(occurrenceRequests.at(-1).upTo, true);
assert.equal(occurrenceRequests.at(-1).anyLength, true);
assert.equal(find("#occurrence-mode").value, "any");
assert.ok(find("#occurrence-words").closest("label").hidden);
assert.ok(
  [...window.document.querySelectorAll(".occurrence-result")].some(
    (row) => tokenize(row.dataset.phrase).length > 2,
  ),
);
find('[data-action="occurrence-next"]').click();
await pause(30);
assert.equal(occurrenceRequests.at(-1).anyLength, true);
assert.equal(occurrenceRequests.at(-1).offset, 50);
change("#occurrence-mode", "exact");
assert.ok(!find("#occurrence-words").closest("label").hidden);
assert.equal(find("#occurrence-words").value, "1");
find('nav [data-page="words"]').click();
await pause(30);
const displayedWords = () =>
  [...window.document.querySelectorAll(".word-row")].map(
    (row) => row.dataset.word,
  );
const allWords = [
  ...new Set(corpus.flatMap((verse) => tokenize(verse.text))),
].sort();
assert.deepEqual(displayedWords(), allWords.slice(0, 50));
assert.ok(find('[data-action="words-previous"]').disabled);
find('[data-action="words-next"]').click();
await pause(30);
assert.deepEqual(displayedWords(), allWords.slice(50, 100));
find("#word-filter").value = "GOD";
find("#words-form").dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
await pause(30);
assert.deepEqual(
  displayedWords(),
  allWords.filter((word) => word.includes("god")).slice(0, 50),
);
const godTokens = corpus
  .flatMap((verse) => tokenize(verse.text))
  .filter((word) => word === "god").length;
const godBooks = [
  ...new Set(
    corpus
      .filter((verse) => tokenize(verse.text).includes("god"))
      .map((verse) => verse.book),
  ),
];
const godRow = find('[data-word="god"]');
assert.equal(
  Number(godRow.children[1].textContent.replaceAll(",", "")),
  godTokens,
);
assert.equal(Number(godRow.children[2].textContent), godBooks.length);
godRow.click();
await pause(30);
assert.equal(find(".word-detail-page h1").textContent, "god");
assert.deepEqual(
  [...window.document.querySelectorAll(".word-detail-page dd")].map((entry) =>
    Number(entry.textContent.replaceAll(",", "")),
  ),
  [godTokens, godBooks.length, 3],
);
assert.deepEqual(
  [
    ...window.document.querySelectorAll(
      ".word-book-list button span:first-child",
    ),
  ].map((entry) => entry.textContent),
  godBooks,
);
assert.match(
  find(".word-detail-page .result-reference").textContent,
  /Genesis 1:1/,
);
find('.word-book-list [data-word-book="Exodus"]').click();
await pause(30);
assert.equal(find("#query").value, "god");
assert.equal(find("#search-book").value, "Exodus");
assert.ok(!find('[name="partial"]').checked);
find('nav [data-page="words"]').click();
await pause(30);
assert.equal(find("#word-filter").value, "GOD");
find('[data-word="god"]').click();
await pause(30);
find(".word-detail-page .result").click();
await pause(30);
assert.equal(find(".selected-verse").id, "verse-1");
find('nav [data-page="words"]').click();
await pause(30);
find("#word-filter").value = "zzzz_no_word";
find("#words-form").dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
await pause(30);
assert.match(find(".notice").textContent, /No words match/);
// Clicking count headers exposes exact filters, including the user's 66-book case.
find("#word-filter").value = "";
find('[data-word-filter="books"]').click();
assert.ok(!find("#word-books-filter").closest("label").hidden);
find("#word-books-filter").value = "66";
find('[data-word-filter="count"]').click();
assert.equal(find("#word-books-filter").value, "66");
const submitWords = () =>
  find("#words-form").dispatchEvent(
    new window.Event("submit", { bubbles: true, cancelable: true }),
  );
submitWords();
await pause(30);
const inEveryBook = allWords.filter(
  (word) => wordCatalogue.detail(word).books.length === 66,
);
assert.ok(inEveryBook.length > 0);
assert.deepEqual(displayedWords(), inEveryBook.slice(0, 50));
assert.ok(
  [...window.document.querySelectorAll(".word-row")].every(
    (row) => row.children[2].textContent === "66",
  ),
);
const countedWord = inEveryBook[0];
find('[data-word-filter="count"]').click();
find("#word-count-filter").value = String(
  wordCatalogue.detail(countedWord).count,
);
submitWords();
await pause(30);
assert.deepEqual(
  displayedWords(),
  inEveryBook.filter(
    (word) =>
      wordCatalogue.detail(word).count ===
      wordCatalogue.detail(countedWord).count,
  ),
);
find(".word-row").click();
await pause(30);
find('.word-detail-page [data-page="words"]').click();
await pause(30);
assert.equal(find("#word-books-filter").value, "66");
assert.equal(
  find("#word-count-filter").value,
  String(wordCatalogue.detail(countedWord).count),
);
find("#word-count-filter").value = "";
find("#word-books-filter").value = "";
submitWords();
await pause(30);
assert.deepEqual(displayedWords(), allWords.slice(0, 50));
// Saved phrase browsing uses every persisted candidate, once, in alphabetical order.
find('nav [data-page="phrases"]').click();
await pause(30);
const expectedSaved = phraseCatalogue.list(savedLengths, exclusiveSaved, 0);
const displayedSavedPhrases = () =>
  [...window.document.querySelectorAll(".phrase-row")].map(
    (row) => row.dataset.savedPhrase,
  );
assert.deepEqual(
  displayedSavedPhrases(),
  expectedSaved.entries.map((entry) => entry.phrase),
);
assert.ok(expectedSaved.total > 50);
assert.ok(find('[data-action="saved-phrases-previous"]').disabled);
const firstPhrase = expectedSaved.entries[0];
assert.deepEqual(
  [...find(".phrase-row").children]
    .slice(1)
    .map((cell) => Number(cell.textContent)),
  [
    firstPhrase.words,
    firstPhrase.letters,
    firstPhrase.occurrences,
    firstPhrase.books,
  ],
);
find('[data-action="saved-phrases-next"]').click();
await pause(30);
assert.deepEqual(
  displayedSavedPhrases(),
  phraseCatalogue
    .list(savedLengths, exclusiveSaved, 50)
    .entries.map((entry) => entry.phrase),
);
// Exact phrase count filters combine and survive paging/detail navigation.
const submitPhrases = () =>
  find("#phrases-form").dispatchEvent(
    new window.Event("submit", { bubbles: true, cancelable: true }),
  );
const targetPhrase = firstPhrase;
for (const field of ["words", "letters", "occurrences", "books"]) {
  find(`[data-phrase-filter="${field}"]`).click();
  assert.ok(!find(`#phrase-${field}-filter`).closest("label").hidden);
  find(`#phrase-${field}-filter`).value = String(targetPhrase[field]);
}
find('[data-action="wider"]').click();
assert.equal(find("#phrase-books-filter").value, String(targetPhrase.books));
assert.equal(
  find(".layout").style.getPropertyValue("--presentation-width"),
  "1100px",
);
find('[data-action="larger"]').click();
assert.equal(
  find("#phrase-letters-filter").value,
  String(targetPhrase.letters),
);
assert.equal(
  find(".layout").style.getPropertyValue("--scripture-size"),
  "30px",
);
submitPhrases();
await pause(30);
const chosenFilters = Object.fromEntries(
  ["words", "letters", "occurrences", "books"].map((field) => [
    field,
    targetPhrase[field],
  ]),
);
const expectedFiltered = phraseCatalogue.list(
  savedLengths,
  exclusiveSaved,
  0,
  chosenFilters,
);
assert.deepEqual(
  displayedSavedPhrases(),
  expectedFiltered.entries.map((entry) => entry.phrase),
);
find(".phrase-row").click();
await pause(30);
find('.phrase-detail-page [data-page="phrases"]').click();
await pause(30);
assert.equal(
  find("#phrase-occurrences-filter").value,
  String(targetPhrase.occurrences),
);
find("#phrase-occurrences-filter").value = "999999";
submitPhrases();
await pause(30);
assert.match(find(".notice").textContent, /No phrases match/);
assert.ok(find('[data-phrase-filter="occurrences"]'));
for (const field of ["words", "letters", "occurrences", "books"])
  find(`#phrase-${field}-filter`).value = "";
submitPhrases();
await pause(30);
assert.deepEqual(
  displayedSavedPhrases(),
  expectedSaved.entries.map((entry) => entry.phrase),
);
find('[data-action="saved-phrases-next"]').click();
await pause(30);
const phrase = displayedSavedPhrases()[0];
find(".phrase-row").click();
await pause(30);
const phraseDetail = phraseCatalogue.detail(phrase);
assert.equal(find(".phrase-detail-page h1").textContent, phrase);
assert.deepEqual(
  [...window.document.querySelectorAll(".phrase-detail-page dd")].map((cell) =>
    Number(cell.textContent.replaceAll(",", "")),
  ),
  [
    phraseDetail.words,
    phraseDetail.letters,
    phraseDetail.occurrences,
    phraseDetail.books,
  ],
);
assert.deepEqual(
  [
    ...window.document.querySelectorAll(
      ".phrase-detail-page .result-reference",
    ),
  ].map((cell) => cell.textContent),
  phraseDetail.results.verses.map(
    (verse) => `${verse.book} ${verse.chapter}:${verse.number} ↗`,
  ),
);
assert.ok(window.document.querySelector(".phrase-detail-page mark"));
assert.deepEqual(
  [...window.document.querySelectorAll(".phrase-books-table tbody tr")].map(
    (row) => ({
      book: row.children[0].textContent,
      occurrences: Number(row.children[1].textContent.replaceAll(",", "")),
    }),
  ),
  phraseDetail.bookEntries,
);
assert.equal(
  phraseDetail.bookEntries.reduce((sum, row) => sum + row.occurrences, 0),
  phraseDetail.occurrences,
);
assert.ok(
  [...window.document.querySelectorAll(".phrase-detail-page dd")].every(
    (cell) => cell.querySelector("[data-number]"),
  ),
);
assert.ok(
  window.document.querySelector(
    ".phrase-detail-page .context-word-row [data-number]",
  ),
);

find('.phrase-detail-page [data-page="phrases"]').click();
await pause(30);
assert.deepEqual(
  displayedSavedPhrases(),
  phraseCatalogue
    .list(savedLengths, exclusiveSaved, 50)
    .entries.map((entry) => entry.phrase),
);
find(".phrase-row").click();
await pause(30);
find(".phrase-detail-page .result").click();
await pause(30);
assert.equal(
  find(".selected-verse").id,
  `verse-${phraseDetail.results.verses[0].number}`,
);
assert.equal(
  find(".layout").style.getPropertyValue("--presentation-width"),
  "1100px",
);
assert.equal(
  find(".layout").style.getPropertyValue("--scripture-size"),
  "30px",
);
assert.ok(find('[aria-label="Increase presentation width"]'));
find('[data-action="narrower"]').click();
find('[data-action="smaller"]').click();
assert.equal(
  find(".layout").style.getPropertyValue("--presentation-width"),
  "900px",
);
assert.equal(
  find(".layout").style.getPropertyValue("--scripture-size"),
  "28px",
);
// Verse pagination keeps the same phrase and reaches later matching verses.
savedLengths.clear();
exclusiveSaved.clear();
savedLengths.set("[2,null]", new Map([["and the", {}]]));
find('nav [data-page="phrases"]').click();
await pause(30);
find('[data-action="saved-phrases-previous"]').click();
await pause(30);
find(".phrase-row").click();
await pause(30);
assert.ok(phraseCatalogue.detail("and the").results.total > 50);
find('[data-action="phrase-verses-next"]').click();
await pause(30);
assert.deepEqual(
  [
    ...window.document.querySelectorAll(
      ".phrase-detail-page .result-reference",
    ),
  ].map((cell) => cell.textContent),
  phraseCatalogue
    .detail("and the", 50)
    .results.verses.map(
      (verse) => `${verse.book} ${verse.chapter}:${verse.number} ↗`,
    ),
);
find('[data-action="phrase-verses-previous"]').click();
await pause(30);
assert.ok(find('[data-action="phrase-verses-previous"]').disabled);
// Search anywhere in persisted phrases, combine counts, page, and return from details.
savedLengths.clear();
exclusiveSaved.clear();
const searchCandidates = new Map();
for (const line of tokenLines)
  for (let i = 0; i + 2 <= line.tokens.length; i++) {
    const phrase = line.tokens.slice(i, i + 2).join(" ");
    if (phrase.includes("god")) searchCandidates.set(phrase, {});
  }
savedLengths.set("[2,null]", searchCandidates);
find('nav [data-page="phrases"]').click();
await pause(30);
for (const field of ["words", "letters", "occurrences", "books"])
  find(`#phrase-${field}-filter`).value = "";
find("#phrase-partial").checked = true;
find("#phrase-search").value = "GOD,";
submitPhrases();
await pause(30);
const expectedSearch = (text, partial = false, offset = 0, counts = {}) =>
  phraseCatalogue.list(savedLengths, exclusiveSaved, offset, {
    text,
    partial,
    exact: !partial,
    ...counts,
  });
assert.ok(expectedSearch("GOD,", true).total > 50);
assert.deepEqual(
  displayedSavedPhrases(),
  expectedSearch("GOD,", true).entries.map((e) => e.phrase),
);
find('[data-action="saved-phrases-next"]').click();
await pause(30);
assert.equal(find("#phrase-search").value, "GOD,");
assert.deepEqual(
  displayedSavedPhrases(),
  expectedSearch("GOD,", true, 50).entries.map((e) => e.phrase),
);
find(".phrase-row").click();
await pause(30);
find('[data-page="phrases"]').click();
await pause(30);
assert.deepEqual(
  displayedSavedPhrases(),
  expectedSearch("GOD,", true, 50).entries.map((e) => e.phrase),
);
find("#phrase-search").value = "god";
find("#phrase-partial").checked = true;
submitPhrases();
await pause(30);
assert.ok(expectedSearch("god", true).total > expectedSearch("god").total);
assert.deepEqual(
  displayedSavedPhrases(),
  expectedSearch("god", true).entries.map((e) => e.phrase),
);
const searchCount = expectedSearch("god", true).entries[0].occurrences;
find('[data-phrase-filter="occurrences"]').click();
assert.equal(find("#phrase-search").value, "god");
assert.equal(find("#phrase-partial").checked, true);
find("#phrase-occurrences-filter").value = String(searchCount);
submitPhrases();
await pause(30);
assert.deepEqual(
  displayedSavedPhrases(),
  expectedSearch("god", true, 0, { occurrences: searchCount }).entries.map(
    (e) => e.phrase,
  ),
);
find("#phrase-search").value = "xyzmissing";
submitPhrases();
await pause(30);
assert.match(find(".phrases-page .notice").textContent, /No phrases match/);
find("#phrase-search").value = "";
find('input[name="phrase-match"][value="exact"]').checked = true;
find("#phrase-occurrences-filter").value = "";
submitPhrases();
await pause(30);
assert.deepEqual(
  displayedSavedPhrases(),
  expectedSearch("").entries.map((e) => e.phrase),
);
// Hidden singleton segments never appear even when the search targets them.
const fullGenesisPhrase =
  "in the beginning god created the heaven and the earth";
const hiddenGenesisPhrase = "in the beginning god created the heaven and the";
savedLengths.set(
  "[10,null]",
  new Map([
    [fullGenesisPhrase, {}],
    [hiddenGenesisPhrase, {}],
    ["in the beginning god created", {}],
  ]),
);
find("#phrase-search").value = fullGenesisPhrase;
submitPhrases();
await pause(30);
assert.deepEqual(displayedSavedPhrases(), [fullGenesisPhrase]);
find("#phrase-search").value = hiddenGenesisPhrase;
submitPhrases();
await pause(30);
assert.deepEqual(displayedSavedPhrases(), []);
find("#phrase-partial").checked = true;
find("#phrase-search").value = hiddenGenesisPhrase;
submitPhrases();
await pause(30);
assert.deepEqual(displayedSavedPhrases(), [fullGenesisPhrase]);
find(".phrase-row").click();
await pause(30);
assert.ok(
  phraseCatalogue
    .detail(fullGenesisPhrase)
    .subphraseResults.entries.every((entry) => entry.occurrences > 1),
);
find('[data-page="phrases"]').click();
await pause(30);
assert.deepEqual(displayedSavedPhrases(), [fullGenesisPhrase]);
find("#phrase-search").value = "";
submitPhrases();
await pause(30);
// The user's repeated Daniel passage rolls up to one 36-word phrase.
const danielChild =
  "band of iron and brass in the tender grass of the field and let it be";
const danielParent =
  "in the earth even with a band of iron and brass in the tender grass of the field and let it be wet with the dew of heaven and let his portion be with the beasts";
savedLengths.set(
  "[36,null]",
  new Map([
    [danielChild, {}],
    [danielParent, {}],
    ["band of iron and brass", {}],
  ]),
);
find("#phrase-search").value = danielChild;
find('[data-phrase-filter="occurrences"]').click();
find("#phrase-occurrences-filter").value = "2";
submitPhrases();
await pause(30);
assert.deepEqual(displayedSavedPhrases(), [danielParent]);
find(".phrase-row").click();
await pause(30);
assert.equal(phraseCatalogue.detail(danielParent).words, 36);
assert.ok(
  !phraseCatalogue
    .detail(danielParent)
    .subphraseResults.entries.some((entry) => entry.occurrences === 2),
);
find('[data-page="phrases"]').click();
await pause(30);
find("#phrase-search").value = "";
find("#phrase-occurrences-filter").value = "";
submitPhrases();
await pause(30);
// Keep a manageable independent phrase sample with enough matches for paging.
const numberPhraseCounts = new Map();
for (const line of tokenLines)
  for (let i = 0; i + 2 <= line.tokens.length; i++) {
    const phrase = line.tokens.slice(i, i + 2).join(" ");
    numberPhraseCounts.set(phrase, (numberPhraseCounts.get(phrase) ?? 0) + 1);
  }
savedLengths.clear();
exclusiveSaved.clear();
savedLengths.set(
  "[2,null]",
  new Map(
    [...numberPhraseCounts].filter(([, count]) => count === 22).slice(0, 65),
  ),
);
// Numbers catalogue uses numeric order; profiles paginate all exact-frequency words.
find('nav [data-page="numbers"]').click();
await pause(30);
const shownNumbers = () =>
  [...window.document.querySelectorAll(".number-row")].map((row) =>
    Number(row.dataset.number),
  );
assert.deepEqual(
  shownNumbers(),
  numberCatalogue.list().entries.map((entry) => entry.number),
);
assert.equal(find(".number-row").dataset.number, "1");
find('[data-action="numbers-next"]').click();
await pause(30);
assert.deepEqual(
  shownNumbers(),
  numberCatalogue.list(50).entries.map((entry) => entry.number),
);
const openNumber = async (number) => {
  find("#number-input").value = String(number);
  find("#numbers-form").dispatchEvent(
    new window.Event("submit", { bubbles: true, cancelable: true }),
  );
  await pause(30);
};
await openNumber(1);
const shownNumberWords = () =>
  [...window.document.querySelectorAll(".number-detail-page .word-row")].map(
    (row) => row.dataset.word,
  );
assert.deepEqual(
  shownNumberWords(),
  numberCatalogue.words(1).entries.map((entry) => entry.word),
);
assert.ok(numberCatalogue.words(1).total > 50);
find('[data-action="number-words-next"]').click();
await pause(30);
assert.deepEqual(
  shownNumberWords(),
  numberCatalogue.words(1, 50).entries.map((entry) => entry.word),
);
const chosenWord = shownNumberWords()[0];
find(".number-detail-page .word-row").click();
await pause(30);
assert.equal(find(".word-detail-page h1").textContent, chosenWord);
find("[data-number-return]").click();
await pause(30);
assert.deepEqual(
  shownNumberWords(),
  numberCatalogue.words(1, 50).entries.map((entry) => entry.word),
);
find('[data-page="numbers"]').click();
await pause(30);
await openNumber(22);
assert.deepEqual(
  shownNumberWords(),
  numberCatalogue.words(22).entries.map((entry) => entry.word),
);
const shownNumberPhrases = () =>
  [
    ...window.document.querySelectorAll(".number-phrases-section .phrase-row"),
  ].map((row) => row.dataset.savedPhrase);
const expectedNumberPhrases = (offset) =>
  phraseCatalogue.list(savedLengths, exclusiveSaved, offset, {
    occurrences: 22,
  });
assert.ok(expectedNumberPhrases(0).total > 50);
assert.deepEqual(
  shownNumberPhrases(),
  expectedNumberPhrases(0).entries.map((entry) => entry.phrase),
);
const numberMain = find("main");
numberMain.scrollTop = 3600;
find('[data-action="number-phrases-next"]').click();
await pause(30);
assert.equal(find("main").scrollTop, 3600);
assert.deepEqual(
  shownNumberPhrases(),
  expectedNumberPhrases(50).entries.map((entry) => entry.phrase),
);
assert.deepEqual(
  shownNumberWords(),
  numberCatalogue.words(22).entries.map((entry) => entry.word),
);
const numberPhrase = shownNumberPhrases()[0];
find(".number-phrases-section .phrase-row").click();
await pause(30);
assert.equal(find(".phrase-detail-page h1").textContent, numberPhrase);
find("[data-number-return]").click();
await pause(30);
assert.deepEqual(
  shownNumberPhrases(),
  expectedNumberPhrases(50).entries.map((entry) => entry.phrase),
);
find('[data-page="numbers"]').click();
await pause(30);
await openNumber(100);
const expectedNumberVerses = (offset) =>
  verseCatalogue.list(null, offset, { letters: 100 });
const shownNumberVerses = () =>
  [
    ...window.document.querySelectorAll(".number-verses-section .verse-row"),
  ].map(
    (row) => `${row.dataset.book} ${row.dataset.chapter}:${row.dataset.verse}`,
  );
const refs = (page) =>
  page.entries.map(
    (entry) =>
      `${entry.verse.book} ${entry.verse.chapter}:${entry.verse.number}`,
  );
assert.ok(expectedNumberVerses(0).total > 50);
assert.deepEqual(shownNumberVerses(), refs(expectedNumberVerses(0)));
find("main").scrollTop = 7200;
find('[data-action="number-verses-next"]').click();
await pause(30);
assert.equal(find("main").scrollTop, 7200);
assert.deepEqual(shownNumberVerses(), refs(expectedNumberVerses(50)));
const numberVerse = expectedNumberVerses(50).entries[0];
find(".number-verses-section .verse-row").click();
await pause(30);
assert.equal(
  find(".verse-detail-page h1").textContent,
  refs({ entries: [numberVerse] })[0],
);
assert.equal(
  Number(
    window.document.querySelectorAll(
      ".verse-detail-page .book-statistics dd",
    )[1].textContent,
  ),
  100,
);
find("[data-number-return]").click();
await pause(30);
assert.deepEqual(shownNumberVerses(), refs(expectedNumberVerses(50)));
find('[data-page="numbers"]').click();
await pause(30);
await openNumber(22);
const numberWord = shownNumberWords()[0];
const numberWordDetail = wordCatalogue.detail(numberWord);
for (const [index, number] of [
  numberWordDetail.count,
  numberWordDetail.books.length,
  numberWordDetail.letters,
].entries()) {
  find(".number-detail-page .word-row").click();
  await pause(30);
  const links = window.document.querySelectorAll(
    ".word-detail-page .number-stat-link",
  );
  assert.equal(Number(links[index].dataset.number), number);
  links[index].click();
  await pause(30);
  assert.equal(
    find(".number-detail-page h1").textContent,
    number.toLocaleString(),
  );
  assert.deepEqual(
    shownNumberWords(),
    numberCatalogue.words(number).entries.map((entry) => entry.word),
  );
  find('[data-page="numbers"]').click();
  await pause(30);
  await openNumber(22);
}
find('[data-page="numbers"]').click();
await pause(30);
await openNumber(999999);
assert.match(
  find(".number-detail-page .notice").textContent,
  /No words appear exactly/,
);
// Chapter coverage is distinct by book and chapter; all modes survive search and paging.
find('nav [data-page="occurrences"]').click();
change("#occurrence-count-mode", "any");
change("#occurrence-mode", "exact");
find("#occurrence-words").value = "1";
for (const selector of [
  "#occurrence-book-mode",
  "#occurrence-letter-mode",
  "#occurrence-verse-mode",
  "#occurrence-chapter-mode",
  "#occurrence-chapter-frequency-mode",
])
  change(selector, "any");
find("#choose-books").checked = false;
find("#choose-books").dispatchEvent(
  new window.Event("change", { bubbles: true }),
);
assert.ok(find("#occurrence-total-chapters").closest("label").hidden);
change("#occurrence-chapters-mode", "exact");
assert.ok(
  !find("#occurrence-total-chapters").disabled &&
    !find("#occurrence-total-chapters").closest("label").hidden,
);
find("#occurrence-total-chapters").value = "22";
const submitOccurrences = () =>
  find("#occurrence-form").dispatchEvent(
    new window.Event("submit", { bubbles: true, cancelable: true }),
  );
submitOccurrences();
await pause(30);
assert.equal(occurrenceRequests.at(-1).chapters, 22);
assert.ok(
  [
    ...window.document.querySelectorAll(".occurrence-result .chapter-count"),
  ].every((cell) => cell.textContent === "22 chapters"),
);
find('[data-action="occurrence-copy"]').click();
await pause(30);
assert.match(find("#occurrence-copy-status").textContent, /Copied/);
const expectedCoverageWords = [...savedLengths.get("[1,null]")]
  .filter(
    ([, entry]) =>
      new Set(
        [...entry.positions.values()].map((p) => `${p.book} ${p.chapter}`),
      ).size === 22,
  )
  .map(([phrase]) => phrase)
  .sort();
assert.deepEqual(
  copiedCsv
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => line.slice(0, line.lastIndexOf(","))),
  expectedCoverageWords,
);
change("#occurrence-chapters-mode", "every");
assert.ok(
  find("#occurrence-total-chapters").disabled &&
    find("#occurrence-total-chapters").closest("label").hidden,
);
assert.equal(find("#occurrence-total-chapters").value, "22");
submitOccurrences();
await pause(30);
assert.equal(occurrenceRequests.at(-1).chapters, 1189);
assert.equal(find("#occurrence-chapters-mode").value, "every");
const allChapterWords = [...savedLengths.get("[1,null]")]
  .filter(
    ([, entry]) =>
      new Set(
        [...entry.positions.values()].map((p) => `${p.book} ${p.chapter}`),
      ).size === 1189,
  )
  .map(([phrase]) => phrase)
  .sort();
assert.deepEqual(
  [...window.document.querySelectorAll(".occurrence-result")]
    .map((row) => row.dataset.phrase)
    .sort(),
  allChapterWords,
);
change("#occurrence-chapters-mode", "any");
submitOccurrences();
await pause(30);
assert.equal(occurrenceRequests.at(-1).chapters, null);
assert.ok(find("#occurrence-total-chapters").closest("label").hidden);
// Multiple-book statistics use the union of selected books and exclude outside owners.
find('nav [data-page="books"]').click();
await pause(30);
find("#books-multiple").checked = true;
find("#books-multiple").dispatchEvent(
  new window.Event("change", { bubbles: true }),
);
await pause(30);
find('[data-action="books-select-none"]').click();
await pause(30);
assert.match(
  find(".books-page .notice").textContent,
  /Select one or more books/,
);
assert.equal(window.document.querySelector(".book-chapters"), null);
assert.equal(window.document.querySelector(".exclusive-phrase-section"), null);
const selectStatisticsBook = (book, checked = true) => {
  const button = find(`button[data-statistics-book="${book}"]`);
  if ((button.getAttribute("aria-pressed") === "true") !== checked)
    button.click();
};
selectStatisticsBook("Genesis");
await pause(30);
selectStatisticsBook("Exodus");
await pause(30);
assert.match(find(".books-mode").textContent, /2 books selected/);
assert.equal(
  window.document.querySelectorAll(".book-list [data-statistics-book]").length,
  66,
);
assert.equal(window.document.querySelectorAll(".book-list input").length, 0);
assert.equal(window.document.querySelector(".book-chapters"), null);
const groupLines = corpus.filter((verse) =>
  ["Genesis", "Exodus"].includes(verse.book),
);
const groupTokens = groupLines.flatMap((verse) => tokenize(verse.text));
const groupCounts = new Map();
for (const token of groupTokens)
  groupCounts.set(token, (groupCounts.get(token) ?? 0) + 1);
const outsideGroup = new Set(
  corpus
    .filter((verse) => !["Genesis", "Exodus"].includes(verse.book))
    .flatMap((verse) => tokenize(verse.text)),
);
const exclusiveGroup = [...groupCounts]
  .filter(([word]) => !outsideGroup.has(word))
  .map(([word, count]) => ({ word, count }))
  .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
const groupCells = [
  ...window.document.querySelectorAll(".books-page .book-statistics dd"),
];
assert.equal(
  Number(groupCells[2].textContent.replaceAll(",", "")),
  groupTokens.length,
);
assert.equal(
  Number(groupCells[3].textContent.replaceAll(",", "")),
  groupCounts.size,
);
assert.equal(
  Number(groupCells[5].textContent.replaceAll(",", "")),
  groupLines.length,
);
assert.ok(
  groupCells[0].textContent.includes(
    `(${Math.max(...groupCounts.values()).toLocaleString()} appearances)`,
  ),
);
assert.ok(
  groupCells[1].textContent.includes(
    `(${exclusiveGroup[0].count.toLocaleString()} appearances)`,
  ),
);
find('[data-action="exclusive-words"]').click();
assert.equal(
  find(".exclusive-words-page h1").textContent,
  "Words only found in these books",
);
assert.deepEqual(
  [...window.document.querySelectorAll(".exclusive-word-link")].map(
    (button) => button.dataset.word,
  ),
  exclusiveGroup.slice(0, 50).map((entry) => entry.word),
);
if (exclusiveGroup.length > 50) {
  find('[data-action="exclusive-next"]').click();
  assert.deepEqual(
    [...window.document.querySelectorAll(".exclusive-word-link")].map(
      (button) => button.dataset.word,
    ),
    exclusiveGroup.slice(50, 100).map((entry) => entry.word),
  );
}
const groupWord = find(".exclusive-word-link").dataset.word;
find(".exclusive-word-link").click();
await pause(30);
assert.equal(find(".word-detail-page h1").textContent, groupWord);
const requestsBeforeReturn = bookGroupRequests.length;
find('nav [data-page="books"]').click();
await pause(30);
assert.ok(find("#books-multiple").checked);
assert.equal(bookGroupRequests.length, requestsBeforeReturn);
selectStatisticsBook("Numbers");
selectStatisticsBook("Numbers", false);
await pause(30);
assert.match(find(".books-mode").textContent, /2 books selected/);
find('[data-action="books-select-all"]').click();
await pause(30);
assert.match(find(".books-mode").textContent, /66 books selected/);
const allGroupCells = [
  ...window.document.querySelectorAll(".books-page .book-statistics dd"),
];
assert.equal(
  Number(allGroupCells[3].textContent.replaceAll(",", "")),
  allWords.length,
);
assert.equal(
  Number(allGroupCells[5].textContent.replaceAll(",", "")),
  corpus.length,
);
assert.equal(window.document.querySelector(".book-chapters"), null);
find("#books-multiple").checked = false;
find("#books-multiple").dispatchEvent(
  new window.Event("change", { bubbles: true }),
);
await pause(30);
assert.ok(window.document.querySelector(".book-chapters"));
assert.ok(window.document.querySelector(".exclusive-phrase-section"));
// Verse catalogue text filters match complete words or partial text and compose with counts.
find('nav [data-page="verses"]').click();
await pause(30);
for (const button of [
  ...window.document.querySelectorAll("[data-verse-frequency-remove]"),
])
  button.click();
await pause(30);
find("#verses-book").value = "";
for (const field of ["words", "letters", "phrases"])
  find(`#verse-${field}-filter`).value = "";
const submitVerseSearch = () =>
  find("#verses-form").dispatchEvent(
    new window.Event("submit", { bubbles: true, cancelable: true }),
  );
const verseRefs = () =>
  [...window.document.querySelectorAll(".verse-table .verse-row")].map(
    (row) => `${row.dataset.book} ${row.dataset.chapter}:${row.dataset.verse}`,
  );
find("#verse-search").value = "GOD";
find('input[name="verse-match"][value="exact"]').checked = true;
submitVerseSearch();
await pause(30);
const exactGodVerses = corpus.filter((verse) =>
  tokenize(verse.text).includes("god"),
);
assert.deepEqual(
  verseRefs(),
  exactGodVerses
    .slice(0, 50)
    .map((verse) => `${verse.book} ${verse.chapter}:${verse.number}`),
);
find('[data-action="verses-next"]').click();
await pause(30);
assert.equal(find("#verse-search").value, "GOD");
assert.deepEqual(
  verseRefs(),
  exactGodVerses
    .slice(50, 100)
    .map((verse) => `${verse.book} ${verse.chapter}:${verse.number}`),
);
find("#verse-search").value = "od";
submitVerseSearch();
await pause(30);
assert.match(find(".verses-page .notice").textContent, /No verses match/);
find('input[name="verse-match"][value="partial"]').checked = true;
submitVerseSearch();
await pause(30);
const partialOdVerses = corpus.filter((verse) =>
  verse.text.toLowerCase().includes("od"),
);
assert.deepEqual(
  verseRefs(),
  partialOdVerses
    .slice(0, 50)
    .map((verse) => `${verse.book} ${verse.chapter}:${verse.number}`),
);
find('[data-verse-filter="words"]').click();
assert.equal(find("#verse-search").value, "od");
assert.ok(find('input[name="verse-match"][value="partial"]').checked);
find("#verse-search").value = "In the beginning";
find('input[name="verse-match"][value="exact"]').checked = true;
find("#verses-book").value = "Genesis";
find("#verse-words-filter").value = "10";
submitVerseSearch();
await pause(30);
assert.deepEqual(verseRefs(), ["Genesis 1:1"]);
find(".verse-row").click();
await pause(30);
find('[data-page="verses"]').click();
await pause(30);
assert.equal(find("#verse-search").value, "In the beginning");
assert.equal(find("#verse-words-filter").value, "10");
find("#verse-words-filter").value = "";
find("#verse-search").value = "God";
find("#verses-book").value = "";
submitVerseSearch();
await pause(30);
find('[data-action="verse-add-filter"]').click();
find("#verse-frequency-input").value = "1";
find("#verse-frequency-form").dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
await pause(30);
find("main").scrollTop = 400;
find('[data-verse-frequency-sort="1"]').click();
await pause(30);
assert.equal(find("main").scrollTop, 400);
assert.equal(find("#verse-search").value, "God");
assert.deepEqual(
  verseRefs(),
  verseCatalogue
    .catalogue({
      book: null,
      offset: 0,
      filters: { text: "God", words: null, letters: null, phrases: null },
      frequencies: [1],
      sort: { frequency: 1, direction: "desc" },
    })
    .entries.map(
      (entry) =>
        `${entry.verse.book} ${entry.verse.chapter}:${entry.verse.number}`,
    ),
);
find("#verse-search").value = "";
submitVerseSearch();
await pause(30);
assert.equal(find("#verse-search").value, "");
// Added searches repeatedly narrow the preceding verse results.
for (const button of [
  ...window.document.querySelectorAll("[data-verse-frequency-remove]"),
])
  button.click();
await pause(30);
find("#verse-search").value = "God";
find('input[name="verse-match"][value="exact"]').checked = true;
submitVerseSearch();
await pause(30);
find('[data-action="verse-search-add"]').click();
await pause(30);
assert.equal(find("#verse-search").value, "God");
assert.ok(find('[data-verse-search-row="0"]'));
find("#verse-search-1").value = "heaven";
submitVerseSearch();
await pause(30);
const godHeaven = corpus.filter(
  (verse) =>
    tokenize(verse.text).includes("god") &&
    tokenize(verse.text).includes("heaven"),
);
assert.deepEqual(
  verseRefs(),
  godHeaven
    .slice(0, 50)
    .map((verse) => `${verse.book} ${verse.chapter}:${verse.number}`),
);
find('[data-action="verse-search-add"]').click();
await pause(30);
assert.equal(find("#verse-search-1").value, "heaven");
find("#verse-search-2").value = "created";
submitVerseSearch();
await pause(30);
const narrowed = godHeaven.filter((verse) =>
  tokenize(verse.text).includes("created"),
);
assert.ok(narrowed.length < godHeaven.length);
assert.deepEqual(
  verseRefs(),
  narrowed
    .slice(0, 50)
    .map((verse) => `${verse.book} ${verse.chapter}:${verse.number}`),
);
find("#verse-search-2").value = "creat";
submitVerseSearch();
await pause(30);
assert.match(find(".verses-page .notice").textContent, /No verses match/);
find('input[name="verse-match-1"][value="partial"]').checked = true;
submitVerseSearch();
await pause(30);
const mixed = godHeaven.filter((verse) =>
  verse.text.toLowerCase().includes("creat"),
);
assert.deepEqual(
  verseRefs(),
  mixed
    .slice(0, 50)
    .map((verse) => `${verse.book} ${verse.chapter}:${verse.number}`),
);
find('[data-verse-search-remove="0"]').click();
await pause(30);
assert.equal(find("#verse-search-1").value, "creat");
assert.ok(find('input[name="verse-match-0"][value="partial"]').checked);
assert.equal(
  window.document.querySelectorAll("[data-verse-search-row]").length,
  1,
);
const godCreat = corpus.filter(
  (verse) =>
    tokenize(verse.text).includes("god") &&
    verse.text.toLowerCase().includes("creat"),
);
assert.deepEqual(
  verseRefs(),
  godCreat
    .slice(0, 50)
    .map((verse) => `${verse.book} ${verse.chapter}:${verse.number}`),
);
find(".verse-row").click();
await pause(30);
find('[data-page="verses"]').click();
await pause(30);
assert.equal(find("#verse-search-1").value, "creat");
find('[data-verse-search-remove="0"]').click();
await pause(30);
assert.equal(
  window.document.querySelectorAll("[data-verse-search-row]").length,
  0,
);
assert.deepEqual(
  verseRefs(),
  exactGodVerses
    .slice(0, 50)
    .map((verse) => `${verse.book} ${verse.chapter}:${verse.number}`),
);
// Chapter and verse-number filters compose with the retained text search.
const addLocationFilter = async (kind, value) => {
  find('[data-action="verse-add-filter"]').click();
  change("#verse-frequency-kind", kind);
  assert.equal(
    find("#verse-filter-value-label").textContent,
    kind === "chapter" ? "Chapter number" : "Verse number",
  );
  find("#verse-frequency-input").value = String(value);
  find("#verse-frequency-form").dispatchEvent(
    new window.Event("submit", { bubbles: true, cancelable: true }),
  );
  await pause(30);
};
await addLocationFilter("chapter", 3);
assert.equal(find("#verse-chapter-filter").value, "3");
const godChapter3 = exactGodVerses.filter((verse) => verse.chapter === 3);
assert.deepEqual(
  verseRefs(),
  godChapter3
    .slice(0, 50)
    .map((verse) => `${verse.book} ${verse.chapter}:${verse.number}`),
);
await addLocationFilter("verse", 16);
assert.equal(find("#verse-number-filter").value, "16");
const god3_16 = godChapter3.filter((verse) => verse.number === 16);
assert.deepEqual(
  verseRefs(),
  god3_16.map((verse) => `${verse.book} ${verse.chapter}:${verse.number}`),
);
find(".verse-row").click();
await pause(30);
find('[data-page="verses"]').click();
await pause(30);
assert.equal(find("#verse-chapter-filter").value, "3");
assert.equal(find("#verse-number-filter").value, "16");
change("#verses-book", "John");
await pause(30);
assert.deepEqual(verseRefs(), ["John 3:16"]);
find("#verse-number-filter").value = "17";
submitVerseSearch();
await pause(30);
assert.deepEqual(verseRefs(), ["John 3:17"]);
find('[data-verse-location-remove="chapter"]').click();
await pause(30);
assert.equal(find("#verse-chapter-filter"), null);
assert.ok(verseRefs().every((ref) => ref.endsWith(":17")));
find('[data-verse-location-remove="verse"]').click();
await pause(30);
assert.equal(find("#verse-number-filter"), null);
find("#verses-book").value = "";
submitVerseSearch();
await pause(30);
// Search occurrence counts sort the entire result set and preserve scroll.
find('nav [data-page="search"]').click();
find("#query").value = "God";
find('input[name="phrase"]').checked = false;
find('input[name="partial"]').checked = false;
find("#search-book").value = "";
const submitBibleSearch = () =>
  find("#search-form").dispatchEvent(
    new window.Event("submit", { bubbles: true, cancelable: true }),
  );
submitBibleSearch();
await pause(30);
const expectedGodMatches = corpus
  .map((verse) => ({
    ...verse,
    occurrences: tokenize(verse.text).filter((word) => word === "god").length,
  }))
  .filter((verse) => verse.occurrences > 0);
const displayedSearchCounts = () =>
  [...window.document.querySelectorAll(".search-verse-occurrences")].map(
    (cell) => Number(cell.textContent),
  );
const displayedSearchReferences = () =>
  [...window.document.querySelectorAll(".search-result-row .result")].map(
    (button) =>
      `${button.dataset.book} ${button.dataset.chapter}:${button.dataset.verse}`,
  );
assert.deepEqual(
  displayedSearchCounts(),
  expectedGodMatches.slice(0, 50).map((verse) => verse.occurrences),
);
find("main").scrollTop = 450;
find("#search-occurrence-sort").click();
await pause(30);
assert.equal(find("main").scrollTop, 450);
const descendingGod = [...expectedGodMatches].sort(
  (a, b) => b.occurrences - a.occurrences,
);
assert.deepEqual(
  displayedSearchReferences(),
  descendingGod
    .slice(0, 50)
    .map((verse) => `${verse.book} ${verse.chapter}:${verse.number}`),
);
assert.deepEqual(
  displayedSearchCounts(),
  descendingGod.slice(0, 50).map((verse) => verse.occurrences),
);
assert.equal(
  find('.search-results-heading [role="columnheader"]').getAttribute(
    "aria-sort",
  ),
  "descending",
);
find('[data-action="search-next"]').click();
await pause(30);
assert.deepEqual(
  displayedSearchCounts(),
  descendingGod.slice(50, 100).map((verse) => verse.occurrences),
);
find("main").scrollTop = 375;
find("#search-occurrence-sort").click();
await pause(30);
assert.equal(find("main").scrollTop, 375);
const ascendingGod = [...expectedGodMatches].sort(
  (a, b) => a.occurrences - b.occurrences,
);
assert.deepEqual(
  displayedSearchReferences(),
  ascendingGod
    .slice(0, 50)
    .map((verse) => `${verse.book} ${verse.chapter}:${verse.number}`),
);
assert.equal(
  find('.search-results-heading [role="columnheader"]').getAttribute(
    "aria-sort",
  ),
  "ascending",
);
find("#query").value = "and the";
find('input[name="phrase"]').checked = true;
submitBibleSearch();
await pause(30);
assert.deepEqual(
  displayedSearchCounts(),
  corpus
    .filter((verse) =>
      ` ${tokenize(verse.text).join(" ")} `.includes(" and the "),
    )
    .slice(0, 50)
    .map((verse) => {
      const words = tokenize(verse.text);
      return words.filter((word, i) => word === "and" && words[i + 1] === "the")
        .length;
    }),
);
find('[data-page="search"]').click();
window.__TAURI__.core.invoke = async () => {
  throw new Error("Transport unavailable");
};
find("#query").value = "test";
find("#search-form").dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
await pause(20);
assert.match(find('[role="alert"]').textContent, /Transport unavailable/);
console.log(
  "UI integration passed: navigation, highlighting, occurrence/spatial filters, disabled controls, paging/reuse, and errors.",
);
dom.window.close();
