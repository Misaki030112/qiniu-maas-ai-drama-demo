import path from "node:path";
import dotenv from "dotenv";
import ffmpegStatic from "ffmpeg-static";

dotenv.config();

const workspaceRoot = process.cwd();

function parseList(value) {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBoolean(value, fallback = false) {
  if (value === undefined) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

export const config = {
  workspaceRoot,
  inputStoryPath: path.join(workspaceRoot, "input", "story.txt"),
  outputRoot: path.join(workspaceRoot, "output", "runs"),
  ffmpegPath: process.env.FFMPEG_PATH || ffmpegStatic,
  qiniu: {
    apiKey: process.env.QINIU_API_KEY || "",
    baseUrl: process.env.QINIU_BASE_URL || "https://api.qnaigc.com/v1",
    textModel: process.env.QINIU_TEXT_MODEL || "openai/gpt-5.4-mini",
    textCompareModels: parseList(process.env.QINIU_TEXT_COMPARE_MODELS),
    imageModel: process.env.QINIU_IMAGE_MODEL || "gemini-2.5-flash-image",
    imageCompareModels: parseList(process.env.QINIU_IMAGE_COMPARE_MODELS),
    voices: {
      female: process.env.QINIU_VOICE_FEMALE || "qiniu_zh_female_wwxkjx",
      male: process.env.QINIU_VOICE_MALE || "qiniu_zh_male_whxkxg",
      narrator:
        process.env.QINIU_VOICE_NARRATOR || "qiniu_zh_female_ljfdxx",
    },
  },
  video: {
    width: Number(process.env.VIDEO_WIDTH || 1280),
    height: Number(process.env.VIDEO_HEIGHT || 720),
    fps: Number(process.env.VIDEO_FPS || 25),
  },
  allowFallbacks: parseBoolean(process.env.ALLOW_FALLBACKS, true),
};

