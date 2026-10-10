import { escape } from "./highlight";
import { pageSize, reference, type State } from "./model";

export const wordsView = (state: State): string => {
  const page = state.wordResults;
  return `<section class="search-page words-page"><div class="eyebrow">EXPLORE EVERY WORD</div><h1>Words</h1>
    <p class="intro">Browse every distinct Bible word alphabetically. Counts include all appearances, without regard to case.</p>
    <form id="words-form"><div class="search-box"><input name="wordText" id="word-filter" aria-label="Filter the word list" placeholder="Filter words, e.g. faith" value="${escape(state.wordText)}" maxlength="250"><button class="primary" type="submit">Search words →</button></div><div class="word-count-filters">
      <label${state.wordFilter === "books" || state.wordBooks != null ? "" : " hidden"}>Exactly this many books<input id="word-books-filter" name="wordBooks" type="number" min="1" max="66" step="1" placeholder="Any number" value="${state.wordBooks ?? ""}"></label>
      <label${state.wordFilter === "count" || state.wordCount != null ? "" : " hidden"}>Exactly this many appearances<input id="word-count-filter" name="wordCount" type="number" min="1" step="1" placeholder="Any number" value="${state.wordCount ?? ""}"></label>
    </div></form>
    <p class="counting-note">Filter by all or part of a word. Click Books or Appearances to enter an exact count, then press Enter or Search words. Clear a count to remove that filter.</p>
    <div class="word-table-heading"><span>Word</span><button type="button" data-word-filter="count" aria-expanded="${state.wordFilter === "count" || state.wordCount != null}">Appearances${state.wordCount == null ? "" : ` = ${state.wordCount}`}</button><button type="button" data-word-filter="books" aria-expanded="${state.wordFilter === "books" || state.wordBooks != null}">Books${state.wordBooks == null ? "" : ` = ${state.wordBooks}`}</button></div>
    ${
      state.busy
        ? '<p class="notice" role="status">Loading words…</p>'
        : page
          ? `<div class="result-summary" role="status"><strong>${page.total.toLocaleString()} distinct words</strong><span>${page.total ? state.wordOffset + 1 : 0}–${state.wordOffset + page.entries.length} of ${page.total.toLocaleString()}</span></div>
      ${
        page.total
          ? `<div class="word-table">${page.entries.map((entry) => `<button class="word-row" data-word="${escape(entry.word)}" aria-label="${escape(entry.word)}, ${entry.count.toLocaleString()} appearances in ${entry.books} books"><span class="scripture">${escape(entry.word)}</span><span>${entry.count.toLocaleString()}</span><span>${entry.books}</span></button>`).join("")}</div>
      <div class="chapter-navigation"><button data-action="words-previous"${state.wordOffset === 0 ? " disabled" : ""}>← Previous words</button><span>Page ${Math.floor(state.wordOffset / pageSize) + 1}</span><button data-action="words-next"${state.wordOffset + pageSize >= page.total ? " disabled" : ""}>Next words →</button></div>`
          : '<p class="notice">No words match your search.</p>'
      }`
          : ""
    }
  </section>`;
};

export const wordDetailView = (state: State): string => {
  const word = state.wordDetail;
  return `<section class="search-page word-detail-page"><button data-page="words">← Back to Words</button><div class="eyebrow">WORD IN THE BIBLE</div><h1 class="scripture">${escape(state.selectedWord)}</h1>
    ${
      state.busy
        ? '<p class="notice" role="status">Loading word details…</p>'
        : word
          ? `<dl class="book-statistics"><div><dt>Appearances in the Bible</dt><dd>${word.count.toLocaleString()}</dd></div><div><dt>Books containing this word</dt><dd>${word.books.length}</dd></div><div><dt>Letters in the word</dt><dd>${word.letters}</dd></div></dl>
    <p class="counting-note">Letters exclude apostrophes, punctuation, and digits. Each repeated appearance is counted.</p>
    <h2>First mention</h2><button class="result" data-book="${escape(word.firstMention.book)}" data-chapter="${word.firstMention.chapter}" data-verse="${word.firstMention.number}"><span class="result-reference">${escape(reference(word.firstMention))} ↗</span><span class="scripture">${escape(word.firstMention.text)}</span></button>
    <h2>Books containing “${escape(word.word)}”</h2><p class="counting-note">Books are listed in Bible order. Choose a book to see this word’s verses.</p>
    <ul class="word-book-list">${word.books.map((book) => `<li><button data-action="word-verses" data-word-book="${escape(book.name)}"><span>${escape(book.name)}</span><span>${book.count.toLocaleString()} appearances →</span></button></li>`).join("")}</ul><button data-action="word-verses">See all verses →</button>`
          : ""
    }
  </section>`;
};
