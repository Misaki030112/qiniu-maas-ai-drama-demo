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
  createPlaceholderPpm,
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
  ensureProjectWorkspace,
  getProjectPaths,
  normalizeCharacterStagePayload,
  readProject,
  readProjectDetail,
  writeProject,
} from "./project-store.js";

async function reportProgress(onProgress, progressText, payload = null) {
  if (!onProgress) {
    return;
  }
  await onProgress({ progressText, payload });
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

function uniqueNamesFromText(text) {
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
  ]);
  const matches = text.match(/[\u4e00-\u9fa5]{2,3}/g) || [];
  const uniq = [];
  for (const item of matches) {
    if (stop.has(item) || uniq.includes(item)) {
      continue;
    }
    uniq.push(item);
  }
  return uniq.slice(0, 2);
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

function buildFallbackCharacters(adaptation) {
  const source = JSON.stringify(adaptation);
  const [nameA = "主角甲", nameB = "主角乙"] = uniqueNamesFromText(source);
  const style = inferStyleFromAdaptation(adaptation);
  return {
    characters: [
      {
        name: nameA,
        role: "核心角色A",
        gender: "female",
        age_range: "28-35",
        personality: ["果断", "目标明确", "压住情绪推进结果"],
        appearance: "主角型女性，造型干净利落，强调辨识度与镜头稳定性。",
        wardrobe: "主色统一的成套服装，剪裁清晰，适合跨镜头稳定复用。",
        visual_anchor: ["主造型清晰", "脸部辨识度高", "服装轮廓稳定"],
        full_description: buildProfessionalCharacterDescription({
          name: nameA,
          gender: "female",
          age: "28至35岁",
          wardrobe: "服装为统一主色调的成套造型，版型利落，鞋履与配饰风格统一",
          hairstyle: "发型整洁，发丝走向清晰，适合长时间连续出镜",
          face: "脸型与五官比例稳定，眉眼鼻唇特征明确，肤质细节自然",
          figure: "体型匀称，身高比例自然",
          accessories: "可带一到两件稳定配饰用于角色识别",
          style,
        }),
        reference_prompt: `${nameA}，${style}风格专业角色设定图，左区正脸特写，右区标准三视图，同一角色一致性严格锁定。`,
        continuity_prompt:
          `${nameA}，${style}风格，角色主造型稳定，脸部特征、发型、服装轮廓和配饰保持一致。`,
        negative_prompt: "卡通感、设定稿崩坏、三视图不统一、多人入镜、畸形手脚、年龄漂移、服装漂移",
        voice_style: "克制、清晰、有识别度",
      },
      {
        name: nameB,
        role: "核心角色B",
        gender: "male",
        age_range: "26-33",
        personality: ["冷静", "理性", "执行稳定"],
        appearance: "主角型男性，面部识别点明确，整体造型适合连续生成。",
        wardrobe: "轮廓明确的稳定服装组合，便于跨镜头保持一致。",
        visual_anchor: ["轮廓稳定", "面部识别点明确", "服装主造型固定"],
        full_description: buildProfessionalCharacterDescription({
          name: nameB,
          gender: "male",
          age: "26至33岁",
          wardrobe: "服装为稳定主造型，版型清晰，鞋履和配件统一",
          hairstyle: "短发或中短发，轮廓利落，发型识别度明确",
          face: "脸型与五官比例稳定，眉眼鼻唇特征清楚，肤质真实",
          figure: "体型自然，站姿稳定，比例清晰",
          accessories: "可保留一到两处高识别细节",
          style,
        }),
        reference_prompt: `${nameB}，${style}风格专业角色设定图，左区正脸特写，右区标准三视图，同一角色一致性严格锁定。`,
        continuity_prompt:
          `${nameB}，${style}风格，角色主造型稳定，脸部特征、发型、服装轮廓和配饰保持一致。`,
        negative_prompt: "卡通感、设定稿崩坏、三视图不统一、多人入镜、畸形手脚、年龄漂移、服装漂移",
        voice_style: "沉稳、清晰、有节制",
      },
    ],
    scenes: (adaptation.subject_hints?.scenes?.length ? adaptation.subject_hints.scenes : [inferSceneName(adaptation, 0)]).slice(0, 3).map((scene, index) => {
      const sceneName = typeof scene === "string" ? scene : scene.name || inferSceneName(adaptation, index);
      const location = typeof scene === "string" ? scene : scene.location || sceneName;
      return {
        name: sceneName,
        location,
        description: `${location}，用于承接剧情推进的核心场景。`,
        full_description:
          `8K画质，${style}风格，电影级摄影；无人物；${location}，空间结构完整，主色调统一，材质和陈设清晰，具备可重复复用的稳定环境元素；构图重心明确，适合后续镜头持续使用。`,
        reference_prompt:
          `8K画质，${style}风格，电影级摄影，${location}，无人物，环境结构完整，主体陈设清晰。`,
        continuity_prompt: `${location}，${style}风格，空间结构和关键陈设稳定，适合后续镜头复用。`,
        negative_prompt: "卡通感、环境崩坏、材质错误、悬浮家具、人物误入、畸形透视",
      };
    }),
    props: [0, 1].map((index) => {
      const propName = inferPropName(adaptation, index);
      return {
        name: propName,
        description: `${propName}，用于剧情推进的关键道具。`,
        full_description:
          `8K画质，${style}风格，电影级摄影；纯净背景，道具设定图；${propName}，材质、颜色、结构细节清晰，标准三视图横向排列，完整展示正面、侧面、背面或关键结构视角。`,
        reference_prompt:
          `8K画质，${style}风格，道具设定图，${propName}，纯净背景，标准三视图，结构完整。`,
        continuity_prompt: `${propName}，${style}风格道具特写，材质清晰，结构稳定，适合后续镜头重复出现。`,
        negative_prompt: "卡通感、悬浮道具、材质错误、尺寸异常、结构崩坏、纹理乱码",
      };
    }),
  };
}

