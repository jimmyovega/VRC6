import type { D1Migration } from "cloudflare:test";

// Type the bindings available inside tests: the production `Env` (DB, ASSETS, …)
// plus the migrations binding we inject in vitest.config.ts.
declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[];
  }
}
