import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { exclusiveFixture } from "./exclusive-fixture.mjs";
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
};
assert.equal(
  highlighted("God, WORD & godhead", highlightQuery),
  "<mark>God</mark>, <mark>WORD</mark> &amp; <mark>god</mark>head",
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
window.HTMLElement.prototype.scrollTo = () => {};
window.HTMLElement.prototype.scrollIntoView = () => {};
const pause = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
window.__TAURI__ = {
  core: {
    invoke: async (command, args) => {
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
      if (command === "book_stats") {
        const lines = corpus.filter((verse) => verse.book === args.book);
        const counts = new Map();
        lines
          .flatMap((verse) => tokenize(verse.text))
          .forEach((word) => counts.set(word, (counts.get(word) ?? 0) + 1));
        const outside = new Set(
          corpus
            .filter((verse) => verse.book !== args.book)
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
          name: args.book,
          chapters: Array.from(
            { length: books.find((book) => book.name === args.book).chapters },
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
                  .filter((word) => chapterWordOwners.get(word).size === 1)
                  .map((word) => ({
                    word,
                    count: tokens.filter((token) => token === word).length,
                  }))
                  .sort(
                    (a, b) => b.count - a.count || a.word.localeCompare(b.word),
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
              : query.phrase
                ? verse.text.toLowerCase().includes(text)
                : text
                    .split(/\s+/)
                    .every((word) => verse.text.toLowerCase().includes(word))),
        );
        return {
          total: verses.length,
          verses: verses.slice(query.offset, query.offset + 50),
        };
      }
      if (command === "occurrences") {
        const query = args.query;
        occurrenceRequests.push(query);
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
          elapsedMs: 1,
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    },
  },
};
window.eval(bundle.outputFiles[0].text);
const find = (selector) => window.document.querySelector(selector);
const change = (selector, value) => {
  find(selector).value = value;
  find(selector).dispatchEvent(new window.Event("change", { bubbles: true }));
};
await pause(30);
assert.equal(window.document.querySelectorAll(".verse").length, 31);
assert.match(find(".verse").textContent, /In the beginning God/);
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
