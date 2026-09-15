import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { refreshEcbDashboard } from "./ecb";
import { refreshFedDashboard } from "./fedwatch";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => { const cookieOptions = getSessionCookieOptions(ctx.req); ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 }); return { success: true } as const; }),
  }),
  fed: router({
    dashboard: publicProcedure.input(z.object({ force: z.boolean().optional() }).optional()).query(({ input }) => refreshFedDashboard(input?.force ?? false)),
    refresh: publicProcedure.mutation(() => refreshFedDashboard(true)),
  }),
  ecb: router({
    dashboard: publicProcedure.input(z.object({ force: z.boolean().optional() }).optional()).query(({ input }) => refreshEcbDashboard(input?.force ?? false)),
    refresh: publicProcedure.mutation(() => refreshEcbDashboard(true)),
  }),
});

export type AppRouter = typeof appRouter;
