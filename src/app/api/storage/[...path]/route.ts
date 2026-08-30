import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse, type NextRequest } from "next/server";
import { isConfigured } from "@/env";

/**
 * Serves files written by the local-disk storage driver (dev / self-hosted
 * without Azure Blob). In Azure, blobs are served from the storage/CDN URL and
 * this route is never hit.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  if (isConfigured.azureBlob) {
    return NextResponse.json({ error: "served from blob storage" }, { status: 404 });
  }
  const { path: segments } = await params;
  const root = path.join(process.cwd(), ".storage");
  const target = path.join(root, ...segments);

  // Path traversal guard.
  if (!target.startsWith(root + path.sep) || !existsSync(target)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const info = await stat(target);
  const stream = Readable.toWeb(createReadStream(target)) as ReadableStream;
  return new NextResponse(stream, {
    headers: {
      "Content-Length": String(info.size),
      "Cache-Control": "private, max-age=300",
    },
  });
}
