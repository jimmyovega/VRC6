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

describe("renderBodyToHtml — alignment", () => {
  const p = (text: string, textAlign?: string) => ({
    type: "paragraph",
    ...(textAlign ? { attrs: { textAlign } } : {}),
    content: [{ type: "text", text }],
  });
  const h = (level: number, textAlign?: string) => ({
    type: "heading",
    attrs: { level, ...(textAlign ? { textAlign } : {}) },
    content: [{ type: "text", text: "Title" }],
  });
  const img = (src: string, align?: string) => ({
    type: "image",
    attrs: { src, ...(align ? { align } : {}) },
  });

  it("emits text-align for center/right paragraphs and headings", () => {
    expect(renderBodyToHtml({ type: "doc", content: [p("x", "center")] })).toBe(
      '<p style="text-align:center">x</p>',
    );
    expect(renderBodyToHtml({ type: "doc", content: [h(2, "right")] })).toBe(
      '<h2 style="text-align:right">Title</h2>',
    );
  });

  it("omits the style attribute for left (the default) or no alignment", () => {
    expect(renderBodyToHtml({ type: "doc", content: [p("x", "left")] })).toBe("<p>x</p>");
    expect(renderBodyToHtml({ type: "doc", content: [p("x")] })).toBe("<p>x</p>");
  });

  it("emits data-align for center/right images, nothing for left/none", () => {
    const src = "https://cdn.vrc6.com/a.png";
    expect(renderBodyToHtml({ type: "doc", content: [img(src, "center")] })).toContain(
      'data-align="center"',
    );
    expect(renderBodyToHtml({ type: "doc", content: [img(src, "right")] })).toContain(
      'data-align="right"',
    );
    expect(renderBodyToHtml({ type: "doc", content: [img(src, "left")] })).not.toContain("data-align");
    expect(renderBodyToHtml({ type: "doc", content: [img(src)] })).not.toContain("data-align");
  });

  it("drops any non-allowlisted alignment value instead of emitting it (CSS-injection guard)", () => {
    const junk = ['center;color:red', 'justify', 'expression(alert(1))', 123, { toString: () => "center" }];
    for (const value of junk) {
      const out = renderBodyToHtml({ type: "doc", content: [p("x", value as never)] });
      expect(out).toBe("<p>x</p>"); // no style attribute leaks through
      const imgOut = renderBodyToHtml({
        type: "doc",
        content: [img("https://cdn.vrc6.com/a.png", value as never)],
      });
      expect(imgOut).not.toContain("data-align");
    }
  });
});

describe("renderBodyToHtml — image lists", () => {
  const item = (src: string | undefined, excerpt: unknown) => ({
    type: "imageListItem",
    ...(src !== undefined ? { attrs: { src } } : {}),
    content: excerpt,
  });
  const list = (...items: unknown[]) => ({
    type: "doc",
    content: [{ type: "imageList", content: items }],
  });
  const text = (t: string, marks?: unknown[]) => ({ type: "text", text: t, ...(marks ? { marks } : {}) });

  it("renders a list of thumbnail + excerpt rows", () => {
    const out = renderBodyToHtml(
      list(
        item("https://cdn.vrc6.com/a.png", [text("First caption")]),
        item("https://cdn.vrc6.com/b.png", [text("Second caption")]),
      ),
    );
    expect(out).toBe(
      '<ul class="image-list">' +
        '<li class="ili"><img class="ili-thumb" src="https://cdn.vrc6.com/a.png" alt="" loading="lazy" /><div class="ili-text">First caption</div></li>' +
        '<li class="ili"><img class="ili-thumb" src="https://cdn.vrc6.com/b.png" alt="" loading="lazy" /><div class="ili-text">Second caption</div></li>' +
        "</ul>",
    );
  });

  it("renders excerpt marks through the inline renderer", () => {
    const out = renderBodyToHtml(
      list(item("https://cdn.vrc6.com/a.png", [text("bold", [{ type: "bold" }])])),
    );
    expect(out).toContain('<div class="ili-text"><strong>bold</strong></div>');
  });

  it("escapes excerpt text (no injection through the caption)", () => {
    const out = renderBodyToHtml(
      list(item("https://cdn.vrc6.com/a.png", [text("<img src=x onerror=alert(1)>")])),
    );
    expect(out).toContain(
      '<div class="ili-text">&lt;img src=x onerror=alert(1)&gt;</div>',
    );
    expect(out).not.toContain("onerror=alert(1)>");
  });

  it("runs the thumbnail src through the scheme allowlist", () => {
    // A dangerous src drops just the <img>, keeping the (still-escaped) excerpt.
    const bad = renderBodyToHtml(list(item("javascript:alert(1)", [text("cap")])));
    expect(bad).toBe('<ul class="image-list"><li class="ili"><div class="ili-text">cap</div></li></ul>');
    expect(bad).not.toContain("javascript:");
    // And a normal src is emitted, escaped.
    const ok = renderBodyToHtml(list(item("https://cdn.vrc6.com/a.png", [text("cap")])));
    expect(ok).toContain('<img class="ili-thumb" src="https://cdn.vrc6.com/a.png"');
  });

  it("renders an empty excerpt as an empty text cell", () => {
    const out = renderBodyToHtml(list(item("https://cdn.vrc6.com/a.png", [])));
    expect(out).toContain('<div class="ili-text"></div>');
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
