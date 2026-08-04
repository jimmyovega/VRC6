import { describe, expect, it } from "vitest";
import {
  DEFAULT_FOCUS,
  extForType,
  focusPosition,
  isAllowedImageType,
  mediaUrl,
  newImageKey,
  parseFocus,
  sniffImageType,
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

describe("sniffImageType", () => {
  // This is the actual security boundary the upload route relies on — the
  // client's declared Content-Type is fully attacker-controlled, so the route
  // must identify the real type from bytes. Every fixture below is the real
  // magic-byte prefix of that format, not a guess.
  const bytes = (...vals: number[]) => new Uint8Array(vals);

  it("identifies a real JPEG (FF D8 FF)", () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0))).toBe("image/jpeg");
  });

  it("identifies a real PNG (the full 8-byte signature)", () => {
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(
      "image/png",
    );
  });

  it("identifies both GIF sub-versions (87a and 89a)", () => {
    const gif = (v: number) => bytes(0x47, 0x49, 0x46, 0x38, v, 0x61);
    expect(sniffImageType(gif(0x37))).toBe("image/gif"); // GIF87a
    expect(sniffImageType(gif(0x39))).toBe("image/gif"); // GIF89a
  });

  it("identifies WebP by both the RIFF and WEBP markers", () => {
    // "RIFF" + 4-byte size (arbitrary) + "WEBP"
    const webp = bytes(
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    );
    expect(sniffImageType(webp)).toBe("image/webp");
  });

  it("rejects a RIFF file that isn't WebP (e.g. WAV) — checking RIFF alone isn't enough", () => {
    const wav = bytes(0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45);
    expect(sniffImageType(wav)).toBeNull();
  });

  it("rejects plain text, HTML, and other non-image content, however the part was labeled", () => {
    const asBytes = (s: string) => new TextEncoder().encode(s);
    expect(sniffImageType(asBytes("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(sniffImageType(asBytes("just some text"))).toBeNull();
    expect(sniffImageType(asBytes("MZ"))).toBeNull(); // PE/EXE header start
  });

  it("rejects SVG — a script-bearing XML format, deliberately not in the allowlist", () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(sniffImageType(svg)).toBeNull();
  });

  it("rejects a buffer too short to contain any valid signature", () => {
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
    expect(sniffImageType(bytes(0x89, 0x50))).toBeNull(); // truncated PNG signature
    expect(sniffImageType(bytes(0xff, 0xd8))).toBeNull(); // truncated JPEG signature
  });

  it("rejects a near-miss on a real signature (one byte off)", () => {
    // Valid PNG signature with the last byte corrupted.
    const almostPng = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x00);
    expect(sniffImageType(almostPng)).toBeNull();
  });
});
