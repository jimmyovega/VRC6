import { describe, expect, it } from "vitest";
import {
  canApproveArticle,
  canEditArticle,
  canManageUsers,
  canSubmitArticle,
  canViewArticle,
  isAdmin,
} from "../../src/lib/permissions";

const admin = { id: "a", role: "admin" as const };
const editor = { id: "e", role: "editor" as const };

const draftByEditor = { authorId: "e", status: "draft" as const };
const draftByOther = { authorId: "x", status: "draft" as const };
const pendingByEditor = { authorId: "e", status: "pending_review" as const };
const published = { authorId: "x", status: "published" as const };

describe("permissions", () => {
  it("isAdmin", () => {
    expect(isAdmin(admin)).toBe(true);
    expect(isAdmin(editor)).toBe(false);
    expect(isAdmin(null)).toBe(false);
  });

  it("canViewArticle: published is public; drafts are author/admin only", () => {
    expect(canViewArticle(null, published)).toBe(true);
    expect(canViewArticle(null, draftByOther)).toBe(false);
    expect(canViewArticle(editor, draftByEditor)).toBe(true);
    expect(canViewArticle(editor, draftByOther)).toBe(false);
    expect(canViewArticle(admin, draftByOther)).toBe(true);
  });

  it("canEditArticle: admin any state; editor own draft only", () => {
    expect(canEditArticle(editor, draftByEditor)).toBe(true);
    expect(canEditArticle(editor, draftByOther)).toBe(false);
    expect(canEditArticle(editor, pendingByEditor)).toBe(false);
    expect(canEditArticle(admin, published)).toBe(true);
    expect(canEditArticle(null, draftByEditor)).toBe(false);
  });

  it("canSubmitArticle: author submits own draft only", () => {
    expect(canSubmitArticle(editor, draftByEditor)).toBe(true);
    expect(canSubmitArticle(editor, draftByOther)).toBe(false);
    expect(canSubmitArticle(editor, pendingByEditor)).toBe(false);
  });

  it("approve + user management are admin-only", () => {
    expect(canApproveArticle(admin)).toBe(true);
    expect(canApproveArticle(editor)).toBe(false);
    expect(canManageUsers(admin)).toBe(true);
    expect(canManageUsers(editor)).toBe(false);
  });
});
