import type { Ctx, Env } from '../env';
import { pepperedHash, sign } from '../lib/crypto';
import { corsHeaders, json, originAllowed, sleep } from '../lib/http';
import { confirmationEmail, maskEmail, resendMailer, type Mailer } from '../lib/mailer';
import { notifyOwner } from '../lib/notify';
import { overLimit, pruneRateLimits } from '../lib/ratelimit';
import { clip, normalizeEmail, normalizePlan, normalizeSource } from '../lib/validate';

export interface Deps {
  mailer: Mailer;
  now: () => number;
  /** Responses are padded to at least this long (+ jitter) so timing doesn't reveal membership. */
  minLatencyMs: number;
}

export const defaultDeps: Deps = { mailer: resendMailer, now: () => Date.now(), minLatencyMs: 350 };

export const MIN_FILL_MS = 2000;
const MAX_BODY_BYTES = 4096;
const OK = { ok: true, message: "You're on the list." } as const;

export const LIMITS = {
  perIpPerHour: 5,
  perEmailPerMinute: 1,
};

type Outcome =
  | { kind: 'ok' }
  | { kind: 'discard' } // honeypot / too-fast: looks like success to the client
  | { kind: 'invalid' }
  | { kind: 'limited' }
  | { kind: 'error' }
  | { kind: 'forbidden' };

export async function unsubscribeUrl(env: Env, id: number): Promise<string> {
  const t = await sign(env.IP_HASH_PEPPER!, 'unsubscribe', String(id));
  const base = (env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  return `${base}/api/unsubscribe?id=${id}&t=${t}`;
}

export async function handleWaitlist(request: Request, env: Env, ctx: Ctx, deps: Deps = defaultDeps): Promise<Response> {
  const started = deps.now();
  const outcome = await process(request, env, ctx, deps);

  // Constant-ish time: every path waits until the same floor, plus a little jitter.
  const elapsed = deps.now() - started;
  const floor = deps.minLatencyMs + Math.floor(Math.random() * 60);
  if (deps.minLatencyMs > 0 && elapsed < floor) await sleep(floor - elapsed);

  const cors = corsHeaders(env, request);
  switch (outcome.kind) {
    case 'ok':
    case 'discard':
      return json(OK, 200, cors);
    case 'invalid':
      return json({ ok: false, error: 'invalid_email' }, 400, cors);
    case 'limited':
      return json({ ok: false, error: 'rate_limited' }, 429, { ...cors, 'Retry-After': '300' });
    case 'forbidden':
      return json({ ok: false, error: 'forbidden' }, 403);
    case 'error':
    default:
      return json({ ok: false, error: 'server_error' }, 500, cors);
  }
}

async function process(request: Request, env: Env, ctx: Ctx, deps: Deps): Promise<Outcome> {
  // Browsers always send Origin on a cross-site POST. A present-but-unknown origin is refused.
  const origin = request.headers.get('Origin');
  if (origin && !originAllowed(env, origin)) return { kind: 'forbidden' };

  if (!env.IP_HASH_PEPPER) {
    console.error('[waitlist] IP_HASH_PEPPER is not set');
    return { kind: 'error' };
  }

  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return { kind: 'invalid' };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { kind: 'invalid' };
    body = parsed as Record<string, unknown>;
  } catch {
    return { kind: 'invalid' };
  }

  // Spam: honeypot filled, or the form was submitted faster than a person can.
  if (typeof body.website === 'string' && body.website.trim() !== '') return { kind: 'discard' };
  const elapsed = typeof body.elapsed_ms === 'number' && Number.isFinite(body.elapsed_ms) ? body.elapsed_ms : 0;
  if (elapsed < MIN_FILL_MS) return { kind: 'discard' };

  const email = normalizeEmail(body.email);
  if (!email) return { kind: 'invalid' };

  const pepper = env.IP_HASH_PEPPER;
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const ipHash = ip ? await pepperedHash(ip, pepper) : null;
  const nowSec = Math.floor(deps.now() / 1000);

  try {
    const limits = [{ key: `em:${await pepperedHash(email, pepper)}`, window: 60, max: LIMITS.perEmailPerMinute }];
    if (ipHash) limits.push({ key: `ip:${ipHash}`, window: 3600, max: LIMITS.perIpPerHour });
    if (await overLimit(env.DB, limits, nowSec)) return { kind: 'limited' };

    const inserted = await env.DB.prepare(
      `INSERT INTO waitlist
         (email, source, plan_interest, page_path, referrer, utm_source, utm_medium, utm_campaign, ip_hash, user_agent, confirmed)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0)
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
    )
      .bind(
        email,
        normalizeSource(body.source),
        normalizePlan(body.plan_interest),
        clip(body.page_path, 300),
        clip(body.referrer, 500),
        clip(body.utm_source, 100),
        clip(body.utm_medium, 100),
        clip(body.utm_campaign, 100),
        ipHash,
        clip(request.headers.get('User-Agent'), 200),
      )
      .first<{ id: number }>();

    if (inserted) {
      const id = inserted.id;
      ctx.waitUntil(
        (async () => {
          try {
            await deps.mailer(env, confirmationEmail(email, await unsubscribeUrl(env, id)));
          } catch (err) {
            console.error(`[waitlist] confirmation email failed for id=${id}: ${(err as Error).message}`);
          }
          try {
            await notifyOwner(env, deps.mailer, deps.now(), false);
          } catch (err) {
            console.error(`[waitlist] owner notification failed: ${(err as Error).message}`);
          }
        })(),
      );
    } else {
      // Already on the list. Re-joining after an unsubscribe is a fresh opt-in.
      await env.DB.prepare('UPDATE waitlist SET unsubscribed = 0 WHERE email = ?1 AND unsubscribed = 1').bind(email).run();
    }

    if (Math.random() < 0.02) ctx.waitUntil(pruneRateLimits(env.DB, nowSec).catch(() => undefined));
    return { kind: 'ok' };
  } catch (err) {
    console.error(`[waitlist] write failed for ${maskEmail(email)}: ${(err as Error).message}`);
    return { kind: 'error' };
  }
}

export function handleWaitlistOptions(request: Request, env: Env): Response {
  const cors = corsHeaders(env, request);
  return new Response(null, { status: Object.keys(cors).length ? 204 : 403, headers: cors });
}
