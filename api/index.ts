import "dotenv/config";
import { createApiApp } from "../server/_core/api";

const app = createApiApp();

export default function handler(req: any, res: any) {
  return app(req, res);
}
