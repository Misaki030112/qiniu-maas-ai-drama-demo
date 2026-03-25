import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { QiniuMaaSClient } from "../src/providers/qiniu-maas.js";
import { startMockQiniuServer } from "../test-support/mock-qiniu-server.js";

let server;

before(async () => {
  server = await startMockQiniuServer(async ({ res, url }) => {
    if (url.pathname === "/queue/fal-ai/vidu/q3/start-end-to-video/pro") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ request_id: "vidu-task-1" }));
      return true;
    }
    if (url.pathname === "/queue/fal-ai/vidu/requests/vidu-task-1/status") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        status: "COMPLETED",
        result: {
          video: { url: "https://example.com/vidu.mp4" },
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

test("vidu q3 start-end video uses root queue endpoint with data-uri payload", async () => {
  server.recorded.length = 0;
  const client = new QiniuMaaSClient(server.createClientOptions());
  const task = await client.createVideoTask({
    model: "viduq3-pro",
    prompt: "角色从坐下到起身离开。",
    imageBuffer: Buffer.from("first"),
    lastFrameBuffer: Buffer.from("last"),
    seconds: 5,
    aspectRatio: "9:16",
    resolution: "720p",
  });
  const status = await client.getVideoTask({
    provider: task.provider,
    id: task.id,
  });

  assert.equal(task.provider, "vidu");
  assert.equal(server.recorded[0].path, "/queue/fal-ai/vidu/q3/start-end-to-video/pro");
  assert.match(server.recorded[0].body.start_image_url, /^data:image\/png;base64,/);
  assert.match(server.recorded[0].body.end_image_url, /^data:image\/png;base64,/);
  assert.equal(server.recorded[0].body.duration, 5);
  assert.equal(server.recorded[0].body.resolution, "720p");
  assert.equal(status.url, "https://example.com/vidu.mp4");
});
