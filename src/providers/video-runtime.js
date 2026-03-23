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

export function buildVideoTaskBody({ model, prompt, imageBuffer, seconds, aspectRatio }) {
  const body = {
    model,
    prompt,
    seconds: normalizeVideoSeconds(model, seconds),
    size: resolveVideoSize(aspectRatio),
  };

  if (imageBuffer) {
    if (model.startsWith("kling-")) {
      body.image_list = [
        {
          image: imageBuffer.toString("base64"),
        },
      ];
      return body;
    }

    if (model.startsWith("sora-")) {
      throw new Error("Sora 图生视频当前需要公开可访问的参考图 URL，当前项目暂未接入该上传链路。");
    }

    if (model.startsWith("vidu")) {
      throw new Error("Vidu 图生视频参数暂未按官方文档接入，请先使用 Kling 或 Veo。");
    }
  } else if (model === "kling-v2-1") {
    throw new Error("kling-v2-1 仅支持图生视频，请先提供参考图。");
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
