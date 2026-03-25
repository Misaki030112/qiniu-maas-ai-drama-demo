import path from "node:path";
import { listModelCatalog } from "../src/model-catalog.js";
import { inferModelFamily, MODEL_CATEGORY } from "../src/providers/model-classification.js";
import { ensureDir, writeJson } from "../src/utils.js";
import {
  createLiveClient,
  downloadLiveAssetBuffer,
  resolveLiveAssetUrl,
  resolveLiveVoiceType,
} from "../test-support/live-qiniu.js";

function parseArgs(argv) {
  const args = {
    category: "",
    limit: 0,
    model: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const next = argv[index + 1];
    if (!args.category && !value.startsWith("--")) {
      args.category = value;
      continue;
    }
    if (value === "--limit" && next) {
      args.limit = Number(next || 0);
      index += 1;
      continue;
    }
    if (value === "--model" && next) {
      args.model = next;
      index += 1;
    }
  }

  return args;
}

function nowStamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function capabilityForCategory(category) {
  return {
    text: "script",
    image: "image_generation",
    video: "video_generation",
    speech: "tts",
  }[category] || "";
}

function operationNoteForImage(modelId) {
  const family = inferModelFamily(modelId, MODEL_CATEGORY.IMAGE);
  if (["gemini-image", "kling-image", "kling-image-o1"].includes(family)) {
    return "reference-image";
  }
  return "text-to-image";
}

function operationNoteForVideo(modelId) {
  const family = inferModelFamily(modelId, MODEL_CATEGORY.VIDEO);
  if (family === "sora-video") {
    return "public-reference-video";
  }
  if (["veo-video", "kling-video", "vidu-video"].includes(family)) {
    return "image-to-video";
  }
  return "text-to-video";
}

async function runTextCheck(client, modelId) {
  const marker = `catalog-text-${Date.now()}`;
  const result = await client.chatJson({
    model: modelId,
    systemPrompt: "你必须只返回 JSON，不要输出任何额外解释。",
    userPrompt: `请返回 {"ok":true,"marker":"${marker}","model":"${modelId}"}，不要输出其他内容。`,
  });
  return {
    operation: "chat-json",
    usage: result.usage || null,
    details: {
      marker,
      parsed: result.parsed,
    },
  };
}

async function runSpeechCheck(client, modelId) {
  const voiceType = resolveLiveVoiceType();
  const result = await client.synthesizeSpeech({
    text: `真实语音测试，模型 ${modelId}。`,
    voiceType,
    speedRatio: 1,
  });
  return {
    operation: "tts",
    details: {
      voiceType,
      durationMs: result.durationMs,
      bytes: result.buffer.length,
      reqid: result.reqid || "",
    },
  };
}

async function runImageCheck(client, modelId) {
  const family = inferModelFamily(modelId, MODEL_CATEGORY.IMAGE);
  if (["gemini-image", "kling-image", "kling-image-o1"].includes(family)) {
    const subjectUrl = resolveLiveAssetUrl("fixtures/subject-reference.jpg");
    const result = await client.generateImage({
      model: modelId,
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
    return {
      operation: "reference-image",
      details: {
        referenceUrl: subjectUrl,
        bytes: result.buffer.length,
      },
    };
  }

  const result = await client.generateImage({
    model: modelId,
    prompt: "一颗放在木桌上的红苹果，真实摄影，单主体，纯净背景，无文字，无水印。",
    aspectRatio: "1:1",
  });
  return {
    operation: "text-to-image",
    details: {
      bytes: result.buffer.length,
    },
  };
}

async function runVideoCheck(client, modelId) {
  const family = inferModelFamily(modelId, MODEL_CATEGORY.VIDEO);
  const firstFrame = await downloadLiveAssetBuffer("fixtures/video-first-frame.jpg");
  const taskInput = {
    model: modelId,
    prompt: "保持首帧主体和背景风格，生成一个轻微动作的视频片段，真实摄影，稳定镜头，无文字。",
    seconds: 4,
    aspectRatio: "16:9",
  };

  if (family === "sora-video") {
    taskInput.referenceImages = [
      {
        url: resolveLiveAssetUrl("fixtures/video-first-frame.jpg"),
        refKind: "subject",
        kind: "subject",
      },
    ];
  } else if (["veo-video", "kling-video", "vidu-video"].includes(family)) {
    taskInput.imageBuffer = firstFrame.buffer;
  }

  const task = await client.createVideoTask(taskInput);
  const status = await client.getVideoTask({
    model: modelId,
    provider: task.provider,
    id: task.id,
  });

  return {
    operation: operationNoteForVideo(modelId),
    details: {
      provider: task.provider,
      taskId: task.id,
      status: status.status,
      hasUrl: Boolean(status.url),
    },
  };
}

async function runCategoryCheck(client, category, modelId) {
  if (category === "text") {
    return runTextCheck(client, modelId);
  }
  if (category === "speech") {
    return runSpeechCheck(client, modelId);
  }
  if (category === "image") {
    return runImageCheck(client, modelId);
  }
  if (category === "video") {
    return runVideoCheck(client, modelId);
  }
  throw new Error(`Unsupported category: ${category}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const category = args.category;
  const capability = capabilityForCategory(category);

  if (!capability) {
    throw new Error("用法: node scripts/run-live-model-category-tests.js <text|image|speech|video> [--limit N] [--model MODEL_ID]");
  }

  const client = createLiveClient();
  const catalog = await listModelCatalog();
  let models = catalog
    .filter((item) => item.capabilities?.includes(capability))
    .map((item) => item.modelId);

  if (args.model) {
    models = models.filter((modelId) => modelId === args.model);
  }
  if (args.limit > 0) {
    models = models.slice(0, args.limit);
  }
  if (!models.length) {
    throw new Error(`数据库中没有可用于 ${category} 类别的模型。`);
  }

  const report = {
    category,
    startedAt: new Date().toISOString(),
    operation: category === "image"
      ? "mixed-image-checks"
      : category === "video"
        ? "mixed-video-checks"
        : category,
    total: models.length,
    passed: 0,
    failed: 0,
    results: [],
  };

  for (const modelId of models) {
    const startedAt = Date.now();
    process.stdout.write(`\n[${category}] ${modelId}\n`);
    try {
      const result = await runCategoryCheck(client, category, modelId);
      const entry = {
        modelId,
        ok: true,
        elapsedMs: Date.now() - startedAt,
        operation: result.operation,
        details: result.details,
      };
      report.results.push(entry);
      report.passed += 1;
      process.stdout.write(`PASS ${modelId} ${entry.operation}\n`);
    } catch (error) {
      const entry = {
        modelId,
        ok: false,
        elapsedMs: Date.now() - startedAt,
        operation: category === "image" ? operationNoteForImage(modelId) : category === "video" ? operationNoteForVideo(modelId) : category,
        error: error.message,
      };
      report.results.push(entry);
      report.failed += 1;
      process.stdout.write(`FAIL ${modelId} ${error.message}\n`);
    }
  }

  report.finishedAt = new Date().toISOString();
  const reportsDir = path.join(process.cwd(), "output", "test-reports");
  await ensureDir(reportsDir);
  const reportPath = path.join(reportsDir, `${category}-live-models-${nowStamp()}.json`);
  await writeJson(reportPath, report);

  console.log(`\nReport: ${reportPath}`);
  console.log(JSON.stringify({
    category: report.category,
    total: report.total,
    passed: report.passed,
    failed: report.failed,
    reportPath,
  }, null, 2));

  if (report.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
