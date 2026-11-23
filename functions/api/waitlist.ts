import type { Env } from '../../src/env';
import { handleWaitlist, handleWaitlistOptions } from '../../src/handlers/waitlist';

export const onRequestPost: PagesFunction<Env> = (ctx) => handleWaitlist(ctx.request, ctx.env, ctx);
export const onRequestOptions: PagesFunction<Env> = (ctx) => handleWaitlistOptions(ctx.request, ctx.env);
