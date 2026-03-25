import {
  inferCapabilities,
  inferModelCategory,
  inferModelFamily,
  inferProvider,
  prettifyModelName,
} from "./providers/model-classification.js";

const OAS_SOURCE = "Qiniu OAS MCP 2026-03-24";

function makeSeedModel(modelId, overrides = {}) {
  const category = overrides.category || inferModelCategory(modelId);
  return {
    modelId,
    displayName: overrides.displayName || prettifyModelName(modelId),
    provider: overrides.provider || inferProvider(modelId),
    category,
    family: overrides.family || inferModelFamily(modelId, category),
    capabilities: overrides.capabilities || inferCapabilities(modelId, category),
    source: overrides.source || "seed",
    metadata: {
      verifiedFrom: overrides.verifiedFrom || OAS_SOURCE,
      ...(overrides.metadata || {}),
    },
  };
}

const textModels = [
  "openai/gpt-5.4",
  "openai/gpt-5.4-mini",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "deepseek-v3",
  "deepseek-v3-0324",
  "deepseek-r1",
  "deepseek-r1-0528",
  "deepseek/deepseek-v3.2-251201",
  "deepseek/deepseek-v3.2-exp",
  "deepseek/deepseek-v3.2-exp-thinking",
  "deepseek/deepseek-v3.1-terminus",
  "deepseek/deepseek-v3.1-terminus-thinking",
  "qwen3-max",
  "qwen3-max-preview",
  "qwen3-next-80b-a3b-instruct",
  "qwen3-next-80b-a3b-thinking",
  "qwen3-coder-480b-a35b-instruct",
  "qwen3-235b-a22b",
  "qwen3-235b-a22b-instruct-2507",
  "qwen3-235b-a22b-thinking-2507",
  "qwen3-32b",
  "qwen3-30b-a3b",
  "qwen-max-2025-01-25",
  "qwen-turbo",
  "qwen2.5-vl-7b-instruct",
  "qwen2.5-vl-72b-instruct",
  "qwen-vl-max-2025-01-25",
  "moonshotai/kimi-k2-0905",
  "moonshotai/kimi-k2-thinking",
  "kimi-k2",
  "z-ai/glm-4.7",
  "z-ai/glm-4.6",
  "glm-4.5",
  "glm-4.5-air",
  "MiniMax-M1",
  "minimax/minimax-m2",
  "minimax/minimax-m2.1",
  "minimax/minimax-m2.5",
  "meituan/longcat-flash-chat",
  "doubao-seed-1.6",
  "doubao-seed-1.6-flash",
  "doubao-seed-1.6-thinking",
  "doubao-1.5-pro-32k",
  "doubao-1.5-thinking-pro",
  "doubao-1.5-vision-pro",
  "mimo-v2-flash",
].map((modelId) => makeSeedModel(modelId));

const imageModels = [
  "gpt-image-1",
  "imagen-4",
  "gemini-2.5-flash-image",
  "gemini-3.0-pro-image-preview",
  "gemini-3.1-flash-image-preview",
  "minimax-image-01",
  "kling-v1",
  "kling-v1-5",
  "kling-v2",
  "kling-v2-1",
  "kling-v2-new",
  "kling-image-o1",
].map((modelId) => makeSeedModel(modelId, { category: "image" }));

const videoModels = [
  "veo-3.1-fast-generate-001",
  "veo-3.1-generate-001",
  "sora-2",
  "sora-2-pro",
  "kling-v2-1",
  "kling-v2-5-turbo",
  "kling-v2-6",
  "kling-video-o1",
  "kling-v3",
  "kling-v3-omni",
  "viduq3-turbo",
  "viduq3-pro",
].map((modelId) => makeSeedModel(modelId, { category: "video" }));

const speechModels = [
  makeSeedModel("tts", {
    displayName: "七牛 TTS",
    provider: "七牛云",
    verifiedFrom: "Qiniu OAS MCP 2026-03-24 / v1 voice/tts",
  }),
];

export function getSeedModelCatalog() {
  const map = new Map();
  for (const item of [...textModels, ...imageModels, ...videoModels, ...speechModels]) {
    const previous = map.get(item.modelId);
    if (!previous) {
      map.set(item.modelId, {
        ...item,
        metadata: {
          ...(item.metadata || {}),
          categories: [item.category],
          families: [item.family],
        },
      });
      continue;
    }

    const categories = [...new Set([...(previous.metadata?.categories || [previous.category]), item.category])];
    const families = [...new Set([...(previous.metadata?.families || [previous.family]), item.family])];
    map.set(item.modelId, {
      ...previous,
      ...item,
      category: categories.length === 1 ? categories[0] : "multi",
      family: families.length === 1 ? families[0] : "multiple",
      capabilities: [...new Set([...(previous.capabilities || []), ...(item.capabilities || [])])],
      metadata: {
        ...(previous.metadata || {}),
        ...(item.metadata || {}),
        categories,
        families,
      },
    });
  }
  return [...map.values()];
}
