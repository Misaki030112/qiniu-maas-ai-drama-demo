import { toPublicOrInlineReference } from "../reference-media.js";

function bufferToDataUri(buffer, mimeType = "image/png") {
  if (!buffer) {
    return "";
  }
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function normalizeViduResolution(aspectRatio = "16:9", resolution = "") {
  if (resolution) {
    return resolution;
  }
  return aspectRatio === "9:16" ? "720p" : "1080p";
}

export function buildViduVideoRequest({ model, prompt, imageBuffer, lastFrameBuffer, referenceImages = [], seconds, aspectRatio, resolution, normalizeVideoSeconds }) {
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
      method: "POST",
      baseUrlType: "root",
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
      errorFallback: "Video task creation failed",
    };
  }

  if (firstReference) {
    return {
      provider: "vidu",
      method: "POST",
      baseUrlType: "root",
      endpoint: `/queue/fal-ai/vidu/q3/image-to-video/${tier}`,
      body: {
        prompt,
        image_url: firstReference,
        duration,
        resolution: resolvedResolution,
        movement_amplitude: "auto",
        watermark: false,
      },
      errorFallback: "Video task creation failed",
    };
  }

  return {
    provider: "vidu",
    method: "POST",
    baseUrlType: "root",
    endpoint: `/queue/fal-ai/vidu/q3/text-to-video/${tier}`,
    body: {
      prompt,
      duration,
      resolution: resolvedResolution,
      movement_amplitude: "auto",
    },
    errorFallback: "Video task creation failed",
  };
}

export function buildViduStatusRequest(id) {
  return {
    provider: "vidu",
    method: "GET",
    baseUrlType: "root",
    endpoint: `/queue/fal-ai/vidu/requests/${id}/status`,
    errorFallback: "Video task query failed",
  };
}
