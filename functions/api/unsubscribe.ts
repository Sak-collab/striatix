import type { Env } from '../../src/env';
import { handleUnsubscribeGet, handleUnsubscribePost } from '../../src/handlers/unsubscribe';

export const onRequestGet: PagesFunction<Env> = (ctx) => handleUnsubscribeGet(ctx.request, ctx.env);
export const onRequestPost: PagesFunction<Env> = (ctx) => handleUnsubscribePost(ctx.request, ctx.env);
