import { describe, expect, it } from "vitest";
import { carouselAspectRatio, carouselAspectRatioCss } from "../../src/lib/carousel";

describe("carouselAspectRatio", () => {
  it("picks the largest landscape ratio (the shortest landscape image)", () => {
    // 3:2 (1.5) and 2:1 (2.0) are landscape; portrait 3:4 ignored for the pick.
    const ar = carouselAspectRatio([
      { w: 300, h: 200 }, // 1.5
      { w: 400, h: 200 }, // 2.0  ← largest landscape
      { w: 300, h: 400 }, // 0.75 portrait
    ]);
    expect(ar).toBeCloseTo(2.0, 5);
  });

  it("falls back to the largest ratio present when there is no landscape image", () => {
    // All portrait: 0.5 and 0.75 → the widest (0.75) is the shortest-column pick.
    const ar = carouselAspectRatio([
      { w: 100, h: 200 }, // 0.5
      { w: 150, h: 200 }, // 0.75
    ]);
    expect(ar).toBeCloseTo(0.75, 5);
  });

  it("uses the default ratio when no usable dimensions are present", () => {
    expect(carouselAspectRatio([{ src: "x" }, { w: 0, h: 0 }])).toBeCloseTo(1.5, 5);
    expect(carouselAspectRatio([])).toBeCloseTo(1.5, 5);
  });

  it("ignores junk / non-numeric or non-positive dimensions", () => {
    const ar = carouselAspectRatio([
      { w: "400" as never, h: "200" as never }, // strings → ignored
      { w: Infinity, h: 10 }, // non-finite → ignored
      { w: -400, h: 200 }, // negative → ignored
      { w: 320, h: 160 }, // 2.0 — the only usable one
    ]);
    expect(ar).toBeCloseTo(2.0, 5);
  });

  it("clamps the ratio into the safe band", () => {
    expect(carouselAspectRatio([{ w: 10000, h: 100 }])).toBe(4); // 100 → clamped to 4
    expect(carouselAspectRatio([{ w: 100, h: 10000 }])).toBe(0.5); // 0.01 → clamped to 0.5
  });

  it("carouselAspectRatioCss always yields a plain finite number string", () => {
    expect(carouselAspectRatioCss([{ w: 400, h: 200 }])).toBe("2.0000");
    // Even hostile input can only ever produce a clamped numeric string.
    expect(/^\d+\.\d{4}$/.test(carouselAspectRatioCss([{ w: {} as never, h: [] as never }]))).toBe(
      true,
    );
  });
});
