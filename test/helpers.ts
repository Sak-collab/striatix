import { env } from 'cloudflare:workers';

import type { Env } from '../src/env';
import type { Deps } from '../src/handlers/waitlist';
import type { Mail } from '../src/lib/mailer';

export const testEnv = (overrides: Partial<Env> = {}): Env => ({ ...(env as unknown as Env), ...overrides });

/** Execution context that collects waitUntil promises so a test can await them. */
export function makeCtx() {
  const pending: Promise<unknown>[] = [];
  return {
    ctx: { waitUntil: (p: Promise<unknown>) => void pending.push(p) },
    flush: () => Promise.all(pending),
  };
}

/** Deterministic deps: a controllable clock, a recording mailer, no latency padding. */
export function makeDeps(startMs = Date.UTC(2026, 10, 23, 12, 0, 0)) {
  const sent: Mail[] = [];
  let now = startMs;
  const deps: Deps = {
    mailer: async (_env, mail) => void sent.push(mail),
    now: () => now,
    minLatencyMs: 0,
  };
  return {
    deps,
    sent,
    advance: (ms: number) => void (now += ms),
    nowMs: () => now,
  };
}

export function signupRequest(
  body: Record<string, unknown>,
  init: { ip?: string; origin?: string | null; ua?: string } = {},
): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.origin !== null) headers.Origin = init.origin ?? 'https://striatix.com';
  headers['CF-Connecting-IP'] = init.ip ?? '203.0.113.7';
  if (init.ua) headers['User-Agent'] = init.ua;
  return new Request('https://striatix.com/api/waitlist', {
    method: 'POST',
    headers,
    body: JSON.stringify({ elapsed_ms: 5000, source: 'section', ...body }),
  });
}

export async function rows() {
  const r = await (env as unknown as Env).DB.prepare('SELECT * FROM waitlist ORDER BY id').all<Record<string, unknown>>();
  return r.results;
}
