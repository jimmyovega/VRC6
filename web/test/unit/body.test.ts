import { describe, expect, it } from "vitest";
import { renderBodyToHtml } from "../../src/lib/body";

describe("renderBodyToHtml", () => {
  it("renders paragraph blocks as <p> elements", () => {
    const body = {
      type: "doc",
      content: [
        { type: "paragraph", text: "Hello" },
        { type: "paragraph", text: "World" },
      ],
    };
    expect(renderBodyToHtml(body)).toBe("<p>Hello</p>\n<p>World</p>");
  });

  it("escapes HTML in text (no injection)", () => {
    const body = { type: "doc", content: [{ type: "paragraph", text: "<script>x</script>" }] };
    expect(renderBodyToHtml(body)).toBe("<p>&lt;script&gt;x&lt;/script&gt;</p>");
  });

  it("returns an empty string for missing or malformed bodies", () => {
    expect(renderBodyToHtml(null)).toBe("");
    expect(renderBodyToHtml({})).toBe("");
    expect(renderBodyToHtml({ type: "doc", content: [{ type: "image" }] })).toBe("");
  });
});
