import { describe, expect, it } from "vitest";
import { whyCannotSubmit } from "../../src/lib/article";

const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const EMPTY = { type: "doc", content: [{ type: "paragraph" }] };

describe("whyCannotSubmit", () => {
  it("passes a complete draft", () => {
    expect(whyCannotSubmit({ title: "Hello", body: doc("Some content"), categoryId: 3 })).toBeNull();
  });

  it("requires a real title", () => {
    expect(whyCannotSubmit({ title: "", body: doc("x"), categoryId: 1 })).toMatch(/title/i);
    expect(whyCannotSubmit({ title: "   ", body: doc("x"), categoryId: 1 })).toMatch(/title/i);
    expect(whyCannotSubmit({ title: "Untitled draft", body: doc("x"), categoryId: 1 })).toMatch(/title/i);
  });

  it("requires body content", () => {
    expect(whyCannotSubmit({ title: "Hi", body: EMPTY, categoryId: 1 })).toMatch(/content/i);
  });

  it("requires a category", () => {
    expect(whyCannotSubmit({ title: "Hi", body: doc("x"), categoryId: null })).toMatch(/category/i);
  });
});
