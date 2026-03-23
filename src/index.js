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
  makeRunId,
  readText,
  runCommand,
  secondsToSrtTime,
  writeJson,
  writeText,
} from "./utils.js";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const next = argv[index + 1];
    if (key === "--story" && next) {
      args.story = next;
      index += 1;
    }
  }
  return args;
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
    await writeText(
      path.join(stageDir, `${fileStem}.raw.txt`),
      `FALLBACK\n\n${error.message}\n`,
    );
    await writeJson(path.join(stageDir, `${fileStem}.json`), fallback);
    await writeJson(path.join(stageDir, `${fileStem}.meta.json`), {
      model,
      status: "fallback",
      message: error.message,
    });
    return fallback;
  }
}

async function runTextComparisons({ client, stageName, messages, runDir }) {
  if (!config.qiniu.compareModels.text.length) {
    return [];
  }

  const comparisonDir = path.join(runDir, "comparisons", "text", stageName);
  await ensureDir(comparisonDir);
  const results = [];

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
      });
      results.push({ model, status: "ok" });
    } catch (error) {
      await writeJson(path.join(comparisonDir, `${model.replaceAll("/", "__")}.error.json`), {
        model,
        status: "error",
        message: error.message,
      });
      results.push({ model, status: "error", message: error.message });
    }
  }

  return results;
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

async function generateRoleReferenceImages({
  client,
  characters,
  outputDir,
  manifest,
}) {
  const results = [];
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
    const imagePath = path.join(outputDir, `${safeName}.png`);
    const promptPath = path.join(outputDir, `${safeName}.prompt.txt`);
    await writeText(promptPath, prompt);
    let status = "ok";
    try {
      const image = await client.generateImage({
        model: config.qiniu.models.roleImage,
        prompt,
      });
      await fs.writeFile(imagePath, image.buffer);
      await writeJson(path.join(outputDir, `${safeName}.meta.json`), {
        model: config.qiniu.models.roleImage,
        usage: image.usage || null,
        outputFormat: image.output_format || "png",
      });
    } catch (error) {
      if (!config.allowFallbacks) {
        throw error;
      }
      status = "fallback";
      const ppmPath = path.join(outputDir, `${safeName}.ppm`);
      await createPlaceholderPpm(ppmPath, index);
      await writeJson(path.join(outputDir, `${safeName}.meta.json`), {
        model: config.qiniu.models.roleImage,
        status,
        message: error.message,
      });
    }

    results.push({
      name: character.name,
      role: character.role,
      status,
      imagePath: status === "ok" ? `${safeName}.png` : `${safeName}.ppm`,
      promptPath: `${safeName}.prompt.txt`,
      model: config.qiniu.models.roleImage,
    });
  }

  manifest.stages.push({
    stage: "role_reference",
    model: config.qiniu.models.roleImage,
    output: "04-role-reference",
  });
  return results;
}

