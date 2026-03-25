import { appendProjectLog } from "./project-artifacts.js";

function nowIso() {
  return new Date().toISOString();
}

function formatDuration(durationMs) {
  if (durationMs === undefined || durationMs === null) {
    return "";
  }
  return `${durationMs}ms`;
}

function formatConsoleLine(entry) {
  const parts = [
    `[pipeline]`,
    entry.projectId,
    entry.stage,
    entry.step || entry.event || "event",
    entry.status,
  ];
  if (entry.model) {
    parts.push(`model=${entry.model}`);
  }
  if (entry.provider) {
    parts.push(`provider=${entry.provider}`);
  }
  if (entry.durationMs !== undefined) {
    parts.push(`duration=${formatDuration(entry.durationMs)}`);
  }
  if (entry.message) {
    parts.push(entry.message);
  }
  if (entry.error) {
    parts.push(`error=${entry.error}`);
  }
  return parts.filter(Boolean).join(" | ");
}

function summarizeLargeString(value) {
  const text = String(value || "");
  if (/^data:[^;]+;base64,/i.test(text)) {
    return `[data-uri omitted, length=${text.length}]`;
  }
  if (!/\s/.test(text) && text.length > 512) {
    return `[large-token omitted, length=${text.length}]`;
  }
  if (text.length > 4000) {
    return `${text.slice(0, 4000)}...[truncated ${text.length - 4000} chars]`;
  }
  return text;
}

function sanitizeLogValue(value) {
  if (value === null || value === undefined) {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return `[buffer omitted, bytes=${value.length}]`;
  }
  if (typeof value === "string") {
    return summarizeLargeString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogValue(item));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeLogValue(item)]),
    );
  }
  return value;
}

export async function createPipelineLogger({ projectId, stage }) {
  async function log(entry) {
    const payload = sanitizeLogValue({
      ts: nowIso(),
      projectId,
      stage,
      ...entry,
    });
    await appendProjectLog(projectId, stage, payload);
    console.log(formatConsoleLine(payload));
    return payload;
  }

  async function measure({ step, event = "ai", model, provider, meta = {} }, fn) {
    const startedAt = Date.now();
    await log({
      event,
      step,
      status: "start",
      model,
      provider,
      ...meta,
    });

    try {
      const result = await fn();
      await log({
        event,
        step,
        status: "done",
        model,
        provider,
        durationMs: Date.now() - startedAt,
        ...meta,
      });
      return result;
    } catch (error) {
      await log({
        event,
        step,
        status: "error",
        model,
        provider,
        durationMs: Date.now() - startedAt,
        error: error.message,
        ...meta,
      });
      throw error;
    }
  }

  return {
    logPath: "",
    log,
    measure,
  };
}
