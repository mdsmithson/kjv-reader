export type VerseFrequencySort = Readonly<{
  kind?: "words" | "phrases";
  frequency: number;
  direction: "asc" | "desc";
}>;
export type NumberPage = Readonly<{
  total: number;
  entries: readonly Readonly<{ number: number; words: number }>[];
}>;
export type VerseFilters = Readonly<{
  words: number | null;
  letters: number | null;
  phrases: number | null;
}>;
export type ReaderHighlightKind =
  "exclusive" | "firstMention" | "lastMention" | "wordCount" | "phraseCount";
export type ReaderHighlightRule = Readonly<{
  id: string;
  kind: ReaderHighlightKind;
  enabled: boolean;
  color: string;
  count: number;
}>;
export type ReaderHighlightOptions = readonly ReaderHighlightRule[];
export type ReaderHighlightWord = Readonly<{
  start: number;
  end: number;
  word: string;
  count: number;
  exclusive: boolean;
  firstMention: boolean;
  lastMention: boolean;
}>;
export type ReaderHighlightPhrase = Readonly<{
  start: number;
  end: number;
  count: number;
}>;
export type ReaderChapterHighlights = Readonly<{
  book: string;
  chapter: number;
  verses: readonly Readonly<{
    number: number;
    words: readonly ReaderHighlightWord[];
    phrases: readonly ReaderHighlightPhrase[];
  }>[];
}>;
export const defaultReaderHighlights: ReaderHighlightOptions = [];
export type DetailSort = Readonly<{
  field: "phrase" | "word" | "occurrences" | "letters" | "books";
  direction: "asc" | "desc";
}>;
export type ContextWord = Readonly<{
  word: string;
  display: string;
  occurrences: number;
  letters: number;
  books: number;
}>;
export type VerseSummary = Readonly<{
  frequencyCounts?: readonly number[];
  phraseFrequencyCounts?: readonly number[];
  verse: Verse;
  words: number;
  letters: number;
  phrases: number;
}>;
export type VersePage = Readonly<{
  total: number;
  entries: readonly VerseSummary[];
}>;
export type VerseDetail = VerseSummary &
  Readonly<{
    wordParts: readonly Readonly<{
      start: number;
      end: number;
      word: string;
    }>[];
    phraseResults: SavedPhrasePage;
    wordEntries: readonly ContextWord[];
  }>;
export type SavedPhrase = Readonly<{
  phrase: string;
  display?: string;
  words: number;
  letters: number;
  books: number;
  occurrences: number;
}>;
export type PhraseFilters = Readonly<{
  text?: string;
  partial?: boolean;
  exact?: boolean;
  words: number | null;
  letters: number | null;
  occurrences: number | null;
  books: number | null;
}>;
export type PhraseFilterField = Exclude<
  keyof PhraseFilters,
  "text" | "partial" | "exact"
>;
export type SavedPhrasePage = Readonly<{
  total: number;
  entries: readonly SavedPhrase[];
  persistedLengths: readonly number[];
}>;
export type PhraseDetail = SavedPhrase &
  Readonly<{
    results: SearchPage;
    wordParts: VerseDetail["wordParts"];
    wordEntries: readonly ContextWord[];
    subphraseResults: SavedPhrasePage;
    bookEntries: readonly { book: string; occurrences: number }[];
  }>;
