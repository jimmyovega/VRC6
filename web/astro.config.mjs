// @ts-check
import { defineConfig } from 'astro/config';

import cloudflare from '@astrojs/cloudflare';
import { sentryVitePlugin } from '@sentry/vite-plugin';

// Upload source maps to Sentry only when an auth token is present (i.e. the
// deploy build). Local `npm run build` and PR CI have no token → no source maps
// generated, no upload — the build is unchanged there.
const sentryUpload = Boolean(process.env.SENTRY_AUTH_TOKEN);

// The commit this build came from. CI passes it as GITHUB_SHA; it names the
// Sentry release so an error resolves to a specific deploy (and so uploaded
// source maps bind to that release rather than floating free). Empty locally,
// which is fine — nothing is uploaded without the auth token anyway.
const release = process.env.GITHUB_SHA || undefined;

// https://astro.build/config
export default defineConfig({
  // Render on-demand on the Worker so pages can read D1 at request time.
  // Individual static pages can opt back in with `export const prerender = true`.
  output: 'server',
  adapter: cloudflare(),
  vite: {
    // Baked in at build time so the running Worker reports the same release
    // Sentry's source maps were uploaded under. Doing it here rather than as a
    // deploy-time var keeps the two from drifting apart. Distinctive name so
    // the textual replacement can't collide with anything in node_modules.
    define: { __VRC6_RELEASE__: JSON.stringify(release ?? '') },
    // 'hidden' emits maps (Sentry uploads them via injected debug IDs) but adds
    // NO sourceMappingURL comment — otherwise wrangler errors on the .map we
    // delete after upload ("Invalid source map path ... does not exist").
    build: { sourcemap: sentryUpload ? 'hidden' : false },
    plugins: sentryUpload
      ? [
          sentryVitePlugin({
            org: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT,
            authToken: process.env.SENTRY_AUTH_TOKEN,
            ...(release ? { release: { name: release } } : {}),
            // Upload the maps to Sentry, then delete them so they're never shipped.
            sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
          }),
        ]
      : [],
  },
});
