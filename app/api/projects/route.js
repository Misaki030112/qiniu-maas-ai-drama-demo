import { NextResponse } from "next/server";
import { createProject, listProjects } from "../../../src/project-store.js";

export async function GET() {
  return NextResponse.json(await listProjects());
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const project = await createProject(body.name || "点众 AI 真人剧 Demo");
    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}
