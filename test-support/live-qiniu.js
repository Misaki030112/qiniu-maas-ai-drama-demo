import { config } from "../src/config.js";
import { QiniuMaaSClient } from "../src/providers/qiniu-maas.js";

export function createLiveClient() {
  if (!config.qiniu.apiKey) {
    throw new Error("缺少 QINIU_API_KEY，无法执行真实七牛集成测试。");
  }
  return new QiniuMaaSClient({
    apiKey: config.qiniu.apiKey,
    baseUrl: config.qiniu.baseUrl,
  });
}

export function resolveLiveValue(label, candidates) {
  for (const value of candidates) {
    if (String(value || "").trim()) {
      return String(value).trim();
    }
  }
  throw new Error(`缺少 ${label} 配置，无法执行真实七牛集成测试。`);
}

export function resolveLiveTextModel() {
  return resolveLiveValue("文本模型", [
    process.env.QINIU_LIVE_TEXT_MODEL,
    config.qiniu.models.adaptation,
    "openai/gpt-5.4",
  ]);
}

export function resolveLiveImageModel() {
  return resolveLiveValue("图片模型", [
    process.env.QINIU_LIVE_IMAGE_MODEL,
    "gemini-2.5-flash-image",
    "gemini-3.1-flash-image-preview",
    "kling-v1",
    config.qiniu.models.shotImage,
    config.qiniu.models.roleImage,
  ]);
}

export function resolveLiveVideoModel() {
  return resolveLiveValue("视频模型", [
    process.env.QINIU_LIVE_VIDEO_MODEL,
    config.qiniu.models.shotVideo,
    "veo-3.1-fast-generate-001",
  ]);
}

export function resolveLiveVoiceType() {
  return resolveLiveValue("语音音色", [
    process.env.QINIU_LIVE_SPEECH_VOICE_TYPE,
    config.qiniu.voices.narrator,
  ]);
}

function trimSlash(value = "") {
  return String(value || "").replace(/^\/+|\/+$/g, "");
}

export function resolveLiveAssetUrl(relativePath) {
  const baseUrl = trimSlash(config.objectStorage.aliyun.publicBaseUrl);
  const prefix = trimSlash(config.objectStorage.aliyun.prefix || "ai-drama-demo/projects");
  if (!baseUrl) {
    throw new Error("缺少 ALIYUN_OSS_PUBLIC_BASE_URL，无法读取真实测试图片。");
  }
  const target = [prefix, "live-tests", trimSlash(relativePath)].filter(Boolean).join("/");
  return `${baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`}/${target}`;
}

export async function downloadLiveAssetBuffer(relativePath) {
  const url = resolveLiveAssetUrl(relativePath);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`读取真实测试图片失败: ${response.status} ${url}`);
  }
  return {
    url,
    buffer: Buffer.from(await response.arrayBuffer()),
  };
}

export async function fetchVideoTaskStatus(client, { model, provider, id }) {
  return client.getVideoTask({ model, provider, id });
}
