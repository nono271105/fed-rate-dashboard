import "dotenv/config";
import { nodeHTTPRequestHandler } from "@trpc/server/adapters/node-http";
import { appRouter } from "../../server/routers";
import { createContext } from "../../server/_core/context";

export default async function handler(req: any, res: any) {
  const url = req.url || "";
  const path = url.replace(/^.*\/trpc\/?/, "").split("?")[0] || "";
  return nodeHTTPRequestHandler({
    req,
    res,
    router: appRouter,
    createContext,
    path,
  });
}
