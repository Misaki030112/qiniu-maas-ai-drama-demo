import assert from "node:assert/strict";
import { test } from "node:test";
import { buildModelCatalogSeed, refreshModelCatalog } from "../src/model-catalog.js";

test("model catalog refresh writes category/family and deletes stale rows", async () => {
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
