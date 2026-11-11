import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Trace files from the monorepo root so the standalone build includes @appshelf/db.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  serverExternalPackages: ["@node-rs/argon2"],
  poweredByHeader: false,
};

export default nextConfig;
