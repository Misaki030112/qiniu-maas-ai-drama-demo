import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { saveProjectBinaryArtifact, readProjectArtifact } from "./project-artifacts.js";
import { ensureDir } from "./utils.js";

const mimeTypes = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".srt": "text/plain; charset=utf-8",
};

function truthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function trimSlash(value = "") {
  return String(value || "").replace(/^\/+|\/+$/g, "");
}

function normalizeKeySegment(value) {
  return String(value || "").replaceAll("\\", "/");
}

function canonicalizeOssHeaders(headers) {
  return Object.entries(headers)
    .filter(([key, value]) => /^x-oss-/i.test(key) && value !== "" && value !== undefined && value !== null)
    .map(([key, value]) => [key.toLowerCase().trim(), String(value).trim()])
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value}\n`)
    .join("");
}

function buildObjectKey(projectId, relativePath) {
  const prefix = trimSlash(config.objectStorage.aliyun.prefix || "ai-drama-demo/projects");
  const parts = [
    prefix,
    normalizeKeySegment(projectId),
    ...String(relativePath || "")
      .split("/")
      .filter(Boolean)
      .map(normalizeKeySegment),
  ].filter(Boolean);
  return parts.join("/");
}

function encodeObjectKeyForUrl(objectKey) {
  return String(objectKey || "")
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function buildAliyunBaseUrl() {
  const publicBaseUrl = trimSlash(config.objectStorage.aliyun.publicBaseUrl);
  if (publicBaseUrl) {
    return publicBaseUrl.startsWith("http") ? publicBaseUrl : `https://${publicBaseUrl}`;
  }
  const { bucket, endpoint } = config.objectStorage.aliyun;
  if (!bucket || !endpoint) {
    return "";
  }
  return `https://${bucket}.${endpoint}`;
}

function isAliyunOssEnabled() {
  const { accessKeyId, accessKeySecret, bucket, endpoint } = config.objectStorage.aliyun;
  return truthy(config.objectStorage.enabled) && Boolean(accessKeyId && accessKeySecret && bucket && endpoint);
}

function assertAliyunOssEnabled() {
  if (!isAliyunOssEnabled()) {
    throw new Error("对象存储未配置完成，当前版本要求二进制工件持久化到 OSS。");
  }
}

async function uploadToAliyunOss({ projectId, relativePath, buffer, contentType }) {
  const { accessKeyId, accessKeySecret, bucket, objectAcl } = config.objectStorage.aliyun;
  const baseUrl = buildAliyunBaseUrl();
  if (!baseUrl) {
    throw new Error("阿里云 OSS 未配置可用 endpoint 或 public base URL。");
  }

  const objectKey = buildObjectKey(projectId, relativePath);
  const encodedObjectKey = encodeObjectKeyForUrl(objectKey);
  const date = new Date().toUTCString();
  const ossHeaders = {};
  if (objectAcl) {
    ossHeaders["x-oss-object-acl"] = objectAcl;
  }
  const canonicalizedOssHeaders = canonicalizeOssHeaders(ossHeaders);
  const canonicalizedResource = `/${bucket}/${objectKey}`;
  const stringToSign = `PUT\n\n${contentType}\n${date}\n${canonicalizedOssHeaders}${canonicalizedResource}`;
  const signature = crypto
    .createHmac("sha1", accessKeySecret)
    .update(stringToSign, "utf8")
    .digest("base64");

  const response = await fetch(`${baseUrl}/${encodedObjectKey}`, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      Date: date,
      Authorization: `OSS ${accessKeyId}:${signature}`,
      ...ossHeaders,
    },
    body: buffer,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`上传阿里云 OSS 失败: ${response.status}${errorText ? ` ${errorText}` : ""}`);
  }

  return {
    objectKey,
    publicUrl: `${baseUrl}/${encodedObjectKey}`,
  };
}

export function contentTypeFromFilePath(filePath) {
  return mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

export function buildArtifactUrl(projectId, relativePath, generatedAt = "") {
  if (!relativePath) {
    return "";
  }
  return `/api/projects/${projectId}/artifacts/${relativePath}${generatedAt ? `?v=${encodeURIComponent(generatedAt)}` : ""}`;
}

export function resolveArtifactPublicUrl({ projectId, relativePath, generatedAt = "", publicUrl = "" }) {
  if (publicUrl) {
    return publicUrl;
  }
  if (!relativePath || !config.appBaseUrl) {
    return "";
  }
  return new URL(buildArtifactUrl(projectId, relativePath, generatedAt), config.appBaseUrl).href;
}

export async function persistProjectArtifact({
  projectId,
  absolutePath,
  relativePath,
  buffer,
  contentType = contentTypeFromFilePath(absolutePath || relativePath),
  generatedAt = "",
  metadata = {},
  stage = "",
}) {
  assertAliyunOssEnabled();
  const upload = await uploadToAliyunOss({ projectId, relativePath, buffer, contentType });
  const artifact = await saveProjectBinaryArtifact({
    projectId,
    artifactPath: relativePath,
    contentType,
    publicUrl: upload.publicUrl,
    storageProvider: "aliyun-oss",
    sizeBytes: buffer.length,
    stage,
    metadata: {
      ...metadata,
      generatedAt: generatedAt || metadata.generatedAt || "",
      objectKey: upload.objectKey,
      originalPath: absolutePath || "",
    },
  });

  return {
    path: relativePath,
    url: buildArtifactUrl(projectId, relativePath, generatedAt),
    publicUrl: resolveArtifactPublicUrl({
      projectId,
      relativePath,
      generatedAt,
      publicUrl: artifact.publicUrl,
    }),
    storageProvider: artifact.storageProvider,
    contentType,
  };
}

export async function readProjectArtifactBuffer({ projectId, relativePath, publicUrl = "" }) {
  const artifact = publicUrl ? null : await readProjectArtifact(projectId, relativePath);
  const effectiveContentType = artifact?.contentType || contentTypeFromFilePath(relativePath);

  if (artifact && artifact.bodyJson !== null) {
    return {
      buffer: Buffer.from(`${JSON.stringify(artifact.bodyJson, null, 2)}\n`, "utf8"),
      contentType: artifact.contentType || "application/json; charset=utf-8",
    };
  }
  if (artifact && artifact.bodyText !== null) {
    return {
      buffer: Buffer.from(artifact.bodyText, "utf8"),
      contentType: artifact.contentType || "text/plain; charset=utf-8",
    };
  }

  const url = publicUrl || artifact?.publicUrl || "";
  if (!url) {
    throw new Error(`未找到工件: ${projectId}/${relativePath}`);
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下载工件失败: ${response.status}`);
  }
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || effectiveContentType,
  };
}

export async function materializeProjectArtifact({
  projectId,
  relativePath,
  targetPath,
  publicUrl = "",
}) {
  try {
    await fs.access(targetPath);
    return targetPath;
  } catch {}

  const { buffer } = await readProjectArtifactBuffer({
    projectId,
    relativePath,
    publicUrl,
  });
  await ensureDir(path.dirname(targetPath));
  await fs.writeFile(targetPath, buffer);
  return targetPath;
}
