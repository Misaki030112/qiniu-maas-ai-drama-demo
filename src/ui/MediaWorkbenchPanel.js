"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getVideoCapabilities } from "../video-capabilities.js";
import { findVoicePresetByLabel, findVoicePresetByType, getVoiceCatalog } from "../voice-catalog.js";

const inspectorTabs = [
  { id: "image", label: "绘图" },
  { id: "video", label: "视频" },
  { id: "audio", label: "台词与配音" },
];

const builtinVoices = getVoiceCatalog();

function findSelectedAsset(items = [], selectedId = "") {
  return items.find((item) => item.id === selectedId) || items[0] || null;
}

function subjectLabel(kind) {
  return kind === "character" ? "角色" : kind === "scene" ? "场景" : "道具";
}

function hasSubjectRef(refs, item) {
  return (refs || []).some((ref) => ref.kind === item.kind && ref.key === item.key);
}

function capabilityChips(capabilities) {
  return [
    capabilities.text_to_video ? "文生视频" : "",
    capabilities.image_to_video ? "图生视频" : "",
    capabilities.supports_first_frame ? "首帧" : "",
    capabilities.supports_last_frame ? "尾帧" : "",
    capabilities.supports_subject_reference ? "主体参考" : "",
    capabilities.supports_reference_images ? "参考图" : "",
    capabilities.supports_reference_video ? "参考视频" : "",
    capabilities.supports_audio_generation ? "音效" : "",
  ].filter(Boolean);
}

