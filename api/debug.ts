export default async function handler(req: any, res: any) {
  try {
    const { appRouter } = await import("../server/routers.js").catch(async () => {
      return await import("../server/routers");
    });
    const { refreshFedDashboard } = await import("../server/fedwatch.js").catch(async () => {
      return await import("../server/fedwatch");
    });
    const fed = await refreshFedDashboard();
    res.status(200).json({ status: "ok", fed: fed.snapshot.source });
  } catch (err: any) {
    res.status(500).json({
      error: err?.message,
      stack: err?.stack,
    });
  }
}
