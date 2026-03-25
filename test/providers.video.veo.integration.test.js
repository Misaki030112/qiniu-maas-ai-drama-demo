import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { QiniuMaaSClient } from "../src/providers/qiniu-maas.js";
import { startMockQiniuServer } from "../test-support/mock-qiniu-server.js";

let server;

before(async () => {
  server = await startMockQiniuServer(async ({ res, url }) => {
    if (url.pathname === "/v1/videos/generations") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ id: "veo-task-1" }));
      return true;
    }
    if (url.pathname === "/v1/videos/generations/veo-task-1") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        state: "Completed",
        data: {
          videos: [{ url: "https://example.com/veo.mp4" }],
        },
      }));
      return true;
    }
    return false;
  });
});

after(async () => {
  await server.close();
});

test("veo video generation uses /v1/videos/generations and parses status response", async () => {
  server.recorded.length = 0;
  const client = new QiniuMaaSClient(server.createClientOptions());
  const task = await client.createVideoTask({
    model: "veo-3.1-fast-generate-001",
    prompt: "女主在天台回头，风吹动外套。",
    seconds: 6,
    aspectRatio: "16:9",
    enableAudio: true,
  });
  const status = await client.getVideoTask({
    provider: task.provider,
    id: task.id,
  });

  assert.equal(task.provider, "veo");
  assert.equal(task.id, "veo-task-1");
  assert.equal(server.recorded[0].path, "/v1/videos/generations");
  assert.equal(server.recorded[0].body.model, "veo-3.1-fast-generate-001");
  assert.equal(server.recorded[0].body.parameters.durationSeconds, 6);
  assert.equal(server.recorded[0].body.parameters.generateAudio, true);
  assert.equal(server.recorded[1].path, "/v1/videos/generations/veo-task-1");
  assert.equal(status.url, "https://example.com/veo.mp4");
});
