import assert from "node:assert/strict";
import { test } from "node:test";
import { buildModelCatalogSeed } from "../src/model-catalog.js";

test("model catalog seed classifies text, image, video, speech and multimodal models", () => {
  const items = buildModelCatalogSeed();
  const byId = new Map(items.map((item) => [item.modelId, item]));

  assert.equal(byId.get("openai/gpt-5.4").category, "text");
  assert.equal(byId.get("gpt-image-1").category, "image");
  assert.equal(byId.get("veo-3.1-fast-generate-001").category, "video");
  assert.equal(byId.get("tts").category, "speech");

  const kling = byId.get("kling-v2-1");
  assert.equal(kling.category, "multi");
  assert.deepEqual(kling.metadata.categories.sort(), ["image", "video"]);
  assert.ok(kling.capabilities.includes("image_generation"));
  assert.ok(kling.capabilities.includes("video_generation"));
});
