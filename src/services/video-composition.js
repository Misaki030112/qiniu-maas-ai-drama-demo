import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { ensureDir, escapeSubtitlePath, runCommand, writeText } from "../utils.js";

export async function renderSegment({ imagePath, audioPath, outputPath, durationSec }) {
  const frames = Math.max(1, Math.ceil(durationSec * config.video.fps));
  const useKenBurns = config.video.renderMode === "kenburns";
  const videoFilter = useKenBurns
    ? [
        `scale=${config.video.width}:${config.video.height}:force_original_aspect_ratio=increase`,
        `crop=${config.video.width}:${config.video.height}`,
        `zoompan=z='min(zoom+0.0012,1.10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${config.video.width}x${config.video.height}:fps=${config.video.fps}`,
        "format=yuv420p",
      ].join(",")
    : [
        `scale=${config.video.width}:${config.video.height}:force_original_aspect_ratio=decrease`,
        `pad=${config.video.width}:${config.video.height}:(ow-iw)/2:(oh-ih)/2`,
        "format=yuv420p",
      ].join(",");

  await runCommand(config.ffmpegPath, [
    "-y",
    "-loop",
    "1",
    "-framerate",
    String(config.video.fps),
    "-i",
    imagePath,
    "-i",
    audioPath,
    "-vf",
    videoFilter,
    "-af",
    "apad",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-t",
    String(durationSec),
    outputPath,
  ]);
}

export async function muxAudioIntoVideo({ videoPath, audioPath, outputPath }) {
  await ensureDir(path.dirname(outputPath));
  await runCommand(config.ffmpegPath, [
    "-y",
    "-i",
    videoPath,
    "-i",
    audioPath,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-af",
    "apad",
    "-shortest",
    "-movflags",
    "+faststart",
    outputPath,
  ]);
}

async function concatSegments(listPath, outputPath) {
  await runCommand(config.ffmpegPath, [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    outputPath,
  ]);
}

async function inspectVideoStreams(videoPath) {
  try {
    const { stderr } = await runCommand(config.ffmpegPath, ["-hide_banner", "-i", videoPath]);
    return {
      hasAudio: /Audio:/i.test(stderr || ""),
    };
  } catch (error) {
    const stderr = String(error?.stderr || error?.message || "");
    return {
      hasAudio: /Audio:/i.test(stderr),
    };
  }
}

function buildNormalizedVideoFilter() {
  return [
    `scale=${config.video.width}:${config.video.height}:force_original_aspect_ratio=increase`,
    `crop=${config.video.width}:${config.video.height}`,
    `fps=${config.video.fps}`,
    "format=yuv420p",
  ].join(",");
}

async function normalizeVideoClip({ inputPath, outputPath, hasAudio }) {
  await ensureDir(path.dirname(outputPath));
  const args = ["-y", "-i", inputPath];
  if (!hasAudio) {
    args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
  }
  args.push(
    "-map",
    "0:v:0",
    "-map",
    hasAudio ? "0:a:0?" : "1:a:0",
    "-vf",
    buildNormalizedVideoFilter(),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
  );
  if (!hasAudio) {
    args.push("-shortest");
  }
  args.push(outputPath);
  await runCommand(config.ffmpegPath, args);
}

export async function concatNormalizedVideos({ inputPaths, outputPath, workspaceDir }) {
  const normalizedDir = path.join(workspaceDir, "normalized");
  await ensureDir(normalizedDir);
  const normalizedPaths = [];

  for (let index = 0; index < inputPaths.length; index += 1) {
    const inputPath = inputPaths[index];
    const { hasAudio } = await inspectVideoStreams(inputPath);
    const normalizedPath = path.join(normalizedDir, `${String(index + 1).padStart(2, "0")}.mp4`);
    await normalizeVideoClip({
      inputPath,
      outputPath: normalizedPath,
      hasAudio,
    });
    normalizedPaths.push(normalizedPath);
  }

  if (normalizedPaths.length === 1) {
    await fs.copyFile(normalizedPaths[0], outputPath);
    return;
  }

  const concatListPath = path.join(workspaceDir, "segments.txt");
  await writeText(
    concatListPath,
    normalizedPaths.map((filePath) => `file '${filePath.replaceAll("'", "'\\''")}'`).join("\n"),
  );
  await concatSegments(concatListPath, outputPath);
}

export async function burnSubtitles(videoPath, subtitlesPath, outputPath) {
  const style =
    "FontSize=18,PrimaryColour=&Hffffff&,OutlineColour=&H40000000&,BorderStyle=1,Outline=2,Shadow=0,MarginV=32";
  await runCommand(config.ffmpegPath, [
    "-y",
    "-i",
    videoPath,
    "-vf",
    `subtitles=${escapeSubtitlePath(subtitlesPath)}:force_style='${style}'`,
    "-c:a",
    "copy",
    outputPath,
  ]);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
