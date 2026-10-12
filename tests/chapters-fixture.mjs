// Transport fixture reads prepared profiles; tests also check them against independent text counts.
export const chaptersFixture = (header, loadProfile) => {
  const cache = new Map();
  const compare = (a, b, field) =>
    typeof a[field] === "string"
      ? a[field] < b[field]
        ? -1
        : a[field] > b[field]
          ? 1
          : 0
      : a[field] - b[field];
  return {
    list: (book, offset, sort, filters = {}) => {
      const entries = header.entries
        .map((entry, id) => ({ entry, id }))
        .filter(
          ({ entry }) =>
            (book == null || entry.book === book) &&
            Object.entries(filters).every(([field, value]) =>
              value == null || typeof value === "string"
                ? value == null ||
                  entry[field].toLowerCase() === value.trim().toLowerCase()
                : entry[field] === value,
            ),
        );
      if (sort)
        entries.sort(
          (a, b) =>
            (sort.field === "reference"
              ? a.id - b.id
              : compare(a.entry, b.entry, sort.field)) *
              (sort.direction === "desc" ? -1 : 1) || a.id - b.id,
        );
      return {
        total: entries.length,
        entries: entries.slice(offset, offset + 50).map(({ entry }) => entry),
      };
    },
    detail: async (query) => {
      const id = header.entries.findIndex(
        (entry) => entry.book === query.book && entry.chapter === query.chapter,
      );
      if (id < 0) throw new Error("Chapter not found");
      if (!cache.has(id)) cache.set(id, await loadProfile(id));
      const profile = cache.get(id);
      const page = (entries, offset, sort, name, filters = {}) => {
        entries = entries.filter((entry) =>
          Object.entries(filters).every(([field, value]) =>
            value == null || typeof value === "string"
              ? value == null ||
                entry[field].toLowerCase().includes(value.trim().toLowerCase())
              : entry[field] === value,
          ),
        );
        if (sort)
          entries.sort(
            (a, b) =>
              compare(a, b, sort.field) *
                (sort.direction === "desc" ? -1 : 1) || compare(a, b, name),
          );
        return {
          total: entries.length,
          entries: entries.slice(offset, offset + 50),
        };
      };
      return {
        summary: profile.summary,
        wordResults: page(
          profile.words,
          query.wordOffset ?? 0,
          query.wordSort,
          "word",
          query.wordFilters,
        ),
        phraseResults: page(
          profile.phrases,
          query.phraseOffset ?? 0,
          query.phraseSort,
          "phrase",
          query.phraseFilters,
        ),
      };
    },
  };
};
