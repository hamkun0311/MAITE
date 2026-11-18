import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.MAITE_TEST_MODE === "1" ? ".next-test" : ".next",
  devIndicators: false,
  outputFileTracingIncludes: {
    "/api/characters": ["./public/references/anime-style.png", "./public/references/female-nurse-style.jpg"],
  },
  webpack(config) {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
      crypto: false,
    };
    return config;
  },
  async headers() {
    return [
      {
        source: "/wasm/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
      },
    ];
  },
};
export default nextConfig;
