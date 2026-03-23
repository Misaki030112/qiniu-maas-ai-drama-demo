import { NextResponse } from "next/server";
import { enqueueProjectStageExecution } from "../../../../../src/job-runner.js";

export async function POST(request, { params }) {
  try {
    const { projectId } = await params;
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await enqueueProjectStageExecution(projectId, body.stage), { status: 202 });
  } catch (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}
