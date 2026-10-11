// Independent numeric grouping of the word fixture.
export const numberFixture = (catalogue) => {
  const entries = [];
  for (let offset = 0; offset < catalogue.list("", 0).total; offset += 50) {
    for (const row of catalogue.list("", offset).entries)
      entries.push(catalogue.detail(row.word));
  }
  const numbers = [
    ...new Set(
      entries.flatMap((word) => [word.count, word.books.length, word.letters]),
    ),
  ].sort((a, b) => a - b);
  return {
    list: (offset = 0) => ({
      total: numbers.length,
      entries: numbers
        .slice(offset, offset + 50)
        .map((number) => ({
          number,
          words: entries.filter((word) => word.count === number).length,
        })),
    }),
    words: (number, offset = 0) => catalogue.list("", offset, null, number),
  };
};
