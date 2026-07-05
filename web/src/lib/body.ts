// Renders an article `body` (stored as JSON) to safe HTML.
//
// The editor (M3) is TipTap, whose document is a ProseMirror-style tree:
//   { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text, marks }] }, …] }
// This renderer is pure (no DOM) so it runs on Workers, and it escapes all text.
// It also still understands the M1 seed shape ({ type: "paragraph", text }) so
// existing/published articles keep rendering.

interface Mark {
  type: string;
  attrs?: Record<string, unknown>;
}
interface Node {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
  text?: string;
  marks?: Mark[];
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Allow only safe URL schemes on links/images (blocks javascript:, data:, etc.).
function safeUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  return /^(https?:\/\/|mailto:|\/|#)/i.test(trimmed) ? trimmed : null;
}

function renderMarks(html: string, marks: Mark[] = []): string {
  for (const mark of marks) {
    switch (mark.type) {
      case "bold":
        html = `<strong>${html}</strong>`;
        break;
      case "italic":
        html = `<em>${html}</em>`;
        break;
      case "strike":
        html = `<s>${html}</s>`;
        break;
      case "code":
        html = `<code>${html}</code>`;
        break;
      case "link": {
        const href = safeUrl(mark.attrs?.href);
        if (href) {
          html = `<a href="${escapeHtml(href)}" rel="noopener noreferrer nofollow">${html}</a>`;
        }
        break;
      }
    }
  }
  return html;
}

function renderChildren(node: Node): string {
  return (node.content ?? []).map(renderNode).join("");
}

// Inline content of a block: TipTap children, or M1's text-on-the-block shape.
function renderInline(node: Node): string {
  if (node.content) return renderChildren(node);
  if (typeof node.text === "string") return escapeHtml(node.text);
  return "";
}

function renderNode(node: Node): string {
  switch (node.type) {
    case "text":
      return renderMarks(escapeHtml(node.text ?? ""), node.marks);
    case "paragraph":
      return `<p>${renderInline(node)}</p>`;
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 2));
      return `<h${level}>${renderInline(node)}</h${level}>`;
    }
    case "bulletList":
      return `<ul>${renderChildren(node)}</ul>`;
    case "orderedList":
      return `<ol>${renderChildren(node)}</ol>`;
    case "listItem":
      return `<li>${renderChildren(node) || renderInline(node)}</li>`;
    case "blockquote":
      return `<blockquote>${renderChildren(node) || renderInline(node)}</blockquote>`;
    case "codeBlock":
      return `<pre><code>${escapeHtml(bodyToText(node))}</code></pre>`;
    case "horizontalRule":
      return "<hr />";
    case "hardBreak":
      return "<br />";
    case "image": {
      const src = safeUrl(node.attrs?.src);
      if (!src) return "";
      const alt = escapeHtml(String(node.attrs?.alt ?? ""));
      return `<img src="${escapeHtml(src)}" alt="${alt}" loading="lazy" />`;
    }
    default:
      // Unknown node: render children so nothing is silently dropped.
      return renderChildren(node);
  }
}

/** Largest accepted serialized body (guards the JSON column against abuse). */
export const MAX_BODY_BYTES = 512 * 1024;

/**
 * Is `value` a plausible TipTap document? A light structural check for the
 * save endpoint — the renderer is defensive, but we don't want to persist
 * arbitrary JSON in the body column.
 */
export function isDocJson(value: unknown): value is Node {
  return (
    !!value &&
    typeof value === "object" &&
    (value as Node).type === "doc" &&
    Array.isArray((value as Node).content)
  );
}

/** Convert the stored body JSON into a safe HTML string (all text escaped). */
export function renderBodyToHtml(body: unknown): string {
  const doc = body as Node | null;
  if (!doc || !Array.isArray(doc.content)) return "";
  return doc.content.map(renderNode).join("\n");
}

/** Flatten the body JSON to plain text (for word counts, code blocks, etc.). */
export function bodyToText(body: unknown): string {
  const node = body as Node | null;
  if (!node) return "";
  if (typeof node.text === "string") return node.text;
  return (node.content ?? [])
    .map(bodyToText)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Estimated reading time in minutes (200 wpm), minimum 1. */
export function readingTimeMinutes(body: unknown, excerpt?: string | null): number {
  const text = `${excerpt ?? ""} ${bodyToText(body)}`.trim();
  const words = text ? text.split(/\s+/).length : 0;
  return Math.max(1, Math.round(words / 200));
}
