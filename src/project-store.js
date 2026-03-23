import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { ensureDir, makeRunId, readJson, readText, writeJson, writeText } from "./utils.js";

export const stageOrder = [
  "adaptation",
  "characters",
  "storyboard",
  "media",
  "output",
  "video",
];

const stageDirs = {
  adaptation: ["02-adaptation"],
  characters: ["03-characters", "04-role-reference"],
  storyboard: ["05-storyboard"],
  media: ["06-images", "07-audio", "08-subtitles", "09-video"],
  output: ["09-video"],
  video: ["10-video-model"],
};

const stageDependencies = {
  adaptation: [],
  characters: ["adaptation"],
  storyboard: ["characters"],
  media: ["storyboard"],
  output: ["media"],
  video: ["media"],
};

function slugifyName(name) {
  return String(name || "project")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "project";
}

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

export function createDefaultModels() {
  return {
    adaptation: config.qiniu.models.adaptation,
    characters: config.qiniu.models.characters,
    storyboard: config.qiniu.models.storyboard,
    roleImage: config.qiniu.models.roleImage,
    shotImage: config.qiniu.models.shotImage,
    shotVideo: config.qiniu.models.shotVideo,
  };
}

function projectDataPath(projectId) {
  return path.join(config.projectDataRoot, projectId, "project.json");
}

export function getProjectPaths(projectId) {
  const outputDir = path.join(config.projectOutputRoot, projectId);
  return {
    dataDir: path.join(config.projectDataRoot, projectId),
    outputDir,
    manifestPath: path.join(outputDir, "manifest.json"),
    modelMatrixPath: path.join(outputDir, "model-matrix.json"),
    dirs: {
      input: path.join(outputDir, "01-input"),
      adaptation: path.join(outputDir, "02-adaptation"),
      characters: path.join(outputDir, "03-characters"),
      roleReference: path.join(outputDir, "04-role-reference"),
      storyboard: path.join(outputDir, "05-storyboard"),
      images: path.join(outputDir, "06-images"),
      audio: path.join(outputDir, "07-audio"),
      subtitles: path.join(outputDir, "08-subtitles"),
      video: path.join(outputDir, "09-video"),
      videoModel: path.join(outputDir, "10-video-model"),
    },
  };
}

export async function ensureProjectWorkspace(projectId) {
  const paths = getProjectPaths(projectId);
  await ensureDir(paths.dataDir);
  await ensureDir(paths.outputDir);
  for (const dir of Object.values(paths.dirs)) {
    await ensureDir(dir);
  }
  return paths;
}

function refreshProjectReadiness(project) {
  for (const stage of stageOrder) {
    const state = project.stageState[stage];
    if (state.status === "running" || state.status === "done" || state.status === "stale" || state.status === "error") {
      continue;
    }

    if (stage === "adaptation") {
      state.status = project.storyText.trim() ? "ready" : "idle";
      continue;
    }

    const ready = stageDependencies[stage].every((item) => project.stageState[item].status === "done");
    state.status = ready ? "ready" : "idle";
  }
}

export async function createProject(name = "点众 AI 真人剧 Demo") {
  const safeName = String(name || "点众 AI 真人剧 Demo").trim() || "点众 AI 真人剧 Demo";
  const projectId = `${makeRunId()}-${slugifyName(safeName)}`;
  const now = nowIso();
  const project = {
    id: projectId,
    name: safeName,
    createdAt: now,
    updatedAt: now,
    storyText: "",
    models: createDefaultModels(),
    stageState: createStageState(),
  };
  refreshProjectReadiness(project);
  await ensureProjectWorkspace(projectId);
  await writeProject(project);
  return project;
}

export async function writeProject(project) {
  project.updatedAt = nowIso();
  refreshProjectReadiness(project);
  await ensureDir(path.dirname(projectDataPath(project.id)));
  await writeJson(projectDataPath(project.id), project);
}

export async function readProject(projectId) {
  const project = await readJson(projectDataPath(projectId));
  if (!project.stageState) {
    project.stageState = createStageState();
  }
  if (!project.models) {
    project.models = createDefaultModels();
  }
  refreshProjectReadiness(project);
  return project;
}

export async function listProjects() {
  try {
    const entries = await fs.readdir(config.projectDataRoot, { withFileTypes: true });
    const projects = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      try {
        const project = await readProject(entry.name);
        projects.push({
          id: project.id,
          name: project.name,
          updatedAt: project.updatedAt,
          createdAt: project.createdAt,
        });
      } catch {
        // ignore broken project directories
      }
    }
    return projects.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  } catch {
    return [];
  }
}

function markStageIdle(project, stage, stale = false) {
  project.stageState[stage] = {
    status: stale ? "stale" : "idle",
    updatedAt: null,
    error: null,
  };
}

