# Notes: issues found, not fixed in this work

Things noticed while building the waitlist backend. Each needs a decision or a separate change.

## Needs the owner's answer

1. **Two contact addresses.** The footer links to `hello@striatix.com`; the brief and every email use `striatixsupps@gmail.com`. As of 2026-11-23, `striatix.com` has **no DNS records and no MX records**, so mail to `hello@striatix.com` currently goes nowhere. The footer has not been changed. Which address is real?
2. **Sending domain.** Transactional email can't be sent *From* a `@gmail.com` address (no provider can verify gmail.com, and Gmail's DMARC would fail it). Sending needs a domain you control with SPF, DKIM and DMARC set up in Resend. `striatix.com` is the obvious one, but it isn't resolving yet.
3. **Where the site is actually hosted.** The README said "Live at https://sak-collab.github.io/striatix/" (GitHub Pages). The brief says Cloudflare Pages. GitHub Pages can't run the API, so the backend needs Cloudflare Pages.

## Bugs / risks in the page

4. **The font only works on Cloudflare.** `index.html` loads Outfit from `/cf-fonts/...`, a path Cloudflare's Fonts optimisation creates when it serves the site. Served anywhere else (GitHub Pages, a local server), those requests 404 and the page falls back to a system font. On Cloudflare Pages with Fonts enabled it should work; if not, the files need to be self-hosted in `public/`.
5. **`og.png` is a 10-byte placeholder**, so link previews (iMessage, Slack, X) show a broken image. It needs the real 1200x630 share card.
6. **Desktop overlap:** during the mitochondrion scene, the "Mitochondrion" caption briefly overlaps the "FOV" readout in the top-left HUD.

## Compliance: page copy that conflicts with the rule in the brief (section 0)

The brief forbids copy that claims the product treats, cures, prevents, eliminates or fixes a condition, including "brain fog". These lines in `public/index.html` were **not** changed, because copy changes alter the page and need sign-off:

| Line (approx.) | Current copy | Why it's a problem |
|---|---|---|
| hero, `<h1>` | "Clear the brain fog." | Claims to eliminate brain fog. |
| 686 | "Fog in. Focus out." | Implies brain fog goes away. |
| 641 / 648 | "Brain fog: Slow thinking. Slipping focus." / "Inflamed. Foggy." | Frames the product against a condition (brain fog, neuroinflammation). |
| 636–642 | "Neuroinflammation… Microglia… release inflammatory signals." | Disease/mechanism framing next to a product. |
| 776 | Caffeine: "clears morning grogginess instantly" | "Clears… instantly" is an elimination claim. |
| 777 | L-Theanine: "Removes caffeine jitters" | "Removes" is an elimination claim. |
| 778 | L-Tyrosine: "to help with brain fog from stress or exhaustion" | Names brain fog as the target. |
| 831 | "200 mg L-Theanine kills the shakes." | Elimination claim. |
| 851 | "Brain fog is a symptom." | Ties the product to a symptom. |
| perimenopause list | "Nothing that interferes with HRT." | An unsupported safety claim about a medication. |

Compliant directions per the brief: "supports focus", "for alertness", "supports memory and cognitive function", and nutrient facts ("150 mg caffeine"). The FDA disclaimer and "Not a treatment for menopause symptoms. Check with your doctor." are already present and fine.

## Small things

7. `wrangler.toml` and `workers/digest/wrangler.toml` have `database_id = "00000000-..."` until `npx wrangler d1 create striatix` is run; paste the real id into both.
8. The pricing copy says "$42.50 a month, cancel any time" under the 30-day subscription; fine today, but if 45/60-day cadences are offered later this becomes inaccurate.
