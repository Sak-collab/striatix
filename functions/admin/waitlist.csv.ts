import type { Env } from '../../src/env';
import { handleExport } from '../../src/handlers/export';

export const onRequestGet: PagesFunction<Env> = (ctx) => handleExport(ctx.request, ctx.env);