function SubjectRefSection({ library, refs, onToggle }) {
  return (
    <div className="studio-field">
      <span>参考主体</span>
      <div className="storyboard-ref-subjects">
        {library.map((item) => {
          const active = hasSubjectRef(refs, item);
          return (
            <button
              key={`${item.kind}:${item.key}`}
              type="button"
              className={active ? "storyboard-ref-subject active" : "storyboard-ref-subject"}
              onClick={() => onToggle(item)}
            >
              {item.url ? <img src={item.url} alt={item.name} /> : null}
              <span>{item.name}</span>
              <small>{subjectLabel(item.kind)}</small>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ReferenceImagesSection({
  shot,
  uploadRef,
  onUpload,
  onRemove,
  onNotify,
  onUseAsFirstFrame,
  onUseAsLastFrame,
}) {
  return (
    <div className="studio-field">
      <span>参考图片</span>
      <div className="studio-reference-grid">
        <label className="studio-reference-upload">
          <input
            ref={uploadRef}
            className="studio-reference-upload__input"
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                onUpload(shot.shot_id, file);
                event.target.value = "";
              }
            }}
          />
          <span className="studio-reference-upload__plus">+</span>
          <span className="studio-reference-upload__label">图片</span>
        </label>
        {(shot.reference_images || []).map((item) => (
          <div key={item.path || item.url} className="studio-reference-tile">
            <button type="button" className="studio-reference-tile__preview">
              <img src={item.url} alt={item.name || "reference"} />
            </button>
            <div className="studio-reference-tile__actions">
              <button type="button" onClick={() => onNotify?.("右侧参考图已加入当前镜头")}>已引用</button>
              {onUseAsFirstFrame ? <button type="button" onClick={() => onUseAsFirstFrame(item)}>用作首帧</button> : null}
              {onUseAsLastFrame ? <button type="button" onClick={() => onUseAsLastFrame(item)}>用作尾帧</button> : null}
              <button type="button" onClick={() => onRemove(shot.shot_id, item.path)}>移除</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function buildSubjectLibrary(project) {
  return [
    ...(project?.artifacts?.roleReferences || []).map((item) => ({ ...item, kind: "character" })),
    ...(project?.artifacts?.sceneReferences || []).map((item) => ({ ...item, kind: "scene" })),
    ...(project?.artifacts?.propReferences || []).map((item) => ({ ...item, kind: "prop" })),
  ];
}

function mediaPreviewTitle(shot) {
  return shot?.shot_description || shot?.title || shot?.shot_no || shot?.shot_id || "当前镜头";
}

function buildFrameChoiceOptions(shot) {
  return [
    { value: "", label: "不使用尾帧" },
    ...(shot.frame_assets || []).map((item, index) => ({
      value: item.id,
      label: `静帧 ${index + 1}`,
      path: item.path,
    })),
    ...(shot.reference_images || []).map((item, index) => ({
      value: `ref:${item.id || item.path || index}`,
      label: `参考图 ${index + 1}`,
      path: item.path,
    })),
  ];
}

function VideoCapabilityOptions({ shot, capabilities, onPatch }) {
  const frameOptions = buildFrameChoiceOptions(shot);

  return (
    <>
      {capabilities.displayName?.startsWith("Kling") ? (
        <div className="studio-field">
          <span>模式</span>
          <div className="studio-option-grid studio-option-grid--wide">
            {["std", "pro"].map((mode) => (
              <button
                key={mode}
                type="button"
                className={(shot.video_options?.mode || "std") === mode ? "studio-option-card active" : "studio-option-card"}
                onClick={() => onPatch({
                  video_options: {
                    ...(shot.video_options || {}),
                    mode,
                  },
                })}
              >
                <strong>{mode.toUpperCase()}</strong>
              </button>
            ))}
          </div>
          {capabilities.supports_last_frame && (shot.video_options?.mode || "std") === "std" ? (
            <div className="studio-inline-note">尾帧控制在部分可灵模型的 STD 模式下可能不可用，必要时切到 PRO。</div>
          ) : null}
        </div>
      ) : null}

      {capabilities.supports_duration_options?.length ? (
        <div className="studio-field">
          <span>时长</span>
          <div className="studio-option-grid studio-option-grid--wide">
            {capabilities.supports_duration_options.map((duration) => (
              <button
                key={duration}
                type="button"
                className={shot.video_options?.durationSec === duration ? "studio-option-card active" : "studio-option-card"}
                onClick={() => onPatch({
                  video_options: {
                    ...(shot.video_options || {}),
                    durationSec: duration,
                  },
                })}
              >
                <strong>{duration}s</strong>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {capabilities.supports_resolution_options?.length ? (
        <label className="studio-field">
          <span>清晰度</span>
          <select
            value={shot.video_options?.resolution || ""}
            onChange={(event) => onPatch({
              video_options: {
                ...(shot.video_options || {}),
                resolution: event.target.value,
              },
            })}
          >
            <option value="">自动</option>
            {capabilities.supports_resolution_options.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
      ) : null}

      {capabilities.supports_first_frame ? (
        <div className="studio-field">
          <span>首帧图</span>
          <div className="studio-inline-note">
            {shot.video_options?.firstFrameLabel
              ? `当前首帧：${shot.video_options.firstFrameLabel}`
              : "默认使用当前选中的静帧作为首帧。"}
          </div>
        </div>
      ) : null}

      {capabilities.supports_last_frame ? (
        <label className="studio-field">
          <span>尾帧图</span>
          <select
            value={shot.video_options?.lastFrameAssetId || ""}
            onChange={(event) => onPatch({
              video_options: {
                ...(shot.video_options || {}),
                lastFrameAssetId: event.target.value,
              },
            })}
          >
            {frameOptions.map((option) => <option key={option.value || "none"} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      ) : null}

      {capabilities.supports_audio_generation ? (
        <label className="studio-switch-row">
          <span>同步生成音效</span>
          <button
            type="button"
            className={shot.video_options?.enableAudio ? "studio-toggle active" : "studio-toggle"}
            onClick={() => onPatch({
              video_options: {
                ...(shot.video_options || {}),
                enableAudio: !shot.video_options?.enableAudio,
              },
            })}
          >
            <span />
          </button>
        </label>
      ) : null}
    </>
  );
}

function ShotFilmstrip({ shots, selectedShotId, onSelectShot }) {
  return (
    <div className="storyboard-filmstrip">
      {shots.map((shot, index) => {
        const frame = findSelectedAsset(shot.frame_assets, shot.selected_frame_asset_id);
        const selected = shot.shot_id === selectedShotId;
        return (
          <button
            key={shot.shot_id}
            type="button"
            className={selected ? "storyboard-filmstrip__card active" : "storyboard-filmstrip__card"}
            onClick={() => onSelectShot(shot.shot_id)}
          >
            <div className="storyboard-filmstrip__thumb">
              {frame?.url ? <img src={frame.url} alt={shot.shot_no || shot.shot_id} /> : <div className="storyboard-filmstrip__placeholder">空镜头</div>}
              <span className="storyboard-filmstrip__shotno">{shot.shot_no || `镜头${index + 1}`}</span>
              <span className="storyboard-filmstrip__duration">{Number(shot.duration_sec || 4)}s</span>
            </div>
            <span className="storyboard-filmstrip__title">{shot.title || mediaPreviewTitle(shot)}</span>
          </button>
        );
      })}
    </div>
  );
}

export function MediaWorkbenchPanel({
  project,
  workbench,
  models,
  modelOptions,
  onChangeModels,
  onPatchShot,
  onSaveShot,
  onGenerateShotImage,
  onGenerateShotVideo,
  onGenerateShotAudio,
  onPreviewShotAudio,
  onBatchGenerateImages,
  onBatchGenerateVideos,
  onUploadReferenceImage,
  onRemoveReferenceImage,
  onNotify,
  busy,
}) {
  const [selectedShotId, setSelectedShotId] = useState("");
  const [inspectorTab, setInspectorTab] = useState("image");
  const [audioPreviewUrl, setAudioPreviewUrl] = useState("");
  const uploadRef = useRef(null);

  const shots = workbench?.shots || [];
  const subjectLibrary = useMemo(() => buildSubjectLibrary(project), [project]);

  useEffect(() => {
    if (!shots.length) {
      setSelectedShotId("");
      return;
    }
    if (!shots.some((item) => item.shot_id === selectedShotId)) {
      setSelectedShotId(shots[0].shot_id);
    }
  }, [shots, selectedShotId]);

  useEffect(() => () => {
    if (audioPreviewUrl) {
      URL.revokeObjectURL(audioPreviewUrl);
    }
  }, [audioPreviewUrl]);

  const currentShot = shots.find((item) => item.shot_id === selectedShotId) || null;
  const currentShotIndex = shots.findIndex((item) => item.shot_id === selectedShotId);
  const previousShot = currentShotIndex > 0 ? shots[currentShotIndex - 1] : null;
  const characterLibrary = project?.artifacts?.characters?.characters || [];
  const currentFrame = currentShot ? findSelectedAsset(currentShot.frame_assets, currentShot.selected_frame_asset_id) : null;
  const currentVideo = currentShot ? findSelectedAsset(currentShot.video_assets, currentShot.selected_video_asset_id) : null;
  const capabilities = getVideoCapabilities(models.shotVideo || "");
  const capabilityLabels = capabilityChips(capabilities);
  const currentSpeakerCharacter = useMemo(
    () => characterLibrary.find((item) => item.name === (currentShot?.audio_config?.speaker || currentShot?.speaker || "")) || null,
    [characterLibrary, currentShot],
  );
  const currentVoicePreset = findVoicePresetByType(currentShot?.audio_config?.voiceType) || findVoicePresetByLabel(currentShot?.audio_config?.voiceLabel);

  function patchCurrentShot(patch) {
    if (!currentShot) {
      return;
    }
    onPatchShot(currentShot.shot_id, patch);
  }

  function applyVoicePreset(preset) {
    if (!preset || !currentShot) {
      return;
    }
    patchCurrentShot({
      audio_config: {
        ...(currentShot.audio_config || {}),
        voiceType: preset.voiceType,
        voiceLabel: preset.label,
        speedRatio: Number(currentShot.audio_config?.speedRatio || preset.speedRatio || 1),
        volume: Number(currentShot.audio_config?.volume || preset.volume || 5),
        pitch: Number(currentShot.audio_config?.pitch || preset.pitch || 1),
        emotion: currentShot.audio_config?.emotion || preset.emotion || "",
      },
    });
  }

  function toggleSubjectRef(item) {
    if (!currentShot) {
      return;
    }
    const refs = currentShot.subject_refs || [];
    const exists = refs.some((ref) => ref.kind === item.kind && ref.key === item.key);
    const nextRefs = exists
      ? refs.filter((ref) => !(ref.kind === item.kind && ref.key === item.key))
      : [...refs, { kind: item.kind, key: item.key }];
    patchCurrentShot({ subject_refs: nextRefs });
  }

  function addCurrentFrameAsReference() {
    if (!currentShot || !currentFrame?.path) {
      return;
    }
    const exists = (currentShot.reference_images || []).some((item) => item.path === currentFrame.path);
    if (exists) {
      onNotify?.("当前静帧已经在参考图片区");
      return;
    }
    patchCurrentShot({
      reference_images: [
        ...(currentShot.reference_images || []),
        {
          id: currentFrame.id,
          name: currentShot.shot_no || currentShot.shot_id,
          path: currentFrame.path,
          url: currentFrame.url,
          refKind: "subject",
          generatedAt: currentFrame.generatedAt || "",
        },
      ],
    });
    onNotify?.("当前静帧已加入参考图片区");
  }

  function useAssetAsFirstFrame(item, label) {
    if (!currentShot || !item?.path) {
      return;
    }
    patchCurrentShot({
      video_options: {
        ...(currentShot.video_options || {}),
        useFirstFrame: true,
        firstFramePath: item.path,
        firstFrameLabel: label,
      },
    });
    onNotify?.(`已设置首帧：${label}`);
  }

  function useAssetAsLastFrame(item, label) {
    if (!currentShot || !item?.path) {
      return;
    }
    patchCurrentShot({
      video_options: {
        ...(currentShot.video_options || {}),
        lastFrameAssetId: "",
        lastFramePath: item.path,
        lastFrameLabel: label,
      },
    });
    onNotify?.(`已设置尾帧：${label}`);
  }

  function previousShotFrameCandidate() {
    if (!previousShot) {
      return null;
    }
    return findSelectedAsset(previousShot.frame_assets, previousShot.selected_frame_asset_id);
  }

  function previousShotTailCandidate() {
    if (!previousShot?.video_options?.lastFramePath) {
      return previousShotFrameCandidate();
    }
    return {
      path: previousShot.video_options.lastFramePath,
      label: previousShot.video_options.lastFrameLabel || `${previousShot.shot_no || previousShot.shot_id} 尾帧`,
    };
  }

  async function handleAudioPreview() {
    if (!currentShot) {
      return;
    }
    const blob = await onPreviewShotAudio(currentShot.shot_id);
    if (audioPreviewUrl) {
      URL.revokeObjectURL(audioPreviewUrl);
    }
    const url = URL.createObjectURL(blob);
    setAudioPreviewUrl(url);
  }

  function resolveTailFramePath() {
    if (!currentShot?.video_options?.lastFrameAssetId) {
      return currentShot?.video_options?.lastFramePath || "";
    }
    const value = currentShot.video_options.lastFrameAssetId;
    if (value.startsWith("ref:")) {
      const ref = (currentShot.reference_images || []).find((item) => `ref:${item.id || item.path}` === value);
      return ref?.path || "";
    }
    const frame = (currentShot.frame_assets || []).find((item) => item.id === value);
    return frame?.path || "";
  }

  if (!currentShot) {
    return (
      <section className="storyboard-workbench">
        <div className="studio-placeholder-card">
          <strong>当前没有故事板镜头</strong>
          <span>先完成分镜阶段，再进入故事板制作台。</span>
        </div>
      </section>
    );
  }

  return (
    <section className="storyboard-workbench">
      <div className="storyboard-workbench__main">
        <div className="storyboard-preview">
          <div className="storyboard-preview__top">
            <div>
              <h2>{currentShot.shot_no || currentShot.shot_id}</h2>
              <p>{mediaPreviewTitle(currentShot)}</p>
            </div>
            <div className="studio-inline-actions">
              <button type="button" onClick={() => setInspectorTab("audio")}>台词与配音</button>
              <button type="button" onClick={onBatchGenerateImages} disabled={busy}>批量生图</button>
              <button type="button" onClick={onBatchGenerateVideos} disabled={busy}>批量生视频</button>
            </div>
          </div>
          <div className="storyboard-preview__canvas">
            {inspectorTab === "video" && currentVideo?.url ? (
              <video controls src={currentVideo.url} />
            ) : currentFrame?.url ? (
              <img src={currentFrame.url} alt={currentShot.shot_no || currentShot.shot_id} />
            ) : (
              <div className="storyboard-preview__placeholder">当前镜头还没有可预览素材</div>
            )}
          </div>
          <div className="storyboard-preview__subtitle">
            <span>{currentShot.dialogue || "空镜"}</span>
          </div>
          <div className="storyboard-preview__timeline-head">
            <strong>全部分镜（共{shots.length}个分镜）</strong>
          </div>
          <ShotFilmstrip shots={shots} selectedShotId={selectedShotId} onSelectShot={setSelectedShotId} />
        </div>
      </div>

      <aside className="storyboard-inspector">
        <div className="storyboard-inspector__tabs">
          {inspectorTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={tab.id === inspectorTab ? "storyboard-inspector__tab active" : "storyboard-inspector__tab"}
              onClick={() => setInspectorTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {inspectorTab === "image" ? (
          <div className="storyboard-inspector__panel">
            <label className="studio-field">
              <span>图片提示词</span>
              <textarea
                className="studio-description"
                value={currentShot.image_prompt || ""}
                onChange={(event) => patchCurrentShot({ image_prompt: event.target.value })}
              />
            </label>
            <label className="studio-field">
              <span>图片模型</span>
              <select value={models.shotImage || ""} onChange={(event) => onChangeModels({ shotImage: event.target.value })}>
                {modelOptions.shotImage.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <SubjectRefSection library={subjectLibrary} refs={currentShot.subject_refs} onToggle={toggleSubjectRef} />
            <ReferenceImagesSection
              shot={currentShot}
              uploadRef={uploadRef}
              onUpload={onUploadReferenceImage}
              onRemove={onRemoveReferenceImage}
              onNotify={onNotify}
              onUseAsFirstFrame={capabilities.supports_first_frame ? (item) => useAssetAsFirstFrame(item, item.name || "参考图") : null}
              onUseAsLastFrame={capabilities.supports_last_frame ? (item) => useAssetAsLastFrame(item, item.name || "参考图") : null}
            />
            <div className="studio-action-stack">
              <button className="studio-secondary" type="button" onClick={() => onSaveShot(currentShot.shot_id)} disabled={busy}>
                保存当前镜头
              </button>
              <button className="studio-primary" type="button" onClick={() => onGenerateShotImage(currentShot.shot_id)} disabled={busy}>
                生成当前镜头图片
              </button>
            </div>
            <div className="studio-field">
              <span>分镜素材</span>
              <div className="storyboard-assets-grid">
                {(currentShot.frame_assets || []).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={item.id === currentShot.selected_frame_asset_id ? "storyboard-asset active" : "storyboard-asset"}
                    onClick={() => patchCurrentShot({ selected_frame_asset_id: item.id })}
                  >
                    {item.url ? <img src={item.url} alt={item.model || "frame"} /> : null}
                    <span>{item.model || "图片"}</span>
                  </button>
                ))}
              </div>
              <div className="studio-inline-actions studio-inline-actions--wrap">
                <button type="button" onClick={addCurrentFrameAsReference} disabled={!currentFrame}>加入参考图</button>
                {capabilities.supports_first_frame ? (
                  <button
                    type="button"
                    onClick={() => useAssetAsFirstFrame(currentFrame, `${currentShot.shot_no || currentShot.shot_id} 当前静帧`)}
                    disabled={!currentFrame}
                  >
                    设为首帧
                  </button>
                ) : null}
                {capabilities.supports_last_frame ? (
                  <button
                    type="button"
                    onClick={() => useAssetAsLastFrame(currentFrame, `${currentShot.shot_no || currentShot.shot_id} 当前静帧`)}
                    disabled={!currentFrame}
                  >
                    设为尾帧
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {inspectorTab === "video" ? (
          <div className="storyboard-inspector__panel">
            <div className="studio-field">
              <span>模型能力</span>
              <div className="studio-chip-row">
                {capabilityLabels.map((label) => <span key={label} className="studio-chip">{label}</span>)}
              </div>
              {capabilities.supports_first_frame || capabilities.supports_last_frame ? (
                <div className="studio-inline-note">
                  当前支持首尾帧的视频模型：Veo 3.1 Fast、Veo 3.1、Kling V2.1、Kling V2.5 Turbo、Kling V2.6、Kling Video O1。
                </div>
              ) : null}
              {["kling-v2-5-turbo", "kling-v2-6"].includes(String(models.shotVideo || "")) ? (
                <div className="studio-inline-note">
                  当前模型走首帧/尾帧模式，不接收额外主体参考图。若要使用多主体/参考图视频，请切到 Kling Video O1。
                </div>
              ) : null}
              {String(models.shotVideo || "").startsWith("sora-") ? (
                <div className="studio-inline-note">
                  Sora 2 支持参考图 + 文本生成视频。当前接入要求参考图是公网可访问 URL；若你现在在本地 localhost 上运行，需要先配置 `APP_BASE_URL` 或使用外部公网图片。
                </div>
              ) : null}
            </div>
            <label className="studio-field">
              <span>视频提示词</span>
              <textarea
                className="studio-description"
                value={currentShot.video_prompt || ""}
                onChange={(event) => patchCurrentShot({ video_prompt: event.target.value })}
              />
            </label>
            <label className="studio-field">
              <span>视频模型</span>
              <select value={models.shotVideo || ""} onChange={(event) => onChangeModels({ shotVideo: event.target.value })}>
                {modelOptions.shotVideo.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            {capabilities.supports_subject_reference ? (
              <SubjectRefSection library={subjectLibrary} refs={currentShot.subject_refs} onToggle={toggleSubjectRef} />
            ) : null}
            {capabilities.supports_reference_images ? (
              <ReferenceImagesSection
                shot={currentShot}
                uploadRef={uploadRef}
                onUpload={onUploadReferenceImage}
                onRemove={onRemoveReferenceImage}
                onNotify={onNotify}
                onUseAsFirstFrame={capabilities.supports_first_frame ? (item) => useAssetAsFirstFrame(item, item.name || "参考图") : null}
                onUseAsLastFrame={capabilities.supports_last_frame ? (item) => useAssetAsLastFrame(item, item.name || "参考图") : null}
              />
            ) : null}
            <VideoCapabilityOptions shot={currentShot} capabilities={capabilities} onPatch={patchCurrentShot} />
            {(capabilities.supports_first_frame || capabilities.supports_last_frame) ? (
              <div className="studio-field">
                <span>快捷帧引用</span>
                <div className="studio-inline-actions studio-inline-actions--wrap">
                  {capabilities.supports_first_frame ? (
                    <button
                      type="button"
                      onClick={() => useAssetAsFirstFrame(currentFrame, `${currentShot.shot_no || currentShot.shot_id} 当前静帧`)}
                      disabled={!currentFrame}
                    >
                      当前静帧作首帧
                    </button>
                  ) : null}
                  {capabilities.supports_last_frame ? (
                    <button
                      type="button"
                      onClick={() => useAssetAsLastFrame(currentFrame, `${currentShot.shot_no || currentShot.shot_id} 当前静帧`)}
                      disabled={!currentFrame}
                    >
                      当前静帧作尾帧
                    </button>
                  ) : null}
                  {capabilities.supports_first_frame ? (
                    <button
                      type="button"
                      onClick={() => {
                        const candidate = previousShotFrameCandidate();
                        if (candidate) {
                          useAssetAsFirstFrame(candidate, `${previousShot?.shot_no || previousShot?.shot_id} 首帧`);
                        }
                      }}
                      disabled={!previousShotFrameCandidate()}
                    >
                      沿用上个镜头首帧
                    </button>
                  ) : null}
                  {capabilities.supports_last_frame ? (
                    <button
                      type="button"
                      onClick={() => {
                        const candidate = previousShotTailCandidate();
                        if (candidate) {
                          useAssetAsLastFrame(candidate, candidate.label || `${previousShot?.shot_no || previousShot?.shot_id} 尾帧`);
                        }
                      }}
                      disabled={!previousShotTailCandidate()}
                    >
                      沿用上个镜头尾帧
                    </button>
                  ) : null}
                  {capabilities.supports_first_frame ? (
                    <button
                      type="button"
                      onClick={() => patchCurrentShot({
                        video_options: {
                          ...(currentShot.video_options || {}),
                          firstFramePath: "",
                          firstFrameLabel: "",
                          useFirstFrame: true,
                        },
                      })}
                    >
                      清空首帧快捷引用
                    </button>
                  ) : null}
                  {capabilities.supports_last_frame ? (
                    <button
                      type="button"
                      onClick={() => patchCurrentShot({
                        video_options: {
                          ...(currentShot.video_options || {}),
                          lastFrameAssetId: "",
                          lastFramePath: "",
                          lastFrameLabel: "",
                        },
                      })}
                    >
                      清空尾帧
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
            <div className="studio-action-stack">
              <button className="studio-secondary" type="button" onClick={() => onSaveShot(currentShot.shot_id)} disabled={busy}>
                保存当前镜头
              </button>
              <button
                className="studio-primary"
                type="button"
                onClick={() => onGenerateShotVideo(currentShot.shot_id, {
                  durationSec: currentShot.video_options?.durationSec || currentShot.duration_sec || 4,
                  resolution: currentShot.video_options?.resolution || "",
                  enableAudio: Boolean(currentShot.video_options?.enableAudio),
                  tailFramePath: resolveTailFramePath(),
                })}
                disabled={busy}
              >
                生成当前镜头视频
              </button>
            </div>
            <div className="studio-field">
              <span>视频分镜素材</span>
              <div className="storyboard-assets-grid">
                {(currentShot.video_assets || []).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={item.id === currentShot.selected_video_asset_id ? "storyboard-asset active" : "storyboard-asset"}
                    onClick={() => patchCurrentShot({ selected_video_asset_id: item.id })}
                  >
                    <div className="storyboard-asset__video">
                      {item.url ? <video src={item.url} muted /> : null}
                    </div>
                    <span>{item.model || "视频"}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {inspectorTab === "audio" ? (
          <div className="storyboard-inspector__panel">
            <label className="studio-field">
              <span>对白角色</span>
              <select
                value={currentShot.audio_config?.speaker || currentShot.speaker || "旁白"}
                onChange={(event) => patchCurrentShot({
                  audio_config: (() => {
                    const speaker = event.target.value;
                    const matchedCharacter = characterLibrary.find((item) => item.name === speaker);
                    const matchedPreset =
                      findVoicePresetByType(matchedCharacter?.voice_profile?.voiceType) ||
                      findVoicePresetByLabel(matchedCharacter?.voice_profile?.label) ||
                      currentVoicePreset ||
                      builtinVoices[0];
                    return {
                      ...(currentShot.audio_config || {}),
                      speaker,
                      voiceType: matchedPreset?.voiceType || currentShot.audio_config?.voiceType || builtinVoices[0].voiceType,
                      voiceLabel: matchedPreset?.label || currentShot.audio_config?.voiceLabel || builtinVoices[0].label,
                      speedRatio: Number(matchedCharacter?.voice_profile?.speedRatio || currentShot.audio_config?.speedRatio || 1),
                      volume: Number(matchedCharacter?.voice_profile?.volume || currentShot.audio_config?.volume || 5),
                      pitch: Number(matchedCharacter?.voice_profile?.pitch || currentShot.audio_config?.pitch || 1),
                      emotion: matchedCharacter?.voice_profile?.emotion || currentShot.audio_config?.emotion || "",
                    };
                  })(),
                  subject_refs: (() => {
                    const speaker = event.target.value;
                    if (!speaker || speaker === "旁白") {
                      return currentShot.subject_refs || [];
                    }
                    const refs = currentShot.subject_refs || [];
                    if (refs.some((item) => item.kind === "character" && item.key === speaker)) {
                      return refs;
                    }
                    return [...refs, { kind: "character", key: speaker }];
                  })(),
                })}
              >
                <option value="旁白">空镜 / 旁白</option>
                {(project?.artifacts?.characters?.characters || []).map((item) => (
                  <option key={item.name} value={item.name}>{item.name}</option>
                ))}
              </select>
            </label>
            <label className="studio-field">
              <span>配音</span>
              <select
                value={currentShot.audio_config?.voiceLabel || currentVoicePreset?.label || builtinVoices[0].label}
                onChange={(event) => patchCurrentShot({
                  audio_config: (() => {
                    const preset = findVoicePresetByLabel(event.target.value) || builtinVoices[0];
                    return {
                      ...(currentShot.audio_config || {}),
                      voiceType: preset.voiceType,
                      voiceLabel: preset.label,
                    };
                  })(),
                })}
              >
                {builtinVoices.map((item) => <option key={item.key} value={item.label}>{item.label}</option>)}
              </select>
            </label>
            {currentSpeakerCharacter?.voice_profile?.label ? (
              <div className="studio-inline-note">
                角色默认音色：{currentSpeakerCharacter.voice_profile.label}
                {currentSpeakerCharacter.voice_style ? `，声音气质：${currentSpeakerCharacter.voice_style}` : ""}
                <button
                  type="button"
                  className="studio-inline-link"
                  onClick={() => applyVoicePreset(currentSpeakerCharacter.voice_profile)}
                >
                  应用角色默认音色
                </button>
              </div>
            ) : null}
            <label className="studio-field">
              <span>语速</span>
              <input
                type="range"
                min="0.7"
                max="1.4"
                step="0.05"
                value={currentShot.audio_config?.speedRatio || 1}
                onChange={(event) => patchCurrentShot({
                  audio_config: {
                    ...(currentShot.audio_config || {}),
                    speedRatio: Number(event.target.value),
                  },
                })}
              />
            </label>
            <label className="studio-field">
              <span>音量</span>
              <input
                type="range"
                min="1"
                max="10"
                step="1"
                value={currentShot.audio_config?.volume || 5}
                onChange={(event) => patchCurrentShot({
                  audio_config: {
                    ...(currentShot.audio_config || {}),
                    volume: Number(event.target.value),
                  },
                })}
              />
            </label>
            <label className="studio-field">
              <span>语调</span>
              <input
                type="range"
                min="0.7"
                max="1.3"
                step="0.05"
                value={currentShot.audio_config?.pitch || 1}
                onChange={(event) => patchCurrentShot({
                  audio_config: {
                    ...(currentShot.audio_config || {}),
                    pitch: Number(event.target.value),
                  },
                })}
              />
            </label>
            <label className="studio-field">
              <span>台词</span>
              <textarea
                className="studio-description"
                value={currentShot.audio_config?.text || currentShot.dialogue || ""}
                onChange={(event) => patchCurrentShot({
                  dialogue: event.target.value,
                  audio_config: {
                    ...(currentShot.audio_config || {}),
                    text: event.target.value,
                  },
                })}
              />
            </label>
            <div className="studio-action-stack">
              <button className="studio-secondary" type="button" onClick={handleAudioPreview} disabled={busy}>
                试听
              </button>
              <button className="studio-secondary" type="button" onClick={() => onNotify?.("口型同步当前未接入")} disabled={busy}>
                对口型
              </button>
              <button className="studio-primary" type="button" onClick={() => onGenerateShotAudio(currentShot.shot_id)} disabled={busy}>
                生成配音
              </button>
            </div>
            {audioPreviewUrl ? <audio controls src={audioPreviewUrl} /> : null}
            {currentShot.audio_asset?.url ? <audio controls src={currentShot.audio_asset.url} /> : null}
          </div>
        ) : null}
      </aside>
    </section>
  );
}
