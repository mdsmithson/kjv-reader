import { escape } from "./highlight";
import {
  defaultReaderHighlights,
  type ReaderHighlightOptions,
  type ReaderHighlightWord,
  type State,
  type Verse,
} from "./model";
export const highlightStorageKey = "kjv-reader:highlight-settings:v2";
export const legacyHighlightStorageKey = "kjv-reader:highlight-settings:v1";
export const highlightKinds = [
  ["wordCount", "Words that show X times"],
  ["phraseCount", "Phrases that show X times"],
  ["lastMention", "Words that show for the last time"],
  ["firstMention", "First mention of words"],
  ["exclusive", "Exclusive words for chapter"],
] as const;
const palette = [
  "#f6d887",
  "#bad6f6",
  "#f6b8c1",
  "#b8dec1",
  "#d4c2f0",
  "#a8e4df",
  "#f8bd88",
  "#d2df93",
  "#f1bde1",
  "#c4d0ff",
];
const color = (value: unknown, fallback: string) =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : fallback;
const count = (value: unknown, fallback = 1) =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : fallback;
export const parseReaderHighlights = (
  value: unknown,
): ReaderHighlightOptions => {
  if (!value || typeof value !== "object") return defaultReaderHighlights;
  const saved = value as Record<string, unknown>;
  if (
    saved.version === 1 &&
    saved.options &&
    typeof saved.options === "object"
  ) {
    const options = saved.options as Record<string, unknown>;
    return (
      [
        ["exclusive", "exclusive", "#f6d887"],
        ["firstMention", "firstMention", "#b8dec1"],
        ["occurrences", "wordCount", "#bad6f6"],
      ] as const
    ).map(([key, kind, fallback]) => {
      const raw =
        options[key] && typeof options[key] === "object"
          ? (options[key] as Record<string, unknown>)
          : {};
      return {
        id: `legacy-${key}`,
        kind,
        enabled: raw.enabled === true,
        color: color(raw.color, fallback),
        count: count(raw.count, key === "occurrences" ? 7 : 1),
      };
    });
  }
  if (saved.version !== 2 || !Array.isArray(saved.filters))
    return defaultReaderHighlights;
  const ids = new Set<string>();
  return saved.filters
    .filter(
      (raw) =>
        raw &&
        typeof raw === "object" &&
        highlightKinds.some(([kind]) => kind === raw.kind),
    )
    .slice(0, 10)
    .map((raw, i) => {
      let id =
        typeof raw.id === "string" &&
        /^[a-z0-9_-]{1,64}$/i.test(raw.id) &&
        !ids.has(raw.id)
          ? raw.id
          : `filter-${i + 1}`;
      while (ids.has(id)) id = `${id}-next`;
      ids.add(id);
      return {
        id,
        kind: raw.kind,
        enabled: raw.enabled === true,
        color: color(raw.color, palette[i]),
        count: count(raw.count),
      };
    });
};
export const readReaderHighlights = (): ReaderHighlightOptions => {
  try {
    const current = window.localStorage.getItem(highlightStorageKey);
    return parseReaderHighlights(
      JSON.parse(
        current ??
          window.localStorage.getItem(legacyHighlightStorageKey) ??
          "null",
      ),
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
      JSON.stringify({ version: 2, filters: options }),
    );
    return true;
  } catch {
    return false;
  }
};
export const newHighlightFilter = (
  options: ReaderHighlightOptions,
): import("./model").ReaderHighlightRule => {
  let n = 1;
  while (options.some((rule) => rule.id === `filter-${n}`)) n++;
  return {
    id: `filter-${n}`,
    kind: "wordCount",
    enabled: true,
    count: 1,
    color:
      palette.find((value) => !options.some((rule) => rule.color === value)) ??
      palette[options.length % palette.length],
  };
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
    : `linear-gradient(to right,${colors.flatMap((value, index) => [`${value} ${(index * 100) / colors.length}%`, `${value} ${((index + 1) * 100) / colors.length}%`]).join(",")})`;
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
  phrases: readonly import("./model").ReaderHighlightPhrase[] = [],
): string => {
  let cursor = 0;
  let html = "";
  for (const word of words) {
    const colors: string[] = [];
    const rules: string[] = [];
    const labels: string[] = [];
    for (const rule of options) {
      if (!rule.enabled) continue;
      const matches =
        rule.kind === "exclusive"
          ? word.exclusive
          : rule.kind === "firstMention"
            ? word.firstMention
            : rule.kind === "lastMention"
              ? word.lastMention
              : rule.kind === "wordCount"
                ? word.count === rule.count
                : phrases.some(
                    (phrase) =>
                      phrase.count === rule.count &&
                      word.start >= phrase.start &&
                      word.end <= phrase.end,
                  );
      if (!matches) continue;
      colors.push(rule.color);
      rules.push(rule.kind);
      labels.push(
        rule.kind === "wordCount"
          ? `${rule.count.toLocaleString()} word appearances in the Bible`
          : rule.kind === "phraseCount"
            ? `In a phrase occurring ${rule.count.toLocaleString()} times in the Bible`
            : rule.kind === "exclusive"
              ? "Exclusive to this chapter"
              : rule.kind === "firstMention"
                ? "First mention in the Bible"
                : "Last mention in the Bible",
      );
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
  const metadata =
    data?.book === verse.book && data.chapter === verse.chapter
      ? data.verses.find((entry) => entry.number === verse.number)
      : undefined;
  const text = metadata
    ? readerWordHighlights(
        verse.text,
        metadata.words,
        state.readerHighlightOptions,
        metadata.phrases,
      )
    : escape(verse.text);
  return `<button class="verse reader-verse${state.location.verse === verse.number ? " selected-verse" : ""}" id="verse-${verse.number}" data-verse-detail="true" data-book="${escape(verse.book)}" data-chapter="${verse.chapter}" data-verse="${verse.number}" aria-label="Explore ${escape(verse.book)} ${verse.chapter}:${verse.number}"><span class="verse-number">${verse.number}</span>${text}</button>`;
};
export const readerChapterMarkup = (state: State) =>
  state.verses.map((verse) => readerVerseMarkup(state, verse)).join("");
export const highlightOptionsView = (state: State) =>
  `<div class="reader-highlight-options"><button data-page="highlights">Edit Highlights</button><span>${state.readerHighlightOptions.filter((rule) => rule.enabled).length} active filters</span></div>`;
export const highlightsView = (state: State) => {
  const rules = state.readerHighlightOptions;
  return `<section class="search-page highlights-page"><button data-page="reader">← Back to Read the Bible</button><div class="eyebrow">PERSONALIZE YOUR READING</div><h1>Highlights</h1><p class="intro">Add up to 10 highlight filters, each with its own color. They apply to every chapter.</p>
  <form id="reader-highlights-form"><div class="highlight-page-actions"><button type="button" data-action="highlight-add"${rules.length >= 10 ? " disabled" : ""}>Add highlight</button><span>${rules.length} of 10 filters</span></div>
  ${rules.length ? `<div class="highlight-filter-list">${rules.map((rule, i) => `<div class="highlight-filter" data-highlight-id="${rule.id}"><div class="highlight-filter-heading"><strong>Filter ${i + 1}</strong><label class="checkbox"><input type="checkbox" data-highlight-field="enabled"${rule.enabled ? " checked" : ""}>Enabled</label><button type="button" data-highlight-remove="${rule.id}" aria-label="Remove highlight filter ${i + 1}">Remove</button></div><div class="highlight-filter-controls"><label>Highlight<select data-highlight-field="kind">${highlightKinds.map(([kind, label]) => `<option value="${kind}"${kind === rule.kind ? " selected" : ""}>${label}</option>`).join("")}</select></label><label class="highlight-frequency"${rule.kind === "wordCount" || rule.kind === "phraseCount" ? "" : " hidden"}>Bible-wide occurrences (X)<input data-highlight-field="count" type="number" min="1" max="${Number.MAX_SAFE_INTEGER}" step="1" required value="${rule.count}"${rule.kind === "wordCount" || rule.kind === "phraseCount" ? "" : " disabled"}></label><label class="highlight-color">Color<input type="color" data-highlight-field="color" aria-label="Color for highlight filter ${i + 1}" value="${rule.color}"></label></div></div>`).join("")}</div>` : '<p class="notice">No highlight filters yet. Choose Add highlight to get started.</p>'}
  <p class="counting-note">Occurrence counts cover the whole Bible and ignore case. First and last mention highlight the first or final appearance of each word. Chapter-exclusive words follow the chapter you are reading. Phrase highlights use the longest phrases retained in the Phrases section. Overlapping filters appear as vertical color segments on each word.</p>
  <button type="submit" class="primary">Save Highlights</button><p id="highlight-save-status" role="${state.highlightSaveStatus === "error" ? "alert" : "status"}">${highlightStatus(state.highlightSaveStatus)}</p></form></section>`;
};
