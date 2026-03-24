import { NextResponse } from "next/server";
import { generateMediaShotImage } from "../../../../../../../../src/project-pipeline.js";

export async function POST(_request, { params }) {
  try {
    const { projectId, shotId } = await params;
    return NextResponse.json(await generateMediaShotImage(projectId, shotId));
  } catch (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}