export type WordSummary = Readonly<{
  word: string;
  count: number;
  books: number;
}>;
export type WordPage = Readonly<{
  total: number;
  entries: readonly WordSummary[];
}>;
export type WordDetail = Readonly<{
  word: string;
  count: number;
  books: readonly Readonly<{ name: string; count: number }>[];
  firstMention: Verse;
  letters: number;
}>;
export type ExclusivePhrasePage = Readonly<{
  total: number;
  entries: readonly Readonly<{ phrase: string; count: number }>[];
}>;
export type ChapterStats = Readonly<{
  chapter: number;
  words: number;
  uniqueWords: number;
  exclusiveWords: readonly Readonly<{ word: string; count: number }>[];
}>;
export type BookStats = Readonly<{
  name: string;
  words: number;
  uniqueWords: number;
  verses: number;
  mostCommon: readonly Readonly<{ word: string; count: number }>[];
  mostCommonExclusive: readonly Readonly<{ word: string; count: number }>[];
  exclusiveWords: readonly Readonly<{ word: string; count: number }>[];
  chapters: readonly ChapterStats[];
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
  partial?: boolean;
  normalizedWords?: boolean;
  includedBooks?: readonly string[] | null;
}>;
export type OccurrenceQuery = Readonly<{
  count: number;
  countUpTo?: boolean;
  anyLength?: boolean;
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
  readerHighlightOptions: ReaderHighlightOptions;
  readerHighlightData: ReaderChapterHighlights | null;
  highlightSaveStatus: "" | "unsaved" | "saved" | "error";
  versePhraseSort: DetailSort;
  verseWordSort: DetailSort;
  phraseWordSort: DetailSort;
  subphraseSort: DetailSort;
  subphraseOffset: number;
  verseBook: string | null;
  verseFilters: VerseFilters;
  verseFrequencies: readonly number[];
  versePhraseFrequencies: readonly number[];
  verseFrequencySort: VerseFrequencySort | null;
  verseAddFilterOpen: boolean;
  verseFilter: keyof VerseFilters | null;
  verseOffset: number;
  verseResults: VersePage | null;
  selectedVerse: Location | null;
  versePhraseOffset: number;
  verseDetail: VerseDetail | null;
  page:
    | "numbers"
    | "number-detail"
    | "verses"
    | "verse-detail"
    | "phrases"
    | "phrase-detail"
    | "words"
    | "word-detail"
    | "highlights"
    | "reader"
    | "search"
    | "occurrences"
    | "books"
    | "book-chapter"
    | "chapter-words"
    | "book-words"
    | "book-phrases";
  phraseFilters: PhraseFilters;
  phraseFilter: PhraseFilterField | null;
  savedPhraseOffset: number;
  savedPhrases: SavedPhrasePage | null;
  selectedPhrase: string;
  phraseVerseOffset: number;
  phraseDetail: PhraseDetail | null;
  numberOffset: number;
  numberResults: NumberPage | null;
  selectedNumber: number;
  numberWordOffset: number;
  numberWords: WordPage | null;
  numberPhraseOffset: number;
  numberVerseOffset: number;
  numberPhrases: SavedPhrasePage | null;
  numberVerses: VersePage | null;
  phraseReturnNumber: number | null;
  verseReturnNumber: number | null;
  wordReturnNumber: number | null;
  wordBooks: number | null;
  wordCount: number | null;
  wordFilter: "books" | "count" | null;
  wordText: string;
  wordOffset: number;
  wordResults: WordPage | null;
  selectedWord: string;
  wordDetail: WordDetail | null;
  exclusiveOffset: number;
  phraseCounts: readonly (number | null)[];
  phraseCountsError: string | null;
  phraseLength: number;
  phraseOffset: number;
  exclusivePhrases: ExclusivePhrasePage | null;
  statistics: BookStats | null;
  statisticsBook: string;
  statisticsChapter: number;
  books: readonly Book[];
  location: Location;
  verses: readonly Verse[];
  query: Query;
  results: SearchPage | null;
  occurrenceQuery: OccurrenceQuery;
  occurrences: OccurrencePage | null;
  size: number;
  width: number;
  busy: boolean;
  error: string | null;
}>;
export type Action =
  | { type: "verse-add-filter"; open: boolean }
  | {
      type: "verse-frequency-columns";
      frequencies: readonly number[];
      kind?: "words" | "phrases";
    }
  | { type: "verse-frequency-sort"; sort: VerseFrequencySort | null }
  | { type: "number-query"; offset: number }
  | { type: "number-results"; results: NumberPage }
  | {
      type: "number-select";
      number: number;
      offset: number;
      phraseOffset: number;
      verseOffset: number;
    }
  | {
      type: "number-profile";
      words: WordPage;
      phrases: SavedPhrasePage;
      verses: VersePage;
    }
  | {
      type: "number-section-query";
      section: "words" | "phrases" | "verses";
      offset: number;
    }
  | { type: "number-phrases"; results: SavedPhrasePage }
  | { type: "number-verses"; results: VersePage }
  | { type: "number-words"; results: WordPage }
  | { type: "reader-highlight-options"; options: ReaderHighlightOptions }
  | { type: "reader-highlight-saved"; status: "saved" | "error" }
  | { type: "verse-sort"; sort: DetailSort }
  | { type: "verse-word-sort"; sort: DetailSort }
  | { type: "phrase-word-sort"; sort: DetailSort }
  | { type: "subphrase-sort"; sort: DetailSort }
  | { type: "subphrase-offset"; offset: number }
  | {
      type: "verse-query";
      book: string | null;
      offset: number;
      filters: VerseFilters;
      preserveResults?: boolean;
    }
  | { type: "verse-filter"; field: keyof VerseFilters; filters: VerseFilters }
  | { type: "verse-results"; results: VersePage }
  | {
      type: "verse-select";
      location: Location;
      offset: number;
      sort: DetailSort;
    }
  | { type: "verse-detail"; detail: VerseDetail }
  | { type: "saved-phrase-query"; offset: number; filters: PhraseFilters }
  | { type: "phrase-filter"; filter: PhraseFilterField; filters: PhraseFilters }
  | { type: "saved-phrases"; results: SavedPhrasePage }
  | { type: "phrase-select"; phrase: string; offset: number }
  | { type: "phrase-detail"; detail: PhraseDetail }
  | {
      type: "word-filter";
      filter: "books" | "count";
      text: string;
      books: number | null;
      count: number | null;
    }
  | {
      type: "word-query";
      text: string;
      offset: number;
      books: number | null;
      count: number | null;
    }
  | { type: "word-results"; results: WordPage }
  | { type: "word-select"; word: string }
  | { type: "word-detail"; detail: WordDetail }
  | { type: "statistics-chapter"; chapter: number }
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
  | {
      type: "chapter";
      verses: readonly Verse[];
      highlights: ReaderChapterHighlights;
    }
  | { type: "query"; query: Query }
  | { type: "results"; results: SearchPage }
  | { type: "occurrence-query"; query: OccurrenceQuery }
  | { type: "occurrences"; results: OccurrencePage }
  | { type: "size"; size: number }
  | { type: "width"; width: number }
  | { type: "busy" }
  | { type: "error"; error: string };

