import "./style.css";
import * as api from "./api";
import {
  adjacent,
  initialState,
  pageSize,
  reduce,
  type Action,
  type Location,
  type Query,
  type OccurrenceQuery,
  type State,
  type PhraseFilters,
  type PhraseFilterField,
  type DetailSort,
  type VerseFilters,
} from "./model";
import { view, presentationControls } from "./view";
import {
  readReaderHighlights,
  saveReaderHighlights,
  highlightStatus,
  readerChapterMarkup,
} from "./reader-highlights";
import { syncOptionalControls } from "./filter-controls";

const root = document.querySelector<HTMLDivElement>("#app")!;
let state: State = {
  ...initialState,
  readerHighlightOptions: readReaderHighlights(),
};
let request = 0;
let countRequest = 0;

const dispatch = (action: Action, preservePosition = false) => {
  const main = root.querySelector<HTMLElement>("main");
  const position =
    preservePosition && main
      ? { top: main.scrollTop, left: main.scrollLeft }
      : null;
  const focused = preservePosition
    ? (document.activeElement as HTMLElement | null)
    : null;
  const sortFocus = focused?.dataset.sortOwner
    ? { owner: focused.dataset.sortOwner, field: focused.dataset.sortField }
    : null;
  state = reduce(state, action);
  root.innerHTML = view(state);
  if (position) {
    const updated = root.querySelector<HTMLElement>("main");
    if (updated) {
      updated.scrollTop = position.top;
      updated.scrollLeft = position.left;
    }
  }
  if (sortFocus) {
    [...root.querySelectorAll<HTMLButtonElement>("[data-sort-owner]")]
      .find(
        (button) =>
          button.dataset.sortOwner === sortFocus.owner &&
          button.dataset.sortField === sortFocus.field,
      )
      ?.focus({ preventScroll: true });
  }
};
// Adjust presentation in place so unsent filters and scroll position survive.
const adjustPresentation = (action: Action) => {
  state = reduce(state, action);
  const layout = root.querySelector<HTMLElement>(".layout");
  layout?.style.setProperty("--scripture-size", `${state.size}px`);
  layout?.style.setProperty("--presentation-width", `${state.width}px`);
  const controls = root.querySelector(".presentation-controls");
  if (controls) controls.innerHTML = presentationControls(state);
};
const readPhraseFilters = (): PhraseFilters => ({
  ...state.phraseFilters,
  text:
    root.querySelector<HTMLInputElement>("#phrase-search")?.value ??
    state.phraseFilters.text ??
    "",
  partial:
    root.querySelector<HTMLInputElement>("#phrase-partial")?.checked ??
    state.phraseFilters.partial ??
    false,
  ...Object.fromEntries(
    (["words", "letters", "occurrences", "books"] as const).map((field) => {
      const input = root.querySelector<HTMLInputElement>(
        `#phrase-${field}-filter`,
      );
      return [
        field,
        input?.value && Number.isFinite(input.valueAsNumber)
          ? input.valueAsNumber
          : null,
      ];
    }),
  ),
});
const refreshHighlightStatus = () => {
  const status = root.querySelector("#highlight-save-status");
  if (status) {
    status.textContent = highlightStatus(state.highlightSaveStatus);
    status.setAttribute(
      "role",
      state.highlightSaveStatus === "error" ? "alert" : "status",
    );
  }
};
const updateReaderHighlights = () => {
  const form = root.querySelector<HTMLFormElement>("#reader-highlights-form");
  if (!form) return;
  const data = new FormData(form);
  const old = state.readerHighlightOptions;
  const rule = (key: "exclusive" | "firstMention" | "occurrences") => ({
    enabled: data.has(key),
    color: String(data.get(`${key}Color`) ?? old[key].color),
  });
  const rawCount =
    root.querySelector<HTMLInputElement>("#highlight-count")?.valueAsNumber;
  const count =
    rawCount && Number.isSafeInteger(rawCount) && rawCount > 0
      ? rawCount
      : old.occurrences.count;
  state = reduce(state, {
    type: "reader-highlight-options",
    options: {
      exclusive: rule("exclusive"),
      firstMention: rule("firstMention"),
      occurrences: { ...rule("occurrences"), count },
    },
  });
  const countInput = root.querySelector<HTMLInputElement>("#highlight-count");
  if (countInput)
    countInput.disabled = !state.readerHighlightOptions.occurrences.enabled;
  const chapter = root.querySelector(".chapter-text");
  if (chapter) chapter.innerHTML = readerChapterMarkup(state);
  refreshHighlightStatus();
};
const toggleHighlightOptions = () => {
  const open = !state.highlightPanelOpen;
  state = reduce(state, { type: "reader-highlight-panel", open });
  const panel = root.querySelector("#reader-highlight-panel");
  panel?.classList.toggle("is-open", open);
  panel?.setAttribute("aria-hidden", String(!open));
  panel?.toggleAttribute("inert", !open);
  const toggle = root.querySelector("#highlight-options-toggle");
  toggle?.setAttribute("aria-expanded", String(open));
  const arrow = toggle?.querySelector("span");
  if (arrow) arrow.textContent = open ? "⌃" : "⌄";
};
const readVerseFilters = (): VerseFilters =>
  Object.fromEntries(
    (["words", "letters", "phrases"] as const).map((field) => {
      const input = root.querySelector<HTMLInputElement>(
        `#verse-${field}-filter`,
      );
      const value = input?.valueAsNumber;
      return [
        field,
        input?.value &&
        value != null &&
        Number.isSafeInteger(value) &&
        value >= (field === "words" ? 1 : 0)
          ? value
          : null,
      ];
    }),
  ) as VerseFilters;
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

