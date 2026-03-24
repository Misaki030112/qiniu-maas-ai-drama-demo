import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { defaultVoicePresetForGender, normalizeVoiceProfile } from "./voice-catalog.js";

function nowIso() {
  return new Date().toISOString();
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

export async function buildReferenceInputs(outputDir, items = []) {
  const results = [];
  for (const item of items) {
    if (!item?.path) {
      continue;
    }
    const absolutePath = path.join(outputDir, item.path);
    const buffer = await fs.readFile(absolutePath);
    const mimeType = imageMimeFromPath(absolutePath);
    const base64 = buffer.toString("base64");
    results.push({
      ...item,
      base64,
      dataUri: `data:${mimeType};base64,${base64}`,
    });
  }
  return results;
}

function resolveDefaultVoice(speaker, charactersPayload) {
  if (speaker === "旁白" || !speaker) {
    return defaultVoicePresetForGender("female", "旁白").voiceType || config.qiniu.voices.narrator;
  }
  const character = (charactersPayload?.characters || []).find((item) => item.name === speaker);
  if (!character) {
    return defaultVoicePresetForGender("neutral", speaker).voiceType || config.qiniu.voices.narrator;
  }
  return normalizeVoiceProfile(character.voice_profile, character.gender, speaker).voiceType;
}

function dedupeRefs(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.kind}:${item.key}`;
    if (!item.key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function inferSubjectRefs(shot, charactersPayload) {
  if (Array.isArray(shot.subject_refs) && shot.subject_refs.length) {
    return dedupeRefs(shot.subject_refs.map((item) => ({ kind: item.kind, key: item.key })));
  }
  const refs = [];
  const text = [
    shot.scene_name,
    shot.shot_description,
    shot.dialogue,
    shot.image_prompt,
    shot.video_prompt,
  ].filter(Boolean).join("\n");

  if (shot.speaker && shot.speaker !== "旁白") {
    refs.push({ kind: "character", key: shot.speaker });
  }

  for (const item of charactersPayload?.scenes || []) {
    if (item?.name && (text.includes(item.name) || item.name.includes(shot.scene_name || ""))) {
      refs.push({ kind: "scene", key: item.name });
    }
  }

  for (const item of charactersPayload?.props || []) {
    if (item?.name && text.includes(item.name)) {
      refs.push({ kind: "prop", key: item.name });
    }
  }

  return dedupeRefs(refs);
}

function createAssetId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function mergeAssets(existing = [], seeded = []) {
  const map = new Map();
  for (const item of [...seeded, ...existing]) {
    if (!item) {
      continue;
    }
    const key = item.id || item.path || item.imagePath || item.videoPath;
    if (!key || map.has(key)) {
      continue;
    }
    map.set(key, item);
  }
  return [...map.values()];
}

function defaultMediaShot(shot, charactersPayload) {
  const character = (charactersPayload?.characters || []).find((item) => item.name === (shot.speaker || ""));
  const voiceProfile = normalizeVoiceProfile(character?.voice_profile, character?.gender, shot.speaker || "旁白");
  return {
    shot_id: shot.shot_id,
    shot_no: shot.shot_id,
    title: shot.title || shot.shot_id,
    scene_name: shot.scene_name || "",
    speaker: shot.speaker || "旁白",
    dialogue: shot.line || shot.subtitle || "",
    duration_sec: Number(shot.duration_sec || 4),
    shot_description: shot.visual_focus || "",
    image_prompt: shot.image_prompt || shot.visual_focus || "",
    video_prompt: shot.video_prompt || shot.image_prompt || shot.visual_focus || "",
    negative_prompt: shot.negative_prompt || "",
    subject_refs: inferSubjectRefs(shot, charactersPayload),
    reference_images: [],
    frame_assets: [],
    video_assets: [],
    selected_frame_asset_id: "",
    selected_video_asset_id: "",
    video_options: {
      durationSec: Number(shot.duration_sec || 4),
      mode: "std",
      resolution: "",
      enableAudio: false,
      useFirstFrame: true,
      firstFramePath: "",
      firstFrameLabel: "",
      lastFrameAssetId: "",
      lastFramePath: "",
      lastFrameLabel: "",
      referenceMode: "subject",
    },
    audio_config: {
      speaker: shot.speaker || "旁白",
      voiceType: resolveDefaultVoice(shot.speaker, charactersPayload),
      voiceLabel: voiceProfile.label,
      speedRatio: voiceProfile.speedRatio,
      volume: voiceProfile.volume,
      pitch: voiceProfile.pitch,
      emotion: voiceProfile.emotion || "",
      text: shot.line || shot.subtitle || "",
    },
    audio_asset: null,
    lip_sync_asset: null,
  };
}

function seedLegacyFrameAsset(shot) {
  if (!shot?.imagePath) {
    return null;
  }
  return {
    id: `legacy_frame_${shot.shotId}`,
    kind: "image",
    model: shot.imageModel || "",
    path: shot.imagePath,
    generatedAt: shot.generatedAt || nowIso(),
  };
}

function seedLegacyAudioAsset(shot) {
  if (!shot?.audioPath) {
    return null;
  }
  return {
    id: `legacy_audio_${shot.shotId}`,
    path: shot.audioPath,
    voiceType: shot.voiceType || "",
    durationMs: shot.durationMs || 0,
    generatedAt: shot.generatedAt || nowIso(),
  };
}

export function normalizeMediaWorkbench(workbench, storyboard, charactersPayload, manifest = null) {
  const existingShots = new Map((workbench?.shots || []).map((item) => [item.shot_id, item]));
  const legacyShots = new Map((manifest?.shots || []).map((item) => [item.shotId, item]));
  const storyboardShots = storyboard?.shots || [];

  return {
    updatedAt: workbench?.updatedAt || nowIso(),
    shots: storyboardShots.map((shot) => {
      const existing = existingShots.get(shot.shot_id) || {};
      const legacy = legacyShots.get(shot.shot_id) || null;
      const base = {
        ...defaultMediaShot(shot, charactersPayload),
        ...existing,
      };

      const frameAssets = mergeAssets(existing.frame_assets, [seedLegacyFrameAsset(legacy)]);
      const videoAssets = mergeAssets(existing.video_assets, []);
      const audioAsset = existing.audio_asset || seedLegacyAudioAsset(legacy) || null;

      return {
        ...base,
        subject_refs: existing.subject_refs?.length ? existing.subject_refs : inferSubjectRefs(shot, charactersPayload),
        reference_images: existing.reference_images || [],
        frame_assets: frameAssets,
        video_assets: videoAssets,
        selected_frame_asset_id: existing.selected_frame_asset_id || frameAssets[0]?.id || "",
        selected_video_asset_id: existing.selected_video_asset_id || videoAssets[0]?.id || "",
        video_options: {
          ...defaultMediaShot(shot, charactersPayload).video_options,
          ...(existing.video_options || {}),
        },
        audio_asset: audioAsset,
        lip_sync_asset: existing.lip_sync_asset || null,
        audio_config: {
          ...defaultMediaShot(shot, charactersPayload).audio_config,
          ...(existing.audio_config || {}),
        },
      };
    }),
  };
}

export function mapMediaAssetUrls(projectId, assets = []) {
  return assets.map((item) => ({
    ...item,
    url: item.path ? `/api/projects/${projectId}/artifacts/${item.path}${item.generatedAt ? `?v=${encodeURIComponent(item.generatedAt)}` : ""}` : "",
  }));
}

export function mapMediaWorkbenchUrls(projectId, workbench) {
  return {
    ...workbench,
    shots: (workbench?.shots || []).map((shot) => ({
      ...shot,
      reference_images: mapMediaAssetUrls(projectId, shot.reference_images || []),
      frame_assets: mapMediaAssetUrls(projectId, shot.frame_assets || []),
      video_assets: mapMediaAssetUrls(projectId, shot.video_assets || []),
      audio_asset: shot.audio_asset
        ? {
            ...shot.audio_asset,
            url: shot.audio_asset.path ? `/api/projects/${projectId}/artifacts/${shot.audio_asset.path}${shot.audio_asset.generatedAt ? `?v=${encodeURIComponent(shot.audio_asset.generatedAt)}` : ""}` : "",
          }
        : null,
      lip_sync_asset: shot.lip_sync_asset
        ? {
            ...shot.lip_sync_asset,
            url: shot.lip_sync_asset.path ? `/api/projects/${projectId}/artifacts/${shot.lip_sync_asset.path}${shot.lip_sync_asset.generatedAt ? `?v=${encodeURIComponent(shot.lip_sync_asset.generatedAt)}` : ""}` : "",
          }
        : null,
    })),
  };
}

export function appendFrameAsset(shot, asset) {
  const nextAssets = mergeAssets(shot.frame_assets, [asset]);
  return {
    ...shot,
    frame_assets: nextAssets,
    selected_frame_asset_id: asset.id,
  };
}

export function appendVideoAsset(shot, asset) {
  const nextAssets = mergeAssets(shot.video_assets, [asset]);
  return {
    ...shot,
    video_assets: nextAssets,
    selected_video_asset_id: asset.id,
  };
}

export function createFrameAsset({ path: assetPath, model, prompt }) {
  return {
    id: createAssetId("frame"),
    kind: "image",
    path: assetPath,
    model,
    prompt,
    generatedAt: nowIso(),
  };
}

export function createVideoAsset({ path: assetPath, model, prompt, durationSec, provider, settings = {} }) {
  return {
    id: createAssetId("video"),
    kind: "video",
    path: assetPath,
    model,
    prompt,
    provider,
    durationSec,
    settings,
    generatedAt: nowIso(),
  };
}

export function createAudioAsset({ path: assetPath, voiceType, durationMs }) {
  return {
    id: createAssetId("audio"),
    path: assetPath,
    voiceType,
    durationMs,
    generatedAt: nowIso(),
  };
}
