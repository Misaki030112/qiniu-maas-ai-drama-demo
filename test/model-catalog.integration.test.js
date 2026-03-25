import assert from "node:assert/strict";
import { test } from "node:test";
import { buildModelCatalogSeed, refreshModelCatalog } from "../src/model-catalog.js";

test("buildModelCatalogSeed classifies models and preserves multimodal entries", () => {
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

test("refreshModelCatalog writes category and family fields to storage", async () => {
  const calls = [];
  const items = buildModelCatalogSeed().slice(0, 2);

  await refreshModelCatalog({
    items,
    schema: "test_schema",
    queryFn: async (text, params) => {
      calls.push({ text, params });
      return { rows: [] };
    },
  });

  assert.equal(calls.length, 3);
  assert.match(calls[0].text, /category/);
  assert.match(calls[0].text, /family/);
  assert.equal(calls[0].params[3], items[0].category);
  assert.equal(calls[0].params[4], items[0].family);
  assert.match(calls[2].text, /DELETE FROM/);
  assert.deepEqual(calls[2].params[0], items.map((item) => item.modelId));
});
