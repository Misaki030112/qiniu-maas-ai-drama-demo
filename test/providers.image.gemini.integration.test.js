import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { QiniuMaaSClient } from "../src/providers/qiniu-maas.js";
import { startMockQiniuServer } from "../test-support/mock-qiniu-server.js";

let server;

before(async () => {
  server = await startMockQiniuServer(async ({ res, url }) => {
    if (url.pathname === "/v1/images/generations") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        data: [{ b64_json: Buffer.from("gemini-image").toString("base64") }],
      }));
      return true;
    }
    if (url.pathname === "/v1/images/edits") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        data: [{ b64_json: Buffer.from("gemini-edit-image").toString("base64") }],
      }));
      return true;
    }
    return false;
  });
});

after(async () => {
  await server.close();
});

test("gemini image generation uses /v1/images/generations", async () => {
  server.recorded.length = 0;
  const client = new QiniuMaaSClient(server.createClientOptions());
  const result = await client.generateImage({
    model: "gemini-3.1-flash-image-preview",
    prompt: "画一张角色海报",
    aspectRatio: "16:9",
  });

  assert.equal(result.buffer.toString("utf8"), "gemini-image");
  assert.equal(server.recorded[0].path, "/v1/images/generations");
  assert.equal(server.recorded[0].body.model, "gemini-3.1-flash-image-preview");
  assert.equal(server.recorded[0].body.image_config.aspect_ratio, "16:9");
});

test("gemini image edit sends multiple reference images to /v1/images/edits", async () => {
  server.recorded.length = 0;
  const client = new QiniuMaaSClient(server.createClientOptions());
  const result = await client.generateImage({
    model: "gemini-3.1-flash-image-preview",
    prompt: "保留人物，替换成夜景街道。",
    referenceImages: [
      { url: "https://example.com/char.png" },
      { dataUri: "data:image/png;base64,abcd" },
    ],
    aspectRatio: "9:16",
  });

  assert.equal(result.buffer.toString("utf8"), "gemini-edit-image");
  assert.equal(server.recorded[0].path, "/v1/images/edits");
  assert.deepEqual(server.recorded[0].body.image, ["https://example.com/char.png", "data:image/png;base64,abcd"]);
  assert.equal(server.recorded[0].body.image_config.aspect_ratio, "9:16");
});