function buildSubjectPrompt(subject, kind) {
  const prompt = subject.reference_prompt || subject.full_description || subject.continuity_prompt || "";
  if (kind === "character") {
    return [
      prompt,
      `角色定位：${subject.role || "未设定"}。`,
      subject.age_range ? `年龄段：${subject.age_range}。` : "",
      subject.voice_style ? `声音气质：${subject.voice_style}。` : "",
      subject.negative_prompt ? `避免：${subject.negative_prompt}。` : "",
      "输出为专业角色设定图，严格执行左区正脸特写与右区标准三视图，不要擅自改风格。",
    ].filter(Boolean).join(" ");
  }

  if (kind === "scene") {
    return [
      prompt,
      subject.location ? `地点：${subject.location}。` : "",
      subject.negative_prompt ? `避免：${subject.negative_prompt}。` : "",
      "输出为专业场景设定图，环境结构稳定，便于后续镜头复用，不要擅自改风格。",
    ].filter(Boolean).join(" ");
  }

  return [
    prompt,
    subject.negative_prompt ? `避免：${subject.negative_prompt}。` : "",
    "输出为专业道具设定图，单一主体，材质和结构清晰，不要擅自改风格。",
  ].filter(Boolean).join(" ");
}

function subjectStem(subject, fallback) {
  return String(subject.name || fallback).replaceAll(/\s+/g, "_");
}

