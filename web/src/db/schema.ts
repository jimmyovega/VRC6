// VRC6 database schema (Cloudflare D1 / SQLite). Drizzle ORM is the query layer.
//
// Auth (M2): better-auth owns `user` / `session` / `account` / `verification`.
// The Drizzle property keys must match better-auth's camelCase field names; the
// SQL column names stay snake_case. `user` is extended with our app fields
// (role, status, username, bio). App tables reference the text `user.id`.

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
  "photography",
] as const;

// Reusable app timestamp columns (epoch milliseconds).
const createdAt = integer("created_at", { mode: "timestamp_ms" })
  .notNull()
  .default(sql`(unixepoch() * 1000)`);
const updatedAt = integer("updated_at", { mode: "timestamp_ms" })
  .notNull()
  .default(sql`(unixepoch() * 1000)`);

// ===================== better-auth tables =====================

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  // --- extended app fields ---
  role: text("role", { enum: USER_ROLES }).notNull().default("editor"),
  status: text("status", { enum: USER_STATUSES }).notNull().default("pending_activation"),
  username: text("username").unique(),
  bio: text("bio"),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

// ===================== app tables =====================

// dbml modeled this as just an enum `type`; we add slug + label for browsing/SEO (M1).
export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type", { enum: CATEGORY_TYPES }).notNull().unique(),
  slug: text("slug").notNull().unique(),
  label: text("label").notNull(),
});

// `body` holds the block-editor (BlockNote/TipTap) document as JSON (M3).
export const articles = sqliteTable("articles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  excerpt: text("excerpt"),
  body: text("body", { mode: "json" }),
  featuredImageKey: text("featured_image_key"), // R2 object key (M3)
  authorId: text("author_id").references(() => user.id),
  categoryId: integer("category_id").references(() => categories.id),
  status: text("status", { enum: ARTICLE_STATUSES }).notNull().default("draft"),
  slug: text("slug").notNull().unique(),
  rejectionReason: text("rejection_reason"),
  createdAt,
  updatedAt,
  publishedAt: integer("published_at", { mode: "timestamp_ms" }),
});

// Activation / password reset / email change tokens (lifecycle work in Phase C).
export const tokens = sqliteTable("tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  tokenHash: text("token_hash").notNull(),
  type: text("type", { enum: TOKEN_TYPES }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt,
});

// Append-only trail of user + article actions.
export const audits = sqliteTable("audits", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actorId: text("actor_id").references(() => user.id),
  action: text("action").notNull(),
  targetUserId: text("target_user_id").references(() => user.id),
  targetArticleId: integer("target_article_id").references(() => articles.id),
  details: text("details", { mode: "json" }),
  createdAt,
});

// Convenience types
export type User = typeof user.$inferSelect;
export type Article = typeof articles.$inferSelect;
export type Category = typeof categories.$inferSelect;
