import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: true,
  // Load Baileys (WhatsApp) from node_modules at runtime instead of
  // bundling it. The server-start hook (src/instrumentation.ts) is bundled,
  // and Baileys' optional image libraries (jimp/sharp) can't be resolved
  // by the bundler.
  serverExternalPackages: ["@whiskeysockets/baileys"],
};

export default nextConfig;
