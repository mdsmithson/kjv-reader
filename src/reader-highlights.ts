import { escape } from "./highlight";
import {
  defaultReaderHighlights,
  type ReaderHighlightOptions,
  type ReaderHighlightWord,
  type State,
  type Verse,
} from "./model";
export const highlightStorageKey = "kjv-reader:highlight-settings:v1";
const color = (value: unknown, fallback: string) =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : fallback;
export const parseReaderHighlights = (
  value: unknown,
): ReaderHighlightOptions => {
  if (!value || typeof value !== "object") return defaultReaderHighlights;
  const saved = value as Record<string, unknown>;
  if (
    saved.version !== 1 ||
    !saved.options ||
    typeof saved.options !== "object"
  )
    return defaultReaderHighlights;
  const options = saved.options as Record<string, unknown>;
  const rule = (key: "exclusive" | "firstMention" | "occurrences") => {
    const raw =
      options[key] && typeof options[key] === "object"
        ? (options[key] as Record<string, unknown>)
        : {};
    return {
      enabled: raw.enabled === true,
      color: color(raw.color, defaultReaderHighlights[key].color),
    };
  };
  const frequency =
    options.occurrences && typeof options.occurrences === "object"
      ? (options.occurrences as Record<string, unknown>)
      : {};
  return {
    exclusive: rule("exclusive"),
    firstMention: rule("firstMention"),
    occurrences: {
      ...rule("occurrences"),
      count:
        typeof frequency.count === "number" &&
        Number.isSafeInteger(frequency.count) &&
        frequency.count > 0
          ? frequency.count
          : 7,
    },
  };
};
export const readReaderHighlights = (): ReaderHighlightOptions => {
  try {
    return parseReaderHighlights(
      JSON.parse(window.localStorage.getItem(highlightStorageKey) ?? "null"),
    );
  } catch {
    return defaultReaderHighlights;
  }
};
export const saveReaderHighlights = (
  options: ReaderHighlightOptions,
): boolean => {
  try {
    window.localStorage.setItem(
      highlightStorageKey,
      JSON.stringify({ version: 1, options }),
    );
    return true;
  } catch {
    return false;
  }
};
export const highlightStatus = (status: State["highlightSaveStatus"]) =>
  status === "saved"
    ? "Highlight options saved. They apply to every chapter and will be restored when you reopen the app."
    : status === "unsaved"
      ? "Previewing changes. Save highlight options to remember them."
      : status === "error"
        ? "Unable to save highlight options. Your changes remain active for this session."
        : "Saved options apply automatically as you open other chapters.";
const background = (colors: string[]) =>
  colors.length === 1
    ? colors[0]
    : `linear-gradient(to bottom,${colors.flatMap((value, index) => [`${value} ${(index * 100) / colors.length}%`, `${value} ${((index + 1) * 100) / colors.length}%`]).join(",")})`;
