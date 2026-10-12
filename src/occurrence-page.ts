import { escape } from "./highlight";
import { pageSize, type State, type PhraseCount } from "./model";

type Filter = Readonly<{
  title: string;
  description: string;
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
  return `<div class="filter-card"><h3>${filter.title}</h3><p id="${filter.inputId}-help">${filter.description}</p><div class="filter-controls"><label>Match<select name="${filter.modeName}" id="${filter.modeId}" data-controls="${filter.inputId}" data-hide-input aria-label="${filter.title}: comparison">
    <option value="any"${!active ? " selected" : ""}>Any number</option>
    <option value="exact"${active && !filter.upTo ? " selected" : ""}>${exactLabel}</option>
    ${filter.kind === "range" ? `<option value="upTo"${active && filter.upTo ? " selected" : ""}>Up to</option>` : ""}
  </select></label>
  <label${!active ? " hidden" : ""}>${filter.label}<input name="${filter.name}" id="${filter.inputId}" aria-describedby="${filter.inputId}-help" type="number" min="${filter.min}" max="${filter.max}" step="1" required value="${filter.value ?? filter.fallback}"${!active ? " disabled" : ""}></label></div></div>`;
};

const entryMarkup = (
  entry: PhraseCount,
): string => `<button class="occurrence-result" data-phrase="${escape(entry.phrase)}">
  <span class="scripture">${escape(entry.phrase)}</span>
  <span>${entry.words} ${entry.words === 1 ? "word" : "words"}</span>
  <span class="book-count">${entry.books} ${entry.books === 1 ? "book" : "books"}</span>
  <span class="letter-count">${entry.letters} ${entry.letters === 1 ? "letter" : "letters"}</span>
  <span>${entry.count} occurrences <span aria-hidden="true">↗</span></span>
  <span class="spatial-summary">Longest runs: <span class="verse-run">${entry.maxVerseRun}</span> neighboring verses · <span class="chapter-run">${entry.maxChapterRun}</span> consecutive chapters · Most in one chapter: ${entry.maxChapterFrequency} · Found in <span class="chapter-count">${entry.chapters} ${entry.chapters === 1 ? "chapter" : "chapters"}</span></span>
</button>`;

