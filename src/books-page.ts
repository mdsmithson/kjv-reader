import { escape } from "./highlight";
import { pageSize, type BookStats, type State } from "./model";

const common = (entries: BookStats["mostCommon"], scope = "this book") =>
  entries.length
    ? entries
        .map(
          (entry) =>
            `<span class="scripture">${escape(entry.word)}</span> (${entry.count.toLocaleString()} appearances)`,
        )
        .join(", ")
    : `No words exclusive to ${scope}.`;

export const booksView = (state: State): string => {
  const multiple = state.multiBookMode;
  const stats = multiple ? state.combinedStatistics : state.statistics;
  const scope = multiple ? "these books" : "this book";
  return `<section class="search-page books-page"><div class="eyebrow">EXPLORE THE BOOKS</div><h1>Books</h1>
    <div class="books-mode"><label class="checkbox"><input id="books-multiple" type="checkbox"${multiple ? " checked" : ""}>Select multiple books</label><span class="books-selection-tools" aria-hidden="${!multiple}"><span class="selected-book-count">${state.statisticsBooks.length} books selected</span><button data-action="books-select-all"${multiple ? "" : " disabled"}>Select all</button><button data-action="books-select-none"${multiple ? "" : " disabled"}>Clear selection</button></span></div>
    <div class="book-list" aria-label="Choose a book">${state.books.map((book) => `<button data-statistics-book="${escape(book.name)}" aria-pressed="${multiple ? state.statisticsBooks.includes(book.name) : book.name === state.statisticsBook}">${escape(book.name)}</button>`).join("")}</div>
    <h2>${multiple ? "Selected books" : escape(state.statisticsBook)}</h2>${multiple ? `<p class="intro">${state.statisticsBooks.length === state.books.length ? `All ${state.books.length} books of the Bible` : escape(state.statisticsBooks.join(", "))}</p>` : ""}
    ${
      state.busy
        ? '<p class="notice" role="status">Loading book statistics…</p>'
        : stats
          ? `<dl class="book-statistics">
      <div><dt>Most common word${stats.mostCommon.length > 1 ? "s (tied)" : ""}</dt><dd>${common(stats.mostCommon)}</dd></div>
      <div><dt>Most common word${stats.mostCommonExclusive.length > 1 ? "s (tied)" : ""} found only in ${scope}</dt><dd>${common(stats.mostCommonExclusive, scope)}</dd></div>
      <div><dt>Words</dt><dd>${stats.words.toLocaleString()}</dd></div>
      <div><dt>Unique words</dt><dd>${stats.uniqueWords.toLocaleString()}</dd></div>
      <div><dt>Words only found in ${scope}</dt><dd><button class="exclusive-count" data-action="exclusive-words" aria-label="List all ${stats.exclusiveWords.length} words only found in ${escape(stats.name)}">${stats.exclusiveWords.length.toLocaleString()} words <span aria-hidden="true">→</span></button></dd></div>
      <div><dt>Verses</dt><dd>${stats.verses.toLocaleString()}</dd></div>
    </dl>`
          : multiple
            ? '<p class="notice">Select one or more books to view their combined statistics.</p>'
            : ""
    }
    ${stats && !multiple ? `<section class="book-chapters"><h2>Chapters</h2><p class="intro">Explore word counts for each chapter of ${escape(stats.name)}.</p>${chapterButtons(state)}</section>` : ""}
    ${stats && !multiple ? phraseButtons(state) : ""}
    <p class="counting-note">Words are counted without regard to case. Punctuation separates words; internal apostrophes stay in the word. Common words include every word, including “the” and “and”. Exclusive words occur nowhere outside the selected ${multiple ? "books" : "book"}. All ties are shown alphabetically.</p>
  </section>`;
};

const chapterButtons = (state: State) =>
  `<div class="book-list" aria-label="Choose a chapter">${(state.statistics?.chapters ?? []).map((chapter) => `<button data-statistics-chapter="${chapter.chapter}" aria-pressed="${state.page === "book-chapter" && state.statisticsChapter === chapter.chapter}">Chapter ${chapter.chapter}</button>`).join("")}</div>`;

export const chapterStatisticsView = (state: State): string => {
  const stats = state.statistics?.chapters.find(
    (chapter) => chapter.chapter === state.statisticsChapter,
  );
  return `<section class="search-page chapter-statistics-page">
    <button data-page="books">← Back to ${escape(state.statisticsBook)}</button>
    <div class="eyebrow">${escape(state.statisticsBook)}</div><h1>Chapter ${state.statisticsChapter}</h1>
    ${chapterButtons(state)}
    ${
      stats
        ? `<dl class="book-statistics">
      <div><dt>Words in chapter</dt><dd>${stats.words.toLocaleString()}</dd></div>
      <div><dt>Unique words in chapter</dt><dd>${stats.uniqueWords.toLocaleString()}</dd></div>
      <div><dt>Words only found in this chapter</dt><dd><button class="exclusive-count" data-action="chapter-exclusive-words" aria-label="List all ${stats.exclusiveWords.length} words only found in ${escape(state.statisticsBook)} ${stats.chapter}">${stats.exclusiveWords.length.toLocaleString()} words <span aria-hidden="true">→</span></button></dd></div>
    </dl>
    <p class="counting-note">Words are counted without regard to case. Punctuation separates words; internal apostrophes stay in the word. Unique words count each distinct word once. Words only found in this chapter are distinct words that occur nowhere else in the entire Bible, including other chapters of ${escape(state.statisticsBook)}.</p>
    <button data-book="${escape(state.statisticsBook)}" data-chapter="${stats.chapter}">Read ${escape(state.statisticsBook)} ${stats.chapter} →</button>`
        : '<p class="notice">Chapter statistics are unavailable.</p>'
    }
  </section>`;
};