async function renderSubjectReference({ client, model, subject, kind, paths, index }) {
  const safeName = subjectStem(subject, `${kind}_${index + 1}`);
  const prompt = buildSubjectPrompt(subject, kind);
  await writeText(path.join(paths.dirs.roleReference, `${safeName}.prompt.txt`), prompt);

  let status = "ok";
  let imagePath = `${safeName}.png`;
  try {
    const image = await client.generateImage({
      model,
      prompt,
    });
    await fs.writeFile(path.join(paths.dirs.roleReference, imagePath), image.buffer);
    await writeJson(path.join(paths.dirs.roleReference, `${safeName}.meta.json`), {
      model,
      usage: image.usage || null,
      kind,
      name: subject.name,
    });
  } catch (error) {
    if (!config.allowFallbacks) {
      throw error;
    }
    status = "fallback";
    imagePath = `${safeName}.ppm`;
    await createPlaceholderPpm(path.join(paths.dirs.roleReference, imagePath), index);
    await writeJson(path.join(paths.dirs.roleReference, `${safeName}.meta.json`), {
      model,
      status,
      kind,
      name: subject.name,
      message: error.message,
    });
  }

  return {
    key: subject.name,
    name: subject.name,
    role: subject.role || kind,
    kind,
    status,
    imagePath,
    promptPath: `${safeName}.prompt.txt`,
    model,
  };
}

function buildFallbackStoryboard(adaptation, charactersPayload) {
  const chapters = adaptation.chapters || [];
  const characters = charactersPayload.characters || [];
  const protagonist = characters[0]?.name || "主角甲";
  const partner = characters[1]?.name || "主角乙";
  const style = adaptation?.style_preset || "写实";
  const shots = [];

  const units = chapters.length
    ? chapters.slice(0, 3).map((chapter, index) => ({
        scene_id: chapter.chapter_id || `chapter_${index + 1}`,
        title: chapter.title || `段落${index + 1}`,
        objective: chapter.summary || chapter.content || "剧情推进",
        conflict: chapter.summary || "局势继续升级",
      }))
    : [
        {
          scene_id: "chapter_1",
          title: adaptation.title || "剧情推进",
          objective: adaptation.logline || adaptation.script_text || "角色在压力下推进任务",
          conflict: adaptation.ending_hook || "时间压力和结果压力叠加",
        },
      ];

  units.forEach((scene, index) => {
    const baseIndex = index * 2 + 1;
    shots.push({
      shot_id: `shot_${String(baseIndex).padStart(2, "0")}`,
      scene_id: scene.scene_id || `scene_${index + 1}`,
      title: `${scene.title || "剧情推进"}-压力镜头`,
      camera: "中近景，轻微推镜",
      visual_focus: scene.conflict || scene.objective || "角色在压力下作决定",
      speaker: protagonist,
      line:
        scene.conflict ||
        scene.objective ||
        "这件事今天必须推进，不然项目就没有下一步。",
      subtitle:
        scene.conflict ||
        scene.objective ||
        "这件事今天必须推进，不然项目就没有下一步。",
      duration_sec: 5,
      image_prompt: `${scene.title || "核心场景"}，${protagonist}处于强压力状态，准备推进关键决定，${style}风格，电影感构图。`,
      video_prompt: `${scene.title || "核心场景"}内，${protagonist}从压住情绪到做出决定，轻微推镜，${style}风格，人物状态变化清晰。`,
      negative_prompt: "卡通感、古装、多人混脸、肢体畸形、过曝",
    });
    shots.push({
      shot_id: `shot_${String(baseIndex + 1).padStart(2, "0")}`,
      scene_id: scene.scene_id || `scene_${index + 1}`,
      title: `${scene.title || "剧情推进"}-协作镜头`,
      camera: "双人对话，过肩镜头",
      visual_focus: scene.turning_point || "两人形成共识并继续推进",
      speaker: partner,
      line:
        scene.turning_point ||
        "先把链路跑通，再把效果一段一段补上，我们现在还有机会。",
      subtitle:
        scene.turning_point ||
        "先把链路跑通，再把效果一段一段补上，我们现在还有机会。",
      duration_sec: 5,
      image_prompt: `${scene.title || "核心场景"}，${partner}与${protagonist}协作推进，${style}风格，人物关系明确。`,
      video_prompt: `${scene.title || "核心场景"}内，${partner}与${protagonist}快速对话并同步行动，过肩镜头，${style}风格，节奏紧张。`,
      negative_prompt: "卡通感、古装、多人混脸、肢体畸形、过曝",
    });
  });

  return {
    style_guide: {
      visual_style: `${style}风格，电影级摄影，人物一致性优先`,
      continuity_rules: [
        `${protagonist}保持主造型和面部特征一致`,
        `${partner}保持主造型和面部特征一致`,
      ],
    },
    shots: shots.slice(0, 6),
  };
}

