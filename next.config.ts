import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  experimental: {
    // App Router features enabled by default in Next.js 16.
  },
};

export default nextConfig;
