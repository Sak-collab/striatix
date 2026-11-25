export interface Env {
  DB: D1Database;

  /** 'development' allows localhost origins and a mock mailer when no API key is set. */
  ENVIRONMENT?: string;
  ALLOWED_ORIGIN?: string;
  PUBLIC_BASE_URL?: string;

  IP_HASH_PEPPER?: string;
  EMAIL_PROVIDER_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_FROM_NAME?: string;
  EMAIL_REPLY_TO?: string;
  NOTIFY_TO?: string;
  NOTIFY_TIMEZONE?: string;
  ADMIN_EXPORT_TOKEN?: string;
}

/** Minimal slice of the Pages/Workers execution context the handlers need. */
export interface Ctx {
  waitUntil(promise: Promise<unknown>): void;
}

export const isDev = (env: Env) => env.ENVIRONMENT === 'development';
