// Guards against regressions in public/index.html. Run: npm run check:site
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const problems = [];
const must = (cond, msg) => cond || problems.push(msg);

must(!html.includes('REPLACE_WITH'), 'a REPLACE_WITH placeholder is back');
must(!/list-manage|mailchimp/i.test(html), 'a Mailchimp reference is back');
must(!/target="_blank"[^>]*id="form"|id="form"[^>]*target=/.test(html), 'the waitlist form opens a new tab again');
must(!/localStorage\.setItem\(\s*['"]waitlist['"]/.test(html), 'email addresses are being written to localStorage again');
must(html.includes("fetch('/api/waitlist'"), 'the form no longer posts to /api/waitlist');
must(html.includes('name="website"'), 'the honeypot field "website" is missing');
must(html.includes('id="planInterest"'), 'the hidden planInterest input is missing');
must(!/red hairline/i.test(html), 'share-card alt text mentions red again');
must((html.match(/<form\b/g) || []).length === 1, 'expected exactly one <form>');

if (problems.length) {
  console.error('check:site failed:\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log('check:site passed');
