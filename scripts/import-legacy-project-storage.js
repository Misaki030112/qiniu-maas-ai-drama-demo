import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../src/config.js";
import { contentTypeFromFilePath } from "../src/object-storage.js";
import { PROJECT_ARTIFACT_PATHS } from "../src/project-artifact-paths.js";
import {
  appendProjectLog,
  saveProjectBinaryArtifact,
  saveProjectJsonArtifact,
  saveProjectTextArtifact,
} from "../src/project-artifacts.js";
import { createDefaultModels } from "../src/project-store.js";
import { databaseSchema, ensureSchema, getPool } from "../src/db.js";

const schema = databaseSchema();

function nowIso() {
  return new Date().toISOString();
}

function createStageState() {
  return {
    adaptation: { status: "idle", updatedAt: null, error: null },
    characters: { status: "idle", updatedAt: null, error: null },
    storyboard: { status: "idle", updatedAt: null, error: null },
    media: { status: "idle", updatedAt: null, error: null },
    output: { status: "idle", updatedAt: null, error: null },
    video: { status: "idle", updatedAt: null, error: null },
  };
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(filePath) {
  if (!(await exists(filePath))) {
    return null;
  }
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function readTextIfExists(filePath) {
  if (!(await exists(filePath))) {
    return "";
  }
  return await fs.readFile(filePath, "utf8");
}

async function collectFiles(rootDir) {
  const results = [];

  async function walk(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile()) {
        results.push(absolutePath);
      }
    }
  }

  if (await exists(rootDir)) {
    await walk(rootDir);
  }

  return results.sort();
}

async function upsertProjectRow(pool, projectId, outputDir) {
  const legacyProjectPath = path.join(config.projectDataRoot, projectId, "project.json");
  const legacyProject = await readJsonIfExists(legacyProjectPath);
  const manifest = await readJsonIfExists(path.join(outputDir, "manifest.json"));
  const storyText = legacyProject?.storyText || await readTextIfExists(path.join(outputDir, "01-input", "story.txt"));
  const createdAt = legacyProject?.createdAt || manifest?.startedAt || nowIso();
  const updatedAt = legacyProject?.updatedAt || manifest?.completedAt || createdAt;

  await pool.query(
    `
      INSERT INTO ${schema}.projects (
        id,
        name,
        story_text,
        model_config,
        stage_state,
        current_job_id,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, NULL, $6, $7)
      ON CONFLICT (id)
      DO UPDATE SET
        name = EXCLUDED.name,
        story_text = EXCLUDED.story_text,
        model_config = EXCLUDED.model_config,
        stage_state = EXCLUDED.stage_state,
        updated_at = EXCLUDED.updated_at
    `,
    [
      projectId,
      legacyProject?.name || manifest?.projectName || projectId,
      storyText.trim(),
      JSON.stringify({
        ...createDefaultModels(),
        ...(legacyProject?.models || {}),
      }),
      JSON.stringify(legacyProject?.stageState || createStageState()),
      createdAt,
      updatedAt,
    ],
  );
}

async function clearLegacyProjectState(pool, projectId) {
  await pool.query(`DELETE FROM ${schema}.project_artifacts WHERE project_id = $1`, [projectId]);
  await pool.query(`DELETE FROM ${schema}.project_logs WHERE project_id = $1`, [projectId]);
}

