import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { QiniuMaaSClient } from "../src/providers/qiniu-maas.js";
import { startMockQiniuServer } from "../test-support/mock-qiniu-server.js";

let server;

before(async () => {
  server = await startMockQiniuServer(async ({ res, url }) => {
    if (url.pathname !== "/v1/chat/completions") {
      return false;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      id: "chat-1",
      choices: [
        {
          message: {
            content: "{\"ok\":true,\"stage\":\"adaptation\",\"characters\":[\"林夏\"]}",
          },
        },
      ],
      usage: { total_tokens: 12 },
    }));
    return true;
  });
});

after(async () => {
  await server.close();
});

test("openai/gpt-5.4 chat completion is sent to /v1/chat/completions and parsed as JSON", async () => {
  server.recorded.length = 0;
  const client = new QiniuMaaSClient(server.createClientOptions());
  const result = await client.chatJson({
    model: "openai/gpt-5.4",
    systemPrompt: "你是编剧。",
    userPrompt: "输出 JSON。",
  });

  assert.equal(result.parsed.ok, true);
  assert.equal(result.parsed.stage, "adaptation");
  assert.deepEqual(result.parsed.characters, ["林夏"]);
  assert.equal(server.recorded[0].path, "/v1/chat/completions");
  assert.equal(server.recorded[0].body.model, "openai/gpt-5.4");
  assert.equal(server.recorded[0].body.messages[0].role, "system");
  assert.equal(server.recorded[0].body.messages[1].role, "user");
});

test("text adapter preserves raw model output when JSON parsing fails", async () => {
  await server.close();
  server = await startMockQiniuServer(async ({ res, url }) => {
    if (url.pathname !== "/v1/chat/completions") {
      return false;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      id: "chat-2",
      choices: [
        {
          message: {
            content: "this is not json",
          },
        },
      ],
    }));
    return true;
  });

  const client = new QiniuMaaSClient(server.createClientOptions());
  await assert.rejects(
    () => client.chatJson({
      model: "openai/gpt-5.4",
      systemPrompt: "system",
      userPrompt: "user",
    }),
    (error) => {
      assert.match(error.message, /RAW MODEL OUTPUT/);
      assert.match(error.message, /this is not json/);
      return true;
    },
  );
});