async function run() {
  if (!config.qiniu.apiKey) {
    throw new Error("Missing QINIU_API_KEY in .env");
  }

  const args = parseArgs(process.argv.slice(2));
  const storyPath = args.story
    ? path.resolve(config.workspaceRoot, args.story)
    : config.inputStoryPath;
  const storyText = await readText(storyPath);

  const runId = makeRunId();
  const runDir = path.join(config.outputRoot, runId);
  const dirs = {
    input: path.join(runDir, "01-input"),
    adaptation: path.join(runDir, "02-adaptation"),
    characters: path.join(runDir, "03-characters"),
    roleReference: path.join(runDir, "04-role-reference"),
    storyboard: path.join(runDir, "05-storyboard"),
    images: path.join(runDir, "06-images"),
    audio: path.join(runDir, "07-audio"),
    subtitles: path.join(runDir, "08-subtitles"),
    video: path.join(runDir, "09-video"),
  };

  for (const dir of Object.values(dirs)) {
    await ensureDir(dir);
  }

  await writeText(path.join(dirs.input, "story.txt"), storyText);

  const client = new QiniuMaaSClient(config.qiniu);
  const manifest = {
    runId,
    startedAt: new Date().toISOString(),
    storyPath,
    baseUrl: config.qiniu.baseUrl,
    renderStrategy: {
      mode: config.video.renderMode,
      note:
        config.video.renderMode === "kenburns"
          ? "当前是静帧 + 配音 + 字幕 + 轻运动合成，不是真正的连续视频模型生成。"
          : "当前是静帧 + 配音 + 字幕合成，不是真正的连续视频模型生成。",
      plannedVideoModel: config.qiniu.models.shotVideo,
    },
    stages: [],
    outputs: {},
  };

  const adaptationMessages = buildAdaptationMessages(storyText);
  const adaptation = await saveChatStage({
    client,
    model: config.qiniu.models.adaptation,
    messages: adaptationMessages,
    stageDir: dirs.adaptation,
    fileStem: "adaptation",
  });
  manifest.stages.push({
    stage: "adaptation",
    model: config.qiniu.models.adaptation,
    output: "02-adaptation/adaptation.json",
  });
  await runTextComparisons({
    client,
    stageName: "adaptation",
    messages: adaptationMessages,
    runDir,
  });

  const characterMessages = buildCharacterMessages(adaptation);
  const charactersPayload = await saveChatStage({
    client,
    model: config.qiniu.models.characters,
    messages: characterMessages,
    stageDir: dirs.characters,
    fileStem: "characters",
    fallbackFactory: () => buildFallbackCharacters(adaptation),
  });
  const characters = charactersPayload.characters || [];
  manifest.stages.push({
    stage: "characters",
    model: config.qiniu.models.characters,
    output: "03-characters/characters.json",
  });

  const roleReferences = await generateRoleReferenceImages({
    client,
    characters,
    outputDir: dirs.roleReference,
    manifest,
  });

  const storyboardMessages = buildStoryboardMessages(adaptation, charactersPayload);
  const storyboard = await saveChatStage({
    client,
    model: config.qiniu.models.storyboard,
    messages: storyboardMessages,
    stageDir: dirs.storyboard,
    fileStem: "storyboard",
    fallbackFactory: () => buildFallbackStoryboard(adaptation, charactersPayload),
  });
  manifest.stages.push({
    stage: "storyboard",
    model: config.qiniu.models.storyboard,
    output: "05-storyboard/storyboard.json",
  });
  await runTextComparisons({
    client,
    stageName: "storyboard",
    messages: storyboardMessages,
    runDir,
  });

  const shots = storyboard.shots || [];
  if (!shots.length) {
    throw new Error("Storyboard returned no shots.");
  }

  const subtitles = [];
  const segmentPaths = [];
  const shotOutputs = [];
  let cursor = 0;

  for (let index = 0; index < shots.length; index += 1) {
    const shot = shots[index];
    const shotId = shot.shot_id || `shot_${String(index + 1).padStart(2, "0")}`;
    const prompt = buildFinalImagePrompt(shot, characters, storyboard.style_guide);
    const imageBase = path.join(dirs.images, shotId);
    const audioPath = path.join(dirs.audio, `${shotId}.mp3`);
    const segmentPath = path.join(dirs.video, `${shotId}.mp4`);
    let imagePath = `${imageBase}.png`;
    let imageStatus = "ok";
    let audioStatus = "ok";

    await writeText(path.join(dirs.images, `${shotId}.prompt.txt`), prompt);

    try {
      const imageResult = await client.generateImage({
        model: config.qiniu.models.shotImage,
        prompt,
      });
      await fs.writeFile(imagePath, imageResult.buffer);
      await writeJson(path.join(dirs.images, `${shotId}.meta.json`), {
        model: config.qiniu.models.shotImage,
        outputFormat: imageResult.output_format || "png",
        usage: imageResult.usage || null,
      });
    } catch (error) {
      if (!config.allowFallbacks) {
        throw error;
      }
      imageStatus = "fallback";
      imagePath = `${imageBase}.ppm`;
      await createPlaceholderPpm(imagePath, index);
      await writeJson(path.join(dirs.images, `${shotId}.meta.json`), {
        model: config.qiniu.models.shotImage,
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
      await writeJson(path.join(dirs.audio, `${shotId}.meta.json`), {
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
      await writeJson(path.join(dirs.audio, `${shotId}.meta.json`), {
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
      imagePath: path.relative(runDir, imagePath),
      audioPath: path.relative(runDir, audioPath),
      segmentPath: path.relative(runDir, segmentPath),
    });
  }

  const subtitlesPath = path.join(dirs.subtitles, "subtitles.srt");
  await writeText(subtitlesPath, subtitles.join("\n"));

  if (config.qiniu.compareModels.image.length) {
    const imageCompareDir = path.join(runDir, "comparisons", "image");
    await ensureDir(imageCompareDir);
    const firstShot = shots[0];
    const prompt = buildFinalImagePrompt(firstShot, characters, storyboard.style_guide);
    for (const model of config.qiniu.compareModels.image) {
      try {
        const image = await client.generateImage({ model, prompt });
        await fs.writeFile(
          path.join(imageCompareDir, `${model.replaceAll("/", "__")}.png`),
          image.buffer,
        );
        await writeJson(
          path.join(imageCompareDir, `${model.replaceAll("/", "__")}.meta.json`),
          { model, usage: image.usage || null },
        );
      } catch (error) {
        await writeJson(
          path.join(imageCompareDir, `${model.replaceAll("/", "__")}.error.json`),
          { model, message: error.message },
        );
      }
    }
  }

  const concatListPath = path.join(dirs.video, "segments.txt");
  await writeText(
    concatListPath,
    segmentPaths.map((filePath) => `file '${filePath.replaceAll("'", "'\\''")}'`).join("\n"),
  );

  const roughVideoPath = path.join(dirs.video, "rough-cut.mp4");
  const finalVideoPath = path.join(dirs.video, "final-demo.mp4");
  await concatSegments(concatListPath, roughVideoPath);
  await burnSubtitles(roughVideoPath, subtitlesPath, finalVideoPath);

  manifest.outputs = {
    adaptation: "02-adaptation/adaptation.json",
    characters: "03-characters/characters.json",
    roleReference: "04-role-reference",
    storyboard: "05-storyboard/storyboard.json",
    subtitles: "08-subtitles/subtitles.srt",
    finalVideo: "09-video/final-demo.mp4",
  };
  manifest.roleReferences = roleReferences;
  manifest.shots = shotOutputs;
  manifest.runSummary = {
    textModels: {
      adaptation: config.qiniu.models.adaptation,
      characters: config.qiniu.models.characters,
      storyboard: config.qiniu.models.storyboard,
    },
    imageModels: {
      roleReference: config.qiniu.models.roleImage,
      shots: config.qiniu.models.shotImage,
    },
    videoStage: {
      plannedModel: config.qiniu.models.shotVideo,
      implemented: false,
    },
  };
  manifest.completedAt = new Date().toISOString();

  await writeJson(path.join(runDir, "manifest.json"), manifest);
  await writeJson(path.join(runDir, "model-matrix.json"), {
    provider: config.strategy.provider,
    baseUrl: config.qiniu.baseUrl,
    primary: {
      adaptation: config.qiniu.models.adaptation,
      characters: config.qiniu.models.characters,
      storyboard: config.qiniu.models.storyboard,
      roleImage: config.qiniu.models.roleImage,
      shotImage: config.qiniu.models.shotImage,
      shotVideo: config.qiniu.models.shotVideo,
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

  console.log(JSON.stringify({ runId, finalVideoPath, runDir }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