// Only the newest request may commit: rapid chapter changes cannot render stale data.
const load = async <T>(
  effect: () => Promise<T>,
  action: (value: T) => Action,
  preservePosition = false,
): Promise<boolean> => {
  const token = ++request;
  try {
    const value = await effect();
    if (token !== request) return false;
    dispatch(action(value), preservePosition);
    return true;
  } catch (error) {
    if (token === request)
      dispatch({ type: "error", error: message(error) }, preservePosition);
    return false;
  }
};

const navigate = async (location: Location) => {
  dispatch({ type: "navigate", location });
  const loaded = await load(
    async () => {
      const [verses, highlights] = await Promise.all([
        api.chapter(location),
        api.readerHighlights(location),
      ]);
      return { verses, highlights };
    },
    ({ verses, highlights }) => ({ type: "chapter", verses, highlights }),
  );
  if (!loaded) return;
  const main = root.querySelector("main");
  if (location.verse) {
    const target = root.querySelector(`#verse-${location.verse}`);
    target?.classList.add("selected-verse");
    target?.scrollIntoView({ block: "center" });
  } else main?.scrollTo({ top: 0 });
};

const search = async (query: Query) => {
  dispatch({ type: "query", query });
  const loaded = await load(
    () => api.search(query),
    (results) => ({ type: "results", results }),
  );
  if (loaded && state.page === "search")
    root.querySelector("main")?.scrollTo({ top: 0 });
};

const phraseCounts = async (book: string, token: number) => {
  try {
    for (let length = 1; length <= 32; length++) {
      if (
        token !== countRequest ||
        state.statisticsBook !== book ||
        ![
          "books",
          "book-words",
          "book-phrases",
          "book-chapter",
          "chapter-words",
        ].includes(state.page)
      )
        return;
      const count = await api.exclusiveCount(book, length);
      if (token !== countRequest || state.statisticsBook !== book) return;
      if (
        ![
          "books",
          "book-words",
          "book-phrases",
          "book-chapter",
          "chapter-words",
        ].includes(state.page)
      )
        return;
      dispatch({ type: "phrase-count", length, count });
    }
  } catch (error) {
    if (token === countRequest)
      dispatch({ type: "phrase-counts-error", error: message(error) });
  }
};
const exclusivePhrases = async (length: number, offset = 0) => {
  const book = state.statisticsBook;
  dispatch({ type: "exclusive-phrase-query", length, offset });
  const loaded = await load(
    () => api.exclusivePhrases(book, length, offset),
    (results) => ({ type: "exclusive-phrases", results }),
  );
  if (loaded && state.page === "book-phrases")
    root.querySelector("main")?.scrollTo({ top: 0 });
};
const statistics = async (book: string) => {
  const token = ++countRequest;
  dispatch({ type: "statistics-book", book });
  const loaded = await load(
    () => api.bookStats(book),
    (statistics) => ({ type: "statistics", statistics }),
  );
  if (loaded) void phraseCounts(book, token);
};

