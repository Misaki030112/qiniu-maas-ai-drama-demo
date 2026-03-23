import { NextResponse } from "next/server";
import { regenerateSubjectReference } from "../../../../../../src/project-pipeline.js";

export async function POST(request, { params }) {
  try {
    const { projectId } = await params;
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(
      await regenerateSubjectReference(projectId, {
        kind: body.kind,
        key: body.key,
      }),
    );
  } catch (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}
