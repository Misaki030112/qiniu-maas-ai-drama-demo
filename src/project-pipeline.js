import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { QiniuMaaSClient } from "./providers/qiniu-maas.js";
import {
  buildAdaptationMessages,
  buildCharacterMessages,
  buildStoryboardMessages,
} from "./pipeline/prompts.js";
import {
  ensureDir,
  escapeSubtitlePath,
  readJson,
  readText,
  runCommand,
  secondsToSrtTime,
  writeJson,
  writeText,
} from "./utils.js";
import {
  appendFrameAsset,
  appendVideoAsset,
  buildReferenceInputs,
  createAudioAsset,
  createFrameAsset,
  createVideoAsset,
} from "./media-workbench.js";
import {
  ensureProjectWorkspace,
  getProjectPaths,
  patchMediaShot,
  normalizeCharacterStagePayload,
  normalizeStoryboardPayload,
  readMediaWorkbench,
  readProject,
  readProjectDetail,
  writeProject,
} from "./project-store.js";
import { createPipelineLogger } from "./pipeline-logger.js";
import { getVideoCapabilities } from "./video-capabilities.js";

async function reportProgress(onProgress, progressText, payload = null) {
  if (!onProgress) {
    return;
  }
  await onProgress({ progressText, payload });
}

function buildValidationError(message, details = {}) {
  const error = new Error(message);
  error.details = details;
  return error;
}

function findCharacter(characters, speaker) {
  return characters.find((item) => item.name === speaker);
}

function resolveVoice(speaker, characters) {
  if (speaker === "旁白") {
    return config.qiniu.voices.narrator;
  }
  const character = findCharacter(characters, speaker);
  if (!character) {
    return config.qiniu.voices.narrator;
  }
  if (character.gender === "male") {
    return config.qiniu.voices.male;
  }
  return config.qiniu.voices.female;
}

function buildFinalImagePrompt(shot, characters, styleGuide) {
  const character = findCharacter(characters, shot.speaker);
  const continuity = character?.continuity_prompt || "";
  const style = styleGuide?.visual_style || "写实电影感真人剧";
  return [
    style,
    continuity,
    shot.image_prompt,
    "高清，电影灯光，真实人物，画面干净，16:9。",
  ]
    .filter(Boolean)
    .join(" ");
}

function collectScriptText(adaptation) {
  return [
    adaptation?.script_text || "",
    ...(adaptation?.chapters || []).map((item) => item.content || item.summary || ""),
  ].join("\n");
}

function extractCharacterCandidates(adaptation) {
  const text = collectScriptText(adaptation);
  const stop = new Set([
    "项目",
    "样片",
    "会议室",
    "数据",
    "剧情",
    "角色",
    "镜头",
    "场景",
    "场戏",
    "深夜",
    "真人剧",
    "点众",
    "科技",
    "业务",
    "模型",
    "链路",
    "旁白",
    "用户",
    "理由",
    "技术",
    "参数",
    "生成",
    "界面",
    "剧情片",
    "台词",
    "模块",
    "晨光",
    "百叶",
    "发送",
    "键转",
  ]);

  const patterns = [
    /(?:^|[，。；：、\s\n“”"'‘’【】（）()])([\u4e00-\u9fa5]{2,3})(?=(?:将|把|对|向|在|从|正|默默|突然|快速|调试|收到|冲进|走进|看着|盯着|按住|说|问|答|听|拿|坐|站|抬|调出))/g,
    /(?:^|[，。；：、\s\n“”"'‘’【】（）()])([\u4e00-\u9fa5]{2,3})(?=[:：])/g,
  ];

  const names = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = match[1];
      if (!value || stop.has(value) || names.includes(value)) {
        continue;
      }
      names.push(value);
    }
  }

  if (!names.length) {
    for (const value of uniqueNamesFromText(text)) {
      if (!stop.has(value) && !names.includes(value)) {
        names.push(value);
      }
    }
  }

  return names.slice(0, 3);
}

function isLikelyCharacterName(name, adaptation) {
  const scriptText = collectScriptText(adaptation);
  if (!name || !scriptText) {
    return false;
  }
  if (!scriptText.includes(name)) {
    return false;
  }
  const banned = ["工牌", "键盘", "报告", "进度条", "工作台", "会议室", "玻璃", "倒影", "样片", "标题", "平台", "午夜"];
  return !banned.some((item) => name.includes(item));
}

function validateCharacterPayload(payload, adaptation) {
  const candidates = extractCharacterCandidates(adaptation);
  const characters = payload.characters || [];
  if (!characters.length) {
    throw buildValidationError("主体分析失败：AI 未返回任何角色。", {
      expectedNames: candidates,
    });
  }

  const invalidNames = characters
    .map((item) => item.name)
    .filter((name) => !isLikelyCharacterName(name, adaptation));

  if (invalidNames.length) {
    throw buildValidationError("主体分析失败：AI 返回的角色名未在剧本正文中正确出现。", {
      invalidNames,
      expectedNames: candidates,
    });
  }

  return payload;
}

function inferStyleFromAdaptation(adaptation) {
  return adaptation?.style_preset || "写实";
}

function inferSceneName(adaptation, index) {
  const sceneHint = adaptation?.subject_hints?.scenes?.[index];
  if (typeof sceneHint === "string" && sceneHint.trim()) {
    return sceneHint.trim();
  }
  if (sceneHint?.name) {
    return sceneHint.name;
  }
  return `核心场景${index + 1}`;
}

function inferPropName(adaptation, index) {
  const propHint = adaptation?.subject_hints?.props?.[index];
  if (typeof propHint === "string" && propHint.trim()) {
    return propHint.trim();
  }
  if (propHint?.name) {
    return propHint.name;
  }
  return `关键道具${index + 1}`;
}

function buildProfessionalCharacterDescription({
  name,
  gender,
  age,
  wardrobe,
  hairstyle,
  face,
  figure,
  accessories,
  style,
}) {
  const genderText = gender === "male" ? "男性" : gender === "female" ? "女性" : "人物";
  return [
    `8K画质，${style}风格，电影级摄影`,
    `${age}${genderText}，${figure}，${hairstyle}，${face}`,
    `${wardrobe}${accessories ? `，${accessories}` : ""}`,
    "左区：角色正脸特写，面部占满左区，五官、发型、配饰清晰，无身体入镜、无遮挡变形",
    "右区：标准角色设定三视图，横向排列侧视图、正视图、背视图，从头到脚完整无遮挡",
    "核心约束：特写与三视图为同一角色，五官、服装、配饰、体态100%一致",
    "背景要求：干净纯色或浅灰背景，角色无多余干扰元素",
    "摄影要求：统一85mm焦距，平视，无畸变",
    "状态要求：无剧烈动作，中性或克制表情，自然站立，双手自然下垂，无手持物",
  ].join("；");
}

function buildSubjectPrompt(subject, kind) {
  const prompt = subject.reference_prompt || subject.full_description || subject.continuity_prompt || "";
  const noTextConstraint = "硬性约束：画面中禁止出现任何文字、数字、字母、标签、标题、说明、对白字幕、UI界面字样、水印、logo、品牌名称、海报排版元素。不要把角色名、年龄、角色定位、场景说明直接渲染进画面。";
  if (kind === "character") {
    return [
      prompt,
      `角色定位：${subject.role || "未设定"}。`,
      subject.age_range ? `年龄段：${subject.age_range}。` : "",
      subject.voice_style ? `声音气质：${subject.voice_style}。` : "",
      subject.negative_prompt ? `避免：${subject.negative_prompt}。` : "",
      noTextConstraint,
      "输出为专业角色设定图，严格执行左区正脸特写与右区标准三视图，不要擅自改风格。",
    ].filter(Boolean).join(" ");
  }

  if (kind === "scene") {
    return [
      prompt,
      subject.location ? `地点：${subject.location}。` : "",
      subject.negative_prompt ? `避免：${subject.negative_prompt}。` : "",
      noTextConstraint,
      "输出为专业场景设定图，环境结构稳定，便于后续镜头复用，不要擅自改风格。",
    ].filter(Boolean).join(" ");
  }

  return [
    prompt,
    subject.negative_prompt ? `避免：${subject.negative_prompt}。` : "",
    noTextConstraint,
    "输出为专业道具设定图，单一主体，材质和结构清晰，不要擅自改风格。",
  ].filter(Boolean).join(" ");
}

function subjectStem(subject, defaultName) {
  return String(subject.name || defaultName).replaceAll(/\s+/g, "_");
}

function imageMimeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
  }[ext] || "image/png";
}

