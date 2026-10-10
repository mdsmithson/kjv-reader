import { escape } from "./highlight";
import type {
  ContextWord,
  DetailSort,
  SavedPhrase,
  VerseDetail,
} from "./model";
export const sortHeader = (
  owner: string,
  field: DetailSort["field"],
  label: string,
  sort: DetailSort,
) => {
  const active = sort.field === field;
  return `<span role="columnheader" aria-sort="${active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}"><button data-sort-owner="${owner}" data-sort-field="${field}" aria-label="Sort ${owner.replaceAll("-", " ")} by ${label}${active ? `, ${sort.direction === "asc" ? "ascending" : "descending"}` : ""}">${label} ${active ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}</button></span>`;
};
export const sorted = <T extends ContextWord | SavedPhrase>(
  entries: readonly T[],
  sort: DetailSort,
): T[] =>
  [...entries].sort((a, b) => {
    const field = sort.field;
    const keyA =
      field === "word"
        ? (a as ContextWord).word
        : field === "phrase"
          ? (a as SavedPhrase).phrase
          : a[field];
    const keyB =
      field === "word"
        ? (b as ContextWord).word
        : field === "phrase"
          ? (b as SavedPhrase).phrase
          : b[field];
    const compare =
      typeof keyA === "string" && typeof keyB === "string"
        ? keyA < keyB
          ? -1
          : keyA > keyB
            ? 1
            : 0
        : Number(keyA) - Number(keyB);
    const nameA = "word" in a ? a.word : a.phrase;
    const nameB = "word" in b ? b.word : b.phrase;
    const tie = nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
    return (compare || tie) * (sort.direction === "asc" ? 1 : -1);
  });
export const clickableText = (
  text: string,
  parts: VerseDetail["wordParts"],
) => {
  let cursor = 0;
  let content = "";
  for (const part of parts) {
    content += escape(text.slice(cursor, part.start));
    content += `<button class="verse-word" data-word="${escape(part.word)}" aria-label="Explore word ${escape(part.word)}">${escape(text.slice(part.start, part.end))}</button>`;
    cursor = part.end;
  }
  return content + escape(text.slice(cursor));
};
export const contextWordTable = (
  title: string,
  owner: string,
  entries: readonly ContextWord[],
  sort: DetailSort,
) =>
  `<section class="context-words"><h2>${title}</h2><p class="counting-note">Each word appears once. Counts cover the whole Bible. Click a header to sort; click it again to reverse.</p><div class="context-word-table"><div class="context-word-heading">${sortHeader(owner, "word", "Word", sort)}${sortHeader(owner, "occurrences", "Occurrences", sort)}${sortHeader(owner, "letters", "Letters", sort)}${sortHeader(owner, "books", "Books", sort)}</div>${sorted(
    entries,
    sort,
  )
    .map(
      (entry) =>
        `<button class="context-word-row" data-word="${escape(entry.word)}"><span class="scripture">${escape(entry.display)}</span><span>${entry.occurrences.toLocaleString()}</span><span>${entry.letters}</span><span>${entry.books}</span></button>`,
    )
    .join("")}</div></section>`;
export const contextPhraseHeader = (owner: string, sort: DetailSort) =>
  `<div class="verse-phrase-heading">${sortHeader(owner, "phrase", "Phrase", sort)}${sortHeader(owner, "occurrences", "Occurrences", sort)}${sortHeader(owner, "books", "Books", sort)}</div>`;
export const contextPhraseRow = (entry: SavedPhrase) =>
  `<button class="verse-phrase-row" data-saved-phrase="${escape(entry.phrase)}" data-phrase-label="${escape(entry.display ?? entry.phrase)}"><span class="scripture">${escape(entry.display ?? entry.phrase)}</span><span>${entry.occurrences.toLocaleString()}</span><span>${entry.books}</span></button>`;
