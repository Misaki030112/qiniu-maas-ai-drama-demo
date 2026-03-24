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
    modelId: "gemini-3.1-flash-image-preview",
    displayName: "Gemini 3.1 Flash Image Preview",
    provider: "Google",
    capabilities: ["image_generation", "subject_reference", "shot_image"],
    source: "curated",
    metadata: { verifiedFrom: "SUFY 模型广场" },
  },
  {
    modelId: "kling-image-o1",
    displayName: "Kling-Image O1",
    provider: "Kling",
    capabilities: ["image_generation", "subject_reference", "shot_image"],
    source: "curated",
    metadata: { verifiedFrom: "SUFY 模型广场" },
  },
  {
    modelId: "kling-v2-new",
    displayName: "Kling-V2-New",
    provider: "Kling",
    capabilities: ["image_generation", "subject_reference", "shot_image"],
    source: "curated",
    metadata: { verifiedFrom: "SUFY 模型广场" },
  },
  {
    modelId: "kling-v1-5",
    displayName: "Kling-V1-5",
    provider: "Kling",
    capabilities: ["image_generation", "subject_reference", "shot_image"],
    source: "curated",
    metadata: { verifiedFrom: "SUFY 模型广场" },
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
    modelId: "kling-v2-1",
    displayName: "Kling V2.1",
    provider: "Kling",
    capabilities: ["video_generation"],
    source: "curated",
    metadata: { verifiedFrom: "七牛视频兼容接口 / SUFY 模型广场" },
  },
  {
    modelId: "kling-v2-5-turbo",
    displayName: "Kling V2.5 Turbo",
    provider: "Kling",
    capabilities: ["video_generation"],
    source: "curated",
    metadata: { verifiedFrom: "七牛视频兼容接口 / SUFY 模型广场" },
  },
  {
    modelId: "kling-video-o1",
    displayName: "Kling Video O1",
    provider: "Kling",
    capabilities: ["video_generation"],
    source: "curated",
    metadata: { verifiedFrom: "七牛视频兼容接口 / SUFY 模型广场" },
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
  if (/^(gemini|imagen|veo)/i.test(modelId)) return "Google";
  if (/^(gpt-image|sora|openai\/)/i.test(modelId)) return "OpenAI";
  if (/^(kling)/i.test(modelId)) return "Kling";
  if (/^(vidu)/i.test(modelId)) return "Vidu";
  if (/^(hailuo)/i.test(modelId)) return "MiniMax";
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

function parseStringList(raw) {
  if (!raw || !raw.trim()) {
    return [];
  }
  return raw
    .split(",")
    .map((item) => item.trim().replace(/\\"/g, "\"").replace(/^"|"$/g, ""))
    .filter(Boolean);
}

function inferMarketplaceCapabilities({ modelId, displayName, features }) {
  const text = [modelId, displayName, ...(features || [])].join(" ").toLowerCase();
  const capabilities = [];

  if (
    /生图|文生图|图生图|图片编辑|image|imagen|gpt image|gpt-image|nano banana|kling-image/.test(text)
  ) {
    capabilities.push("image_generation", "subject_reference", "shot_image");
  }

  if (/视频生成|图生视频|video|veo|sora|vidu|hailuo|kling v3|kling-v3/.test(text)) {
    capabilities.push("video_generation");
  }

  if (/文本转语音|语音合成|tts|speech/.test(text)) {
    capabilities.push("tts", "audio_generation");
  }

  if (/图像理解|vision/.test(text)) {
    capabilities.push("vision");
  }

  return [...new Set(capabilities)];
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

async function fetchMarketplaceModels() {
  const response = await fetch(config.qiniu.marketplaceCatalogUrl, {
    headers: {
      "User-Agent": "ai-drama-demo/1.0",
    },
  });
  const html = await response.text();
  if (!response.ok) {
    throw new Error(`Fetch marketplace catalog failed with ${response.status}`);
  }

  const rows = [];
  let cursor = 0;

  while (true) {
    const idMarker = "{\\\"id\\\":\\\"";
    const nameMarker = "\\\",\\\"name\\\":\\\"";
    const featuresMarker = "\\\"features\\\":[";
    const privateMarker = "],\\\"private\\\":";

    const idPos = html.indexOf(idMarker, cursor);
    if (idPos < 0) {
      break;
    }

    const idStart = idPos + idMarker.length;
    const idEnd = html.indexOf("\\\"", idStart);
    if (idEnd < 0) {
      break;
    }

    const namePos = html.indexOf(nameMarker, idEnd);
    if (namePos < 0) {
      cursor = idEnd + 1;
      continue;
    }
    const nameStart = namePos + nameMarker.length;
    const nameEnd = html.indexOf("\\\"", nameStart);
    if (nameEnd < 0) {
      break;
    }

    const featuresPos = html.indexOf(featuresMarker, nameEnd);
    if (featuresPos < 0) {
      cursor = nameEnd + 1;
      continue;
    }
    const featuresStart = featuresPos + featuresMarker.length;
    const featuresEnd = html.indexOf(privateMarker, featuresStart);
    if (featuresEnd < 0) {
      break;
    }

    const privateStart = featuresEnd + privateMarker.length;
    const privateEnd = html.indexOf(",", privateStart);
    if (privateEnd < 0) {
      break;
    }

    const modelId = html.slice(idStart, idEnd).replace(/\\"/g, "\"");
    const displayName = html.slice(nameStart, nameEnd).replace(/\\"/g, "\"");
    const features = parseStringList(html.slice(featuresStart, featuresEnd));
    const capabilities = inferMarketplaceCapabilities({ modelId, displayName, features });
    if (!capabilities.length) {
      cursor = privateEnd + 1;
      continue;
    }

    rows.push({
      modelId,
      displayName,
      provider: inferProvider(modelId),
      capabilities,
      source: "marketplace",
      metadata: {
        features,
        private: html.slice(privateStart, privateEnd) === "true",
        marketplaceUrl: config.qiniu.marketplaceCatalogUrl,
      },
    });

    cursor = privateEnd + 1;
  }

  return rows;
}

function dedupeCatalog(items) {
  const map = new Map();
  for (const item of items) {
    const previous = map.get(item.modelId);
    if (!previous) {
      map.set(item.modelId, item);
      continue;
    }

    map.set(item.modelId, {
      ...previous,
      ...item,
      capabilities: [...new Set([...(previous.capabilities || []), ...(item.capabilities || [])])],
      metadata: {
        ...(previous.metadata || {}),
        ...(item.metadata || {}),
      },
    });
  }
  return [...map.values()];
}

export async function refreshModelCatalog() {
  const client = new QiniuMaaSClient(config.qiniu);
  const liveModels = normalizeLiveModels(await client.listModels());
  const marketplaceModels = await fetchMarketplaceModels();
  const allModels = dedupeCatalog([...liveModels, ...marketplaceModels, ...curatedModels]);

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