async function saveChatStage({
  client,
  model,
  messages,
  stageDir,
  fileStem,
  fallbackFactory,
}) {
  try {
    const result = await client.chatJson({
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
    if (!config.allowFallbacks || !fallbackFactory) {
      throw error;
    }
    const fallback = fallbackFactory();
    await writeText(path.join(stageDir, `${fileStem}.raw.txt`), `FALLBACK\n\n${error.message}\n`);
    await writeJson(path.join(stageDir, `${fileStem}.json`), fallback);
    await writeJson(path.join(stageDir, `${fileStem}.meta.json`), {
      model,
      status: "fallback",
      message: error.message,
    });
    return fallback;
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

async function renderSilentAudio(outputPath, seconds) {
  await runCommand(config.ffmpegPath, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=44100:cl=stereo",
    "-t",
    String(seconds),
    "-q:a",
    "9",
    "-acodec",
    "libmp3lame",
    outputPath,
  ]);
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
    fallbackFactory: () => buildFallbackCharacters(adaptation),
  });
  const subjectPayload = normalizeCharacterStagePayload(payload, adaptation);
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
    fallbackFactory: () => buildFallbackStoryboard(adaptation, characters),
  });
  upsertStageRecord(manifest, "storyboard", project.models.storyboard, "05-storyboard/storyboard.json");
  manifest.outputs.storyboard = "05-storyboard/storyboard.json";
  await runTextComparisons({
    client,
    stageName: "storyboard",
    messages,
    outputDir: paths.outputDir,
    models: project.models.storyboard,
  });
  return storyboard;
}

