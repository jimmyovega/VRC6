// Small pure text helpers used for article/category slugs and card excerpts.
// Pure functions → ideal unit-test targets (see test/unit/text.test.ts).

/** Convert a title into a URL-safe slug: lowercase, hyphen-separated, punctuation stripped. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Truncate to at most `maxWords` words, appending an ellipsis when shortened. */
export function truncateWords(input: string, maxWords: number): string {
  const trimmed = input.trim();
  const words = trimmed.split(/\s+/);
  if (words.length <= maxWords) return trimmed;
  return words.slice(0, maxWords).join(" ") + "…";
}
