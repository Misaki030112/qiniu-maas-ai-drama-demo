import { config } from "../config.js";

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

function toImageListEntry(buffer, type = "") {
  if (!buffer) {
    return null;
  }
  return type
    ? {
        image: buffer.toString("base64"),
        type,
      }
    : {
        image: buffer.toString("base64"),
      };
}

function toReferenceEntry(item) {
  if (!item) {
    return null;
  }
  if (item.base64) {
    return {
      image: item.base64,
    };
  }
  return null;
}

function bufferToDataUri(buffer, mimeType = "image/png") {
  if (!buffer) {
    return "";
  }
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
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

function toPublicOrInlineReference(item) {
  if (!item) {
    return "";
  }
  const publicUrl = toPublicReferenceUrl(item);
  if (publicUrl) {
    return publicUrl;
  }
  if (item.dataUri) {
    return item.dataUri;
  }
  if (item.base64) {
    return `data:image/png;base64,${item.base64}`;
  }
  return "";
}

function normalizeViduResolution(aspectRatio = "16:9", resolution = "") {
  if (resolution) {
    return resolution;
  }
  return aspectRatio === "9:16" ? "720p" : "1080p";
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
    const tier = model.endsWith("-pro") ? "pro" : "turbo";
    const firstReference = imageBuffer
      ? bufferToDataUri(imageBuffer)
      : referenceImages.map(toPublicOrInlineReference).find(Boolean) || "";
    const tailReference = lastFrameBuffer ? bufferToDataUri(lastFrameBuffer) : "";
    const duration = normalizeVideoSeconds(model, seconds);
    const resolvedResolution = normalizeViduResolution(aspectRatio, resolution);
    if (firstReference && tailReference) {
      return {
        provider: "vidu",
        endpoint: `/queue/fal-ai/vidu/q3/start-end-to-video/${tier}`,
        body: {
          prompt,
          start_image_url: firstReference,
          end_image_url: tailReference,
          duration,
          resolution: resolvedResolution,
          movement_amplitude: "auto",
          watermark: false,
        },
      };
    }
    if (firstReference) {
      return {
        provider: "vidu",
        endpoint: `/queue/fal-ai/vidu/q3/image-to-video/${tier}`,
        body: {
          prompt,
          image_url: firstReference,
          duration,
          resolution: resolvedResolution,
          movement_amplitude: "auto",
          watermark: false,
        },
      };
    }
    return {
      provider: "vidu",
      endpoint: `/queue/fal-ai/vidu/q3/text-to-video/${tier}`,
      body: {
        prompt,
        duration,
        resolution: resolvedResolution,
        movement_amplitude: "auto",
      },
    };
  }

  if (model.startsWith("veo-")) {
    const instance = {
      prompt,
      image: imageBuffer
        ? {
            bytesBase64Encoded: imageBuffer.toString("base64"),
            mimeType: "image/png",
          }
        : undefined,
      aspectRatio,
    };
    if (lastFrameBuffer) {
      instance.lastFrame = {
        bytesBase64Encoded: lastFrameBuffer.toString("base64"),
        mimeType: "image/png",
      };
    }
    const parameters = {
      durationSeconds: normalizeVideoSeconds(model, seconds),
      sampleCount: 1,
      generateAudio: Boolean(enableAudio),
    };
    if (resolution) {
      parameters.resolution = resolution;
    }
    return {
      provider: "veo",
      endpoint: "/videos/generations",
      body: {
        model,
        instances: [instance],
        parameters,
      },
    };
  }

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
      return {
        provider: "openai",
        endpoint: "/videos",
        body,
      };
    }

    if (model.startsWith("kling-")) {
      body.mode = mode || "std";
      if (model === "kling-video-o1") {
        const imageList = [
          imageBuffer ? toImageListEntry(imageBuffer, "first_frame") : null,
          lastFrameBuffer ? toImageListEntry(lastFrameBuffer, "end_frame") : null,
          ...referenceImages.map(toReferenceEntry).filter(Boolean),
        ].filter(Boolean);
        if (!imageList.length) {
          throw new Error(`模型 ${model} 缺少有效参考素材。`);
        }
        body.image_list = imageList;
      } else if (model === "kling-v3-omni") {
        const imageList = [
          imageBuffer ? toImageListEntry(imageBuffer, "first_frame") : null,
          ...referenceImages.map(toReferenceEntry).filter(Boolean),
        ].filter(Boolean);
        if (lastFrameBuffer) {
          if (imageList.length >= 2) {
            throw new Error("Kling V3 Omni 使用尾帧时，参考图片总数不能超过 2 张。请减少参考图或移除尾帧。");
          }
          imageList.push(toImageListEntry(lastFrameBuffer, "end_frame"));
        }
        if (!imageList.length) {
          throw new Error(`模型 ${model} 缺少有效参考素材。`);
        }
        body.image_list = imageList;
      } else {
        if (imageBuffer) {
          body.input_reference = imageBuffer.toString("base64");
        }
        if (lastFrameBuffer) {
          body.image_tail = lastFrameBuffer.toString("base64");
        }
        if (!body.input_reference && referenceImages.length) {
          const fallbackReference = referenceImages.find((item) => item?.base64)?.base64 || "";
          if (fallbackReference) {
            body.input_reference = fallbackReference;
          }
        }
        if (!body.input_reference && !body.image_tail) {
          throw new Error(`模型 ${model} 缺少有效参考素材。`);
        }
      }

      if (enableAudio && ["kling-v2-6", "kling-v3", "kling-v3-omni"].includes(model)) {
        body.sound = "on";
      }
      return {
        provider: "openai",
        endpoint: "/videos",
        body,
      };
    }
  } else if (["kling-v2-1"].includes(model)) {
    throw new Error(`${model} 仅支持图生视频和首尾帧视频，请先提供首帧或参考图。`);
  }

  return {
    provider: "openai",
    endpoint: "/videos",
    body,
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
