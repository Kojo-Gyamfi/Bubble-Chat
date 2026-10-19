export const runtime = "nodejs";
// Read env per request so bumping the Vercel vars takes effect without an APK rebuild.
export const dynamic = "force-dynamic";

/**
 * Latest Android build, for the in-app "Update available" banner (we distribute
 * the APK ourselves, no Play Store). Public and unauthenticated on purpose: it's
 * only version metadata, and the app checks it before any sign-in. Bump the env
 * vars on a Vercel deploy; apkUrl points at the GitHub release asset.
 */
export async function GET() {
  const parsed = Number.parseInt(process.env.ANDROID_VERSION_CODE ?? "", 10);
  const body = {
    versionCode: Number.isFinite(parsed) && parsed > 0 ? parsed : 0,
    versionName: process.env.ANDROID_VERSION_NAME ?? "",
    apkUrl: process.env.ANDROID_APK_URL ?? "",
  };
  return Response.json(body, { headers: { "Cache-Control": "public, max-age=0, s-maxage=300" } });
}
