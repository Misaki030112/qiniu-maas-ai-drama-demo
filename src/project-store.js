import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { buildArtifactUrl, resolveArtifactPublicUrl } from "./object-storage.js";
import { databaseSchema, query } from "./db.js";
import { mapMediaWorkbenchUrls, normalizeMediaWorkbench } from "./media-workbench.js";
import { normalizeVoiceProfile } from "./voice-catalog.js";
import { ensureDir, makeRunId, readJson, readText, writeJson, writeText } from "./utils.js";

export const stageOrder = [
  "adaptation",
  "characters",
  "storyboard",
  "media",
  "output",
  "video",
];

const stageDependencies = {
  adaptation: [],
  characters: ["adaptation"],
  storyboard: ["characters"],
  media: ["storyboard"],
  output: ["media"],
  video: ["media"],
};

const schema = databaseSchema();

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
    adaptation: "",
    characters: "",
    storyboard: "",
    roleImage: "",
    shotImage: "",
    shotVideo: "",
    scriptRatio: "9:16",
    scriptStyle: "写实",
    scriptMode: "生图转视频",
  };
}

function uniqBy(items, getKey) {
  const map = new Map();
  for (const item of items) {
    const key = getKey(item);
    if (!key || map.has(key)) {
      continue;
    }
    map.set(key, item);
  }
  return [...map.values()];
}

function deriveScenesFromAdaptation(adaptation) {
  const sceneHints = adaptation?.subject_hints?.scenes || [];
  const style = adaptation?.style_preset || "写实";
  return sceneHints.map((hint, index) => ({
    name: typeof hint === "string" ? hint : hint?.name || `场景${index + 1}`,
    source_scene_id: hint?.source_scene_id || null,
    location: typeof hint === "string" ? hint : hint?.location || "",
    description: typeof hint === "string" ? `${hint}，${style}风格场景。` : hint?.description || "",
    full_description: typeof hint === "string"
      ? `8K画质，${style}风格，电影级摄影；无人物；${hint}，环境结构清晰，材质真实，构图稳定，适合后续镜头反复复用。`
      : hint?.full_description || "",
    reference_prompt: typeof hint === "string"
      ? `8K画质，${style}风格，${hint}，电影级摄影，无人物，环境完整。`
      : hint?.reference_prompt || "",
    continuity_prompt: [
      typeof hint === "string" ? hint : hint?.location || hint?.name || "核心场景",
      `${style}风格，环境稳定，适合后续镜头复用。`,
    ].filter(Boolean).join(" "),
    negative_prompt: "卡通感、古装感、人物混入、畸形透视、过曝、任何文字、数字、字母、标签、水印、logo、UI字样",
  }));
}

function derivePropsFromAdaptation(adaptation) {
  const props = [];
  const style = adaptation?.style_preset || "写实";
  for (const propHint of adaptation?.subject_hints?.props || []) {
    props.push({
      name: typeof propHint === "string" ? propHint : propHint?.name || "关键道具",
      source_scene_id: propHint?.source_scene_id || null,
      description: typeof propHint === "string" ? `${propHint}，${style}风格道具。` : propHint?.description || "",
      full_description: typeof propHint === "string"
        ? `8K画质，${style}风格，电影级摄影；纯净背景，道具设定图；${propHint}，材质结构清晰，标准三视图横向排列。`
        : propHint?.full_description || "",
      reference_prompt: typeof propHint === "string"
        ? `8K画质，${style}风格，道具设定图，${propHint}，纯净背景，标准三视图。`
        : propHint?.reference_prompt || "",
      continuity_prompt: `${typeof propHint === "string" ? propHint : propHint?.name || "关键道具"}，${style}风格道具特写，材质清晰，适合后续镜头重复出现。`,
      negative_prompt: "卡通感、悬浮道具、材质错误、尺寸异常、任何文字、数字、字母、标签、水印、logo、UI字样",
    });
  }
  return uniqBy(props, (item) => item.name);
}

