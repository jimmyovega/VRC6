import { describe, expect, it } from "vitest";
import { extForType, isAllowedImageType, mediaUrl, newImageKey } from "../../src/lib/media";

describe("media helpers", () => {
  it("accepts the allowed image types and rejects others", () => {
    for (const t of ["image/jpeg", "image/png", "image/webp", "image/gif"]) {
      expect(isAllowedImageType(t)).toBe(true);
    }
    expect(isAllowedImageType("image/svg+xml")).toBe(false);
    expect(isAllowedImageType("application/pdf")).toBe(false);
    expect(isAllowedImageType("")).toBe(false);
  });

  it("maps content-types to extensions", () => {
    expect(extForType("image/jpeg")).toBe("jpg");
    expect(extForType("image/png")).toBe("png");
    expect(extForType("text/plain")).toBeNull();
  });

  it("builds a keyed path for allowed types, null otherwise", () => {
    const key = newImageKey("image/png");
    expect(key).toMatch(/^articles\/[0-9a-f-]{36}\.png$/);
    expect(newImageKey("image/svg+xml")).toBeNull();
  });

  it("builds the public URL from a base, or falls back to the /media route", () => {
    expect(mediaUrl("articles/x.png", "https://media.vrc6.com")).toBe(
      "https://media.vrc6.com/articles/x.png",
    );
    // trailing slash on the base is normalised
    expect(mediaUrl("articles/x.png", "https://media.vrc6.com/")).toBe(
      "https://media.vrc6.com/articles/x.png",
    );
    expect(mediaUrl("articles/x.png")).toBe("/media/articles/x.png");
    expect(mediaUrl("articles/x.png", "")).toBe("/media/articles/x.png");
  });
});
