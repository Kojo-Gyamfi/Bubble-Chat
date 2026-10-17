"use client";

import { type ChatImage, MAX_IMAGE_BASE64_CHARS, MAX_THUMBNAIL_CHARS } from "@/lib/chat/schema";

/** Long side sent to the model: plenty for text and detail, small on mobile data. */
const MODEL_MAX_PX = 1280;
/** Long side of the preview kept in chat history. */
const THUMB_MAX_PX = 320;

export const IMAGE_READ_ERROR = "Couldn't read that image. Try a JPG or PNG photo.";

async function load(source: Blob | string): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof source !== "string" && "createImageBitmap" in window) {
    try {
      // Applies the photo's EXIF rotation.
      return await createImageBitmap(source, { imageOrientation: "from-image" });
    } catch {
      // Fall through to <img>, which decodes a few more formats in some browsers.
    }
  }
  const url = typeof source === "string" ? source : URL.createObjectURL(source);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    if (typeof source !== "string") URL.revokeObjectURL(url);
  }
}

/** JPEG data URL of `img` scaled so its long side is at most `maxPx`. */
function encode(img: CanvasImageSource & { width: number; height: number }, maxPx: number, quality: number): string {
  const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(IMAGE_READ_ERROR);
  ctx.fillStyle = "#fff"; // transparent PNGs would turn black as JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

/** Tries smaller/lower-quality encodings until the result fits in `maxChars`. */
function encodeWithin(img: Parameters<typeof encode>[0], maxPx: number, maxChars: number): string {
  for (const [px, quality] of [
    [maxPx, 0.82],
    [maxPx, 0.65],
    [Math.round(maxPx * 0.75), 0.6],
    [Math.round(maxPx * 0.5), 0.55],
  ] as const) {
    const url = encode(img, px, quality);
    if (url.length <= maxChars) return url;
  }
  throw new Error(IMAGE_READ_ERROR);
}

/**
 * Turns a picked file / camera photo / screenshot into what /api/chat takes:
 * a resized JPEG for the model plus a small thumbnail for the history.
 */
export async function prepareImage(source: Blob | string): Promise<ChatImage> {
  let img: Awaited<ReturnType<typeof load>>;
  try {
    img = await load(source);
  } catch {
    throw new Error(IMAGE_READ_ERROR);
  }
  if (!img.width || !img.height) throw new Error(IMAGE_READ_ERROR);

  const full = encodeWithin(img, MODEL_MAX_PX, MAX_IMAGE_BASE64_CHARS + "data:image/jpeg;base64,".length);
  const thumbnail = encodeWithin(img, THUMB_MAX_PX, MAX_THUMBNAIL_CHARS);
  if ("close" in img && typeof img.close === "function") img.close();
  return { mediaType: "image/jpeg", data: full.slice(full.indexOf(",") + 1), thumbnail };
}
