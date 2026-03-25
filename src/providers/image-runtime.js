import { config } from "../config.js";

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

function isKlingOmniImageModel(model) {
  return model === "kling-image-o1";
}

function needsKlingImageReference(model) {
  return model === "kling-v1" || model === "kling-v1-5";
}

function supportsKlingImageEdit(model) {
  return ["kling-v1", "kling-v2", "kling-v2-1"].includes(model);
}

function toGeminiImageInput(item) {
  if (!item) return null;
  if (item.dataUri) return item.dataUri;
  if (item.url) return item.url;
  return null;
}

function toKlingImageInput(item) {
  if (!item) return null;
  const publicUrl = toPublicReferenceUrl(item);
  if (publicUrl) return publicUrl;
  if (item.base64) return item.base64;
  if (item.url) return item.url;
  // Kling 文档要求 Base64 不能带 data:image 前缀，仅在没有 raw base64 时兜底清洗。
  if (item.dataUri && /^data:/i.test(item.dataUri)) {
    return item.dataUri.replace(/^data:[^;]+;base64,/i, "");
  }
  if (item.dataUri) return item.dataUri;
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

function pickPreferredReference(items = []) {
  const refs = items.filter(Boolean);
  return refs.find((item) => (item.refKind || item.kind || "subject") === "subject")
    || refs[0]
    || null;
}

function buildKlingSingleImageRequest({ model, prompt, aspectRatio, referenceImages = [] }) {
  const preferred = pickPreferredReference(referenceImages);
  const image = toKlingImageInput(preferred);
  if (!image) {
    throw new Error("Kling 单图生图缺少可用参考图。");
  }
  const body = {
    model,
    prompt,
    image,
    aspect_ratio: aspectRatio,
  };
  if (needsKlingImageReference(model)) {
    body.image_reference = "subject";
  }
  return {
    endpoint: "/images/generations",
    body,
  };
}

function buildKlingEditImageRequest({ model, prompt, aspectRatio, referenceImages = [] }) {
  const refs = referenceImages
    .map((item) => ({
      ...item,
      publicUrl: toPublicReferenceUrl(item),
    }))
    .filter((item) => item.publicUrl);

  if (refs.length < 2) {
    return buildKlingSingleImageRequest({ model, prompt, aspectRatio, referenceImages });
  }

  const subjectImages = [];
  let sceneImage = "";
  let styleImage = "";

  for (const item of refs) {
    const refKind = item.refKind || item.kind || "subject";
    if (refKind === "scene" && !sceneImage) {
      sceneImage = item.publicUrl;
      continue;
    }
    if (refKind === "style" && !styleImage) {
      styleImage = item.publicUrl;
      continue;
    }
    if (subjectImages.length < 4) {
      subjectImages.push(item.publicUrl);
    }
  }

  const body = {
    model,
    image: "",
    prompt,
    aspect_ratio: aspectRatio,
    ...(subjectImages.length >= 2
      ? { subject_image_list: subjectImages.map((subject_image) => ({ subject_image })) }
      : {}),
    ...(sceneImage ? { scene_image: sceneImage } : {}),
    ...(styleImage ? { style_image: styleImage } : {}),
  };

  if (!body.subject_image_list) {
    return buildKlingSingleImageRequest({ model, prompt, aspectRatio, referenceImages });
  }

  return {
    endpoint: "/images/edits",
    body,
  };
}

function injectKlingOmniReferences(prompt, count) {
  if (!count || /<<<image_\d+>>>/.test(prompt)) {
    return prompt;
  }
  const refs = Array.from({ length: count }, (_, index) => `<<<image_${index + 1}>>>`).join("、");
  return `请参考 ${refs}。${prompt}`;
}

function truncateUtf8Bytes(value, maxBytes) {
  const text = String(value || "");
  if (!text || Buffer.byteLength(text, "utf8") <= maxBytes) {
    return text;
  }
  const ellipsis = "…";
  const budget = Math.max(0, maxBytes - Buffer.byteLength(ellipsis, "utf8"));
  let result = "";
  for (const char of text) {
    const next = result + char;
    if (Buffer.byteLength(next, "utf8") > budget) {
      break;
    }
    result = next;
  }
  return `${result}${ellipsis}`;
}

export function explainImageReferenceConstraint({ model, referenceImages = [] }) {
  const refs = referenceImages.filter(Boolean);
  if (refs.length <= 1) {
    return "";
  }

  if (isKlingOmniImageModel(model)) {
    return "";
  }

  if (isGeminiImageModel(model)) {
    return "";
  }

  if (!isKlingImageModel(model)) {
    return "";
  }

  if (!supportsKlingImageEdit(model)) {
    return `当前模型 ${model} 不支持多参考图共同生图。你选了 ${refs.length} 个参考，但它只能实际使用 1 个。`;
  }

  const classified = refs.map((item) => ({
    ...item,
    publicUrl: toPublicReferenceUrl(item),
  }));
  const subjectCount = classified.filter((item) => {
    const refKind = item.refKind || item.kind || "subject";
    return refKind !== "scene" && refKind !== "style";
  }).length;
  const sceneCount = classified.filter((item) => (item.refKind || item.kind || "subject") === "scene").length;
  const styleCount = classified.filter((item) => (item.refKind || item.kind || "subject") === "style").length;

  if (subjectCount >= 2) {
    return "";
  }

  if (sceneCount || styleCount) {
    return `当前模型 ${model} 在七牛接口下走多图编辑时，至少需要 2 张主体参考图。你现在选择的是 ${subjectCount} 张主体图，${sceneCount} 张场景图，${styleCount} 张风格图；如果继续生成，就会丢掉一部分参考图。`;
  }

  return `当前模型 ${model} 需要至少 2 张主体参考图才能走多图编辑。你现在选择的参考图数量不足。`;
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

    if (isKlingOmniImageModel(model)) {
      return {
        useRootBaseUrl: true,
        endpoint: "/queue/fal-ai/kling-image/o1",
        body: {
          prompt,
          num_images: 1,
          aspect_ratio: aspectRatio,
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

  if (isKlingOmniImageModel(model)) {
    const imageUrls = refs.map(toPublicReferenceUrl).filter(Boolean).slice(0, 10);
    if (!imageUrls.length) {
      throw new Error("Kling-Image O1 参考图必须是公网可访问 URL，请配置 APP_BASE_URL 或使用支持 Base64 参考图的模型。");
    }
    const omniPrompt = truncateUtf8Bytes(injectKlingOmniReferences(prompt, imageUrls.length), 2400);
    return {
      useRootBaseUrl: true,
      endpoint: "/queue/fal-ai/kling-image/o1",
      body: {
        prompt: omniPrompt,
        image_urls: imageUrls,
        num_images: 1,
        aspect_ratio: aspectRatio,
      },
    };
  }

  if (isKlingImageModel(model)) {
    if (refs.length === 1 || !supportsKlingImageEdit(model)) {
      return buildKlingSingleImageRequest({
        model,
        prompt,
        aspectRatio,
        referenceImages: refs,
      });
    }
    return buildKlingEditImageRequest({
      model,
      prompt,
      aspectRatio,
      referenceImages: refs,
    });
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

export async function getKlingImageTask({ rootBaseUrl, headers, taskId }) {
  const response = await fetch(`${rootBaseUrl}/queue/fal-ai/kling-image/requests/${taskId}/status`, {
    headers,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.detail?.message || payload?.error?.message || `Kling image task query failed with ${response.status}`);
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

export async function pollKlingImageTask({ rootBaseUrl, headers, taskId }) {
  while (true) {
    const payload = await getKlingImageTask({ rootBaseUrl, headers, taskId });
    const status = String(payload?.status || "").toUpperCase();
    if (["COMPLETED", "SUCCEEDED", "SUCCESS"].includes(status)) {
      return payload;
    }
    if (["FAILED", "ERROR", "CANCELLED"].includes(status)) {
      throw new Error(payload?.detail?.message || payload?.status_message || `Kling image task failed: ${status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

export async function resolveImagePayload({ baseUrl, rootBaseUrl, headers, payload }) {
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

  const queueItem = payload?.result?.images?.[0] || payload?.images?.[0];
  if (queueItem?.url) {
    return {
      ...payload,
      buffer: await downloadImageBuffer(queueItem.url),
    };
  }

  const taskId = payload?.task_id || payload?.id;
  if (taskId) {
    const taskResult = await pollImageTask({ baseUrl, headers, taskId });
    return resolveImagePayload({
      baseUrl,
      rootBaseUrl,
      headers,
      payload: {
        ...taskResult,
        task_id: taskId,
      },
    });
  }

  const queueTaskId = payload?.request_id;
  if (queueTaskId) {
    const taskResult = await pollKlingImageTask({ rootBaseUrl, headers, taskId: queueTaskId });
    return resolveImagePayload({
      baseUrl,
      rootBaseUrl,
      headers,
      payload: {
        ...taskResult,
        request_id: queueTaskId,
      },
    });
  }

  throw new Error("Image response does not contain b64_json, url, task_id, or request_id.");
}
