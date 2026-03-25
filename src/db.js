import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ quiet: true });

const { Pool } = pg;

let pool;
let schemaReadyPromise;

function databaseConfig() {
  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || "ai_drama_demo",
    max: 10,
    idleTimeoutMillis: 30000,
  };
}

export function databaseSchema() {
  return process.env.DB_SCHEMA || "ai_drama_demo";
}

function createSchemaSql(schema) {
  return `
CREATE SCHEMA IF NOT EXISTS ${schema};

CREATE TABLE IF NOT EXISTS ${schema}.projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  story_text TEXT NOT NULL DEFAULT '',
  model_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  stage_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  current_job_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ${schema}.jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES ${schema}.projects(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  progress_text TEXT NULL,
  error_message TEXT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ NULL,
  finished_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_project_created_at
  ON ${schema}.jobs(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ${schema}.project_artifacts (
  project_id TEXT NOT NULL REFERENCES ${schema}.projects(id) ON DELETE CASCADE,
  artifact_path TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  storage_provider TEXT NOT NULL DEFAULT 'database',
  public_url TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  body_json JSONB NULL,
  body_text TEXT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, artifact_path)
);

CREATE INDEX IF NOT EXISTS idx_project_artifacts_project_stage
  ON ${schema}.project_artifacts(project_id, stage, updated_at DESC);

CREATE TABLE IF NOT EXISTS ${schema}.project_logs (
  id BIGSERIAL PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES ${schema}.projects(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_logs_project_created_at
  ON ${schema}.project_logs(project_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS ${schema}.model_catalog (
  model_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  provider TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'text',
  family TEXT NOT NULL DEFAULT 'chat-completions',
  capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  source TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ${schema}.model_catalog
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'text';

ALTER TABLE ${schema}.model_catalog
  ADD COLUMN IF NOT EXISTS family TEXT NOT NULL DEFAULT 'chat-completions';

COMMENT ON SCHEMA ${schema} IS '点众 AI 真人剧 Demo 业务数据';

COMMENT ON TABLE ${schema}.projects IS '项目主表';
COMMENT ON COLUMN ${schema}.projects.id IS '项目ID';
COMMENT ON COLUMN ${schema}.projects.name IS '项目名称';
COMMENT ON COLUMN ${schema}.projects.story_text IS '项目当前故事文本';
COMMENT ON COLUMN ${schema}.projects.model_config IS '项目当前模型配置';
COMMENT ON COLUMN ${schema}.projects.stage_state IS '项目阶段状态';
COMMENT ON COLUMN ${schema}.projects.current_job_id IS '当前执行中的任务ID';
COMMENT ON COLUMN ${schema}.projects.created_at IS '创建时间';
COMMENT ON COLUMN ${schema}.projects.updated_at IS '更新时间';

COMMENT ON TABLE ${schema}.jobs IS '阶段异步任务表';
COMMENT ON COLUMN ${schema}.jobs.id IS '任务ID';
COMMENT ON COLUMN ${schema}.jobs.project_id IS '所属项目ID';
COMMENT ON COLUMN ${schema}.jobs.stage IS '任务对应阶段';
COMMENT ON COLUMN ${schema}.jobs.status IS '任务状态';
COMMENT ON COLUMN ${schema}.jobs.progress_text IS '任务进度文案';
COMMENT ON COLUMN ${schema}.jobs.error_message IS '失败原因';
COMMENT ON COLUMN ${schema}.jobs.payload IS '任务附加数据';
COMMENT ON COLUMN ${schema}.jobs.created_at IS '任务创建时间';
COMMENT ON COLUMN ${schema}.jobs.started_at IS '任务开始时间';
COMMENT ON COLUMN ${schema}.jobs.finished_at IS '任务结束时间';

COMMENT ON TABLE ${schema}.project_artifacts IS '项目工件表，数据库为元数据与结构化数据真源';
COMMENT ON COLUMN ${schema}.project_artifacts.project_id IS '所属项目ID';
COMMENT ON COLUMN ${schema}.project_artifacts.artifact_path IS '工件相对路径';
COMMENT ON COLUMN ${schema}.project_artifacts.stage IS '工件所属阶段';
COMMENT ON COLUMN ${schema}.project_artifacts.content_type IS '工件内容类型';
COMMENT ON COLUMN ${schema}.project_artifacts.storage_provider IS '存储提供方：database/aliyun-oss';
COMMENT ON COLUMN ${schema}.project_artifacts.public_url IS '对象存储公网地址';
COMMENT ON COLUMN ${schema}.project_artifacts.metadata IS '工件附加信息';
COMMENT ON COLUMN ${schema}.project_artifacts.body_json IS '结构化 JSON 数据';
COMMENT ON COLUMN ${schema}.project_artifacts.body_text IS '纯文本数据';
COMMENT ON COLUMN ${schema}.project_artifacts.size_bytes IS '工件字节数';
COMMENT ON COLUMN ${schema}.project_artifacts.created_at IS '创建时间';
COMMENT ON COLUMN ${schema}.project_artifacts.updated_at IS '更新时间';

COMMENT ON TABLE ${schema}.project_logs IS '项目流水日志表';
COMMENT ON COLUMN ${schema}.project_logs.project_id IS '所属项目ID';
COMMENT ON COLUMN ${schema}.project_logs.stage IS '日志阶段';
COMMENT ON COLUMN ${schema}.project_logs.payload IS '日志内容';
COMMENT ON COLUMN ${schema}.project_logs.created_at IS '创建时间';

COMMENT ON TABLE ${schema}.model_catalog IS '模型目录表';
COMMENT ON COLUMN ${schema}.model_catalog.model_id IS '模型ID';
COMMENT ON COLUMN ${schema}.model_catalog.display_name IS '模型展示名称';
COMMENT ON COLUMN ${schema}.model_catalog.provider IS '模型提供方';
COMMENT ON COLUMN ${schema}.model_catalog.category IS '模型主分类：text/image/video/speech';
COMMENT ON COLUMN ${schema}.model_catalog.family IS '模型适配族';
COMMENT ON COLUMN ${schema}.model_catalog.capabilities IS '模型能力标签';
COMMENT ON COLUMN ${schema}.model_catalog.source IS '模型信息来源';
COMMENT ON COLUMN ${schema}.model_catalog.metadata IS '模型附加信息';
COMMENT ON COLUMN ${schema}.model_catalog.updated_at IS '目录更新时间';
`;
}

export async function getPool() {
  if (!pool) {
    pool = new Pool(databaseConfig());
  }
  await ensureSchema();
  return pool;
}

export async function ensureSchema() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      if (!pool) {
        pool = new Pool(databaseConfig());
      }
      const client = await pool.connect();
      const schema = databaseSchema();
      try {
        await client.query("SELECT pg_advisory_lock(hashtext($1))", [schema]);
        await client.query(createSchemaSql(schema));
      } finally {
        await client.query("SELECT pg_advisory_unlock(hashtext($1))", [schema]).catch(() => {});
        client.release();
      }
    })();
  }
  return schemaReadyPromise;
}

export async function query(text, params = []) {
  const db = await getPool();
  return db.query(text, params);
}

export async function withTransaction(fn) {
  const db = await getPool();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
