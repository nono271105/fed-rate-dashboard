import { refreshEcbDashboard } from "./ecb";
import { refreshFedDashboard } from "./fedwatch";
import { publicProcedure, router } from "./_core/trpc";

export const appRouter = router({
  fed: router({
    dashboard: publicProcedure.query(() => refreshFedDashboard()),
    refresh: publicProcedure.mutation(() => refreshFedDashboard()),
  }),
  ecb: router({
    dashboard: publicProcedure.query(() => refreshEcbDashboard()),
    refresh: publicProcedure.mutation(() => refreshEcbDashboard()),
  }),
});

export type AppRouter = typeof appRouter;
