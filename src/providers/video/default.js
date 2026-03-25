export function buildDefaultVideoRequest({ model, prompt, seconds, aspectRatio, resolution, resolveVideoSize, normalizeVideoSeconds }) {
  return {
    provider: "openai",
    method: "POST",
    endpoint: "/videos",
    body: {
      model,
      prompt,
      seconds: String(normalizeVideoSeconds(model, seconds)),
      size: resolution || resolveVideoSize(aspectRatio),
    },
    errorFallback: "Video task creation failed",
  };
}
