import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../../src/db";
import { getArticleStatusCounts, getArticlesByAuthor, getUserStatusCounts } from "../../src/db/queries";

// M4 Phase E — dashboard counts + the editor dashboard's status filter.
describe("dashboard stats (D1)", () => {
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
        status: "suspended",
      },
      {
        id: "u-pending",
        name: "Pending Invite",
        email: "pending@vrc6.com",
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        role: "editor",
        status: "pending_activation",
      },
    ]);

    await db.insert(schema.articles).values([
      { title: "Alice Draft", authorId: "u-alice", status: "draft", slug: "alice-draft" },
      {
        title: "Alice Sent Back",
        authorId: "u-alice",
        status: "draft",
        slug: "alice-sent-back",
        rejectionReason: "Needs a stronger intro.",
      },
      { title: "Alice Pending Review", authorId: "u-alice", status: "pending_review", slug: "alice-pending" },
      { title: "Alice Published", authorId: "u-alice", status: "published", slug: "alice-pub" },
      {
        title: "Alice Deleted Draft",
        authorId: "u-alice",
        status: "draft",
        slug: "alice-deleted",
        deletedAt: new Date(),
      },
    ]);
  });

  it("counts non-deleted articles by status", async () => {
    const db = getDb(env.DB);
    const counts = await getArticleStatusCounts(db);
    expect(counts).toEqual({ draft: 2, pending_review: 1, published: 1 });
  });

  it("counts users by status", async () => {
    const db = getDb(env.DB);
    const counts = await getUserStatusCounts(db);
    expect(counts).toEqual({
      pending_activation: 1,
      active: 1,
      suspended: 1,
      expired: 0,
      deleted: 0,
    });
  });

  it("getArticlesByAuthor filters by status and excludes soft-deleted rows", async () => {
    const db = getDb(env.DB);
    const drafts = await getArticlesByAuthor(db, "u-alice", "draft");
    expect(drafts.map((a) => a.title).sort()).toEqual(["Alice Draft", "Alice Sent Back"]);

    const all = await getArticlesByAuthor(db, "u-alice");
    expect(all.map((a) => a.title).sort()).toEqual(
      ["Alice Draft", "Alice Sent Back", "Alice Pending Review", "Alice Published"].sort(),
    );
  });

  it("getArticlesByAuthor surfaces the rejection reason", async () => {
    const db = getDb(env.DB);
    const drafts = await getArticlesByAuthor(db, "u-alice", "draft");
    const sentBack = drafts.find((a) => a.title === "Alice Sent Back");
    expect(sentBack?.rejectionReason).toBe("Needs a stronger intro.");
    expect(drafts.find((a) => a.title === "Alice Draft")?.rejectionReason).toBeNull();
  });
});
