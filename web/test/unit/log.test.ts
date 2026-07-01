import { afterEach, describe, expect, it, vi } from "vitest";
import { currentRequestId, log, runWithRequestId } from "../../src/lib/log";

describe("structured logger", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reports no request id outside a request scope", () => {
    expect(currentRequestId()).toBe("-");
  });

  it("attaches the scoped request id and fields as JSON", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    runWithRequestId("ray-123", () => {
      expect(currentRequestId()).toBe("ray-123");
      log.info("hello", { foo: "bar" });
    });
    const entry = JSON.parse(spy.mock.calls[0]?.[0] as string);
    expect(entry).toMatchObject({
      level: "info",
      requestId: "ray-123",
      msg: "hello",
      foo: "bar",
    });
    expect(entry.time).toBeTruthy();
  });

  it("routes error level to console.error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    runWithRequestId("ray-9", () => log.error("boom"));
    const entry = JSON.parse(spy.mock.calls[0]?.[0] as string);
    expect(entry).toMatchObject({ level: "error", requestId: "ray-9", msg: "boom" });
  });
});