export const exclusiveWordsView = (state: State): string => {
  const isChapter = state.page === "chapter-words";
  const multiple = state.multiBookMode && !isChapter;
  const scope = isChapter ? "chapter" : "book";
  const label = multiple
    ? "Selected books"
    : `${state.statisticsBook}${isChapter ? ` ${state.statisticsChapter}` : ""}`;
  const words =
    (isChapter
      ? state.statistics?.chapters.find(
          (chapter) => chapter.chapter === state.statisticsChapter,
        )?.exclusiveWords
      : (multiple ? state.combinedStatistics : state.statistics)
          ?.exclusiveWords) ?? [];
  const offset = state.exclusiveOffset;
  const entries = words.slice(offset, offset + pageSize);
  return `<section class="search-page exclusive-words-page">
    <button data-page="${isChapter ? "book-chapter" : "books"}">← Back to ${escape(label)}</button>
    <div class="eyebrow">${escape(label)}</div><h1>Words only found in ${multiple ? "these books" : `this ${scope}`}</h1>
    <p class="intro">${words.length.toLocaleString()} distinct words, ordered from most common to least common. Ties are alphabetical.</p>
    ${
      words.length
        ? `<div class="result-summary"><strong>Word · Appearances in ${escape(label)}</strong><span>${offset + 1}–${offset + entries.length} of ${words.length.toLocaleString()}</span></div>
      <ol class="exclusive-word-list" start="${offset + 1}">${entries.map((entry) => `<li><button class="scripture exclusive-word-link" data-word="${escape(entry.word)}" aria-label="Open the Word page for ${escape(entry.word)}">${escape(entry.word)}</button><span class="exclusive-frequency">${entry.count.toLocaleString()}</span></li>`).join("")}</ol>
      <div class="chapter-navigation"><button data-action="exclusive-previous"${offset === 0 ? " disabled" : ""}>← Previous words</button><span>Page ${Math.floor(offset / pageSize) + 1}</span><button data-action="exclusive-next"${offset + pageSize >= words.length ? " disabled" : ""}>Next words →</button></div>`
        : `<p class="notice">No words are exclusive to ${multiple ? "these books" : `this ${scope}`}.</p>`
    }
  </section>`;
};

const phraseButtons = (
  state: State,
) => `<section class="exclusive-phrase-section"><h2>Phrases only found in this book</h2>
  <p class="counting-note">Choose an exact word length. Each count is the number of distinct phrases found only in ${escape(state.statisticsBook)}. Phrases stay within a verse; lists are ordered by appearance count, descending.</p>
  <div class="phrase-lengths">${state.phraseCounts.map((count, index) => `<button data-phrase-length="${index + 1}" aria-pressed="${state.page === "book-phrases" && state.phraseLength === index + 1}"><strong>${index + 1} ${index === 0 ? "word" : "words"}</strong><span class="phrase-length-count">${count == null ? "…" : count.toLocaleString()} phrases</span></button>`).join("")}</div>
  ${state.phraseCountsError ? `<p role="alert">${escape(state.phraseCountsError)} <button data-action="phrase-counts-retry">Retry counts</button></p>` : state.phraseCounts.some((count) => count == null) ? '<p role="status" class="counting-note">Building or loading saved phrase counts… You can open a length while counts load.</p>' : ""}
</section>`;

export const exclusivePhrasesView = (state: State): string => {
  const page = state.exclusivePhrases;
  const offset = state.phraseOffset;
  return `<section class="search-page exclusive-phrases-page"><button data-page="books">← Back to ${escape(state.statisticsBook)}</button>
    <div class="eyebrow">${escape(state.statisticsBook)}</div><h1>Phrases only found in this book</h1>
    ${phraseButtons(state)}
    <h2>${state.phraseLength}-word phrases</h2>
    ${
      state.busy
        ? '<p class="notice" role="status">Building or loading saved phrases…</p>'
        : page
          ? `<div class="result-summary"><strong>${page.total.toLocaleString()} distinct phrases</strong><span>${page.total ? offset + 1 : 0}–${offset + page.entries.length} of ${page.total.toLocaleString()}</span></div>
      ${
        page.total
          ? `<ol class="exclusive-word-list" start="${offset + 1}">${page.entries.map((entry) => `<li><span class="scripture">${escape(entry.phrase)}</span><span class="exclusive-frequency">${entry.count.toLocaleString()}</span></li>`).join("")}</ol>
      <div class="chapter-navigation"><button data-action="phrase-previous"${offset === 0 ? " disabled" : ""}>← Previous phrases</button><span>Page ${Math.floor(offset / pageSize) + 1}</span><button data-action="phrase-next"${offset + pageSize >= page.total ? " disabled" : ""}>Next phrases →</button></div>`
          : '<p class="notice">No phrases of this length are exclusive to this book.</p>'
      }`
          : ""
    }
  </section>`;
};