async function importStructuredArtifacts(projectId, outputDir) {
  const manifest = await readJsonIfExists(path.join(outputDir, "manifest.json"));
  if (manifest) {
    await saveProjectJsonArtifact({
      projectId,
      artifactPath: PROJECT_ARTIFACT_PATHS.manifest,
      value: manifest,
      stage: "manifest",
    });
  }

  const modelMatrix = await readJsonIfExists(path.join(outputDir, "model-matrix.json"));
  if (modelMatrix) {
    await saveProjectJsonArtifact({
      projectId,
      artifactPath: PROJECT_ARTIFACT_PATHS.modelMatrix,
      value: modelMatrix,
      stage: "model-matrix",
    });
  }

  const structuredFiles = [
    { artifactPath: PROJECT_ARTIFACT_PATHS.story, localPath: path.join(outputDir, "01-input", "story.txt"), kind: "text", stage: "input" },
    { artifactPath: PROJECT_ARTIFACT_PATHS.adaptation, localPath: path.join(outputDir, "02-adaptation", "adaptation.json"), kind: "json", stage: "adaptation" },
    { artifactPath: PROJECT_ARTIFACT_PATHS.characters, localPath: path.join(outputDir, "03-characters", "characters.json"), kind: "json", stage: "characters" },
    { artifactPath: PROJECT_ARTIFACT_PATHS.storyboard, localPath: path.join(outputDir, "05-storyboard", "storyboard.json"), kind: "json", stage: "storyboard" },
    { artifactPath: PROJECT_ARTIFACT_PATHS.mediaWorkbench, localPath: path.join(outputDir, "06-images", "media-workbench.json"), kind: "json", stage: "media" },
    { artifactPath: PROJECT_ARTIFACT_PATHS.subtitles, localPath: path.join(outputDir, "08-subtitles", "subtitles.srt"), kind: "text", stage: "media" },
  ];

  for (const item of structuredFiles) {
    if (!(await exists(item.localPath))) {
      continue;
    }
    if (item.kind === "json") {
      await saveProjectJsonArtifact({
        projectId,
        artifactPath: item.artifactPath,
        value: await readJsonIfExists(item.localPath),
        stage: item.stage,
      });
      continue;
    }
    await saveProjectTextArtifact({
      projectId,
      artifactPath: item.artifactPath,
      text: await readTextIfExists(item.localPath),
      stage: item.stage,
    });
  }
}

async function importLogs(projectId, outputDir) {
  const logPath = path.join(outputDir, "00-logs", "pipeline.jsonl");
  const raw = await readTextIfExists(logPath);
  if (!raw.trim()) {
    return 0;
  }

  let count = 0;
  for (const line of raw.split("\n").filter(Boolean)) {
    try {
      const entry = JSON.parse(line);
      await appendProjectLog(projectId, entry.stage || "legacy", entry);
      count += 1;
    } catch {}
  }
  return count;
}

async function importLegacyFiles(projectId, outputDir) {
  const files = await collectFiles(outputDir);
  let count = 0;

  for (const absolutePath of files) {
    const artifactPath = path.relative(outputDir, absolutePath).replaceAll(path.sep, "/");
    if (
      artifactPath === PROJECT_ARTIFACT_PATHS.manifest
      || artifactPath === PROJECT_ARTIFACT_PATHS.modelMatrix
      || artifactPath === PROJECT_ARTIFACT_PATHS.story
      || artifactPath === PROJECT_ARTIFACT_PATHS.adaptation
      || artifactPath === PROJECT_ARTIFACT_PATHS.characters
      || artifactPath === PROJECT_ARTIFACT_PATHS.storyboard
      || artifactPath === PROJECT_ARTIFACT_PATHS.mediaWorkbench
      || artifactPath === PROJECT_ARTIFACT_PATHS.subtitles
      || artifactPath === "00-logs/pipeline.jsonl"
    ) {
      continue;
    }

    await saveProjectBinaryArtifact({
      projectId,
      artifactPath,
      contentType: contentTypeFromFilePath(artifactPath),
      publicUrl: "",
      storageProvider: "legacy-local",
      metadata: {
        legacy: true,
        importedAt: nowIso(),
        legacyLocalPath: absolutePath,
      },
      stage: artifactPath.split("/")[0] || "legacy",
      sizeBytes: (await fs.stat(absolutePath)).size,
    });
    count += 1;
  }

  return count;
}

async function main() {
  await ensureSchema();
  const pool = await getPool();
  const rootDir = path.join(process.cwd(), "output", "projects");
  const entries = await fs.readdir(rootDir, { withFileTypes: true }).catch(() => []);
  const projectIds = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

  const restored = [];

  for (const projectId of projectIds) {
    const outputDir = path.join(rootDir, projectId);
    await upsertProjectRow(pool, projectId, outputDir);
    await clearLegacyProjectState(pool, projectId);
    await importStructuredArtifacts(projectId, outputDir);
    const logCount = await importLogs(projectId, outputDir);
    const fileCount = await importLegacyFiles(projectId, outputDir);
    restored.push({ projectId, logCount, fileCount });
  }

  console.log(JSON.stringify({
    schema,
    restoredProjects: restored.length,
    restored,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