async function buildSubjectReferenceInputs(paths, items = []) {
  const results = [];
  for (const item of items) {
    if (!item?.path) {
      continue;
    }
    const absolutePath = path.join(paths.outputDir, item.path);
    const buffer = await fs.readFile(absolutePath);
    const mimeType = imageMimeFromPath(absolutePath);
    results.push({
      ...item,
      base64: buffer.toString("base64"),
      dataUri: `data:${mimeType};base64,${buffer.toString("base64")}`,
    });
  }
  return results;
}

async function renderSubjectReference({ client, model, subject, kind, paths, index, logger }) {
  const safeName = subjectStem(subject, `${kind}_${index + 1}`);
  const prompt = buildSubjectPrompt(subject, kind);
  await writeText(path.join(paths.dirs.roleReference, `${safeName}.prompt.txt`), prompt);

  const imagePath = `${safeName}.png`;
  const generatedAt = new Date().toISOString();
  const referenceImages = await buildSubjectReferenceInputs(paths, subject.reference_images || []);
  const image = logger
    ? await logger.measure(
        {
          event: "ai",
          step: `subject_reference:${kind}:${subject.name}`,
          model,
          provider: "image",
        },
        () => client.generateImage({
          model,
          prompt,
          aspectRatio: "16:9",
          referenceImages,
        }),
      )
    : await client.generateImage({
        model,
        prompt,
        aspectRatio: "16:9",
        referenceImages,
      });
  await fs.writeFile(path.join(paths.dirs.roleReference, imagePath), image.buffer);
  await writeJson(path.join(paths.dirs.roleReference, `${safeName}.meta.json`), {
    model,
    usage: image.usage || null,
    kind,
    name: subject.name,
    status: "ok",
    generatedAt,
  });

  return {
    key: subject.name,
    name: subject.name,
    role: subject.role || kind,
    kind,
    status: "ok",
    imagePath,
    promptPath: `${safeName}.prompt.txt`,
    model,
    generatedAt,
  };
}

function findSubjectReferenceAssets(projectDetail, refs = []) {
  const all = [
    ...(projectDetail?.artifacts?.roleReferences || []),
    ...(projectDetail?.artifacts?.sceneReferences || []),
    ...(projectDetail?.artifacts?.propReferences || []),
  ];
  return refs
    .map((ref) => all.find((item) => item.kind === ref.kind && item.key === ref.key))
    .filter(Boolean);
}

async function buildMediaReferenceInputs(projectDetail, paths, shot) {
  const subjectAssets = findSubjectReferenceAssets(projectDetail, shot.subject_refs || []);
  const combined = [
    ...subjectAssets.map((item) => ({
      path: item.imagePath || item.path,
      name: item.name,
    })),
    ...(shot.reference_images || []).map((item) => ({
      path: item.path,
      name: item.name,
    })),
  ];
  return buildReferenceInputs(paths.outputDir, combined);
}

function extractSelectedShotMedia(shot) {
  const selectedFrame = (shot.frame_assets || []).find((item) => item.id === shot.selected_frame_asset_id)
    || shot.frame_assets?.[0]
    || null;
  const selectedVideo = (shot.video_assets || []).find((item) => item.id === shot.selected_video_asset_id)
    || shot.video_assets?.[0]
    || null;
  return { selectedFrame, selectedVideo };
}

