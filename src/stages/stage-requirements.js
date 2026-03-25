import path from "node:path";
import { getMediaWorkbenchPath, getProjectPaths } from "../project-store.js";
import { readJson } from "../utils.js";

async function readOptionalJson(filePath) {
  try {
    return await readJson(filePath);
  } catch {
    return null;
  }
}

async function inferStageReadyFromArtifacts(projectId, stage) {
  const paths = getProjectPaths(projectId);
  if (stage === "adaptation") {
    return Boolean(await readOptionalJson(path.join(paths.dirs.adaptation, "adaptation.json")));
  }
  if (stage === "characters") {
    return Boolean(await readOptionalJson(path.join(paths.dirs.characters, "characters.json")));
  }
  if (stage === "storyboard") {
    return Boolean(await readOptionalJson(path.join(paths.dirs.storyboard, "storyboard.json")));
  }
  if (stage === "media") {
    const workbench = await readOptionalJson(getMediaWorkbenchPath(projectId));
    return Boolean(workbench?.shots?.length);
  }
  return false;
}

export function requiredModelsForStage(stage) {
  return {
    adaptation: ["adaptation", "characters"],
    characters: ["characters"],
    storyboard: ["storyboard"],
    media: ["shotImage"],
    output: [],
    video: ["shotVideo"],
  }[stage] || [];
}

function ensureStageModelsConfigured(project, stage) {
  const missing = requiredModelsForStage(stage).filter((key) => !String(project.models?.[key] || "").trim());
  if (!missing.length) {
    return;
  }
  const labels = {
    adaptation: "剧本模型",
    characters: "主体分析模型",
    storyboard: "分镜模型",
    shotImage: "镜头图片模型",
    shotVideo: "视频模型",
  };
  throw new Error(`当前阶段缺少模型配置：${missing.map((key) => labels[key] || key).join("、")}`);
}

export async function assertExecutable(project, stage) {
  ensureStageModelsConfigured(project, stage);
  const dependencies = {
    adaptation: [],
    characters: ["adaptation"],
    storyboard: ["characters"],
    media: ["storyboard"],
    output: ["media"],
    video: ["media"],
  }[stage] || [];
  for (const dependency of dependencies) {
    if (project.stageState[dependency]?.status === "done") {
      continue;
    }
    if (await inferStageReadyFromArtifacts(project.id, dependency)) {
      project.stageState[dependency] = {
        status: "done",
        updatedAt: project.stageState[dependency]?.updatedAt || new Date().toISOString(),
        error: null,
      };
      continue;
    }
    throw new Error(`请先完成 ${dependency} 阶段。`);
  }
}
