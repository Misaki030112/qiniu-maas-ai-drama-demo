import { NextResponse } from "next/server";
import { applyMediaShotAudioToVideo } from "../../../../../../../../../src/project-pipeline.js";

export async function POST(_request, { params }) {
  try {
    const { projectId, shotId } = await params;
    return NextResponse.json(await applyMediaShotAudioToVideo(projectId, shotId));
  } catch (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}
