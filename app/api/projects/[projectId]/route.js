import { NextResponse } from "next/server";
import { readProjectDetail, saveProjectArtifact, updateProject } from "../../../../src/project-store.js";

export async function GET(_request, { params }) {
  try {
    const { projectId } = await params;
    return NextResponse.json(await readProjectDetail(projectId));
  } catch (error) {
    return NextResponse.json({ message: error.message }, { status: 404 });
  }
}

export async function PATCH(request, { params }) {
  try {
    const { projectId } = await params;
    const body = await request.json().catch(() => ({}));
    if (body.artifactStage) {
      if (body.name !== undefined || body.storyText !== undefined || body.models) {
        await updateProject(projectId, {
          name: body.name,
          storyText: body.storyText,
          models: body.models,
        });
      }
      return NextResponse.json(
        await saveProjectArtifact(projectId, body.artifactStage, body.artifactValue),
      );
    }

    await updateProject(projectId, {
      name: body.name,
      storyText: body.storyText,
      models: body.models,
    });
    return NextResponse.json(await readProjectDetail(projectId));
  } catch (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}
