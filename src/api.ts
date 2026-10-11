import { maxPhraseWords } from "./model";
import type {
  Book,
  WordPage,
  SavedPhrasePage,
  PhraseDetail,
  WordDetail,
  ExclusivePhrasePage,
  BookStats,
  Location,
  Query,
  SearchPage,
  Verse,
  OccurrenceQuery,
  OccurrencePage,
} from "./model";

declare global {
  interface Window {
    __TAURI__?: {
      core: {
        invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
      };
    };
  }
}

const invoke = <T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> => {
  const core = window.__TAURI__?.core;
  return core
    ? core.invoke<T>(command, args)
    : Promise.reject(new Error("Open the desktop app with npm run tauri dev."));
};

export const catalog = () => invoke<readonly Book[]>("catalog");
export const chapter = (location: Location) =>
  invoke<readonly Verse[]>("chapter", {
    book: location.book,
    chapter: location.chapter,
  });
export const search = (query: Query) => invoke<SearchPage>("search", { query });
export const occurrences = (query: OccurrenceQuery) =>
  invoke<OccurrencePage>("occurrences", {
    query: {
      ...query,
      words: query.anyLength ? maxPhraseWords : query.words,
      upTo: query.anyLength || query.upTo,
    },
  });

export const bookStats = (book: string) =>
  invoke<BookStats>("book_stats", { book });

export const exclusiveCount = (book: string, length: number) =>
  invoke<number>("exclusive_count", { book, length });
export const exclusivePhrases = (
  book: string,
  length: number,
  offset: number,
) => invoke<ExclusivePhrasePage>("exclusive_phrases", { book, length, offset });

export const wordList = (
  text: string,
  offset: number,
  books: number | null,
  count: number | null,
) => invoke<WordPage>("word_list", { text, offset, books, count });
export const wordDetails = (word: string) =>
  invoke<WordDetail>("word_details", { word });

export const savedPhrases = (
  offset: number,
  filters: import("./model").PhraseFilters,
) => invoke<SavedPhrasePage>("saved_phrases", { offset, filters });
export const phraseDetails = (phrase: string, offset: number) =>
  invoke<PhraseDetail>("phrase_details", { phrase, offset });

export const verseList = (
  book: string | null,
  offset: number,
  filters: import("./model").VerseFilters,
) =>
  invoke<import("./model").VersePage>("verse_list", { book, offset, filters });
export const verseDetails = (
  location: Location,
  offset: number,
  sort: import("./model").DetailSort,
) =>
  invoke<import("./model").VerseDetail>("verse_details", {
    query: {
      book: location.book,
      chapter: location.chapter,
      verse: location.verse,
      offset,
      sort,
    },
  });

export const readerHighlights = (location: Location) =>
  invoke<import("./model").ReaderChapterHighlights>("reader_highlights", {
    book: location.book,
    chapter: location.chapter,
  });

export const numberList = (offset: number) =>
  invoke<import("./model").NumberPage>("number_list", { offset });
export const numberWords = (number: number, offset: number) =>
  invoke<WordPage>("number_words", { number, offset });

export const verseCatalogue = (
  book: string | null,
  offset: number,
  filters: import("./model").VerseFilters,
  frequencies: readonly number[],
  sort: import("./model").VerseFrequencySort | null,
  phraseFrequencies: readonly number[] = [],
) =>
  invoke<import("./model").VersePage>("verse_catalogue", {
    query: { book, offset, filters, frequencies, sort, phraseFrequencies },
  });
