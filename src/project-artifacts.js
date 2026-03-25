import { databaseSchema, query } from "./db.js";

const schema = databaseSchema();

function nowIso() {
  return new Date().toISOString();
}

function parseJsonValue(value, fallback) {
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

function rowToArtifact(row) {
  if (!row) {
    return null;
  }
  return {
    projectId: row.project_id,
    artifactPath: row.artifact_path,
    stage: row.stage || "",
    contentType: row.content_type || "application/octet-stream",
    storageProvider: row.storage_provider || "",
    publicUrl: row.public_url || "",
    metadata: parseJsonValue(row.metadata, {}),
    bodyJson: parseJsonValue(row.body_json, null),
    bodyText: row.body_text ?? null,
    sizeBytes: Number(row.size_bytes || 0),
    createdAt: row.created_at?.toISOString?.() || row.created_at || nowIso(),
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at || nowIso(),
  };
}

async function upsertProjectArtifact({
  projectId,
  artifactPath,
  stage = "",
  contentType,
  storageProvider,
  publicUrl = "",
  metadata = {},
  bodyJson = null,
  bodyText = null,
  sizeBytes = 0,
}) {
  const result = await query(
    `
      INSERT INTO ${schema}.project_artifacts (
        project_id,
        artifact_path,
        stage,
        content_type,
        storage_provider,
        public_url,
        metadata,
        body_json,
        body_text,
        size_bytes,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, NOW(), NOW())
      ON CONFLICT (project_id, artifact_path)
      DO UPDATE SET
        stage = EXCLUDED.stage,
        content_type = EXCLUDED.content_type,
        storage_provider = EXCLUDED.storage_provider,
        public_url = EXCLUDED.public_url,
        metadata = EXCLUDED.metadata,
        body_json = EXCLUDED.body_json,
        body_text = EXCLUDED.body_text,
        size_bytes = EXCLUDED.size_bytes,
        updated_at = NOW()
      RETURNING *
    `,
    [
      projectId,
      artifactPath,
      stage,
      contentType,
      storageProvider,
      publicUrl,
      JSON.stringify(metadata || {}),
      bodyJson === null ? null : JSON.stringify(bodyJson),
      bodyText,
      Number(sizeBytes || 0),
    ],
  );
  return rowToArtifact(result.rows[0]);
}

export async function saveProjectJsonArtifact({ projectId, artifactPath, value, stage = "", metadata = {} }) {
  return upsertProjectArtifact({
    projectId,
    artifactPath,
    stage,
    contentType: "application/json; charset=utf-8",
    storageProvider: "database",
    metadata,
    bodyJson: value,
    bodyText: null,
    sizeBytes: Buffer.byteLength(JSON.stringify(value || {}), "utf8"),
  });
}

export async function saveProjectTextArtifact({ projectId, artifactPath, text, stage = "", metadata = {} }) {
  const content = String(text || "");
  return upsertProjectArtifact({
    projectId,
    artifactPath,
    stage,
    contentType: "text/plain; charset=utf-8",
    storageProvider: "database",
    metadata,
    bodyJson: null,
    bodyText: content,
    sizeBytes: Buffer.byteLength(content, "utf8"),
  });
}

export async function saveProjectBinaryArtifact({
  projectId,
  artifactPath,
  contentType,
  publicUrl,
  storageProvider,
  metadata = {},
  stage = "",
  sizeBytes = 0,
}) {
  return upsertProjectArtifact({
    projectId,
    artifactPath,
    stage,
    contentType,
    storageProvider,
    publicUrl,
    metadata,
    bodyJson: null,
    bodyText: null,
    sizeBytes,
  });
}

export async function readProjectArtifact(projectId, artifactPath) {
  const result = await query(
    `
      SELECT *
      FROM ${schema}.project_artifacts
      WHERE project_id = $1
        AND artifact_path = $2
      LIMIT 1
    `,
    [projectId, artifactPath],
  );
  return rowToArtifact(result.rows[0] || null);
}

export async function readProjectJsonArtifact(projectId, artifactPath) {
  return (await readProjectArtifact(projectId, artifactPath))?.bodyJson || null;
}

export async function readProjectTextArtifact(projectId, artifactPath) {
  const artifact = await readProjectArtifact(projectId, artifactPath);
  if (!artifact) {
    return "";
  }
  if (artifact.bodyText !== null) {
    return artifact.bodyText;
  }
  if (artifact.bodyJson !== null) {
    return JSON.stringify(artifact.bodyJson, null, 2);
  }
  return "";
}

export async function readProjectArtifactPublicUrl(projectId, artifactPath) {
  return (await readProjectArtifact(projectId, artifactPath))?.publicUrl || "";
}

export async function projectArtifactExists(projectId, itemOrPath) {
  const artifactPath = typeof itemOrPath === "string" ? itemOrPath : itemOrPath?.path || itemOrPath?.imagePath || "";
  const publicUrl = typeof itemOrPath === "object" ? itemOrPath?.publicUrl || "" : "";
  if (publicUrl) {
    return true;
  }
  if (!artifactPath) {
    return false;
  }
  return Boolean(await readProjectArtifact(projectId, artifactPath));
}

export async function appendProjectLog(projectId, stage, payload) {
  const result = await query(
    `
      INSERT INTO ${schema}.project_logs (
        project_id,
        stage,
        payload,
        created_at
      )
      VALUES ($1, $2, $3::jsonb, NOW())
      RETURNING *
    `,
    [projectId, stage, JSON.stringify(payload || {})],
  );
  return {
    id: result.rows[0].id,
    projectId: result.rows[0].project_id,
    stage: result.rows[0].stage,
    payload: parseJsonValue(result.rows[0].payload, {}),
    createdAt: result.rows[0].created_at?.toISOString?.() || result.rows[0].created_at || nowIso(),
  };
}

export async function listProjectLogs(projectId, limit = 200) {
  const result = await query(
    `
      SELECT id, project_id, stage, payload, created_at
      FROM ${schema}.project_logs
      WHERE project_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2
    `,
    [projectId, Math.max(1, Number(limit || 200))],
  );
  return [...result.rows]
    .reverse()
    .map((row) => parseJsonValue(row.payload, {}))
    .filter(Boolean);
}
