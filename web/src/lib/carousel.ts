// Deterministic carousel sizing — shared by the server renderer (lib/body.ts)
// and the editor's NodeView so the draft and the published page match.
//
// The requirement: "resize toward the height of the smallest landscape image."
// In a fixed-width column, an image shown at full column width has display
// height ∝ 1/aspectRatio, so the *shortest* landscape image is the one with the
// *largest* landscape aspect ratio. We therefore size the carousel viewport to
// `max(landscape aspect ratios)` and let every slide `object-fit: contain`
// within it: wider images fill it, taller/portrait images scale down to that
// height (letterboxed narrower). Pure CSS — no layout JS, responsive, SEO-safe.

export interface CarouselImage {
  src?: unknown;
  alt?: unknown;
  w?: unknown;
  h?: unknown;
}

// Clamp the emitted ratio to a sane band so a hostile or degenerate w/h can
// never produce wild layout — and, more importantly, so the value interpolated
// into `aspect-ratio:<n>` is always a plain finite number (CSS-injection guard,
// same spirit as the alignment allowlist).
const MIN_AR = 0.5;
const MAX_AR = 4;
const DEFAULT_AR = 1.5; // 3:2 — a reasonable landscape default when we can't tell

function ratioOf(im: CarouselImage): number | null {
  const w = im?.w;
  const h = im?.h;
  if (typeof w !== "number" || typeof h !== "number") return null;
  if (!Number.isFinite(w) || !Number.isFinite(h) || h <= 0 || w <= 0) return null;
  return w / h;
}

/**
 * The carousel viewport's aspect ratio (width ÷ height): the largest landscape
 * ratio, or — with no landscape image — the largest ratio present, or a sane
 * default when no dimensions are known. Always a finite number in [MIN, MAX].
 */
export function carouselAspectRatio(images: CarouselImage[]): number {
  const ratios = (Array.isArray(images) ? images : [])
    .map(ratioOf)
    .filter((n): n is number => n !== null);
  if (ratios.length === 0) return DEFAULT_AR;
  const landscape = ratios.filter((a) => a > 1);
  const pick = landscape.length ? Math.max(...landscape) : Math.max(...ratios);
  return Math.min(MAX_AR, Math.max(MIN_AR, pick));
}

/** The aspect ratio formatted for a CSS `aspect-ratio` value (safe, numeric). */
export function carouselAspectRatioCss(images: CarouselImage[]): string {
  return carouselAspectRatio(images).toFixed(4);
}