const results = (state: State) => {
  if (state.busy)
    return '<p class="notice" role="status">Reading occurrence data…<br>You can continue reading while this runs.</p>';
  const page = state.occurrences;
  if (!page)
    return '<div class="search-empty"><span aria-hidden="true">✦</span><h2>Find patterns in the Scriptures.</h2><p>Choose a frequency and phrase length.<br>Whole-Bible data is prepared in advance. Custom book selections are saved for reuse.</p></div>';
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
  const totalChapters = state.books.reduce(
    (sum, book) => sum + book.chapters,
    0,
  );
  const filters: readonly Filter[] = [
    {
      title: "Number of books",
      description:
        "How many distinct books contain the word or phrase. Any number leaves this unrestricted.",
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
      description:
        "Total letters in the word or phrase. Spaces, punctuation, and digits do not count.",
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
      description:
        "Appears in every verse of a run within one chapter. At least sets the minimum run length.",
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
      description:
        "Appears in every chapter of a run within one book. At least sets the minimum run length.",
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
      title: "Occurrences in one chapter",
      description:
        "At least one chapter must contain exactly this many appearances.",
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
  <div class="occurrence-workspace"><section class="occurrence-parameters-pane" aria-labelledby="occurrence-parameters-heading"><h2 id="occurrence-parameters-heading">Search settings</h2>
  <form id="occurrence-form" class="occurrence-form">
    <fieldset class="filter-section"><legend>Frequency and phrase size</legend><div class="filter-grid">
      <div class="filter-card"><h3>Occurrence count</h3><p id="occurrence-count-help">Total appearances in the books being searched. Any number leaves frequency unrestricted. Up to includes counts from 1 through your limit.</p><div class="filter-controls">
        <label>Match<select name="countMode" id="occurrence-count-mode" data-controls="occurrence-count" data-hide-input aria-label="Occurrence count: comparison"><option value="any"${query.anyCount ? " selected" : ""}>Any number</option><option value="exact"${!query.anyCount && !query.countUpTo ? " selected" : ""}>Exactly</option><option value="upTo"${!query.anyCount && query.countUpTo ? " selected" : ""}>Up to</option></select></label>
        <label${query.anyCount ? " hidden" : ""}>Appearances<input name="count" id="occurrence-count" aria-describedby="occurrence-count-help" type="number" min="1" max="4294967295" step="1" required value="${query.count}"${query.anyCount ? " disabled" : ""}></label>
      </div></div>
      <div class="filter-card"><h3>Phrase length</h3><p id="occurrence-words-help">Words per phrase. Any number searches all supported lengths (1–32). Exactly 2 finds pairs; up to 2 also includes single words.</p><div class="filter-controls">
        <label>Match<select name="mode" id="occurrence-mode" data-controls="occurrence-words" data-hide-input aria-label="Phrase length: comparison"><option value="any"${query.anyLength ? " selected" : ""}>Any number</option><option value="exact"${!query.anyLength && !query.upTo ? " selected" : ""}>Exactly</option><option value="upTo"${!query.anyLength && query.upTo ? " selected" : ""}>Up to</option></select></label>
        <label${query.anyLength ? " hidden" : ""}>Words (1–32)<input name="words" id="occurrence-words" aria-describedby="occurrence-words-help" type="number" min="1" max="32" step="1" required value="${query.words}"${query.anyLength ? " disabled" : ""}></label>
      </div></div>
      ${optionalFilter(filters[1])}
    </div></fieldset>
    <fieldset class="filter-section"><legend>Books to search</legend>
    <p class="filter-section-help">Search the whole Bible, or select books to count appearances only within those books.</p>
    <div class="book-scope"><label class="checkbox"><input type="checkbox" id="choose-books" name="chooseBooks"${query.includedBooks != null ? " checked" : ""}> Limit search to selected books</label>
    <fieldset id="included-books"${query.includedBooks == null ? " disabled hidden" : ""}><legend>Include these books</legend><div class="book-checkboxes">${state.books.map((book) => `<label class="checkbox"><input type="checkbox" name="includedBooks" value="${escape(book.name)}"${query.includedBooks?.includes(book.name) ? " checked" : ""}>${escape(book.name)}</label>`).join("")}</div></fieldset></div>
    <div class="filter-grid">${optionalFilter(filters[0])}</div></fieldset>
    <fieldset class="filter-section"><legend>Chapters containing the word or phrase</legend>
      <div class="filter-card"><h3>Number of chapters</h3><p id="occurrence-total-chapters-help">Count distinct chapters containing at least one appearance. Repeated appearances in a chapter count once. Every chapter requires all ${totalChapters.toLocaleString()} chapters of the Bible.</p><div class="filter-controls">
      <label>Match<select name="chaptersMode" id="occurrence-chapters-mode" data-controls="occurrence-total-chapters" data-hide-input aria-label="Number of chapters: comparison"><option value="any"${query.chapters == null ? " selected" : ""}>Any Number of Chapters of the Bible</option><option value="every"${query.everyChapter ? " selected" : ""}>Every Chapter of the Bible</option><option value="exact"${query.chapters != null && !query.everyChapter ? " selected" : ""}>X number of Chapters in the Bible</option></select></label>
      <label${query.chapters == null || query.everyChapter ? " hidden" : ""}>Chapters (1–${totalChapters.toLocaleString()})<input name="chapters" id="occurrence-total-chapters" aria-describedby="occurrence-total-chapters-help" type="number" min="1" max="${totalChapters}" step="1" required value="${query.everyChapter ? 1 : (query.chapters ?? 1)}"${query.chapters == null || query.everyChapter ? " disabled" : ""}></label>
      </div></div>
    </fieldset>
    <fieldset class="filter-section"><legend>Where it appears <span>(optional)</span></legend>
      <p class="filter-section-help">Leave these on Any number for no restriction. Each condition can be satisfied in a different location.</p>
      <div class="filter-grid">${filters.slice(2).map(optionalFilter).join("")}</div>
    </fieldset>
    <div class="occurrence-submit"><button class="primary" type="submit">Find words &amp; phrases →</button></div>
  </form>
  <p class="counting-note">Counts include repeated appearances in a verse. Case and punctuation are ignored; phrases stay within a verse. Results are ordered by word length, occurrence count, book count, letter count, then alphabetically. Choose a result to view its verses.</p>
  </section><section class="occurrence-results-pane" aria-labelledby="occurrence-results-heading"><div class="occurrence-results-heading"><h2 id="occurrence-results-heading">Results</h2><button type="button" data-action="occurrence-copy" title="Copy all matching results as alphabetical CSV"${state.busy || !state.occurrences?.total ? " disabled" : ""}>Copy data</button></div><p id="occurrence-copy-status" class="counting-note" role="status"></p>${results(state)}</section></div>
</section>`;
};
