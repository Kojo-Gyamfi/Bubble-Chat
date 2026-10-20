import { createSerwistRoute } from "@serwist/turbopack";

// Bumps the precached offline page on every deploy.
const revision = process.env.VERCEL_GIT_COMMIT_SHA ?? crypto.randomUUID();

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  swSrc: "app/sw.ts",
  additionalPrecacheEntries: [{ url: "/~offline", revision }],
  // iOS fetches its one matching launch image itself; don't make every visitor download all of them.
  globIgnores: ["**/node_modules/**/*", "public/splash/**/*"],
  useNativeEsbuild: true,
});
