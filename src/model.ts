export type ExclusivePhrasePage = Readonly<{
  total: number;
  entries: readonly Readonly<{ phrase: string; count: number }>[];
}>;
export type BookStats = Readonly<{
  name: string;
  words: number;
  uniqueWords: number;
  verses: number;
  mostCommon: readonly Readonly<{ word: string; count: number }>[];
  mostCommonExclusive: readonly Readonly<{ word: string; count: number }>[];
  exclusiveWords: readonly Readonly<{ word: string; count: number }>[];
}>;
export type Book = Readonly<{ name: string; chapters: number }>;
export type Verse = Readonly<{
  book: string;
  chapter: number;
  number: number;
  text: string;
}>;
export type SearchPage = Readonly<{ total: number; verses: readonly Verse[] }>;
export type Location = Readonly<{
  book: string;
  chapter: number;
  verse?: number;
}>;
export type Query = Readonly<{
  text: string;
  book: string | null;
  phrase: boolean;
  offset: number;
  normalizedWords?: boolean;
  includedBooks?: readonly string[] | null;
}>;
export type OccurrenceQuery = Readonly<{
  count: number;
  words: number;
  upTo: boolean;
  offset: number;
  books?: number | null;
  booksUpTo?: boolean;
  letters?: number | null;
  lettersUpTo?: boolean;
  consecutiveVerses?: number | null;
  consecutiveChapters?: number | null;
  chapterFrequency?: number | null;
  includedBooks?: readonly string[] | null;
}>;
export type PhraseCount = Readonly<{
  phrase: string;
  words: number;
  count: number;
  books: number;
  letters: number;
  maxVerseRun: number;
  maxChapterRun: number;
  maxChapterFrequency: number;
}>;
export type OccurrencePage = Readonly<{
  total: number;
  entries: readonly PhraseCount[];
  builtLengths: readonly number[];
  elapsedMs: number;
  builtFilters?: boolean;
}>;
export type State = Readonly<{
  page:
    | "reader"
    | "search"
    | "occurrences"
    | "books"
    | "book-words"
    | "book-phrases";
  exclusiveOffset: number;
  phraseCounts: readonly (number | null)[];
  phraseCountsError: string | null;
  phraseLength: number;
  phraseOffset: number;
  exclusivePhrases: ExclusivePhrasePage | null;
  statistics: BookStats | null;
  statisticsBook: string;
  books: readonly Book[];
  location: Location;
  verses: readonly Verse[];
  query: Query;
  results: SearchPage | null;
  occurrenceQuery: OccurrenceQuery;
  occurrences: OccurrencePage | null;
  size: number;
  busy: boolean;
  error: string | null;
}>;
export type Action =
  | { type: "phrase-count"; length: number; count: number }
  | { type: "phrase-counts-error"; error: string }
  | { type: "exclusive-phrase-query"; length: number; offset: number }
  | { type: "exclusive-phrases"; results: ExclusivePhrasePage }
  | { type: "exclusive-offset"; offset: number }
  | { type: "statistics-book"; book: string }
  | { type: "statistics"; statistics: BookStats }
  | { type: "catalog"; books: readonly Book[] }
  | { type: "navigate"; location: Location }
  | { type: "page"; page: State["page"] }
  | { type: "chapter"; verses: readonly Verse[] }
  | { type: "query"; query: Query }
  | { type: "results"; results: SearchPage }
  | { type: "occurrence-query"; query: OccurrenceQuery }
  | { type: "occurrences"; results: OccurrencePage }
  | { type: "size"; size: number }
  | { type: "busy" }
  | { type: "error"; error: string };

export const initialState: State = {
  page: "reader",
  exclusiveOffset: 0,
  phraseCounts: Array.from({ length: 32 }, () => null),
  phraseCountsError: null,
  phraseLength: 1,
  phraseOffset: 0,
  exclusivePhrases: null,
  statistics: null,
  statisticsBook: "Genesis",
  books: [],
  location: { book: "Genesis", chapter: 1 },
  verses: [],
  query: { text: "", book: null, phrase: false, offset: 0 },
  results: null,
  occurrenceQuery: { count: 7, words: 2, upTo: true, offset: 0 },
  occurrences: null,
  size: 28,
  busy: true,
  error: null,
};

// Explicit variants keep transitions exhaustive and free of side effects.
export const reduce = (state: State, action: Action): State => {
  switch (action.type) {
    case "phrase-count":
      return {
        ...state,
        phraseCounts: state.phraseCounts.map((count, index) =>
          index === action.length - 1 ? action.count : count,
        ),
      };
    case "phrase-counts-error":
      return { ...state, phraseCountsError: action.error };
    case "exclusive-phrase-query":
      return {
        ...state,
        page: "book-phrases",
        phraseLength: action.length,
        phraseOffset: action.offset,
        exclusivePhrases: null,
        busy: true,
        error: null,
      };
    case "exclusive-phrases":
      return {
        ...state,
        exclusivePhrases: action.results,
        busy: false,
        error: null,
      };

    case "exclusive-offset":
      return { ...state, exclusiveOffset: Math.max(0, action.offset) };
    case "statistics-book":
      return {
        ...state,
        statisticsBook: action.book,
        exclusiveOffset: 0,
        phraseCounts: Array.from({ length: 32 }, () => null),
        phraseCountsError: null,
        phraseLength: 1,
        phraseOffset: 0,
        exclusivePhrases: null,
        statistics: null,
        busy: true,
        error: null,
      };
    case "statistics":
      return {
        ...state,
        statistics: action.statistics,
        busy: false,
        error: null,
      };
    case "catalog":
      return { ...state, books: action.books };
    case "navigate":
      return {
        ...state,
        location: action.location,
        page: "reader",
        verses: [],
        busy: true,
        error: null,
      };
    case "page":
      return { ...state, page: action.page };
    case "chapter":
      return { ...state, verses: action.verses, busy: false, error: null };
    case "query":
      return {
        ...state,
        query: action.query,
        results: null,
        busy: true,
        error: null,
      };
    case "results":
      return { ...state, results: action.results, busy: false, error: null };
    case "occurrence-query":
      return {
        ...state,
        occurrenceQuery: action.query,
        occurrences: null,
        busy: true,
        error: null,
      };
    case "occurrences":
      return {
        ...state,
        occurrences: action.results,
        busy: false,
        error: null,
      };
    case "size":
      return { ...state, size: Math.max(20, Math.min(42, action.size)) };
    case "busy":
      return { ...state, busy: true, error: null };
    case "error":
      return { ...state, busy: false, error: action.error };
  }
};

export const bookAt = (state: State) =>
  state.books.find((book) => book.name === state.location.book);
export const adjacent = (state: State, direction: -1 | 1): Location | null => {
  const index = state.books.findIndex(
    (book) => book.name === state.location.book,
  );
  const current = state.books[index];
  if (!current) return null;
  const chapter = state.location.chapter + direction;
  if (chapter >= 1 && chapter <= current.chapters)
    return { book: current.name, chapter };
  const next = state.books[index + direction];
  return next
    ? { book: next.name, chapter: direction === 1 ? 1 : next.chapters }
    : null;
};
export const reference = (verse: Verse) =>
  `${verse.book} ${verse.chapter}:${verse.number}`;
export const pageSize = 50;
