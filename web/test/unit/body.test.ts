import { describe, expect, it } from "vitest";
import { bodyToText, isDocJson, readingTimeMinutes, renderBodyToHtml } from "../../src/lib/body";

describe("renderBodyToHtml — legacy M1 shape", () => {
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

  it("returns an empty string for missing or malformed bodies", () => {
    expect(renderBodyToHtml(null)).toBe("");
    expect(renderBodyToHtml({})).toBe("");
    expect(renderBodyToHtml({ type: "doc", content: [{ type: "image" }] })).toBe("");
  });
});

describe("renderBodyToHtml — TipTap shape", () => {
  const p = (...content: unknown[]) => ({ type: "paragraph", content });
  const t = (text: string, marks?: unknown[]) => ({ type: "text", text, ...(marks ? { marks } : {}) });

  it("renders text nodes with marks", () => {
    const body = {
      type: "doc",
      content: [p(t("plain "), t("bold", [{ type: "bold" }]), t(" "), t("em", [{ type: "italic" }]))],
    };
    expect(renderBodyToHtml(body)).toBe("<p>plain <strong>bold</strong> <em>em</em></p>");
  });

  it("renders headings, lists, blockquotes, code, and rules", () => {
    const body = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [t("Title")] },
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [p(t("one"))] },
            { type: "listItem", content: [p(t("two"))] },
          ],
        },
        { type: "blockquote", content: [p(t("quoted"))] },
        { type: "codeBlock", content: [t("a < b")] },
        { type: "horizontalRule" },
      ],
    };
    expect(renderBodyToHtml(body)).toBe(
      "<h2>Title</h2>\n" +
        "<ul><li><p>one</p></li><li><p>two</p></li></ul>\n" +
        "<blockquote><p>quoted</p></blockquote>\n" +
        "<pre><code>a &lt; b</code></pre>\n" +
        "<hr />",
    );
  });

  it("clamps heading levels to 1–6", () => {
    const body = { type: "doc", content: [{ type: "heading", attrs: { level: 9 }, content: [{ type: "text", text: "x" }] }] };
    expect(renderBodyToHtml(body)).toBe("<h6>x</h6>");
  });
});

describe("renderBodyToHtml — security", () => {
  it("escapes HTML in text (no injection)", () => {
    const body = { type: "doc", content: [{ type: "paragraph", text: "<script>x</script>" }] };
    expect(renderBodyToHtml(body)).toBe("<p>&lt;script&gt;x&lt;/script&gt;</p>");
  });

  it("keeps safe link hrefs but drops dangerous schemes", () => {
    const link = (href: string) => ({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "go", marks: [{ type: "link", attrs: { href } }] }] }],
    });
    expect(renderBodyToHtml(link("https://vrc6.com"))).toContain('<a href="https://vrc6.com"');
    // javascript: is not a permitted scheme → rendered as plain text, no anchor.
    expect(renderBodyToHtml(link("javascript:alert(1)"))).toBe("<p>go</p>");
  });

  it("drops images without a safe src", () => {
    const img = (src: unknown) => ({ type: "doc", content: [{ type: "image", attrs: { src } }] });
    expect(renderBodyToHtml(img("javascript:x"))).toBe("");
    expect(renderBodyToHtml(img("https://cdn.vrc6.com/a.png"))).toContain('<img src="https://cdn.vrc6.com/a.png"');
  });
});

describe("isDocJson", () => {
  it("accepts a well-formed TipTap doc", () => {
    expect(isDocJson({ type: "doc", content: [{ type: "paragraph" }] })).toBe(true);
    expect(isDocJson({ type: "doc", content: [] })).toBe(true);
  });

  it("rejects anything that isn't a doc node with a content array", () => {
    expect(isDocJson(null)).toBe(false);
    expect(isDocJson("<p>hi</p>")).toBe(false);
    expect(isDocJson({ type: "paragraph", content: [] })).toBe(false);
    expect(isDocJson({ type: "doc" })).toBe(false);
    expect(isDocJson({ type: "doc", content: "nope" })).toBe(false);
  });
});

describe("bodyToText / readingTimeMinutes", () => {
  it("flattens both shapes to plain text", () => {
    expect(bodyToText({ type: "doc", content: [{ type: "paragraph", text: "hi there" }] })).toBe("hi there");
    expect(
      bodyToText({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hi there" }] }] }),
    ).toBe("hi there");
  });

  it("estimates reading time at ≥1 minute", () => {
    expect(readingTimeMinutes(null)).toBe(1);
    const words = Array.from({ length: 400 }, () => "word").join(" ");
    expect(readingTimeMinutes({ type: "doc", content: [{ type: "paragraph", text: words }] })).toBe(2);
  });
});
