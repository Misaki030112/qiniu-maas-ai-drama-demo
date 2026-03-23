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
  readProject,
  readProjectDetail,
  writeProject,
} from "./project-store.js";

const runningStages = new Map();

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

function buildFallbackCharacters(adaptation) {
  const source = JSON.stringify(adaptation);
  const [nameA = "主角甲", nameB = "主角乙"] = uniqueNamesFromText(source);
  return {
    characters: [
      {
        name: nameA,
        role: "内容负责人",
        gender: "female",
        age_range: "28-35",
        personality: ["强势", "目标导向", "对结果敏感"],
        appearance: "都市职业女性，利落长发或低马尾，深色西装或衬衫，状态紧绷但有执行力。",
        continuity_prompt:
          `${nameA}，都市职业女性，深色西装，利落发型，写实真人短剧风格，情绪克制但有压迫感。`,
        voice_style: "冷静、克制、带压力感",
      },
      {
        name: nameB,
        role: "AI 产品 / 技术负责人",
        gender: "male",
        age_range: "26-33",
        personality: ["理性", "抗压", "执行快"],
        appearance: "年轻男性，简单衬衫或卫衣，略疲惫但专注，职场夜战状态。",
        continuity_prompt:
          `${nameB}，年轻男性，衬衫或卫衣，眼神专注，轻微疲惫感，写实真人短剧风格。`,
        voice_style: "沉稳、理性、略带疲惫",
      },
    ],
  };
}

