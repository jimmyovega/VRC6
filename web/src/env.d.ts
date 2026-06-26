// Makes the Cloudflare runtime + bindings (Env: DB, ASSETS, …) available on
// Astro.locals.runtime. `Env` is generated into worker-configuration.d.ts by
// `npx wrangler types` — rerun that after changing wrangler.jsonc bindings.
type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {}
}
