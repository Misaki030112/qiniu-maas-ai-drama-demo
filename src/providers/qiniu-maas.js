import { buildImageRequest, resolveImagePayload } from "./image-runtime.js";
import { createRuntimeContext, requestJson } from "./runtime-http.js";
import { buildSpeechRequest, resolveSpeechPayload } from "./speech-runtime.js";
import { buildTextRequest, resolveTextPayload } from "./text-runtime.js";
import { buildVideoStatusRequest, buildVideoTaskRequest, parseVideoTaskResult } from "./video-runtime.js";

export class QiniuMaaSClient {
  constructor(options) {
    this.runtime = createRuntimeContext(options);
  }

  async chatJson({ model, systemPrompt, userPrompt, temperature = 0.6 }) {
    const request = buildTextRequest({ model, systemPrompt, userPrompt, temperature });
    const payload = await requestJson(this.runtime, request);
    return resolveTextPayload({ model, payload });
  }

  async generateImage({ model, prompt, aspectRatio = "16:9", referenceImages = [] }) {
    const request = buildImageRequest({
      model,
      prompt,
      aspectRatio,
      referenceImages,
    });
    const payload = await requestJson(this.runtime, request);
    return resolveImagePayload({
      runtime: this.runtime,
      payload,
    });
  }

  async synthesizeSpeech({ text, voiceType, speedRatio = 1.0 }) {
    const payload = await requestJson(this.runtime, buildSpeechRequest({ text, voiceType, speedRatio }));
    return resolveSpeechPayload(payload);
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
    const payload = await requestJson(this.runtime, request);
    return {
      provider: request.provider,
      id: payload.id || payload.request_id || payload.name,
      raw: payload,
    };
  }

  async getVideoTask({ provider, id }) {
    const payload = await requestJson(this.runtime, buildVideoStatusRequest({ provider, id }));
    return parseVideoTaskResult({ provider, payload });
  }
}
