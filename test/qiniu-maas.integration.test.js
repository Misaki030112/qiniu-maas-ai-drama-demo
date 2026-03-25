import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";
import { QiniuMaaSClient } from "../src/providers/qiniu-maas.js";

const recorded = [];
let server;
let port = 0;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : null);
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

before(async () => {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const body = req.method === "POST" ? await readJsonBody(req) : null;
    recorded.push({ method: req.method, path: url.pathname, body });

    if (url.pathname === "/v1/chat/completions") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        id: "chat-1",
        choices: [
          {
            message: {
              content: "{\"ok\":true,\"stage\":\"adaptation\"}",
            },
          },
        ],
        usage: { total_tokens: 12 },
      }));
      return;
    }

    if (url.pathname === "/v1/voice/tts") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        data: Buffer.from("mp3-bytes").toString("base64"),
        addition: { duration: 1234 },
      }));
      return;
    }

    if (url.pathname === "/v1/images/generations") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        data: [
          {
            b64_json: Buffer.from("image-bytes").toString("base64"),
          },
        ],
      }));
      return;
    }

    if (url.pathname === "/queue/fal-ai/kling-image/o1") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ request_id: "kling-image-task-1" }));
      return;
    }

    if (url.pathname === "/queue/fal-ai/kling-image/requests/kling-image-task-1/status") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        status: "COMPLETED",
        images: [{ url: `http://127.0.0.1:${port}/assets/kling.png` }],
      }));
      return;
    }

    if (url.pathname === "/assets/kling.png") {
      res.setHeader("Content-Type", "image/png");
      res.end(Buffer.from("kling-image-binary"));
      return;
    }

    if (url.pathname === "/v1/videos/generations") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ id: "veo-task-1" }));
      return;
    }

    if (url.pathname === "/v1/videos/generations/veo-task-1") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        state: "Completed",
        data: {
          videos: [{ url: "https://example.com/veo.mp4" }],
        },
      }));
      return;
    }

    res.statusCode = 404;
    res.end("not found");
  });

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      port = server.address().port;
      resolve();
    });
  });
});

after(async () => {
  if (!server) {
    return;
  }
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

function createClient() {
  return new QiniuMaaSClient({
    baseUrl: `http://127.0.0.1:${port}/v1`,
    apiKey: "test-key",
  });
}

test("chatJson uses text adapter and parses JSON payload", async () => {
  recorded.length = 0;
  const client = createClient();
  const result = await client.chatJson({
    model: "openai/gpt-5.4",
    systemPrompt: "system",
    userPrompt: "user",
  });

  assert.equal(result.parsed.ok, true);
  assert.equal(result.parsed.stage, "adaptation");
  assert.equal(recorded[0].path, "/v1/chat/completions");
  assert.equal(recorded[0].body.model, "openai/gpt-5.4");
});

test("synthesizeSpeech uses speech adapter and decodes audio buffer", async () => {
  recorded.length = 0;
  const client = createClient();
  const result = await client.synthesizeSpeech({
    text: "你好",
    voiceType: "qiniu_zh_female_ljfdxx",
    speedRatio: 1.1,
  });

  assert.equal(result.durationMs, 1234);
  assert.equal(result.buffer.toString("utf8"), "mp3-bytes");
  assert.equal(recorded[0].path, "/v1/voice/tts");
  assert.equal(recorded[0].body.audio.voice_type, "qiniu_zh_female_ljfdxx");
});

test("generateImage routes Gemini requests to /images/generations", async () => {
  recorded.length = 0;
  const client = createClient();
  const result = await client.generateImage({
    model: "gemini-3.1-flash-image-preview",
    prompt: "画一只猫",
    aspectRatio: "16:9",
  });

  assert.equal(result.buffer.toString("utf8"), "image-bytes");
  assert.equal(recorded[0].path, "/v1/images/generations");
  assert.equal(recorded[0].body.model, "gemini-3.1-flash-image-preview");
  assert.equal(recorded[0].body.image_config.aspect_ratio, "16:9");
});

test("generateImage routes Kling Omni requests to root queue endpoint", async () => {
  recorded.length = 0;
  const client = createClient();
  const result = await client.generateImage({
    model: "kling-image-o1",
    prompt: "让主体保持一致",
    referenceImages: [{ publicUrl: "https://example.com/ref.png" }],
  });

  assert.equal(result.buffer.toString("utf8"), "kling-image-binary");
  assert.equal(recorded[0].path, "/queue/fal-ai/kling-image/o1");
  assert.deepEqual(recorded[0].body.image_urls, ["https://example.com/ref.png"]);
  assert.equal(recorded[1].path, "/queue/fal-ai/kling-image/requests/kling-image-task-1/status");
});

test("createVideoTask and getVideoTask use Veo adapter and status parser", async () => {
  recorded.length = 0;
  const client = createClient();
  const task = await client.createVideoTask({
    model: "veo-3.1-fast-generate-001",
    prompt: "一只狗在海边跑步",
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
  assert.equal(status.status, "Completed");
  assert.equal(status.url, "https://example.com/veo.mp4");
  assert.equal(recorded[0].path, "/v1/videos/generations");
  assert.equal(recorded[0].body.parameters.durationSeconds, 6);
  assert.equal(recorded[1].path, "/v1/videos/generations/veo-task-1");
});
