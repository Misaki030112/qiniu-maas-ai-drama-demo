function toGeminiImageInput(item) {
  if (!item) return null;
  if (item.dataUri) return item.dataUri;
  if (item.url) return item.url;
  return null;
}

export function isGeminiImageModel(model) {
  return String(model || "").startsWith("gemini-");
}

export function buildGeminiImageRequest({ model, prompt, aspectRatio = "16:9", referenceImages = [] }) {
  const refs = referenceImages.filter(Boolean);
  if (!refs.length) {
    return {
      method: "POST",
      endpoint: "/images/generations",
      body: {
        model,
        prompt,
        image_config: {
          aspect_ratio: aspectRatio,
        },
      },
      errorFallback: "Image generation failed",
    };
  }

  const images = refs.map(toGeminiImageInput).filter(Boolean);
  if (!images.length) {
    throw new Error("Gemini 图生图缺少可用参考图。");
  }

  return {
    method: "POST",
    endpoint: "/images/edits",
    body: {
      model,
      image: images.length === 1 ? images[0] : images,
      prompt,
      image_config: {
        aspect_ratio: aspectRatio,
      },
    },
    errorFallback: "Image edit failed",
  };
}
