import assert from "node:assert/strict";
import { test } from "node:test";
import { listModelCatalog } from "../src/model-catalog.js";

test("model catalog read only returns database rows without auto-seeding", async () => {
  const calls = [];

  const items = await listModelCatalog({
    schema: "test_schema",
    queryFn: async (text, params) => {
      calls.push({ text, params });
      return { rows: [] };
    },
  });

  assert.deepEqual(items, []);
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /SELECT/);
});
