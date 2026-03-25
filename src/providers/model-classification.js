const TEXT_MODEL_PATTERNS = [
  /gpt-/i,
  /gemini/i,
  /deepseek/i,
  /qwen/i,
  /kimi/i,
  /moonshot/i,
  /glm/i,
  /doubao/i,
  /minimax/i,
  /mimo/i,
  /longcat/i,
];

const KLING_IMAGE_MODELS = new Set([
  "kling-v1",
  "kling-v1-5",
  "kling-v2",
  "kling-v2-1",
  "kling-v2-new",
  "kling-image-o1",
]);

export const MODEL_CATEGORY = {
  TEXT: "text",
  IMAGE: "image",
  VIDEO: "video",
  SPEECH: "speech",
};

export function prettifyModelName(modelId) {
  return String(modelId || "")
    .replace(/^openai\//, "OpenAI/")
    .replace(/^deepseek\//, "DeepSeek/")
    .replace(/^minimax\//, "MiniMax/")
    .replace(/^moonshotai\//, "Moonshot/")
    .replace(/^meituan\//, "Meituan/")
    .replace(/^nvidia\//, "Nvidia/")
    .replace(/^xiaomi\//, "Xiaomi/")
    .replace(/^z-ai\//, "zAI/");
}

export function inferProvider(modelId) {
  const value = String(modelId || "");
  if (/^(gemini|imagen|veo)/i.test(value)) return "Google";
  if (/^(gpt-image|sora|openai\/)/i.test(value)) return "OpenAI";
  if (/^(kling)/i.test(value)) return "Kling";
  if (/^(vidu)/i.test(value)) return "Vidu";
  if (/^(hailuo)/i.test(value)) return "MiniMax";
  if (value.startsWith("openai/")) return "OpenAI";
  if (value.startsWith("deepseek/") || value.startsWith("deepseek")) return "DeepSeek";
  if (value.startsWith("minimax/") || value.startsWith("MiniMax")) return "MiniMax";
  if (value.startsWith("moonshotai/") || value.startsWith("kimi")) return "Moonshot-Kimi";
  if (value.startsWith("nvidia/")) return "Nvidia";
  if (value.startsWith("z-ai/") || value.startsWith("glm")) return "zAI";
  if (value.startsWith("qwen") || value.startsWith("qwen2.5")) return "Aliyun";
  if (value.startsWith("doubao")) return "ByteDance";
  if (value.startsWith("mimo")) return "Xiaomi";
  if (value === "tts") return "七牛云";
  return "Unknown";
}

export function inferModelCategory(modelId) {
  const value = String(modelId || "").toLowerCase();
  if (value === "tts" || value.includes("voice/tts")) {
    return MODEL_CATEGORY.SPEECH;
  }
  if (
    value.startsWith("veo-")
    || value.startsWith("sora-")
    || value.startsWith("vidu")
    || value.startsWith("kling-video-")
    || value === "kling-v2-1"
    || value === "kling-v2-5-turbo"
    || value === "kling-v2-6"
    || value === "kling-v3"
    || value === "kling-v3-omni"
  ) {
    return MODEL_CATEGORY.VIDEO;
  }
  if (
    value.startsWith("gpt-image")
    || value.startsWith("imagen")
    || value.includes("flash-image")
    || value.includes("image-preview")
    || value.includes("image-01")
    || value.startsWith("kling-image-")
    || KLING_IMAGE_MODELS.has(value)
  ) {
    return MODEL_CATEGORY.IMAGE;
  }
  if (TEXT_MODEL_PATTERNS.some((pattern) => pattern.test(value))) {
    return MODEL_CATEGORY.TEXT;
  }
  return MODEL_CATEGORY.TEXT;
}

export function inferModelFamily(modelId, category = inferModelCategory(modelId)) {
  const value = String(modelId || "").toLowerCase();
  if (category === MODEL_CATEGORY.SPEECH) {
    return "qiniu-tts";
  }
  if (category === MODEL_CATEGORY.IMAGE) {
    if (value.startsWith("gemini-")) return "gemini-image";
    if (value === "kling-image-o1") return "kling-image-o1";
    if (KLING_IMAGE_MODELS.has(value)) return "kling-image";
    if (value.startsWith("gpt-image")) return "openai-image";
    if (value.startsWith("imagen")) return "imagen-image";
    if (value.startsWith("minimax-image")) return "minimax-image";
    return "generic-image";
  }
  if (category === MODEL_CATEGORY.VIDEO) {
    if (value.startsWith("vidu")) return "vidu-video";
    if (value.startsWith("veo-")) return "veo-video";
    if (value.startsWith("sora-")) return "sora-video";
    if (value.startsWith("kling-")) return "kling-video";
    return "generic-video";
  }
  return "chat-completions";
}

export function inferCapabilities(modelId, category = inferModelCategory(modelId)) {
  if (category === MODEL_CATEGORY.IMAGE) {
    return ["image_generation", "subject_reference", "shot_image"];
  }
  if (category === MODEL_CATEGORY.VIDEO) {
    return ["video_generation"];
  }
  if (category === MODEL_CATEGORY.SPEECH) {
    return ["tts", "audio_generation"];
  }
  if (/(vision|vl)/i.test(String(modelId || ""))) {
    return ["script", "subject_analysis", "storyboard", "vision"];
  }
  return ["script", "subject_analysis", "storyboard"];
}
