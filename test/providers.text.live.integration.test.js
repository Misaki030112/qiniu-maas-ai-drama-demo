import assert from "node:assert/strict";
import { test } from "node:test";
import { createLiveClient, resolveLiveTextModel } from "../test-support/live-qiniu.js";

test("qiniu live text smoke returns parseable JSON", { timeout: 60000 }, async () => {
  const client = createLiveClient();
  const model = resolveLiveTextModel();
  const marker = `live-text-${Date.now()}`;

  const result = await client.chatJson({
    model,
    systemPrompt: "你必须只返回 JSON，不要输出任何额外解释。",
    userPrompt: `请返回 {"ok":true,"marker":"${marker}","channel":"text"}，不要输出其他内容。`,
    temperature: 0,
  });

  assert.equal(result.model, model);
  assert.equal(result.parsed.ok, true);
  assert.equal(result.parsed.marker, marker);
  assert.equal(result.parsed.channel, "text");
  assert.ok(Number(result.usage?.total_tokens || 0) > 0);
});
