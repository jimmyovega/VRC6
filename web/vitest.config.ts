import path from "node:path";
import {
  defineWorkersConfig,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers/config";

// Runs tests inside the real workerd runtime (Miniflare) with the same bindings
// as production, read from wrangler.jsonc. D1 migrations are loaded here and
// applied to each test's isolated database in test/apply-migrations.ts.
export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(
    path.join(import.meta.dirname, "migrations"),
  );

  return {
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
      poolOptions: {
        workers: {
          // Override the Astro adapter `main` from wrangler.jsonc with a minimal
          // test entry; bindings (DB, etc.) are still read from wrangler.jsonc.
          main: "./test/worker-entry.ts",
          wrangler: { configPath: "./wrangler.jsonc" },
          miniflare: {
            // Expose migrations to the setup file as a test-only binding.
            bindings: { TEST_MIGRATIONS: migrations },
          },
        },
      },
    },
  };
});
