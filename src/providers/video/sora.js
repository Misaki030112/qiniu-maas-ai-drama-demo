import { toPublicReferenceUrl } from "../reference-media.js";

export function buildSoraVideoRequest({ model, prompt, referenceImages = [], seconds, aspectRatio, resolution, resolveVideoSize, normalizeVideoSeconds }) {
  const inputReference = referenceImages.map(toPublicReferenceUrl).find(Boolean);
  if (!inputReference) {
    throw new Error("Sora 2 支持参考图+提示词生成视频，但当前需要公网可访问的图片 URL。请使用公网参考图，或为项目配置 APP_BASE_URL 后再使用故事板素材。");
  }

  return {
    provider: "openai",
    method: "POST",
    endpoint: "/videos",
    body: {
      model,
      prompt,
      input_reference: inputReference,
      seconds: String(normalizeVideoSeconds(model, seconds)),
      size: resolution || resolveVideoSize(aspectRatio),
    },
    errorFallback: "Video task creation failed",
  };
}
