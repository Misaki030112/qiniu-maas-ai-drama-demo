import { extractJson, normalizeChatText } from "../utils.js";
import { buildImageRequest, resolveImagePayload } from "./image-runtime.js";
import { buildVideoTaskBody, parseVideoTaskResult } from "./video-runtime.js";

function normalizeProviderError(message, fallback) {
  const text = String(message || fallback || "").trim();
  const noChannelMatch = text.match(/no available channels for model\s+([^\s(]+)/i);
  if (noChannelMatch) {
    return `当前接入点未开通模型 ${noChannelMatch[1]}，请切换模型或更换接入点。原始错误：${text}`;
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

  async listModels() {
    const response = await fetch(`${this.baseUrl}/models`, {
      headers: this.headers(),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(normalizeProviderError(payload?.error?.message, `List models failed with ${response.status}`));
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
      throw new Error(normalizeProviderError(payload?.error?.message, `Chat completion failed with ${response.status}`));
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

    const response = await fetch(`${this.baseUrl}${request.endpoint}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(request.body),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(normalizeProviderError(
        payload?.error?.message,
        `Image generation failed with ${response.status}`,
      ));
    }

    return resolveImagePayload({
      baseUrl: this.baseUrl,
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
        payload?.error?.message,
        `Speech synthesis failed with ${response.status}`,
      ));
    }

    return {
      ...payload,
      buffer: Buffer.from(payload.data, "base64"),
      durationMs: Number(payload?.addition?.duration || 0),
    };
  }

  async createVideoTask({ model, prompt, imageBuffer, seconds = 5, aspectRatio = "16:9" }) {
    if (model.startsWith("veo-")) {
      const response = await fetch(`${this.baseUrl}/videos/generations`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          model,
          instances: [
            {
              prompt,
              image: imageBuffer
                ? {
                    bytesBase64Encoded: imageBuffer.toString("base64"),
                    mimeType: "image/png",
                  }
                : undefined,
              aspectRatio,
            },
          ],
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(normalizeProviderError(
          payload?.error?.message,
          `Video task creation failed with ${response.status}`,
        ));
      }
      return {
        provider: "veo",
        id: payload.id || payload.name,
        raw: payload,
      };
    }

    const body = buildVideoTaskBody({
      model,
      prompt,
      imageBuffer,
      seconds,
      aspectRatio,
    });

    const response = await fetch(`${this.baseUrl}/videos`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(normalizeProviderError(
        payload?.error?.message,
        `Video task creation failed with ${response.status}`,
      ));
    }
    return {
      provider: "openai",
      id: payload.id,
      raw: payload,
    };
  }

  async getVideoTask({ model, provider, id }) {
    const endpoint = provider === "veo"
      ? `${this.baseUrl}/videos/generations/${id}`
      : `${this.baseUrl}/videos/${id}`;
    const response = await fetch(endpoint, {
      headers: this.headers(),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(normalizeProviderError(
        payload?.error?.message,
        `Video task query failed with ${response.status}`,
      ));
    }

    return parseVideoTaskResult({ provider, payload });
  }
}
