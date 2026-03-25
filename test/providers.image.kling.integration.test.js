import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { QiniuMaaSClient } from "../src/providers/qiniu-maas.js";
import { startMockQiniuServer } from "../test-support/mock-qiniu-server.js";

let server;

before(async () => {
  server = await startMockQiniuServer(async ({ res, url, port }) => {
    if (url.pathname === "/v1/images/edits") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        data: [{ url: `http://127.0.0.1:${port}/assets/kling-edit.png` }],
      }));
      return true;
    }
    if (url.pathname === "/queue/fal-ai/kling-image/o1") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ request_id: "kling-image-task-1" }));
      return true;
    }
    if (url.pathname === "/queue/fal-ai/kling-image/requests/kling-image-task-1/status") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        status: "COMPLETED",
        images: [{ url: `http://127.0.0.1:${port}/assets/kling-omni.png` }],
      }));
      return true;
    }
    if (url.pathname === "/assets/kling-edit.png") {
      res.setHeader("Content-Type", "image/png");
      res.end(Buffer.from("kling-edit-binary"));
      return true;
    }
    if (url.pathname === "/assets/kling-omni.png") {
      res.setHeader("Content-Type", "image/png");
      res.end(Buffer.from("kling-omni-binary"));
      return true;
    }
    return false;
  });
});

after(async () => {
  await server.close();
});

test("kling multi-reference edit uses subject list and scene/style slots", async () => {
  server.recorded.length = 0;
  const client = new QiniuMaaSClient(server.createClientOptions());
  const result = await client.generateImage({
    model: "kling-v2",
    prompt: "让两位主角在同一办公室对峙。",
    aspectRatio: "16:9",
    referenceImages: [
      { publicUrl: "https://example.com/char-a.png", refKind: "subject" },
      { publicUrl: "https://example.com/char-b.png", refKind: "subject" },
      { publicUrl: "https://example.com/scene.png", refKind: "scene" },
      { publicUrl: "https://example.com/style.png", refKind: "style" },
    ],
  });

  assert.equal(result.buffer.toString("utf8"), "kling-edit-binary");
  assert.equal(server.recorded[0].path, "/v1/images/edits");
  assert.deepEqual(server.recorded[0].body.subject_image_list, [
    { subject_image: "https://example.com/char-a.png" },
    { subject_image: "https://example.com/char-b.png" },
  ]);
  assert.equal(server.recorded[0].body.scene_image, "https://example.com/scene.png");
  assert.equal(server.recorded[0].body.style_image, "https://example.com/style.png");
});

test("kling-image-o1 uses root queue endpoint and prompt image placeholders", async () => {
  server.recorded.length = 0;
  const client = new QiniuMaaSClient(server.createClientOptions());
  const result = await client.generateImage({
    model: "kling-image-o1",
    prompt: "让主体服装更接近赛博朋克风格。",
    referenceImages: [
      { publicUrl: "https://example.com/ref-1.png" },
      { publicUrl: "https://example.com/ref-2.png" },
    ],
  });

  assert.equal(result.buffer.toString("utf8"), "kling-omni-binary");
  assert.equal(server.recorded[0].path, "/queue/fal-ai/kling-image/o1");
  assert.deepEqual(server.recorded[0].body.image_urls, [
    "https://example.com/ref-1.png",
    "https://example.com/ref-2.png",
  ]);
  assert.match(server.recorded[0].body.prompt, /<<<image_1>>>/);
  assert.match(server.recorded[0].body.prompt, /<<<image_2>>>/);
});
