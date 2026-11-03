import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit and mammoth read data files / use dynamic requires, so keep them as plain Node externals.
  serverExternalPackages: ["pdfkit", "mammoth"],
  // pdfkit loads its font metrics from disk at runtime; make sure they are traced into the serverless bundle.
  outputFileTracingIncludes: {
    "/api/projects/[id]/export": ["./node_modules/pdfkit/js/data/**/*"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
