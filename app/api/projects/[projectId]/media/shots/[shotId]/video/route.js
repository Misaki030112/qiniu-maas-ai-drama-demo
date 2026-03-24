import { NextResponse } from "next/server";
import { generateMediaShotVideo } from "../../../../../../../../src/project-pipeline.js";

export async function POST(request, { params }) {
  try {
    const { projectId, shotId } = await params;
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await generateMediaShotVideo(projectId, shotId, body || {}));
  } catch (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}
