import "dotenv/config";
import type { IncomingMessage, ServerResponse } from "node:http";
import { nodeHTTPRequestHandler } from "@trpc/server/adapters/node-http";
import { appRouter } from "../../server/routers";

export default function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const path = url.pathname.replace(/^\/api\/trpc\/?/, "");
  return nodeHTTPRequestHandler({
    req,
    res,
    path,
    router: appRouter,
    createContext: () => ({ req: req as never }),
  });
}
