function extractProviderMessage(payload) {
  return payload?.error?.message
    || payload?.detail?.msg
    || payload?.detail?.message
    || payload?.message
    || "";
}

function compactPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  try {
    return JSON.stringify(payload);
  } catch {
    return "";
  }
}

export function normalizeProviderError(message, fallback, payload = null, status = 0) {
  const text = String(message || fallback || "").trim();
  const noChannelMatch = text.match(/no available channels for model\s+([^\s(]+)/i);
  if (noChannelMatch) {
    return `当前接入点未开通模型 ${noChannelMatch[1]}，请切换模型或更换接入点。原始错误：${text}`;
  }
  if (/^kling model error$/i.test(text)) {
    return `上游 Kling 服务返回通用失败。HTTP ${status || "?"}，响应：${compactPayload(payload) || text}`;
  }
  if (/^generate image failed$/i.test(text)) {
    return `上游图片服务返回通用失败。HTTP ${status || "?"}，响应：${compactPayload(payload) || text}`;
  }
  return text || fallback;
}

function withAuthHeaders(apiKey, headers = {}) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    ...headers,
  };
}

export function createRuntimeContext(options) {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  return {
    apiKey: options.apiKey,
    baseUrl,
    rootBaseUrl: baseUrl.replace(/\/v1$/, ""),
    headers(extra = {}) {
      return withAuthHeaders(options.apiKey, extra);
    },
  };
}

function resolveUrl(runtime, request) {
  const root = request.baseUrlType === "root" ? runtime.rootBaseUrl : runtime.baseUrl;
  return `${root}${request.endpoint}`;
}

async function parseJsonResponse(response) {
  return response.json().catch(() => ({}));
}

export async function requestJson(runtime, request) {
  const response = await fetch(resolveUrl(runtime, request), {
    method: request.method || "GET",
    headers: runtime.headers(request.headers),
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(normalizeProviderError(
      extractProviderMessage(payload),
      request.errorFallback || `Request failed with ${response.status}`,
      payload,
      response.status,
    ));
  }
  return payload;
}

export async function downloadBinary(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download resource failed with ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
