import { loadFile, verifyFileSignature } from "@/lib/files/store";

export const runtime = "nodejs";

/**
 * GET /api/files/{uid}/{conversationId}/{fileId}/{file name}?s={signature}
 *
 * Downloads a file the AI created. The signed link is the permission (it's
 * only ever shown in its owner's chat), so it works without a sign-in header:
 * from the bubble it opens in Chrome, which downloads it.
 */
export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const [uid, conversationId, fileId] = path;
  const signature = new URL(req.url).searchParams.get("s") ?? "";
  if (!uid || !conversationId || !fileId || !verifyFileSignature(uid, conversationId, fileId, signature)) {
    return new Response("This download link isn't valid.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  const file = await loadFile(uid, conversationId, fileId).catch((err: unknown) => {
    console.error("Could not load file", err);
    return null;
  });
  if (!file) {
    return new Response("This file no longer exists (the chat may have been deleted).", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const asciiName = file.name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.data.length),
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
