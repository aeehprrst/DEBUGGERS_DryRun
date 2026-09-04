import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // /api/* proxies to the engine's SSE stream (see rewrites below). gzip
  // buffers output until a flush threshold is met — one that a stream which
  // never ends (SSE) may never reach — so a real browser (which always
  // sends `Accept-Encoding: gzip`) can hang indefinitely waiting for events
  // that already arrived at this server. curl doesn't send that header by
  // default, which is why this was invisible to every curl-based check.
  compress: false,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:4000/:path*",
      },
      {
        // AppState.screenshotPath points at "/static/runs/...", served
        // directly by the engine — without this, Atlas3D's textures 404.
        source: "/static/:path*",
        destination: "http://localhost:4000/static/:path*",
      },
    ];
  },
};

export default nextConfig;
