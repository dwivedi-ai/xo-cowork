import type { NextConfig } from "next";
import path from "path";
import bundleAnalyzer from "@next/bundle-analyzer";

const isDesktopBuild = process.env.DESKTOP_BUILD === "true";
const isProd = process.env.NODE_ENV === "production";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },

  // Static export for Tauri desktop builds; otherwise use standalone
  // server output so the container ships only the runtime it needs.
  ...(isDesktopBuild
    ? {
        output: "export",
        images: { unoptimized: true },
      }
    : {
        output: "standalone",
      }),

  // Strip console.log/console.info in prod builds (keeps warn/error).
  compiler: {
    removeConsole: isProd ? { exclude: ["error", "warn"] } : false,
  },

  // Let Next automatically split these packages per-import so unused
  // icons / Radix primitives / date-fns helpers never land in the bundle.
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "date-fns",
      "@radix-ui/react-avatar",
      "@radix-ui/react-collapsible",
      "@radix-ui/react-context-menu",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-popover",
      "@radix-ui/react-scroll-area",
      "@radix-ui/react-select",
      "@radix-ui/react-separator",
      "@radix-ui/react-slot",
      "@radix-ui/react-switch",
      "@radix-ui/react-toggle",
      "@radix-ui/react-tooltip",
      "@radix-ui/react-visually-hidden",
    ],
  },

  // API proxy rewrites (only needed in web mode, not in static export)
  ...(!isDesktopBuild && {
    async rewrites() {
      return [
        {
          source: "/api/:path*",
          destination: `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/:path*`,
        },
        {
          source: "/health",
          destination: `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/health`,
        },
        {
          source: "/gateway/:path*",
          destination: `${process.env.NEXT_PUBLIC_XO_COWORK_API_URL || "http://localhost:5002"}/gateway/:path*`,
        },
      ];
    },
  }),
};

export default withBundleAnalyzer(nextConfig);
