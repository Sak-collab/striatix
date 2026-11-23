import { describe, expect, it } from 'vitest';

import { csvCell, handleExport } from '../src/handlers/export';
import { handleUnsubscribeGet, handleUnsubscribePost } from '../src/handlers/unsubscribe';
import { handleWaitlist, unsubscribeUrl } from '../src/handlers/waitlist';
import { notifyOwner } from '../src/lib/notify';
import { makeCtx, makeDeps, rows, signupRequest, testEnv } from './helpers';

const MIN = 60_000;
const BANNED = /\b(cure[sd]?|treat(s|ed|ment)?|eliminat\w*|fix(es|ed)?|prevent\w*|neurogenesis|brain fog)\b/i;

async function join(email: string, h: ReturnType<typeof makeDeps>, plan?: string, ip?: string) {
  const { ctx, flush } = makeCtx();
  const res = await handleWaitlist(signupRequest({ email, plan_interest: plan }, { ip }), testEnv(), ctx, h.deps);
  await flush();
  return res;
}

describe('confirmation email', () => {
  it('matches the brief and carries a signed one-click unsubscribe link', async () => {
    const h = makeDeps();
    await join('reader@example.com', h);
    const mail = h.sent.find((m) => m.to === 'reader@example.com')!;
    expect(mail.subject).toBe("You're on the Striatix waitlist");
    expect(mail.text).toContain("You're on the list.");
    expect(mail.text).toContain('7-in-1 cognitive drink powder. 30 servings. Every dose printed on the label.');
    expect(mail.text).toMatch(/Unsubscribe: https:\/\/striatix\.com\/api\/unsubscribe\?id=\d+&t=[\w-]+/);
    expect(mail.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('makes no health or treatment claims', async () => {
    const h = makeDeps();
    await join('claims@example.com', h, 'trial');
    for (const m of h.sent) {
      expect(m.subject + '\n' + m.text).not.toMatch(BANNED);
      expect(m.text).not.toMatch(/\bfocus\b/i);
    }
  });
});

describe('owner notification and digest', () => {
  it('first signup notifies immediately with the brief format', async () => {
    const h = makeDeps();
    await join('first@example.com', h, 'subscribe');
    const note = h.sent.find((m) => m.to === 'striatixsupps@gmail.com')!;
    expect(note.subject).toBe('New waitlist signup — subscribe');
    expect(note.text).toContain('Email:   first@example.com');
    expect(note.text).toContain('Source:  section');
    expect(note.text).toContain('Tier:    subscribe');
    expect(note.text).toMatch(/When: {4}.+\(UTC\)/);
    expect(note.text).toContain('Total on list: 1');
  });

  it('a spike within 15 minutes is held back and sent as one digest', async () => {
    const h = makeDeps();
    await join('s1@example.com', h, undefined, '192.0.2.1');
    h.advance(1 * MIN);
    await join('s2@example.com', h, 'trial', '192.0.2.2');
    h.advance(1 * MIN);
    await join('s3@example.com', h, 'once', '192.0.2.3');

    const owner = () => h.sent.filter((m) => m.to === 'striatixsupps@gmail.com');
    expect(owner()).toHaveLength(1); // only the first
    expect(owner()[0]!.subject).toBe('New waitlist signup — no tier');

    // The cron worker flushes what is pending.
    h.advance(13 * MIN);
    const flushed = await notifyOwner(testEnv(), h.deps.mailer, h.nowMs(), true);
    expect(flushed).toBe(2);
    const digest = owner()[1]!;
    expect(digest.subject).toBe('2 new waitlist signups');
    expect(digest.text).toContain('s2@example.com');
    expect(digest.text).toContain('s3@example.com');
    expect(digest.text).toContain('Total on list: 3');

    // Nothing left to send.
    expect(await notifyOwner(testEnv(), h.deps.mailer, h.nowMs() + 20 * MIN, true)).toBe(0);
  });
});

describe('unsubscribe', () => {
  const urlFor = async (id: number) => new URL(await unsubscribeUrl(testEnv(), id));

  it('GET shows a confirm page and does not unsubscribe (link scanners prefetch GETs)', async () => {
    await join('stay@example.com', makeDeps());
    const id = Number((await rows())[0]!.id);
    const res = await handleUnsubscribeGet(new Request(await urlFor(id)), testEnv());
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<form method="post"');
    expect((await rows())[0]!.unsubscribed).toBe(0);
  });

  it('POST with a valid token unsubscribes', async () => {
    await join('leave@example.com', makeDeps());
    const id = Number((await rows())[0]!.id);
    const res = await handleUnsubscribePost(new Request(await urlFor(id), { method: 'POST' }), testEnv());
    expect(res.status).toBe(200);
    expect((await rows())[0]!.unsubscribed).toBe(1);
  });

  it('rejects a forged or mismatched token', async () => {
    await join('safe@example.com', makeDeps());
    const id = Number((await rows())[0]!.id);
    const good = await urlFor(id);
    const forged = new URL(good);
    forged.searchParams.set('id', String(id + 1));
    for (const u of [forged, new URL(`https://striatix.com/api/unsubscribe?id=${id}&t=abc`)]) {
      const res = await handleUnsubscribePost(new Request(u, { method: 'POST' }), testEnv());
      expect(res.status).toBe(400);
    }
    expect((await rows())[0]!.unsubscribed).toBe(0);
  });
});

describe('GET /admin/waitlist.csv', () => {
  const req = (auth?: string) =>
    new Request('https://striatix.com/admin/waitlist.csv', { headers: auth ? { Authorization: auth } : {} });

  it('is 404 when no token is configured', async () => {
    expect((await handleExport(req('Bearer x'), testEnv({ ADMIN_EXPORT_TOKEN: undefined }))).status).toBe(404);
  });

  it('is 401 without or with a wrong bearer token, and never accepts basic auth or a query param', async () => {
    const env = testEnv();
    expect((await handleExport(req(), env)).status).toBe(401);
    expect((await handleExport(req('Bearer wrong'), env)).status).toBe(401);
    expect((await handleExport(req(`Basic ${btoa('admin:' + env.ADMIN_EXPORT_TOKEN)}`), env)).status).toBe(401);
    const q = new Request(`https://striatix.com/admin/waitlist.csv?token=${env.ADMIN_EXPORT_TOKEN}`);
    expect((await handleExport(q, env)).status).toBe(401);
  });

  it('returns every row with the agreed columns', async () => {
    const h = makeDeps();
    await join('one@example.com', h, 'once', '192.0.2.1');
    await join('two@example.com', h, 'trial', '192.0.2.2');
    const env = testEnv();
    const res = await handleExport(req(`Bearer ${env.ADMIN_EXPORT_TOKEN}`), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const lines = (await res.text()).trim().split('\r\n');
    expect(lines[0]).toBe('email,created_at,plan_interest,source,utm_source,utm_medium,utm_campaign,confirmed,unsubscribed');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(/^one@example\.com,.+,once,section,,,,0,0$/);
  });

  it('neutralises spreadsheet formulas and quotes special characters', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell(null)).toBe('');
  });
});
