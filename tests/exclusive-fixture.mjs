// Independent string-based oracle for preview and transport integration tests.
export const exclusiveFixture = (lines, book, length) => {
  const counts = new Map();
  for (const line of lines.filter((line) => line.book === book)) {
    for (let index = 0; index <= line.tokens.length - length; index++) {
      const phrase = line.tokens.slice(index, index + length).join(" ");
      counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
    }
  }
  for (const line of lines.filter((line) => line.book !== book)) {
    for (let index = 0; index <= line.tokens.length - length; index++) {
      counts.delete(line.tokens.slice(index, index + length).join(" "));
    }
  }
  return [...counts]
    .map(([phrase, count]) => ({ phrase, count }))
    .sort(
      (left, right) =>
        right.count - left.count || left.phrase.localeCompare(right.phrase),
    );
};
