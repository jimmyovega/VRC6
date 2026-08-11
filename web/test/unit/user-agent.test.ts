import { describe, expect, it } from "vitest";
import { summarizeUserAgent } from "../../src/lib/user-agent";

const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.7827.55 Safari/537.36";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0";
const EDGE_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0";
const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36";

describe("summarizeUserAgent", () => {
  it("identifies Chrome on Windows", () => {
    expect(summarizeUserAgent(CHROME_WINDOWS)).toBe("Chrome on Windows");
  });

  it("identifies Safari on iOS", () => {
    expect(summarizeUserAgent(SAFARI_IPHONE)).toBe("Safari on iOS");
  });

  it("identifies Firefox on Linux", () => {
    expect(summarizeUserAgent(FIREFOX_LINUX)).toBe("Firefox on Linux");
  });

  it("prefers Edge over the Chrome/Safari tokens its UA also carries", () => {
    expect(summarizeUserAgent(EDGE_WINDOWS)).toBe("Edge on Windows");
  });

  it("prefers Chrome over the Safari token its UA also carries", () => {
    expect(summarizeUserAgent(CHROME_ANDROID)).toBe("Chrome on Android");
  });

  it("falls back gracefully for null/empty input", () => {
    expect(summarizeUserAgent(null)).toBe("Unknown device");
    expect(summarizeUserAgent(undefined)).toBe("Unknown device");
    expect(summarizeUserAgent("")).toBe("Unknown device");
  });

  it("falls back gracefully for an unrecognized UA string", () => {
    expect(summarizeUserAgent("SomeBot/1.0")).toBe("Unknown device");
  });
});
