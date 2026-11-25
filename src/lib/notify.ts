import type { Env } from '../env';
import { ownerNotification, type Mailer, type SignupRow } from './mailer';

export const DIGEST_WINDOW_SEC = 15 * 60;

/**
 * Sends the owner a notification for every signup not yet covered by one.
 *
 * - From the signup request (`force=false`): sends only if nothing went out in the last
 *   15 minutes. Otherwise the rows wait for the next window.
 * - From the cron worker (`force=true`): flushes whatever is pending.
 *
 * One pending row gives the single-signup email; several give one digest. A conditional
 * upsert on app_state acts as the lock, so concurrent requests can't both send.
 */
export async function notifyOwner(env: Env, mailer: Mailer, nowMs: number, force: boolean): Promise<number> {
  const db = env.DB;
  const to = env.NOTIFY_TO;
  if (!to) return 0;

  const pending = await db
    .prepare(
      `SELECT id, email, source, plan_interest, created_at FROM waitlist
       WHERE notified_at IS NULL ORDER BY id LIMIT 500`,
    )
    .all<SignupRow & { id: number }>();
  if (pending.results.length === 0) return 0;

  const now = new Date(nowMs).toISOString();
  const cutoff = new Date(nowMs - DIGEST_WINDOW_SEC * 1000).toISOString();
  const lock = await db
    .prepare(
      `INSERT INTO app_state (key, value) VALUES ('last_notify_at', ?1)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value
       WHERE ?3 = 1 OR app_state.value <= ?2`,
    )
    .bind(now, cutoff, force ? 1 : 0)
    .run();
  if (!lock.meta.changes) return 0; // someone notified recently; the cron will pick these up

  const total = await db.prepare('SELECT COUNT(*) AS n FROM waitlist WHERE unsubscribed = 0').first<{ n: number }>();
  const rows = pending.results;
  await mailer(env, ownerNotification(to, rows, total?.n ?? rows.length, env.NOTIFY_TIMEZONE || 'UTC'));

  const ids = rows.map((r) => r.id);
  await db
    .prepare(`UPDATE waitlist SET notified_at = ?1 WHERE id IN (${ids.map(() => '?').join(',')})`)
    .bind(now, ...ids)
    .run();
  return rows.length;
}

