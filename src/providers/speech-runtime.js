export function buildSpeechRequest({ text, voiceType, speedRatio = 1.0 }) {
  return {
    method: "POST",
    endpoint: "/voice/tts",
    body: {
      audio: {
        voice_type: voiceType,
        encoding: "mp3",
        speed_ratio: speedRatio,
      },
      request: {
        text,
      },
    },
    errorFallback: "Speech synthesis failed",
  };
}

export function resolveSpeechPayload(payload) {
  return {
    ...payload,
    buffer: Buffer.from(payload.data, "base64"),
    durationMs: Number(payload?.addition?.duration || 0),
  };
}
