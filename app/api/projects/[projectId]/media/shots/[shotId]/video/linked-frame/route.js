import { NextResponse } from "next/server";
import { adoptLinkedShotFrame } from "../../../../../../../../../src/project-pipeline.js";

export async function POST(request, { params }) {
  try {
    const { projectId, shotId } = await params;
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await adoptLinkedShotFrame(projectId, shotId, { target: body.target }));
  } catch (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}
