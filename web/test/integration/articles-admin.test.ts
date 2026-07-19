import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../../src/db";
import { getArticlesForAdmin, getAuthorOptions } from "../../src/db/queries";

describe("admin article console query (D1)", () => {
  beforeEach(async () => {
    const db = getDb(env.DB);
    await db.insert(schema.user).values([
      {
        id: "u-alice",
        name: "Alice",
        email: "alice@vrc6.com",
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        role: "editor",
        status: "active",
      },
      {
        id: "u-bob",
        name: "Bob",
        email: "bob@vrc6.com",
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        role: "editor",
        status: "active",
      },
    ]);
    await db.insert(schema.categories).values([
      { type: "games", slug: "games", label: "Games" },
      { type: "art", slug: "art", label: "Art" },
    ]);
    const cats = await db.select().from(schema.categories);
    const gamesId = cats.find((c) => c.slug === "games")!.id;
    const artId = cats.find((c) => c.slug === "art")!.id;

    await db.insert(schema.articles).values([
      { title: "Alice Draft", authorId: "u-alice", categoryId: gamesId, status: "draft", slug: "alice-draft" },
      {
        title: "Alice Published Game",
        authorId: "u-alice",
        categoryId: gamesId,
        status: "published",
        slug: "alice-pub-game",
      },
      {
        title: "Bob Published Art",
        authorId: "u-bob",
        categoryId: artId,
        status: "published",
        slug: "bob-pub-art",
      },
      {
        title: "Bob Deleted",
        authorId: "u-bob",
        categoryId: artId,
        status: "draft",
        slug: "bob-deleted",
        deletedAt: new Date(),
      },
    ]);
  });

  it("excludes soft-deleted articles and returns the rest with a matching total", async () => {
    const db = getDb(env.DB);
    const { rows, total } = await getArticlesForAdmin(db, {}, 20, 0);
    expect(total).toBe(3);
    expect(rows.map((r) => r.title).sort()).toEqual(
      ["Alice Draft", "Alice Published Game", "Bob Published Art"].sort(),
    );
  });

  it("filters by status", async () => {
    const db = getDb(env.DB);
    const { rows, total } = await getArticlesForAdmin(db, { status: "published" }, 20, 0);
    expect(total).toBe(2);
    expect(rows.every((r) => r.status === "published")).toBe(true);
  });

  it("filters by author", async () => {
    const db = getDb(env.DB);
    const { rows, total } = await getArticlesForAdmin(db, { authorId: "u-bob" }, 20, 0);
    expect(total).toBe(1);
    expect(rows[0].author).toBe("Bob");
  });

  it("filters by category", async () => {
    const db = getDb(env.DB);
    const cats = await db.select().from(schema.categories);
    const artId = cats.find((c) => c.slug === "art")!.id;
    const { rows, total } = await getArticlesForAdmin(db, { categoryId: artId }, 20, 0);
    expect(total).toBe(1);
    expect(rows[0].title).toBe("Bob Published Art");
  });

  it("searches by title substring", async () => {
    const db = getDb(env.DB);
    const { rows, total } = await getArticlesForAdmin(db, { q: "Published" }, 20, 0);
    expect(total).toBe(2);
    expect(rows.every((r) => r.title.includes("Published"))).toBe(true);
  });

  it("paginates with a stable total across pages", async () => {
    const db = getDb(env.DB);
    const page1 = await getArticlesForAdmin(db, {}, 2, 0);
    const page2 = await getArticlesForAdmin(db, {}, 2, 2);
    expect(page1.total).toBe(3);
    expect(page2.total).toBe(3);
    expect(page1.rows).toHaveLength(2);
    expect(page2.rows).toHaveLength(1);
  });

  it("lists non-deleted users for the author filter", async () => {
    const db = getDb(env.DB);
    const authors = await getAuthorOptions(db);
    expect(authors.map((a) => a.name).sort()).toEqual(["Alice", "Bob"]);
  });
});
