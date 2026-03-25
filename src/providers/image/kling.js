import { toPublicReferenceUrl } from "../reference-media.js";

const KLING_IMAGE_MODELS = new Set([
  "kling-v1",
  "kling-v1-5",
  "kling-v2",
  "kling-v2-1",
  "kling-image-o1",
]);

export function isKlingImageModel(model) {
  return KLING_IMAGE_MODELS.has(String(model || ""));
}

export function isKlingOmniImageModel(model) {
  return model === "kling-image-o1";
}

export function supportsKlingImageEdit(model) {
  return ["kling-v1", "kling-v2", "kling-v2-1"].includes(model);
}

function needsKlingImageReference(model) {
  return model === "kling-v1" || model === "kling-v1-5";
}

function toKlingImageInput(item) {
  if (!item) return null;
  const publicUrl = toPublicReferenceUrl(item);
  if (publicUrl) return publicUrl;
  if (item.base64) return item.base64;
  if (item.url) return item.url;
  if (item.dataUri && /^data:/i.test(item.dataUri)) {
    return item.dataUri.replace(/^data:[^;]+;base64,/i, "");
  }
  if (item.dataUri) return item.dataUri;
  return null;
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
    method: "POST",
    endpoint: "/images/generations",
    body,
    errorFallback: "Image generation failed",
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
    method: "POST",
    endpoint: "/images/edits",
    body,
    errorFallback: "Image edit failed",
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

export function buildKlingOmniImageRequest({ prompt, aspectRatio = "16:9", referenceImages = [] }) {
  const imageUrls = referenceImages.map(toPublicReferenceUrl).filter(Boolean).slice(0, 10);
  if (!imageUrls.length) {
    throw new Error("Kling-Image O1 参考图必须是公网可访问 URL，请配置 APP_BASE_URL 或使用支持 Base64 参考图的模型。");
  }
  const omniPrompt = truncateUtf8Bytes(injectKlingOmniReferences(prompt, imageUrls.length), 2400);
  return {
    method: "POST",
    baseUrlType: "root",
    endpoint: "/queue/fal-ai/kling-image/o1",
    body: {
      prompt: omniPrompt,
      image_urls: imageUrls,
      num_images: 1,
      aspect_ratio: aspectRatio,
    },
    errorFallback: "Kling image task creation failed",
  };
}

export function buildKlingImageRequest({ model, prompt, aspectRatio = "16:9", referenceImages = [] }) {
  const refs = referenceImages.filter(Boolean);
  if (isKlingOmniImageModel(model)) {
    if (!refs.length) {
      return {
        method: "POST",
        baseUrlType: "root",
        endpoint: "/queue/fal-ai/kling-image/o1",
        body: {
          prompt,
          num_images: 1,
          aspect_ratio: aspectRatio,
        },
        errorFallback: "Kling image task creation failed",
      };
    }
    return buildKlingOmniImageRequest({ prompt, aspectRatio, referenceImages: refs });
  }

  if (!refs.length) {
    return {
      method: "POST",
      endpoint: "/images/generations",
      body: {
        model,
        prompt,
        aspect_ratio: aspectRatio,
      },
      errorFallback: "Image generation failed",
    };
  }

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
