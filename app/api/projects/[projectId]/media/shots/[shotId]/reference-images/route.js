import path from "node:path";
import { NextResponse } from "next/server";
import { contentTypeFromFilePath, persistProjectArtifact } from "../../../../../../../../src/object-storage.js";

function sanitizeName(value) {
  return String(value || "reference")
    .trim()
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "reference";
}

export async function POST(request, { params }) {
  try {
    const { projectId, shotId } = await params;
    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ message: "缺少上传文件" }, { status: 400 });
    }

    const ext = path.extname(file.name || "").toLowerCase() || ".png";
    const fileName = `${sanitizeName(shotId)}-${Date.now()}${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const relativePath = path.posix.join("01-input", "shot-reference-images", fileName);
    const generatedAt = new Date().toISOString();
    const stored = await persistProjectArtifact({
      projectId,
      relativePath,
      buffer,
      contentType: contentTypeFromFilePath(relativePath),
      generatedAt,
      stage: "media",
    });
    return NextResponse.json({
      id: `ref_${Date.now()}`,
      path: relativePath,
      name: file.name || fileName,
      size: file.size || buffer.length,
      generatedAt,
      url: stored.url,
      publicUrl: stored.publicUrl,
      storageProvider: stored.storageProvider,
    });
  } catch (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}
