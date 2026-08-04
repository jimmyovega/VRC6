import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { POST } from "../../src/pages/api/uploads";
import { sniffImageType } from "../../src/lib/media";

// A real 1x1 transparent PNG (same fixture used by e2e/editor.spec.ts).
const PNG_BYTES = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

function uploadRequest(bytes: Uint8Array, filename: string, type: string): Request {
  const form = new FormData();
  form.set("file", new File([bytes], filename, { type }));
  return new Request("http://vrc6.test/api/uploads", { method: "POST", body: form });
}

// Integration tests run against a real (isolated) R2 + Images binding, both
// read from wrangler.jsonc — no mocking of the conversion step itself.
describe("POST /api/uploads (R2 + Images binding)", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await POST({
      request: uploadRequest(PNG_BYTES, "pixel.png", "image/png"),
      locals: { user: null },
    } as never);
    expect(res.status).toBe(401);
  });

  it("converts an uploaded PNG to a genuine stored WebP", async () => {
    const res = await POST({
      request: uploadRequest(PNG_BYTES, "pixel.png", "image/png"),
      locals: { user: { id: "u-test" } },
    } as never);
    expect(res.status).toBe(201);

    const body = (await res.json()) as { url: string; key: string };
    expect(body.key).toMatch(/^articles\/[0-9a-f-]{36}\.webp$/);
    expect(body.url).toContain(body.key);

    const stored = await env.MEDIA.get(body.key);
    expect(stored).not.toBeNull();
    expect(stored!.httpMetadata?.contentType).toBe("image/webp");

    const storedBytes = new Uint8Array(await stored!.arrayBuffer());
    // Proves the bytes were actually re-encoded, not just renamed — sniffing
    // the real magic bytes (not trusting the stored content-type metadata)
    // confirms this is a genuine WebP file.
    expect(sniffImageType(storedBytes)).toBe("image/webp");
  });
});
