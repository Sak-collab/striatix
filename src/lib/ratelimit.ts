export interface Limit {
  key: string;
  /** Window length in seconds. */
  window: number;
  max: number;
}

/**
 * Fixed-window counters in D1. Increments every limit atomically per key and returns
 * true if any of them is now over its max. Counting happens even when the request is
 * rejected, so hammering the endpoint keeps you limited.
 */
export async function overLimit(db: D1Database, limits: Limit[], nowSec: number): Promise<boolean> {
  const stmts = limits.map((l) =>
    db
      .prepare(
        `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
         ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1
         RETURNING count`,
      )
      .bind(l.key, Math.floor(nowSec / l.window) * l.window),
  );
  const results = await db.batch<{ count: number }>(stmts);
  return results.some((r, i) => (r.results[0]?.count ?? 0) > limits[i]!.max);
}

/** Drop windows older than a day. Cheap; called opportunistically. */
export async function pruneRateLimits(db: D1Database, nowSec: number): Promise<void> {
  await db.prepare('DELETE FROM rate_limits WHERE window_start < ?1').bind(nowSec - 86_400).run();
}
