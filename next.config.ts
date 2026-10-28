import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // On Vercel each route is packaged with only the files Next.js can tell it uses.
  // lib/retrieve.ts reads data/index.json with fs by name, which it may not notice,
  // so list it here or the chat route would start without it.
  outputFileTracingIncludes: {
    "/api/chat": ["./data/index.json"],
  },
};

export default nextConfig;