const wordList = async (
  text = state.wordText,
  offset = state.wordOffset,
  books = state.wordBooks,
  count = state.wordCount,
) => {
  dispatch({ type: "word-query", text, offset, books, count });
  const loaded = await load(
    () => api.wordList(text, offset, books, count),
    (results) => ({ type: "word-results", results }),
  );
  if (loaded) root.querySelector("main")?.scrollTo({ top: 0 });
};
const savedPhrases = async (
  offset = state.savedPhraseOffset,
  filters = state.phraseFilters,
) => {
  dispatch({ type: "saved-phrase-query", offset, filters });
  const loaded = await load(
    () => api.savedPhrases(offset, filters),
    (results) => ({ type: "saved-phrases", results }),
  );
  if (loaded) root.querySelector("main")?.scrollTo({ top: 0 });
};
const phraseDetails = async (phrase: string, offset = 0) => {
  dispatch({ type: "phrase-select", phrase, offset });
  const loaded = await load(
    () => api.phraseDetails(phrase, offset),
    (detail) => ({ type: "phrase-detail", detail }),
  );
  if (loaded) root.querySelector("main")?.scrollTo({ top: 0 });
};
const verseList = async (
  book = state.verseBook,
  offset = state.verseOffset,
  filters = state.verseFilters,
) => {
  dispatch({ type: "verse-query", book, offset, filters });
  const loaded = await load(
    () => api.verseList(book, offset, filters),
    (results) => ({ type: "verse-results", results }),
  );
  if (loaded) root.querySelector("main")?.scrollTo({ top: 0 });
};
const verseDetails = async (
  location: Location,
  offset = 0,
  sort = state.versePhraseSort,
  preservePosition = false,
) => {
  // Keep the current lists in place while sorted rows are being read.
  if (preservePosition) dispatch({ type: "verse-sort", sort }, true);
  else dispatch({ type: "verse-select", location, offset, sort });
  const loaded = await load(
    () => api.verseDetails(location, offset, sort),
    (detail) => ({ type: "verse-detail", detail }),
    preservePosition,
  );
  if (loaded && !preservePosition)
    root.querySelector("main")?.scrollTo({ top: 0 });
};
const numberList = async (offset = state.numberOffset) => {
  dispatch({ type: "number-query", offset });
  const loaded = await load(
    () => api.numberList(offset),
    (results) => ({ type: "number-results", results }),
  );
  if (loaded) root.querySelector("main")?.scrollTo({ top: 0 });
};
const numberPhraseFilters = (number: number): PhraseFilters => ({
  words: null,
  letters: null,
  books: null,
  occurrences: number,
});
const numberVerseFilters = (number: number): VerseFilters => ({
  words: null,
  letters: number,
  phrases: null,
});
const numberProfile = async (
  number = state.selectedNumber,
  restore = false,
) => {
  if (!Number.isSafeInteger(number) || number < 0) return;
  const offset = restore ? state.numberWordOffset : 0;
  const phraseOffset = restore ? state.numberPhraseOffset : 0;
  const verseOffset = restore ? state.numberVerseOffset : 0;
  dispatch({
    type: "number-select",
    number,
    offset,
    phraseOffset,
    verseOffset,
  });
  const loaded = await load(
    async () => {
      const [words, phrases, verses] = await Promise.all([
        api.numberWords(number, offset),
        api.savedPhrases(phraseOffset, numberPhraseFilters(number)),
        api.verseList(null, verseOffset, numberVerseFilters(number)),
      ]);
      return { words, phrases, verses };
    },
    (result) => ({ type: "number-profile", ...result }),
  );
  if (loaded) root.querySelector("main")?.scrollTo({ top: 0 });
};
const numberSection = async (
  section: "words" | "phrases" | "verses",
  offset: number,
) => {
  const number = state.selectedNumber;
  dispatch({ type: "number-section-query", section, offset }, true);
  if (section === "words")
    await load(
      () => api.numberWords(number, offset),
      (results) => ({ type: "number-words", results }),
      true,
    );
  else if (section === "phrases")
    await load(
      () => api.savedPhrases(offset, numberPhraseFilters(number)),
      (results) => ({ type: "number-phrases", results }),
      true,
    );
  else
    await load(
      () => api.verseList(null, offset, numberVerseFilters(number)),
      (results) => ({ type: "number-verses", results }),
      true,
    );
};
const wordDetails = async (word: string) => {
  dispatch({ type: "word-select", word });
  const loaded = await load(
    () => api.wordDetails(word),
    (detail) => ({ type: "word-detail", detail }),
  );
  if (loaded) root.querySelector("main")?.scrollTo({ top: 0 });
};

