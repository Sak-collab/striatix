import { describe, expect, it } from 'vitest';

import { handleWaitlist, handleWaitlistOptions, LIMITS, MIN_FILL_MS } from '../src/handlers/waitlist';
import { makeCtx, makeDeps, rows, signupRequest, testEnv } from './helpers';

const MINUTE = 60_000;

async function submit(
  body: Record<string, unknown>,
  h = makeDeps(),
  init: Parameters<typeof signupRequest>[1] = {},
  env = testEnv(),
) {
  const { ctx, flush } = makeCtx();
  const res = await handleWaitlist(signupRequest(body, init), env, ctx, h.deps);
  await flush();
  return { res, json: (await res.json()) as Record<string, unknown> };
}

describe('POST /api/waitlist: happy path', () => {
  it('stores a normalised signup and returns the exact success shape', async () => {
    const h = makeDeps();
    const { res, json } = await submit(
      {
        email: '  Person@Example.com ',
        plan_interest: 'subscribe',
        page_path: '/',
        referrer: 'https://news.example/',
        utm_source: 'ig',
        utm_medium: 'social',
        utm_campaign: 'launch',
      },
      h,
      { ua: 'Mozilla/5.0 ' + 'x'.repeat(400) },
    );
    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, message: "You're on the list." });

    const [row] = await rows();
    expect(row).toMatchObject({
      email: 'person@example.com',
      source: 'section',
      plan_interest: 'subscribe',
      page_path: '/',
      referrer: 'https://news.example/',
      utm_source: 'ig',
      utm_medium: 'social',
      utm_campaign: 'launch',
      confirmed: 0,
      unsubscribed: 0,
    });
    expect(String(row!.user_agent).length).toBe(200);
  });

  it('stores a peppered hash of the IP, never the raw IP', async () => {
    await submit({ email: 'a@example.com' }, makeDeps(), { ip: '198.51.100.23' });
    const [row] = await rows();
    expect(row!.ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain('198.51.100.23');
  });

  it('ignores an unknown plan tier rather than failing', async () => {
    const { res } = await submit({ email: 'b@example.com', plan_interest: 'platinum' });
    expect(res.status).toBe(200);
    expect((await rows())[0]!.plan_interest).toBeNull();
  });
});

describe('idempotency', () => {
  it('a duplicate email returns 200 and creates no second row', async () => {
    const h = makeDeps();
    await submit({ email: 'dup@example.com' }, h);
    h.advance(2 * MINUTE); // past the per-email limit
    const { res, json } = await submit({ email: 'DUP@example.com ' }, h);
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(await rows()).toHaveLength(1);
  });

  it('sends the confirmation email only for the first signup', async () => {
    const h = makeDeps();
    await submit({ email: 'once@example.com' }, h);
    h.advance(2 * MINUTE);
    await submit({ email: 'once@example.com' }, h);
    expect(h.sent.filter((m) => m.to === 'once@example.com')).toHaveLength(1);
  });

  it('re-joining after unsubscribing clears the unsubscribed flag', async () => {
    const h = makeDeps();
    await submit({ email: 'back@example.com' }, h);
    const env = testEnv();
    await env.DB.prepare('UPDATE waitlist SET unsubscribed = 1').run();
    h.advance(2 * MINUTE);
    await submit({ email: 'back@example.com' }, h);
    expect((await rows())[0]!.unsubscribed).toBe(0);
  });
});

describe('validation', () => {
  it.each([['not-an-email'], [''], ['a@b'], ['x@example.com\nBcc: y@example.com']])('rejects %j with 400 invalid_email', async (email) => {
    const { res, json } = await submit({ email });
    expect(res.status).toBe(400);
    expect(json).toEqual({ ok: false, error: 'invalid_email' });
    expect(await rows()).toHaveLength(0);
  });

  it('rejects malformed JSON and oversized bodies', async () => {
    const env = testEnv();
    const { ctx } = makeCtx();
    const bad = new Request('https://striatix.com/api/waitlist', {
      method: 'POST',
      headers: { Origin: 'https://striatix.com' },
      body: '{not json',
    });
    expect((await handleWaitlist(bad, env, ctx, makeDeps().deps)).status).toBe(400);

    const big = signupRequest({ email: 'big@example.com', referrer: 'x'.repeat(5000) });
    expect((await handleWaitlist(big, env, ctx, makeDeps().deps)).status).toBe(400);
  });
});

describe('spam handling', () => {
  it('honeypot: a filled `website` field returns 200 and stores nothing', async () => {
    const h = makeDeps();
    const { res, json } = await submit({ email: 'bot@example.com', website: 'http://spam.example' }, h);
    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, message: "You're on the list." });
    expect(await rows()).toHaveLength(0);
    expect(h.sent).toHaveLength(0);
  });

  it('time-to-submit: under 2 seconds returns 200 and stores nothing', async () => {
    const { res } = await submit({ email: 'fast@example.com', elapsed_ms: MIN_FILL_MS - 1 });
    expect(res.status).toBe(200);
    expect(await rows()).toHaveLength(0);
  });

  it('time-to-submit: a missing timing field is treated as too fast', async () => {
    const env = testEnv();
    const { ctx } = makeCtx();
    const req = new Request('https://striatix.com/api/waitlist', {
      method: 'POST',
      headers: { Origin: 'https://striatix.com', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'noclock@example.com' }),
    });
    expect((await handleWaitlist(req, env, ctx, makeDeps().deps)).status).toBe(200);
    expect(await rows()).toHaveLength(0);
  });

  it('accepts exactly 2 seconds', async () => {
    await submit({ email: 'human@example.com', elapsed_ms: MIN_FILL_MS });
    expect(await rows()).toHaveLength(1);
  });
});

