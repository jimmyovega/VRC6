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