const occurrences = async (query: OccurrenceQuery) => {
  dispatch({ type: "occurrence-query", query });
  const loaded = await load(
    () => api.occurrences(query),
    (results) => ({ type: "occurrences", results }),
  );
  if (loaded && state.page === "occurrences")
    root.querySelector(".occurrence-results-pane")?.scrollTo({ top: 0 });
};

root.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "button",
  );
  if (!button || button.disabled) return;
  if (button.dataset.action === "highlight-options-toggle") {
    toggleHighlightOptions();
    return;
  }
  if (button.dataset.page) {
    dispatch({
      type: "page",
      page: button.dataset.page as State["page"],
    });
    if (state.page === "numbers") void numberList();
    if (state.page === "verses") void verseList();
    if (state.page === "phrases") void savedPhrases();
    if (state.page === "words") void wordList();
    if (state.page === "books") void statistics(state.statisticsBook);
    if (state.page === "search")
      root.querySelector<HTMLInputElement>("#query")?.focus();
    return;
  }
  if (button.dataset.sortOwner) {
    const owner = button.dataset.sortOwner;
    const previous =
      owner === "verse-phrases"
        ? state.versePhraseSort
        : owner === "verse-words"
          ? state.verseWordSort
          : owner === "phrase-words"
            ? state.phraseWordSort
            : state.subphraseSort;
    const field = button.dataset.sortField as DetailSort["field"];
    const sort: DetailSort = {
      field,
      direction:
        previous.field === field && previous.direction === "asc"
          ? "desc"
          : "asc",
    };
    if (owner === "verse-phrases" && state.selectedVerse)
      void verseDetails(state.selectedVerse, 0, sort, true);
    if (owner === "verse-words")
      dispatch({ type: "verse-word-sort", sort }, true);
    if (owner === "phrase-words")
      dispatch({ type: "phrase-word-sort", sort }, true);
    if (owner === "subphrases")
      dispatch({ type: "subphrase-sort", sort }, true);
    return;
  }
  if (button.dataset.verseFilter) {
    dispatch(
      {
        type: "verse-filter",
        field: button.dataset.verseFilter as keyof VerseFilters,
        filters: readVerseFilters(),
      },
      true,
    );
    root
      .querySelector<HTMLInputElement>(
        `#verse-${button.dataset.verseFilter}-filter`,
      )
      ?.focus({ preventScroll: true });
    return;
  }
  if (button.dataset.verseDetail) {
    void verseDetails({
      book: button.dataset.book!,
      chapter: Number(button.dataset.chapter),
      verse: Number(button.dataset.verse),
    });
    return;
  }
  if (button.dataset.savedPhrase) {
    void phraseDetails(
      button.dataset.phraseLabel ?? button.dataset.savedPhrase,
    );
    return;
  }
  if (button.dataset.phraseFilter) {
    dispatch({
      type: "phrase-filter",
      filter: button.dataset.phraseFilter as PhraseFilterField,
      filters: readPhraseFilters(),
    });
    root
      .querySelector<HTMLInputElement>(
        `#phrase-${button.dataset.phraseFilter}-filter`,
      )
      ?.focus();
    return;
  }
  if (button.dataset.wordFilter) {
    const text =
      root.querySelector<HTMLInputElement>("#word-filter")?.value ??
      state.wordText;
    dispatch({
      type: "word-filter",
      books:
        root.querySelector<HTMLInputElement>("#word-books-filter")
          ?.valueAsNumber || null,
      count:
        root.querySelector<HTMLInputElement>("#word-count-filter")
          ?.valueAsNumber || null,
      filter: button.dataset.wordFilter as "books" | "count",
      text,
    });
    root
      .querySelector<HTMLInputElement>(
        `#word-${button.dataset.wordFilter}-filter`,
      )
      ?.focus();
    return;
  }
  if (button.dataset.numberSection) {
    root
      .querySelector(`#number-${button.dataset.numberSection}`)
      ?.scrollIntoView({ block: "start" });
    return;
  }
  if (button.dataset.number != null) {
    void numberProfile(
      Number(button.dataset.number),
      !!button.dataset.numberReturn,
    );
    return;
  }
  if (button.dataset.word) {
    void wordDetails(button.dataset.word);
    return;
  }
  if (button.dataset.statisticsChapter) {
    dispatch({
      type: "statistics-chapter",
      chapter: Number(button.dataset.statisticsChapter),
    });
    root.querySelector("main")?.scrollTo({ top: 0 });
    return;
  }
  if (button.dataset.phraseLength) {
    void exclusivePhrases(Number(button.dataset.phraseLength));
    return;
  }
  if (button.dataset.statisticsBook) {
    void statistics(button.dataset.statisticsBook);
    return;
  }
  if (button.dataset.phrase) {
    dispatch({ type: "page", page: "search" });
    void search({
      text: button.dataset.phrase,
      book: null,
      phrase: true,
      normalizedWords: true,
      includedBooks: state.occurrenceQuery.includedBooks,
      offset: 0,
    });
    return;
  }
  if (button.dataset.book) {
    void navigate({
      book: button.dataset.book,
      chapter: Number(button.dataset.chapter),
      verse: Number(button.dataset.verse),
    });
    return;
  }
  switch (button.dataset.action) {
    case "saved-phrases-previous":
      void savedPhrases(Math.max(0, state.savedPhraseOffset - pageSize));
      break;
    case "saved-phrases-next":
      void savedPhrases(state.savedPhraseOffset + pageSize);
      break;
    case "numbers-previous":
      void numberList(Math.max(0, state.numberOffset - pageSize));
      break;
    case "numbers-next":
      void numberList(state.numberOffset + pageSize);
      break;
    case "number-words-previous":
      void numberSection(
        "words",
        Math.max(0, state.numberWordOffset - pageSize),
      );
      break;
    case "number-words-next":
      void numberSection("words", state.numberWordOffset + pageSize);
      break;
    case "number-phrases-previous":
      void numberSection(
        "phrases",
        Math.max(0, state.numberPhraseOffset - pageSize),
      );
      break;
    case "number-phrases-next":
      void numberSection("phrases", state.numberPhraseOffset + pageSize);
      break;
    case "number-verses-previous":
      void numberSection(
        "verses",
        Math.max(0, state.numberVerseOffset - pageSize),
      );
      break;
    case "number-verses-next":
      void numberSection("verses", state.numberVerseOffset + pageSize);
      break;
    case "verses-previous":
      void verseList(
        state.verseBook,
        Math.max(0, state.verseOffset - pageSize),
      );
      break;
    case "verses-next":
      void verseList(state.verseBook, state.verseOffset + pageSize);
      break;
    case "subphrases-previous":
      dispatch({
        type: "subphrase-offset",
        offset: Math.max(0, state.subphraseOffset - pageSize),
      });
      break;
    case "subphrases-next":
      dispatch({
        type: "subphrase-offset",
        offset: state.subphraseOffset + pageSize,
      });
      break;
    case "verse-phrases-previous":
      if (state.selectedVerse)
        void verseDetails(
          state.selectedVerse,
          Math.max(0, state.versePhraseOffset - pageSize),
        );
      break;
    case "verse-phrases-next":
      if (state.selectedVerse)
        void verseDetails(
          state.selectedVerse,
          state.versePhraseOffset + pageSize,
        );
      break;
    case "verse-reader":
      if (state.selectedVerse) void navigate(state.selectedVerse);
      break;
    case "phrase-verses-previous":
      void phraseDetails(
        state.selectedPhrase,
        Math.max(0, state.phraseVerseOffset - pageSize),
      );
      break;
    case "phrase-verses-next":
      void phraseDetails(
        state.selectedPhrase,
        state.phraseVerseOffset + pageSize,
      );
      break;
    case "words-previous":
      void wordList(state.wordText, Math.max(0, state.wordOffset - pageSize));
      break;
    case "words-next":
      void wordList(state.wordText, state.wordOffset + pageSize);
      break;
    case "word-verses":
      dispatch({ type: "page", page: "search" });
      void search({
        text: state.selectedWord,
        book: button.dataset.wordBook ?? null,
        phrase: false,
        offset: 0,
      });
      break;
    case "phrase-counts-retry":
      void phraseCounts(state.statisticsBook, ++countRequest);
      break;
    case "phrase-previous":
    case "phrase-next":
      void exclusivePhrases(
        state.phraseLength,
        Math.max(
          0,
          state.phraseOffset +
            (button.dataset.action === "phrase-next" ? pageSize : -pageSize),
        ),
      );
      break;
    case "chapter-exclusive-words":
      dispatch({ type: "exclusive-offset", offset: 0 });
      dispatch({ type: "page", page: "chapter-words" });
      root.querySelector("main")?.scrollTo({ top: 0 });
      break;
    case "exclusive-words":
      dispatch({ type: "exclusive-offset", offset: 0 });
      dispatch({ type: "page", page: "book-words" });
      root.querySelector("main")?.scrollTo({ top: 0 });
      break;
    case "exclusive-previous":
    case "exclusive-next":
      dispatch({
        type: "exclusive-offset",
        offset:
          state.exclusiveOffset +
          (button.dataset.action === "exclusive-next" ? pageSize : -pageSize),
      });
      root.querySelector("main")?.scrollTo({ top: 0 });
      break;
    case "previous":
    case "next": {
      const location = adjacent(
        state,
        button.dataset.action === "next" ? 1 : -1,
      );
      if (location) void navigate(location);
      break;
    }
    case "smaller":
      adjustPresentation({ type: "size", size: state.size - 2 });
      break;
    case "larger":
      adjustPresentation({ type: "size", size: state.size + 2 });
      break;
    case "narrower":
      adjustPresentation({ type: "width", width: state.width - 200 });
      break;
    case "wider":
      adjustPresentation({ type: "width", width: state.width + 200 });
      break;
    case "search-previous":
      void search({
        ...state.query,
        offset: Math.max(0, state.query.offset - pageSize),
      });
      break;
    case "search-next":
      void search({ ...state.query, offset: state.query.offset + pageSize });
      break;
    case "retry":
      if (state.page === "numbers") {
        void numberList();
        break;
      }
      if (state.page === "number-detail") {
        void numberProfile(state.selectedNumber, true);
        break;
      }
      if (state.page === "verses") void verseList();
      if (state.page === "verse-detail" && state.selectedVerse)
        void verseDetails(state.selectedVerse, state.versePhraseOffset);
      if (state.page === "phrases") void savedPhrases();
      else if (state.page === "phrase-detail")
        void phraseDetails(state.selectedPhrase, state.phraseVerseOffset);
      else if (state.page === "words") void wordList();
      else if (state.page === "word-detail")
        void wordDetails(state.selectedWord);
      else if (state.page === "occurrences")
        void occurrences(state.occurrenceQuery);
      else if (state.page === "book-phrases")
        void exclusivePhrases(state.phraseLength, state.phraseOffset);
      else if (state.page === "books") void statistics(state.statisticsBook);
      else void initialize();
      break;
    case "occurrence-previous":
      void occurrences({
        ...state.occurrenceQuery,
        offset: Math.max(0, state.occurrenceQuery.offset - pageSize),
      });
      break;
    case "occurrence-next":
      void occurrences({
        ...state.occurrenceQuery,
        offset: state.occurrenceQuery.offset + pageSize,
      });
      break;
  }
});

