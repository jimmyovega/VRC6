import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../../src/db";

// Integration tests run against a real (isolated) D1 instance with migrations applied.
describe("articles data access (D1)", () => {
  beforeEach(async () => {
    const db = getDb(env.DB);
    await db.insert(schema.user).values({
      id: "u-admin",
      name: "Admin",
      email: "admin@vrc6.com",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      role: "admin",
      status: "active",
    });
    await db
      .insert(schema.categories)
      .values({ type: "events", slug: "events", label: "Events" });
  });

  it("returns only published articles", async () => {
    const db = getDb(env.DB);
    const [author] = await db.select().from(schema.user);
    const [category] = await db.select().from(schema.categories);

    await db.insert(schema.articles).values([
      {
        title: "Live one",
        slug: "live-one",
        status: "published",
        authorId: author.id,
        categoryId: category.id,
        publishedAt: new Date(),
      },
      {
        title: "Still a draft",
        slug: "still-a-draft",
        status: "draft",
        authorId: author.id,
        categoryId: category.id,
      },
    ]);

    const published = await db
      .select()
      .from(schema.articles)
      .where(eq(schema.articles.status, "published"));

    expect(published).toHaveLength(1);
    expect(published[0].title).toBe("Live one");
  });

  it("enforces the unique slug constraint", async () => {
    const db = getDb(env.DB);
    const [author] = await db.select().from(schema.user);

    await db
      .insert(schema.articles)
      .values({ title: "First", slug: "dupe", status: "draft", authorId: author.id });

    await expect(
      db
        .insert(schema.articles)
        .values({ title: "Second", slug: "dupe", status: "draft", authorId: author.id }),
    ).rejects.toThrow();
  });
});
