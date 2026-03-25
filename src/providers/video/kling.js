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

export function buildKlingVideoRequest({
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
  resolveVideoSize,
  normalizeVideoSeconds,
}) {
  const body = {
    model,
    prompt,
    seconds: String(normalizeVideoSeconds(model, seconds)),
    size: resolution || resolveVideoSize(aspectRatio),
    mode: mode || "std",
  };

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
      if (imageList.length > 1) {
        imageList.splice(1);
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
    method: "POST",
    endpoint: "/videos",
    body,
    errorFallback: "Video task creation failed",
  };
}