function syncManifestShotsFromWorkbench(manifest, workbench) {
  manifest.shots = (workbench?.shots || [])
    .map((shot) => {
      const { selectedFrame } = extractSelectedShotMedia(shot);
      if (!selectedFrame || !shot.audio_asset?.path) {
        return null;
      }
      return {
        shotId: shot.shot_id,
        speaker: shot.audio_config?.speaker || shot.speaker || "旁白",
        durationSec: Number(shot.duration_sec || 4),
        imageStatus: "ok",
        audioStatus: "ok",
        imagePath: selectedFrame.path,
        audioPath: shot.audio_asset.path,
        subtitle: shot.dialogue || shot.audio_config?.text || "",
        videoPrompt: shot.video_prompt || "",
        generatedAt: selectedFrame.generatedAt || shot.audio_asset.generatedAt,
        imageModel: selectedFrame.model || "",
      };
    })
    .filter(Boolean);
}

async function renderStaticSegmentForShot(paths, shot) {
  const { selectedFrame } = extractSelectedShotMedia(shot);
  if (!selectedFrame || !shot.audio_asset?.path) {
    throw new Error("当前镜头缺少静帧或配音，无法生成片段。");
  }
  const outputPath = path.join(paths.dirs.video, `${shot.shot_id}.mp4`);
  await renderSegment({
    imagePath: path.join(paths.outputDir, selectedFrame.path),
    audioPath: path.join(paths.outputDir, shot.audio_asset.path),
    outputPath,
    durationSec: Number(shot.duration_sec || 4),
  });
  return path.relative(paths.outputDir, outputPath);
}

async function markMediaArtifactsUpdated(project) {
  project.stageState.media = {
    status: "done",
    updatedAt: new Date().toISOString(),
    error: null,
  };
  project.stageState.output = {
    status: "stale",
    updatedAt: null,
    error: null,
  };
  project.stageState.video = {
    status: "stale",
    updatedAt: null,
    error: null,
  };
  await writeProject(project);
}

async function generateMediaShotImageInternal({ project, projectDetail, client, paths, manifest, shotId }) {
  const workbench = await readMediaWorkbench(project.id);
  const shot = workbench.shots.find((item) => item.shot_id === shotId);
  if (!shot) {
    throw new Error("未找到当前镜头。");
  }

  const logger = await createPipelineLogger({
    projectId: project.id,
    stage: "media",
    outputDir: paths.outputDir,
  });
  const prompt = shot.image_prompt || shot.shot_description || "";
  if (!prompt.trim()) {
    throw new Error("当前镜头缺少图片提示词。");
  }
  const referenceImages = await buildMediaReferenceInputs(projectDetail, paths, shot);
  const result = await logger.measure(
    {
      event: "ai",
      step: `media_image:${shotId}`,
      model: project.models.shotImage,
      provider: "image",
    },
    () => client.generateImage({
      model: project.models.shotImage,
      prompt,
      aspectRatio: project.models.scriptRatio || "16:9",
      referenceImages,
    }),
  );
  const safeId = shotId.replaceAll("/", "_");
  const assetPath = path.join(paths.dirs.images, `${safeId}-${Date.now()}.png`);
  await fs.writeFile(assetPath, result.buffer);
  const relativePath = path.relative(paths.outputDir, assetPath);
  const asset = createFrameAsset({
    path: relativePath,
    model: project.models.shotImage,
    prompt,
  });

  const nextShot = appendFrameAsset(shot, asset);
  await patchMediaShot(project.id, shotId, nextShot);
  const nextWorkbench = await readMediaWorkbench(project.id);
  syncManifestShotsFromWorkbench(manifest, nextWorkbench);
  await saveManifest(project.id, manifest);
  await markMediaArtifactsUpdated(project);
  return readProjectDetail(project.id);
}

async function generateMediaShotAudioInternal({ project, client, paths, manifest, shotId, previewOnly = false }) {
  const workbench = await readMediaWorkbench(project.id);
  const shot = workbench.shots.find((item) => item.shot_id === shotId);
  if (!shot) {
    throw new Error("未找到当前镜头。");
  }
  const logger = await createPipelineLogger({
    projectId: project.id,
    stage: "media",
    outputDir: paths.outputDir,
  });
  const text = shot.audio_config?.text || shot.dialogue || "";
  if (!text.trim()) {
    throw new Error("当前镜头缺少台词文本。");
  }
  const voiceType = shot.audio_config?.voiceType || config.qiniu.voices.narrator;
  const result = await logger.measure(
    {
      event: "ai",
      step: `media_audio:${shotId}`,
      model: voiceType,
      provider: "tts",
    },
    () => client.synthesizeSpeech({
      text,
      voiceType,
      speedRatio: Number(shot.audio_config?.speedRatio || 1),
    }),
  );
  if (previewOnly) {
    return {
      buffer: result.buffer,
      durationMs: result.durationMs,
      voiceType,
    };
  }

  const safeId = shotId.replaceAll("/", "_");
  const assetPath = path.join(paths.dirs.audio, `${safeId}-${Date.now()}.mp3`);
  await fs.writeFile(assetPath, result.buffer);
  const relativePath = path.relative(paths.outputDir, assetPath);
  const asset = createAudioAsset({
    path: relativePath,
    voiceType,
    durationMs: result.durationMs,
  });
  await patchMediaShot(project.id, shotId, {
    audio_asset: asset,
    duration_sec: Math.max(Number(shot.duration_sec || 4), (result.durationMs || 0) / 1000 + 0.35),
  });
  const nextWorkbench = await readMediaWorkbench(project.id);
  syncManifestShotsFromWorkbench(manifest, nextWorkbench);
  await saveManifest(project.id, manifest);
  await markMediaArtifactsUpdated(project);
  return readProjectDetail(project.id);
}

