import { buildDefaultVideoRequest } from "./video/default.js";
import { buildKlingVideoRequest } from "./video/kling.js";
import { buildSoraVideoRequest } from "./video/sora.js";
import { buildVeoStatusRequest, buildVeoVideoRequest } from "./video/veo.js";
import { buildViduStatusRequest, buildViduVideoRequest } from "./video/vidu.js";

export function normalizeVideoSeconds(model, seconds) {
  const value = Math.max(3, Math.min(15, Math.round(seconds)));
  if (["kling-v2-1", "kling-v2-5-turbo", "kling-v2-6", "kling-video-o1"].includes(model)) {
    return value >= 8 ? 10 : 5;
  }
  if (["kling-v3", "kling-v3-omni"].includes(model)) {
    return value;
  }
  if (model.startsWith("sora-")) {
    if (value <= 4) return 4;
    if (value <= 8) return 8;
    return 12;
  }
  if (model.startsWith("veo-")) {
    if (value <= 4) return 4;
    if (value <= 6) return 6;
    return 8;
  }
  if (model.startsWith("viduq3-")) {
    return value >= 5 ? 5 : 4;
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

export function buildVideoTaskRequest({
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
  if (model.startsWith("viduq3-")) {
    return buildViduVideoRequest({
      model,
      prompt,
      imageBuffer,
      lastFrameBuffer,
      referenceImages,
      seconds,
      aspectRatio,
      resolution,
      normalizeVideoSeconds,
    });
  }

  if (model.startsWith("veo-")) {
    return buildVeoVideoRequest({
      model,
      prompt,
      imageBuffer,
      lastFrameBuffer,
      seconds,
      aspectRatio,
      enableAudio,
      resolution,
      normalizeVideoSeconds,
    });
  }

  if (imageBuffer || lastFrameBuffer || referenceImages.length) {
    if (model.startsWith("sora-")) {
      return buildSoraVideoRequest({
        model,
        prompt,
        referenceImages,
        seconds,
        aspectRatio,
        resolution,
        resolveVideoSize,
        normalizeVideoSeconds,
      });
    }

    if (model.startsWith("kling-")) {
      return buildKlingVideoRequest({
        model,
        prompt,
        imageBuffer,
        lastFrameBuffer,
        referenceImages,
        seconds,
        aspectRatio,
        mode,
        enableAudio,
        resolution,
        resolveVideoSize,
        normalizeVideoSeconds,
      });
    }
  } else if (["kling-v2-1"].includes(model)) {
    throw new Error(`${model} 仅支持图生视频和首尾帧视频，请先提供首帧或参考图。`);
  }

  return buildDefaultVideoRequest({
    model,
    prompt,
    seconds,
    aspectRatio,
    resolution,
    resolveVideoSize,
    normalizeVideoSeconds,
  });
}

export function buildVideoStatusRequest({ provider, id }) {
  if (provider === "veo") {
    return buildVeoStatusRequest(id);
  }
  if (provider === "vidu") {
    return buildViduStatusRequest(id);
  }
  return {
    provider: "openai",
    method: "GET",
    endpoint: `/videos/${id}`,
    errorFallback: "Video task query failed",
  };
}

export function parseVideoTaskResult({ provider, payload }) {
  if (provider === "vidu") {
    return {
      status: payload.status,
      url: payload?.result?.video?.url || payload?.video?.url || "",
      errorMessage: payload?.error?.message || payload?.message || "",
      raw: payload,
    };
  }
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
