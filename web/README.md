# VRC6 — web

Astro (SSR) on Cloudflare Workers, with D1 + Drizzle ORM and better-auth. This is the application;
product docs live in the `VRC6 Docs` Notion database and the repo root [`README.md`](../README.md).

## Commands

| Command | Action |
| --- | --- |
| `npm run dev` | Astro dev server (Vite) |
| `npm run build` | Build the Worker + assets to `./dist/` |
| `npm test` | Unit + D1 integration tests (Vitest, Workers pool) |
| `npm run test:e2e` | Playwright E2E against `wrangler dev` |
| `npm run e2e:setup` | Build + apply local D1 migrations + seed (run before `test:e2e`) |
| `npm run db:migrate:local` | Apply D1 migrations to the local database |
| `npm run db:seed:local` | Seed the local database |
| `npx wrangler dev` | Serve the built Worker (what E2E runs against) |

To verify a scheduled (cron) run locally: `npx wrangler dev --test-scheduled` then
`curl http://localhost:8788/cdn-cgi/handler/scheduled`.

## Testing a branch or PR locally

`wrangler dev` serves the built Worker from `./dist/`, not your source files directly — it does
**not** hot-reload. Rebuild after every change (yours or a checked-out branch's) before refreshing.

```bash
gh pr checkout 53        # or: git checkout <branch>
npm run build
npx wrangler dev --port 8788
```

Then open `http://localhost:8788`. This is the real Worker against local D1/R2/KV — the same
security headers and bundling as production, unlike `npm run dev` (plain `astro dev`), which
hot-reloads but skips both.

Local D1 starts from `seed.sql`, so seeded articles/users are already there. For a throwaway
login, hit the sign-up API directly from the browser console rather than building an account
through the UI (works only locally — `.dev.vars` sets `ALLOW_PUBLIC_SIGNUP=1`; production doesn't):

```js
fetch('/api/auth/sign-up/email', {
  method: 'POST', headers: {'Content-Type':'application/json'},
  body: JSON.stringify({ email: 'you@test.com', password: 'Sup3rSecret!23', name: 'you' })
}).then(r => r.json())
```

To compare against `main`, rebuild and restart `wrangler dev` on each branch in turn (or use
`git worktree` to run both side by side on different ports).

## Configuration

Local secrets/vars go in `web/.dev.vars` (gitignored). Copy [`.dev.vars.example`](.dev.vars.example)
to `.dev.vars` and fill it in. In production these are set with `wrangler secret put <NAME>` (secrets)
or as `vars` in `wrangler.jsonc` (non-secret).

## Auth model (M2)

better-auth owns `user` / `session` / `account` / `verification`; `user` is extended with
`role` (admin/editor), `status`, `username`, `bio`, lifecycle timestamps, and `two_factor_enabled`.

- **Roles & gating** — middleware guards `/admin` (admin) and `/dashboard` (any active user). Only
  `active` accounts may hold a session (a `session.create.before` hook blocks pending / suspended /
  expired / deleted).
- **Bootstrap admin** — any email in `ADMIN_EMAIL` (comma-separated) becomes an active admin on sign-up.
- **Invite → activate** — admins invite users (temp password they never see); the invitee sets a
  password via the reset link, which flips `pending_activation → active`.
- **User management** — `/api/admin/user-action` (suspend / reactivate / soft-delete / change role),
  with self + last-admin safeguards, session revocation, and an audit trail (`/admin/audit`).
- **Activation expiry** — a daily Cron Trigger (`src/worker.ts` → `src/lib/cron.ts`) expires stale
  pending invites; also runnable on demand from the admin panel.
- **2FA (TOTP)** — better-auth `twoFactor` plugin; enrol at `/dashboard/security` (QR + backup codes),
  challenged at login (`twoFactorRedirect` → verify-totp).
- **Turnstile** — gates login + forgot-password (server-side siteverify in a before-hook).
- **Rate limiting** — D1-backed fixed-window limiter on the sensitive auth endpoints (429 + retry-after).

## Deploying (M2)

1. Reset the remote D1 to the current schema (it is still on the M1 schema; the fresh migration set
   must be applied in lockstep with this deploy — see Playbook task "Reset remote D1 at M2 deploy time").
2. Set production secrets/vars: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ADMIN_EMAIL`,
   `RESEND_API_KEY`, `RESEND_FROM` (a verified Resend domain sender), `TURNSTILE_SECRET_KEY`,
   `TURNSTILE_SITE_KEY`. Do **not** set the `*_DISABLED` / `EMAIL_DEBUG` dev flags in production.
