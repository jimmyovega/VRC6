// R2 media-upload helpers (pure — unit-tested in media.test.ts).

/** Largest accepted image upload. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

// Allowed image content-types → file extension.
const TYPE_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function isAllowedImageType(type: string): boolean {
  return type in TYPE_EXT;
}

/**
 * Identifies an image's real content-type from its magic bytes, independent
 * of whatever `Content-Type` the client declared on the multipart part.
 *
 * `isAllowedImageType` above only checks the client's own claim, which is
 * fully attacker-controlled — a request can declare `image/png` on a part
 * containing arbitrary bytes (HTML, JS, an executable), and it would pass
 * that check, get stored, and be re-served under the declared type. This is
 * the actual security boundary: the upload route must sniff the bytes it
 * received and use THAT to decide the stored content-type and extension,
 * never the client's declaration.
 *
 * Deliberately excludes SVG (a `data:`/script-bearing XML format) even though
 * it's a normal "image" — same reasoning as its absence from TYPE_EXT.
 */
export function sniffImageType(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "image/gif";
  }
  // WebP is a RIFF container: "RIFF" + 4-byte size + "WEBP". Checking both
  // markers (not just the RIFF prefix) excludes other RIFF-based formats
  // (WAV, AVI, etc.) from being accepted as an image.
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export function extForType(type: string): string | null {
  return TYPE_EXT[type] ?? null;
}

/** A collision-proof R2 object key for a new upload, or null for a bad type. */
export function newImageKey(type: string): string | null {
  const ext = extForType(type);
  if (!ext) return null;
  return `articles/${crypto.randomUUID()}.${ext}`;
}

/**
 * Public URL for a stored media key. In prod `MEDIA_BASE_URL` is the R2 custom
 * domain (e.g. https://media.vrc6.com); when it's unset (local dev / E2E) we
 * serve the object back through the same-origin `/media/<key>` route.
 */
export function mediaUrl(key: string, baseUrl?: string | null): string {
  const base = (baseUrl ?? "").replace(/\/+$/, "");
  return base ? `${base}/${key}` : `/media/${key}`;
}

/** The center default when no focal point is set. */
export const DEFAULT_FOCUS = "50% 50%";

/**
 * Normalize a cover focal point into a safe CSS `object-position` value of the
 * form "X% Y%", each clamped to 0–100 and rounded. Anything unparseable → null
 * (the caller treats null as center). Accepts "30% 60%", "30 60", "30%,60%".
 */
export function parseFocus(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const nums = input.match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 2) return null;
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  const x = clamp(Number(nums[0]));
  const y = clamp(Number(nums[1]));
  if (Number.isNaN(x) || Number.isNaN(y)) return null;
  return `${x}% ${y}%`;
}

/** A ready-to-use `object-position` value for rendering (focus or center). */
export function focusPosition(focus?: string | null): string {
  return parseFocus(focus) ?? DEFAULT_FOCUS;
}
