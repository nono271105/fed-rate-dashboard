// api/ping.ts
function handler(req, res) {
  res.status(200).json({
    status: "ok",
    node: process.version,
    env_fred: !!process.env.FRED_API_KEY,
    env_massive: !!process.env.MASSIVE_API_KEY
  });
}
export {
  handler as default
};
