// Independent, set-based oracle for the DOM preview/test transport.
const longest = (values) =>
  [...new Set(values)]
    .sort((a, b) => a - b)
    .reduce(
      (state, value) => {
        const run = value === state.last + 1 ? state.run + 1 : 1;
        return { last: value, run, maximum: Math.max(state.maximum, run) };
      },
      { last: -2, run: 0, maximum: 0 },
    ).maximum;

export const summarize = (positions) => {
  const chapters = new Map();
  const books = new Map();
  for (const position of positions) {
    const key = `${position.book}\0${position.chapter}`;
    const chapter = chapters.get(key) ?? { count: 0, verses: new Set() };
    chapter.count += position.count;
    chapter.verses.add(position.number);
    chapters.set(key, chapter);
    const book = books.get(position.book) ?? new Set();
    book.add(position.chapter);
    books.set(position.book, book);
  }
  const chapterFrequencies = [
    ...new Set([...chapters.values()].map((chapter) => chapter.count)),
  ].sort((a, b) => a - b);
  return {
    maxVerseRun: Math.max(
      0,
      ...[...chapters.values()].map((chapter) => longest(chapter.verses)),
    ),
    maxChapterRun: Math.max(0, ...[...books.values()].map(longest)),
    maxChapterFrequency: Math.max(0, ...chapterFrequencies),
    chapterFrequencies,
  };
};
