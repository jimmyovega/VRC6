// VRC6 database schema (Cloudflare D1 / SQLite) — ported from ../../datamodel.dbml
// and enriched with the user/article state fields described in userworkflows.md and
// articleworkflow.md. Drizzle ORM is the query layer.

import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// --- Enumerated values (kept as TS unions; SQLite has no native enum) ---
export const USER_ROLES = ["admin", "editor"] as const;
export const USER_STATUSES = [
  "pending_activation",
  "active",
  "suspended",
  "expired",
  "deleted",
] as const;
export const ARTICLE_STATUSES = ["draft", "pending_review", "published"] as const;
export const TOKEN_TYPES = ["activation", "password_reset", "email_change"] as const;
export const CATEGORY_TYPES = [
  "art",
  "locales",
  "artists",
  "events",
  "interviews",
  "opinions",
  "games",
  "photoshoots",
] as const;

// Reusable timestamp columns (epoch milliseconds).
const createdAt = integer("created_at", { mode: "timestamp_ms" })
  .notNull()
  .default(sql`(unixepoch() * 1000)`);
const updatedAt = integer("updated_at", { mode: "timestamp_ms" })
  .notNull()
  .default(sql`(unixepoch() * 1000)`);

// --- users ---
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").unique(),
  email: text("email").notNull().unique(),
  fullName: text("full_name"),
  bio: text("bio"),
  role: text("role", { enum: USER_ROLES }).notNull().default("editor"),
  status: text("status", { enum: USER_STATUSES }).notNull().default("pending_activation"),
  // Auth — password hashing handled by the auth layer (M2); never store plaintext.
  passwordHash: text("password_hash"),
  // 2FA (M2)
  totpSecret: text("totp_secret"),
  createdAt,
  updatedAt,
  activatedAt: integer("activated_at", { mode: "timestamp_ms" }),
  suspendedAt: integer("suspended_at", { mode: "timestamp_ms" }),
  expiredAt: integer("expired_at", { mode: "timestamp_ms" }),
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
});

// --- categories ---
// dbml modeled this as just an enum `type`; we add slug + label for browsing/SEO (M1).
export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type", { enum: CATEGORY_TYPES }).notNull().unique(),
  slug: text("slug").notNull().unique(),
  label: text("label").notNull(),
});

// --- articles ---
// `body` holds the block-editor (BlockNote/TipTap) document as JSON (M3).
export const articles = sqliteTable("articles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  excerpt: text("excerpt"),
  body: text("body", { mode: "json" }),
  featuredImageKey: text("featured_image_key"), // R2 object key (M3)
  authorId: integer("author_id").references(() => users.id),
  categoryId: integer("category_id").references(() => categories.id),
  status: text("status", { enum: ARTICLE_STATUSES }).notNull().default("draft"),
  slug: text("slug").notNull().unique(),
  rejectionReason: text("rejection_reason"),
  createdAt,
  updatedAt,
  publishedAt: integer("published_at", { mode: "timestamp_ms" }),
});

// --- tokens (activation / password reset / email change) ---
export const tokens = sqliteTable("tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  tokenHash: text("token_hash").notNull(),
  type: text("type", { enum: TOKEN_TYPES }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt,
});

// --- audits (append-only trail of user + article actions) ---
export const audits = sqliteTable("audits", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actorId: integer("actor_id").references(() => users.id),
  action: text("action").notNull(),
  targetUserId: integer("target_user_id").references(() => users.id),
  targetArticleId: integer("target_article_id").references(() => articles.id),
  details: text("details", { mode: "json" }),
  createdAt,
});

// Convenience types
export type User = typeof users.$inferSelect;
export type Article = typeof articles.$inferSelect;
export type Category = typeof categories.$inferSelect;
