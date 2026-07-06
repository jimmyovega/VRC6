// Article-workflow helpers (pure — unit-tested in article.test.ts).
import { bodyToText } from "./body";

export interface SubmitCandidate {
  title: string | null;
  body: unknown;
  categoryId: number | null;
}

/**
 * Why a draft can't yet be submitted for review, or null when it's ready.
 * Encodes the minimum an editor must provide: a real title, some body text,
 * and a category.
 */
export function whyCannotSubmit(article: SubmitCandidate): string | null {
  const title = (article.title ?? "").trim();
  if (!title || title === "Untitled draft") return "Give your article a title before submitting.";
  if (!bodyToText(article.body).trim()) return "Write some content before submitting.";
  if (article.categoryId == null) return "Choose a category before submitting.";
  return null;
}
