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
      ["words", "Words", 2, 32],
      ["letters", "Letters", 0, null],
      ["occurrences", "Occurrences", 1, null],
      ["books", "Books", 1, 66],
    ];
  const headers = `<div class="phrase-table-heading"><span>Phrase</span>${fields.map(([field, label]) => `<button type="button" data-phrase-filter="${field}" aria-expanded="${state.phraseFilter === field || state.phraseFilters[field] != null}">${label}${state.phraseFilters[field] == null ? "" : ` = ${state.phraseFilters[field]}`}</button>`).join("")}</div>`;
  return `<section class="search-page phrases-page"><div class="eyebrow">EXPLORE SAVED PHRASES</div><h1>Phrases</h1>
    <p class="intro">All Bible phrases of 2–32 words, alphabetically. Choose a phrase to see its verses.</p>
    <p class="counting-note">All phrase data is prepared in advance for fast browsing. Counts cover the whole Bible; letters exclude spaces, punctuation, and digits.</p>
    <form id="phrases-form"${state.phraseFilter || Object.values(state.phraseFilters).some((value) => value != null) ? "" : " hidden"}><div class="word-count-filters phrase-count-filters">${fields.map(([field, label, min, max]) => `<label${state.phraseFilter === field || state.phraseFilters[field] != null ? "" : " hidden"}>Exactly this many ${label.toLowerCase()}<input id="phrase-${field}-filter" type="number" name="${field}" min="${min}"${max == null ? "" : ` max="${max}"`} step="1" placeholder="Any number" value="${state.phraseFilters[field] ?? ""}"></label>`).join("")}<button type="submit" class="primary">Filter phrases →</button></div></form>
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
          : `<p class="notice">${page.persistedLengths.length ? "No phrases match these counts. Clear or change a filter to see more phrases." : "Phrase data is unavailable. Reinstall the app to restore the bundled data."}</p>`
      }`
          : ""
    }
  </section>`;
};
export const phraseDetailView = (state: State): string => {
  const detail = state.phraseDetail;
  const offset = state.phraseVerseOffset;
  return `<section class="search-page phrase-detail-page"><button data-page="phrases">← Back to Phrases</button><div class="eyebrow">PHRASE IN THE BIBLE</div><h1 class="phrase-interactive-title">${detail ? clickableText(state.selectedPhrase, detail.wordParts) : escape(state.selectedPhrase)}</h1>
    ${
      state.busy
        ? '<p role="status" class="notice">Loading phrase verses…</p>'
        : detail
          ? `<dl class="book-statistics"><div><dt>Words in phrase</dt><dd>${detail.words}</dd></div><div><dt>Letters in phrase</dt><dd>${detail.letters}</dd></div><div><dt>Occurrences in the Bible</dt><dd>${detail.occurrences.toLocaleString()}</dd></div><div><dt>Books containing phrase</dt><dd>${detail.books}</dd></div></dl>
    ${contextWordTable("Words in this phrase", "phrase-words", detail.wordEntries, state.phraseWordSort)}
    <section class="subphrases-section"><h2>Subphrases in this phrase</h2><p class="counting-note">The phrase itself is excluded. Shorter phrases occurring once are grouped under longer subphrases that also occur once. Click a header to sort; click it again to reverse.</p>
    <div class="result-summary"><strong>${detail.subphraseResults.total.toLocaleString()} subphrases</strong><span>${detail.subphraseResults.total ? state.subphraseOffset + 1 : 0}–${Math.min(state.subphraseOffset + pageSize, detail.subphraseResults.total)} of ${detail.subphraseResults.total.toLocaleString()}</span></div>
    ${
      detail.subphraseResults.total
        ? `<div class="verse-phrase-table">${contextPhraseHeader("subphrases", state.subphraseSort)}${sorted(
            detail.subphraseResults.entries,
            state.subphraseSort,
          )
            .slice(state.subphraseOffset, state.subphraseOffset + pageSize)
            .map(contextPhraseRow)
            .join(
              "",
            )}</div><div class="chapter-navigation"><button data-action="subphrases-previous"${state.subphraseOffset === 0 ? " disabled" : ""}>← Previous subphrases</button><span>Page ${Math.floor(state.subphraseOffset / pageSize) + 1}</span><button data-action="subphrases-next"${state.subphraseOffset + pageSize >= detail.subphraseResults.total ? " disabled" : ""}>Next subphrases →</button></div>`
        : '<p class="notice">This phrase has no shorter phrases of two or more words.</p>'
    }</section>
    <h2>All matching verses</h2><p class="counting-note">Matches complete, consecutive words within a verse, ignoring case and punctuation. A verse is listed once, even if the phrase occurs repeatedly.</p>
    <div class="result-summary"><strong>${detail.results.total.toLocaleString()} verses</strong><span>${detail.results.total ? offset + 1 : 0}–${offset + detail.results.verses.length} of ${detail.results.total.toLocaleString()}</span></div>
    <div class="results">${detail.results.verses.map((verse) => `<button class="result" data-book="${escape(verse.book)}" data-chapter="${verse.chapter}" data-verse="${verse.number}"><span class="result-reference">${escape(reference(verse))} ↗</span><span class="scripture">${highlighted(verse.text, { text: detail.phrase, book: null, phrase: true, normalizedWords: true, offset: 0 })}</span></button>`).join("")}</div>
    ${detail.results.total ? `<div class="chapter-navigation"><button data-action="phrase-verses-previous"${offset === 0 ? " disabled" : ""}>← Previous verses</button><span>Page ${Math.floor(offset / pageSize) + 1}</span><button data-action="phrase-verses-next"${offset + pageSize >= detail.results.total ? " disabled" : ""}>Next verses →</button></div>` : '<p class="notice">No matching verses.</p>'}`
          : ""
    }
  </section>`;
};
