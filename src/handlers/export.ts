import type { Env } from '../env';
import { timingSafeEqual } from '../lib/crypto';

/**
 * Columns from the brief, plus `unsubscribed` (see DECISIONS.md): without it an export
 * would hand back people who asked to stop hearing from us.
 */
export const CSV_COLUMNS = [
  'email',
  'created_at',
  'plan_interest',
  'source',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'confirmed',
  'unsubscribed',
] as const;

/** RFC 4180 quoting, plus a guard against spreadsheet formula injection (=, +, -, @, tab, CR). */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function handleExport(request: Request, env: Env): Promise<Response> {
  const token = env.ADMIN_EXPORT_TOKEN;
  // No token configured: behave as if the route doesn't exist.
  if (!token) return new Response('Not found', { status: 404 });

  const auth = request.headers.get('Authorization') || '';
  const given = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!given || !timingSafeEqual(given, token)) {
    return new Response('Unauthorized', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Bearer realm="striatix-admin"', 'Cache-Control': 'no-store' },
    });
  }

  const rows = await env.DB.prepare(`SELECT ${CSV_COLUMNS.join(', ')} FROM waitlist ORDER BY id`).all<Record<string, unknown>>();
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of rows.results) lines.push(CSV_COLUMNS.map((c) => csvCell(r[c])).join(','));

  const date = new Date().toISOString().slice(0, 10);
  return new Response(lines.join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="striatix-waitlist-${date}.csv"`,
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}
