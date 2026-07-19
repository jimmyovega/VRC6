// Reusable, typed D1 queries for the public reading experience (M1).
import { and, count, desc, eq, isNull, like, ne } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./schema";

type DB = DrizzleD1Database<typeof schema>;

// Shared column selection for article cards/lists.
const cardColumns = {
  id: schema.articles.id,
  title: schema.articles.title,
  excerpt: schema.articles.excerpt,
  slug: schema.articles.slug,
  category: schema.categories.label,
  categorySlug: schema.categories.slug,
  publishedAt: schema.articles.publishedAt,
  featured: schema.articles.featured,
  featuredImageKey: schema.articles.featuredImageKey,
};

/** All published articles, newest first (home page). */
export function getPublishedArticles(db: DB) {
  return db
    .select(cardColumns)
    .from(schema.articles)
    .leftJoin(schema.categories, eq(schema.articles.categoryId, schema.categories.id))
    .where(and(eq(schema.articles.status, "published"), isNull(schema.articles.deletedAt)))
    .orderBy(desc(schema.articles.publishedAt));
}

/** All categories (for chips / browse nav), alphabetical. */
export function getCategories(db: DB) {
  return db
    .select({ slug: schema.categories.slug, label: schema.categories.label })
    .from(schema.categories)
    .orderBy(schema.categories.label);
}

/** A single category by slug, or null. */
export async function getCategoryBySlug(db: DB, slug: string) {
  const [row] = await db
    .select()
    .from(schema.categories)
    .where(eq(schema.categories.slug, slug))
    .limit(1);
  return row ?? null;
}

/** Published articles within a category, newest first. */
export function getArticlesByCategory(db: DB, categorySlug: string) {
  return db
    .select(cardColumns)
    .from(schema.articles)
    .innerJoin(schema.categories, eq(schema.articles.categoryId, schema.categories.id))
    .where(
      and(
        eq(schema.articles.status, "published"),
        eq(schema.categories.slug, categorySlug),
        isNull(schema.articles.deletedAt),
      ),
    )
    .orderBy(desc(schema.articles.publishedAt));
}

/** An author's own articles (optionally filtered by status), newest-touched first — dashboard list. */
export function getArticlesByAuthor(
  db: DB,
  authorId: string,
  status?: (typeof schema.ARTICLE_STATUSES)[number],
) {
  const conditions = [eq(schema.articles.authorId, authorId), isNull(schema.articles.deletedAt)];
  if (status) conditions.push(eq(schema.articles.status, status));
  return db
    .select({
      id: schema.articles.id,
      title: schema.articles.title,
      status: schema.articles.status,
      slug: schema.articles.slug,
      updatedAt: schema.articles.updatedAt,
      category: schema.categories.label,
      rejectionReason: schema.articles.rejectionReason,
    })
    .from(schema.articles)
    .leftJoin(schema.categories, eq(schema.articles.categoryId, schema.categories.id))
    .where(and(...conditions))
    .orderBy(desc(schema.articles.updatedAt));
}

/** Articles awaiting review (oldest first — FIFO), with author + category. */
export function getArticlesForReview(db: DB) {
  return db
    .select({
      id: schema.articles.id,
      title: schema.articles.title,
      updatedAt: schema.articles.updatedAt,
      author: schema.user.name,
      category: schema.categories.label,
    })
    .from(schema.articles)
    .leftJoin(schema.user, eq(schema.articles.authorId, schema.user.id))
    .leftJoin(schema.categories, eq(schema.articles.categoryId, schema.categories.id))
    .where(and(eq(schema.articles.status, "pending_review"), isNull(schema.articles.deletedAt)))
    .orderBy(schema.articles.updatedAt);
}

export interface ArticleAdminFilters {
  status?: (typeof schema.ARTICLE_STATUSES)[number];
  authorId?: string;
  categoryId?: number;
  q?: string;
}

