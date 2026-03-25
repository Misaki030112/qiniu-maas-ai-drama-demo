import { buildDefaultImageRequest } from "./image/default.js";
import { buildGeminiImageRequest, isGeminiImageModel } from "./image/gemini.js";
import {
  buildKlingImageRequest,
  isKlingImageModel,
  isKlingOmniImageModel,
  supportsKlingImageEdit,
} from "./image/kling.js";
import { downloadBinary, requestJson } from "./runtime-http.js";
import { toPublicReferenceUrl } from "./reference-media.js";

export function explainImageReferenceConstraint({ model, referenceImages = [] }) {
  const refs = referenceImages.filter(Boolean);
  if (refs.length <= 1) {
    return "";
  }

  if (isKlingOmniImageModel(model) || isGeminiImageModel(model) || !isKlingImageModel(model)) {
    return "";
  }

  if (!supportsKlingImageEdit(model)) {
    return `当前模型 ${model} 不支持多参考图共同生图。你选了 ${refs.length} 个参考，但它只能实际使用 1 个。`;
  }

  const classified = refs.map((item) => ({
    ...item,
    publicUrl: toPublicReferenceUrl(item),
  }));
  const subjectCount = classified.filter((item) => {
    const refKind = item.refKind || item.kind || "subject";
    return refKind !== "scene" && refKind !== "style";
  }).length;
  const sceneCount = classified.filter((item) => (item.refKind || item.kind || "subject") === "scene").length;
  const styleCount = classified.filter((item) => (item.refKind || item.kind || "subject") === "style").length;

  if (subjectCount >= 2) {
    return "";
  }

  if (sceneCount || styleCount) {
    return `当前模型 ${model} 在七牛接口下走多图编辑时，至少需要 2 张主体参考图。你现在选择的是 ${subjectCount} 张主体图，${sceneCount} 张场景图，${styleCount} 张风格图；如果继续生成，就会丢掉一部分参考图。`;
  }

  return `当前模型 ${model} 需要至少 2 张主体参考图才能走多图编辑。你现在选择的参考图数量不足。`;
}

export function buildImageRequest({ model, prompt, aspectRatio = "16:9", referenceImages = [] }) {
  if (isGeminiImageModel(model)) {
    return buildGeminiImageRequest({ model, prompt, aspectRatio, referenceImages });
  }
  if (isKlingImageModel(model)) {
    return buildKlingImageRequest({ model, prompt, aspectRatio, referenceImages });
  }
  if (referenceImages.filter(Boolean).length) {
    throw new Error(`当前模型 ${model} 暂未接入图生图，请使用 Gemini 或 Kling。`);
  }
  return buildDefaultImageRequest({ model, prompt });
}

async function getImageTask(runtime, taskId) {
  return requestJson(runtime, {
    method: "GET",
    endpoint: `/images/tasks/${taskId}`,
    errorFallback: "Image task query failed",
  });
}

async function getKlingImageTask(runtime, taskId) {
  return requestJson(runtime, {
    method: "GET",
    baseUrlType: "root",
    endpoint: `/queue/fal-ai/kling-image/requests/${taskId}/status`,
    errorFallback: "Kling image task query failed",
  });
}

async function pollImageTask(runtime, taskId) {
  while (true) {
    const payload = await getImageTask(runtime, taskId);
    const status = String(payload?.status || "").toLowerCase();
    if (["succeed", "success", "completed"].includes(status)) {
      return payload;
    }
    if (["failed", "error", "cancelled"].includes(status)) {
      throw new Error(payload?.status_message || `Image task failed: ${status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

async function pollKlingImageTask(runtime, taskId) {
  while (true) {
    const payload = await getKlingImageTask(runtime, taskId);
    const status = String(payload?.status || "").toUpperCase();
    if (["COMPLETED", "SUCCEEDED", "SUCCESS"].includes(status)) {
      return payload;
    }
    if (["FAILED", "ERROR", "CANCELLED"].includes(status)) {
      throw new Error(payload?.detail?.message || payload?.status_message || `Kling image task failed: ${status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

export async function resolveImagePayload({ runtime, payload }) {
  const item = payload?.data?.[0];
  if (item?.b64_json) {
    return {
      ...payload,
      buffer: Buffer.from(item.b64_json, "base64"),
    };
  }

  if (item?.url) {
    return {
      ...payload,
      buffer: await downloadBinary(item.url),
    };
  }

  const queueItem = payload?.result?.images?.[0] || payload?.images?.[0];
  if (queueItem?.url) {
    return {
      ...payload,
      buffer: await downloadBinary(queueItem.url),
    };
  }

  const taskId = payload?.task_id || payload?.id;
  if (taskId) {
    const taskResult = await pollImageTask(runtime, taskId);
    return resolveImagePayload({
      runtime,
      payload: {
        ...taskResult,
        task_id: taskId,
      },
    });
  }

  const queueTaskId = payload?.request_id;
  if (queueTaskId) {
    const taskResult = await pollKlingImageTask(runtime, queueTaskId);
    return resolveImagePayload({
      runtime,
      payload: {
        ...taskResult,
        request_id: queueTaskId,
      },
    });
  }

  throw new Error("Image response does not contain b64_json, url, task_id, or request_id.");
}
