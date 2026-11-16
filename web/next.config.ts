import { withSerwist } from "@serwist/turbopack";
import type { NextConfig } from "next";

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

const nextConfig: NextConfig = {
  allowedDevOrigins: ["untreacherous-leontine-nonpejoratively.ngrok-free.dev"],
  experimental: {
    agentUpgrade: "security",
  },
  // Word/PDF/Excel/PowerPoint builders (lib/files): run from node_modules as-is
  // rather than bundled (pdfkit, exceljs and pptxgenjs read their own files).
  serverExternalPackages: ["pdfmake", "pdfkit", "exceljs", "pptxgenjs"],
  // The PDF font files are read at runtime, so ship them with the chat function.
  outputFileTracingIncludes: {
    "/api/chat": ["./node_modules/dejavu-fonts-ttf/ttf/DejaVuSans*.ttf"],
  },
  // cacheComponents is off on purpose: the app is client-rendered on top of
  // Firebase, and the Serwist Turbopack route relies on segment config
  // (`dynamic`, `revalidate`) that cacheComponents rejects.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    if (!projectId) return [];
    // Lets NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN point at our own domain, so Google
    // sign-in works in iOS standalone PWAs (no third-party storage).
    return [
      {
        source: "/__/auth/:path*",
        destination: `https://${projectId}.firebaseapp.com/__/auth/:path*`,
      },
    ];
  },
};

export default withSerwist(nextConfig);
