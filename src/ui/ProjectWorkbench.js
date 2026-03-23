"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

const tabs = [
  { id: "script", label: "剧本", stage: "adaptation" },
  { id: "characters", label: "主体", stage: "characters" },
  { id: "storyboard", label: "分镜", stage: "storyboard" },
  { id: "media", label: "画面", stage: "media" },
  { id: "output", label: "成片", stage: "output" },
];

const subjectKinds = [
  { id: "character", label: "角色", key: "characters" },
  { id: "scene", label: "场景", key: "scenes" },
  { id: "prop", label: "道具", key: "props" },
];

const modelOptions = {
  adaptation: ["openai/gpt-5.4", "openai/gpt-5.4-mini", "gemini-2.5-pro", "minimax/minimax-m2.5", "deepseek-v3-0324"],
  characters: ["openai/gpt-5.4", "gemini-2.5-pro", "minimax/minimax-m2.5", "deepseek-v3-0324", "openai/gpt-5.4-mini"],
  storyboard: ["gemini-2.5-pro", "openai/gpt-5.4", "minimax/minimax-m2.5", "deepseek-v3-0324", "openai/gpt-5.4-mini"],
  roleImage: ["imagen-4", "gemini-2.5-flash-image", "gpt-image-1", "minimax-image-01"],
  shotImage: ["imagen-4", "gemini-2.5-flash-image", "gpt-image-1", "minimax-image-01"],
  shotVideo: ["veo-3.1-fast-generate-001", "veo-3.1-generate-001", "sora-2", "sora-2-pro", "kling-v3", "kling-v3-omni"],
};

const stageDeps = {
  adaptation: [],
  characters: ["adaptation"],
  storyboard: ["characters"],
  media: ["storyboard"],
  output: ["media"],
  video: ["media"],
};

function stageStatusText(status) {
  return {
    idle: "未开始",
    ready: "可执行",
    queued: "排队中",
    running: "生成中",
    done: "已完成",
    stale: "待更新",
    error: "失败",
    blocked: "待接入",
  }[status] || "未开始";
}

function canRunStage(project, stage, storyText) {
  if (stage === "adaptation") {
    return Boolean(storyText.trim());
  }
  return (stageDeps[stage] || []).every((dependency) => project?.stageState?.[dependency]?.status === "done");
}

