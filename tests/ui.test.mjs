import { numberFixture } from "./number-fixture.mjs";
import { readerHighlightFixture } from "./reader-highlight-fixture.mjs";
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
const verseCatalogue = verseFixture(corpus, tokenize, wordCatalogue);
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
assert.equal(invalidSaved.exclusive.color, "#f6d887");
assert.equal(invalidSaved.firstMention.enabled, false);
assert.equal(invalidSaved.firstMention.color, "#abcdef");
assert.equal(invalidSaved.occurrences.count, 7);
const darkMarkup = readerWordHighlights(
  "God & godhead",
  [
    {
      start: 0,
      end: 3,
      word: "god",
      count: 7,
      exclusive: false,
      firstMention: true,
    },
  ],
  { ...invalidSaved, firstMention: { enabled: false, color: "#abcdef" } },
);
assert.match(darkMarkup, /background:#000000;color:#ffffff/);
assert.match(darkMarkup, /God<\/mark> &amp; godhead/);
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
const chapterHighlights = readerHighlightFixture(
  corpus,
  wordCatalogue,
  chapterWordOwners,
);
window.__TAURI__ = {
  core: {
    invoke: async (command, args) => {
      if (command === "reader_highlights")
        return chapterHighlights(String(args.book), Number(args.chapter));
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
// The reader drawer previews rules, closes without clearing highlights, and saves across sessions.
assert.equal(
  find("#highlight-options-toggle").getAttribute("aria-expanded"),
  "false",
);
assert.ok(find("#reader-highlight-panel").hasAttribute("inert"));
find("#highlight-options-toggle").click();
assert.ok(find("#reader-highlight-panel").classList.contains("is-open"));
const highlightChange = (name, value) => {
  const input = find(`#reader-highlights-form [name="${name}"]`);
  if (input.type === "checkbox") input.checked = value;
  else input.value = String(value);
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
};
highlightChange("firstMention", true);
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
highlightChange("firstMentionColor", "#ffccdd");
assert.equal(
  find('#verse-1 [data-highlight-rules~="firstMention"]').style.backgroundColor,
  "rgb(255, 204, 221)",
);
highlightChange("occurrences", true);
highlightChange("count", 63919);
assert.ok(
  [
    ...window.document.querySelectorAll(
      '.reader-word-highlight[data-highlight-rules~="occurrences"]',
    ),
  ].every((mark) => mark.textContent.toLowerCase() === "the"),
);
assert.ok(
  find(
    '#verse-1 [data-highlight-rules="firstMention occurrences"]',
  ).style.background.includes("linear-gradient"),
);
highlightChange("exclusive", true);
highlightChange("exclusiveColor", "#ffed00");
const saveHighlights = () =>
  find("#reader-highlights-form").dispatchEvent(
    new window.Event("submit", { bubbles: true, cancelable: true }),
  );
saveHighlights();
assert.match(find("#highlight-save-status").textContent, /options saved/);
const savedHighlights = JSON.parse(
  window.localStorage.getItem("kjv-reader:highlight-settings:v1"),
);
assert.equal(savedHighlights.options.occurrences.count, 63919);
assert.equal(savedHighlights.options.exclusive.color, "#ffed00");
find("#highlight-options-toggle").click();
assert.ok(!find("#reader-highlight-panel").classList.contains("is-open"));
assert.ok(find(".reader-word-highlight"));
change("#chapter", "2");
await pause(110);
assert.ok(find('.reader-word-highlight[data-highlight-rules~="exclusive"]'));
assert.ok(
  [
    ...window.document.querySelectorAll(
      '.reader-word-highlight[data-highlight-rules~="exclusive"]',
    ),
  ].some((mark) => mark.textContent === "Pison"),
);
assert.equal(
  find('#reader-highlights-form [name="firstMentionColor"]').value,
  "#ffccdd",
);
find("#highlight-options-toggle").click();
highlightChange("count", 1);
assert.ok(
  [
    ...window.document.querySelectorAll(
      '[data-highlight-rules="exclusive firstMention occurrences"]',
    ),
  ].some((mark) => mark.textContent === "Pison"),
);
// A new app instance restores saved options; unsaved edits remain session-only.
const restoredDom = new JSDOM('<div id="app"></div>', {
  runScripts: "outside-only",
  url: "http://localhost",
});
restoredDom.window.HTMLElement.prototype.scrollTo = () => {};
restoredDom.window.HTMLElement.prototype.scrollIntoView = () => {};
restoredDom.window.__TAURI__ = window.__TAURI__;
restoredDom.window.localStorage.setItem(
  "kjv-reader:highlight-settings:v1",
  JSON.stringify(savedHighlights),
);
restoredDom.window.eval(bundle.outputFiles[0].text);
const restoreDeadline = Date.now() + 2000;
while (
  !restoredDom.window.document.querySelector(".reader-word-highlight") &&
  Date.now() < restoreDeadline
)
  await pause(10);
assert.ok(restoredDom.window.document.querySelector(".reader-word-highlight"));
assert.equal(
  restoredDom.window.document.querySelector("#highlight-count").value,
  "63919",
);
assert.equal(
  restoredDom.window.document.querySelector("#highlight-firstMention-color")
    .value,
  "#ffccdd",
);
restoredDom.window.close();
// Leave later UI tests at their normal unhighlighted reader state.
highlightChange("exclusive", false);
highlightChange("firstMention", false);
highlightChange("occurrences", false);
find("#highlight-options-toggle").click();
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
assert.ok(genesisDetail.phraseResults.total < genesisDetail.phrases);
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
find("#verse-phrases-filter").value = "45";
submitVerseFilters();
await pause(30);
assert.ok(
  [...window.document.querySelectorAll(".verse-row")].every(
    (row) =>
      Number(row.children[1].textContent) === 10 &&
      Number(row.children[2].textContent) === 44 &&
      Number(row.children[3].textContent) === 45,
  ),
);
change("#verses-book", "Genesis");
await pause(30);
assert.equal(find(".verse-row strong").textContent, "Genesis 1:1");
find(".verse-row").click();
await pause(30);
find('.verse-detail-page [data-page="verses"]').click();
await pause(30);
assert.equal(find("#verse-phrases-filter").value, "45");
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

find('nav [data-page="reader"]').click();
find("#verse-2").click();
await pause(30);
assert.ok(verseCatalogue.detail("Genesis", 1, 2, 0).phraseResults.total > 50);
find('[data-action="verse-phrases-next"]').click();
await pause(30);
assert.deepEqual(
  [...window.document.querySelectorAll(".verse-phrase-row")].map(
    (row) => row.dataset.savedPhrase,
  ),
  verseCatalogue
    .detail("Genesis", 1, 2, 50)
    .phraseResults.entries.map((entry) => entry.phrase),
);
// Sort before paging, not just the current 50 rows.
sortClick("verse-phrases", "occurrences");
await pause(30);
assertSortPosition();
const numericPage = verseCatalogue.detail("Genesis", 1, 2, 0, {
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
    .detail("Genesis", 1, 2, 50, { field: "occurrences", direction: "asc" })
    .phraseResults.entries.map((entry) => entry.phrase),
);
const chosenPhraseLabel = find(".verse-phrase-row .scripture").textContent;
find(".verse-phrase-row").click();
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
find("#phrase-search").value = "GOD,";
submitPhrases();
await pause(30);
const expectedSearch = (text, partial = false, offset = 0, counts = {}) =>
  phraseCatalogue.list(savedLengths, exclusiveSaved, offset, {
    text,
    partial,
    ...counts,
  });
assert.ok(expectedSearch("GOD,").total > 50);
assert.deepEqual(
  displayedSavedPhrases(),
  expectedSearch("GOD,").entries.map((e) => e.phrase),
);
find('[data-action="saved-phrases-next"]').click();
await pause(30);
assert.equal(find("#phrase-search").value, "GOD,");
assert.deepEqual(
  displayedSavedPhrases(),
  expectedSearch("GOD,", false, 50).entries.map((e) => e.phrase),
);
find(".phrase-row").click();
await pause(30);
find('[data-page="phrases"]').click();
await pause(30);
assert.deepEqual(
  displayedSavedPhrases(),
  expectedSearch("GOD,", false, 50).entries.map((e) => e.phrase),
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
find("#phrase-partial").checked = false;
find("#phrase-occurrences-filter").value = "";
submitPhrases();
await pause(30);
assert.deepEqual(
  displayedSavedPhrases(),
  expectedSearch("").entries.map((e) => e.phrase),
);
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