const foreground = (colors: string[]) => {
  const brightness = colors.map(
    (value) =>
      0.2126 * parseInt(value.slice(1, 3), 16) +
      0.7152 * parseInt(value.slice(3, 5), 16) +
      0.0722 * parseInt(value.slice(5, 7), 16),
  );
  const dark =
    brightness.reduce((sum, value) => sum + value, 0) / brightness.length < 140;
  const mixed =
    brightness.some((value) => value < 110) &&
    brightness.some((value) => value >= 110);
  return `color:${mixed || dark ? "#ffffff" : "inherit"}${mixed ? ";text-shadow:-1px 0 #302b24,1px 0 #302b24,0 -1px #302b24,0 1px #302b24" : ""}`;
};
export const readerWordHighlights = (
  text: string,
  words: readonly ReaderHighlightWord[],
  options: ReaderHighlightOptions,
): string => {
  let cursor = 0;
  let html = "";
  for (const word of words) {
    const colors: string[] = [];
    const rules: string[] = [];
    const labels: string[] = [];
    if (options.exclusive.enabled && word.exclusive) {
      colors.push(options.exclusive.color);
      rules.push("exclusive");
      labels.push("Exclusive to this chapter");
    }
    if (options.firstMention.enabled && word.firstMention) {
      colors.push(options.firstMention.color);
      rules.push("firstMention");
      labels.push("First mention in the Bible");
    }
    if (
      options.occurrences.enabled &&
      word.count === options.occurrences.count
    ) {
      colors.push(options.occurrences.color);
      rules.push("occurrences");
      labels.push(`${word.count.toLocaleString()} appearances in the Bible`);
    }
    html += escape(text.slice(cursor, word.start));
    const original = escape(text.slice(word.start, word.end));
    html += colors.length
      ? `<mark class="reader-word-highlight" data-highlight-rules="${rules.join(" ")}" title="${escape(labels.join(" · "))}" style="background:${background(colors)};${foreground(colors)}">${original}</mark>`
      : original;
    cursor = word.end;
  }
  return html + escape(text.slice(cursor));
};
export const readerVerseMarkup = (state: State, verse: Verse) => {
  const data = state.readerHighlightData;
  const words =
    data?.book === verse.book && data.chapter === verse.chapter
      ? data.verses.find((entry) => entry.number === verse.number)?.words
      : undefined;
  const text = words
    ? readerWordHighlights(verse.text, words, state.readerHighlightOptions)
    : escape(verse.text);
  return `<button class="verse reader-verse${state.location.verse === verse.number ? " selected-verse" : ""}" id="verse-${verse.number}" data-verse-detail="true" data-book="${escape(verse.book)}" data-chapter="${verse.chapter}" data-verse="${verse.number}" aria-label="Explore ${escape(verse.book)} ${verse.chapter}:${verse.number}"><span class="verse-number">${verse.number}</span>${text}</button>`;
};
export const readerChapterMarkup = (state: State) =>
  state.verses.map((verse) => readerVerseMarkup(state, verse)).join("");
export const highlightOptionsView = (state: State) => {
  const options = state.readerHighlightOptions;
  const colors = (id: string, label: string, value: string) =>
    `<label class="highlight-color">Color<input type="color" id="highlight-${id}-color" name="${id}Color" aria-label="${label}" value="${value}"></label>`;
  return `<section class="reader-highlight-options"><button id="highlight-options-toggle" data-action="highlight-options-toggle" aria-expanded="${state.highlightPanelOpen}" aria-controls="reader-highlight-panel">Highlight options <span aria-hidden="true">${state.highlightPanelOpen ? "⌃" : "⌄"}</span></button>
  <div id="reader-highlight-panel" class="highlight-drawer${state.highlightPanelOpen ? " is-open" : ""}" aria-hidden="${!state.highlightPanelOpen}"${state.highlightPanelOpen ? "" : " inert"}><div class="highlight-drawer-inner"><form id="reader-highlights-form"><h2>Highlight:</h2>
  <div class="highlight-rule"><div><label class="checkbox"><input type="checkbox" name="exclusive"${options.exclusive.enabled ? " checked" : ""}> Exclusive words for chapter</label><p>Highlights words found only in the chapter you are reading. This follows each chapter you open.</p></div>${colors("exclusive", "Highlight color for chapter-exclusive words", options.exclusive.color)}</div>
  <div class="highlight-rule"><div><label class="checkbox"><input type="checkbox" name="firstMention"${options.firstMention.enabled ? " checked" : ""}> First mention</label><p>Highlights each word’s first appearance in the Bible.</p></div>${colors("firstMention", "Highlight color for first mentions", options.firstMention.color)}</div>
  <div class="highlight-rule"><div><label class="checkbox"><input type="checkbox" name="occurrences"${options.occurrences.enabled ? " checked" : ""}> Words that show X times</label><label class="highlight-frequency">Exactly this many times in the Bible<input id="highlight-count" name="count" type="number" min="1" step="1" max="9007199254740991" value="${options.occurrences.count}"${options.occurrences.enabled ? "" : " disabled"} required></label></div>${colors("occurrences", "Highlight color for occurrence counts", options.occurrences.color)}</div>
  <p class="counting-note">Matches whole words, ignoring case. Original spelling and punctuation stay visible. A word matching several rules shows their colors as stripes.</p>
  <button type="submit" class="primary">Save highlight options</button><p id="highlight-save-status" role="${state.highlightSaveStatus === "error" ? "alert" : "status"}">${highlightStatus(state.highlightSaveStatus)}</p>
  </form></div></div></section>`;
};
