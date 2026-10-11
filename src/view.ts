import { numbersView, numberDetailView } from "./numbers-page";
import {
  adjacent,
  bookAt,
  pageSize,
  reference,
  type State,
  type Verse,
  type Query,
} from "./model";
import { readerChapterMarkup, highlightOptionsView } from "./reader-highlights";
import { escape, highlighted } from "./highlight";
import {
  booksView,
  chapterStatisticsView,
  exclusiveWordsView,
  exclusivePhrasesView,
} from "./books-page";
import { versesView, verseDetailView } from "./verses-page";
import { phrasesView, phraseDetailView } from "./phrases-page";
import { wordsView, wordDetailView } from "./words-page";
import { occurrenceView } from "./occurrence-page";

// All external strings cross one escaping boundary before entering markup.
const disabled = (condition: boolean) => (condition ? " disabled" : "");
const selected = (condition: boolean) => (condition ? " selected" : "");
const resultMarkup = (
  verse: Verse,
  query: Query,
) => `<button class="result" data-book="${escape(verse.book)}" data-chapter="${verse.chapter}" data-verse="${verse.number}">
  <span class="result-reference">${escape(reference(verse))}<span aria-hidden="true">↗</span></span>
  <span class="scripture">${highlighted(verse.text, query)}</span>
</button>`;
const options = (state: State, current: string | null) =>
  state.books
    .map(
      (book) =>
        `<option${selected(book.name === current)}>${escape(book.name)}</option>`,
    )
    .join("");

const reader = (state: State) => `<div class="reader-controls">
  <label>Book<select id="book">${options(state, state.location.book)}</select></label>
  <label>Chapter<select id="chapter">${Array.from(
    { length: bookAt(state)?.chapters ?? 1 },
    (_, index) => index + 1,
  )
    .map(
      (number) =>
        `<option${selected(number === state.location.chapter)}>${number}</option>`,
    )
    .join("")}</select></label>

</div>
${highlightOptionsView(state)}
<article class="chapter">
  <div class="eyebrow">THE KING JAMES VERSION</div>
  <h1>${escape(state.location.book)}</h1>
  <div class="chapter-heading"><span></span>CHAPTER ${state.location.chapter}<span></span></div>
  <div class="scripture chapter-text">${readerChapterMarkup(state)}</div>
  ${state.busy ? '<p role="status" class="notice">Opening chapter…</p>' : ""}
  <div class="chapter-navigation"><button data-action="previous"${disabled(!adjacent(state, -1) || state.busy)}>← Previous chapter</button><span>${state.verses.length} verses</span><button data-action="next"${disabled(!adjacent(state, 1) || state.busy)}>Next chapter →</button></div>
</article>`;

const resultSummary = (state: State) => {
  if (state.busy)
    return '<p class="notice" role="status">Searching the Scriptures…</p>';
  if (!state.results)
    return '<div class="search-empty"><span aria-hidden="true">✦</span><h2>A word. A verse. A discovery.</h2><p>Search all 66 books, or choose a single book.<br>Results open directly in their chapter.</p></div>';
  const { total, verses } = state.results;
  if (!total)
    return '<p class="notice" role="status">No verses found. Try fewer words or a different phrase.</p>';
  return `<div class="result-summary" role="status"><strong>${total.toLocaleString()} verses found</strong><span>${state.query.offset + 1}–${state.query.offset + verses.length} of ${total.toLocaleString()}</span></div>
    <div class="results">${verses.map((verse) => resultMarkup(verse, state.query)).join("")}</div>
    <div class="chapter-navigation"><button data-action="search-previous"${disabled(state.query.offset === 0)}>← Previous results</button><span>Page ${Math.floor(state.query.offset / pageSize) + 1}</span><button data-action="search-next"${disabled(state.query.offset + pageSize >= total)}>Next results →</button></div>`;
};

const search = (
  state: State,
) => `<section class="search-page"><div class="eyebrow">EXPLORE THE SCRIPTURES</div><h1>Search the Bible</h1><p class="intro">Find words and passages in the King James Version.</p>
  <form id="search-form"><div class="search-box"><input id="query" name="text" aria-label="Search words or phrase" placeholder="e.g. In the beginning" value="${escape(state.query.text)}" required maxlength="250"><button class="primary" type="submit">Search <span aria-hidden="true">→</span></button></div>
  <div class="search-filters"><label>Within<select name="book" id="search-book"><option value="">All books</option>${options(state, state.query.book)}</select></label><label class="checkbox"><input name="phrase" type="checkbox"${state.query.phrase ? " checked" : ""}> Exact phrase</label><label class="checkbox"><input name="partial" type="checkbox"${state.query.partial ? " checked" : ""}> Partial match</label><span>Case insensitive · ${state.query.partial ? "Partial matches" : "Whole words"} · ${state.query.phrase ? "Words in order" : "Any order"}</span></div></form>
  ${state.query.normalizedWords ? '<p class="counting-note">Viewing a counted phrase: matches ignore punctuation and require whole, consecutive words. The total below counts verses; a verse can contain more than one occurrence.</p>' : ""}
  ${resultSummary(state)}</section>`;