export async function invalidateProject(project, fromStage) {
  const startIndex = fromStage === "story" ? 0 : stageOrder.indexOf(fromStage);
  const paths = getProjectPaths(project.id);
  const affectedStages = fromStage === "story" ? stageOrder : stageOrder.slice(startIndex);
  const dirNames = new Set();

  for (const stage of affectedStages) {
    for (const dirName of stageDirs[stage] || []) {
      dirNames.add(dirName);
    }
  }

  for (const dirName of dirNames) {
    await fs.rm(path.join(paths.outputDir, dirName), { recursive: true, force: true });
  }

  await fs.rm(paths.manifestPath, { force: true });
  await fs.rm(paths.modelMatrixPath, { force: true });
  await ensureProjectWorkspace(project.id);

  if (fromStage === "story") {
    for (const stage of stageOrder) {
      markStageIdle(project, stage, false);
    }
  } else {
    const invalidateIndex = stageOrder.indexOf(fromStage);
    for (let index = invalidateIndex; index < stageOrder.length; index += 1) {
      markStageIdle(project, stageOrder[index], index !== invalidateIndex);
    }
  }
  refreshProjectReadiness(project);
  await writeProject(project);
}

export async function updateProject(projectId, patch) {
  const project = await readProject(projectId);
  let shouldInvalidateStory = false;
  let invalidateStage = null;

  if (typeof patch.name === "string") {
    project.name = patch.name.trim() || project.name;
  }

  if (typeof patch.storyText === "string" && patch.storyText !== project.storyText) {
    project.storyText = patch.storyText;
    shouldInvalidateStory = true;
  }

  if (patch.models && typeof patch.models === "object") {
    const nextModels = { ...project.models, ...patch.models };
    const changedKeys = Object.keys(nextModels).filter((key) => nextModels[key] !== project.models[key]);
    project.models = nextModels;
    if (changedKeys.length) {
      const invalidationMap = {
        adaptation: "adaptation",
        characters: "characters",
        storyboard: "storyboard",
        roleImage: "characters",
        shotImage: "media",
        shotVideo: "video",
      };
      invalidateStage = changedKeys
        .map((key) => invalidationMap[key])
        .filter(Boolean)
        .sort((a, b) => stageOrder.indexOf(a) - stageOrder.indexOf(b))[0] || invalidateStage;
    }
  }

  if (shouldInvalidateStory) {
    const paths = await ensureProjectWorkspace(project.id);
    await writeText(path.join(paths.dirs.input, "story.txt"), `${project.storyText.trim()}\n`);
    await invalidateProject(project, "story");
    return project;
  }

  if (invalidateStage) {
    await invalidateProject(project, invalidateStage);
    return project;
  }

  await writeProject(project);
  return project;
}

async function readOptionalJson(filePath) {
  try {
    return await readJson(filePath);
  } catch {
    return null;
  }
}

async function readOptionalText(filePath) {
  try {
    return await readText(filePath);
  } catch {
    return "";
  }
}

export async function saveProjectArtifact(projectId, stage, value) {
  const project = await readProject(projectId);
  const paths = await ensureProjectWorkspace(projectId);
  const targetMap = {
    adaptation: path.join(paths.dirs.adaptation, "adaptation.json"),
    characters: path.join(paths.dirs.characters, "characters.json"),
    storyboard: path.join(paths.dirs.storyboard, "storyboard.json"),
  };

  if (!targetMap[stage]) {
    throw new Error(`Stage ${stage} does not support manual save.`);
  }

  await writeJson(targetMap[stage], value);
  project.stageState[stage] = {
    status: "done",
    updatedAt: nowIso(),
    error: null,
  };
  await writeProject(project);

  const downstream = {
    adaptation: "characters",
    characters: "storyboard",
    storyboard: "media",
  }[stage];

  if (downstream) {
    await invalidateProject(project, downstream);
  }

  return readProjectDetail(projectId);
}

export async function readProjectDetail(projectId) {
  const project = await readProject(projectId);
  const paths = getProjectPaths(projectId);
  const manifest = await readOptionalJson(paths.manifestPath);
  const modelMatrix = await readOptionalJson(paths.modelMatrixPath);
  const storyText =
    project.storyText || (await readOptionalText(path.join(paths.dirs.input, "story.txt")));
  const adaptation = await readOptionalJson(path.join(paths.dirs.adaptation, "adaptation.json"));
  const characters = await readOptionalJson(path.join(paths.dirs.characters, "characters.json"));
  const storyboard = await readOptionalJson(path.join(paths.dirs.storyboard, "storyboard.json"));
  const subtitles = await readOptionalText(path.join(paths.dirs.subtitles, "subtitles.srt"));
  const roleReferences = (manifest?.roleReferences || []).map((item) => ({
    ...item,
    url: `/api/projects/${projectId}/artifacts/04-role-reference/${item.imagePath}`,
  }));
  const shots = (manifest?.shots || []).map((shot) => ({
    ...shot,
    imageUrl: shot.imagePath ? `/api/projects/${projectId}/artifacts/${shot.imagePath}` : "",
    audioUrl: shot.audioPath ? `/api/projects/${projectId}/artifacts/${shot.audioPath}` : "",
    segmentUrl: shot.segmentPath ? `/api/projects/${projectId}/artifacts/${shot.segmentPath}` : "",
  }));

  return {
    ...project,
    manifest: manifest || null,
    modelMatrix: modelMatrix || null,
    artifacts: {
      storyText,
      adaptation,
      characters,
      storyboard,
      subtitles,
      roleReferences,
      shots,
      outputVideoUrl: manifest?.outputs?.outputVideo
        ? `/api/projects/${projectId}/artifacts/${manifest.outputs.outputVideo}`
        : "",
      videoOutputUrl: manifest?.outputs?.videoOutput
        ? `/api/projects/${projectId}/artifacts/${manifest.outputs.videoOutput}`
        : "",
    },
  };
}
