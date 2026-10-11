import { escape } from "./highlight";
import { pageSize, reference, type State } from "./model";
const pager = (offset: number, total: number, prefix: string, busy = false) =>
  `<div class="chapter-navigation"><button data-action="${prefix}-previous"${busy || offset === 0 ? " disabled" : ""}>← Previous</button><span>Page ${Math.floor(offset / pageSize) + 1}</span><button data-action="${prefix}-next"${busy || offset + pageSize >= total ? " disabled" : ""}>Next →</button></div>`;
export const numbersView = (state: State): string => {
  const page = state.numberResults;
  return `<section class="search-page numbers-page"><div class="eyebrow">EXPLORE WORD COUNTS</div><h1>Numbers</h1><p class="intro">Choose a number to explore words and phrases with that many appearances, and verses with that many letters. Numbers are listed in numerical order.</p><form id="numbers-form"><div class="search-box"><input id="number-input" name="number" type="number" min="0" max="${Number.MAX_SAFE_INTEGER}" step="1" required placeholder="e.g. 22" aria-label="Number to explore"><button class="primary" type="submit">Explore number →</button></div></form>
  <div class="number-table-heading"><span>Number</span><span>Words with this many appearances</span></div>${state.busy ? '<p class="notice" role="status">Loading numbers…</p>' : page ? `<div class="result-summary" role="status"><strong>${page.total.toLocaleString()} numbers</strong><span>${page.total ? state.numberOffset + 1 : 0}–${state.numberOffset + page.entries.length} of ${page.total.toLocaleString()}</span></div><div>${page.entries.map((entry) => `<button class="number-row" data-number="${entry.number}" aria-label="Number ${entry.number.toLocaleString()}, ${entry.words.toLocaleString()} words"><span class="scripture">${entry.number.toLocaleString()}</span><span>${entry.words.toLocaleString()}</span></button>`).join("")}</div>${pager(state.numberOffset, page.total, "numbers")}` : ""}</section>`;
};

const summary = (total: number, count: number, offset: number, label: string) =>
  `<div class="result-summary" role="status"><strong>${total.toLocaleString()} ${label}</strong><span>${total ? offset + 1 : 0}–${offset + count} of ${total.toLocaleString()}</span></div>`;
export const numberDetailView = (state: State): string => {
  const words = state.numberWords;
  const phrases = state.numberPhrases;
  const verses = state.numberVerses;
  const number = state.selectedNumber;
  const n = number.toLocaleString();
  return `<section class="search-page number-detail-page"><button data-page="numbers">← Back to Numbers</button><div class="eyebrow">NUMBER PROFILE</div><h1>${n}</h1><p class="intro">Explore words and phrases that appear exactly ${n} ${number === 1 ? "time" : "times"}, and verses with exactly ${n} letters.</p>
  ${
    !words || !phrases || !verses
      ? state.busy
        ? '<p class="notice" role="status">Loading number profile…</p>'
        : ""
      : `
    <div class="number-section-links" role="group" aria-label="Number profile sections"><button data-number-section="words">Words (${words.total.toLocaleString()})</button><button data-number-section="phrases">Phrases (${phrases.total.toLocaleString()})</button><button data-number-section="verses">Verses (${verses.total.toLocaleString()})</button></div>
    <section id="number-words" class="number-words-section"><h2>Words appearing ${n} ${number === 1 ? "time" : "times"}</h2><p class="counting-note">Whole-Bible appearances, ignoring case. Words are listed alphabetically.</p>
    ${summary(words.total, words.entries.length, state.numberWordOffset, "distinct words")}
    ${words.total ? `<div class="word-table-heading"><span>Word</span><span>Appearances</span><span>Books</span></div><div class="word-table">${words.entries.map((entry) => `<button class="word-row" data-word="${escape(entry.word)}"><span class="scripture">${escape(entry.word)}</span><span>${entry.count.toLocaleString()}</span><span>${entry.books}</span></button>`).join("")}</div>${pager(state.numberWordOffset, words.total, "number-words", state.busy)}` : '<p class="notice">No words appear exactly this many times in the Bible.</p>'}</section>
    <section id="number-phrases" class="number-phrases-section"><h2>Phrases occurring ${n} ${number === 1 ? "time" : "times"}</h2><p class="counting-note">Whole-Bible occurrences of consecutive phrases of 2–32 words, ignoring case and punctuation. Phrases are listed alphabetically.</p>
    ${summary(phrases.total, phrases.entries.length, state.numberPhraseOffset, "phrases")}
    ${phrases.total ? `<div class="phrase-table-heading"><span>Phrase</span><span>Words</span><span>Letters</span><span>Occurrences</span><span>Books</span></div><div class="phrase-table">${phrases.entries.map((entry) => `<button class="phrase-row" data-saved-phrase="${escape(entry.phrase)}"><span class="scripture">${escape(entry.phrase)}</span><span>${entry.words}</span><span>${entry.letters}</span><span>${entry.occurrences.toLocaleString()}</span><span>${entry.books}</span></button>`).join("")}</div>${pager(state.numberPhraseOffset, phrases.total, "number-phrases", state.busy)}` : '<p class="notice">No phrases occur exactly this many times in the Bible.</p>'}</section>
    <section id="number-verses" class="number-verses-section"><h2>Verses with ${n} ${number === 1 ? "letter" : "letters"}</h2><p class="counting-note">Letters exclude spaces, punctuation, and digits. Verses are listed in Bible order.</p>
    ${summary(verses.total, verses.entries.length, state.numberVerseOffset, "verses")}
    ${verses.total ? `<div class="verse-table-heading"><span>Verse</span><span>Words</span><span>Letters</span><span>Phrases</span></div><div class="verse-table">${verses.entries.map((entry) => `<button class="verse-row" data-verse-detail="true" data-book="${escape(entry.verse.book)}" data-chapter="${entry.verse.chapter}" data-verse="${entry.verse.number}"><span><strong>${escape(reference(entry.verse))}</strong><span class="scripture">${escape(entry.verse.text)}</span></span><span>${entry.words}</span><span>${entry.letters}</span><span>${entry.phrases.toLocaleString()}</span></button>`).join("")}</div>${pager(state.numberVerseOffset, verses.total, "number-verses", state.busy)}` : '<p class="notice">No verses contain exactly this many letters.</p>'}</section>
  `
  }</section>`;
};
