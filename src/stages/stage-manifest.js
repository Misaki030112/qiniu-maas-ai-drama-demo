import { config } from "../config.js";
import { PROJECT_ARTIFACT_PATHS } from "../project-artifact-paths.js";
import { readProjectJsonArtifact, saveProjectJsonArtifact } from "../project-artifacts.js";

export async function loadManifest(projectId, project) {
  return (await readProjectJsonArtifact(projectId, PROJECT_ARTIFACT_PATHS.manifest)) || {
    projectId,
    projectName: project.name,
    startedAt: new Date().toISOString(),
    baseUrl: config.qiniu.baseUrl,
    renderStrategy: {
      mode: config.video.renderMode,
      note: "支持静态关键帧合成和视频模型生成两条路径。",
      plannedVideoModel: project.models.shotVideo,
    },
    stages: [],
    outputs: {},
  };
}

export function upsertStageRecord(manifest, stage, model, output) {
  const next = { stage, model, output, updatedAt: new Date().toISOString() };
  manifest.stages = (manifest.stages || []).filter((item) => item.stage !== stage);
  manifest.stages.push(next);
}

export async function saveManifest(projectId, manifest) {
  await saveProjectJsonArtifact({
    projectId,
    artifactPath: PROJECT_ARTIFACT_PATHS.manifest,
    value: manifest,
    stage: "manifest",
  });
}

export async function saveModelMatrix(project, manifest) {
  await saveProjectJsonArtifact({
    projectId: project.id,
    artifactPath: PROJECT_ARTIFACT_PATHS.modelMatrix,
    stage: "model-matrix",
    value: {
      provider: config.strategy.provider,
      baseUrl: config.qiniu.baseUrl,
      primary: {
        adaptation: project.models.adaptation,
        characters: project.models.characters,
        storyboard: project.models.storyboard,
        roleImage: project.models.roleImage,
        shotImage: project.models.shotImage,
        shotVideo: project.models.shotVideo,
        voice: {
          narrator: config.qiniu.voices.narrator,
          female: config.qiniu.voices.female,
          male: config.qiniu.voices.male,
        },
      },
      comparisons: {
        text: config.qiniu.compareModels.text,
        image: config.qiniu.compareModels.image,
      },
      renderStrategy: manifest.renderStrategy,
      recommendations: config.strategy.recommendations,
    },
  });
}
