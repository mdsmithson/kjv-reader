import { escape } from "./highlight";
import { pageSize, type State, type PhraseCount } from "./model";

type Filter = Readonly<{
  title: string;
  label: string;
  modeName: string;
  name: string;
  modeId: string;
  inputId: string;
  value: number | null | undefined;
  fallback: number;
  min: number;
  max: number;
  kind: "range" | "minimum" | "exact";
  upTo?: boolean;
}>;

const optionalFilter = (filter: Filter): string => {
  const active = filter.value != null;
  const exactLabel = filter.kind === "minimum" ? "At least" : "Exactly";
  return `<label>${filter.title}<select name="${filter.modeName}" id="${filter.modeId}" data-controls="${filter.inputId}">
    <option value="any"${!active ? " selected" : ""}>Any number</option>
    <option value="exact"${active && !filter.upTo ? " selected" : ""}>${exactLabel}</option>
    ${filter.kind === "range" ? `<option value="upTo"${active && filter.upTo ? " selected" : ""}>Up to</option>` : ""}
  </select></label>
  <label>${filter.label}<input name="${filter.name}" id="${filter.inputId}" type="number" min="${filter.min}" max="${filter.max}" step="1" required value="${filter.value ?? filter.fallback}"${!active ? " disabled" : ""}></label>`;
};

const entryMarkup = (
  entry: PhraseCount,
): string => `<button class="occurrence-result" data-phrase="${escape(entry.phrase)}">
  <span class="scripture">${escape(entry.phrase)}</span>
  <span>${entry.words} ${entry.words === 1 ? "word" : "words"}</span>
  <span class="book-count">${entry.books} ${entry.books === 1 ? "book" : "books"}</span>
  <span class="letter-count">${entry.letters} ${entry.letters === 1 ? "letter" : "letters"}</span>
  <span>${entry.count} occurrences <span aria-hidden="true">↗</span></span>
  <span class="spatial-summary">Longest runs: <span class="verse-run">${entry.maxVerseRun}</span> neighboring verses · <span class="chapter-run">${entry.maxChapterRun}</span> consecutive chapters · Most in one chapter: ${entry.maxChapterFrequency}</span>
</button>`;

const results = (state: State) => {
  if (state.busy)
    return '<p class="notice" role="status">Building or loading saved occurrence data…<br>You can continue reading while this runs.</p>';
  const page = state.occurrences;
  if (!page)
    return '<div class="search-empty"><span aria-hidden="true">✦</span><h2>Find patterns in the Scriptures.</h2><p>Choose a frequency and phrase length.<br>The first request saves the data; later requests reuse it.</p></div>';
  const status = page.builtLengths.length
    ? `Built and saved data for ${page.builtLengths.join(", ")} word lengths.`
    : page.builtFilters
      ? "Built and saved filtered results."
      : "Saved data reused.";
  return `<p class="cache-status" role="status">${status} · ${(page.elapsedMs / 1000).toFixed(2)} seconds</p>
    <div class="result-summary"><strong>${page.total.toLocaleString()} words and phrases found</strong><span>${page.total ? state.occurrenceQuery.offset + 1 : 0}–${state.occurrenceQuery.offset + page.entries.length} of ${page.total.toLocaleString()}</span></div>
    ${page.total ? `<div class="occurrence-results">${page.entries.map(entryMarkup).join("")}</div>` : '<p class="notice">No words or phrases match the selected filters.</p>'}
    <div class="chapter-navigation"><button data-action="occurrence-previous"${state.occurrenceQuery.offset === 0 ? " disabled" : ""}>← Previous results</button><span>Page ${Math.floor(state.occurrenceQuery.offset / pageSize) + 1}</span><button data-action="occurrence-next"${state.occurrenceQuery.offset + pageSize >= page.total ? " disabled" : ""}>Next results →</button></div>`;
};

