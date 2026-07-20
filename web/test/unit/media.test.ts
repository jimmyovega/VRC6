import { describe, expect, it } from "vitest";
import {
  DEFAULT_FOCUS,
  extForType,
  focusPosition,
  isAllowedImageType,
  mediaUrl,
  newImageKey,
  parseFocus,
} from "../../src/lib/media";

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

  it("parseFocus normalizes and clamps a focal point, else null", () => {
    expect(parseFocus("30% 60%")).toBe("30% 60%");
    expect(parseFocus("30 60")).toBe("30% 60%"); // tolerant of missing %
    expect(parseFocus("30.7% 59.2%")).toBe("31% 59%"); // rounded
    expect(parseFocus("-10% 140%")).toBe("0% 100%"); // clamped
    expect(parseFocus("50%")).toBeNull(); // needs both axes
    expect(parseFocus("")).toBeNull();
    expect(parseFocus(null)).toBeNull();
    expect(parseFocus(42)).toBeNull();
  });

  it("focusPosition falls back to center for missing/invalid focus", () => {
    expect(focusPosition("25% 75%")).toBe("25% 75%");
    expect(focusPosition(null)).toBe(DEFAULT_FOCUS);
    expect(focusPosition("garbage")).toBe(DEFAULT_FOCUS);
    expect(DEFAULT_FOCUS).toBe("50% 50%");
  });
});