async function executeMedia(project, client, paths, manifest, onProgress) {
  await reportProgress(onProgress, "正在生成镜头图与配音");
  const charactersPayload = await readOptionalJson(path.join(paths.dirs.characters, "characters.json"));
  const storyboard = await readOptionalJson(path.join(paths.dirs.storyboard, "storyboard.json"));
  if (!charactersPayload || !storyboard) {
    throw new Error("请先完成分镜阶段。");
  }
  const characters = charactersPayload.characters || [];
  const shots = storyboard.shots || [];
  if (!shots.length) {
    throw new Error("分镜里没有镜头。");
  }

  const subtitles = [];
  const shotOutputs = [];
  const segmentPaths = [];
  let cursor = 0;

  for (let index = 0; index < shots.length; index += 1) {
    const shot = shots[index];
    await reportProgress(onProgress, `正在生成镜头 ${index + 1}/${shots.length}`, {
      current: index + 1,
      total: shots.length,
      shotId: shot.shot_id || `shot_${String(index + 1).padStart(2, "0")}`,
    });
    const shotId = shot.shot_id || `shot_${String(index + 1).padStart(2, "0")}`;
    const prompt = buildFinalImagePrompt(shot, characters, storyboard.style_guide);
    const imageBase = path.join(paths.dirs.images, shotId);
    const audioPath = path.join(paths.dirs.audio, `${shotId}.mp3`);
    const segmentPath = path.join(paths.dirs.video, `${shotId}.mp4`);
    let imagePath = `${imageBase}.png`;
    let imageStatus = "ok";
    let audioStatus = "ok";

    await writeText(path.join(paths.dirs.images, `${shotId}.prompt.txt`), prompt);

    try {
      const imageResult = await client.generateImage({
        model: project.models.shotImage,
        prompt,
      });
      await fs.writeFile(imagePath, imageResult.buffer);
      await writeJson(path.join(paths.dirs.images, `${shotId}.meta.json`), {
        model: project.models.shotImage,
        usage: imageResult.usage || null,
      });
    } catch (error) {
      if (!config.allowFallbacks) {
        throw error;
      }
      imageStatus = "fallback";
      imagePath = `${imageBase}.ppm`;
      await createPlaceholderPpm(imagePath, index);
      await writeJson(path.join(paths.dirs.images, `${shotId}.meta.json`), {
        model: project.models.shotImage,
        status: "fallback",
        message: error.message,
      });
    }

    let durationSec = Number(shot.duration_sec || 5);
    try {
      const ttsResult = await client.synthesizeSpeech({
        text: shot.line || shot.subtitle,
        voiceType: resolveVoice(shot.speaker, characters),
      });
      await fs.writeFile(audioPath, ttsResult.buffer);
      durationSec = Math.max(durationSec, (ttsResult.durationMs || 0) / 1000 + 0.35);
      await writeJson(path.join(paths.dirs.audio, `${shotId}.meta.json`), {
        voiceType: resolveVoice(shot.speaker, characters),
        durationMs: ttsResult.durationMs,
        reqid: ttsResult.reqid,
      });
    } catch (error) {
      if (!config.allowFallbacks) {
        throw error;
      }
      audioStatus = "fallback";
      await renderSilentAudio(audioPath, durationSec);
      await writeJson(path.join(paths.dirs.audio, `${shotId}.meta.json`), {
        status: "fallback",
        message: error.message,
      });
    }

    await renderSegment({
      imagePath,
      audioPath,
      outputPath: segmentPath,
      durationSec,
    });

    subtitles.push([
      String(index + 1),
      `${secondsToSrtTime(cursor)} --> ${secondsToSrtTime(cursor + durationSec)}`,
      shot.subtitle || shot.line,
      "",
    ].join("\n"));

    cursor += durationSec;
    segmentPaths.push(segmentPath);
    shotOutputs.push({
      shotId,
      speaker: shot.speaker,
      durationSec,
      imageStatus,
      audioStatus,
      imagePath: path.relative(paths.outputDir, imagePath),
      audioPath: path.relative(paths.outputDir, audioPath),
      segmentPath: path.relative(paths.outputDir, segmentPath),
      subtitle: shot.subtitle || shot.line,
      videoPrompt: shot.video_prompt || shot.image_prompt,
    });
  }

  const subtitlesPath = path.join(paths.dirs.subtitles, "subtitles.srt");
  const concatListPath = path.join(paths.dirs.video, "segments.txt");
  await writeText(subtitlesPath, subtitles.join("\n"));
  await writeText(
    concatListPath,
    segmentPaths.map((filePath) => `file '${filePath.replaceAll("'", "'\\''")}'`).join("\n"),
  );

  if (config.qiniu.compareModels.image.length) {
    const comparisonDir = path.join(paths.outputDir, "comparisons", "image");
    await ensureDir(comparisonDir);
    const firstShot = shots[0];
    const prompt = buildFinalImagePrompt(firstShot, characters, storyboard.style_guide);
    for (const model of config.qiniu.compareModels.image) {
      try {
        const image = await client.generateImage({ model, prompt });
        await fs.writeFile(path.join(comparisonDir, `${model.replaceAll("/", "__")}.png`), image.buffer);
        await writeJson(path.join(comparisonDir, `${model.replaceAll("/", "__")}.meta.json`), {
          model,
          usage: image.usage || null,
        });
      } catch (error) {
        await writeJson(path.join(comparisonDir, `${model.replaceAll("/", "__")}.error.json`), {
          model,
          message: error.message,
        });
      }
    }
  }

  manifest.shots = shotOutputs;
  manifest.outputs.subtitles = "08-subtitles/subtitles.srt";
  upsertStageRecord(manifest, "media", project.models.shotImage, "06-images + 07-audio + 08-subtitles");
}

