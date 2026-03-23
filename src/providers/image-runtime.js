async function downloadImageBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download image failed with ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function isGeminiImageModel(model) {
  return model.startsWith("gemini-");
}

function isKlingImageModel(model) {
  return model.startsWith("kling-");
}

function toGeminiImageInput(item) {
  if (!item) return null;
  if (item.dataUri) return item.dataUri;
  if (item.url) return item.url;
  return null;
}

function toKlingImageInput(item) {
  if (!item) return null;
  if (item.base64) return item.base64;
  return null;
}

export function buildImageRequest({ model, prompt, aspectRatio = "16:9", referenceImages = [] }) {
  const refs = referenceImages.filter(Boolean);

  if (!refs.length) {
    if (isGeminiImageModel(model)) {
      return {
        endpoint: "/images/generations",
        body: {
          model,
          prompt,
          image_config: {
            aspect_ratio: aspectRatio,
          },
        },
      };
    }

    if (isKlingImageModel(model)) {
      return {
        endpoint: "/images/generations",
        body: {
          model,
          prompt,
          aspect_ratio: aspectRatio,
        },
      };
    }

    return {
      endpoint: "/images/generations",
      body: { model, prompt },
    };
  }

  if (isGeminiImageModel(model)) {
    const images = refs.map(toGeminiImageInput).filter(Boolean);
    if (!images.length) {
      throw new Error("Gemini 图生图缺少可用参考图。");
    }
    return {
      endpoint: "/images/edits",
      body: {
        model,
        image: images.length === 1 ? images[0] : images,
        prompt,
        image_config: {
          aspect_ratio: aspectRatio,
        },
      },
    };
  }

  if (isKlingImageModel(model)) {
    if (refs.length === 1) {
      const image = toKlingImageInput(refs[0]);
      if (!image) {
        throw new Error("Kling 单图生图缺少可用参考图。");
      }
      return {
        endpoint: "/images/generations",
        body: {
          model,
          prompt,
          image,
          aspect_ratio: aspectRatio,
        },
      };
    }

    throw new Error("Kling 多图生图暂未在当前工作台接入，请先上传 1 张参考图。");
  }

  throw new Error(`当前模型 ${model} 暂未接入图生图，请使用 Gemini 或 Kling。`);
}

export async function getImageTask({ baseUrl, headers, taskId }) {
  const response = await fetch(`${baseUrl}/images/tasks/${taskId}`, {
    headers,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Image task query failed with ${response.status}`);
  }
  return payload;
}

export async function pollImageTask({ baseUrl, headers, taskId }) {
  while (true) {
    const payload = await getImageTask({ baseUrl, headers, taskId });
    const status = String(payload?.status || "").toLowerCase();
    if (["succeed", "success", "completed"].includes(status)) {
      return payload;
    }
    if (["failed", "error", "cancelled"].includes(status)) {
      throw new Error(payload?.status_message || `Image task failed: ${status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

export async function resolveImagePayload({ baseUrl, headers, payload }) {
  const item = payload?.data?.[0];
  if (item?.b64_json) {
    return {
      ...payload,
      buffer: Buffer.from(item.b64_json, "base64"),
    };
  }

  if (item?.url) {
    return {
      ...payload,
      buffer: await downloadImageBuffer(item.url),
    };
  }

  const taskId = payload?.task_id || payload?.id;
  if (taskId) {
    const taskResult = await pollImageTask({ baseUrl, headers, taskId });
    return resolveImagePayload({
      baseUrl,
      headers,
      payload: {
        ...taskResult,
        task_id: taskId,
      },
    });
  }

  throw new Error("Image response does not contain b64_json, url, or task_id.");
}
