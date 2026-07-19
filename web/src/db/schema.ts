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
  // TOTP 2FA (M2 Phase D2) — managed by the better-auth twoFactor plugin.
  twoFactorEnabled: integer("two_factor_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  // lifecycle timestamps (M2 Phase C)
  activatedAt: integer("activated_at", { mode: "timestamp" }),
  suspendedAt: integer("suspended_at", { mode: "timestamp" }),
  expiredAt: integer("expired_at", { mode: "timestamp" }),
  deletedAt: integer("deleted_at", { mode: "timestamp" }),
});

// TOTP secret + backup codes for 2FA (better-auth twoFactor plugin owns this).
export const twoFactor = sqliteTable("two_factor", {
  id: text("id").primaryKey(),
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  verified: integer("verified", { mode: "boolean" }).notNull().default(true),
  failedVerificationCount: integer("failed_verification_count").notNull().default(0),
  lockedUntil: integer("locked_until", { mode: "timestamp" }),
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
  // M4: soft-delete (preserves audit refs; excluded from all list queries) and
  // a single-at-a-time homepage feature flag.
  featured: integer("featured", { mode: "boolean" }).notNull().default(false),
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
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

// Fixed-window rate-limit counters for auth endpoints (M2 Phase D3).
// Keyed by `${ip}:${path}`; `resetAt` is when the current window expires.
export const authRateLimit = sqliteTable("auth_rate_limit", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  resetAt: integer("reset_at", { mode: "timestamp_ms" }).notNull(),
});

// Single-row site-wide toggles. Always read/written at id=1; a missing row
// means every toggle is at its default (off).
export const siteSettings = sqliteTable("site_settings", {
  id: integer("id").primaryKey(),
  maintenanceMode: integer("maintenance_mode", { mode: "boolean" }).notNull().default(false),
  maintenanceMessage: text("maintenance_message"),
  updatedAt,
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
