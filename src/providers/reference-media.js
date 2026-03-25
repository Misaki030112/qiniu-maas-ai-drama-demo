import { config } from "../config.js";

export function isPublicHttpUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) {
      return false;
    }
    const host = url.hostname.toLowerCase();
    return !["localhost", "127.0.0.1", "0.0.0.0"].includes(host);
  } catch {
    return false;
  }
}

export function toPublicReferenceUrl(item) {
  if (!item) {
    return "";
  }
  if (item.publicUrl && isPublicHttpUrl(item.publicUrl)) {
    return item.publicUrl;
  }
  if (item.url && isPublicHttpUrl(item.url)) {
    return item.url;
  }
  if (item.url && item.url.startsWith("/") && config.appBaseUrl) {
    const resolved = new URL(item.url, config.appBaseUrl).href;
    if (isPublicHttpUrl(resolved)) {
      return resolved;
    }
  }
  return "";
}

export function toPublicOrInlineReference(item) {
  if (!item) {
    return "";
  }
  const publicUrl = toPublicReferenceUrl(item);
  if (publicUrl) {
    return publicUrl;
  }
  if (item.dataUri) {
    return item.dataUri;
  }
  if (item.base64) {
    return `data:image/png;base64,${item.base64}`;
  }
  return "";
}
