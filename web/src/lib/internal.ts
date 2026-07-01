// Trusted-call marker for in-process auth API calls. Some admin flows (e.g. the
// invite endpoint calling requestPasswordReset) re-enter better-auth's endpoint
// pipeline, which would otherwise trip the public Turnstile / rate-limit
// before-hook. We tag those in-process calls with a header whose value is the
// server secret — browser clients can't know it, and the header is only ever
// attached to in-memory auth.api calls, never sent over the network.
import { env } from "cloudflare:workers";

export const INTERNAL_HEADER = "x-vrc6-internal";

function secret(): string {
  return (env as { BETTER_AUTH_SECRET?: string }).BETTER_AUTH_SECRET ?? "";
}

// Header object to spread onto a trusted in-process auth.api call.
export function internalHeaders(base?: Headers): Headers {
  const headers = new Headers(base);
  headers.set(INTERNAL_HEADER, secret());
  return headers;
}

// True when a request carries the valid internal marker (trusted server call).
export function isInternalCall(headers: Headers | null | undefined): boolean {
  const s = secret();
  return s.length > 0 && headers?.get(INTERNAL_HEADER) === s;
}
