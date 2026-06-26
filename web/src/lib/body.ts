// Renders an article `body` (stored as JSON) to safe HTML.
// M1 handles the simple seeded shape: { type: "doc", content: [{ type: "paragraph", text }] }.
// In M3 this is replaced by BlockNote's official renderer.

interface BodyBlock {
  type: string;
  text?: string;
}
interface BodyDoc {
  type?: string;
  content?: BodyBlock[];
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Convert the stored body JSON into an HTML string of <p> blocks (text escaped). */
export function renderBodyToHtml(body: unknown): string {
  const doc = body as BodyDoc | null;
  if (!doc || !Array.isArray(doc.content)) return "";
  return doc.content
    .filter((block) => block.type === "paragraph" && typeof block.text === "string" && block.text)
    .map((block) => `<p>${escapeHtml(block.text as string)}</p>`)
    .join("\n");
}
