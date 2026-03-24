import { NextResponse } from "next/server";
import { generateMediaShotAudio } from "../../../../../../../../src/project-pipeline.js";

export async function POST(request, { params }) {
  try {
    const { projectId, shotId } = await params;
    const url = new URL(request.url);
    const previewOnly = url.searchParams.get("preview") === "1";
    if (previewOnly) {
      const result = await generateMediaShotAudio(projectId, shotId, { previewOnly: true });
      return new Response(result.buffer, {
        headers: {
          "Content-Type": "audio/mpeg",
          "Cache-Control": "no-store",
          "X-Voice-Type": result.voiceType || "",
          "X-Duration-Ms": String(result.durationMs || 0),
        },
      });
    }
    return NextResponse.json(await generateMediaShotAudio(projectId, shotId));
  } catch (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}
