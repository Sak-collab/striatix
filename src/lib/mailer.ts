import { isDev, type Env } from '../env';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  /** Extra headers, e.g. List-Unsubscribe. */
  headers?: Record<string, string>;
}

export type Mailer = (env: Env, mail: Mail) => Promise<void>;

export class MailerNotConfigured extends Error {
  constructor(missing: string[]) {
    super(`Email is not configured: set ${missing.join(', ')}`);
    this.name = 'MailerNotConfigured';
  }
}

/** Mask an address for logs: "pe***@ex***.com". Never log a full address. */
export const maskEmail = (email: string) => {
  const [user = '', domain = ''] = email.split('@');
  const [host = '', ...rest] = domain.split('.');
  return `${user.slice(0, 2)}***@${host.slice(0, 2)}***.${rest.join('.')}`;
};

/**
 * Sends through Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email).
 * In development with no API key, the email is printed (masked recipient) instead of sent.
 */
export const resendMailer: Mailer = async (env, mail) => {
  const missing = (['EMAIL_PROVIDER_API_KEY', 'EMAIL_FROM'] as const).filter((k) => !env[k]);
  if (missing.length) {
    if (isDev(env)) {
      console.log(`[mailer:dev] to=${maskEmail(mail.to)} subject="${mail.subject}"\n${mail.text}`);
      return;
    }
    throw new MailerNotConfigured([...missing]);
  }
  const from = env.EMAIL_FROM_NAME ? `${env.EMAIL_FROM_NAME} <${env.EMAIL_FROM}>` : env.EMAIL_FROM!;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.EMAIL_PROVIDER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [mail.to],
      reply_to: env.EMAIL_REPLY_TO || undefined,
      subject: mail.subject,
      text: mail.text,
      headers: mail.headers,
    }),
  });
  if (!res.ok) {
    // Resend error bodies don't contain the recipient; status + body is safe to log.
    throw new Error(`Resend responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
};

/* ───────── Templates. No health or benefit claims, per the compliance rule. ───────── */

const CONTACT = 'striatixsupps@gmail.com';

export function confirmationEmail(to: string, unsubscribeUrl: string): Mail {
  return {
    to,
    subject: "You're on the Striatix waitlist",
    text: [
      "You're on the list.",
      '',
      "We'll email you the moment Striatix is available — one email, no more.",
      '',
      '7-in-1 cognitive drink powder. 30 servings. Every dose printed on the label.',
      '',
      '— Striatix Supplements',
      CONTACT,
      '',
      `Unsubscribe: ${unsubscribeUrl}`,
    ].join('\n'),
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

export interface SignupRow {
  email: string;
  source: string | null;
  plan_interest: string | null;
  created_at: string;
}

export function formatWhen(iso: string, timeZone: string): string {
  try {
    const d = new Date(iso);
    const s = new Intl.DateTimeFormat('en-US', {
      timeZone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(d);
    return `${s} (${timeZone})`;
  } catch {
    return `${iso} (UTC)`;
  }
}

export function ownerNotification(to: string, rows: SignupRow[], total: number, timeZone: string): Mail {
  if (rows.length === 1) {
    const r = rows[0]!;
    return {
      to,
      subject: `New waitlist signup — ${r.plan_interest ?? 'no tier'}`,
      text: [
        `Email:   ${r.email}`,
        `Source:  ${r.source ?? 'section'}`,
        `Tier:    ${r.plan_interest ?? 'none'}`,
        `When:    ${formatWhen(r.created_at, timeZone)}`,
        `Total on list: ${total}`,
      ].join('\n'),
    };
  }
  return {
    to,
    subject: `${rows.length} new waitlist signups`,
    text: [
      `${rows.length} people joined the waitlist since the last update.`,
      '',
      ...rows.map((r) => `${formatWhen(r.created_at, timeZone)}  ${r.email}  tier=${r.plan_interest ?? 'none'}  source=${r.source ?? 'section'}`),
      '',
      `Total on list: ${total}`,
    ].join('\n'),
  };
}
