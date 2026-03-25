import path from "node:path";
import { NextResponse } from "next/server";
import { contentTypeFromFilePath, persistProjectArtifact } from "../../../../../../../../src/object-storage.js";
import { ensureProjectWorkspace, getProjectPaths } from "../../../../../../../../src/project-store.js";
import { ensureDir } from "../../../../../../../../src/utils.js";

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

    await ensureProjectWorkspace(projectId);
    const paths = getProjectPaths(projectId);
    const targetDir = path.join(paths.dirs.input, "shot-reference-images");
    await ensureDir(targetDir);

    const ext = path.extname(file.name || "").toLowerCase() || ".png";
    const fileName = `${sanitizeName(shotId)}-${Date.now()}${ext}`;
    const absolutePath = path.join(targetDir, fileName);
    const buffer = Buffer.from(await file.arrayBuffer());
    const relativePath = path.relative(paths.outputDir, absolutePath);
    const generatedAt = new Date().toISOString();
    const stored = await persistProjectArtifact({
      projectId,
      absolutePath,
      relativePath,
      buffer,
      contentType: contentTypeFromFilePath(absolutePath),
      generatedAt,
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
