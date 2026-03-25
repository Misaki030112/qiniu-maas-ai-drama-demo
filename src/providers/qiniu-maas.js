import { extractJson, normalizeChatText } from "../utils.js";
import { buildImageRequest, resolveImagePayload } from "./image-runtime.js";
import { buildVideoTaskRequest, parseVideoTaskResult } from "./video-runtime.js";

function extractProviderMessage(payload) {
  return payload?.error?.message
    || payload?.detail?.msg
    || payload?.detail?.message
    || payload?.message
    || "";
}

function normalizeProviderError(message, fallback) {
  const text = String(message || fallback || "").trim();
  const noChannelMatch = text.match(/no available channels for model\s+([^\s(]+)/i);
  if (noChannelMatch) {
    return `当前接入点未开通模型 ${noChannelMatch[1]}，请切换模型或更换接入点。原始错误：${text}`;
  }
  if (/^kling model error$/i.test(text)) {
    return `上游 Kling 服务返回通用失败，当前无法从响应中判断更细原因。原始错误：${text}`;
  }
  if (/^generate image failed$/i.test(text)) {
    return `上游图片服务返回通用失败，当前无法从响应中判断更细原因。原始错误：${text}`;
  }
  return text || fallback;
}

export class QiniuMaaSClient {
  constructor(options) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
  }

  headers() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  rootBaseUrl() {
    return this.baseUrl.replace(/\/v1$/, "");
  }

  async listModels() {
    const response = await fetch(`${this.baseUrl}/models`, {
      headers: this.headers(),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(normalizeProviderError(extractProviderMessage(payload), `List models failed with ${response.status}`));
    }
    return payload.data || [];
  }

  async chatJson({ model, systemPrompt, userPrompt, temperature = 0.6 }) {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model,
        temperature,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(normalizeProviderError(extractProviderMessage(payload), `Chat completion failed with ${response.status}`));
    }

    const rawText = normalizeChatText(payload?.choices?.[0]?.message?.content);
    let parsed;
    try {
      parsed = extractJson(rawText);
    } catch (error) {
      error.message = `${error.message}\n--- RAW MODEL OUTPUT ---\n${rawText}`;
      throw error;
    }
    return {
      model,
      rawText,
      parsed,
      usage: payload?.usage || null,
      responseId: payload?.id || null,
    };
  }

  async generateImage({ model, prompt, aspectRatio = "16:9", referenceImages = [] }) {
    const request = buildImageRequest({
      model,
      prompt,
      aspectRatio,
      referenceImages,
    });

    const requestBaseUrl = request.useRootBaseUrl ? this.rootBaseUrl() : this.baseUrl;
    const response = await fetch(`${requestBaseUrl}${request.endpoint}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(request.body),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(normalizeProviderError(
        extractProviderMessage(payload),
        `Image generation failed with ${response.status}`,
      ));
    }

    return resolveImagePayload({
      baseUrl: this.baseUrl,
      rootBaseUrl: this.rootBaseUrl(),
      headers: this.headers(),
      payload,
    });
  }

  async synthesizeSpeech({ text, voiceType, speedRatio = 1.0 }) {
    const response = await fetch(`${this.baseUrl}/voice/tts`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        audio: {
          voice_type: voiceType,
          encoding: "mp3",
          speed_ratio: speedRatio,
        },
        request: {
          text,
        },
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(normalizeProviderError(
        extractProviderMessage(payload),
        `Speech synthesis failed with ${response.status}`,
      ));
    }

    return {
      ...payload,
      buffer: Buffer.from(payload.data, "base64"),
      durationMs: Number(payload?.addition?.duration || 0),
    };
  }

  async createVideoTask({
    model,
    prompt,
    imageBuffer,
    lastFrameBuffer,
    referenceImages = [],
    seconds = 5,
    aspectRatio = "16:9",
    mode = "",
    enableAudio = false,
    resolution = "",
  }) {
    const request = buildVideoTaskRequest({
      model,
      prompt,
      imageBuffer,
      lastFrameBuffer,
      referenceImages,
      seconds,
      aspectRatio,
      mode,
      enableAudio,
      resolution,
    });

    const requestBaseUrl = request.provider === "vidu" ? this.rootBaseUrl() : this.baseUrl;
    const response = await fetch(`${requestBaseUrl}${request.endpoint}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(request.body),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(normalizeProviderError(
        extractProviderMessage(payload),
        `Video task creation failed with ${response.status}`,
      ));
    }
    return {
      provider: request.provider,
      id: payload.id || payload.request_id || payload.name,
      raw: payload,
    };
  }

  async getVideoTask({ model, provider, id }) {
    const endpoint = provider === "veo"
      ? `${this.baseUrl}/videos/generations/${id}`
      : provider === "vidu"
        ? `${this.rootBaseUrl()}/queue/fal-ai/vidu/requests/${id}/status`
        : `${this.baseUrl}/videos/${id}`;
    const response = await fetch(endpoint, {
      headers: this.headers(),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(normalizeProviderError(
        extractProviderMessage(payload),
        `Video task query failed with ${response.status}`,
      ));
    }

    return parseVideoTaskResult({ provider, payload });
  }
}