function buildFallbackStoryboard(adaptation, charactersPayload) {
  const scenes = adaptation.scenes || [];
  const characters = charactersPayload.characters || [];
  const protagonist = characters[0]?.name || "主角甲";
  const partner = characters[1]?.name || "主角乙";
  const shots = [];

  scenes.slice(0, 3).forEach((scene, index) => {
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
      image_prompt: `${scene.location || "办公室"}，${protagonist}处于强压力状态，准备推进项目，写实电影感，夜景职场氛围。`,
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
      image_prompt: `${scene.location || "办公室"}，${partner}与${protagonist}在深夜协作，屏幕灯光映在脸上，写实真人短剧风格。`,
    });
  });

  return {
    style_guide: {
      visual_style: "写实电影感真人短剧，都市夜景，冷暖对比灯光",
      continuity_rules: [
        `${protagonist}保持职业装与高压状态`,
        `${partner}保持轻微疲惫但专注的技术负责人形象`,
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
      note: "当前输出仍是静态镜头 + 配音 + 字幕合成，视频模型阶段尚未接通。",
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

async function executeAdaptation(project, client, paths, manifest) {
  const storyText = project.storyText.trim() || (await readText(path.join(paths.dirs.input, "story.txt")));
  if (!storyText.trim()) {
    throw new Error("请先输入故事文本。");
  }
  await writeText(path.join(paths.dirs.input, "story.txt"), `${storyText.trim()}\n`);
  const messages = buildAdaptationMessages(storyText);
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

async function executeCharacters(project, client, paths, manifest) {
  const adaptation = await readOptionalJson(path.join(paths.dirs.adaptation, "adaptation.json"));
  if (!adaptation) {
    throw new Error("请先完成剧本改编阶段。");
  }
  const messages = buildCharacterMessages(adaptation);
  const payload = await saveChatStage({
    client,
    model: project.models.characters,
    messages,
    stageDir: paths.dirs.characters,
    fileStem: "characters",
    fallbackFactory: () => buildFallbackCharacters(adaptation),
  });
  const characters = payload.characters || [];
  const roleReferences = [];
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    const safeName = character.name.replaceAll(/\s+/g, "_");
    const prompt = [
      "角色设定卡，写实真人短剧风格，半身或全身角色参考图。",
      character.continuity_prompt,
      `角色定位：${character.role}。`,
      `年龄段：${character.age_range}。`,
      `性格：${(character.personality || []).join("、")}。`,
      "纯净背景，清晰服装细节，适合后续镜头复用，16:9。",
    ]
      .filter(Boolean)
      .join(" ");
    await writeText(path.join(paths.dirs.roleReference, `${safeName}.prompt.txt`), prompt);
    let status = "ok";
    let imagePath = `${safeName}.png`;
    try {
      const image = await client.generateImage({
        model: project.models.roleImage,
        prompt,
      });
      await fs.writeFile(path.join(paths.dirs.roleReference, imagePath), image.buffer);
      await writeJson(path.join(paths.dirs.roleReference, `${safeName}.meta.json`), {
        model: project.models.roleImage,
        usage: image.usage || null,
      });
    } catch (error) {
      if (!config.allowFallbacks) {
        throw error;
      }
      status = "fallback";
      imagePath = `${safeName}.ppm`;
      await createPlaceholderPpm(path.join(paths.dirs.roleReference, imagePath), index);
      await writeJson(path.join(paths.dirs.roleReference, `${safeName}.meta.json`), {
        model: project.models.roleImage,
        status,
        message: error.message,
      });
    }
    roleReferences.push({
      name: character.name,
      role: character.role,
      status,
      imagePath,
      promptPath: `${safeName}.prompt.txt`,
      model: project.models.roleImage,
    });
  }
  manifest.roleReferences = roleReferences;
  manifest.outputs.characters = "03-characters/characters.json";
  manifest.outputs.roleReference = "04-role-reference";
  upsertStageRecord(manifest, "characters", project.models.characters, "03-characters/characters.json");
  return payload;
}

async function executeStoryboard(project, client, paths, manifest) {
  const adaptation = await readOptionalJson(path.join(paths.dirs.adaptation, "adaptation.json"));
  const characters = await readOptionalJson(path.join(paths.dirs.characters, "characters.json"));
  if (!adaptation || !characters) {
    throw new Error("请先完成角色设定阶段。");
  }
  const messages = buildStoryboardMessages(adaptation, characters);
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

async function executeMedia(project, client, paths, manifest) {
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

async function executeOutput(project, paths, manifest) {
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

function assertExecutable(project, stage) {
  if (stage === "video") {
    throw new Error("视频模型阶段还没有接通，所以当前不可执行。");
  }
  const dependencies = {
    adaptation: [],
    characters: ["adaptation"],
    storyboard: ["characters"],
    media: ["storyboard"],
    output: ["media"],
  }[stage] || [];
  for (const dependency of dependencies) {
    if (project.stageState[dependency]?.status !== "done") {
      throw new Error(`请先完成 ${dependency} 阶段。`);
    }
  }
}

export async function executeProjectStage(projectId, stage) {
  if (runningStages.has(projectId)) {
    throw new Error("当前项目已有阶段在运行中，请稍后再试。");
  }

  const project = await readProject(projectId);
  assertExecutable(project, stage);
  project.stageState[stage] = {
    status: "running",
    updatedAt: new Date().toISOString(),
    error: null,
  };
  await writeProject(project);
  runningStages.set(projectId, stage);

  try {
    const paths = await ensureProjectWorkspace(projectId);
    const client = new QiniuMaaSClient(config.qiniu);
    const manifest = await loadManifest(projectId, project);

    if (stage === "adaptation") {
      await executeAdaptation(project, client, paths, manifest);
    } else if (stage === "characters") {
      await executeCharacters(project, client, paths, manifest);
    } else if (stage === "storyboard") {
      await executeStoryboard(project, client, paths, manifest);
    } else if (stage === "media") {
      await executeMedia(project, client, paths, manifest);
    } else if (stage === "output") {
      await executeOutput(project, paths, manifest);
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
    return await readProjectDetail(projectId);
  } catch (error) {
    project.stageState[stage] = {
      status: "error",
      updatedAt: new Date().toISOString(),
      error: error.message,
    };
    await writeProject(project);
    throw error;
  } finally {
    runningStages.delete(projectId);
  }
}

export function isProjectStageRunning(projectId) {
  return runningStages.has(projectId);
}
