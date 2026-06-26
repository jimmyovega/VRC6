# VRC6

VRC6 is a self-hosted, open-source online magazine focused on alternate-lifestyle and underground
culture — interviews, a Twitch/VTuber portal, a personal blog, NYC/Austin local events, a games
showcase, and articles on art, books, music, and photography. Browser-only (desktop + mobile), with a
retro neon-green pixel aesthetic and a CMS-driven editorial workflow.

## Tech stack (Cloudflare-native, serverless)

| Area | Choice |
| --- | --- |
| Frontend / SSR | Astro (Cloudflare adapter) |
| Edge runtime | Cloudflare Workers |
| Database | Cloudflare D1 (SQLite) + Drizzle ORM |
| Image storage | Cloudflare R2 |
| Auth + 2FA | better-auth (TOTP) |
| Block editor | BlockNote / TipTap (article body stored as JSON) |
| Email | Resend |
| Bot protection | Cloudflare Turnstile |
| Scheduled jobs | Cloudflare Cron Triggers |

> **Note:** VRC6 originally targeted Wagtail CMS + PostgreSQL + Alpine.js. It moved to the
> Cloudflare-native stack above (Wagtail can't run on Workers; D1 is SQLite, not Postgres). The
> workflow logic and data model below are unchanged — only the implementation tech differs.

## Repo guide

| File | Purpose |
| --- | --- |
| [`datamodel.dbml`](datamodel.dbml) | Database schema (users, articles, categories, tokens, audits) |
| [`userworkflows.md`](userworkflows.md) | User lifecycle: roles, states, transitions, security rules |
| [`articleworkflow.md`](articleworkflow.md) | Article publishing: Draft → Pending Review → Published |
| [`docs/legacy/`](docs/legacy/) | Original Wagtail prototype kept for design reference (template, palette, screenshots) |

## Documentation

- **PRD** and **Dev Notes & Playbook** live in the `VRC6 Docs` Notion database.

## Milestones

- **M0** — Foundation: Astro on Workers, D1 schema (Drizzle), R2 bucket, CI
- **M1** — Public reading experience (**MVP**): article list/detail, categories, retro theme, responsive
- **M2** — Auth & users: roles, user state machine, TOTP 2FA, Turnstile, Resend, Cron expiry
- **M3** — Editorial workflow: block editor, body as JSON, draft → pending → published, R2 uploads
- **M4** — Admin curation: approve/reject/unpublish, editor invitations, dashboards
- **M5** — Sections & polish: VTuber/Twitch portal, events, games showcase, blog, SEO
- **M6** — Launch: custom domain, edge caching, D1 backups, observability, security review

## License

See [LICENSE](LICENSE).
