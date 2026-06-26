// Minimal worker entry used ONLY by the vitest workers pool. Tests import the
// modules under test directly (src/lib, src/db) and read bindings from
// `cloudflare:test`, so this handler is just a loadable placeholder — it
// replaces the Astro adapter `main` in wrangler.jsonc, which can't be loaded
// in the test context.
export default {
  fetch() {
    return new Response("test harness");
  },
};
