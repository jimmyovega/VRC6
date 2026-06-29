// Makes the Cloudflare runtime + bindings (Env: DB, ASSETS, …) available on
// Astro.locals.runtime. `Env` is generated into worker-configuration.d.ts by
// `npx wrangler types` — rerun that after changing wrangler.jsonc bindings.
type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

type AuthUser = {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  role: "admin" | "editor";
  status: string;
  username: string | null;
  bio: string | null;
  image: string | null;
};

type AuthSession = {
  id: string;
  userId: string;
  expiresAt: Date;
};

declare namespace App {
  interface Locals extends Runtime {
    user: AuthUser | null;
    session: AuthSession | null;
  }
}
