import assert from "node:assert/strict";
import { test } from "node:test";
import { createLiveClient, resolveLiveVoiceType } from "../test-support/live-qiniu.js";

test("qiniu live speech smoke returns playable audio bytes", { timeout: 60000 }, async () => {
  const client = createLiveClient();
  const voiceType = resolveLiveVoiceType();

  const result = await client.synthesizeSpeech({
    text: "七牛真实语音测试。",
    voiceType,
    speedRatio: 1,
  });

  assert.ok(result.buffer.length > 1024);
  assert.ok(result.durationMs > 0);
  assert.ok(String(result.reqid || "").trim());
});
