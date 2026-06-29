import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { getDb } from "../db";
import { getCategories, getPublishedArticles } from "../db/queries";

// Dynamic sitemap: enumerates static pages + every published article and
// category from D1, using the request origin so it works on any host.
export const GET: APIRoute = async ({ url }) => {
  const origin = url.origin;
  const db = getDb(env.DB);
  const [articles, categories] = await Promise.all([
    getPublishedArticles(db),
    getCategories(db),
  ]);

  const entries: { loc: string; lastmod?: string }[] = [
    { loc: `${origin}/` },
    { loc: `${origin}/contact` },
    { loc: `${origin}/donate` },
    ...categories.map((c) => ({ loc: `${origin}/category/${c.slug}` })),
    ...articles.map((a) => ({
      loc: `${origin}/articles/${a.slug}`,
      lastmod: a.publishedAt ? new Date(a.publishedAt).toISOString() : undefined,
    })),
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map(
    (e) =>
      `  <url><loc>${e.loc}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ""}</url>`,
  )
  .join("\n")}
</urlset>`;

  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
};
