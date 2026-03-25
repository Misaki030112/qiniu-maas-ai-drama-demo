import { PROJECT_ARTIFACT_PATHS } from "../project-artifact-paths.js";
import { readProjectJsonArtifact } from "../project-artifacts.js";
import { readMediaWorkbench } from "../project-store.js";

async function inferStageReadyFromArtifacts(projectId, stage) {
  if (stage === "adaptation") {
    return Boolean(await readProjectJsonArtifact(projectId, PROJECT_ARTIFACT_PATHS.adaptation));
  }
  if (stage === "characters") {
    return Boolean(await readProjectJsonArtifact(projectId, PROJECT_ARTIFACT_PATHS.characters));
  }
  if (stage === "storyboard") {
    return Boolean(await readProjectJsonArtifact(projectId, PROJECT_ARTIFACT_PATHS.storyboard));
  }
  if (stage === "media") {
    const workbench = await readMediaWorkbench(projectId);
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
