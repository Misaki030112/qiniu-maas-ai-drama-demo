import { config } from "./config.js";
import { databaseSchema, query } from "./db.js";
import { QiniuMaaSClient } from "./providers/qiniu-maas.js";

const schema = databaseSchema();

const curatedModels = [
  {
    modelId: "gpt-image-1",
    displayName: "GPT Image 1",
    provider: "OpenAI",
    capabilities: ["image_generation", "subject_reference", "shot_image"],
    source: "curated",
    metadata: { verifiedFrom: "产品策略 / 官方模型入口" },
  },
  {
    modelId: "imagen-4",
    displayName: "Imagen 4",
    provider: "Google",
    capabilities: ["image_generation", "subject_reference", "shot_image"],
    source: "curated",
    metadata: { verifiedFrom: "产品策略 / 官方模型入口" },
  },
  {
    modelId: "gemini-2.5-flash-image",
    displayName: "Gemini 2.5 Flash Image",
    provider: "Google",
    capabilities: ["image_generation", "subject_reference", "shot_image"],
    source: "curated",
    metadata: { verifiedFrom: "产品策略 / 官方模型入口" },
  },
  {
    modelId: "minimax-image-01",
    displayName: "MiniMax Image 01",
    provider: "MiniMax",
    capabilities: ["image_generation", "subject_reference", "shot_image"],
    source: "curated",
    metadata: { verifiedFrom: "产品策略 / 官方模型入口" },
  },
  {
    modelId: "veo-3.1-fast-generate-001",
    displayName: "Veo 3.1 Fast Generate 001",
    provider: "Google",
    capabilities: ["video_generation"],
    source: "curated",
    metadata: { verifiedFrom: "七牛 / SUFY 视频模型入口" },
  },
  {
    modelId: "veo-3.1-generate-001",
    displayName: "Veo 3.1 Generate 001",
    provider: "Google",
    capabilities: ["video_generation"],
    source: "curated",
    metadata: { verifiedFrom: "七牛 / SUFY 视频模型入口" },
  },
  {
    modelId: "sora-2",
    displayName: "Sora 2",
    provider: "OpenAI",
    capabilities: ["video_generation"],
    source: "curated",
    metadata: { verifiedFrom: "七牛视频兼容接口" },
  },
  {
    modelId: "sora-2-pro",
    displayName: "Sora 2 Pro",
    provider: "OpenAI",
    capabilities: ["video_generation"],
    source: "curated",
    metadata: { verifiedFrom: "七牛视频兼容接口" },
  },
  {
    modelId: "kling-v3",
    displayName: "Kling V3",
    provider: "Kling",
    capabilities: ["video_generation"],
    source: "curated",
    metadata: { verifiedFrom: "SUFY 模型广场" },
  },
  {
    modelId: "kling-v3-omni",
    displayName: "Kling V3 Omni",
    provider: "Kling",
    capabilities: ["video_generation"],
    source: "curated",
    metadata: { verifiedFrom: "SUFY 模型广场" },
  },
  {
    modelId: "viduq3-turbo",
    displayName: "Vidu Q3 Turbo",
    provider: "Vidu",
    capabilities: ["video_generation"],
    source: "curated",
    metadata: { verifiedFrom: "SUFY 模型广场" },
  },
  {
    modelId: "viduq3-pro",
    displayName: "Vidu Q3 Pro",
    provider: "Vidu",
    capabilities: ["video_generation"],
    source: "curated",
    metadata: { verifiedFrom: "SUFY 模型广场" },
  },
  {
    modelId: "tts",
    displayName: "七牛 TTS",
    provider: "七牛云",
    capabilities: ["tts", "audio_generation"],
    source: "curated",
    metadata: { verifiedFrom: "SUFY 模型广场 / 七牛语音接口" },
  },
];

function prettifyModelName(modelId) {
  return modelId
    .replace(/^openai\//, "OpenAI/")
    .replace(/^deepseek\//, "DeepSeek/")
    .replace(/^minimax\//, "MiniMax/")
    .replace(/^moonshotai\//, "Moonshot/")
    .replace(/^meituan\//, "Meituan/")
    .replace(/^nvidia\//, "Nvidia/")
    .replace(/^xiaomi\//, "Xiaomi/")
    .replace(/^z-ai\//, "zAI/");
}

function inferProvider(modelId) {
  if (modelId.startsWith("openai/")) return "OpenAI";
  if (modelId.startsWith("deepseek/") || modelId.startsWith("deepseek")) return "DeepSeek";
  if (modelId.startsWith("minimax/") || modelId.startsWith("MiniMax")) return "MiniMax";
  if (modelId.startsWith("moonshotai/") || modelId.startsWith("kimi")) return "Moonshot-Kimi";
  if (modelId.startsWith("nvidia/")) return "Nvidia";
  if (modelId.startsWith("z-ai/") || modelId.startsWith("glm")) return "zAI";
  if (modelId.startsWith("qwen") || modelId.startsWith("qwen2.5")) return "Aliyun";
  if (modelId.startsWith("doubao")) return "ByteDance";
  return "Unknown";
}

function inferCapabilities(modelId) {
  if (/(vision|vl)/i.test(modelId)) {
    return ["subject_analysis", "storyboard", "vision"];
  }
  return ["script", "subject_analysis", "storyboard"];
}

function normalizeLiveModels(items) {
  return items.map((item) => ({
    modelId: item.id,
    displayName: prettifyModelName(item.id),
    provider: inferProvider(item.id),
    capabilities: inferCapabilities(item.id),
    source: "api",
    metadata: {
      created: item.created || null,
      ownedBy: item.owned_by || null,
      baseUrl: config.qiniu.baseUrl,
    },
  }));
}

function dedupeCatalog(items) {
  const map = new Map();
  for (const item of items) {
    map.set(item.modelId, item);
  }
  return [...map.values()];
}

export async function refreshModelCatalog() {
  const client = new QiniuMaaSClient(config.qiniu);
  const liveModels = normalizeLiveModels(await client.listModels());
  const allModels = dedupeCatalog([...liveModels, ...curatedModels]);

  for (const item of allModels) {
    await query(
      `
        INSERT INTO ${schema}.model_catalog (
          model_id,
          display_name,
          provider,
          capabilities,
          source,
          metadata,
          updated_at
        )
        VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb, NOW())
        ON CONFLICT (model_id) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          provider = EXCLUDED.provider,
          capabilities = EXCLUDED.capabilities,
          source = EXCLUDED.source,
          metadata = EXCLUDED.metadata,
          updated_at = EXCLUDED.updated_at
      `,
      [
        item.modelId,
        item.displayName,
        item.provider,
        JSON.stringify(item.capabilities),
        item.source,
        JSON.stringify(item.metadata || {}),
      ],
    );
  }

  return allModels;
}

export async function listModelCatalog() {
  const result = await query(
    `
      SELECT model_id, display_name, provider, capabilities, source, metadata, updated_at
      FROM ${schema}.model_catalog
      ORDER BY provider ASC, display_name ASC
    `,
  );

  if (!result.rows.length) {
    await refreshModelCatalog();
    return listModelCatalog();
  }

  return result.rows.map((row) => ({
    modelId: row.model_id,
    displayName: row.display_name,
    provider: row.provider,
    capabilities: row.capabilities || [],
    source: row.source,
    metadata: row.metadata || {},
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at,
  }));
}