async function generateMediaShotVideoInternal({ project, projectDetail, client, paths, manifest, shotId, videoOptions = {} }) {
  const workbench = await readMediaWorkbench(project.id);
  const shot = workbench.shots.find((item) => item.shot_id === shotId);
  if (!shot) {
    throw new Error("未找到当前镜头。");
  }
  const capability = getVideoCapabilities(project.models.shotVideo);
  const logger = await createPipelineLogger({
    projectId: project.id,
    stage: "media",
    outputDir: paths.outputDir,
  });
  const mergedVideoOptions = {
    ...(shot.video_options || {}),
    ...(videoOptions || {}),
  };
  const { selectedFrame } = extractSelectedShotMedia(shot);
  const referenceInputs = await buildMediaReferenceInputs(projectDetail, paths, shot);
  const resolvedTailFramePath = (() => {
    const value = mergedVideoOptions.tailFramePath || "";
    if (value) {
      return value;
    }
    const selectedId = mergedVideoOptions.lastFrameAssetId || "";
    if (!selectedId) {
      return "";
    }
    const frame = (shot.frame_assets || []).find((item) => item.id === selectedId);
    if (frame?.path) {
      return frame.path;
    }
    const ref = (shot.reference_images || []).find((item) => `ref:${item.id || item.path}` === selectedId || item.id === selectedId);
    return ref?.path || "";
  })();
  const resolvedFirstFramePath = (() => {
    if (!capability.supports_first_frame || videoOptions.useFirstFrame === false) {
      return "";
    }
    if (selectedFrame?.path) {
      return selectedFrame.path;
    }
    const firstReferencePath = shot.reference_images?.[0]?.path || "";
    if (firstReferencePath) {
      return firstReferencePath;
    }
    const firstSubjectReference = findSubjectReferenceAssets(projectDetail, shot.subject_refs || [])[0];
    return firstSubjectReference?.imagePath || firstSubjectReference?.path || "";
  })();
  const firstFrame = resolvedFirstFramePath
    ? await fs.readFile(path.join(paths.outputDir, resolvedFirstFramePath))
    : null;
  const tailFrame = capability.supports_last_frame && resolvedTailFramePath
    ? await fs.readFile(path.join(paths.outputDir, resolvedTailFramePath))
    : null;
  const prompt = shot.video_prompt || shot.image_prompt || shot.shot_description || "";
  if (!prompt.trim()) {
    throw new Error("当前镜头缺少视频提示词。");
  }
  const task = await logger.measure(
    {
      event: "ai",
      step: `media_video:${shotId}`,
      model: project.models.shotVideo,
      provider: "video",
      meta: {
        capability: [
          capability.supports_first_frame ? "首帧" : "",
          capability.supports_last_frame ? "尾帧" : "",
          capability.supports_subject_reference ? "主体参考" : "",
        ].filter(Boolean).join(" / "),
      },
    },
    () => client.createVideoTask({
      model: project.models.shotVideo,
      prompt,
      imageBuffer: firstFrame,
      lastFrameBuffer: tailFrame,
      referenceImages: capability.supports_reference_images || capability.supports_subject_reference ? referenceInputs : [],
      seconds: Number(mergedVideoOptions.durationSec || shot.duration_sec || 5),
      aspectRatio: project.models.scriptRatio || "16:9",
      mode: mergedVideoOptions.mode || "std",
      enableAudio: capability.supports_audio_generation ? Boolean(mergedVideoOptions.enableAudio) : false,
      resolution: mergedVideoOptions.resolution || "",
    }),
  );
  const downloadUrl = await logger.measure(
    {
      event: "ai",
      step: `media_video_poll:${shotId}`,
      model: project.models.shotVideo,
      provider: task.provider,
    },
    () => pollVideoResult(client, project.models.shotVideo, task.provider, task.id),
  );
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`下载视频失败: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const outputPath = path.join(paths.dirs.videoModel, `${shotId.replaceAll("/", "_")}-${Date.now()}.mp4`);
  await fs.writeFile(outputPath, buffer);
  const relativePath = path.relative(paths.outputDir, outputPath);
  const asset = createVideoAsset({
    path: relativePath,
    model: project.models.shotVideo,
    prompt,
    durationSec: Number(mergedVideoOptions.durationSec || shot.duration_sec || 5),
    provider: task.provider,
    settings: {
      useFirstFrame: Boolean(firstFrame),
      useLastFrame: Boolean(tailFrame),
      referenceCount: referenceInputs.length,
      mode: mergedVideoOptions.mode || "std",
      enableAudio: Boolean(mergedVideoOptions.enableAudio),
    },
  });
  await patchMediaShot(project.id, shotId, appendVideoAsset(shot, asset));
  await saveManifest(project.id, manifest);
  await markMediaArtifactsUpdated(project);
  return readProjectDetail(project.id);
}

async function saveChatStage({
  client,
  model,
  messages,
  stageDir,
  fileStem,
  logger,
  step,
}) {
  try {
    const result = logger
      ? await logger.measure(
          {
            event: "ai",
            step: step || fileStem,
            model,
            provider: "chat",
          },
          () => client.chatJson({
            model,
            systemPrompt: messages.system,
            userPrompt: messages.user,
          }),
        )
      : await client.chatJson({
          model,
          systemPrompt: messages.system,
          userPrompt: messages.user,
        });

    await writeText(path.join(stageDir, `${fileStem}.raw.txt`), result.rawText);
    await writeJson(path.join(stageDir, `${fileStem}.json`), result.parsed);
    await writeJson(path.join(stageDir, `${fileStem}.meta.json`), {
      model: result.model,
      usage: result.usage,
      responseId: result.responseId,
      status: "ok",
    });

    return result.parsed;
  } catch (error) {
    await writeText(path.join(stageDir, `${fileStem}.raw.txt`), `ERROR\n\n${error.message}\n`);
    await writeJson(path.join(stageDir, `${fileStem}.meta.json`), {
      model,
      status: "error",
      message: error.message,
    });
    throw error;
  }
}

async function runTextComparisons({ client, stageName, messages, outputDir, models }) {
  if (!config.qiniu.compareModels.text.length) {
    return;
  }
  const comparisonDir = path.join(outputDir, "comparisons", "text", stageName);
  await ensureDir(comparisonDir);

  for (const model of config.qiniu.compareModels.text) {
    try {
      const result = await client.chatJson({
        model,
        systemPrompt: messages.system,
        userPrompt: messages.user,
      });
      const safeName = model.replaceAll("/", "__");
      await writeText(path.join(comparisonDir, `${safeName}.raw.txt`), result.rawText);
      await writeJson(path.join(comparisonDir, `${safeName}.json`), result.parsed);
      await writeJson(path.join(comparisonDir, `${safeName}.meta.json`), {
        model: result.model,
        usage: result.usage,
        responseId: result.responseId,
        primaryModel: models,
      });
    } catch (error) {
      await writeJson(path.join(comparisonDir, `${model.replaceAll("/", "__")}.error.json`), {
        model,
        status: "error",
        message: error.message,
      });
    }
  }
}

async function renderSegment({ imagePath, audioPath, outputPath, durationSec }) {
  const frames = Math.max(1, Math.ceil(durationSec * config.video.fps));
  const useKenBurns = config.video.renderMode === "kenburns";
  const videoFilter = useKenBurns
    ? [
        `scale=${config.video.width}:${config.video.height}:force_original_aspect_ratio=increase`,
        `crop=${config.video.width}:${config.video.height}`,
        `zoompan=z='min(zoom+0.0012,1.10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${config.video.width}x${config.video.height}:fps=${config.video.fps}`,
        "format=yuv420p",
      ].join(",")
    : [
        `scale=${config.video.width}:${config.video.height}:force_original_aspect_ratio=decrease`,
        `pad=${config.video.width}:${config.video.height}:(ow-iw)/2:(oh-ih)/2`,
        "format=yuv420p",
      ].join(",");

  await runCommand(config.ffmpegPath, [
    "-y",
    "-loop",
    "1",
    "-framerate",
    String(config.video.fps),
    "-i",
    imagePath,
    "-i",
    audioPath,
    "-vf",
    videoFilter,
    "-af",
    "apad",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-t",
    String(durationSec),
    outputPath,
  ]);
}