describe('rate limiting', () => {
  it(`allows ${LIMITS.perIpPerHour} signups per IP per hour, then 429`, async () => {
    const h = makeDeps();
    for (let i = 0; i < LIMITS.perIpPerHour; i++) {
      const { res } = await submit({ email: `ip${i}@example.com` }, h, { ip: '192.0.2.1' });
      expect(res.status).toBe(200);
    }
    const { res, json } = await submit({ email: 'ip-extra@example.com' }, h, { ip: '192.0.2.1' });
    expect(res.status).toBe(429);
    expect(json).toEqual({ ok: false, error: 'rate_limited' });
    expect(await rows()).toHaveLength(LIMITS.perIpPerHour);

    // A different IP is unaffected, and the same IP recovers after the hour.
    expect((await submit({ email: 'other@example.com' }, h, { ip: '192.0.2.99' })).res.status).toBe(200);
    h.advance(61 * MINUTE);
    expect((await submit({ email: 'later@example.com' }, h, { ip: '192.0.2.1' })).res.status).toBe(200);
  });

  it('allows one submission per email per minute', async () => {
    const h = makeDeps();
    expect((await submit({ email: 'quick@example.com' }, h, { ip: '192.0.2.10' })).res.status).toBe(200);
    expect((await submit({ email: 'quick@example.com' }, h, { ip: '192.0.2.11' })).res.status).toBe(429);
    h.advance(MINUTE);
    expect((await submit({ email: 'quick@example.com' }, h, { ip: '192.0.2.12' })).res.status).toBe(200);
  });

  it('stores no raw email or IP in the rate-limit table', async () => {
    await submit({ email: 'private@example.com' }, makeDeps(), { ip: '192.0.2.50' });
    const keys = await testEnv().DB.prepare('SELECT key FROM rate_limits').all<{ key: string }>();
    const all = keys.results.map((r) => r.key).join(' ');
    expect(all).not.toContain('private@example.com');
    expect(all).not.toContain('192.0.2.50');
  });
});

describe('origin rules (no CORS wildcard)', () => {
  it('echoes only the production origin', async () => {
    const { res } = await submit({ email: 'o@example.com' });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://striatix.com');
  });

  it('refuses an unknown browser origin', async () => {
    const { res } = await submit({ email: 'evil@example.com' }, makeDeps(), { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(await rows()).toHaveLength(0);
  });

  it('refuses localhost in production, allows it in development', async () => {
    expect((await submit({ email: 'l1@example.com' }, makeDeps(), { origin: 'http://localhost:8788' })).res.status).toBe(403);
    const dev = testEnv({ ENVIRONMENT: 'development' });
    const { res } = await submit({ email: 'l2@example.com' }, makeDeps(), { origin: 'http://localhost:8788' }, dev);
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:8788');
  });

  it('preflight: 204 for allowed origins, 403 otherwise', () => {
    const env = testEnv();
    const pre = (origin: string) =>
      handleWaitlistOptions(new Request('https://striatix.com/api/waitlist', { method: 'OPTIONS', headers: { Origin: origin } }), env);
    expect(pre('https://striatix.com').status).toBe(204);
    expect(pre('https://evil.example').status).toBe(403);
  });
});

describe('server errors are reported, not hidden', () => {
  it('returns 500 server_error when the server is misconfigured', async () => {
    const { res, json } = await submit({ email: 'cfg@example.com' }, makeDeps(), {}, testEnv({ IP_HASH_PEPPER: undefined }));
    expect(res.status).toBe(500);
    expect(json).toEqual({ ok: false, error: 'server_error' });
  });

  it('a failing email provider does not fail the signup', async () => {
    const h = makeDeps();
    h.deps.mailer = async () => {
      throw new Error('provider down');
    };
    const { res } = await submit({ email: 'resilient@example.com' }, h);
    expect(res.status).toBe(200);
    expect(await rows()).toHaveLength(1);
  });
});

describe('timing', () => {
  it('new and existing emails both wait for the latency floor', async () => {
    const env = testEnv();
    const timed = async (email: string, advance = 0) => {
      const h = makeDeps(Date.now() + advance);
      h.deps.now = () => Date.now() + advance;
      h.deps.minLatencyMs = 120;
      const { ctx, flush } = makeCtx();
      const t0 = Date.now();
      const res = await handleWaitlist(signupRequest({ email }), env, ctx, h.deps);
      const dt = Date.now() - t0;
      await flush();
      return { status: res.status, dt };
    };
    const first = await timed('timing@example.com');
    const again = await timed('timing@example.com', 2 * MINUTE);
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(first.dt).toBeGreaterThanOrEqual(120);
    expect(again.dt).toBeGreaterThanOrEqual(120);
  });
});
