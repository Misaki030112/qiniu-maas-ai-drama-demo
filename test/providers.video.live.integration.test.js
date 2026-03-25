import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createLiveClient,
  downloadLiveAssetBuffer,
  fetchVideoTaskStatus,
  resolveLiveVideoModel,
} from "../test-support/live-qiniu.js";

test("qiniu live video smoke uses OSS first frame, creates task and reads remote status", { timeout: 120000 }, async () => {
  const client = createLiveClient();
  const model = resolveLiveVideoModel();
  const firstFrame = await downloadLiveAssetBuffer("fixtures/video-first-frame.jpg");

  const task = await client.createVideoTask({
    model,
    prompt: "保持首帧主体和背景风格，生成一个轻微动作的视频片段，真实摄影，稳定镜头，无文字。",
    imageBuffer: firstFrame.buffer,
    seconds: 4,
    aspectRatio: "16:9",
  });

  assert.ok(String(task.provider || "").trim());
  assert.ok(String(task.id || "").trim());

  const status = await fetchVideoTaskStatus(client, {
    model,
    provider: task.provider,
    id: task.id,
  });
  const normalizedStatus = String(status.status || "").toLowerCase();

  assert.ok([
    "initializing",
    "queued",
    "processing",
    "running",
    "succeeded",
    "success",
    "completed",
  ].includes(normalizedStatus));
});