function mapReferenceImages(projectId, items = []) {
  return (items || []).map((item) => {
    if (!item) {
      return null;
    }
    const imagePath = item.path || item.imagePath || "";
    const relativeUrl = imagePath ? `/api/projects/${projectId}/artifacts/${imagePath}` : "";
    const publicUrl = resolveArtifactPublicUrl({
      projectId,
      relativePath: imagePath,
      generatedAt: item.generatedAt,
      publicUrl: item.publicUrl || "",
    });
    return {
      ...item,
      path: imagePath,
      url: publicUrl || (imagePath ? buildArtifactUrl(projectId, imagePath, item.generatedAt) : relativeUrl || item.url || ""),
      publicUrl,
    };
  }).filter(Boolean);
}

function referenceTimeValue(item) {
  const value = Date.parse(item?.generatedAt || "");
  return Number.isFinite(value) ? value : 0;
}

async function assetExists(outputDir, item) {
  if (!item) {
    return false;
  }
  if (item.publicUrl) {
    return true;
  }
  if (!item.path) {
    return false;
  }
  try {
    await fs.access(path.join(outputDir, item.path));
    return true;
  } catch {
    return false;
  }
}

async function sanitizeMediaWorkbenchAssets(projectId, paths, workbench) {
  if (!workbench?.shots?.length) {
    return workbench || { updatedAt: nowIso(), shots: [] };
  }

  let changed = false;
  const shots = [];

  for (const shot of workbench.shots) {
    const referenceImages = [];
    for (const item of shot.reference_images || []) {
      if (await assetExists(paths.outputDir, item)) {
        referenceImages.push(item);
      } else {
        changed = true;
      }
    }

    const frameAssets = [];
    for (const item of shot.frame_assets || []) {
      if (await assetExists(paths.outputDir, item)) {
        frameAssets.push(item);
      } else {
        changed = true;
      }
    }

    const videoAssets = [];
    for (const item of shot.video_assets || []) {
      if (await assetExists(paths.outputDir, item)) {
        videoAssets.push(item);
      } else {
        changed = true;
      }
    }

    const audioAsset = await assetExists(paths.outputDir, shot.audio_asset) ? shot.audio_asset : null;
    const lipSyncAsset = await assetExists(paths.outputDir, shot.lip_sync_asset) ? shot.lip_sync_asset : null;
    if (shot.audio_asset && !audioAsset) {
      changed = true;
    }
    if (shot.lip_sync_asset && !lipSyncAsset) {
      changed = true;
    }

    const selectedFrameAssetId = frameAssets.some((item) => item.id === shot.selected_frame_asset_id)
      ? shot.selected_frame_asset_id
      : frameAssets[0]?.id || "";
    const selectedVideoAssetId = videoAssets.some((item) => item.id === shot.selected_video_asset_id)
      ? shot.selected_video_asset_id
      : videoAssets[0]?.id || "";
    if (selectedFrameAssetId !== (shot.selected_frame_asset_id || "")) {
      changed = true;
    }
    if (selectedVideoAssetId !== (shot.selected_video_asset_id || "")) {
      changed = true;
    }

    shots.push({
      ...shot,
      reference_images: referenceImages,
      frame_assets: frameAssets,
      video_assets: videoAssets,
      selected_frame_asset_id: selectedFrameAssetId,
      selected_video_asset_id: selectedVideoAssetId,
      audio_asset: audioAsset,
      lip_sync_asset: lipSyncAsset,
    });
  }

  const nextWorkbench = changed
    ? {
        ...workbench,
        updatedAt: nowIso(),
        shots,
      }
    : workbench;

  if (changed) {
    await writeJson(getMediaWorkbenchPath(projectId), nextWorkbench);
  }

  return nextWorkbench;
}

export function normalizeCharacterStagePayload(payload, adaptation = null) {
  const source = payload && typeof payload === "object" ? payload : {};
  return {
    characters: Array.isArray(source.characters)
      ? source.characters.map((item) => ({
          ...item,
          voice_style: item?.voice_style || "",
          voice_profile: normalizeVoiceProfile(item?.voice_profile, item?.gender, item?.name),
        }))
      : [],
    scenes: Array.isArray(source.scenes) && source.scenes.length
      ? source.scenes
      : deriveScenesFromAdaptation(adaptation),
    props: Array.isArray(source.props) && source.props.length
      ? source.props
      : derivePropsFromAdaptation(adaptation),
  };
}

