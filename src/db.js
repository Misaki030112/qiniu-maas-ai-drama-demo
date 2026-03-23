import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

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
      try {
        await client.query(createSchemaSql(databaseSchema()));
      } finally {
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
