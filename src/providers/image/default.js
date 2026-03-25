export function buildDefaultImageRequest({ model, prompt }) {
  return {
    method: "POST",
    endpoint: "/images/generations",
    body: { model, prompt },
    errorFallback: "Image generation failed",
  };
}
