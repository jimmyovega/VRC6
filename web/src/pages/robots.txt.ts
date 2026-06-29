import type { APIRoute } from "astro";

// Host-aware robots.txt pointing at the dynamic sitemap.
export const GET: APIRoute = ({ url }) => {
  const body = `User-agent: *
Allow: /

Sitemap: ${url.origin}/sitemap.xml
`;
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
