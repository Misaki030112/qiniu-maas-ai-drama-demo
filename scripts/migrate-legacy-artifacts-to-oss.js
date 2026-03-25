import fs from "node:fs/promises";
import { databaseSchema, ensureSchema, getPool } from "../src/db.js";
import { persistProjectArtifact } from "../src/object-storage.js";
import { saveProjectJsonArtifact, saveProjectTextArtifact } from "../src/project-artifacts.js";

const schema = databaseSchema();

function parseJsonValue(value, fallback = {}) {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
}

function normalizeMetadata(metadata) {
  const next = { ...(metadata || {}) };
  delete next.legacyLocalPath;
  return {
    ...next,
    migratedFrom: "legacy-local",
    migratedAt: new Date().toISOString(),
  };
}

async function migrateStructuredArtifact(row) {
  const legacyLocalPath = row.metadata?.legacyLocalPath || "";
  const content = await fs.readFile(legacyLocalPath, "utf8");
  if (row.content_type.includes("json")) {
    await saveProjectJsonArtifact({
      projectId: row.project_id,
      artifactPath: row.artifact_path,
      value: JSON.parse(content),
      stage: row.stage || "",
      metadata: normalizeMetadata(row.metadata),
    });
    return "database-json";
  }
  await saveProjectTextArtifact({
    projectId: row.project_id,
    artifactPath: row.artifact_path,
    text: content,
    stage: row.stage || "",
    metadata: normalizeMetadata(row.metadata),
  });
  return "database-text";
}

async function migrateBinaryArtifact(row) {
  const legacyLocalPath = row.metadata?.legacyLocalPath || "";
  const buffer = await fs.readFile(legacyLocalPath);
  const saved = await persistProjectArtifact({
    projectId: row.project_id,
    absolutePath: legacyLocalPath,
    relativePath: row.artifact_path,
    buffer,
    contentType: row.content_type,
    stage: row.stage || "",
    metadata: normalizeMetadata(row.metadata),
  });
  return saved.storageProvider;
}

async function main() {
  await ensureSchema();
  const pool = await getPool();
  const result = await pool.query(
    `
      SELECT project_id, artifact_path, stage, content_type, metadata
      FROM ${schema}.project_artifacts
      WHERE storage_provider = 'legacy-local'
      ORDER BY project_id, artifact_path
    `,
  );

  const summary = {
    total: result.rows.length,
    migratedToOss: 0,
    migratedToDatabase: 0,
    skippedMissingFiles: [],
  };

  for (const rawRow of result.rows) {
    const row = {
      ...rawRow,
      metadata: parseJsonValue(rawRow.metadata, {}),
    };
    const legacyLocalPath = row.metadata?.legacyLocalPath || "";
    if (!legacyLocalPath) {
      summary.skippedMissingFiles.push({
        projectId: row.project_id,
        artifactPath: row.artifact_path,
        reason: "missing-legacy-path",
      });
      continue;
    }

    try {
      await fs.access(legacyLocalPath);
    } catch {
      summary.skippedMissingFiles.push({
        projectId: row.project_id,
        artifactPath: row.artifact_path,
        reason: "file-not-found",
      });
      continue;
    }

    if (
      row.content_type.startsWith("image/")
      || row.content_type.startsWith("video/")
      || row.content_type.startsWith("audio/")
      || row.content_type === "application/octet-stream"
    ) {
      await migrateBinaryArtifact(row);
      summary.migratedToOss += 1;
      continue;
    }

    await migrateStructuredArtifact(row);
    summary.migratedToDatabase += 1;
  }

  console.log(JSON.stringify(summary, null, 2));
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
