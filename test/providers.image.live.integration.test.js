import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createLiveClient,
  resolveLiveImageModel,
  resolveLiveAssetUrl,
} from "../test-support/live-qiniu.js";

test("qiniu live image smoke uses OSS reference image and returns generated binary image", { timeout: 180000 }, async () => {
  const client = createLiveClient();
  const model = resolveLiveImageModel();
  const subjectUrl = resolveLiveAssetUrl("fixtures/subject-reference.jpg");

  const result = await client.generateImage({
    model,
    prompt: "基于参考图保持主体身份和主要外观特征，生成单人近景真实摄影画面，纯净背景，无文字，无水印。",
    aspectRatio: "9:16",
    referenceImages: [
      {
        url: subjectUrl,
        refKind: "subject",
        kind: "subject",
      },
    ],
  });

  assert.ok(result.buffer.length > 1024);
  assert.equal(Buffer.isBuffer(result.buffer), true);
});
