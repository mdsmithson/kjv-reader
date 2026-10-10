import type { Query } from "./model";

export const escape = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );

type Span = Readonly<{ start: number; end: number }>;
type Word = Span & Readonly<{ text: string }>;
const regexEscape = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const words = (text: string): readonly Word[] =>
  Array.from(text.matchAll(/[\p{L}\p{N}']+/gu))
    .map((match) => {
      const trimmed = match[0].replace(/^'+|'+$/g, "");
      const start = match.index + match[0].indexOf(trimmed);
      return {
        text: trimmed.toLowerCase(),
        start,
        end: start + trimmed.length,
      };
    })
    .filter((word) => word.text.length > 0);

const normalizedSpans = (text: string, query: string): readonly Span[] => {
  const tokens = words(text);
  const terms = words(query).map((word) => word.text);
  if (!terms.length) return [];
  return tokens.flatMap((token, index) =>
    terms.every((term, offset) => tokens[index + offset]?.text === term)
      ? [{ start: token.start, end: tokens[index + terms.length - 1].end }]
      : [],
  );
};

const literalSpans = (text: string, query: Query): readonly Span[] => {
  const terms = query.phrase
    ? [query.text.trim()]
    : query.text.trim().split(/\s+/);
  return terms
    .filter(Boolean)
    .flatMap((term) =>
      Array.from(text.matchAll(new RegExp(regexEscape(term), "giu"))).map(
        (match) => ({ start: match.index, end: match.index + match[0].length }),
      ),
    );
};

// Merge intersecting spans before escaping the individual text segments.
// A matching literal is never interpreted as markup or as a regular expression.
export const highlighted = (text: string, query: Query): string => {
  const spans = [
    ...(query.normalizedWords
      ? normalizedSpans(text, query.text)
      : literalSpans(text, query)),
  ].sort((left, right) => left.start - right.start || right.end - left.end);
  const merged = spans.reduce<Span[]>((ranges, span) => {
    const last = ranges.at(-1);
    return last && span.start <= last.end
      ? [
          ...ranges.slice(0, -1),
          { start: last.start, end: Math.max(last.end, span.end) },
        ]
      : [...ranges, span];
  }, []);
  const result = merged.reduce(
    (rendered, span) => ({
      end: span.end,
      html:
        rendered.html +
        escape(text.slice(rendered.end, span.start)) +
        `<mark>${escape(text.slice(span.start, span.end))}</mark>`,
    }),
    { end: 0, html: "" },
  );
  return result.html + escape(text.slice(result.end));
};
