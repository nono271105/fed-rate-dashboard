import { z } from "zod";
import { refreshEcbDashboard } from "./ecb";
import { refreshFedDashboard } from "./fedwatch";
import { publicProcedure, router } from "./_core/trpc";

export const appRouter = router({
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
