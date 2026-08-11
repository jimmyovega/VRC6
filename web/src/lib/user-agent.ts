// Best-effort "browser on OS" summary for a raw User-Agent string, shown on
// the security page's recent-access list. Not meant to be exhaustive device
// detection — just enough for a user to recognize "yeah, that's my phone."

// Order matters: a genuine iPhone/iPad UA also carries "like Mac OS X" for
// compatibility, so the iOS check must run before the macOS one.
const OS_PATTERNS: [RegExp, string][] = [
  [/windows/i, "Windows"],
  [/iphone|ipad|ipod/i, "iOS"],
  [/mac os x|macintosh/i, "macOS"],
  [/android/i, "Android"],
  [/linux/i, "Linux"],
];

// Order matters: Edge's UA also contains "Chrome" and "Safari" tokens, and
// Chrome's also contains "Safari" — check the more specific name first.
const BROWSER_PATTERNS: [RegExp, string][] = [
  [/edg\//i, "Edge"],
  [/chrome\//i, "Chrome"],
  [/firefox\//i, "Firefox"],
  [/safari\//i, "Safari"],
];

function matchFirst(value: string, patterns: [RegExp, string][]): string | null {
  return patterns.find(([re]) => re.test(value))?.[1] ?? null;
}

/** e.g. "Chrome on Windows". Falls back gracefully for unknown/missing UAs. */
export function summarizeUserAgent(userAgent: string | null | undefined): string {
  if (!userAgent) return "Unknown device";
  const os = matchFirst(userAgent, OS_PATTERNS);
  const browser = matchFirst(userAgent, BROWSER_PATTERNS);
  if (!os && !browser) return "Unknown device";
  if (!os) return browser!;
  if (!browser) return `Unknown browser on ${os}`;
  return `${browser} on ${os}`;
}