async function concatSegments(listPath, outputPath) {
  await runCommand(config.ffmpegPath, [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    outputPath,
  ]);
}

async function burnSubtitles(videoPath, subtitlesPath, outputPath) {
  const style =
    "FontSize=18,PrimaryColour=&Hffffff&,OutlineColour=&H40000000&,BorderStyle=1,Outline=2,Shadow=0,MarginV=32";
  await runCommand(config.ffmpegPath, [
    "-y",
    "-i",
    videoPath,
    "-vf",
    `subtitles=${escapeSubtitlePath(subtitlesPath)}:force_style='${style}'`,
    "-c:a",
    "copy",
    outputPath,
  ]);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readOptionalJson(filePath) {
  try {
    return await readJson(filePath);
  } catch {
    return null;
  }
}

async function loadManifest(projectId, project) {
  const paths = getProjectPaths(projectId);
  const manifest = (await readOptionalJson(paths.manifestPath)) || {
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
  return manifest;
}

function upsertStageRecord(manifest, stage, model, output) {
  const next = { stage, model, output, updatedAt: new Date().toISOString() };
  manifest.stages = (manifest.stages || []).filter((item) => item.stage !== stage);
  manifest.stages.push(next);
}

async function saveManifest(projectId, manifest) {
  const paths = getProjectPaths(projectId);
  await writeJson(paths.manifestPath, manifest);
}

async function saveModelMatrix(project, manifest) {
  const paths = getProjectPaths(project.id);
  await writeJson(paths.modelMatrixPath, {
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
  });
}

async function executeAdaptation(project, client, paths, manifest, onProgress) {
  await reportProgress(onProgress, "正在整理故事并生成剧本工作稿");
  const storyText = project.storyText.trim() || (await readText(path.join(paths.dirs.input, "story.txt")));
  if (!storyText.trim()) {
    throw new Error("请先输入故事文本。");
  }
  await writeText(path.join(paths.dirs.input, "story.txt"), `${storyText.trim()}\n`);
  const messages = buildAdaptationMessages(storyText, project.models);
  const adaptation = await saveChatStage({
    client,
    model: project.models.adaptation,
    messages,
    stageDir: paths.dirs.adaptation,
    fileStem: "adaptation",
    logger: manifest.logger,
    step: "adaptation_chat",
  });
  upsertStageRecord(manifest, "adaptation", project.models.adaptation, "02-adaptation/adaptation.json");
  manifest.outputs.adaptation = "02-adaptation/adaptation.json";
  await runTextComparisons({
    client,
    stageName: "adaptation",
    messages,
    outputDir: paths.outputDir,
    models: project.models.adaptation,
  });
  return adaptation;
}

async function analyzeSubjects(project, client, paths, manifest, onProgress) {
  await reportProgress(onProgress, "正在分析主体");
  const adaptation = await readOptionalJson(path.join(paths.dirs.adaptation, "adaptation.json"));
  if (!adaptation) {
    throw new Error("请先完成剧本阶段。");
  }
  const messages = buildCharacterMessages(adaptation, project.models);
  const payload = await saveChatStage({
    client,
    model: project.models.characters,
    messages,
    stageDir: paths.dirs.characters,
    fileStem: "characters",
    logger: manifest.logger,
    step: "characters_chat",
  });
  const subjectPayload = validateCharacterPayload(
    normalizeCharacterStagePayload(payload, adaptation),
    adaptation,
  );
  await writeJson(path.join(paths.dirs.characters, "characters.json"), subjectPayload);
  upsertStageRecord(manifest, "characters", project.models.characters, "03-characters/characters.json");
  manifest.outputs.characters = "03-characters/characters.json";
  return subjectPayload;
}

async function executeCharacters(project, client, paths, manifest, onProgress) {
  return analyzeSubjects(project, client, paths, manifest, onProgress);
}

async function renderAllSubjectReferencesForProject(project, client, paths, manifest, onProgress) {
  const adaptation = await readOptionalJson(path.join(paths.dirs.adaptation, "adaptation.json"));
  const payload = normalizeCharacterStagePayload(
    await readOptionalJson(path.join(paths.dirs.characters, "characters.json")),
    adaptation,
  );

  const subjectReferences = [];
  const subjectEntries = [
    ...payload.characters.map((item) => ({ kind: "character", subject: item })),
    ...payload.scenes.map((item) => ({ kind: "scene", subject: item })),
    ...payload.props.map((item) => ({ kind: "prop", subject: item })),
  ];

  for (let index = 0; index < subjectEntries.length; index += 1) {
    const { kind, subject } = subjectEntries[index];
    await reportProgress(onProgress, `正在生成${kind === "character" ? "角色" : kind === "scene" ? "场景" : "道具"}：${subject.name}`, {
      current: index + 1,
      total: subjectEntries.length,
    });
    subjectReferences.push(await renderSubjectReference({
      client,
      model: project.models.roleImage,
      subject,
      kind,
      paths,
      index,
      logger: manifest.logger,
    }));
  }
  manifest.subjectReferences = subjectReferences;
  manifest.roleReferences = subjectReferences.filter((item) => item.kind === "character");
  manifest.outputs.roleReference = "04-role-reference";
  return payload;
}

async function executeStoryboard(project, client, paths, manifest, onProgress) {
  await reportProgress(onProgress, "正在拆解分镜");
  const adaptation = await readOptionalJson(path.join(paths.dirs.adaptation, "adaptation.json"));
  const characters = await readOptionalJson(path.join(paths.dirs.characters, "characters.json"));
  if (!adaptation || !characters) {
    throw new Error("请先完成角色设定阶段。");
  }
  const messages = buildStoryboardMessages(adaptation, characters, project.models);
  const storyboard = await saveChatStage({
    client,
    model: project.models.storyboard,
    messages,
    stageDir: paths.dirs.storyboard,
    fileStem: "storyboard",
    logger: manifest.logger,
    step: "storyboard_chat",
  });
  const normalizedStoryboard = normalizeStoryboardPayload(storyboard, adaptation);
  await writeJson(path.join(paths.dirs.storyboard, "storyboard.json"), normalizedStoryboard);
  upsertStageRecord(manifest, "storyboard", project.models.storyboard, "05-storyboard/storyboard.json");
  manifest.outputs.storyboard = "05-storyboard/storyboard.json";
  await runTextComparisons({
    client,
    stageName: "storyboard",
    messages,
    outputDir: paths.outputDir,
    models: project.models.storyboard,
  });
  return normalizedStoryboard;
}

async function executeMedia(project, client, paths, manifest, onProgress) {
  await reportProgress(onProgress, "正在按镜头批量生成静帧与配音");
  const workbench = await readMediaWorkbench(project.id);
  if (!workbench?.shots?.length) {
    throw new Error("当前没有可执行的镜头。");
  }

  for (let index = 0; index < workbench.shots.length; index += 1) {
    const shot = workbench.shots[index];
    await reportProgress(onProgress, `正在处理镜头 ${index + 1}/${workbench.shots.length}`, {
      current: index + 1,
      total: workbench.shots.length,
      shotId: shot.shot_id,
    });
    const projectDetail = await readProjectDetail(project.id);
    await generateMediaShotImageInternal({
      project,
      projectDetail,
      client,
      paths,
      manifest,
      shotId: shot.shot_id,
    });
    await generateMediaShotAudioInternal({
      project,
      client,
      paths,
      manifest,
      shotId: shot.shot_id,
    });
  }
  manifest.outputs.subtitles = "08-subtitles/subtitles.srt";
  upsertStageRecord(manifest, "media", project.models.shotImage, "06-images + 07-audio + 08-subtitles");
}

async function executeOutput(project, paths, manifest, onProgress) {
  await reportProgress(onProgress, "正在合成静态成片");
  const workbench = await readMediaWorkbench(project.id);
  if (!workbench?.shots?.length) {
    throw new Error("当前没有可用于合成的镜头。");
  }

  const subtitlesPath = path.join(paths.dirs.subtitles, "subtitles.srt");
  const concatListPath = path.join(paths.dirs.video, "segments.txt");
  const roughVideoPath = path.join(paths.dirs.video, "rough-output.mp4");
  const outputVideoPath = path.join(paths.dirs.video, "output.mp4");

  const subtitles = [];
  const segmentPaths = [];
  let cursor = 0;

  for (let index = 0; index < workbench.shots.length; index += 1) {
    const shot = workbench.shots[index];
    await reportProgress(onProgress, `正在合成镜头 ${index + 1}/${workbench.shots.length}`, {
      current: index + 1,
      total: workbench.shots.length,
      shotId: shot.shot_id,
    });
    const segmentRelativePath = await renderStaticSegmentForShot(paths, shot);
    const durationSec = Number(shot.duration_sec || 4);
    segmentPaths.push(path.join(paths.outputDir, segmentRelativePath));
    subtitles.push([
      String(index + 1),
      `${secondsToSrtTime(cursor)} --> ${secondsToSrtTime(cursor + durationSec)}`,
      shot.dialogue || shot.audio_config?.text || "",
      "",
    ].join("\n"));
    cursor += durationSec;
  }

  await writeText(subtitlesPath, subtitles.join("\n"));
  await writeText(
    concatListPath,
    segmentPaths.map((filePath) => `file '${filePath.replaceAll("'", "'\\''")}'`).join("\n"),
  );
  await concatSegments(concatListPath, roughVideoPath);
  await burnSubtitles(roughVideoPath, subtitlesPath, outputVideoPath);
  manifest.outputs.outputVideo = "09-video/output.mp4";
  manifest.runSummary = {
    textModels: {
      adaptation: project.models.adaptation,
      characters: project.models.characters,
      storyboard: project.models.storyboard,
    },
    imageModels: {
      roleReference: project.models.roleImage,
      shots: project.models.shotImage,
    },
    videoStage: {
      plannedModel: project.models.shotVideo,
      implemented: false,
    },
  };
  manifest.completedAt = new Date().toISOString();
  upsertStageRecord(manifest, "output", "static-compose", "09-video/output.mp4");
}

async function pollVideoResult(client, model, provider, id) {
  while (true) {
    const result = await client.getVideoTask({ model, provider, id });
    const status = String(result.status || "").toLowerCase();
    if (["succeeded", "success", "completed"].includes(status)) {
      if (!result.url) {
        throw new Error("视频任务已完成，但未返回下载地址。");
      }
      return result.url;
    }
    if (["failed", "error", "cancelled"].includes(status)) {
      throw new Error(`视频任务失败: ${result.errorMessage || status}`);
    }
    await sleep(5000);
  }
}

async function executeVideo(project, client, paths, manifest, onProgress) {
  const workbench = await readMediaWorkbench(project.id);
  if (!workbench?.shots?.length) {
    throw new Error("请先完成故事板阶段，确保已有镜头。");
  }
  const renderedVideoPaths = [];
  for (let index = 0; index < workbench.shots.length; index += 1) {
    const shot = workbench.shots[index];
    const { selectedFrame } = extractSelectedShotMedia(shot);
    if (!selectedFrame?.path) {
      throw new Error(`镜头 ${shot.shot_id} 缺少首帧素材，无法批量生成视频。`);
    }
    await reportProgress(onProgress, `正在生成视频镜头 ${index + 1}/${workbench.shots.length}`, {
      current: index + 1,
      total: workbench.shots.length,
      shotId: shot.shot_id,
    });
    await generateMediaShotVideoInternal({
      project,
      projectDetail: await readProjectDetail(project.id),
      client,
      paths,
      manifest,
      shotId: shot.shot_id,
      videoOptions: shot.video_options || {},
    });
    const nextWorkbench = await readMediaWorkbench(project.id);
    const nextShot = nextWorkbench.shots.find((item) => item.shot_id === shot.shot_id);
    const { selectedVideo } = extractSelectedShotMedia(nextShot || {});
    if (!selectedVideo?.path) {
      throw new Error(`镜头 ${shot.shot_id} 视频生成后未找到结果文件。`);
    }
    renderedVideoPaths.push(path.join(paths.outputDir, selectedVideo.path));
  }

  const finalVideoPath = path.join(paths.dirs.videoModel, "output.mp4");
  if (renderedVideoPaths.length === 1) {
    await fs.copyFile(renderedVideoPaths[0], finalVideoPath);
  } else {
    const concatPath = path.join(paths.dirs.videoModel, "segments.txt");
    await writeText(
      concatPath,
      renderedVideoPaths.map((filePath) => `file '${filePath.replaceAll("'", "'\\''")}'`).join("\n"),
    );
    await concatSegments(concatPath, finalVideoPath);
  }

  manifest.outputs.videoOutput = "10-video-model/output.mp4";
  manifest.runSummary = {
    ...(manifest.runSummary || {}),
    videoStage: {
      plannedModel: project.models.shotVideo,
      implemented: true,
    },
  };
  upsertStageRecord(manifest, "video", project.models.shotVideo, "10-video-model/output.mp4");
}

export async function generateMediaShotImage(projectId, shotId) {
  const project = await readProject(projectId);
  const projectDetail = await readProjectDetail(projectId);
  const paths = await ensureProjectWorkspace(projectId);
  const client = new QiniuMaaSClient(config.qiniu);
  const manifest = await loadManifest(projectId, project);
  return generateMediaShotImageInternal({ project, projectDetail, client, paths, manifest, shotId });
}

export async function generateMediaShotAudio(projectId, shotId, options = {}) {
  const project = await readProject(projectId);
  const paths = await ensureProjectWorkspace(projectId);
  const client = new QiniuMaaSClient(config.qiniu);
  const manifest = await loadManifest(projectId, project);
  return generateMediaShotAudioInternal({
    project,
    client,
    paths,
    manifest,
    shotId,
    previewOnly: Boolean(options.previewOnly),
  });
}

export async function generateMediaShotVideo(projectId, shotId, options = {}) {
  const project = await readProject(projectId);
  const projectDetail = await readProjectDetail(projectId);
  const paths = await ensureProjectWorkspace(projectId);
  const client = new QiniuMaaSClient(config.qiniu);
  const manifest = await loadManifest(projectId, project);
  return generateMediaShotVideoInternal({
    project,
    projectDetail,
    client,
    paths,
    manifest,
    shotId,
    videoOptions: options,
  });
}

export async function regenerateSubjectReference(projectId, { kind, key }) {
  const project = await readProject(projectId);
  const paths = await ensureProjectWorkspace(projectId);
  const client = new QiniuMaaSClient(config.qiniu);
  const adaptation = await readOptionalJson(path.join(paths.dirs.adaptation, "adaptation.json"));
  const payload = normalizeCharacterStagePayload(
    await readOptionalJson(path.join(paths.dirs.characters, "characters.json")),
    adaptation,
  );

  const list = {
    character: payload.characters,
    scene: payload.scenes,
    prop: payload.props,
  }[kind];

  if (!list) {
    throw new Error("未知主体类型。");
  }

  const index = list.findIndex((item) => item.name === key);
  if (index === -1) {
    throw new Error("未找到要重生成的主体。");
  }

  const manifest = await loadManifest(projectId, project);
  const logger = await createPipelineLogger({
    projectId,
    stage: "subject_reference",
    outputDir: paths.outputDir,
  });
  try {
    await logger.log({
      event: "stage",
      step: `subject_reference:${kind}:${key}`,
      status: "start",
      model: project.models.roleImage,
      provider: "image",
      message: "开始重生成单个主体参考图",
    });
    const nextReference = await renderSubjectReference({
      client,
      model: project.models.roleImage,
      subject: list[index],
      kind,
      paths,
      index,
      logger,
    });

    const existingReferences = manifest.subjectReferences || manifest.roleReferences || [];
    manifest.subjectReferences = [
      ...existingReferences.filter((item) => !(item.kind === kind && (item.key || item.name) === key)),
      nextReference,
    ];
    manifest.roleReferences = manifest.subjectReferences.filter((item) => item.kind === "character");
    await saveManifest(projectId, manifest);
    await saveModelMatrix(project, manifest);

    project.stageState.characters = {
      status: "done",
      updatedAt: new Date().toISOString(),
      error: null,
    };
    await writeProject(project);
    await logger.log({
      event: "stage",
      step: `subject_reference:${kind}:${key}`,
      status: "done",
      model: project.models.roleImage,
      provider: "image",
      message: "单个主体参考图生成完成",
    });
    return readProjectDetail(projectId);
  } catch (error) {
    await logger.log({
      event: "stage",
      step: `subject_reference:${kind}:${key}`,
      status: "error",
      model: project.models.roleImage,
      provider: "image",
      error: error.message,
      message: "单个主体参考图生成失败",
    });
    throw error;
  }
}

export async function renderAllSubjectReferences(projectId) {
  const project = await readProject(projectId);
  const paths = await ensureProjectWorkspace(projectId);
  const client = new QiniuMaaSClient(config.qiniu);
  const manifest = await loadManifest(projectId, project);
  const logger = await createPipelineLogger({
    projectId,
    stage: "subject_reference",
    outputDir: paths.outputDir,
  });
  try {
    await logger.log({
      event: "stage",
      step: "subject_reference:batch",
      status: "start",
      model: project.models.roleImage,
      provider: "image",
      message: "开始批量生成主体参考图",
    });
    manifest.logger = logger;
    await renderAllSubjectReferencesForProject(project, client, paths, manifest, null);
    delete manifest.logger;
    await saveManifest(projectId, manifest);
    await saveModelMatrix(project, manifest);
    project.stageState.characters = {
      status: "done",
      updatedAt: new Date().toISOString(),
      error: null,
    };
    await writeProject(project);
    await logger.log({
      event: "stage",
      step: "subject_reference:batch",
      status: "done",
      model: project.models.roleImage,
      provider: "image",
      message: "批量主体参考图生成完成",
    });
    return readProjectDetail(projectId);
  } catch (error) {
    await logger.log({
      event: "stage",
      step: "subject_reference:batch",
      status: "error",
      model: project.models.roleImage,
      provider: "image",
      error: error.message,
      message: "批量主体参考图生成失败",
    });
    throw error;
  }
}

export function assertExecutable(project, stage) {
  const dependencies = {
    adaptation: [],
    characters: ["adaptation"],
    storyboard: ["characters"],
    media: ["storyboard"],
    output: ["media"],
    video: ["media"],
  }[stage] || [];
  for (const dependency of dependencies) {
    if (project.stageState[dependency]?.status !== "done") {
      throw new Error(`请先完成 ${dependency} 阶段。`);
    }
  }
}

export async function runProjectStage(projectId, stage, options = {}) {
  const { onProgress } = options;
  const project = await readProject(projectId);
  assertExecutable(project, stage);
  project.stageState[stage] = {
    status: "running",
    updatedAt: new Date().toISOString(),
    error: null,
  };
  await writeProject(project);

  try {
    const paths = await ensureProjectWorkspace(projectId);
    const client = new QiniuMaaSClient(config.qiniu);
    const manifest = await loadManifest(projectId, project);
    const logger = await createPipelineLogger({
      projectId,
      stage,
      outputDir: paths.outputDir,
    });
    manifest.logger = logger;
    await logger.log({
      event: "stage",
      step: stage,
      status: "start",
      message: "阶段开始执行",
    });

    if (stage === "adaptation") {
      await executeAdaptation(project, client, paths, manifest, onProgress);
      project.stageState.characters = {
        status: "running",
        updatedAt: new Date().toISOString(),
        error: null,
      };
      await writeProject(project);
      await analyzeSubjects(project, client, paths, manifest, onProgress);
      project.stageState.characters = {
        status: "done",
        updatedAt: new Date().toISOString(),
        error: null,
      };
    } else if (stage === "characters") {
      await executeCharacters(project, client, paths, manifest, onProgress);
    } else if (stage === "storyboard") {
      await executeStoryboard(project, client, paths, manifest, onProgress);
    } else if (stage === "media") {
      await executeMedia(project, client, paths, manifest, onProgress);
    } else if (stage === "output") {
      await executeOutput(project, paths, manifest, onProgress);
    } else if (stage === "video") {
      await executeVideo(project, client, paths, manifest, onProgress);
    } else {
      throw new Error(`Unknown stage: ${stage}`);
    }

    project.stageState[stage] = {
      status: "done",
      updatedAt: new Date().toISOString(),
      error: null,
    };
    await logger.log({
      event: "stage",
      step: stage,
      status: "done",
      message: "阶段执行完成",
    });
    delete manifest.logger;
    await saveManifest(projectId, manifest);
    await saveModelMatrix(project, manifest);
    await writeProject(project);
    return project;
  } catch (error) {
    project.stageState[stage] = {
      status: "error",
      updatedAt: new Date().toISOString(),
      error: error.message,
    };
    await writeProject(project);
    try {
      const paths = await ensureProjectWorkspace(projectId);
      const logger = await createPipelineLogger({
        projectId,
        stage,
        outputDir: paths.outputDir,
      });
      await logger.log({
        event: "stage",
        step: stage,
        status: "error",
        error: error.message,
        message: "阶段执行失败",
      });
    } catch {}
    throw error;
  }
}
