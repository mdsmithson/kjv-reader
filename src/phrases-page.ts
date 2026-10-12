import {
  clickableText,
  contextWordTable,
  contextPhraseHeader,
  contextPhraseRow,
  sorted,
} from "./detail-tables";
import { escape, highlighted } from "./highlight";
import {
  pageSize,
  reference,
  type State,
  type PhraseFilterField,
} from "./model";
export const phrasesView = (state: State): string => {
  const page = state.savedPhrases;
  const fields: readonly [PhraseFilterField, string, number, number | null][] =
    [
      ["words", "Words", 2, 90],
      ["letters", "Letters", 0, null],
      ["occurrences", "Occurrences", 1, null],
      ["books", "Books", 1, 66],
    ];
  const headers = `<div class="phrase-table-heading"><span>Phrase</span>${fields.map(([field, label]) => `<button type="button" data-phrase-filter="${field}" aria-expanded="${state.phraseFilter === field || state.phraseFilters[field] != null}">${label}${state.phraseFilters[field] == null ? "" : ` = ${state.phraseFilters[field]}`}</button>`).join("")}</div>`;
  return `<section class="search-page phrases-page"><div class="eyebrow">EXPLORE SAVED PHRASES</div><h1>Phrases</h1>
    <p class="intro">Bible phrases of 2–90 words, alphabetically. Shorter phrases are counted only under the longest containing phrase with the same Bible-wide occurrence count. Choose a phrase to see its verses.</p>
    <p class="counting-note">Exact Match finds the complete phrase, ignoring case and punctuation. Partial Match finds consecutive words or parts of words anywhere in a phrase. All phrase data is prepared in advance for fast browsing. Counts cover the whole Bible; letters exclude spaces, punctuation, and digits.</p>
    <form id="phrases-form"><div class="search-box"><input id="phrase-search" name="text" aria-label="Search phrases" placeholder="e.g. in the beginning" maxlength="250" value="${escape(state.phraseFilters.text ?? "")}"><button class="primary" type="submit">Search phrases →</button></div><fieldset class="phrase-match-options"><legend>Match type</legend><label><input type="radio" name="phrase-match" value="exact"${state.phraseFilters.partial ? "" : " checked"}> Exact Match</label><label><input id="phrase-partial" type="radio" name="phrase-match" value="partial"${state.phraseFilters.partial ? " checked" : ""}> Partial Match</label></fieldset><div class="word-count-filters phrase-count-filters"${state.phraseFilter || fields.some(([field]) => state.phraseFilters[field] != null) ? "" : " hidden"}>${fields.map(([field, label, min, max]) => `<label${state.phraseFilter === field || state.phraseFilters[field] != null ? "" : " hidden"}>Exactly this many ${label.toLowerCase()}<input id="phrase-${field}-filter" type="number" name="${field}" min="${min}"${max == null ? "" : ` max="${max}"`} step="1" placeholder="Any number" value="${state.phraseFilters[field] ?? ""}"></label>`).join("")}<button type="submit" class="primary">Filter phrases →</button></div></form>
    <p class="counting-note">Click Words, Letters, Occurrences, or Books to enter an exact count, then press Enter or Filter phrases. Combine counts, or clear a field to remove its filter.</p>
    ${!state.busy && page ? `<div class="result-summary" role="status"><strong>${page.total.toLocaleString()} phrases</strong><span>${page.total ? state.savedPhraseOffset + 1 : 0}–${state.savedPhraseOffset + page.entries.length} of ${page.total.toLocaleString()}</span></div>` : ""}
    ${headers}
    ${
      state.busy
        ? '<p role="status" class="notice">Opening phrases…</p>'
        : page
          ? `
      ${
        page.total
          ? `<div class="phrase-table">${page.entries.map((entry) => `<button class="phrase-row" data-saved-phrase="${escape(entry.phrase)}"><span class="scripture">${escape(entry.phrase)}</span><span>${entry.words}</span><span>${entry.letters}</span><span>${entry.occurrences.toLocaleString()}</span><span>${entry.books}</span></button>`).join("")}</div>
      <div class="chapter-navigation"><button data-action="saved-phrases-previous"${state.savedPhraseOffset === 0 ? " disabled" : ""}>← Previous phrases</button><span>Page ${Math.floor(state.savedPhraseOffset / pageSize) + 1}</span><button data-action="saved-phrases-next"${state.savedPhraseOffset + pageSize >= page.total ? " disabled" : ""}>Next phrases →</button></div>`
          : `<p class="notice">${page.persistedLengths.length ? "No phrases match your search and counts. Clear or change the search or filters to see more phrases." : "Phrase data is unavailable. Reinstall the app to restore the bundled data."}</p>`
      }`
          : ""
    }
  </section>`;
};
export const phraseDetailView = (state: State): string => {
  const detail = state.phraseDetail;
  const offset = state.phraseVerseOffset;
  const numberLink = (number: number) =>
    `<button class="number-stat-link" data-number="${number}" aria-label="Explore number ${number}">${number.toLocaleString()}</button>`;
  return `<section class="search-page phrase-detail-page">${state.phraseReturnNumber == null ? '<button data-page="phrases">← Back to Phrases</button>' : `<button data-number="${state.phraseReturnNumber}" data-number-return="true">← Back to ${state.phraseReturnNumber.toLocaleString()}</button>`}<div class="eyebrow">PHRASE IN THE BIBLE</div><h1 class="phrase-interactive-title">${detail ? clickableText(state.selectedPhrase, detail.wordParts) : escape(state.selectedPhrase)}</h1>
    ${
      state.busy
        ? '<p role="status" class="notice">Loading phrase verses…</p>'
        : detail
          ? `<dl class="book-statistics"><div><dt>Words in phrase</dt><dd>${numberLink(detail.words)}</dd></div><div><dt>Letters in phrase</dt><dd>${numberLink(detail.letters)}</dd></div><div><dt>Occurrences in the Bible</dt><dd>${numberLink(detail.occurrences)}</dd></div><div><dt>Books containing phrase</dt><dd>${numberLink(detail.books)}</dd></div></dl>
    <section class="phrase-books-section"><h2>Occurrences by book</h2><p class="counting-note">Counts include every occurrence, including repeated matches within a verse.</p><table class="phrase-books-table"><thead><tr><th scope="col">Book</th><th scope="col">Occurrences</th></tr></thead><tbody>${detail.bookEntries.map((entry) => `<tr><td>${escape(entry.book)}</td><td>${numberLink(entry.occurrences)}</td></tr>`).join("")}</tbody><tfoot><tr><th scope="row">Total</th><td>${numberLink(detail.occurrences)}</td></tr></tfoot></table></section>
    ${contextWordTable("Words in this phrase", "phrase-words", detail.wordEntries, state.phraseWordSort, true)}
    <section class="subphrases-section"><h2>Subphrases in this phrase</h2><p class="counting-note">The phrase itself is excluded. Shorter phrases are grouped under the longest containing phrase with the same Bible-wide occurrence count. Click a header to sort; click it again to reverse.</p>
    <div class="result-summary"><strong>${numberLink(detail.subphraseResults.total)} subphrases</strong><span>${detail.subphraseResults.total ? state.subphraseOffset + 1 : 0}–${Math.min(state.subphraseOffset + pageSize, detail.subphraseResults.total)} of ${detail.subphraseResults.total.toLocaleString()}</span></div>
    ${
      detail.subphraseResults.total
        ? `<div class="verse-phrase-table">${contextPhraseHeader("subphrases", state.subphraseSort)}${sorted(
            detail.subphraseResults.entries,
            state.subphraseSort,
          )
            .slice(state.subphraseOffset, state.subphraseOffset + pageSize)
            .map((entry) => contextPhraseRow(entry, true))
            .join(
              "",
            )}</div><div class="chapter-navigation"><button data-action="subphrases-previous"${state.subphraseOffset === 0 ? " disabled" : ""}>← Previous subphrases</button><span>Page ${Math.floor(state.subphraseOffset / pageSize) + 1}</span><button data-action="subphrases-next"${state.subphraseOffset + pageSize >= detail.subphraseResults.total ? " disabled" : ""}>Next subphrases →</button></div>`
        : '<p class="notice">This phrase has no shorter phrases of two or more words.</p>'
    }</section>
    <h2>All matching verses</h2><p class="counting-note">Matches complete, consecutive words within a verse, ignoring case and punctuation. A verse is listed once, even if the phrase occurs repeatedly.</p>
    <div class="result-summary"><strong>${numberLink(detail.results.total)} verses</strong><span>${detail.results.total ? offset + 1 : 0}–${offset + detail.results.verses.length} of ${detail.results.total.toLocaleString()}</span></div>
    <div class="results">${detail.results.verses.map((verse) => `<button class="result" data-book="${escape(verse.book)}" data-chapter="${verse.chapter}" data-verse="${verse.number}"><span class="result-reference">${escape(reference(verse))} ↗</span><span class="scripture">${highlighted(verse.text, { text: detail.phrase, book: null, phrase: true, normalizedWords: true, offset: 0 })}</span></button>`).join("")}</div>
    ${detail.results.total ? `<div class="chapter-navigation"><button data-action="phrase-verses-previous"${offset === 0 ? " disabled" : ""}>← Previous verses</button><span>Page ${Math.floor(offset / pageSize) + 1}</span><button data-action="phrase-verses-next"${offset + pageSize >= detail.results.total ? " disabled" : ""}>Next verses →</button></div>` : '<p class="notice">No matching verses.</p>'}`
          : ""
    }
  </section>`;
};
