// Reusable, typed D1 queries for the public reading experience (M1).
import { and, desc, eq } from "drizzle-orm";
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
};

/** All published articles, newest first (home page). */
export function getPublishedArticles(db: DB) {
  return db
    .select(cardColumns)
    .from(schema.articles)
    .leftJoin(schema.categories, eq(schema.articles.categoryId, schema.categories.id))
    .where(eq(schema.articles.status, "published"))
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
      and(eq(schema.articles.status, "published"), eq(schema.categories.slug, categorySlug)),
    )
    .orderBy(desc(schema.articles.publishedAt));
}

/** A single published article by slug (with author + category), or null. */
export async function getPublishedArticleBySlug(db: DB, slug: string) {
  const [row] = await db
    .select({
      ...cardColumns,
      body: schema.articles.body,
      author: schema.users.fullName,
      authorUsername: schema.users.username,
    })
    .from(schema.articles)
    .leftJoin(schema.categories, eq(schema.articles.categoryId, schema.categories.id))
    .leftJoin(schema.users, eq(schema.articles.authorId, schema.users.id))
    .where(and(eq(schema.articles.slug, slug), eq(schema.articles.status, "published")))
    .limit(1);
  return row ?? null;
}