/** All non-deleted articles for the admin console, with filters + pagination. */
export async function getArticlesForAdmin(
  db: DB,
  filters: ArticleAdminFilters,
  limit: number,
  offset: number,
) {
  const conditions = [isNull(schema.articles.deletedAt)];
  if (filters.status) conditions.push(eq(schema.articles.status, filters.status));
  if (filters.authorId) conditions.push(eq(schema.articles.authorId, filters.authorId));
  if (filters.categoryId != null) conditions.push(eq(schema.articles.categoryId, filters.categoryId));
  if (filters.q) conditions.push(like(schema.articles.title, `%${filters.q}%`));
  const where = and(...conditions);

  const [rows, totalRows] = await Promise.all([
    db
      .select({
        id: schema.articles.id,
        title: schema.articles.title,
        status: schema.articles.status,
        slug: schema.articles.slug,
        featured: schema.articles.featured,
        updatedAt: schema.articles.updatedAt,
        author: schema.user.name,
        category: schema.categories.label,
      })
      .from(schema.articles)
      .leftJoin(schema.user, eq(schema.articles.authorId, schema.user.id))
      .leftJoin(schema.categories, eq(schema.articles.categoryId, schema.categories.id))
      .where(where)
      .orderBy(desc(schema.articles.updatedAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(schema.articles).where(where),
  ]);

  return { rows, total: totalRows[0]?.total ?? 0 };
}

/** Non-deleted article counts by status, for the admin dashboard. */
export async function getArticleStatusCounts(db: DB) {
  const rows = await db
    .select({ status: schema.articles.status, n: count() })
    .from(schema.articles)
    .where(isNull(schema.articles.deletedAt))
    .groupBy(schema.articles.status);
  const counts = Object.fromEntries(schema.ARTICLE_STATUSES.map((s) => [s, 0])) as Record<
    (typeof schema.ARTICLE_STATUSES)[number],
    number
  >;
  for (const r of rows) counts[r.status] = r.n;
  return counts;
}

/** User counts by status, for the admin dashboard. */
export async function getUserStatusCounts(db: DB) {
  const rows = await db
    .select({ status: schema.user.status, n: count() })
    .from(schema.user)
    .groupBy(schema.user.status);
  const counts = Object.fromEntries(schema.USER_STATUSES.map((s) => [s, 0])) as Record<
    (typeof schema.USER_STATUSES)[number],
    number
  >;
  for (const r of rows) counts[r.status] = r.n;
  return counts;
}

/** Authors (non-deleted users) for the admin console's author filter. */
export function getAuthorOptions(db: DB) {
  return db
    .select({ id: schema.user.id, name: schema.user.name })
    .from(schema.user)
    .where(ne(schema.user.status, "deleted"))
    .orderBy(schema.user.name);
}

/** Category options (id + label) for the editor's category picker. */
export function getCategoryOptions(db: DB) {
  return db
    .select({ id: schema.categories.id, label: schema.categories.label })
    .from(schema.categories)
    .orderBy(schema.categories.label);
}

/** A single article by id (all fields) — for the editor / permission checks. */
export async function getArticleById(db: DB, id: number) {
  const [row] = await db
    .select()
    .from(schema.articles)
    .where(and(eq(schema.articles.id, id), isNull(schema.articles.deletedAt)))
    .limit(1);
  return row ?? null;
}

/** A single published article by slug (with author + category), or null. */
export async function getPublishedArticleBySlug(db: DB, slug: string) {
  const [row] = await db
    .select({
      ...cardColumns,
      body: schema.articles.body,
      author: schema.user.name,
      authorUsername: schema.user.username,
    })
    .from(schema.articles)
    .leftJoin(schema.categories, eq(schema.articles.categoryId, schema.categories.id))
    .leftJoin(schema.user, eq(schema.articles.authorId, schema.user.id))
    .where(
      and(
        eq(schema.articles.slug, slug),
        eq(schema.articles.status, "published"),
        isNull(schema.articles.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}
