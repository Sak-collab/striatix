-- Waitlist signups. Email is stored trimmed + lowercased; uniqueness is enforced on that.
CREATE TABLE waitlist (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  source        TEXT    CHECK (source IN ('section', 'footer')),
  plan_interest TEXT    CHECK (plan_interest IN ('once', 'subscribe', 'trial')),
  page_path     TEXT,
  referrer      TEXT,
  utm_source    TEXT,
  utm_medium    TEXT,
  utm_campaign  TEXT,
  ip_hash       TEXT,                                   -- sha256(ip + IP_HASH_PEPPER); raw IP is never stored
  user_agent    TEXT,                                   -- trimmed to 200 chars
  confirmed     INTEGER NOT NULL DEFAULT 0 CHECK (confirmed IN (0, 1)),       -- phase 1: always 0
  unsubscribed  INTEGER NOT NULL DEFAULT 0 CHECK (unsubscribed IN (0, 1)),
  notified_at   TEXT                                    -- when the owner notification covering this row went out
);

CREATE INDEX waitlist_created_at ON waitlist (created_at);
CREATE INDEX waitlist_pending_notify ON waitlist (notified_at) WHERE notified_at IS NULL;

-- Fixed-window rate-limit counters. key is e.g. 'ip:<hash>' or 'em:<hash>'; never a raw IP or email.
CREATE TABLE rate_limits (
  key          TEXT    NOT NULL,
  window_start INTEGER NOT NULL,                        -- unix seconds, floored to the window size
  count        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

-- Small key/value table for job state, e.g. when the last owner notification was sent.
CREATE TABLE app_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