async function executeOutput(project, paths, manifest, onProgress) {
  await reportProgress(onProgress, "正在合成静态成片");
  const subtitlesPath = path.join(paths.dirs.subtitles, "subtitles.srt");
  const concatListPath = path.join(paths.dirs.video, "segments.txt");
  const roughVideoPath = path.join(paths.dirs.video, "rough-output.mp4");
  const outputVideoPath = path.join(paths.dirs.video, "output.mp4");

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
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const result = await client.getVideoTask({ model, provider, id });
    const status = String(result.status || "").toLowerCase();
    if (["succeeded", "success", "completed"].includes(status)) {
      if (!result.url) {
        throw new Error("视频任务已完成，但未返回下载地址。");
      }
      return result.url;
    }
    if (["failed", "error", "cancelled"].includes(status)) {
      throw new Error(`视频任务失败: ${status}`);
    }
    await sleep(5000);
  }
  throw new Error("视频任务轮询超时。");
}

async function executeVideo(project, client, paths, manifest, onProgress) {
  const storyboard = await readOptionalJson(path.join(paths.dirs.storyboard, "storyboard.json"));
  if (!storyboard?.shots?.length) {
    throw new Error("请先完成分镜阶段。");
  }

  const shotOutputs = manifest.shots || [];
  if (!shotOutputs.length) {
    throw new Error("请先完成画面与配音阶段，确保已有镜头素材。");
  }

  const renderedVideoPaths = [];
  for (let index = 0; index < shotOutputs.length; index += 1) {
    const shotOutput = shotOutputs[index];
    const storyboardShot = storyboard.shots[index] || {};
    const imagePath = path.join(paths.outputDir, shotOutput.imagePath);
    const localExt = path.extname(imagePath).toLowerCase();
    const imageBuffer = [".png", ".jpg", ".jpeg"].includes(localExt)
      ? await fs.readFile(imagePath)
      : null;
    const prompt = storyboardShot.video_prompt || shotOutput.videoPrompt || storyboardShot.image_prompt || storyboardShot.title || "真人表演视频镜头";
    await reportProgress(onProgress, `正在生成视频镜头 ${index + 1}/${shotOutputs.length}`, {
      current: index + 1,
      total: shotOutputs.length,
      shotId: shotOutput.shotId,
    });
    const task = await client.createVideoTask({
      model: project.models.shotVideo,
      prompt,
      imageBuffer,
      seconds: Number(shotOutput.durationSec || storyboardShot.duration_sec || 5),
    });
    const downloadUrl = await pollVideoResult(client, project.models.shotVideo, task.provider, task.id);
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      throw new Error(`下载视频失败: ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const outputPath = path.join(paths.dirs.videoModel, `${shotOutput.shotId}.mp4`);
    await fs.writeFile(outputPath, buffer);
    renderedVideoPaths.push(outputPath);
    await writeJson(path.join(paths.dirs.videoModel, `${shotOutput.shotId}.meta.json`), {
      model: project.models.shotVideo,
      taskId: task.id,
      provider: task.provider,
      prompt,
      downloadUrl,
    });
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
  const nextReference = await renderSubjectReference({
    client,
    model: project.models.roleImage,
    subject: list[index],
    kind,
    paths,
    index,
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
  return readProjectDetail(projectId);
}

export async function renderAllSubjectReferences(projectId) {
  const project = await readProject(projectId);
  const paths = await ensureProjectWorkspace(projectId);
  const client = new QiniuMaaSClient(config.qiniu);
  const manifest = await loadManifest(projectId, project);
  await renderAllSubjectReferencesForProject(project, client, paths, manifest, null);
  await saveManifest(projectId, manifest);
  await saveModelMatrix(project, manifest);
  project.stageState.characters = {
    status: "done",
    updatedAt: new Date().toISOString(),
    error: null,
  };
  await writeProject(project);
  return readProjectDetail(projectId);
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
    throw error;
  }
}
