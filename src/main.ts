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
} from "./model";
import { view } from "./view";
import { syncOptionalControls } from "./filter-controls";

const root = document.querySelector<HTMLDivElement>("#app")!;
let state = initialState;
let request = 0;
let countRequest = 0;

const dispatch = (action: Action) => {
  state = reduce(state, action);
  root.innerHTML = view(state);
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

// Only the newest request may commit: rapid chapter changes cannot render stale data.
const load = async <T>(
  effect: () => Promise<T>,
  action: (value: T) => Action,
): Promise<boolean> => {
  const token = ++request;
  try {
    const value = await effect();
    if (token !== request) return false;
    dispatch(action(value));
    return true;
  } catch (error) {
    if (token === request) dispatch({ type: "error", error: message(error) });
    return false;
  }
};

const navigate = async (location: Location) => {
  dispatch({ type: "navigate", location });
  const loaded = await load(
    () => api.chapter(location),
    (verses) => ({ type: "chapter", verses }),
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
        !["books", "book-words", "book-phrases"].includes(state.page)
      )
        return;
      const count = await api.exclusiveCount(book, length);
      if (token !== countRequest || state.statisticsBook !== book) return;
      if (!["books", "book-words", "book-phrases"].includes(state.page)) return;
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

const occurrences = async (query: OccurrenceQuery) => {
  dispatch({ type: "occurrence-query", query });
  const loaded = await load(
    () => api.occurrences(query),
    (results) => ({ type: "occurrences", results }),
  );
  if (loaded && state.page === "occurrences")
    root.querySelector("main")?.scrollTo({ top: 0 });
};

root.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "button",
  );
  if (!button || button.disabled) return;
  if (button.dataset.page) {
    dispatch({
      type: "page",
      page: button.dataset.page as State["page"],
    });
    if (state.page === "books") void statistics(state.statisticsBook);
    if (state.page === "search")
      root.querySelector<HTMLInputElement>("#query")?.focus();
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
      dispatch({ type: "size", size: state.size - 2 });
      break;
    case "larger":
      dispatch({ type: "size", size: state.size + 2 });
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
      if (state.page === "occurrences") void occurrences(state.occurrenceQuery);
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

root.addEventListener("change", (event) => {
  const control = event.target as HTMLSelectElement;
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
      words: Number(data.get("words")),
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
