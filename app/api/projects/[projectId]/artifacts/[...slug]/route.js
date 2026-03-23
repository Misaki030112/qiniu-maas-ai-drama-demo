import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { config } from "../../../../../../src/config.js";

const mimeTypes = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".ppm": "image/x-portable-pixmap",
  ".srt": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

export async function GET(_request, { params }) {
  try {
    const { projectId, slug = [] } = await params;
    const safeRoot = path.join(config.projectOutputRoot, projectId);
    const filePath = path.join(safeRoot, ...slug);
    if (!filePath.startsWith(safeRoot)) {
      return NextResponse.json({ message: "非法路径" }, { status: 403 });
    }
    const buffer = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": mimeTypes[ext] || "application/octet-stream",
      },
    });
  } catch (error) {
    return NextResponse.json({ message: error.message }, { status: 404 });
  }
}
