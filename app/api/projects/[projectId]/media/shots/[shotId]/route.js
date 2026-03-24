import { NextResponse } from "next/server";
import { patchMediaShot, readProjectDetail } from "../../../../../../../src/project-store.js";

export async function PATCH(request, { params }) {
  try {
    const { projectId, shotId } = await params;
    const body = await request.json().catch(() => ({}));
    await patchMediaShot(projectId, shotId, body);
    return NextResponse.json(await readProjectDetail(projectId));
  } catch (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}
