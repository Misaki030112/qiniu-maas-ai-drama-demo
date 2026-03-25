import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { QiniuMaaSClient } from "../src/providers/qiniu-maas.js";
import { startMockQiniuServer } from "../test-support/mock-qiniu-server.js";

let server;

before(async () => {
  server = await startMockQiniuServer(async ({ res, url }) => {
    if (url.pathname === "/v1/videos") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ id: "sora-task-1" }));
      return true;
    }
    if (url.pathname === "/v1/videos/sora-task-1") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        status: "succeeded",
        data: [{ url: "https://example.com/sora.mp4" }],
      }));
      return true;
    }
    return false;
  });
});

after(async () => {
  await server.close();
});

test("sora uses public reference url and openai-compatible /v1/videos endpoint", async () => {
  server.recorded.length = 0;
  const client = new QiniuMaaSClient(server.createClientOptions());
  const task = await client.createVideoTask({
    model: "sora-2",
    prompt: "角色走出电梯后抬头看向走廊尽头。",
    referenceImages: [{ publicUrl: "https://example.com/frame.png" }],
    seconds: 8,
    aspectRatio: "16:9",
  });
  const status = await client.getVideoTask({
    provider: task.provider,
    id: task.id,
  });

  assert.equal(task.provider, "openai");
  assert.equal(server.recorded[0].path, "/v1/videos");
  assert.equal(server.recorded[0].body.input_reference, "https://example.com/frame.png");
  assert.equal(server.recorded[0].body.seconds, "8");
  assert.equal(status.url, "https://example.com/sora.mp4");
});
