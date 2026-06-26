// @ts-check
import { defineConfig } from 'astro/config';

import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  // Render on-demand on the Worker so pages can read D1 at request time.
  // Individual static pages can opt back in with `export const prerender = true`.
  output: 'server',
  adapter: cloudflare()
});