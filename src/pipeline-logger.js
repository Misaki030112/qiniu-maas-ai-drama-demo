import fs from "node:fs/promises";
import path from "node:path";

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

export async function createPipelineLogger({ projectId, stage, outputDir }) {
  const logDir = path.join(outputDir, "00-logs");
  const logPath = path.join(logDir, "pipeline.jsonl");
  await fs.mkdir(logDir, { recursive: true });

  async function log(entry) {
    const payload = {
      ts: nowIso(),
      projectId,
      stage,
      ...entry,
    };
    await fs.appendFile(logPath, `${JSON.stringify(payload)}\n`);
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
    logPath,
    log,
    measure,
  };
}
