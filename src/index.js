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
  makeRunId,
  readText,
  runCommand,
  secondsToSrtTime,
  writeJson,
  writeText,
} from "./utils.js";
import { defaultVoicePresetForGender, normalizeVoiceProfile } from "./voice-catalog.js";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const next = argv[index + 1];
    if (key === "--story" && next) {
      args.story = next;
      index += 1;
      continue;
    }
    if (key === "--run-id" && next) {
      args.runId = next;
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
    return defaultVoicePresetForGender("female", "旁白").voiceType || config.qiniu.voices.narrator;
  }
  const character = findCharacter(characters, speaker);
  if (!character) {
    return defaultVoicePresetForGender("neutral", speaker).voiceType || config.qiniu.voices.narrator;
  }
  return normalizeVoiceProfile(character.voice_profile, character.gender, speaker).voiceType;
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

async function saveChatStage({
  client,
  model,
  messages,
  stageDir,
  fileStem,
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
    await writeText(path.join(stageDir, `${fileStem}.raw.txt`), `ERROR\n\n${error.message}\n`);
    await writeJson(path.join(stageDir, `${fileStem}.meta.json`), {
      model,
      status: "error",
      message: error.message,
    });
    throw error;
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
    const status = "ok";
    const image = await client.generateImage({
      model: config.qiniu.models.roleImage,
      prompt,
    });
    await fs.writeFile(imagePath, image.buffer);
    await writeJson(path.join(outputDir, `${safeName}.meta.json`), {
      model: config.qiniu.models.roleImage,
      usage: image.usage || null,
      outputFormat: image.output_format || "png",
      status,
    });

    results.push({
      name: character.name,
      role: character.role,
      status,
      imagePath: `${safeName}.png`,
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

  const runId = args.runId || process.env.RUN_ID || makeRunId();
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
  await writeJson(path.join(runDir, "manifest.json"), manifest);

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
  await writeJson(path.join(runDir, "manifest.json"), manifest);
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
  });
  const characters = charactersPayload.characters || [];
  manifest.stages.push({
    stage: "characters",
    model: config.qiniu.models.characters,
    output: "03-characters/characters.json",
  });
  await writeJson(path.join(runDir, "manifest.json"), manifest);

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
  });
  manifest.stages.push({
    stage: "storyboard",
    model: config.qiniu.models.storyboard,
    output: "05-storyboard/storyboard.json",
  });
  await writeJson(path.join(runDir, "manifest.json"), manifest);
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
    const imagePath = `${imageBase}.png`;
    const imageStatus = "ok";
    const audioStatus = "ok";

    await writeText(path.join(dirs.images, `${shotId}.prompt.txt`), prompt);

    const imageResult = await client.generateImage({
      model: config.qiniu.models.shotImage,
      prompt,
    });
    await fs.writeFile(imagePath, imageResult.buffer);
    await writeJson(path.join(dirs.images, `${shotId}.meta.json`), {
      model: config.qiniu.models.shotImage,
      outputFormat: imageResult.output_format || "png",
      usage: imageResult.usage || null,
      status: "ok",
    });

    let durationSec = Number(shot.duration_sec || 5);
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
      status: "ok",
    });

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

  const roughVideoPath = path.join(dirs.video, "rough-output.mp4");
  const outputVideoPath = path.join(dirs.video, "output.mp4");
  await concatSegments(concatListPath, roughVideoPath);
  await burnSubtitles(roughVideoPath, subtitlesPath, outputVideoPath);

  manifest.outputs = {
    adaptation: "02-adaptation/adaptation.json",
    characters: "03-characters/characters.json",
    roleReference: "04-role-reference",
    storyboard: "05-storyboard/storyboard.json",
    subtitles: "08-subtitles/subtitles.srt",
    outputVideo: "09-video/output.mp4",
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

  console.log(JSON.stringify({ runId, outputVideoPath, runDir }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