function normalizeStoryboardItem(item, groupIndex, itemIndex) {
  const safeGroup = groupIndex + 1;
  const safeItem = itemIndex + 1;
  return {
    item_id: item?.item_id || item?.shot_id || `${safeGroup}-${safeItem}`,
    shot_no: item?.shot_no || `${safeGroup}-${safeItem}`,
    scene_name: item?.scene_name || item?.scene || item?.scene_title || item?.scene_id || "",
    shot_size: item?.shot_size || item?.shot_type || item?.shot || item?.size || "",
    composition: item?.composition || item?.framing || "",
    camera_move: item?.camera_move || item?.camera || item?.movement || "",
    lighting: item?.lighting || item?.light || "",
    shot_description: item?.shot_description || item?.visual_focus || item?.description || item?.title || "",
    sound_fx: item?.sound_fx || item?.sound || item?.ambience || "",
    dialogue: item?.dialogue || item?.line || item?.subtitle || "",
    duration_sec: Number(item?.duration_sec || item?.duration || 4),
    speaker: item?.speaker || "",
    subject_refs: Array.isArray(item?.subject_refs)
      ? item.subject_refs
          .filter((ref) => ref?.kind && ref?.key)
          .map((ref) => ({ kind: ref.kind, key: ref.key }))
      : [],
    image_prompt: item?.image_prompt || "",
    video_prompt: item?.video_prompt || "",
    negative_prompt: item?.negative_prompt || "",
  };
}

function groupFromLegacyShot(shot, index) {
  const item = normalizeStoryboardItem(shot, index, 0);
  const title =
    shot?.title ||
    shot?.visual_focus ||
    shot?.subtitle ||
    shot?.line ||
    `镜头${index + 1}`;
  return {
    group_id: shot?.group_id || `group_${index + 1}`,
    title: `镜头${index + 1}`,
    source_text: shot?.source_text || title,
    order_index: index,
    collapsed: false,
    items: [item],
  };
}

export function normalizeStoryboardPayload(payload, adaptation = null) {
  const source = payload && typeof payload === "object" ? payload : {};
  const rawGroups = Array.isArray(source.groups)
    ? source.groups
    : Array.isArray(source.shots)
      ? source.shots.map(groupFromLegacyShot)
      : [];

  const groups = rawGroups.map((group, groupIndex) => {
    const items = Array.isArray(group?.items)
      ? group.items.map((item, itemIndex) => normalizeStoryboardItem(item, groupIndex, itemIndex))
      : [normalizeStoryboardItem(group, groupIndex, 0)];

    return {
      group_id: group?.group_id || `group_${groupIndex + 1}`,
      title: group?.title || `镜头${groupIndex + 1}`,
      source_text:
        group?.source_text ||
        group?.summary ||
        group?.title ||
        adaptation?.chapters?.[0]?.summary ||
        "",
      order_index: Number(group?.order_index ?? groupIndex),
      collapsed: Boolean(group?.collapsed),
      items,
    };
  });

  return {
    style_guide: source.style_guide || {
      visual_style: adaptation?.style_preset || "写实电影感",
      continuity_rules: adaptation?.continuity_tokens || [],
      negative_prompt: "角色漂移、场景漂移、道具消失、文字水印、卡通感",
    },
    groups,
    shots: groups.flatMap((group) =>
      group.items.map((item) => ({
        shot_id: item.item_id,
        scene_id: group.group_id,
        title: group.title,
        camera: item.camera_move,
        visual_focus: item.shot_description,
        transition: "",
        speaker: item.speaker || "旁白",
        subject_refs: item.subject_refs || [],
        line: item.dialogue || "",
        subtitle: item.dialogue || "",
        duration_sec: Number(item.duration_sec || 4),
        image_prompt: item.image_prompt || item.shot_description || "",
        video_prompt: item.video_prompt || item.shot_description || "",
        negative_prompt: item.negative_prompt || "",
      })),
    ),
  };
}

