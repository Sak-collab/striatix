# Decisions

One line of reasoning per decision. Newest at the bottom of each section.

## Phase one: waitlist

- **Database: Cloudflare D1.** The site is meant to run on Cloudflare Pages; D1 sits next to the Functions, is SQLite (easy to query and export), and the free tier (5 GB, 5M reads/day) is far beyond a waitlist. No `DATABASE_URL`: D1 is a binding (`DB`) in `wrangler.toml`.
- **API: Cloudflare Pages Functions** (`functions/`). No server to run, deploys with the static site, no framework.
- **Email provider: Resend**, called with `fetch` (no SDK). Free tier is 3,000 emails/month and 100/day, which covers confirmations plus notifications; the API is one HTTP call.
- **Owner digest: a separate cron Worker** (`workers/digest`, every 15 minutes). Pages Functions can't run on a schedule. A signup notifies immediately only if nothing went out in the last 15 minutes; otherwise it waits for the cron. A conditional upsert in `app_state` is the lock so two requests can't both send.
- **Rate limits: a D1 counter table** (fixed windows). No KV needed; keys are hashes, never raw emails or IPs; rows older than a day are pruned opportunistically.
- **Rate limit is checked after email validation**, so a visitor fixing a typo doesn't burn their 5-per-hour allowance on malformed input.
- **Time-to-submit is measured in the browser** (`elapsed_ms` since the form rendered) and enforced on the server (< 2000 ms is discarded with a 200). A missing value counts as too fast.
- **Constant-ish timing:** every response is padded to a 350 ms floor plus up to 60 ms jitter, and emails are sent after the response (`waitUntil`), so new and existing emails take the same time.
- **Unsubscribe links carry the row id plus an HMAC of it**, not the email (no personal data in URLs). GET shows a confirm button and POST unsubscribes, because mail-security scanners prefetch GET links. The `List-Unsubscribe-Post` one-click header also POSTs.
- **Re-joining after unsubscribing clears `unsubscribed`**: submitting the form again is a fresh opt-in.
- **Site moved to `public/`** and set as `pages_build_output_dir`, so `package.json`, migrations and source aren't served as static files.
- **Tests run inside the Workers runtime** (`@cloudflare/vitest-plugin`) against a local D1, so they exercise the real SQL and Web Crypto.
- **`.npmrc` sets `legacy-peer-deps`**: npm 11.3 crashes ("reading 'edgesOut'") resolving the Vitest plugin's peers without it.

## Where this differs from the brief (and why)

- **The form keeps `method="post"`.** The brief says to remove it. Without it, a submit when JavaScript fails would become a GET that puts the visitor's email in the URL and in server logs. Mailchimp's `action` and `target="_blank"` are removed as asked.
- **The CSV export adds an `unsubscribed` column** after the brief's eight. Without it, the export would hand back people who asked not to be emailed.
- **`EMAIL_FROM` is not `striatixsupps@gmail.com`.** Resend, Postmark and SendGrid all require the From domain to be one you've verified, and nobody can verify `gmail.com`. The From must be an address on a domain you own (for example `hello@striatix.com`), with Gmail kept as Reply-To. `EMAIL_FROM` is left empty in `.env.example` until that's decided. See NOTES.md.
- **A network failure gets its own message** ("We couldn't reach the server. Check your connection and try again.") in addition to the three mapped API errors, because a dropped connection never reaches the API to get one.
- **`source` is always `section`** for now: the page has one form. `footer` is accepted by the API for when a second form exists.

## Phase two: orders (blocked, not started)

The brief requires these four answers before any order code is written. None has been given yet.

1. **Payment processor:** _undecided_ (Stripe Checkout recommended in the brief).
2. **Take money pre-launch, and if so how:** _undecided_ (refundable deposit suggested in the brief).
3. **Sales tax handling:** _undecided_ (Stripe Tax or TaxJar suggested).
4. **Fulfilment (who ships, from where, SLAs):** _undecided_.
