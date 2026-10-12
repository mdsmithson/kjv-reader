import {
  clickableText,
  contextWordTable,
  contextPhraseHeader,
  contextPhraseRow,
} from "./detail-tables";
import { escape } from "./highlight";
import { pageSize, reference, type State, type VerseDetail } from "./model";
const verseButton = (verse: VerseDetail["verse"]) =>
  `data-verse-detail="true" data-book="${escape(verse.book)}" data-chapter="${verse.chapter}" data-verse="${verse.number}"`;
export const versesView = (state: State): string => {
  const page = state.verseResults;
  const fields = [
    ["words", "Words"],
    ["letters", "Letters"],
    ["phrases", "Phrases"],
  ] as const;
  const columns = [
    ...state.verseFrequencies.map((frequency, index) => ({
      frequency,
      index,
      kind: "words" as const,
      key: String(frequency),
    })),
    ...state.versePhraseFrequencies.map((frequency, index) => ({
      frequency,
      index,
      kind: "phrases" as const,
      key: `phrase:${frequency}`,
    })),
  ];
  const frequencyLabel = (n: number, kind: "words" | "phrases") =>
    `${kind === "words" ? "Words" : "Phrases"} occurring ${n.toLocaleString()} ${n === 1 ? "time" : "times"}`;
  const headers = `<div class="verse-table-heading"><span>Verse</span>${fields.map(([field, label]) => `<button data-verse-filter="${field}" type="button" aria-expanded="${state.verseFilter === field || state.verseFilters[field] != null}">${label}${state.verseFilters[field] == null ? "" : ` = ${state.verseFilters[field]}`}</button>`).join("")}${columns
    .map(({ frequency, kind, key }) => {
      const active =
        state.verseFrequencySort?.frequency === frequency &&
        (state.verseFrequencySort.kind ?? "words") === kind;
      const direction = active ? state.verseFrequencySort?.direction : null;
      return `<div class="verse-frequency-heading" role="columnheader" aria-sort="${direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}"><button data-verse-frequency-sort="${key}" aria-label="Sort ${frequencyLabel(frequency, kind).toLowerCase()} ${direction === "desc" ? "ascending" : "descending"}">${frequencyLabel(frequency, kind)} ${direction === "asc" ? "↑" : direction === "desc" ? "↓" : "↕"}</button><button class="frequency-remove" data-verse-frequency-remove="${key}" aria-label="Remove ${frequencyLabel(frequency, kind).toLowerCase()} column"${state.busy ? " disabled" : ""}>Remove</button></div>`;
    })
    .join("")}</div>`;
  const extraSearches = (state.verseFilters.searches ?? [])
    .map(
      (search, index) =>
        `<section class="verse-search-step" data-verse-search-row="${index}"><div class="verse-search-step-heading"><h3>Search ${index + 2} · within Search ${index + 1} results</h3><button type="button" data-verse-search-remove="${index}" aria-label="Remove search ${index + 2}">Remove</button></div><label>Word or phrase<input type="text" id="verse-search-${index + 1}" aria-label="Search ${index + 2} word or phrase" placeholder="e.g. heaven" maxlength="250" value="${escape(search.text)}"></label><fieldset class="phrase-match-options"><legend>Match type for Search ${index + 2}</legend><label><input type="radio" name="verse-match-${index}" value="exact"${search.partial ? "" : " checked"}>Exact Match</label><label><input type="radio" name="verse-match-${index}" value="partial"${search.partial ? " checked" : ""}>Partial Match</label></fieldset></section>`,
    )
    .join("");
  const locationFilters = (["chapter", "verse"] as const)
    .filter((field) => state.verseFilters[field] != null)
    .map(
      (field) =>
        `<div class="verse-location-filter"><label>${field === "chapter" ? "Chapter number" : "Verse number"}<input id="${field === "chapter" ? "verse-chapter-filter" : "verse-number-filter"}" type="number" min="1" max="${Number.MAX_SAFE_INTEGER}" step="1" placeholder="Any number" value="${state.verseFilters[field]}"></label><button type="button" data-verse-location-remove="${field}" aria-label="Remove ${field === "chapter" ? "chapter" : "verse"} number filter">Remove</button></div>`,
    )
    .join("");
  const filterKind =
    columns.length < 5
      ? "words"
      : state.verseFilters.chapter == null
        ? "chapter"
        : "verse";
  const locationKind = filterKind === "chapter" || filterKind === "verse";
  return `<section class="search-page verses-page"><div class="eyebrow">EXPLORE EVERY VERSE</div><h1>Verses</h1><p class="intro">Browse verses in Bible order, or sort by the frequency columns you add. Choose a verse to explore its words and phrases.</p>
  <form id="verses-form"><div class="search-box"><input id="verse-search" name="text" aria-label="Search verse text" placeholder="e.g. in the beginning" maxlength="250" value="${escape(state.verseFilters.text ?? "")}"><button type="submit" class="primary">Search verses →</button></div><fieldset class="phrase-match-options"><legend>Match type</legend><label><input type="radio" name="verse-match" value="exact"${state.verseFilters.partial ? "" : " checked"}>Exact Match</label><label><input type="radio" name="verse-match" value="partial"${state.verseFilters.partial ? " checked" : ""}>Partial Match</label></fieldset><p class="counting-note">Exact Match finds complete, consecutive words anywhere in a verse, ignoring case and punctuation. Partial Match finds the entered text within words. Clear all search fields to browse all verses.</p>${extraSearches}<div class="verse-search-add"><button type="button" data-action="verse-search-add">Add search</button><span>Each search narrows the preceding results. Blank searches are ignored.</span></div><label class="verse-book-filter">Within<select id="verses-book"><option value="">All books</option>${state.books.map((book) => `<option${book.name === state.verseBook ? " selected" : ""}>${escape(book.name)}</option>`).join("")}</select></label>
  ${locationFilters ? `<div class="verse-location-filters">${locationFilters}</div><p class="counting-note">These filters match chapter and verse numbers in each verse reference. Combine both to find a specific chapter and verse across your selected books.</p>` : ""}<div class="word-count-filters">${fields.map(([field, label]) => `<label${state.verseFilter === field || state.verseFilters[field] != null ? "" : " hidden"}>Exactly this many ${label.toLowerCase()}<input id="verse-${field}-filter" name="${field}" type="number" min="${field === "words" ? 1 : 0}" step="1" placeholder="Any number" value="${state.verseFilters[field] ?? ""}"></label>`).join("")}<button class="primary" type="submit">Filter verses →</button></div></form>
  <p class="counting-note">Click Words, Letters, or Phrases to enter an exact count, then press Enter or Filter verses. Combine counts with a book, or clear a field to remove its filter. Words include repetitions; letters exclude spaces, punctuation, and digits; phrases count distinct consecutive phrases of 2–90 words after rolling shorter segments into their longest parent with the same Bible-wide occurrence count.</p>
  <div class="verse-column-controls"><button data-action="verse-add-filter" aria-expanded="${state.verseAddFilterOpen}"${(columns.length >= 5 && state.verseFilters.chapter != null && state.verseFilters.verse != null) || state.busy ? " disabled" : ""}>Add filter</button><span>${columns.length} of 5 additional columns</span>${state.verseFrequencySort ? '<button data-action="verse-bible-order">Restore Bible order</button>' : ""}</div>
  ${state.verseAddFilterOpen ? `<form id="verse-frequency-form"><label>Kind of filter<select id="verse-frequency-kind" aria-label="Kind of filter"><option value="words"${filterKind === "words" ? " selected" : ""}${columns.length >= 5 ? " disabled" : ""}>Count of words that occur X times</option><option value="phrases"${columns.length >= 5 ? " disabled" : ""}>Count of phrases that occur X times</option><option value="chapter"${filterKind === "chapter" ? " selected" : ""}${state.verseFilters.chapter != null ? " disabled" : ""}>Chapter number</option><option value="verse"${filterKind === "verse" ? " selected" : ""}${state.verseFilters.verse != null ? " disabled" : ""}>Verse number</option></select></label><label><span id="verse-filter-value-label">${locationKind ? (filterKind === "chapter" ? "Chapter number" : "Verse number") : "Occurrences across the Bible (X)"}</span><input id="verse-frequency-input" type="number" min="1" max="${Number.MAX_SAFE_INTEGER}" step="1" value="1" required aria-describedby="verse-add-filter-help"></label><p class="counting-note" id="verse-add-filter-help">${locationKind ? `Keep only verses whose ${filterKind} number is exactly this value.` : "Add a column counting words or phrases with this Bible-wide occurrence count."}</p><button type="submit" class="primary">Add</button><button type="button" data-action="verse-add-filter">Cancel</button></form>` : ""}
  <p class="counting-note" id="verse-frequency-help">X is the total occurrence count across the whole Bible, ignoring case and punctuation. Word columns count appearances in the verse, including repetitions. Phrase columns count distinct consecutive phrases of 2–90 words in the verse, after rolling shorter segments into their longest parent with the same Bible-wide occurrence count. Click a column heading for descending order; click again for ascending order.</p>
  ${page ? `<div class="result-summary" role="status"><strong>${page.total.toLocaleString()} verses</strong><span>${page.total ? state.verseOffset + 1 : 0}–${state.verseOffset + page.entries.length} of ${page.total.toLocaleString()}</span></div>` : state.busy ? '<p role="status" class="notice">Opening verses…</p>' : ""}
  <div class="verse-catalogue-scroll"><div class="verse-catalogue${columns.length ? " has-frequency-columns" : ""}" style="--frequency-columns:${columns.length}">${headers}
  ${page ? (page.total ? `<div class="verse-table">${page.entries.map((entry) => `<button class="verse-row" ${verseButton(entry.verse)}><span><strong>${escape(reference(entry.verse))}</strong><span class="scripture">${escape(entry.verse.text)}</span></span><span>${entry.words}</span><span>${entry.letters}</span><span>${entry.phrases.toLocaleString()}</span>${columns.map(({ frequency, index, kind }) => `<span class="verse-frequency-value" data-frequency="${frequency}" data-frequency-kind="${kind}">${(kind === "words" ? entry.frequencyCounts : entry.phraseFrequencyCounts)?.[index] ?? 0}</span>`).join("")}</button>`).join("")}</div>` : '<p class="notice">No verses match your search and counts. Clear or change a filter to see more verses.</p>') : ""}</div></div>
  ${page?.total ? `<div class="chapter-navigation"><button data-action="verses-previous"${state.verseOffset === 0 || state.busy ? " disabled" : ""}>← Previous verses</button><span>Page ${Math.floor(state.verseOffset / pageSize) + 1}</span><button data-action="verses-next"${state.verseOffset + pageSize >= page.total || state.busy ? " disabled" : ""}>Next verses →</button></div>` : ""}
  </section>`;
};
export const verseDetailView = (state: State): string => {
  const detail = state.verseDetail;
  const heading = state.selectedVerse
    ? `${state.selectedVerse.book} ${state.selectedVerse.chapter}:${state.selectedVerse.verse}`
    : "Verse";
  return `<section class="search-page verse-detail-page"><div class="verse-back-links">${state.verseReturnNumber == null ? '<button data-page="verses">← Back to Verses</button>' : `<button data-number="${state.verseReturnNumber}" data-number-return="true">← Back to ${state.verseReturnNumber.toLocaleString()}</button>`}<button data-action="verse-reader">Read in chapter →</button></div><div class="eyebrow">A VERSE IN THE BIBLE</div><h1>${escape(heading)}</h1>
  ${
    state.busy
      ? '<p role="status" class="notice">Opening verse details…</p>'
      : detail
        ? `<dl class="book-statistics"><div><dt>Words in verse</dt><dd>${detail.words}</dd></div><div><dt>Letters in verse</dt><dd>${detail.letters}</dd></div><div><dt>Distinct phrases</dt><dd>${detail.phrases.toLocaleString()}</dd></div></dl>
  <p class="scripture interactive-verse">${clickableText(detail.verse.text, detail.wordParts)}</p><p class="counting-note">Choose any word to open its Word page.</p>
  ${contextWordTable("Words in this verse", "verse-words", detail.wordEntries, state.verseWordSort)}
  <h2>Phrases in this verse</h2><p class="counting-note">Phrases of 2–90 words with original capitalization and punctuation. Click a header to sort; click it again to reverse. Shorter phrases with the same Bible-wide occurrence count as a containing phrase are rolled into the longest containing phrase. Occurrences and Books cover the whole Bible.</p>
  <div class="result-summary" role="status"><strong>${detail.phrases.toLocaleString()} phrases</strong><span>${detail.phraseResults.total ? state.versePhraseOffset + 1 : 0}–${state.versePhraseOffset + detail.phraseResults.entries.length} of ${detail.phraseResults.total.toLocaleString()}</span></div>
  ${detail.phraseResults.total ? `<div class="verse-phrase-table">${contextPhraseHeader("verse-phrases", state.versePhraseSort)}${detail.phraseResults.entries.map((entry) => contextPhraseRow(entry)).join("")}</div><div class="chapter-navigation"><button data-action="verse-phrases-previous"${state.versePhraseOffset === 0 ? " disabled" : ""}>← Previous phrases</button><span>Page ${Math.floor(state.versePhraseOffset / pageSize) + 1}</span><button data-action="verse-phrases-next"${state.versePhraseOffset + pageSize >= detail.phraseResults.total ? " disabled" : ""}>Next phrases →</button></div>` : '<p class="notice">This verse has no phrases of two or more words.</p>'}`
        : ""
  }</section>`;
};
