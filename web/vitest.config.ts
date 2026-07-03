import fs from "node:fs";
import path from "node:path";
import {
  defineWorkersConfig,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers/config";

// Runs tests inside the real workerd runtime (Miniflare) with the same bindings
// as production, read from wrangler.jsonc. D1 migrations are loaded here and
// applied to each test's isolated database in test/apply-migrations.ts.
export default defineWorkersConfig(async () => {
  // The pool reads the whole wrangler.jsonc, including the Astro
  // `assets.directory` (./dist). Ensure it exists so config parsing doesn't
  // fail when tests run before a build (e.g. in CI). An empty dir is fine —
  // tests don't use the ASSETS binding.
  fs.mkdirSync(path.join(import.meta.dirname, "dist"), { recursive: true });

  const migrations = await readD1Migrations(
    path.join(import.meta.dirname, "migrations"),
  );

  return {
    test: {
      // Only vitest unit/integration tests live in test/. Playwright E2E specs
      // live in e2e/ and must NOT be picked up by vitest.
      include: ["test/**/*.test.ts"],
      setupFiles: ["./test/apply-migrations.ts"],
      poolOptions: {
        workers: {
          // Override the Astro adapter `main` from wrangler.jsonc with a minimal
          // test entry; bindings (DB, etc.) are still read from wrangler.jsonc.
          main: "./test/worker-entry.ts",
          wrangler: { configPath: "./wrangler.jsonc" },
          miniflare: {
            // Expose migrations to the setup file as a test-only binding, plus a
            // dummy auth secret so secret-dependent helpers are exercisable.
            bindings: {
              TEST_MIGRATIONS: migrations,
              BETTER_AUTH_SECRET: "test-secret-for-internal-marker",
              // A key is present but EMAIL_DISABLED keeps every test log-only —
              // no test ever makes a live Resend call.
              RESEND_API_KEY: "re_test_dummy_key",
              EMAIL_DISABLED: "1",
            },
          },
        },
      },
    },
  };
});
