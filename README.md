# Striatix

Marketing site and waitlist for Striatix Supplements, a 7-in-1 cognitive drink powder
(30 servings a tub, every dose printed on the label). Pre-launch: no payments are taken.

- **Site:** one static file, `public/index.html` (inline CSS and JS, no build step).
- **API:** Cloudflare Pages Functions in `functions/`, shared code in `src/`.
- **Data:** Cloudflare D1 (SQLite), schema in `migrations/`.
- **Email:** Resend (confirmation to the visitor, notification/digest to the owner).
- **Digest:** a small cron Worker in `workers/digest/` (every 15 minutes).

See `DECISIONS.md` for why things are the way they are, and `NOTES.md` for open issues.

## Endpoints

| Method | Path | What it does |
|---|---|---|
| POST | `/api/waitlist` | Add a signup. Body: `{ email, source, plan_interest, website, elapsed_ms, page_path, referrer, utm_* }`. Returns `{ ok: true, message }` or `{ ok: false, error: "invalid_email" \| "rate_limited" \| "server_error" }`. |
| GET / POST | `/api/unsubscribe?id=…&t=…` | GET shows a confirm button; POST unsubscribes. Links are signed. |
| GET | `/admin/waitlist.csv` | Every signup as CSV. Requires `Authorization: Bearer $ADMIN_EXPORT_TOKEN`. |

## Run it locally

Requires Node 20+.

```bash
npm install
cp .env.example .dev.vars        # then fill in: ENVIRONMENT=development, IP_HASH_PEPPER, ADMIN_EXPORT_TOKEN
npm run migrate                  # creates the local D1 database (.wrangler/, gitignored)
npm run dev                      # http://localhost:8788
```

With `ENVIRONMENT=development` and no `EMAIL_PROVIDER_API_KEY`, emails are printed to the
terminal (recipient masked) instead of sent.

Try it:

```bash
curl -s -X POST http://localhost:8788/api/waitlist \
  -H 'Content-Type: application/json' -H 'Origin: http://localhost:8788' \
  -d '{"email":"you@example.com","elapsed_ms":5000,"plan_interest":"subscribe"}'

curl -s -H "Authorization: Bearer $(grep ADMIN_EXPORT_TOKEN .dev.vars | cut -d= -f2)" \
  http://localhost:8788/admin/waitlist.csv
```

## Test

```bash
npm test             # 61 tests, run inside the Workers runtime against a local D1
npm run typecheck
npm run check:site   # guards index.html against the old Mailchimp/localStorage code returning
```

## Deploy (Cloudflare Pages)

One-time setup:

```bash
npx wrangler login
npx wrangler d1 create striatix          # paste the database_id into wrangler.toml and workers/digest/wrangler.toml
npm run migrate:remote
npx wrangler pages project create striatix --production-branch main
for k in IP_HASH_PEPPER EMAIL_PROVIDER_API_KEY EMAIL_FROM ADMIN_EXPORT_TOKEN; do
  npx wrangler pages secret put "$k" --project-name striatix
done
```

In the Cloudflare dashboard, bind the D1 database to the Pages project as `DB` if it isn't
picked up from `wrangler.toml`, and add the custom domain `striatix.com`.

Every deploy:

```bash
npx wrangler pages deploy
npx wrangler deploy --config workers/digest/wrangler.toml   # only when the digest worker changes
```

The digest worker needs its own secrets once:
`npx wrangler secret put EMAIL_PROVIDER_API_KEY --config workers/digest/wrangler.toml` (and `EMAIL_FROM`).

## Email setup (Resend)

1. Create a Resend account (free tier: 3,000 emails/month).
2. Add and verify the sending domain (SPF, DKIM, DMARC records). See NOTES.md: a `@gmail.com` address can't be the From.
3. Create an API key and set it as `EMAIL_PROVIDER_API_KEY`; set `EMAIL_FROM` to an address on the verified domain.
