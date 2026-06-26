// Typed Drizzle client bound to the Cloudflare D1 instance.
// In Astro routes/components (Astro v7+), get the D1 binding from the Worker env:
//   import { env } from "cloudflare:workers";
//   const db = getDb(env.DB);
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export { schema };
