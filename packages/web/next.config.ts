import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

// Load env from monorepo root so vars are available at config time
const __dirname = dirname(fileURLToPath(import.meta.url));
const { combinedEnv } = loadEnvConfig(resolve(__dirname, "../.."));

const nextConfig: NextConfig = {
  // Forward env vars into the server runtime
  env: {
    SUPABASE_URL: combinedEnv.SUPABASE_URL ?? "",
    SUPABASE_KEY: combinedEnv.SUPABASE_KEY ?? "",
    ANTHROPIC_API_KEY: combinedEnv.ANTHROPIC_API_KEY ?? "",
    OPENWEATHER_API_KEY: combinedEnv.OPENWEATHER_API_KEY ?? "",
    ADMIN_PHONE_NUMBER: combinedEnv.ADMIN_PHONE_NUMBER ?? "",
  },
  // Transpile the bot workspace package so Next.js can process its TypeScript
  transpilePackages: ["@sam/bot"],
  serverExternalPackages: ["@anthropic-ai/sdk"],
  webpack: (config) => {
    // The bot package uses .js extensions in imports (NodeNext convention)
    // but Next.js needs to resolve those to .ts source files
    config.resolve.extensionAlias = {
      ".js": [".ts", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
};

export default nextConfig;
