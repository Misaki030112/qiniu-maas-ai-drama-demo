import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { QiniuMaaSClient } from "../src/providers/qiniu-maas.js";
import { startMockQiniuServer } from "../test-support/mock-qiniu-server.js";

let server;

before(async () => {
  server = await startMockQiniuServer(async ({ res, url }) => {
    if (url.pathname === "/v1/videos") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ id: "kling-video-task-1" }));
      return true;
    }
    if (url.pathname === "/v1/videos/kling-video-task-1") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        status: "succeeded",
        data: [{ url: "https://example.com/kling.mp4" }],
      }));
      return true;
    }
    return false;
  });
});

after(async () => {
  await server.close();
});

test("kling-v3-omni video request carries first/end frame image list and sound flag", async () => {
  server.recorded.length = 0;
  const client = new QiniuMaaSClient(server.createClientOptions());
  const task = await client.createVideoTask({
    model: "kling-v3-omni",
    prompt: "镜头从近景推进到拥抱。",
    imageBuffer: Buffer.from("first-frame"),
    lastFrameBuffer: Buffer.from("last-frame"),
    referenceImages: [{ base64: "aux-ref-base64" }],
    seconds: 5,
    aspectRatio: "16:9",
    mode: "pro",
    enableAudio: true,
  });
  const status = await client.getVideoTask({
    provider: task.provider,
    id: task.id,
  });

  assert.equal(task.provider, "openai");
  assert.equal(server.recorded[0].path, "/v1/videos");
  assert.equal(server.recorded[0].body.model, "kling-v3-omni");
  assert.equal(server.recorded[0].body.mode, "pro");
  assert.equal(server.recorded[0].body.sound, "on");
  assert.equal(server.recorded[0].body.image_list.length, 2);
  assert.equal(server.recorded[0].body.image_list[0].type, "first_frame");
  assert.equal(server.recorded[0].body.image_list[1].type, "end_frame");
  assert.equal(status.url, "https://example.com/kling.mp4");
});
