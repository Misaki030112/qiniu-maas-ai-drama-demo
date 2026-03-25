import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { QiniuMaaSClient } from "../src/providers/qiniu-maas.js";
import { startMockQiniuServer } from "../test-support/mock-qiniu-server.js";

let server;

before(async () => {
  server = await startMockQiniuServer(async ({ res, url }) => {
    if (url.pathname !== "/v1/voice/tts") {
      return false;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      data: Buffer.from("mp3-bytes").toString("base64"),
      addition: { duration: 1234 },
      reqid: "tts-1",
    }));
    return true;
  });
});

after(async () => {
  await server.close();
});

test("qiniu tts request preserves voice type and speed ratio", async () => {
  server.recorded.length = 0;
  const client = new QiniuMaaSClient(server.createClientOptions());
  const result = await client.synthesizeSpeech({
    text: "你好，欢迎来到漫剧工作站。",
    voiceType: "qiniu_zh_female_ljfdxx",
    speedRatio: 1.1,
  });

  assert.equal(result.durationMs, 1234);
  assert.equal(result.reqid, "tts-1");
  assert.equal(result.buffer.toString("utf8"), "mp3-bytes");
  assert.equal(server.recorded[0].path, "/v1/voice/tts");
  assert.equal(server.recorded[0].body.audio.voice_type, "qiniu_zh_female_ljfdxx");
  assert.equal(server.recorded[0].body.audio.speed_ratio, 1.1);
  assert.equal(server.recorded[0].body.request.text, "你好，欢迎来到漫剧工作站。");
});
