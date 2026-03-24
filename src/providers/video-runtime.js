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

export function buildVideoTaskBody({
  model,
  prompt,
  imageBuffer,
  lastFrameBuffer,
  referenceImages = [],
  seconds,
  aspectRatio,
  enableAudio = false,
  resolution = "",
}) {
  const body = {
    model,
    prompt,
    seconds: normalizeVideoSeconds(model, seconds),
    size: resolution || resolveVideoSize(aspectRatio),
  };

  if (imageBuffer || lastFrameBuffer || referenceImages.length) {
    if (model.startsWith("kling-")) {
      const imageList = [
        imageBuffer ? toImageListEntry(imageBuffer, "first_frame") : null,
        lastFrameBuffer ? toImageListEntry(lastFrameBuffer, "end_frame") : null,
        ...referenceImages.map(toReferenceEntry),
      ].filter(Boolean);

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

    if (model.startsWith("sora-")) {
      throw new Error("Sora 图生视频当前需要公开可访问的参考图 URL，当前项目暂未接入该上传链路。");
    }
    if (model.startsWith("vidu")) {
      throw new Error("Vidu 图生视频参数暂未按官方文档接入，请先使用 Kling 或 Veo。");
    }
  } else if (["kling-v2-1", "kling-v2-5-turbo", "kling-video-o1"].includes(model)) {
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
      url: sample?.video?.uri || sample?.uri || "",
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
    raw: payload,
  };
}
