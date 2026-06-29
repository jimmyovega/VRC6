import { describe, expect, it } from "vitest";
import { formatDate } from "../../src/lib/date";

describe("formatDate", () => {
  it("formats a Date as 'Month D, YYYY' (UTC)", () => {
    expect(formatDate(new Date("2026-06-26T00:00:00Z"))).toBe("June 26, 2026");
  });

  it("accepts an epoch-millisecond number", () => {
    expect(formatDate(Date.UTC(2026, 0, 1))).toBe("January 1, 2026");
  });

  it("returns an empty string for null/undefined/invalid", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate(undefined)).toBe("");
    expect(formatDate(new Date("nope"))).toBe("");
  });
});
