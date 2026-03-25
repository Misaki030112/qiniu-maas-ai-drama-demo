import { extractJson, normalizeChatText } from "../utils.js";

export function buildTextRequest({ model, systemPrompt, userPrompt, temperature = 0.6 }) {
  return {
    method: "POST",
    endpoint: "/chat/completions",
    body: {
      model,
      temperature,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    },
    errorFallback: "Chat completion failed",
  };
}

export function resolveTextPayload({ model, payload }) {
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
