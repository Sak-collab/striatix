// Cron worker: every 15 minutes, send the owner one digest of signups that weren't
// covered by an immediate notification (see src/lib/notify.ts).
import type { Env } from '../../src/env';
import { resendMailer } from '../../src/lib/mailer';
import { notifyOwner } from '../../src/lib/notify';

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      notifyOwner(env, resendMailer, Date.now(), true).catch((err: Error) =>
        console.error(`[digest] failed: ${err.message}`),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
