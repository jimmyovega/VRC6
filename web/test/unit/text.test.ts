import { describe, expect, it } from "vitest";
import { slugify, truncateWords } from "../../src/lib/text";

describe("slugify", () => {
  it("lowercases and hyphenates words", () => {
    expect(slugify("The Digital Underground")).toBe("the-digital-underground");
  });

  it("strips punctuation and collapses separators", () => {
    expect(slugify("Neon Nights: A Guide!!")).toBe("neon-nights-a-guide");
  });

  it("trims leading and trailing separators", () => {
    expect(slugify("  --Hello-- ")).toBe("hello");
  });
});

describe("truncateWords", () => {
  it("returns the text unchanged when under the limit", () => {
    expect(truncateWords("a b c", 5)).toBe("a b c");
  });

  it("truncates and appends an ellipsis when over the limit", () => {
    expect(truncateWords("one two three four five", 3)).toBe("one two three…");
  });
});