export const occurrenceView = (state: State): string => {
  const query = state.occurrenceQuery;
  const filters: readonly Filter[] = [
    {
      title: "In books",
      label: "Books (1–66)",
      modeName: "bookMode",
      name: "books",
      modeId: "occurrence-book-mode",
      inputId: "occurrence-books",
      value: query.books,
      fallback: 66,
      min: 1,
      max: 66,
      kind: "range",
      upTo: query.booksUpTo,
    },
    {
      title: "Letters in phrase",
      label: "Letters",
      modeName: "letterMode",
      name: "letters",
      modeId: "occurrence-letter-mode",
      inputId: "occurrence-letters",
      value: query.letters,
      fallback: 7,
      min: 0,
      max: 4294967295,
      kind: "range",
      upTo: query.lettersUpTo,
    },
    {
      title: "Consecutive verses",
      label: "Neighboring verses",
      modeName: "consecutiveVersesMode",
      name: "consecutiveVerses",
      modeId: "occurrence-verse-mode",
      inputId: "occurrence-verses",
      value: query.consecutiveVerses,
      fallback: 2,
      min: 1,
      max: 65535,
      kind: "minimum",
    },
    {
      title: "Consecutive chapters",
      label: "Neighboring chapters",
      modeName: "consecutiveChaptersMode",
      name: "consecutiveChapters",
      modeId: "occurrence-chapter-mode",
      inputId: "occurrence-chapters",
      value: query.consecutiveChapters,
      fallback: 2,
      min: 1,
      max: 65535,
      kind: "minimum",
    },
    {
      title: "Chapter frequency",
      label: "Appearances in a chapter",
      modeName: "chapterFrequencyMode",
      name: "chapterFrequency",
      modeId: "occurrence-chapter-frequency-mode",
      inputId: "occurrence-chapter-frequency",
      value: query.chapterFrequency,
      fallback: 2,
      min: 1,
      max: 4294967295,
      kind: "exact",
    },
  ];
  return `<section class="search-page occurrence-page">
  <div class="eyebrow">PATTERNS IN THE SCRIPTURES</div><h1>Search by occurrence</h1>
  <p class="intro">Find words and phrases by frequency, length, and where they appear.</p>
  <form id="occurrence-form" class="occurrence-form">
    <label>Occurs exactly<input name="count" id="occurrence-count" type="number" min="1" max="4294967295" step="1" required value="${query.count}"></label>
    <label>Phrase length<select name="mode" id="occurrence-mode"><option value="exact"${!query.upTo ? " selected" : ""}>Exactly</option><option value="upTo"${query.upTo ? " selected" : ""}>Up to</option></select></label>
    <label>Words (1–32)<input name="words" id="occurrence-words" type="number" min="1" max="32" step="1" required value="${query.words}"></label>
    ${filters.map(optionalFilter).join("")}
    <div class="book-scope"><label class="checkbox"><input type="checkbox" id="choose-books" name="chooseBooks"${query.includedBooks != null ? " checked" : ""}> Search selected books</label>
    <fieldset id="included-books"${query.includedBooks == null ? " disabled hidden" : ""}><legend>Include these books</legend><div class="book-checkboxes">${state.books.map((book) => `<label class="checkbox"><input type="checkbox" name="includedBooks" value="${escape(book.name)}"${query.includedBooks?.includes(book.name) ? " checked" : ""}>${escape(book.name)}</label>`).join("")}</div></fieldset></div>
    <button class="primary" type="submit">Find &amp; save →</button>
  </form>
  <p class="counting-note">When selected books are enabled, all counts and positional filters apply only within those books. Choose at least one book. Counts every appearance, including repeats in a verse. Books means distinct Bible books; letters exclude spaces, punctuation, and digits. Verse runs stay within a chapter; chapter runs stay within a book. A run must contain the phrase in every verse or chapter. Runs mean at least the selected length. Chapter frequency requires at least one chapter with exactly the selected count. Each filter can be satisfied in a different location.</p>
  <p class="counting-note">Case and punctuation are ignored; phrases stay within a verse. Results are ordered by word length, book count, letter count, then alphabetically. Choose a result to view its verses.</p>
  ${results(state)}
</section>`;
};
