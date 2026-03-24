import { config } from "../config.js";

export function normalizeVideoSeconds(model, seconds) {
  const value = Math.max(4, Math.min(12, Math.round(seconds)));
  if (model.startsWith("kling-")) {
    return value >= 8 ? 10 : 5;
  }
  if (model.startsWith("sora-")) {
    if (value <= 4) return 4;
    if (value <= 8) return 8;
    return 12;
  }
  return value;
}

export function resolveVideoSize(aspectRatio = "16:9") {
  return {
    "16:9": "1280x720",
    "9:16": "720x1280",
    "4:3": "1024x768",
    "3:4": "768x1024",
    "1:1": "1024x1024",
  }[aspectRatio] || "1280x720";
}

function toImageListEntry(buffer, type = "subject") {
  if (!buffer) {
    return null;
  }
  return {
    image: buffer.toString("base64"),
    type,
  };
}

function toReferenceEntry(item) {
  if (!item) {
    return null;
  }
  if (item.base64) {
    return {
      image: item.base64,
      type: "subject",
    };
  }
  return null;
}

function isPublicHttpUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) {
      return false;
    }
    const host = url.hostname.toLowerCase();
    return !["localhost", "127.0.0.1", "0.0.0.0"].includes(host);
  } catch {
    return false;
  }
}

function toPublicReferenceUrl(item) {
  if (!item) {
    return "";
  }
  if (item.publicUrl && isPublicHttpUrl(item.publicUrl)) {
    return item.publicUrl;
  }
  if (item.url && isPublicHttpUrl(item.url)) {
    return item.url;
  }
  if (item.url && item.url.startsWith("/") && config.appBaseUrl) {
    const resolved = new URL(item.url, config.appBaseUrl).href;
    if (isPublicHttpUrl(resolved)) {
      return resolved;
    }
  }
  return "";
}

export function buildVideoTaskBody({
  model,
  prompt,
  imageBuffer,
  lastFrameBuffer,
  referenceImages = [],
  seconds,
  aspectRatio,
  mode = "",
  enableAudio = false,
  resolution = "",
}) {
  const body = {
    model,
    prompt,
    seconds: String(normalizeVideoSeconds(model, seconds)),
    size: resolution || resolveVideoSize(aspectRatio),
  };

  if (imageBuffer || lastFrameBuffer || referenceImages.length) {
    if (model.startsWith("sora-")) {
      const inputReference = referenceImages.map(toPublicReferenceUrl).find(Boolean);
      if (!inputReference) {
        throw new Error("Sora 2 支持参考图+提示词生成视频，但当前需要公网可访问的图片 URL。请使用公网参考图，或为项目配置 APP_BASE_URL 后再使用故事板素材。");
      }
      body.input_reference = inputReference;
      return body;
    }

    if (model.startsWith("kling-")) {
      body.mode = mode || "std";
      const imageList = [
        imageBuffer ? toImageListEntry(imageBuffer, "first_frame") : null,
        lastFrameBuffer ? toImageListEntry(lastFrameBuffer, "end_frame") : null,
      ].filter(Boolean);

      if (model === "kling-video-o1") {
        imageList.push(...referenceImages.map(toReferenceEntry).filter(Boolean));
      }

      if (!imageList.length) {
        throw new Error(`模型 ${model} 缺少有效参考素材。`);
      }

      body.image_list = imageList;
      if (enableAudio) {
        body.audio = true;
      }
      return body;
    }

    if (model.startsWith("veo-")) {
      return body;
    }

    if (model.startsWith("vidu")) {
      throw new Error("Vidu 图生视频参数暂未按官方文档接入，请先使用 Kling 或 Veo。");
    }
  } else if (["kling-v2-1", "kling-v2-5-turbo"].includes(model)) {
    throw new Error(`${model} 仅支持图生视频，请先提供首帧或参考图。`);
  }

  return body;
}

export function parseVideoTaskResult({ provider, payload }) {
  if (provider === "veo") {
    const sample =
      payload.generatedSamples?.[0] ||
      payload.videos?.[0] ||
      payload.data?.videos?.[0] ||
      null;
    return {
      status: payload.state || payload.status,
      url: sample?.video?.uri || sample?.uri || sample?.url || "",
      errorMessage: payload?.error?.message || "",
      raw: payload,
    };
  }

  const video =
    payload.task_result?.videos?.[0] ||
    payload.output?.[0] ||
    payload.data?.[0] ||
    payload.data?.videos?.[0] ||
    null;
  return {
    status: payload.status,
    url: video?.url || video?.uri || "",
    errorMessage: payload?.error?.message || payload?.task_result?.error?.message || "",
    raw: payload,
  };
}
