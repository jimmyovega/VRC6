import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../../src/db";
import {
  getArticlesByCategory,
  getCategoryBySlug,
  getPublishedArticleBySlug,
  getPublishedArticles,
} from "../../src/db/queries";

// Exercises the M1 reading-path query helpers against a real isolated D1.
describe("M1 query helpers (D1)", () => {
  beforeEach(async () => {
    const db = getDb(env.DB);
    await db.insert(schema.user).values({
      id: "u-admin",
      name: "Admin",
      username: "admin",
      email: "admin@vrc6.com",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      role: "admin",
      status: "active",
    });
    await db.insert(schema.categories).values([
      { type: "events", slug: "events", label: "Events" },
      { type: "art", slug: "art", label: "Art" },
    ]);

    const [author] = await db.select().from(schema.user);
    const cats = await db.select().from(schema.categories);
    const events = cats.find((c) => c.slug === "events")!;
    const art = cats.find((c) => c.slug === "art")!;

    await db.insert(schema.articles).values([
      { title: "Live Event", slug: "live-event", status: "published", authorId: author.id, categoryId: events.id, publishedAt: new Date(), featuredImageKey: "covers/live-event.jpg", featuredImageFocus: "40% 20%" },
      { title: "Draft Event", slug: "draft-event", status: "draft", authorId: author.id, categoryId: events.id },
      { title: "Live Art", slug: "live-art", status: "published", authorId: author.id, categoryId: art.id, publishedAt: new Date() },
    ]);
  });

  it("getPublishedArticles returns only published, with category labels", async () => {
    const db = getDb(env.DB);
    const rows = await getPublishedArticles(db);
    expect(rows.map((r) => r.slug).sort()).toEqual(["live-art", "live-event"]);
    expect(rows.every((r) => r.category)).toBe(true);
  });

  it("carries featuredImageKey + focus through the shared card columns", async () => {
    const db = getDb(env.DB);
    const rows = await getPublishedArticles(db);
    const liveEvent = rows.find((r) => r.slug === "live-event");
    expect(liveEvent?.featuredImageKey).toBe("covers/live-event.jpg");
    expect(liveEvent?.featuredImageFocus).toBe("40% 20%");
    expect(rows.find((r) => r.slug === "live-art")?.featuredImageKey).toBeNull();

    const events = await getArticlesByCategory(db, "events");
    expect(events[0]?.featuredImageKey).toBe("covers/live-event.jpg");
    expect(events[0]?.featuredImageFocus).toBe("40% 20%");

    const article = await getPublishedArticleBySlug(db, "live-event");
    expect(article?.featuredImageKey).toBe("covers/live-event.jpg");
    expect(article?.featuredImageFocus).toBe("40% 20%");
  });

  it("getArticlesByCategory filters by category and excludes drafts", async () => {
    const db = getDb(env.DB);
    const events = await getArticlesByCategory(db, "events");
    expect(events.map((r) => r.slug)).toEqual(["live-event"]);

    const art = await getArticlesByCategory(db, "art");
    expect(art.map((r) => r.slug)).toEqual(["live-art"]);
  });

  it("getPublishedArticleBySlug returns published article with author + body", async () => {
    const db = getDb(env.DB);
    const article = await getPublishedArticleBySlug(db, "live-event");
    expect(article?.title).toBe("Live Event");
    expect(article?.author).toBe("Admin"); // user.name
    expect(article?.authorUsername).toBe("admin");
  });

  it("getPublishedArticleBySlug returns null for a draft or unknown slug", async () => {
    const db = getDb(env.DB);
    expect(await getPublishedArticleBySlug(db, "draft-event")).toBeNull();
    expect(await getPublishedArticleBySlug(db, "does-not-exist")).toBeNull();
  });

  it("getCategoryBySlug returns a category or null", async () => {
    const db = getDb(env.DB);
    expect((await getCategoryBySlug(db, "events"))?.label).toBe("Events");
    expect(await getCategoryBySlug(db, "nope")).toBeNull();
  });
});
