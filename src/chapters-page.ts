import { escape } from "./highlight";
import { pageSize, type State } from "./model";
export type ChapterSort = Readonly<{
  field: string;
  direction: "asc" | "desc";
}>;
export type ChapterSummary = Readonly<{
  book: string;
  chapter: number;
  words: number;
  letters: number;
  uniqueWords: number;
  firstMentionWords: number;
  exclusiveWords: number;
  verses: number;
}>;
export type ChapterWord = Readonly<{
  word: string;
  display: string;
  count: number;
  letters: number;
  books: number;
  bibleCount: number;
}>;
export type ChapterPhrase = Readonly<{
  phrase: string;
  words: number;
  letters: number;
  books: number;
  occurrences: number;
  count: number;
  firstMentionWords: number;
}>;
export type ChapterPage = Readonly<{
  total: number;
  entries: readonly ChapterSummary[];
}>;
export type ChapterDetail = Readonly<{
  summary: ChapterSummary;
  wordResults: Readonly<{ total: number; entries: readonly ChapterWord[] }>;
  phraseResults: Readonly<{ total: number; entries: readonly ChapterPhrase[] }>;
}>;
export type ChapterFilters = Readonly<Record<string, string | number | null>>;
export type ChapterBrowser = Readonly<{
  filters: ChapterFilters;
  wordFilters: ChapterFilters;
  phraseFilters: ChapterFilters;
  filterFields: Readonly<{
    catalogue: string | null;
    words: string | null;
    phrases: string | null;
  }>;
  book: string | null;
  offset: number;
  sort: ChapterSort;
  list: ChapterPage | null;
  selected: Readonly<{ book: string; chapter: number }> | null;
  detail: ChapterDetail | null;
  wordOffset: number;
  phraseOffset: number;
  wordSort: ChapterSort;
  phraseSort: ChapterSort;
}>;
export const initialChapterBrowser: ChapterBrowser = {
  filters: {},
  wordFilters: {},
  phraseFilters: {},
  filterFields: { catalogue: null, words: null, phrases: null },
  book: null,
  offset: 0,
  sort: { field: "reference", direction: "asc" },
  list: null,
  selected: null,
  detail: null,
  wordOffset: 0,
  phraseOffset: 0,
  wordSort: { field: "word", direction: "asc" },
  phraseSort: { field: "phrase", direction: "asc" },
};
const header = (
  owner: string,
  field: string,
  label: string,
  sort: ChapterSort,
  filters: ChapterFilters = {},
  expanded: string | null = null,
) =>
  `<span class="chapter-filter-heading" role="columnheader" aria-sort="${sort.field === field ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}"><button id="chapter-filter-${owner}-${field}" data-chapter-filter="${owner}" data-chapter-filter-field="${field}" aria-expanded="${expanded === field || filters[field] != null}">${label}${filters[field] == null ? "" : ` = ${escape(String(filters[field]))}`}</button><button id="chapter-sort-${owner}-${field}" class="chapter-sort-control" data-chapter-sort="${owner}" data-chapter-sort-field="${field}" aria-label="Sort ${owner} by ${label}">${sort.field === field ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}</button></span>`;
const filterForm = (
  owner: string,
  fields: readonly (readonly [string, string])[],
  filters: ChapterFilters,
  expanded: string | null,
) =>
  `<form class="chapter-custom-filters" data-chapter-filter-form="${owner}"${expanded || fields.some(([field]) => filters[field] != null) ? "" : " hidden"}>${fields.map(([field, label]) => `<label${expanded === field || filters[field] != null ? "" : " hidden"}>${["word", "phrase"].includes(field) ? `${label} contains` : field === "book" ? "Book name exactly" : `Exactly this many ${label.toLowerCase()}`}<input id="chapter-${owner}-${field}-filter" data-chapter-filter-input="${field}" type="${["book", "word", "phrase"].includes(field) ? "text" : "number"}"${["book", "word", "phrase"].includes(field) ? ' maxlength="250"' : ' min="0" step="1"'} placeholder="Any ${["book", "word", "phrase"].includes(field) ? "text" : "number"}" value="${escape(String(filters[field] ?? ""))}"></label>`).join("")}<button class="primary" type="submit">Apply filters →</button><button type="button" data-chapter-filter-clear="${owner}">Clear filters</button></form>`;