function normalizeProject(project) {
  return {
    ...project,
    models: { ...createDefaultModels(), ...(project.models || {}) },
    stageState: { ...createStageState(), ...(project.stageState || {}) },
    currentJobId: project.currentJobId || null,
  };
}

function projectRowToModel(row) {
  if (!row) {
    throw new Error("项目不存在。");
  }
  return normalizeProject({
    id: row.id,
    name: row.name,
    storyText: row.story_text || "",
    models: row.model_config || createDefaultModels(),
    stageState: row.stage_state || createStageState(),
    currentJobId: row.current_job_id || null,
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at,
  });
}

function jobRowToModel(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    projectId: row.project_id,
    stage: row.stage,
    status: row.status,
    progressText: row.progress_text || "",
    errorMessage: row.error_message || null,
    payload: row.payload || {},
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    startedAt: row.started_at?.toISOString?.() || row.started_at,
    finishedAt: row.finished_at?.toISOString?.() || row.finished_at,
  };
}

function refreshProjectReadiness(project) {
  for (const stage of stageOrder) {
    const state = project.stageState[stage];
    if (["queued", "running", "done", "stale", "error"].includes(state.status)) {
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

function markStageIdle(project, stage, stale = false) {
  project.stageState[stage] = {
    status: stale ? "stale" : "idle",
    updatedAt: null,
    error: null,
  };
}

function serializeProject(project) {
  const normalized = normalizeProject(project);
  refreshProjectReadiness(normalized);
  return normalized;
}

async function upsertProject(project) {
  const next = serializeProject({
    ...project,
    updatedAt: nowIso(),
  });

  const result = await query(
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
      VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        story_text = EXCLUDED.story_text,
        model_config = EXCLUDED.model_config,
        stage_state = EXCLUDED.stage_state,
        current_job_id = EXCLUDED.current_job_id,
        updated_at = EXCLUDED.updated_at
      RETURNING *
    `,
    [
      next.id,
      next.name,
      next.storyText,
      JSON.stringify(next.models),
      JSON.stringify(next.stageState),
      next.currentJobId,
      next.createdAt,
      next.updatedAt,
    ],
  );

  return projectRowToModel(result.rows[0]);
}

async function readProjectRow(projectId) {
  const result = await query(
    `SELECT * FROM ${schema}.projects WHERE id = $1 LIMIT 1`,
    [projectId],
  );
  if (!result.rows[0]) {
    throw new Error("项目不存在。");
  }
  return result.rows[0];
}

export function getProjectPaths(projectId) {
  const outputDir = path.join(config.projectOutputRoot, projectId);
  return {
    dataDir: path.join(config.projectDataRoot, projectId),
    outputDir,
    manifestPath: path.join(outputDir, "manifest.json"),
    modelMatrixPath: path.join(outputDir, "model-matrix.json"),
    dirs: {
      logs: path.join(outputDir, "00-logs"),
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

export function getMediaWorkbenchPath(projectId) {
  const paths = getProjectPaths(projectId);
  return path.join(paths.dirs.images, "media-workbench.json");
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

export async function createProject(name = "点众 AI 真人剧 Demo") {
  const safeName = String(name || "点众 AI 真人剧 Demo").trim() || "点众 AI 真人剧 Demo";
  const projectId = `${makeRunId()}-${slugifyName(safeName)}`;
  const now = nowIso();
  const project = serializeProject({
    id: projectId,
    name: safeName,
    createdAt: now,
    updatedAt: now,
    storyText: "",
    models: createDefaultModels(),
    stageState: createStageState(),
    currentJobId: null,
  });
  await ensureProjectWorkspace(projectId);
  return upsertProject(project);
}

export async function writeProject(project) {
  return upsertProject(project);
}

export async function readProject(projectId) {
  const project = projectRowToModel(await readProjectRow(projectId));
  refreshProjectReadiness(project);
  return project;
}

export async function listProjects() {
  const result = await query(
    `
      SELECT id, name, current_job_id, updated_at, created_at
      FROM ${schema}.projects
      ORDER BY updated_at DESC
    `,
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    currentJobId: row.current_job_id || null,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at,
    createdAt: row.created_at?.toISOString?.() || row.created_at,
  }));
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

async function readOptionalJsonLines(filePath, limit = 200) {
  const text = await readOptionalText(filePath);
  if (!text.trim()) {
    return [];
  }

  return text
    .trim()
    .split("\n")
    .slice(-limit)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export async function readJob(jobId) {
  const result = await query(
    `SELECT * FROM ${schema}.jobs WHERE id = $1 LIMIT 1`,
    [jobId],
  );
  return jobRowToModel(result.rows[0] || null);
}

export async function readCurrentJob(projectId) {
  const project = await readProject(projectId);
  if (project.currentJobId) {
    const job = await readJob(project.currentJobId);
    if (job) {
      return job;
    }
  }

  const result = await query(
    `
      SELECT *
      FROM ${schema}.jobs
      WHERE project_id = $1
        AND status IN ('queued', 'running')
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [projectId],
  );
  return jobRowToModel(result.rows[0] || null);
}

export async function createJob(projectId, stage, payload = {}) {
  const id = `${makeRunId()}-${stage}`;
  const result = await query(
    `
      INSERT INTO ${schema}.jobs (
        id,
        project_id,
        stage,
        status,
        progress_text,
        payload
      )
      VALUES ($1, $2, $3, 'queued', $4, $5::jsonb)
      RETURNING *
    `,
    [id, projectId, stage, "已进入队列", JSON.stringify(payload)],
  );
  return jobRowToModel(result.rows[0]);
}

export async function markJobRunning(jobId, progressText = "开始执行") {
  const result = await query(
    `
      UPDATE ${schema}.jobs
      SET status = 'running',
          progress_text = $2,
          started_at = COALESCE(started_at, NOW())
      WHERE id = $1
      RETURNING *
    `,
    [jobId, progressText],
  );
  return jobRowToModel(result.rows[0]);
}

export async function markJobProgress(jobId, progressText, payload = null) {
  const result = await query(
    `
      UPDATE ${schema}.jobs
      SET progress_text = $2,
          payload = CASE
            WHEN $3::jsonb IS NULL THEN payload
            ELSE $3::jsonb
          END
      WHERE id = $1
      RETURNING *
    `,
    [jobId, progressText, payload ? JSON.stringify(payload) : null],
  );
  return jobRowToModel(result.rows[0]);
}

export async function markJobDone(jobId, payload = null) {
  const result = await query(
    `
      UPDATE ${schema}.jobs
      SET status = 'done',
          progress_text = '执行完成',
          payload = CASE
            WHEN $2::jsonb IS NULL THEN payload
            ELSE $2::jsonb
          END,
          finished_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [jobId, payload ? JSON.stringify(payload) : null],
  );
  return jobRowToModel(result.rows[0]);
}

export async function markJobError(jobId, errorMessage) {
  const result = await query(
    `
      UPDATE ${schema}.jobs
      SET status = 'error',
          progress_text = '执行失败',
          error_message = $2,
          finished_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [jobId, errorMessage],
  );
  return jobRowToModel(result.rows[0]);
}

export async function invalidateProject(project, fromStage) {
  const startIndex = fromStage === "story" ? 0 : stageOrder.indexOf(fromStage);
  const affectedStages = fromStage === "story" ? stageOrder : stageOrder.slice(startIndex);
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

  project.currentJobId = null;
  refreshProjectReadiness(project);
  await writeProject(project);
}

export async function updateProject(projectId, patch) {
  const project = await readProject(projectId);
  let shouldInvalidateStory = false;
  let invalidateStage = null;
  const staleStages = new Set();

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
        roleImage: null,
        shotImage: null,
        shotVideo: null,
        scriptRatio: "adaptation",
        scriptStyle: "adaptation",
        scriptMode: "adaptation",
      };
      const staleStageMap = {
        shotImage: ["media", "output", "video"],
        shotVideo: ["video"],
      };
      for (const key of changedKeys) {
        for (const stage of staleStageMap[key] || []) {
          staleStages.add(stage);
        }
      }
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

  if (staleStages.size) {
    for (const stage of staleStages) {
      markStageIdle(project, stage, true);
    }
    refreshProjectReadiness(project);
    await writeProject(project);
    return project;
  }

  return writeProject(project);
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

  const artifactValue = stage === "characters"
    ? normalizeCharacterStagePayload(
        value,
        await readOptionalJson(path.join(paths.dirs.adaptation, "adaptation.json")),
      )
    : stage === "storyboard"
      ? normalizeStoryboardPayload(
          value,
          await readOptionalJson(path.join(paths.dirs.adaptation, "adaptation.json")),
        )
    : value;

  await writeJson(targetMap[stage], artifactValue);
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

export async function readMediaWorkbench(projectId) {
  const paths = getProjectPaths(projectId);
  const manifest = await readOptionalJson(paths.manifestPath);
  const adaptation = await readOptionalJson(path.join(paths.dirs.adaptation, "adaptation.json"));
  const characters = await readOptionalJson(path.join(paths.dirs.characters, "characters.json"));
  const normalizedCharacters = normalizeCharacterStagePayload(characters, adaptation);
  const storyboard = await readOptionalJson(path.join(paths.dirs.storyboard, "storyboard.json"));
  const workbench = await readOptionalJson(getMediaWorkbenchPath(projectId));
  const normalizedStoryboard = normalizeStoryboardPayload(storyboard, adaptation);
  return normalizeMediaWorkbench(workbench, normalizedStoryboard, normalizedCharacters, manifest);
}

export async function saveMediaWorkbench(projectId, value) {
  const paths = await ensureProjectWorkspace(projectId);
  const normalized = await readMediaWorkbench(projectId);
  const next = {
    ...normalized,
    ...value,
    updatedAt: nowIso(),
  };
  await writeJson(getMediaWorkbenchPath(projectId), next);
  return next;
}

export async function patchMediaShot(projectId, shotId, patch) {
  const workbench = await readMediaWorkbench(projectId);
  const index = workbench.shots.findIndex((item) => item.shot_id === shotId);
  if (index === -1) {
    throw new Error("未找到当前镜头。");
  }
  const current = workbench.shots[index];
  workbench.shots[index] = {
    ...current,
    ...patch,
    reference_images: patch.reference_images ?? current.reference_images,
    frame_assets: patch.frame_assets ?? current.frame_assets,
    video_assets: patch.video_assets ?? current.video_assets,
    subject_refs: patch.subject_refs ?? current.subject_refs,
    video_options: patch.video_options ? { ...(current.video_options || {}), ...patch.video_options } : current.video_options,
    audio_config: patch.audio_config ? { ...current.audio_config, ...patch.audio_config } : current.audio_config,
    audio_asset: patch.audio_asset !== undefined ? patch.audio_asset : current.audio_asset,
    lip_sync_asset: patch.lip_sync_asset !== undefined ? patch.lip_sync_asset : current.lip_sync_asset,
  };
  workbench.updatedAt = nowIso();
  await writeJson(getMediaWorkbenchPath(projectId), workbench);
  return workbench;
}

export async function readProjectDetail(projectId) {
  const project = await readProject(projectId);
  const paths = getProjectPaths(projectId);
  const manifest = await readOptionalJson(paths.manifestPath);
  const modelMatrix = await readOptionalJson(paths.modelMatrixPath);
  const logs = await readOptionalJsonLines(path.join(paths.dirs.logs, "pipeline.jsonl"));
  const storyText =
    project.storyText || (await readOptionalText(path.join(paths.dirs.input, "story.txt")));
  const adaptation = await readOptionalJson(path.join(paths.dirs.adaptation, "adaptation.json"));
  const characters = await readOptionalJson(path.join(paths.dirs.characters, "characters.json"));
  const normalizedCharacters = normalizeCharacterStagePayload(characters, adaptation);
  normalizedCharacters.characters = normalizedCharacters.characters.map((item) => ({
    ...item,
    reference_images: mapReferenceImages(projectId, item.reference_images),
  }));
  normalizedCharacters.scenes = normalizedCharacters.scenes.map((item) => ({
    ...item,
    reference_images: mapReferenceImages(projectId, item.reference_images),
  }));
  normalizedCharacters.props = normalizedCharacters.props.map((item) => ({
    ...item,
    reference_images: mapReferenceImages(projectId, item.reference_images),
  }));
  const storyboard = await readOptionalJson(path.join(paths.dirs.storyboard, "storyboard.json"));
  const normalizedStoryboard = normalizeStoryboardPayload(storyboard, adaptation);
  const subtitles = await readOptionalText(path.join(paths.dirs.subtitles, "subtitles.srt"));
  const subjectReferences = (manifest?.subjectReferences || manifest?.roleReferences || []).map((item) => ({
    ...item,
    kind: item.kind || "character",
    key: item.key || item.name,
    path: item.path || (item.imagePath ? path.posix.join("04-role-reference", item.imagePath) : ""),
    url: buildArtifactUrl(
      projectId,
      item.path || (item.imagePath ? path.posix.join("04-role-reference", item.imagePath) : ""),
      item.generatedAt,
    ),
    publicUrl: resolveArtifactPublicUrl({
      projectId,
      relativePath: item.path || (item.imagePath ? path.posix.join("04-role-reference", item.imagePath) : ""),
      generatedAt: item.generatedAt,
      publicUrl: item.publicUrl || "",
    }),
  }))
    .sort((a, b) => referenceTimeValue(b) - referenceTimeValue(a));
  const roleReferences = subjectReferences.filter((item) => item.kind === "character");
  const sceneReferences = subjectReferences.filter((item) => item.kind === "scene");
  const propReferences = subjectReferences.filter((item) => item.kind === "prop");
  const shots = (manifest?.shots || []).map((shot) => ({
    ...shot,
    imageUrl: shot.imagePath ? `/api/projects/${projectId}/artifacts/${shot.imagePath}` : "",
    audioUrl: shot.audioPath ? `/api/projects/${projectId}/artifacts/${shot.audioPath}` : "",
    segmentUrl: shot.segmentPath ? `/api/projects/${projectId}/artifacts/${shot.segmentPath}` : "",
  }));
  const rawWorkbench = await readOptionalJson(getMediaWorkbenchPath(projectId));
  const sanitizedWorkbench = await sanitizeMediaWorkbenchAssets(projectId, paths, rawWorkbench);
  const mediaWorkbench = mapMediaWorkbenchUrls(
    projectId,
    normalizeMediaWorkbench(
      sanitizedWorkbench,
      normalizedStoryboard,
      normalizedCharacters,
      manifest,
    ),
  );
  const currentJob = await readCurrentJob(projectId);

  return {
    ...project,
    manifest: manifest || null,
    modelMatrix: modelMatrix || null,
    logs,
    currentJob,
    artifacts: {
      storyText,
      adaptation,
      characters: normalizedCharacters,
      storyboard: normalizedStoryboard,
      subtitles,
      subjectReferences,
      roleReferences,
      sceneReferences,
      propReferences,
      shots,
      mediaWorkbench,
      outputVideoUrl: manifest?.outputs?.outputVideo
        ? buildArtifactUrl(projectId, manifest.outputs.outputVideo)
        : "",
      outputVideoPublicUrl: manifest?.outputPublicUrls?.outputVideo || "",
      videoOutputUrl: manifest?.outputs?.videoOutput
        ? buildArtifactUrl(projectId, manifest.outputs.videoOutput)
        : "",
      videoOutputPublicUrl: manifest?.outputPublicUrls?.videoOutput || "",
    },
  };
}
