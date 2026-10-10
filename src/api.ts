import type {
  Book,
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
  invoke<OccurrencePage>("occurrences", { query });

export const bookStats = (book: string) =>
  invoke<BookStats>("book_stats", { book });

export const exclusiveCount = (book: string, length: number) =>
  invoke<number>("exclusive_count", { book, length });
export const exclusivePhrases = (
  book: string,
  length: number,
  offset: number,
) => invoke<ExclusivePhrasePage>("exclusive_phrases", { book, length, offset });
