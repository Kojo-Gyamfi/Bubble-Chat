// Generates the iOS PWA launch images (apple-touch-startup-image) in
// public/splash/, matching components/Spinner.tsx SplashScreen.
// Run after changing the logo or splash text: npm run splash
// (sharp comes with Next.js.) Device list is shared with app/layout.tsx.
import { mkdir } from "node:fs/promises";
import sharp from "sharp";
import { IOS_SPLASH_DEVICES, iosSplashPath } from "../lib/ios-splash.ts";

const NAVY = "#0f1035";
const FONT = "Segoe UI, -apple-system, Helvetica, Arial, sans-serif";

await mkdir("public/splash", { recursive: true });

for (const d of IOS_SPLASH_DEVICES) {
  const W = d.width * d.ratio;
  const H = d.height * d.ratio;
  const px = (n: number) => Math.round(n * d.ratio);

  // Same stack as SplashScreen: logo 112, title 24 (mt 20), tagline 14 (mt 4), spinner gap.
  // Status bar on top and home indicator below roughly as on the device.
  const top = d.homeButton ? 20 : 50;
  const bottom = d.homeButton ? 0 : 34;
  const footerTop = d.height - bottom - 24 - 16;
  const stack = 112 + 20 + 32 + 4 + 20 + 52;
  const stackTop = top + (footerTop - top - stack) / 2;

  const logo = await sharp("public/brand/logo-mark.png").resize(px(112), px(112)).toBuffer();
  const text = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <g font-family="${FONT}" text-anchor="middle" fill="#ffffff">
      <text x="${W / 2}" y="${px(stackTop + 112 + 20 + 24)}" font-size="${px(24)}" font-weight="600">Bubble</text>
      <text x="${W / 2}" y="${px(stackTop + 112 + 20 + 32 + 4 + 15)}" font-size="${px(14)}" fill-opacity="0.7">Your personal AI chat assistant</text>
      <text x="${W / 2}" y="${px(footerTop + 12)}" font-size="${px(12)}" fill-opacity="0.5">Built by Nana Kojo</text>
    </g>
  </svg>`);

  await sharp({ create: { width: W, height: H, channels: 3, background: NAVY } })
    .composite([
      { input: logo, left: Math.round((W - px(112)) / 2), top: px(stackTop) },
      { input: text, left: 0, top: 0 },
    ])
    .png({ compressionLevel: 9, palette: true })
    .toFile(`public${iosSplashPath(d)}`);
  console.log(`public${iosSplashPath(d)}`);
}
