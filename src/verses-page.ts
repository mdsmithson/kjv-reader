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
  return `<section class="search-page verses-page"><div class="eyebrow">EXPLORE EVERY VERSE</div><h1>Verses</h1><p class="intro">Browse verses in Bible order. Choose a verse to explore its words and phrases.</p>
    <label class="verse-book-filter">Within<select id="verses-book"><option value="">All books</option>${state.books.map((book) => `<option${book.name === state.verseBook ? " selected" : ""}>${escape(book.name)}</option>`).join("")}</select></label>
    <p class="counting-note">Words include repeated appearances. Letters exclude spaces, punctuation, and digits. Phrases count distinct consecutive phrases of 2–32 words.</p>
    ${
      state.busy
        ? '<p role="status" class="notice">Opening verses…</p>'
        : page
          ? `<div class="result-summary" role="status"><strong>${page.total.toLocaleString()} verses</strong><span>${page.total ? state.verseOffset + 1 : 0}–${state.verseOffset + page.entries.length} of ${page.total.toLocaleString()}</span></div>
    <div class="verse-table"><div class="verse-table-heading"><span>Verse</span><span>Words</span><span>Letters</span><span>Phrases</span></div>${page.entries.map((entry) => `<button class="verse-row" ${verseButton(entry.verse)}><span><strong>${escape(reference(entry.verse))}</strong><span class="scripture">${escape(entry.verse.text)}</span></span><span>${entry.words}</span><span>${entry.letters}</span><span>${entry.phrases.toLocaleString()}</span></button>`).join("")}</div>
    <div class="chapter-navigation"><button data-action="verses-previous"${state.verseOffset === 0 ? " disabled" : ""}>← Previous verses</button><span>Page ${Math.floor(state.verseOffset / pageSize) + 1}</span><button data-action="verses-next"${state.verseOffset + pageSize >= page.total ? " disabled" : ""}>Next verses →</button></div>`
          : ""
    }</section>`;
};
export const verseDetailView = (state: State): string => {
  const detail = state.verseDetail;
  const heading = state.selectedVerse
    ? `${state.selectedVerse.book} ${state.selectedVerse.chapter}:${state.selectedVerse.verse}`
    : "Verse";
  return `<section class="search-page verse-detail-page"><div class="verse-back-links"><button data-page="verses">← Back to Verses</button><button data-action="verse-reader">Read in chapter →</button></div><div class="eyebrow">A VERSE IN THE BIBLE</div><h1>${escape(heading)}</h1>
  ${
    state.busy
      ? '<p role="status" class="notice">Opening verse details…</p>'
      : detail
        ? `<dl class="book-statistics"><div><dt>Words in verse</dt><dd>${detail.words}</dd></div><div><dt>Letters in verse</dt><dd>${detail.letters}</dd></div><div><dt>Distinct phrases</dt><dd>${detail.phrases.toLocaleString()}</dd></div></dl>
  <p class="scripture interactive-verse">${clickableText(detail.verse.text, detail.wordParts)}</p><p class="counting-note">Choose any word to open its Word page.</p>
  ${contextWordTable("Words in this verse", "verse-words", detail.wordEntries, state.verseWordSort)}
  <h2>Phrases in this verse</h2><p class="counting-note">Phrases of 2–32 words with original capitalization and punctuation. Click a header to sort; click it again to reverse. When a phrase occurs once, shorter phrases inside it that also occur once are hidden. Occurrences and Books cover the whole Bible.</p>
  <div class="result-summary" role="status"><strong>${detail.phraseResults.total.toLocaleString()} phrases shown of ${detail.phrases.toLocaleString()}</strong><span>${detail.phraseResults.total ? state.versePhraseOffset + 1 : 0}–${state.versePhraseOffset + detail.phraseResults.entries.length} of ${detail.phraseResults.total.toLocaleString()}</span></div>
  ${detail.phraseResults.total ? `<div class="verse-phrase-table">${contextPhraseHeader("verse-phrases", state.versePhraseSort)}${detail.phraseResults.entries.map(contextPhraseRow).join("")}</div><div class="chapter-navigation"><button data-action="verse-phrases-previous"${state.versePhraseOffset === 0 ? " disabled" : ""}>← Previous phrases</button><span>Page ${Math.floor(state.versePhraseOffset / pageSize) + 1}</span><button data-action="verse-phrases-next"${state.versePhraseOffset + pageSize >= detail.phraseResults.total ? " disabled" : ""}>Next phrases →</button></div>` : '<p class="notice">This verse has no phrases of two or more words.</p>'}`
        : ""
  }</section>`;
};
