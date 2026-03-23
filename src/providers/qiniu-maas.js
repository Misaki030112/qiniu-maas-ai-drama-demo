import OpenAI from "openai";
import { extractJson, normalizeChatText } from "../utils.js";

export class QiniuMaaSClient {
  constructor(options) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.openai = new OpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseUrl,
      timeout: 60000,
    });
  }

  headers() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  async chatJson({ model, systemPrompt, userPrompt, temperature = 0.6 }) {
    const response = await this.openai.chat.completions.create({
      model,
      temperature,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const rawText = normalizeChatText(response.choices[0]?.message?.content);
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
      usage: response.usage || null,
      responseId: response.id || null,
    };
  }

  async generateImage({ model, prompt }) {
    const response = await fetch(`${this.baseUrl}/images/generations`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model,
        prompt,
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(
        payload?.error?.message || `Image generation failed with ${response.status}`,
      );
    }

    const item = payload?.data?.[0];
    if (item?.b64_json) {
      return {
        ...payload,
        buffer: Buffer.from(item.b64_json, "base64"),
      };
    }

    if (item?.url) {
      const download = await fetch(item.url);
      const arrayBuffer = await download.arrayBuffer();
      return {
        ...payload,
        buffer: Buffer.from(arrayBuffer),
      };
    }

    throw new Error("Image response does not contain b64_json or url.");
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
      throw new Error(
        payload?.error?.message || `Speech synthesis failed with ${response.status}`,
      );
    }

    return {
      ...payload,
      buffer: Buffer.from(payload.data, "base64"),
      durationMs: Number(payload?.addition?.duration || 0),
    };
  }
}