export const presentationControls = (state: State) =>
  `<div class="presentation-group"><span>Text size</span><button data-action="smaller" aria-label="Decrease text size"${disabled(state.size <= 20)}>A−</button><button data-action="larger" aria-label="Increase text size"${disabled(state.size >= 42)}>A+</button></div><div class="presentation-group"><span>Page width</span><button data-action="narrower" aria-label="Decrease presentation width"${disabled(state.width <= 700)}>↔−</button><button data-action="wider" aria-label="Increase presentation width"${disabled(state.width >= 1900)}>↔+</button></div>`;

export const view = (
  state: State,
) => `<div class="layout" style="--scripture-size:${state.size}px;--presentation-width:${state.width}px">
  <aside><div class="brand-mark" aria-hidden="true">K</div><div class="brand">The Reader</div><div class="brand-caption">KING JAMES · 1611 TYPEFACE</div>
  <nav aria-label="Main"><button data-page="reader" aria-current="${state.page === "reader" ? "page" : "false"}"><span aria-hidden="true">▤</span> Read the Bible</button><button data-page="search" aria-current="${state.page === "search" ? "page" : "false"}"><span aria-hidden="true">⌕</span> Search</button><button data-page="occurrences" aria-current="${state.page === "occurrences" ? "page" : "false"}"><span aria-hidden="true">≡</span> Occurrences</button><button data-page="books" aria-current="${state.page === "books" || state.page === "book-words" || state.page === "book-phrases" || state.page === "book-chapter" || state.page === "chapter-words" ? "page" : "false"}"><span aria-hidden="true">▥</span> Books</button><button data-page="words" aria-current="${state.page === "words" || state.page === "word-detail" ? "page" : "false"}"><span aria-hidden="true">W</span> Words</button><button data-page="phrases" aria-current="${state.page === "phrases" || state.page === "phrase-detail" ? "page" : "false"}"><span aria-hidden="true">P</span> Phrases</button><button data-page="verses" aria-current="${state.page === "verses" || state.page === "verse-detail" ? "page" : "false"}"><span aria-hidden="true">V</span> Verses</button><button data-page="numbers" aria-current="${state.page === "numbers" || state.page === "number-detail" ? "page" : "false"}"><span aria-hidden="true">#</span> Numbers</button></nav>
  <div class="sidebar-note"><span class="small-rule"></span><p>“Thy word is a lamp unto my feet, and a light unto my path.”</p><span>PSALM 119:105</span></div>
  <footer><span class="offline-dot"></span> Available offline<div>KJV1611 · Open Font License</div></footer></aside>
  <main><header><span>${state.page === "numbers" || state.page === "number-detail" ? "NUMBER CATALOGUE" : state.page === "verses" || state.page === "verse-detail" ? "VERSE CATALOGUE" : state.page === "phrases" || state.page === "phrase-detail" ? "PHRASE CATALOGUE" : state.page === "words" || state.page === "word-detail" ? "WORD CATALOGUE" : state.page === "reader" ? "SCRIPTURE READER" : state.page === "search" ? "SCRIPTURE SEARCH" : state.page === "books" || state.page === "book-words" || state.page === "book-phrases" || state.page === "book-chapter" || state.page === "chapter-words" ? "BOOK STATISTICS" : "OCCURRENCE SEARCH"}</span><div class="presentation-controls" role="group" aria-label="Presentation">${presentationControls(state)}</div></header>
  ${state.error ? `<div class="error" role="alert">${escape(state.error)} <button data-action="retry">Try again</button></div>` : ""}
  ${state.page === "numbers" ? numbersView(state) : state.page === "number-detail" ? numberDetailView(state) : state.page === "verses" ? versesView(state) : state.page === "verse-detail" ? verseDetailView(state) : state.page === "phrases" ? phrasesView(state) : state.page === "phrase-detail" ? phraseDetailView(state) : state.page === "words" ? wordsView(state) : state.page === "word-detail" ? wordDetailView(state) : state.page === "reader" ? reader(state) : state.page === "search" ? search(state) : state.page === "books" ? booksView(state) : state.page === "book-chapter" ? chapterStatisticsView(state) : state.page === "book-words" || state.page === "chapter-words" ? exclusiveWordsView(state) : state.page === "book-phrases" ? exclusivePhrasesView(state) : occurrenceView(state)}
  </main></div>`;
