import { searchCount } from "./search-count-fixture.mjs";
import { wordRows, ordered } from "./detail-fixture.mjs";
// Independent string-based verse oracle for preview and UI command tests.
export const verseFixture = (
  corpus,
  tokenize,
  wordCatalogue,
  savedPhraseCounts = null,
  savedVisibleCounts = null,
) => {
  const lines = corpus.map((verse, id) => ({
    id,
    verse,
    tokens: tokenize(verse.text),
  }));
  const textMatches = (line, filters) =>
    [
      { text: filters.text, partial: filters.partial },
      ...(filters.searches ?? []),
    ].every(
      (search) =>
        !search.text?.trim() ||
        searchCount(
          line.verse.text,
          { text: search.text, phrase: true, partial: search.partial },
          tokenize,
        ) > 0,
    );
  const summaries = new Map();
  const details = new Map();
  const phrasesFor = (tokens) => {
    const phrases = new Set();
    for (let length = 2; length <= tokens.length; length++)
      for (let start = 0; start + length <= tokens.length; start++)
        phrases.add(tokens.slice(start, start + length).join(" "));
    return [...phrases].sort();
  };
  const key = (verse) => `${verse.book} ${verse.chapter}:${verse.number}`;
  const summary = (line) => {
    if (!summaries.has(key(line.verse)))
      summaries.set(key(line.verse), {
        verse: line.verse,
        words: line.tokens.length,
        letters: (line.verse.text.match(/\p{Alphabetic}/gu) ?? []).length,
        phrases:
          savedVisibleCounts?.[line.id] ??
          (savedPhraseCounts
            ? Object.values(savedPhraseCounts[line.id]).reduce(
                (a, b) => a + b,
                0,
              )
            : phrasesFor(line.tokens).length),
      });
    return summaries.get(key(line.verse));
  };
  const frequencyHistograms = new Map();
  const histogram = (line) => {
    if (!frequencyHistograms.has(line.id)) {
      const counts = new Map();
      for (const word of line.tokens) {
        const frequency = wordCatalogue.detail(word).count;
        counts.set(frequency, (counts.get(frequency) ?? 0) + 1);
      }
      frequencyHistograms.set(line.id, counts);
    }
    return frequencyHistograms.get(line.id);
  };
  // A bounded two-word oracle keeps UI transport tests independent and small.
  // Full 2–90-word histograms are verified against Bible text in Rust.
  const phraseFrequencyHistograms = new Map();
  let globalPairs = null;
  const phraseHistogram = (line) => {
    if (savedPhraseCounts) {
      if (!phraseFrequencyHistograms.has(line.id))
        phraseFrequencyHistograms.set(
          line.id,
          new Map(
            Object.entries(savedPhraseCounts[line.id]).map(
              ([frequency, count]) => [Number(frequency), count],
            ),
          ),
        );
      return phraseFrequencyHistograms.get(line.id);
    }
    if (!globalPairs) {
      globalPairs = new Map();
      for (const row of lines)
        for (let i = 0; i + 2 <= row.tokens.length; i++) {
          const phrase = row.tokens.slice(i, i + 2).join(" ");
          globalPairs.set(phrase, (globalPairs.get(phrase) ?? 0) + 1);
        }
    }
    if (!phraseFrequencyHistograms.has(line.id)) {
      const distinct = new Set();
      for (let i = 0; i + 2 <= line.tokens.length; i++)
        distinct.add(line.tokens.slice(i, i + 2).join(" "));
      const counts = new Map();
      for (const phrase of distinct) {
        const frequency = globalPairs.get(phrase);
        counts.set(frequency, (counts.get(frequency) ?? 0) + 1);
      }
      phraseFrequencyHistograms.set(line.id, counts);
    }
    return phraseFrequencyHistograms.get(line.id);
  };
  return {
    catalogue: ({
      book = null,
      offset = 0,
      filters = {},
      frequencies = [],
      phraseFrequencies = [],
      sort = null,
    }) => {
      const matches = lines.filter(
        (line) =>
          (book == null || line.verse.book === book) &&
          textMatches(line, filters) &&
          (filters.chapter == null || line.verse.chapter === filters.chapter) &&
          (filters.verse == null || line.verse.number === filters.verse) &&
          (filters.words == null || line.tokens.length === filters.words) &&
          (filters.letters == null ||
            (line.verse.text.match(/\p{Alphabetic}/gu) ?? []).length ===
              filters.letters) &&
          (filters.phrases == null ||
            summary(line).phrases === filters.phrases),
      );
      if (sort)
        matches.sort((a, b) => {
          const lookup = sort.kind === "phrases" ? phraseHistogram : histogram;
          const left = lookup(a).get(sort.frequency) ?? 0,
            right = lookup(b).get(sort.frequency) ?? 0;
          return (
            (sort.direction === "desc" ? right - left : left - right) ||
            a.id - b.id
          );
        });
      return {
        total: matches.length,
        entries: matches.slice(offset, offset + 50).map((line) => ({
          ...summary(line),
          phraseFrequencyCounts: phraseFrequencies.map(
            (n) => phraseHistogram(line).get(n) ?? 0,
          ),
          frequencyCounts: frequencies.map((n) => histogram(line).get(n) ?? 0),
        })),
      };
    },
    list: (book, offset, filters = {}) => {
      const matches = lines.filter(
        (line) =>
          (book == null || line.verse.book === book) &&
          textMatches(line, filters) &&
          (filters.chapter == null || line.verse.chapter === filters.chapter) &&
          (filters.verse == null || line.verse.number === filters.verse) &&
          (filters.words == null || line.tokens.length === filters.words) &&
          (filters.letters == null ||
            (line.verse.text.match(/\p{Alphabetic}/gu) ?? []).length ===
              filters.letters) &&
          (filters.phrases == null ||
            summary(line).phrases === filters.phrases),
      );
      return {
        total: matches.length,
        entries: matches.slice(offset, offset + 50).map(summary),
      };
    },
    detail: (book, chapter, verse, offset, sort) => {
      const line = lines.find(
        (line) =>
          line.verse.book === book &&
          line.verse.chapter === chapter &&
          line.verse.number === verse,
      );
      if (!line) throw new Error("Verse not found");
      if (!details.has(key(line.verse))) {
        const candidates = phrasesFor(line.tokens);
        const metadata = new Map(
          candidates.map((phrase) => [
            phrase,
            {
              phrase,
              words: tokenize(phrase).length,
              letters: (phrase.match(/\p{Alphabetic}/gu) ?? []).length,
              occurrences: 0,
              owners: new Set(),
            },
          ]),
        );
        const lengths = [
          ...new Set(candidates.map((phrase) => tokenize(phrase).length)),
        ];
        for (const length of lengths)
          for (const other of lines)
            for (let i = 0; i + length <= other.tokens.length; i++) {
              const found = metadata.get(
                other.tokens.slice(i, i + length).join(" "),
              );
              if (found) {
                found.occurrences++;
                found.owners.add(other.verse.book);
              }
            }
        const allEntries = [...metadata.values()].map(
          ({ owners, ...entry }) => ({
            ...entry,
            books: owners.size,
          }),
        );
        const wordParts = [
          ...line.verse.text.matchAll(/[\p{L}\p{N}']+/gu),
        ].flatMap((match) => {
          const word = match[0].replace(/^'+|'+$/g, "");
          if (!word) return [];
          const start = match.index + match[0].indexOf(word);
          return [
            { start, end: start + word.length, word: word.toLowerCase() },
          ];
        });
        const visible = allEntries.filter(
          (entry) =>
            !allEntries.some(
              (parent) =>
                parent.occurrences === entry.occurrences &&
                parent.words > entry.words &&
                ` ${parent.phrase} `.includes(` ${entry.phrase} `),
            ),
        );
        const entries = visible.map((entry) => {
          const start = line.tokens.findIndex(
            (_, index) =>
              line.tokens.slice(index, index + entry.words).join(" ") ===
              entry.phrase,
          );
          let begin = wordParts[start].start;
          let end = wordParts[start + entry.words - 1].end;
          while (begin > 0 && "[({'\"‘“".includes(line.verse.text[begin - 1]))
            begin--;
          while (
            end < line.verse.text.length &&
            "])}'\".,;:!?‘’”".includes(line.verse.text[end])
          )
            end++;
          return { ...entry, display: line.verse.text.slice(begin, end) };
        });
        details.set(key(line.verse), {
          ...summary(line),
          phrases: visible.length,
          wordParts,
          entries,
          wordEntries: wordRows(line.verse.text, wordParts, wordCatalogue),
        });
      }
      const { entries, ...detail } = details.get(key(line.verse));
      return {
        ...detail,
        phraseResults: {
          total: entries.length,
          entries: ordered(entries, sort).slice(offset, offset + 50),
          persistedLengths: [],
        },
      };
    },
  };
};