export const initialState: State = {
  page: "reader",
  readerHighlightOptions: defaultReaderHighlights,
  readerHighlightData: null,
  highlightSaveStatus: "",
  versePhraseSort: { field: "phrase", direction: "asc" },
  verseWordSort: { field: "word", direction: "asc" },
  phraseWordSort: { field: "word", direction: "asc" },
  subphraseSort: { field: "phrase", direction: "asc" },
  subphraseOffset: 0,
  verseBook: null,
  verseFilters: { words: null, letters: null, phrases: null },
  verseFrequencies: [],
  versePhraseFrequencies: [],
  verseFrequencySort: null,
  verseAddFilterOpen: false,
  verseFilter: null,
  verseOffset: 0,
  verseResults: null,
  selectedVerse: null,
  versePhraseOffset: 0,
  verseDetail: null,
  phraseFilters: { words: null, letters: null, occurrences: null, books: null },
  phraseFilter: null,
  savedPhraseOffset: 0,
  savedPhrases: null,
  selectedPhrase: "",
  phraseVerseOffset: 0,
  phraseDetail: null,
  numberOffset: 0,
  numberResults: null,
  selectedNumber: 1,
  numberWordOffset: 0,
  numberWords: null,
  numberPhraseOffset: 0,
  numberVerseOffset: 0,
  numberPhrases: null,
  numberVerses: null,
  phraseReturnNumber: null,
  verseReturnNumber: null,
  wordReturnNumber: null,
  wordBooks: null,
  wordCount: null,
  wordFilter: null,
  wordText: "",
  wordOffset: 0,
  wordResults: null,
  selectedWord: "",
  wordDetail: null,
  exclusiveOffset: 0,
  phraseCounts: Array.from({ length: 32 }, () => null),
  phraseCountsError: null,
  phraseLength: 1,
  phraseOffset: 0,
  exclusivePhrases: null,
  statistics: null,
  statisticsBook: "Genesis",
  statisticsChapter: 1,
  books: [],
  location: { book: "Genesis", chapter: 1 },
  verses: [],
  query: { text: "", book: null, phrase: false, offset: 0 },
  results: null,
  occurrenceQuery: { count: 7, words: 2, upTo: true, offset: 0 },
  occurrences: null,
  size: 28,
  width: 900,
  busy: true,
  error: null,
};

