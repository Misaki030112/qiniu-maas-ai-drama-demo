import path from "node:path";
import { NextResponse } from "next/server";
import { contentTypeFromFilePath, persistProjectArtifact } from "../../../../../../src/object-storage.js";
import { ensureProjectWorkspace, getProjectPaths } from "../../../../../../src/project-store.js";
import { ensureDir } from "../../../../../../src/utils.js";

function sanitizeName(value) {
  return String(value || "subject")
    .trim()
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "subject";
}

export async function POST(request, { params }) {
  try {
    const { projectId } = await params;
    const form = await request.formData();
    const file = form.get("file");
    const kind = sanitizeName(form.get("kind"));
    const name = sanitizeName(form.get("name"));

    if (!file || typeof file === "string") {
      return NextResponse.json({ message: "缺少上传文件" }, { status: 400 });
    }

    await ensureProjectWorkspace(projectId);
    const paths = getProjectPaths(projectId);
    const targetDir = path.join(paths.dirs.input, "reference-images");
    await ensureDir(targetDir);

    const ext = path.extname(file.name || "").toLowerCase() || ".png";
    const fileName = `${kind}-${name}-${Date.now()}${ext}`;
    const absolutePath = path.join(targetDir, fileName);
    const buffer = Buffer.from(await file.arrayBuffer());
    const relativePath = path.relative(paths.outputDir, absolutePath);
    const stored = await persistProjectArtifact({
      projectId,
      absolutePath,
      relativePath,
      buffer,
      contentType: contentTypeFromFilePath(absolutePath),
    });
    return NextResponse.json({
      path: relativePath,
      name: file.name || fileName,
      size: file.size || buffer.length,
      url: stored.url,
      publicUrl: stored.publicUrl,
      storageProvider: stored.storageProvider,
    });
  } catch (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}
