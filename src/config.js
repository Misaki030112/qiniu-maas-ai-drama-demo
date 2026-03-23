import path from "node:path";
import dotenv from "dotenv";
import ffmpegStatic from "ffmpeg-static";

dotenv.config({ quiet: true });

const workspaceRoot = process.cwd();
const providerPreset = process.env.MAAS_PROVIDER || "qiniu";
const defaultBaseUrl = providerPreset === "sufy"
  ? "https://api.sufy.com/aitoken/v1"
  : "https://api.qnaigc.com/v1";

function parseList(value) {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export const config = {
  workspaceRoot,
  inputStoryPath: path.join(workspaceRoot, "input", "story.txt"),
  outputRoot: path.join(workspaceRoot, "output", "runs"),
  projectDataRoot: path.join(workspaceRoot, ".data", "projects"),
  projectOutputRoot: path.join(workspaceRoot, "output", "projects"),
  ffmpegPath: process.env.FFMPEG_PATH || ffmpegStatic,
  workbenchPort: Number(process.env.WORKBENCH_PORT || 3210),
  providerPreset,
  qiniu: {
    apiKey: process.env.QINIU_API_KEY || "",
    baseUrl: process.env.QINIU_BASE_URL || defaultBaseUrl,
    marketplaceCatalogUrl:
      process.env.QINIU_MARKETPLACE_CATALOG_URL || "https://sufy.com/zh-CN/services/ai-inference/models",
    models: {
      adaptation: process.env.QINIU_ADAPTATION_MODEL || "openai/gpt-5.4",
      characters: process.env.QINIU_CHARACTER_MODEL || "gemini-2.5-pro",
      storyboard: process.env.QINIU_STORYBOARD_MODEL || "gemini-2.5-pro",
      roleImage:
        process.env.QINIU_ROLE_IMAGE_MODEL || "imagen-4",
      shotImage:
        process.env.QINIU_SHOT_IMAGE_MODEL || "imagen-4",
      shotVideo: process.env.QINIU_VIDEO_MODEL || "veo-3.1-fast-generate-001",
    },
    compareModels: {
      text: parseList(process.env.QINIU_TEXT_COMPARE_MODELS),
      image: parseList(process.env.QINIU_IMAGE_COMPARE_MODELS),
    },
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
    renderMode: process.env.VIDEO_RENDER_MODE || "kenburns",
  },
  strategy: {
    provider: "Qiniu MaaS / SUFY",
    recommendations: [
      {
        stage: "剧本改编 / 剧情理解",
        current: "openai/gpt-5.4",
        candidates: ["GPT-5.4", "Gemini 3.1 Pro", "MiniMax M 系列"],
        focus: "结构化输出稳定性、剧情推进、人物关系准确性",
      },
      {
        stage: "角色设定",
        current: "gemini-2.5-pro",
        candidates: ["GPT-5.4", "Gemini 2.5 Pro", "MiniMax M 系列"],
        focus: "人设清晰度、连续性提示词质量",
      },
      {
        stage: "角色首图",
        current: "imagen-4",
        candidates: ["GPT Image 1", "Imagen 4", "Gemini Flash Image"],
        focus: "真人感、参考复用能力、角色稳定性",
      },
      {
        stage: "镜头图 / 关键帧",
        current: "imagen-4",
        candidates: ["Imagen 4", "Gemini Flash Image", "GPT Image 1"],
        focus: "跨场景一致性、风格统一、提示词可控性",
      },
      {
        stage: "镜头视频生成",
        current: "veo-3.1-fast-generate-001",
        candidates: ["Veo 3.1", "Sora 2", "Kling V3"],
        focus: "动作自然度、剧情连贯性、生成成本和速度",
      },
      {
        stage: "配音 / 旁白",
        current: "七牛 voice/tts",
        candidates: ["GPT-4o mini TTS", "Gemini TTS", "MiniMax Speech"],
        focus: "中文自然度、情绪、多角色区分度",
      },
    ],
  },
};
