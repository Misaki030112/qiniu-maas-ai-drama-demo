"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getVideoCapabilities } from "../video-capabilities.js";

const inspectorTabs = [
  { id: "image", label: "绘图" },
  { id: "video", label: "视频" },
  { id: "audio", label: "台词与配音" },
];

const builtinVoices = [
  { value: "qiniu_zh_female_ljfdxx", label: "旁白女声" },
  { value: "qiniu_zh_female_wwxkjx", label: "角色女声" },
  { value: "qiniu_zh_male_whxkxg", label: "角色男声" },
];

function findSelectedAsset(items = [], selectedId = "") {
  return items.find((item) => item.id === selectedId) || items[0] || null;
}

function subjectLabel(kind) {
  return kind === "character" ? "角色" : kind === "scene" ? "场景" : "道具";
}

function hasSubjectRef(refs, item) {
  return (refs || []).some((ref) => ref.kind === item.kind && ref.key === item.key);
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

function ReferenceImagesSection({ shot, uploadRef, onUpload, onRemove, onNotify }) {
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

function VideoCapabilityOptions({ shot, capabilities, onPatch }) {
  const frameOptions = [
    { value: "", label: "不使用尾帧" },
    ...(shot.frame_assets || []).map((item, index) => ({
      value: item.id,
      label: `静帧 ${index + 1}`,
    })),
    ...(shot.reference_images || []).map((item, index) => ({
      value: `ref:${item.id || item.path || index}`,
      label: `参考图 ${index + 1}`,
    })),
  ];

  return (
    <>
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
          <div className="studio-inline-note">默认使用当前选中的静帧作为首帧。</div>
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
  const currentFrame = currentShot ? findSelectedAsset(currentShot.frame_assets, currentShot.selected_frame_asset_id) : null;
  const currentVideo = currentShot ? findSelectedAsset(currentShot.video_assets, currentShot.selected_video_asset_id) : null;
  const capabilities = getVideoCapabilities(models.shotVideo || "");

  function patchCurrentShot(patch) {
    if (!currentShot) {
      return;
    }
    onPatchShot(currentShot.shot_id, patch);
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
      return "";
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
            </div>
          </div>
        ) : null}

        {inspectorTab === "video" ? (
          <div className="storyboard-inspector__panel">
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
              />
            ) : null}
            <VideoCapabilityOptions shot={currentShot} capabilities={capabilities} onPatch={patchCurrentShot} />
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
                  audio_config: {
                    ...(currentShot.audio_config || {}),
                    speaker: event.target.value,
                  },
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
                value={currentShot.audio_config?.voiceType || builtinVoices[0].value}
                onChange={(event) => patchCurrentShot({
                  audio_config: {
                    ...(currentShot.audio_config || {}),
                    voiceType: event.target.value,
                  },
                })}
              >
                {builtinVoices.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
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
