export default function handler(req: any, res: any) {
  res.status(200).json({
    status: "ok",
    node: process.version,
    env_fred: !!process.env.FRED_API_KEY,
    env_massive: !!process.env.MASSIVE_API_KEY
  });
}
