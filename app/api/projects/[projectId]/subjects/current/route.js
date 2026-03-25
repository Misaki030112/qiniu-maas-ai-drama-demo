import { NextResponse } from "next/server";
import { selectSubjectReference } from "../../../../../../src/project-pipeline.js";

export async function POST(request, { params }) {
  try {
    const { projectId } = await params;
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(
      await selectSubjectReference(projectId, {
        kind: body.kind,
        key: body.key,
        path: body.path,
      }),
    );
  } catch (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}
