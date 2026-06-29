// Authorization helpers — pure functions encoding the permission matrices in
// userworkflows.md (user management) and articleworkflow.md (article lifecycle).

export type Actor =
  | { id: string; role: "admin" | "editor"; status?: string }
  | null
  | undefined;

export type ArticleRef = {
  authorId: string | null;
  status: "draft" | "pending_review" | "published";
};

export const isAdmin = (actor: Actor): boolean => actor?.role === "admin";

/** Anyone may view published; otherwise only the author or an admin. */
export function canViewArticle(actor: Actor, article: ArticleRef): boolean {
  if (article.status === "published") return true;
  if (!actor) return false;
  return isAdmin(actor) || article.authorId === actor.id;
}

/** Admin edits any state; an editor edits only their own draft. */
export function canEditArticle(actor: Actor, article: ArticleRef): boolean {
  if (!actor) return false;
  if (isAdmin(actor)) return true;
  return article.authorId === actor.id && article.status === "draft";
}

/** Same rule as edit: admin any state, author their own draft. */
export const canDeleteArticle = canEditArticle;

/** Only the author can submit their own draft for review. */
export function canSubmitArticle(actor: Actor, article: ArticleRef): boolean {
  if (!actor) return false;
  return article.authorId === actor.id && article.status === "draft";
}

/** Approve / reject / unpublish are admin-only. */
export function canApproveArticle(actor: Actor): boolean {
  return isAdmin(actor);
}

/** User management (create / suspend / change role …) is admin-only. */
export function canManageUsers(actor: Actor): boolean {
  return isAdmin(actor);
}
