import { NextResponse } from "next/server";
import { readProjectArtifact } from "../../../../../../src/project-artifacts.js";
import { readProjectArtifactBuffer } from "../../../../../../src/object-storage.js";

export async function GET(_request, { params }) {
  try {
    const { projectId, slug = [] } = await params;
    const relativePath = slug.join("/");
    const artifact = await readProjectArtifact(projectId, relativePath);
    if (!artifact) {
      return NextResponse.json({ message: "工件不存在" }, { status: 404 });
    }

    if (artifact.publicUrl) {
      return NextResponse.redirect(artifact.publicUrl, { status: 307 });
    }

    const { buffer, contentType } = await readProjectArtifactBuffer({
      projectId,
      relativePath,
    });
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType || artifact.contentType || "application/octet-stream",
      },
    });
  } catch (error) {
    return NextResponse.json({ message: error.message }, { status: 404 });
  }
}
