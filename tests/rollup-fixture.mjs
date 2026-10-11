// Independent string oracle: hide a phrase when a one-word extension
// has the same Bible-wide count. Equal-count longer parents always have
// such an extension; compare full counts, never just a singleton flag.
const cached = new WeakMap();
export const equalCountRollup = (source, tokenize) => {
  if (cached.has(source)) return cached.get(source);
  const lines = source.map(
    (line) => line.tokens ?? tokenize(line.text ?? line.verse.text),
  );
  const maximum = Math.max(2, ...lines.map((tokens) => tokens.length));
  let positions = null;
  const extensionCounts = new Map(),
    hidden = new Map();
  const build = () => {
    if (positions) return;
    positions = new Map();
    lines.forEach((tokens, id) =>
      tokens.forEach((word, start) => {
        const rows = positions.get(word) ?? [];
        rows.push(id, start);
        positions.set(word, rows);
      }),
    );
  };
  const matches = (tokens, start, query) =>
    start + query.length <= tokens.length &&
    query.every((word, i) => tokens[start + i] === word);
  const count = (query) => {
    const key = query.join(" ");
    if (extensionCounts.has(key)) return extensionCounts.get(key);
    let total = 0;
    const rows = positions.get(query[0]) ?? [];
    for (let i = 0; i < rows.length; i += 2)
      if (matches(lines[rows[i]], rows[i + 1], query)) total++;
    extensionCounts.set(key, total);
    return total;
  };
  const isHidden = (phrase, occurrences) => {
    if (occurrences < 1) return false;
    if (hidden.has(phrase)) return hidden.get(phrase);
    const query = tokenize(phrase);
    if (query.length >= maximum) return false;
    build();
    let result = false;
    const rows = positions.get(query[0]) ?? [];
    for (let i = 0; i < rows.length; i += 2) {
      const tokens = lines[rows[i]],
        start = rows[i + 1];
      if (!matches(tokens, start, query)) continue;
      result =
        (start > 0 && count([tokens[start - 1], ...query]) === occurrences) ||
        (start + query.length < tokens.length &&
          count([...query, tokens[start + query.length]]) === occurrences);
      break;
    }
    hidden.set(phrase, result);
    return result;
  };
  isHidden.prepare = (entries, locations) => {
    const pending = [];
    const required = new Map();
    for (const entry of entries) {
      if (entry.occurrences < 1 || hidden.has(entry.phrase)) continue;
      const query = tokenize(entry.phrase);
      const location = locations.get(entry.phrase);
      if (query.length >= maximum || !location) {
        hidden.set(entry.phrase, false);
        continue;
      }
      const { tokens, start } = location;
      const parents = [];
      if (start > 0) parents.push([tokens[start - 1], ...query]);
      if (start + query.length < tokens.length)
        parents.push([...query, tokens[start + query.length]]);
      pending.push([
        entry.phrase,
        parents.map((parent) => parent.join(" ")),
        entry.occurrences,
      ]);
      for (const parent of parents) {
        const key = parent.join(" ");
        if (extensionCounts.has(key)) continue;
        const keys = required.get(parent.length) ?? new Set();
        keys.add(key);
        required.set(parent.length, keys);
      }
    }
    for (const [length, keys] of required) {
      if (keys.size < 256) {
        build();
        for (const key of keys) count(tokenize(key));
        continue;
      }
      for (const key of keys) extensionCounts.set(key, 0);
      for (const tokens of lines)
        for (let start = 0; start + length <= tokens.length; start++) {
          const key = tokens.slice(start, start + length).join(" ");
          if (keys.has(key))
            extensionCounts.set(key, extensionCounts.get(key) + 1);
        }
    }
    for (const [phrase, parents, occurrences] of pending)
      hidden.set(
        phrase,
        parents.some((parent) => extensionCounts.get(parent) === occurrences),
      );
  };
  cached.set(source, isHidden);
  return isHidden;
};
