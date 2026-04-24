import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  // Next.js 16 blocks cross-origin requests to dev resources by default.
  // Allow 127.0.0.1 so HMR + webpack-hmr work when the browser also uses 127.0.0.1.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  experimental: {
    // App Router features enabled by default in Next.js 16.
  },
};

export default nextConfig;