function nextTabFromProject(project) {
  if (!project) {
    return "script";
  }
  if (project.stageState.characters.status !== "done") {
    return "script";
  }
  if (project.stageState.storyboard.status !== "done") {
    return "characters";
  }
  if (project.stageState.media.status !== "done") {
    return "storyboard";
  }
  if (project.stageState.output.status !== "done" && project.stageState.video.status !== "done") {
    return "media";
  }
  return "output";
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function StatusDot({ status }) {
  return <span className={`studio-status-dot ${status || "idle"}`} />;
}

function StageStrip({ project }) {
  return (
    <div className="studio-stage-strip">
      {tabs.map((item, index) => (
        <div key={item.id} className="studio-stage-chip">
          <span className="studio-stage-chip__index">{index + 1}</span>
          <div>
            <strong>{item.label}</strong>
            <span>{stageStatusText(project?.stageState?.[item.stage]?.status)}</span>
          </div>
          <StatusDot status={project?.stageState?.[item.stage]?.status} />
        </div>
      ))}
      <div className="studio-stage-chip">
        <span className="studio-stage-chip__index">6</span>
        <div>
          <strong>视频</strong>
          <span>{stageStatusText(project?.stageState?.video?.status)}</span>
        </div>
        <StatusDot status={project?.stageState?.video?.status} />
      </div>
    </div>
  );
}

function EmptyCard({ title, detail }) {
  return (
    <div className="studio-placeholder-card">
      <strong>{title}</strong>
      {detail ? <span>{detail}</span> : null}
    </div>
  );
}

function SideList({ tab, project }) {
  if (tab === "script") {
    const scenes = project?.artifacts?.adaptation?.scenes || [];
    return (
      <div className="studio-side-list">
        {scenes.length
          ? scenes.map((scene, index) => (
              <button key={scene.scene_id || index} type="button" className="studio-side-item">
                <strong>{scene.title || `场景 ${index + 1}`}</strong>
                <span>{scene.location || scene.objective || "未填"}</span>
              </button>
            ))
          : <EmptyCard title="暂无场景" detail="先生成剧本结构" />}
      </div>
    );
  }

  if (tab === "characters") {
    const characters = project?.artifacts?.characters?.characters || [];
    return (
      <div className="studio-side-list">
        {characters.length
          ? characters.map((item) => (
              <button key={item.name} type="button" className="studio-side-item">
                <strong>{item.name}</strong>
                <span>{item.role || "未定义"}</span>
              </button>
            ))
          : <EmptyCard title="暂无主体" detail="先生成主体" />}
      </div>
    );
  }

  const shots = project?.artifacts?.storyboard?.shots || project?.artifacts?.shots || [];
  return (
    <div className="studio-side-list">
      {shots.length
        ? shots.map((shot, index) => (
            <button key={shot.shot_id || shot.shotId || index} type="button" className="studio-side-item">
              <strong>{shot.title || shot.shot_id || shot.shotId || `镜头 ${index + 1}`}</strong>
              <span>{shot.speaker || shot.visual_focus || shot.subtitle || "未填"}</span>
            </button>
          ))
        : <EmptyCard title="暂无镜头" detail="先完成上游阶段" />}
    </div>
  );
}

function SceneCards({ adaptation }) {
  const scenes = adaptation?.scenes || [];
  return (
    <div className="studio-structured">
      {adaptation?.logline ? (
        <section className="studio-summary-card">
          <span className="studio-section-label">一句话梗概</span>
          <p>{adaptation.logline}</p>
        </section>
      ) : null}
      {scenes.length ? (
        <section className="studio-card-grid">
          {scenes.map((scene, index) => (
            <article key={scene.scene_id || index} className="studio-card">
              <div className="studio-card__top">
                <strong>{scene.title || `场景 ${index + 1}`}</strong>
                <span>{scene.location || "未设定场景"}</span>
              </div>
              <p>{scene.objective || scene.summary || "暂无目标描述"}</p>
              <dl className="studio-meta-list">
                <div>
                  <dt>冲突</dt>
                  <dd>{scene.conflict || "未填"}</dd>
                </div>
                <div>
                  <dt>转折</dt>
                  <dd>{scene.turning_point || "未填"}</dd>
                </div>
              </dl>
            </article>
          ))}
        </section>
      ) : <EmptyCard title="当前还没有剧本骨架结果" detail="先执行剧本生成。" />}
    </div>
  );
}

function ShotCards({ storyboard }) {
  const shots = storyboard?.shots || [];
  return shots.length ? (
    <section className="studio-card-grid">
      {shots.map((shot, index) => (
        <article key={shot.shot_id || index} className="studio-card">
          <div className="studio-card__top">
            <strong>{shot.title || shot.shot_id || `镜头 ${index + 1}`}</strong>
            <span>{shot.camera || "未填机位"}</span>
          </div>
          <p>{shot.visual_focus || "暂无镜头重点"}</p>
          <dl className="studio-meta-list">
            <div>
              <dt>人物</dt>
              <dd>{shot.speaker || "未填"}</dd>
            </div>
            <div>
              <dt>时长</dt>
              <dd>{shot.duration_sec || 0}s</dd>
            </div>
            <div>
              <dt>字幕</dt>
              <dd>{shot.subtitle || shot.line || "未填"}</dd>
            </div>
          </dl>
        </article>
      ))}
    </section>
  ) : <EmptyCard title="当前还没有分镜结果" detail="先完成主体阶段。" />;
}

function MediaCards({ shots }) {
  return shots?.length ? (
    <section className="studio-shot-grid">
      {shots.map((shot) => (
        <article key={shot.shotId} className="studio-shot">
          {shot.imageUrl ? <img src={shot.imageUrl} alt={shot.shotId} /> : null}
          <strong>{shot.shotId}</strong>
          <span>{shot.speaker}</span>
          <p>{shot.subtitle}</p>
          <div className="studio-shot__meta">
            <span>图片：{shot.imageStatus === "ok" ? "已生成" : "回退"}</span>
            <span>配音：{shot.audioStatus === "ok" ? "已生成" : "回退"}</span>
          </div>
          {shot.audioUrl ? <audio controls src={shot.audioUrl} /> : null}
        </article>
      ))}
    </section>
  ) : <EmptyCard title="当前还没有画面结果" detail="先生成画面和配音。" />;
}

function OutputPanel({ project }) {
  const staticUrl = project.artifacts?.outputVideoUrl;
  const videoUrl = project.artifacts?.videoOutputUrl;
  return (
    <div className="studio-output-grid">
      <section className="studio-panel studio-main-panel">
        <div className="studio-panel__header">
          <h2>静态合成</h2>
          <span className="studio-panel__meta">{stageStatusText(project.stageState?.output?.status)}</span>
        </div>
        {staticUrl ? <video controls src={staticUrl} /> : <EmptyCard title="暂无静态合成结果" detail="可先执行静态合成。" />}
      </section>
      <section className="studio-panel studio-main-panel">
        <div className="studio-panel__header">
          <h2>视频模型结果</h2>
          <span className="studio-panel__meta">{stageStatusText(project.stageState?.video?.status)}</span>
        </div>
        {videoUrl ? <video controls src={videoUrl} /> : <EmptyCard title="暂无视频模型结果" detail="视频阶段单独执行。" />}
      </section>
    </div>
  );
}

function SubjectTypeTabs({ payload, kind, onChange }) {
  return (
    <div className="studio-subject-tabs">
      {subjectKinds.map((item) => (
        <button
          key={item.id}
          type="button"
          className={item.id === kind ? "studio-subject-tab active" : "studio-subject-tab"}
          onClick={() => onChange(item.id)}
        >
          {item.label}
          <span>{payload?.[item.key]?.length || 0}</span>
        </button>
      ))}
    </div>
  );
}

function subjectDescription(item, kind) {
  if (!item) {
    return "";
  }
  if (kind === "character") {
    return item.continuity_prompt || item.appearance || "";
  }
  return item.continuity_prompt || item.description || "";
}

function subjectSubtitle(item, kind) {
  if (kind === "character") {
    return item.role || "未设定角色定位";
  }
  if (kind === "scene") {
    return item.location || "未设定场景地点";
  }
  return item.description || "未设定道具描述";
}

function SubjectGrid({
  items,
  references,
  kind,
  selectedKey,
  onSelect,
  onCreate,
  onDuplicate,
  onDelete,
  onMove,
}) {
  return (
    <section className="studio-subject-grid">
      {items.map((item, index) => {
        const ref = references.find((candidate) => candidate.key === item.name);
        const active = selectedKey === item.name;
        return (
          <article key={`${item.name}-${index}`} className={active ? "studio-subject-card active" : "studio-subject-card"}>
            <button type="button" className="studio-subject-card__select" onClick={() => onSelect(item.name)}>
              <div className="studio-subject-card__media">
                {ref?.url ? <img src={ref.url} alt={item.name} /> : <div className="studio-subject-card__placeholder">{kind === "character" ? "角色" : kind === "scene" ? "场景" : "道具"}</div>}
              </div>
              <div className="studio-subject-card__body">
                <strong>{item.name}</strong>
                <span>{subjectSubtitle(item, kind)}</span>
              </div>
            </button>
            <div className="studio-inline-actions">
              <button type="button" onClick={() => onMove(index, -1)} disabled={index === 0}>上移</button>
              <button type="button" onClick={() => onMove(index, 1)} disabled={index === items.length - 1}>下移</button>
              <button type="button" onClick={() => onDuplicate(index)}>复制</button>
              <button type="button" onClick={() => onDelete(index)}>删除</button>
            </div>
          </article>
        );
      })}
      <button type="button" className="studio-subject-card studio-subject-card--create" onClick={onCreate}>
        <div className="studio-subject-card__placeholder">+</div>
        <strong>{kind === "character" ? "新增角色" : kind === "scene" ? "新增场景" : "新增道具"}</strong>
      </button>
    </section>
  );
}

function StructuredScriptModal({ value, onChange, onSave, onClose, isPending }) {
  function updateScene(index, key, fieldValue) {
    onChange((current) => {
      const next = deepClone(current);
      next.scenes[index][key] = fieldValue;
      return next;
    });
  }

  function moveScene(index, offset) {
    onChange((current) => {
      const next = deepClone(current);
      const target = index + offset;
      if (target < 0 || target >= next.scenes.length) {
        return next;
      }
      const [item] = next.scenes.splice(index, 1);
      next.scenes.splice(target, 0, item);
      return next;
    });
  }

  function addScene() {
    onChange((current) => {
      const next = deepClone(current);
      const count = next.scenes?.length || 0;
      next.scenes = [
        ...(next.scenes || []),
        {
          scene_id: `scene_${count + 1}`,
          title: `新场景${count + 1}`,
          location: "",
          time_of_day: "",
          objective: "",
          conflict: "",
          turning_point: "",
        },
      ];
      return next;
    });
  }

  function removeScene(index) {
    onChange((current) => {
      const next = deepClone(current);
      next.scenes.splice(index, 1);
      return next;
    });
  }

  return (
    <div className="studio-modal-backdrop">
      <div className="studio-modal">
        <div className="studio-panel__header">
          <h2>剧本结构编辑</h2>
          <button className="studio-ghost" type="button" onClick={onClose}>关闭</button>
        </div>
        <label className="studio-field">
          <span>一句话梗概</span>
          <textarea className="studio-textarea-small" value={value.logline || ""} onChange={(event) => onChange((current) => ({ ...current, logline: event.target.value }))} />
        </label>
        <div className="studio-modal-list">
          {(value.scenes || []).map((scene, index) => (
            <div key={scene.scene_id || index} className="studio-modal-card">
              <div className="studio-panel__header">
                <strong>{scene.title || `场景 ${index + 1}`}</strong>
                <div className="studio-inline-actions">
                  <button type="button" onClick={() => moveScene(index, -1)} disabled={index === 0}>上移</button>
                  <button type="button" onClick={() => moveScene(index, 1)} disabled={index === value.scenes.length - 1}>下移</button>
                  <button type="button" onClick={() => removeScene(index)}>删除</button>
                </div>
              </div>
              <label className="studio-field"><span>标题</span><input value={scene.title || ""} onChange={(event) => updateScene(index, "title", event.target.value)} /></label>
              <label className="studio-field"><span>地点</span><input value={scene.location || ""} onChange={(event) => updateScene(index, "location", event.target.value)} /></label>
              <label className="studio-field"><span>推进目标</span><textarea className="studio-textarea-small" value={scene.objective || ""} onChange={(event) => updateScene(index, "objective", event.target.value)} /></label>
              <label className="studio-field"><span>冲突</span><textarea className="studio-textarea-small" value={scene.conflict || ""} onChange={(event) => updateScene(index, "conflict", event.target.value)} /></label>
              <label className="studio-field"><span>转折</span><textarea className="studio-textarea-small" value={scene.turning_point || ""} onChange={(event) => updateScene(index, "turning_point", event.target.value)} /></label>
            </div>
          ))}
        </div>
        <div className="studio-modal__actions">
          <button className="studio-secondary" type="button" onClick={addScene}>新增场景</button>
          <button className="studio-secondary" type="button" onClick={onClose}>取消</button>
          <button className="studio-primary" type="button" onClick={onSave} disabled={isPending}>保存结构</button>
        </div>
      </div>
    </div>
  );
}

function StructuredStoryboardModal({ value, onChange, onSave, onClose, isPending }) {
  function updateShot(index, key, fieldValue) {
    onChange((current) => {
      const next = deepClone(current);
      next.shots[index][key] = key === "duration_sec" ? Number(fieldValue || 0) : fieldValue;
      return next;
    });
  }

  return (
    <div className="studio-modal-backdrop">
      <div className="studio-modal">
        <div className="studio-panel__header">
          <h2>分镜结构编辑</h2>
          <button className="studio-ghost" type="button" onClick={onClose}>关闭</button>
        </div>
        <div className="studio-modal-list">
          {(value.shots || []).map((shot, index) => (
            <div key={shot.shot_id || index} className="studio-modal-card">
              <strong>{shot.title || `镜头 ${index + 1}`}</strong>
              <label className="studio-field"><span>标题</span><input value={shot.title || ""} onChange={(event) => updateShot(index, "title", event.target.value)} /></label>
              <label className="studio-field"><span>机位</span><input value={shot.camera || ""} onChange={(event) => updateShot(index, "camera", event.target.value)} /></label>
              <label className="studio-field"><span>镜头重点</span><textarea className="studio-textarea-small" value={shot.visual_focus || ""} onChange={(event) => updateShot(index, "visual_focus", event.target.value)} /></label>
              <label className="studio-field"><span>说话人</span><input value={shot.speaker || ""} onChange={(event) => updateShot(index, "speaker", event.target.value)} /></label>
              <label className="studio-field"><span>字幕</span><textarea className="studio-textarea-small" value={shot.subtitle || ""} onChange={(event) => updateShot(index, "subtitle", event.target.value)} /></label>
              <label className="studio-field"><span>时长</span><input type="number" value={shot.duration_sec || 0} onChange={(event) => updateShot(index, "duration_sec", event.target.value)} /></label>
            </div>
          ))}
        </div>
        <div className="studio-modal__actions">
          <button className="studio-secondary" type="button" onClick={onClose}>取消</button>
          <button className="studio-primary" type="button" onClick={onSave} disabled={isPending}>保存结构</button>
        </div>
      </div>
    </div>
  );
}

function buildNewSubject(kind, index) {
  if (kind === "character") {
    return {
      name: `新角色${index + 1}`,
      role: "角色定位",
      continuity_prompt: "",
      appearance: "",
      voice_style: "",
    };
  }
  if (kind === "scene") {
    return {
      name: `新场景${index + 1}`,
      location: "",
      description: "",
      continuity_prompt: "",
    };
  }
  return {
    name: `新道具${index + 1}`,
    description: "",
    continuity_prompt: "",
  };
}

export function ProjectWorkbench({ projectId }) {
  const [project, setProject] = useState(null);
  const [tab, setTab] = useState("script");
  const [storyText, setStoryText] = useState("");
  const [models, setModels] = useState({});
  const [message, setMessage] = useState("");
  const [subjectKind, setSubjectKind] = useState("character");
  const [selectedSubjectKey, setSelectedSubjectKey] = useState("");
  const [modalStage, setModalStage] = useState(null);
  const [adaptationDraft, setAdaptationDraft] = useState(null);
  const [charactersDraft, setCharactersDraft] = useState(null);
  const [storyboardDraft, setStoryboardDraft] = useState(null);
  const [isPending, startTransition] = useTransition();
  const bootedRef = useRef(false);

  async function loadProject(options = {}) {
    const { preserveTab = true } = options;
    const res = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
    const data = await res.json();
    setProject(data);
    setStoryText(data.storyText || data.artifacts?.storyText || "");
    setModels(data.models || {});
    setAdaptationDraft(data.artifacts?.adaptation || { scenes: [] });
    setCharactersDraft(data.artifacts?.characters || { characters: [], scenes: [], props: [] });
    setStoryboardDraft(data.artifacts?.storyboard || { shots: [] });
    if (!bootedRef.current || !preserveTab) {
      setTab(nextTabFromProject(data));
      bootedRef.current = true;
    }
  }

  useEffect(() => {
    loadProject({ preserveTab: false });
  }, [projectId]);

  useEffect(() => {
    if (!project?.currentJob || !["queued", "running"].includes(project.currentJob.status)) {
      return undefined;
    }
    const timer = setInterval(() => {
      loadProject();
    }, 2500);
    return () => clearInterval(timer);
  }, [project?.id, project?.currentJob?.id, project?.currentJob?.status]);

  const currentKindConfig = subjectKinds.find((item) => item.id === subjectKind) || subjectKinds[0];
  const subjectItems = useMemo(
    () => charactersDraft?.[currentKindConfig.key] || [],
    [charactersDraft, currentKindConfig.key],
  );

  useEffect(() => {
    if (tab !== "characters") {
      return;
    }
    if (!subjectItems.length) {
      setSelectedSubjectKey("");
      return;
    }
    if (!subjectItems.some((item) => item.name === selectedSubjectKey)) {
      setSelectedSubjectKey(subjectItems[0].name);
    }
  }, [tab, subjectItems, selectedSubjectKey]);

  const currentSubject = useMemo(
    () => subjectItems.find((item) => item.name === selectedSubjectKey) || null,
    [subjectItems, selectedSubjectKey],
  );

  const currentReferences = subjectKind === "character"
    ? project?.artifacts?.roleReferences || []
    : subjectKind === "scene"
      ? project?.artifacts?.sceneReferences || []
      : project?.artifacts?.propReferences || [];

  function persistBase(nextMessage = "") {
    return fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storyText, models }),
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "保存失败");
      }
      setProject(data);
      if (nextMessage) {
        setMessage(nextMessage);
      }
      return data;
    });
  }

  async function saveArtifact(stage, artifactValue, nextMessage = "已保存") {
    const res = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artifactStage: stage, artifactValue }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || "保存失败");
    }
    setProject(data);
    setAdaptationDraft(data.artifacts?.adaptation || { scenes: [] });
    setCharactersDraft(data.artifacts?.characters || { characters: [], scenes: [], props: [] });
    setStoryboardDraft(data.artifacts?.storyboard || { shots: [] });
    setMessage(nextMessage);
    return data;
  }

  function runStage(stage) {
    startTransition(async () => {
      try {
        await persistBase();
        const res = await fetch(`/api/projects/${projectId}/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.message || "执行失败");
        }
        setProject(data);
        setMessage("任务已提交");
      } catch (error) {
        setMessage(error.message);
      }
    });
  }

  function updateSubjectList(mutator) {
    setCharactersDraft((current) => {
      const next = deepClone(current || { characters: [], scenes: [], props: [] });
      mutator(next);
      return next;
    });
  }

  function createSubject() {
    updateSubjectList((draft) => {
      const next = buildNewSubject(subjectKind, draft[currentKindConfig.key].length);
      draft[currentKindConfig.key].push(next);
      setSelectedSubjectKey(next.name);
    });
    setMessage("已新增当前项，记得保存。");
  }

  function duplicateSubject(index) {
    updateSubjectList((draft) => {
      const current = draft[currentKindConfig.key][index];
      const clone = deepClone(current);
      clone.name = `${clone.name}-副本`;
      draft[currentKindConfig.key].splice(index + 1, 0, clone);
      setSelectedSubjectKey(clone.name);
    });
    setMessage("已复制当前项，记得保存。");
  }

  function deleteSubject(index) {
    updateSubjectList((draft) => {
      const [removed] = draft[currentKindConfig.key].splice(index, 1);
      if (removed?.name === selectedSubjectKey) {
        const next = draft[currentKindConfig.key][Math.max(0, index - 1)];
        setSelectedSubjectKey(next?.name || "");
      }
    });
    setMessage("已删除当前项，记得保存。");
  }

  function moveSubject(index, offset) {
    updateSubjectList((draft) => {
      const list = draft[currentKindConfig.key];
      const target = index + offset;
      if (target < 0 || target >= list.length) {
        return;
      }
      const [item] = list.splice(index, 1);
      list.splice(target, 0, item);
    });
    setMessage("已调整顺序，记得保存。");
  }

  function updateCurrentSubject(field, value) {
    updateSubjectList((draft) => {
      const index = draft[currentKindConfig.key].findIndex((item) => item.name === selectedSubjectKey);
      if (index === -1) {
        return;
      }
      draft[currentKindConfig.key][index][field] = value;
      if (field === "name") {
        setSelectedSubjectKey(value);
      }
    });
  }

  function saveCurrentSubject(regenerate = false) {
    startTransition(async () => {
      try {
        const latestDraft = deepClone(charactersDraft);
        await saveArtifact("characters", latestDraft, regenerate ? "当前项已保存，准备重生成" : "当前项已保存");
        if (regenerate && currentSubject?.name) {
          const res = await fetch(`/api/projects/${projectId}/subjects/regenerate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: subjectKind, key: currentSubject.name }),
          });
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.message || "重生成失败");
          }
          setProject(data);
          setCharactersDraft(data.artifacts?.characters || { characters: [], scenes: [], props: [] });
          setMessage("当前项已重生成");
        }
      } catch (error) {
        setMessage(error.message || "处理失败");
      }
    });
  }

  if (!project) {
    return <div className="project-loading">加载中</div>;
  }

  const currentTab = tabs.find((item) => item.id === tab) || tabs[0];
  const currentStageStatus = project.stageState?.[currentTab.stage]?.status;
  const job = project.currentJob;
  const jobRunning = job && ["queued", "running"].includes(job.status);

  return (
    <section className="studio studio--workspace">
      <header className="workspace-topbar">
        <div className="workspace-topbar__left">
          <Link href="/projects" className="workspace-back">返回</Link>
          <div className="workspace-title">
            <h1>{project.name}</h1>
            <span>点众 AI 真人剧 Demo</span>
          </div>
        </div>
        <nav className="studio-tabs">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === tab ? "studio-tab active" : "studio-tab"}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="studio-badges">
          <span className="studio-badge">{currentTab.label}</span>
          <span className="studio-badge muted">{stageStatusText(currentStageStatus)}</span>
          {jobRunning ? <span className="studio-badge running">{job.progressText || "生成中"}</span> : null}
          {message ? <span className="studio-badge muted">{message}</span> : null}
        </div>
      </header>

      <div className="studio-body studio-body--workspace">
        <aside className="studio-side">
          <SideList tab={tab} project={project} />
        </aside>

        <main className="studio-main">
          <StageStrip project={project} />

          {tab === "script" ? (
            <section className="studio-panel studio-main-panel">
              <div className="studio-panel__header">
                <h2>故事输入</h2>
                <span className="studio-panel__meta">{storyText.length}/2000</span>
              </div>
              <textarea className="studio-editor" value={storyText} onChange={(event) => setStoryText(event.target.value)} />
              <SceneCards adaptation={adaptationDraft} />
            </section>
          ) : null}

          {tab === "characters" ? (
            <section className="studio-panel studio-main-panel">
              <div className="studio-panel__header">
                <h2>主体资产</h2>
                <span className="studio-panel__meta">角色 / 场景 / 道具</span>
              </div>
              <SubjectTypeTabs payload={charactersDraft} kind={subjectKind} onChange={setSubjectKind} />
              <SubjectGrid
                items={subjectItems}
                references={currentReferences}
                kind={subjectKind}
                selectedKey={selectedSubjectKey}
                onSelect={setSelectedSubjectKey}
                onCreate={createSubject}
                onDuplicate={duplicateSubject}
                onDelete={deleteSubject}
                onMove={moveSubject}
              />
            </section>
          ) : null}

          {tab === "storyboard" ? (
            <section className="studio-panel studio-main-panel">
              <div className="studio-panel__header">
                <h2>分镜结构</h2>
              </div>
              <ShotCards storyboard={storyboardDraft} />
            </section>
          ) : null}

          {tab === "media" ? (
            <section className="studio-panel studio-main-panel">
              <div className="studio-panel__header">
                <h2>画面与配音</h2>
              </div>
              <MediaCards shots={project.artifacts?.shots} />
            </section>
          ) : null}

          {tab === "output" ? <OutputPanel project={project} /> : null}

          {jobRunning ? (
            <div className="studio-loading-mask">
              <div className="studio-loading-card">
                <div className="studio-spinner" />
                <strong>{job.status === "queued" ? "任务排队中" : "任务执行中"}</strong>
                <span>{job.progressText || "正在处理中"}</span>
              </div>
            </div>
          ) : null}
        </main>

        <aside className="studio-settings">
          <section className="studio-panel">
            <div className="studio-panel__header">
              <h2>{tab === "characters" ? "生成主体图" : "阶段设置"}</h2>
              <span className="studio-panel__meta">{stageStatusText(currentStageStatus)}</span>
            </div>

            {tab === "script" ? (
              <>
                <label className="studio-field">
                  <span>剧本模型</span>
                  <select value={models.adaptation || ""} onChange={(event) => setModels((current) => ({ ...current, adaptation: event.target.value }))}>
                    {modelOptions.adaptation.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <div className="studio-action-stack">
                  <button className="studio-primary" type="button" onClick={() => runStage("adaptation")} disabled={isPending || jobRunning || !canRunStage(project, "adaptation", storyText)}>
                    生成剧本
                  </button>
                  <button className="studio-secondary" type="button" onClick={() => persistBase("已保存")} disabled={isPending || jobRunning}>
                    保存
                  </button>
                  <button className="studio-secondary" type="button" onClick={() => setModalStage("script")}>
                    编辑剧情
                  </button>
                </div>
              </>
            ) : null}

            {tab === "characters" ? (
              <>
                <label className="studio-field">
                  <span>主体模型</span>
                  <select value={models.roleImage || ""} onChange={(event) => setModels((current) => ({ ...current, roleImage: event.target.value }))}>
                    {modelOptions.roleImage.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <button className="studio-primary" type="button" onClick={() => runStage("characters")} disabled={isPending || jobRunning || !canRunStage(project, "characters", storyText)}>
                  批量生成主体
                </button>

                {currentSubject ? (
                  <div className="studio-detail-editor">
                    <span className="studio-section-label">{currentSubject.name}</span>
                    <label className="studio-field">
                      <span>{subjectKind === "character" ? "角色名" : subjectKind === "scene" ? "场景名" : "道具名"}</span>
                      <input value={currentSubject.name || ""} onChange={(event) => updateCurrentSubject("name", event.target.value)} />
                    </label>
                    {subjectKind === "character" ? (
                      <label className="studio-field">
                        <span>角色定位</span>
                        <input value={currentSubject.role || ""} onChange={(event) => updateCurrentSubject("role", event.target.value)} />
                      </label>
                    ) : null}
                    {subjectKind === "scene" ? (
                      <label className="studio-field">
                        <span>场景地点</span>
                        <input value={currentSubject.location || ""} onChange={(event) => updateCurrentSubject("location", event.target.value)} />
                      </label>
                    ) : null}
                    <label className="studio-field">
                      <span>完整描述</span>
                      <textarea
                        className="studio-description"
                        value={subjectDescription(currentSubject, subjectKind)}
                        onChange={(event) => {
                          if (subjectKind === "character") {
                            updateCurrentSubject("continuity_prompt", event.target.value);
                          } else {
                            updateCurrentSubject("continuity_prompt", event.target.value);
                            updateCurrentSubject("description", event.target.value);
                          }
                        }}
                      />
                    </label>
                    <div className="studio-action-stack">
                      <button className="studio-secondary" type="button" onClick={() => saveCurrentSubject(false)} disabled={isPending || jobRunning}>
                        保存当前项
                      </button>
                      <button className="studio-primary" type="button" onClick={() => saveCurrentSubject(true)} disabled={isPending || jobRunning}>
                        重生成当前项
                      </button>
                    </div>
                  </div>
                ) : (
                  <EmptyCard title="当前未选中主体" detail="左侧选择或新增一个主体项。" />
                )}
              </>
            ) : null}

            {tab === "storyboard" ? (
              <>
                <label className="studio-field">
                  <span>分镜模型</span>
                  <select value={models.storyboard || ""} onChange={(event) => setModels((current) => ({ ...current, storyboard: event.target.value }))}>
                    {modelOptions.storyboard.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <div className="studio-action-stack">
                  <button className="studio-primary" type="button" onClick={() => runStage("storyboard")} disabled={isPending || jobRunning || !canRunStage(project, "storyboard", storyText)}>
                    生成分镜
                  </button>
                  <button className="studio-secondary" type="button" onClick={() => setModalStage("storyboard")}>
                    编辑分镜
                  </button>
                </div>
              </>
            ) : null}

            {tab === "media" ? (
              <>
                <label className="studio-field">
                  <span>画面模型</span>
                  <select value={models.shotImage || ""} onChange={(event) => setModels((current) => ({ ...current, shotImage: event.target.value }))}>
                    {modelOptions.shotImage.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <button className="studio-primary" type="button" onClick={() => runStage("media")} disabled={isPending || jobRunning || !canRunStage(project, "media", storyText)}>
                  生成画面
                </button>
              </>
            ) : null}

            {tab === "output" ? (
              <>
                <label className="studio-field">
                  <span>视频模型</span>
                  <select value={models.shotVideo || ""} onChange={(event) => setModels((current) => ({ ...current, shotVideo: event.target.value }))}>
                    {modelOptions.shotVideo.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <div className="studio-action-stack">
                  <button className="studio-secondary" type="button" onClick={() => runStage("output")} disabled={isPending || jobRunning || !canRunStage(project, "output", storyText)}>
                    静态合成
                  </button>
                  <button className="studio-primary" type="button" onClick={() => runStage("video")} disabled={isPending || jobRunning || !canRunStage(project, "video", storyText)}>
                    视频生成
                  </button>
                </div>
              </>
            ) : null}

            <div className="studio-summary-card">
              <span className="studio-section-label">当前任务</span>
              <p>{job ? `${job.stage} / ${stageStatusText(job.status)} / ${job.progressText || "已创建"}` : "当前无任务"}</p>
            </div>
          </section>
        </aside>
      </div>

      {modalStage === "script" && adaptationDraft ? (
        <StructuredScriptModal
          value={adaptationDraft}
          onChange={setAdaptationDraft}
          onSave={() => {
            startTransition(async () => {
              try {
                await saveArtifact("adaptation", adaptationDraft, "剧情结构已保存");
                setModalStage(null);
              } catch (error) {
                setMessage(error.message || "保存失败");
              }
            });
          }}
          onClose={() => setModalStage(null)}
          isPending={isPending}
        />
      ) : null}

      {modalStage === "storyboard" && storyboardDraft ? (
        <StructuredStoryboardModal
          value={storyboardDraft}
          onChange={setStoryboardDraft}
          onSave={() => {
            startTransition(async () => {
              try {
                await saveArtifact("storyboard", storyboardDraft, "分镜结构已保存");
                setModalStage(null);
              } catch (error) {
                setMessage(error.message || "保存失败");
              }
            });
          }}
          onClose={() => setModalStage(null)}
          isPending={isPending}
        />
      ) : null}
    </section>
  );
}
