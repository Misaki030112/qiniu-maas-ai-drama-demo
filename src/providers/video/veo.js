export function buildVeoVideoRequest({ model, prompt, imageBuffer, lastFrameBuffer, seconds, aspectRatio, enableAudio, resolution, normalizeVideoSeconds }) {
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
    method: "POST",
    endpoint: "/videos/generations",
    body: {
      model,
      instances: [instance],
      parameters,
    },
    errorFallback: "Video task creation failed",
  };
}

export function buildVeoStatusRequest(id) {
  return {
    provider: "veo",
    method: "GET",
    endpoint: `/videos/generations/${id}`,
    errorFallback: "Video task query failed",
  };
}