root.addEventListener("input", (event) => {
  const input = event.target as HTMLInputElement;
  if (
    input.closest("#reader-highlights-form") &&
    (input.type === "number" || input.type === "color")
  )
    updateReaderHighlights();
});

root.addEventListener("change", (event) => {
  const control = event.target as HTMLSelectElement;
  if (control.closest("#reader-highlights-form")) {
    updateReaderHighlights();
    return;
  }
  if (control.id === "verses-book") {
    void verseList(control.value || null, 0, readVerseFilters());
    return;
  }
  if (
    (control.dataset.controls || control.id === "choose-books") &&
    control.form
  )
    syncOptionalControls(control.form);
  if (control.id === "book") void navigate({ book: control.value, chapter: 1 });
  if (control.id === "chapter")
    void navigate({
      book: state.location.book,
      chapter: Number(control.value),
    });
});

root.addEventListener("submit", (event) => {
  const form = event.target as HTMLFormElement;
  if (form.id === "reader-highlights-form") {
    event.preventDefault();
    if (!form.reportValidity()) return;
    updateReaderHighlights();
    state = reduce(state, {
      type: "reader-highlight-saved",
      status: saveReaderHighlights(state.readerHighlightOptions)
        ? "saved"
        : "error",
    });
    refreshHighlightStatus();
    return;
  }
  if (form.id === "phrases-form") {
    event.preventDefault();
    if (!form.reportValidity()) return;
    void savedPhrases(0, readPhraseFilters());
    return;
  }
  if (form.id === "verses-form") {
    event.preventDefault();
    if (!form.reportValidity()) return;
    void verseList(
      root.querySelector<HTMLSelectElement>("#verses-book")?.value || null,
      0,
      readVerseFilters(),
    );
    return;
  }
  if (form.id === "numbers-form") {
    if (!form.reportValidity()) return;
    const number =
      form.querySelector<HTMLInputElement>("#number-input")?.valueAsNumber;
    if (number != null) void numberProfile(number);
    return;
  }
  if (form.id === "words-form") {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const number = (name: string) =>
      data.get(name) ? Number(data.get(name)) : null;
    void wordList(
      String(data.get("wordText") ?? "").trim(),
      0,
      number("wordBooks"),
      number("wordCount"),
    );
    return;
  }
  if (form.id === "occurrence-form") {
    event.preventDefault();
    syncOptionalControls(form);
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    if (data.has("chooseBooks") && !data.getAll("includedBooks").length) {
      const selection = form.querySelector<HTMLInputElement>(
        "[name=includedBooks]",
      );
      selection?.setCustomValidity("Choose at least one book.");
      selection?.reportValidity();
      selection?.setCustomValidity("");
      return;
    }
    void occurrences({
      count: Number(data.get("count")),
      countUpTo: data.get("countMode") === "upTo",
      words:
        Number(
          form.querySelector<HTMLInputElement>("#occurrence-words")?.value,
        ) || state.occurrenceQuery.words,
      anyLength: data.get("mode") === "any",
      upTo: data.get("mode") === "upTo",
      books: data.get("bookMode") === "any" ? null : Number(data.get("books")),
      booksUpTo: data.get("bookMode") === "upTo",
      includedBooks: data.has("chooseBooks")
        ? data.getAll("includedBooks").map(String)
        : null,
      letters:
        data.get("letterMode") === "any" ? null : Number(data.get("letters")),
      lettersUpTo: data.get("letterMode") === "upTo",
      consecutiveVerses:
        data.get("consecutiveVersesMode") === "any"
          ? null
          : Number(data.get("consecutiveVerses")),
      consecutiveChapters:
        data.get("consecutiveChaptersMode") === "any"
          ? null
          : Number(data.get("consecutiveChapters")),
      chapterFrequency:
        data.get("chapterFrequencyMode") === "any"
          ? null
          : Number(data.get("chapterFrequency")),
      offset: 0,
    });
    return;
  }
  if (form.id !== "search-form") return;
  event.preventDefault();
  const data = new FormData(form);
  const text = String(data.get("text") ?? "").trim();
  if (!text) {
    root.querySelector<HTMLInputElement>("#query")?.focus();
    return;
  }
  void search({
    text,
    book: String(data.get("book") ?? "") || null,
    phrase: data.has("phrase"),
    partial: data.has("partial"),
    offset: 0,
  });
});

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
    event.preventDefault();
    dispatch({ type: "page", page: "search" });
    root.querySelector<HTMLInputElement>("#query")?.focus();
  }
});

const initialize = async () => {
  dispatch({ type: "busy" });
  const loaded = await load(api.catalog, (books) => ({
    type: "catalog",
    books,
  }));
  if (loaded) {
    if (state.page === "search" && state.query.text) await search(state.query);
    else await navigate(state.location);
  }
};
void initialize();