// Explicit variants keep transitions exhaustive and free of side effects.
export const reduce = (state: State, action: Action): State => {
  switch (action.type) {
    case "reader-highlight-options":
      return {
        ...state,
        readerHighlightOptions: action.options,
        highlightSaveStatus: "unsaved",
      };
    case "reader-highlight-saved":
      return { ...state, highlightSaveStatus: action.status };
    case "verse-sort":
      return {
        ...state,
        versePhraseSort: action.sort,
        versePhraseOffset: 0,
        error: null,
      };
    case "verse-word-sort":
      return { ...state, verseWordSort: action.sort };
    case "phrase-word-sort":
      return { ...state, phraseWordSort: action.sort };
    case "subphrase-sort":
      return { ...state, subphraseSort: action.sort, subphraseOffset: 0 };
    case "subphrase-offset":
      return { ...state, subphraseOffset: action.offset };
    case "verse-add-filter":
      return { ...state, verseAddFilterOpen: action.open };
    case "verse-frequency-columns": {
      const kind = action.kind ?? "words";
      return {
        ...state,
        [kind === "words" ? "verseFrequencies" : "versePhraseFrequencies"]:
          action.frequencies,
        verseAddFilterOpen: false,
        verseFrequencySort:
          state.verseFrequencySort &&
          (state.verseFrequencySort.kind ?? "words") === kind &&
          !action.frequencies.includes(state.verseFrequencySort.frequency)
            ? null
            : state.verseFrequencySort,
      };
    }
    case "verse-frequency-sort":
      return { ...state, verseFrequencySort: action.sort };
    case "verse-filter":
      return {
        ...state,
        verseFilter: state.verseFilter === action.field ? null : action.field,
        verseFilters: action.filters,
      };
    case "verse-query":
      return {
        ...state,
        page: "verses",
        verseBook: action.book,
        verseFilters: action.filters,
        verseOffset: action.offset,
        verseResults: action.preserveResults ? state.verseResults : null,
        busy: true,
        error: null,
      };
    case "verse-results":
      return {
        ...state,
        verseResults: action.results,
        busy: false,
        error: null,
      };
    case "verse-select":
      return {
        ...state,
        page: "verse-detail",
        verseReturnNumber:
          state.page === "number-detail"
            ? state.selectedNumber
            : state.page === "verse-detail"
              ? state.verseReturnNumber
              : null,
        selectedVerse: action.location,
        versePhraseOffset: action.offset,
        versePhraseSort: action.sort,
        verseDetail: null,
        busy: true,
        error: null,
      };
    case "verse-detail":
      return { ...state, verseDetail: action.detail, busy: false, error: null };
    case "phrase-filter":
      return {
        ...state,
        phraseFilter:
          state.phraseFilter === action.filter ? null : action.filter,
        phraseFilters: action.filters,
      };
    case "saved-phrase-query":
      return {
        ...state,
        page: "phrases",
        savedPhraseOffset: action.offset,
        phraseFilters: action.filters,
        savedPhrases: null,
        busy: true,
        error: null,
      };
    case "saved-phrases":
      return {
        ...state,
        savedPhrases: action.results,
        busy: false,
        error: null,
      };
    case "phrase-select":
      return {
        ...state,
        page: "phrase-detail",
        phraseReturnNumber:
          state.page === "number-detail"
            ? state.selectedNumber
            : state.page === "phrase-detail" &&
                state.selectedPhrase === action.phrase
              ? state.phraseReturnNumber
              : null,
        selectedPhrase: action.phrase,
        subphraseOffset:
          state.selectedPhrase === action.phrase ? state.subphraseOffset : 0,
        phraseVerseOffset: action.offset,
        phraseDetail: null,
        busy: true,
        error: null,
      };
    case "phrase-detail":
      return {
        ...state,
        phraseDetail: action.detail,
        busy: false,
        error: null,
      };
    case "number-query":
      return {
        ...state,
        page: "numbers",
        numberOffset: action.offset,
        numberResults: null,
        busy: true,
        error: null,
      };
    case "number-results":
      return {
        ...state,
        numberResults: action.results,
        busy: false,
        error: null,
      };
    case "number-select":
      return {
        ...state,
        page: "number-detail",
        selectedNumber: action.number,
        numberWordOffset: action.offset,
        numberPhraseOffset: action.phraseOffset,
        numberVerseOffset: action.verseOffset,
        numberWords: null,
        numberPhrases: null,
        numberVerses: null,
        busy: true,
        error: null,
      };
    case "number-profile":
      return {
        ...state,
        numberWords: action.words,
        numberPhrases: action.phrases,
        numberVerses: action.verses,
        busy: false,
        error: null,
      };
    case "number-section-query":
      return {
        ...state,
        [action.section === "words"
          ? "numberWordOffset"
          : action.section === "phrases"
            ? "numberPhraseOffset"
            : "numberVerseOffset"]: action.offset,
        busy: true,
        error: null,
      };
    case "number-phrases":
      return {
        ...state,
        numberPhrases: action.results,
        busy: false,
        error: null,
      };
    case "number-verses":
      return {
        ...state,
        numberVerses: action.results,
        busy: false,
        error: null,
      };
    case "number-words":
      return {
        ...state,
        numberWords: action.results,
        busy: false,
        error: null,
      };
    case "word-filter":
      return {
        ...state,
        wordFilter: state.wordFilter === action.filter ? null : action.filter,
        wordText: action.text,
        wordBooks: action.books,
        wordCount: action.count,
      };
    case "word-query":
      return {
        ...state,
        page: "words",
        wordText: action.text,
        wordBooks: action.books,
        wordCount: action.count,
        wordOffset: action.offset,
        wordResults: null,
        busy: true,
        error: null,
      };
    case "word-results":
      return {
        ...state,
        wordResults: action.results,
        busy: false,
        error: null,
      };
    case "word-select":
      return {
        ...state,
        page: "word-detail",
        selectedWord: action.word,
        wordReturnNumber:
          state.page === "number-detail" ? state.selectedNumber : null,
        wordDetail: null,
        busy: true,
        error: null,
      };
    case "word-detail":
      return { ...state, wordDetail: action.detail, busy: false, error: null };
    case "statistics-chapter":
      return {
        ...state,
        page: "book-chapter",
        statisticsChapter: action.chapter,
        exclusiveOffset: 0,
      };
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
        statisticsChapter: 1,
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
        readerHighlightData: null,
        busy: true,
        error: null,
      };
    case "page":
      return { ...state, page: action.page };
    case "chapter":
      return {
        ...state,
        verses: action.verses,
        readerHighlightData: action.highlights,
        busy: false,
        error: null,
      };
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
    case "width":
      return { ...state, width: Math.max(700, Math.min(1900, action.width)) };
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
export const maxPhraseWords = 32;
