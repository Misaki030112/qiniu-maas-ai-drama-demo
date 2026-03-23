import { NextResponse } from "next/server";
import { renderAllSubjectReferences } from "../../../../../../src/project-pipeline.js";

export async function POST(_request, { params }) {
  try {
    const { projectId } = await params;
    return NextResponse.json(await renderAllSubjectReferences(projectId));
  } catch (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}