const catalogueFields = [
  ["book", "Book"],
  ["chapter", "Chapter"],
  ["words", "Words"],
  ["letters", "Letters"],
  ["uniqueWords", "Unique words"],
  ["firstMentionWords", "First mention words"],
  ["exclusiveWords", "Exclusive words"],
] as const;
const wordFields = [
  ["word", "Word"],
  ["count", "In chapter"],
  ["bibleCount", "In Bible"],
  ["letters", "Letters"],
  ["books", "Books"],
] as const;
const phraseFields = [
  ["phrase", "Phrase"],
  ["words", "Words"],
  ["letters", "Letters"],
  ["books", "Books"],
  ["firstMentionWords", "First mention words"],
  ["count", "In chapter"],
  ["occurrences", "In Bible"],
] as const;
const pager = (owner: string, offset: number, total: number, busy: boolean) =>
  `<div class="chapter-navigation"><button data-chapter-pager="${owner}" data-step="-1"${offset === 0 || busy ? " disabled" : ""}>← Previous</button><span>Page ${Math.floor(offset / pageSize) + 1}</span><button data-chapter-pager="${owner}" data-step="1"${offset + pageSize >= total || busy ? " disabled" : ""}>Next →</button></div>`;
export const chaptersView = (state: State) => {
  const browser = state.chapterBrowser,
    page = browser.list;
  return `<section class="search-page chapters-page"><div class="eyebrow">EXPLORE EVERY CHAPTER</div><h1>Chapters</h1><p class="intro">Browse all chapters in Bible order. Click any heading to add a filter. Use its arrow to sort in either direction. Choose a chapter for its words and phrases.</p><label class="verse-book-filter">Within<select id="chapters-book"><option value="">All books</option>${state.books.map((book) => `<option${browser.book === book.name ? " selected" : ""}>${escape(book.name)}</option>`).join("")}</select></label><p class="counting-note">First mention words are distinct words whose first appearance in the Bible is in the chapter. Exclusive words appear nowhere outside that chapter. Word counts include repeated appearances. Letters exclude spaces, punctuation, and digits.</p>${filterForm("catalogue", catalogueFields, browser.filters, browser.filterFields.catalogue)}${
    page
      ? `<div class="result-summary"><strong>${page.total.toLocaleString()} chapters</strong><span>${page.total ? browser.offset + 1 : 0}–${browser.offset + page.entries.length} of ${page.total.toLocaleString()}</span></div><div class="chapter-table-scroll"><div class="chapter-catalogue-heading">${catalogueFields
          .map(([field, label]) =>
            header(
              "catalogue",
              field,
              label,
              browser.sort,
              browser.filters,
              browser.filterFields.catalogue,
            ),
          )
          .join(
            "",
          )}</div>${page.entries.map((entry) => `<button class="chapter-catalogue-row" data-chapter-profile="${entry.chapter}" data-book="${escape(entry.book)}"><span>${escape(entry.book)}</span><span>${entry.chapter}</span><span>${entry.words.toLocaleString()}</span><span>${entry.letters.toLocaleString()}</span><span>${entry.uniqueWords.toLocaleString()}</span><span>${entry.firstMentionWords.toLocaleString()}</span><span>${entry.exclusiveWords.toLocaleString()}</span></button>`).join("")}</div>${pager("catalogue", browser.offset, page.total, state.busy)}`
      : '<p class="notice" role="status">Opening chapters…</p>'
  }</section>`;
};
export const chapterProfileView = (state: State) => {
  const b = state.chapterBrowser,
    d = b.detail;
  return `<section class="search-page chapter-profile-page"><button data-page="chapters">← Back to Chapters</button><div class="eyebrow">CHAPTER IN THE BIBLE</div><h1>${escape(b.selected?.book ?? "")} ${b.selected?.chapter ?? ""}</h1>${
    d
      ? `<dl class="book-statistics chapter-profile-statistics">${[
          ["Words", d.summary.words],
          ["Letters", d.summary.letters],
          ["Unique words", d.summary.uniqueWords],
          ["First mention words", d.summary.firstMentionWords],
          ["Exclusive words", d.summary.exclusiveWords],
          ["Verses", d.summary.verses],
        ]
          .map(
            ([label, value]) =>
              `<div><dt>${label}</dt><dd>${Number(value).toLocaleString()}</dd></div>`,
          )
          .join(
            "",
          )}</dl><button data-book="${escape(d.summary.book)}" data-chapter="${d.summary.chapter}">Read chapter →</button><div class="chapter-section-links" role="group" aria-label="Chapter sections"><button data-chapter-section="words">Words (${d.wordResults.total.toLocaleString()})</button><button data-chapter-section="phrases">Phrases (${d.phraseResults.total.toLocaleString()})</button></div><section id="chapter-profile-words"><h2>Words in this chapter</h2><p class="counting-note">Each distinct word appears once. In chapter counts its appearances here; In Bible counts all appearances. Click a word to open its Word page. Click a heading to filter; use its arrow to sort.</p>${filterForm("words", wordFields, b.wordFilters, b.filterFields.words)}<div class="result-summary"><strong>${d.wordResults.total.toLocaleString()} words</strong><span>${d.wordResults.total ? b.wordOffset + 1 : 0}–${b.wordOffset + d.wordResults.entries.length} of ${d.wordResults.total.toLocaleString()}</span></div><div class="chapter-table-scroll"><div class="chapter-word-heading">${wordFields
          .map(([field, label]) =>
            header(
              "words",
              field,
              label,
              b.wordSort,
              b.wordFilters,
              b.filterFields.words,
            ),
          )
          .join(
            "",
          )}</div>${d.wordResults.entries.map((entry) => `<button class="chapter-word-row" data-word="${escape(entry.word)}"><span class="scripture">${escape(entry.display)}</span><span>${entry.count.toLocaleString()}</span><span>${entry.bibleCount.toLocaleString()}</span><span>${entry.letters}</span><span>${entry.books}</span></button>`).join("")}</div>${pager("words", b.wordOffset, d.wordResults.total, state.busy)}</section><section id="chapter-profile-phrases"><h2>Phrases in this chapter</h2><p class="counting-note">Each distinct saved phrase appears once. First mention words counts distinct words in the phrase whose first Bible appearance is in this chapter. Shorter phrases with the same Bible-wide count are grouped under the longest phrase. Click a phrase to open its Phrase page. Click a heading to filter; use its arrow to sort.</p>${filterForm("phrases", phraseFields, b.phraseFilters, b.filterFields.phrases)}<div class="result-summary"><strong>${d.phraseResults.total.toLocaleString()} phrases</strong><span>${d.phraseResults.total ? b.phraseOffset + 1 : 0}–${b.phraseOffset + d.phraseResults.entries.length} of ${d.phraseResults.total.toLocaleString()}</span></div><div class="chapter-table-scroll"><div class="chapter-phrase-heading">${phraseFields
          .map(([field, label]) =>
            header(
              "phrases",
              field,
              label,
              b.phraseSort,
              b.phraseFilters,
              b.filterFields.phrases,
            ),
          )
          .join(
            "",
          )}</div>${d.phraseResults.entries.map((entry) => `<button class="chapter-phrase-row" data-saved-phrase="${escape(entry.phrase)}"><span class="scripture">${escape(entry.phrase)}</span><span>${entry.words}</span><span>${entry.letters}</span><span>${entry.books}</span><span>${entry.firstMentionWords}</span><span>${entry.count.toLocaleString()}</span><span>${entry.occurrences.toLocaleString()}</span></button>`).join("")}</div>${pager("phrases", b.phraseOffset, d.phraseResults.total, state.busy)}</section>`
      : '<p role="status" class="notice">Opening chapter details…</p>'
  }</section>`;
};
