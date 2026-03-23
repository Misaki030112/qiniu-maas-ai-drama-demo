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

async function saveChatStage({
  client,
  model,
  messages,
  stageDir,
  fileStem,
}) {
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
  });

  return result.parsed;
}

async function runTextComparisons({ client, stageName, messages, runDir }) {
  if (!config.qiniu.textCompareModels.length) {
    return [];
  }

  const comparisonDir = path.join(runDir, "comparisons", "text", stageName);
  await ensureDir(comparisonDir);
  const results = [];

  for (const model of config.qiniu.textCompareModels) {
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
  const videoFilter = [
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
    storyboard: path.join(runDir, "04-storyboard"),
    images: path.join(runDir, "05-images"),
    audio: path.join(runDir, "06-audio"),
    subtitles: path.join(runDir, "07-subtitles"),
    video: path.join(runDir, "08-video"),
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
    stages: [],
    outputs: {},
  };

  const adaptationMessages = buildAdaptationMessages(storyText);
  const adaptation = await saveChatStage({
    client,
    model: config.qiniu.textModel,
    messages: adaptationMessages,
    stageDir: dirs.adaptation,
    fileStem: "adaptation",
  });
  manifest.stages.push({
    stage: "adaptation",
    model: config.qiniu.textModel,
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
    model: config.qiniu.textModel,
    messages: characterMessages,
    stageDir: dirs.characters,
    fileStem: "characters",
  });
  const characters = charactersPayload.characters || [];
  manifest.stages.push({
    stage: "characters",
    model: config.qiniu.textModel,
    output: "03-characters/characters.json",
  });

  const storyboardMessages = buildStoryboardMessages(adaptation, charactersPayload);
  const storyboard = await saveChatStage({
    client,
    model: config.qiniu.textModel,
    messages: storyboardMessages,
    stageDir: dirs.storyboard,
    fileStem: "storyboard",
  });
  manifest.stages.push({
    stage: "storyboard",
    model: config.qiniu.textModel,
    output: "04-storyboard/storyboard.json",
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
        model: config.qiniu.imageModel,
        prompt,
      });
      await fs.writeFile(imagePath, imageResult.buffer);
      await writeJson(path.join(dirs.images, `${shotId}.meta.json`), {
        model: config.qiniu.imageModel,
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
        model: config.qiniu.imageModel,
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

  if (config.qiniu.imageCompareModels.length) {
    const imageCompareDir = path.join(runDir, "comparisons", "image");
    await ensureDir(imageCompareDir);
    const firstShot = shots[0];
    const prompt = buildFinalImagePrompt(firstShot, characters, storyboard.style_guide);
    for (const model of config.qiniu.imageCompareModels) {
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
    storyboard: "04-storyboard/storyboard.json",
    subtitles: "07-subtitles/subtitles.srt",
    finalVideo: "08-video/final-demo.mp4",
  };
  manifest.shots = shotOutputs;
  manifest.completedAt = new Date().toISOString();

  await writeJson(path.join(runDir, "manifest.json"), manifest);
  await writeJson(path.join(runDir, "model-matrix.json"), {
    provider: "Qiniu MaaS / SUFY",
    baseUrl: config.qiniu.baseUrl,
    primary: {
      text: config.qiniu.textModel,
      image: config.qiniu.imageModel,
      voice: {
        narrator: config.qiniu.voices.narrator,
        female: config.qiniu.voices.female,
        male: config.qiniu.voices.male,
      },
    },
    comparisons: {
      text: config.qiniu.textCompareModels,
      image: config.qiniu.imageCompareModels,
    },
  });

  console.log(JSON.stringify({ runId, finalVideoPath, runDir }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

