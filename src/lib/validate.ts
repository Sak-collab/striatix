export const PLAN_TIERS = ['once', 'subscribe', 'trial'] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export const SOURCES = ['section', 'footer'] as const;
export type Source = (typeof SOURCES)[number];

const MAX_EMAIL = 254;
// Pragmatic: one @, no whitespace, a dot in the domain, TLD of 2+ letters.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[A-Za-z]{2,}$/;

/**
 * Returns the normalised (trimmed, lowercased) email, or null if invalid.
 * Rejects anything containing whitespace or control characters inside the address,
 * including newlines (header-injection guard), and anything over 254 characters.
 */
export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  // Line breaks or control characters anywhere (even trailing) are rejected outright:
  // they're never typed into an email field and they're how header injection starts.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(input)) return null;
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_EMAIL) return null;
  if (/\s/.test(trimmed)) return null;
  if (!EMAIL_RE.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function normalizePlan(input: unknown): PlanTier | null {
  return typeof input === 'string' && (PLAN_TIERS as readonly string[]).includes(input) ? (input as PlanTier) : null;
}

export function normalizeSource(input: unknown): Source {
  return typeof input === 'string' && (SOURCES as readonly string[]).includes(input) ? (input as Source) : 'section';
}

/** Trim free-text metadata to a safe length; returns null for empty or non-strings. */
export function clip(input: unknown, max: number): string | null {
  if (typeof input !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const v = input.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return v ? v.slice(0, max) : null;
}
