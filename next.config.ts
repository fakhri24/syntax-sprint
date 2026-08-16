import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev overlay renders a fixed-position portal that intercepts pointer
  // events, which makes Playwright clicks flaky for reasons unrelated to the app.
  devIndicators: false,
  /* config options here */
};

export default nextConfig;
