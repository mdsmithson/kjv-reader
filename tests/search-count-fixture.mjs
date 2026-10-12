// String-based oracle for per-verse counts; the production implementation is in Rust.
export const searchCount = (text, query, tokenize) => {
  const tokens = tokenize(text);
  const terms = tokenize(query.text);
  if (query.normalizedWords || (!query.partial && query.phrase)) {
    if (!terms.length) return 0;
    return tokens.filter(
      (_, start) =>
        start + terms.length <= tokens.length &&
        terms.every((term, i) => tokens[start + i] === term),
    ).length;
  }
  if (!query.partial) {
    const accepted = new Set(terms);
    return tokens.filter((word) => accepted.has(word)).length;
  }
  const normalized = text.toLowerCase();
  const needles = query.phrase
    ? [query.text.trim().toLowerCase()]
    : [...new Set(query.text.trim().toLowerCase().split(/\s+/))];
  return needles.filter(Boolean).reduce((count, term) => {
    for (let start = 0; start < normalized.length; start++)
      if (normalized.startsWith(term, start)) count++;
    return count;
  }, 0);
};
