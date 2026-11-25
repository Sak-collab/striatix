import type { Env } from '../env';
import { sign, timingSafeEqual } from '../lib/crypto';
import { html } from '../lib/http';

const page = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${title} · Striatix</title>
<style>
  body{margin:0;font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#14161A;background:#fff;
       display:grid;place-items:center;min-height:100vh;padding:24px}
  main{max-width:28rem}
  h1{font-weight:400;font-size:1.6rem;letter-spacing:-.02em;margin:0 0 12px}
  button{font:inherit;padding:12px 22px;border-radius:999px;border:0;background:#1F5D45;color:#fff;cursor:pointer}
  button:focus-visible{outline:2px solid #14161A;outline-offset:3px}
  a{color:#1F5D45}
</style></head><body><main>${body}</main></body></html>`;

async function verify(env: Env, url: URL): Promise<number | null> {
  const id = Number(url.searchParams.get('id'));
  const t = url.searchParams.get('t') || '';
  if (!Number.isInteger(id) || id <= 0 || !t || !env.IP_HASH_PEPPER) return null;
  const expected = await sign(env.IP_HASH_PEPPER, 'unsubscribe', String(id));
  return timingSafeEqual(t, expected) ? id : null;
}

const invalid = () =>
  html(page('Link not valid', `<h1>This link isn't valid.</h1><p>It may be incomplete. Email <a href="mailto:striatixsupps@gmail.com">striatixsupps@gmail.com</a> and we'll remove you by hand.</p>`), 400);

/**
 * GET shows a confirm button (link scanners in mail clients prefetch GETs, so GET never unsubscribes).
 * POST unsubscribes. Mail clients' one-click (RFC 8058) also POSTs here.
 */
export async function handleUnsubscribeGet(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const id = await verify(env, url);
  if (!id) return invalid();
  const action = `/api/unsubscribe?id=${id}&t=${encodeURIComponent(url.searchParams.get('t')!)}`;
  return html(
    page(
      'Unsubscribe',
      `<h1>Stop Striatix waitlist emails?</h1><p>You won't get the launch email.</p>
       <form method="post" action="${action}"><button type="submit">Unsubscribe</button></form>`,
    ),
  );
}

export async function handleUnsubscribePost(request: Request, env: Env): Promise<Response> {
  const id = await verify(env, new URL(request.url));
  if (!id) return invalid();
  await env.DB.prepare('UPDATE waitlist SET unsubscribed = 1 WHERE id = ?1').bind(id).run();
  return html(page('Unsubscribed', `<h1>You're unsubscribed.</h1><p>You won't hear from us again about the waitlist.</p>`));
}
