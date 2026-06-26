import { defineConfig } from "drizzle-kit";

// Drizzle is used to GENERATE SQL migrations from src/db/schema.ts.
// The generated SQL in ./migrations is applied to D1 via:
//   npx wrangler d1 migrations apply vrc6-db --local   (or --remote)
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
});
