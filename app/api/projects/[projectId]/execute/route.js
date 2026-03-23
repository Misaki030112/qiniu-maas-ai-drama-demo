import { NextResponse } from "next/server";
import { executeProjectStage } from "../../../../../src/project-pipeline.js";

export async function POST(request, { params }) {
  try {
    const { projectId } = await params;
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await executeProjectStage(projectId, body.stage));
  } catch (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}
