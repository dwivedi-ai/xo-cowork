import type { NextConfig } from "next";
import path from "path";

const isDesktopBuild = process.env.DESKTOP_BUILD === "true";

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },

  turbopack: {
    root: path.resolve(__dirname),
  },

  // Disable built-in gzip compression. Next.js compresses streaming
  // responses (e.g. /codex/setup SSE), which buffers small chunks until
  // enough data accumulates for the gzip encoder to flush. The codex
  // device-auth flow emits ~200 bytes (URL + code) and then idles 15min
  // while polling — those bytes never reach the browser through the
  // gzip buffer. We hit the upstream over loopback so the bandwidth
  // cost of skipping gzip is negligible.
  compress: false,

  // Static export for Electron desktop builds
  ...(isDesktopBuild && {
    output: "export",
    images: { unoptimized: true },
  }),

  // API proxy rewrites (only needed in web mode, not in static export)
  ...(!isDesktopBuild && {
    async rewrites() {
      return [
        {
          source: "/api/:path*",
          destination: `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5002"}/api/:path*`,
        },
        {
          source: "/health",
          destination: `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5002"}/health`,
        },
        {
          source: "/gateway/:path*",
          destination: `${process.env.NEXT_PUBLIC_XO_COWORK_API_URL || "http://localhost:5002"}/gateway/:path*`,
        },
        {
          source: "/codex/:path*",
          destination: `${process.env.NEXT_PUBLIC_XO_COWORK_API_URL || "http://localhost:5002"}/codex/:path*`,
        },
      ];
    },
  }),
};

export default nextConfig;
