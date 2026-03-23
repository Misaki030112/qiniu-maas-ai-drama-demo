"use client";

import { useEffect, useRef, useState, useTransition } from "react";

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
  adaptation: [
    "openai/gpt-5.4",
    "openai/gpt-5.4-mini",
    "gemini-2.5-pro",
    "minimax/minimax-m2.5",
    "deepseek-v3-0324",
  ],
  characters: [
    "openai/gpt-5.4",
    "gemini-2.5-pro",
    "minimax/minimax-m2.5",
    "deepseek-v3-0324",
    "openai/gpt-5.4-mini",
  ],
  storyboard: [
    "gemini-2.5-pro",
    "openai/gpt-5.4",
    "minimax/minimax-m2.5",
    "deepseek-v3-0324",
    "openai/gpt-5.4-mini",
  ],
  roleImage: [
    "imagen-4",
    "gemini-2.5-flash-image",
    "gpt-image-1",
    "minimax-image-01",
  ],
  shotImage: [
    "imagen-4",
    "gemini-2.5-flash-image",
    "gpt-image-1",
    "minimax-image-01",
  ],
  shotVideo: [
    "veo-3.1-fast-generate-001",
    "veo-3.1-generate-001",
    "sora-2",
    "sora-2-pro",
    "kling-v3",
    "kling-v3-omni",
  ],
};

const stageDeps = {
  adaptation: [],
  characters: ["adaptation"],
  storyboard: ["characters"],
  media: ["storyboard"],
  output: ["media"],
  video: ["media"],
};

function prettyJson(value) {
  return value ? JSON.stringify(value, null, 2) : "";
}

function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

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
          : <EmptyCard title="暂无主体" detail="生成主体后在这里选择" />}
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
  const relations = adaptation?.character_relations || adaptation?.relationships || [];
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
      ) : (
        <EmptyCard title="当前还没有剧本骨架结果" detail="右侧先执行剧本生成，或手动进入结构编辑。" />
      )}
      {relations.length ? (
        <section className="studio-summary-card">
          <span className="studio-section-label">人物关系</span>
          <div className="studio-tag-list">
            {relations.map((item, index) => (
              <span key={index} className="studio-tag">
                {typeof item === "string"
                  ? item
                  : `${item.source || item.a || "角色A"} / ${item.target || item.b || "角色B"} / ${item.relation || item.type || "关系"}`}
              </span>
            ))}
          </div>
        </section>
      ) : null}
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

function SubjectGrid({ items, references, selectedKey, onSelect, kind, onCreate }) {
  return (
    <section className="studio-subject-grid">
      {items.map((item) => {
        const ref = references.find((candidate) => candidate.key === item.name);
        const active = selectedKey === item.name;
        return (
          <button
            key={item.name}
            type="button"
            className={active ? "studio-subject-card active" : "studio-subject-card"}
            onClick={() => onSelect(item.name)}
          >
            <div className="studio-subject-card__media">
              {ref?.url ? <img src={ref.url} alt={item.name} /> : <div className="studio-subject-card__placeholder">{kind === "character" ? "角色" : kind === "scene" ? "场景" : "道具"}</div>}
            </div>
            <div className="studio-subject-card__body">
              <strong>{item.name}</strong>
              <span>{item.role || item.location || item.description || "未填描述"}</span>
            </div>
          </button>
        );
      })}
      <button type="button" className="studio-subject-card studio-subject-card--create" onClick={onCreate}>
        <div className="studio-subject-card__placeholder">+</div>
        <strong>{kind === "character" ? "新增角色" : kind === "scene" ? "新增场景" : "新增道具"}</strong>
      </button>
    </section>
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
          {shot.image_prompt ? (
            <div className="studio-prompt-block">
              <span>画面提示词</span>
              <p>{shot.image_prompt}</p>
            </div>
          ) : null}
          {shot.video_prompt ? (
            <div className="studio-prompt-block">
              <span>视频提示词</span>
              <p>{shot.video_prompt}</p>
            </div>
          ) : null}
        </article>
      ))}
    </section>
  ) : (
    <EmptyCard title="当前还没有分镜结果" detail="先执行主体阶段，或进入结构编辑。" />
  );
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
  ) : (
    <EmptyCard title="当前还没有画面结果" detail="先执行分镜后的画面生成。" />
  );
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
        {staticUrl ? <video controls src={staticUrl} /> : <EmptyCard title="暂无静态合成结果" detail="可以先执行静态合成。" />}
      </section>
      <section className="studio-panel studio-main-panel">
        <div className="studio-panel__header">
          <h2>视频模型结果</h2>
          <span className="studio-panel__meta">{stageStatusText(project.stageState?.video?.status)}</span>
        </div>
        {videoUrl ? <video controls src={videoUrl} /> : <EmptyCard title="暂无视频模型结果" detail="视频阶段单独执行，不和静态合成混在一起。" />}
      </section>
    </div>
  );
}

function StageEditorModal({ title, value, onChange, onSave, onClose, isPending }) {
  return (
    <div className="studio-modal-backdrop">
      <div className="studio-modal">
        <div className="studio-panel__header">
          <h2>{title}</h2>
          <button className="studio-ghost" type="button" onClick={onClose}>关闭</button>
        </div>
        <textarea className="studio-json studio-json--modal" value={value} onChange={(event) => onChange(event.target.value)} />
        <div className="studio-modal__actions">
          <button className="studio-secondary" type="button" onClick={onClose}>取消</button>
          <button className="studio-primary" type="button" onClick={onSave} disabled={isPending}>保存结构</button>
        </div>
      </div>
    </div>
  );
}

function clonePayload(payload) {
  return JSON.parse(JSON.stringify(payload || { characters: [], scenes: [], props: [] }));
}

function buildNewSubject(kind, index) {
  if (kind === "character") {
    return {
      name: `新角色${index + 1}`,
      role: "新角色定位",
      gender: "female",
      age_range: "25-35",
      personality: ["冷静"],
      appearance: "",
      wardrobe: "",
      visual_anchor: [],
      continuity_prompt: "",
      negative_prompt: "",
      voice_style: "",
    };
  }
  if (kind === "scene") {
    return {
      name: `新场景${index + 1}`,
      location: "",
      description: "",
      continuity_prompt: "",
      negative_prompt: "",
    };
  }
  return {
    name: `新道具${index + 1}`,
    description: "",
    continuity_prompt: "",
    negative_prompt: "",
  };
}

export function ProjectWorkbench({ projectId }) {
  const [project, setProject] = useState(null);
  const [tab, setTab] = useState("script");
  const [storyText, setStoryText] = useState("");
  const [models, setModels] = useState({});
  const [adaptationText, setAdaptationText] = useState("");
  const [charactersText, setCharactersText] = useState("");
  const [storyboardText, setStoryboardText] = useState("");
  const [message, setMessage] = useState("");
  const [modalStage, setModalStage] = useState(null);
  const [subjectKind, setSubjectKind] = useState("character");
  const [selectedSubjectKey, setSelectedSubjectKey] = useState("");
  const [subjectDraft, setSubjectDraft] = useState(null);
  const [isPending, startTransition] = useTransition();
  const bootedRef = useRef(false);

  async function loadProject(options = {}) {
    const { preserveTab = true } = options;
    const res = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
    const data = await res.json();
    setProject(data);
    setStoryText(data.storyText || data.artifacts?.storyText || "");
    setModels(data.models || {});
    setAdaptationText(prettyJson(data.artifacts?.adaptation));
    setCharactersText(prettyJson(data.artifacts?.characters));
    setStoryboardText(prettyJson(data.artifacts?.storyboard));
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

  const charactersPayload = project?.artifacts?.characters || { characters: [], scenes: [], props: [] };
  const currentKindConfig = subjectKinds.find((item) => item.id === subjectKind) || subjectKinds[0];
  const currentSubjectList = charactersPayload[currentKindConfig.key] || [];
  const currentReferences = subjectKind === "character"
    ? project?.artifacts?.roleReferences || []
    : subjectKind === "scene"
      ? project?.artifacts?.sceneReferences || []
      : project?.artifacts?.propReferences || [];

  useEffect(() => {
    if (tab !== "characters") {
      return;
    }
    if (!currentSubjectList.length) {
      setSelectedSubjectKey("");
      setSubjectDraft(null);
      return;
    }
    const nextKey = currentSubjectList.some((item) => item.name === selectedSubjectKey)
      ? selectedSubjectKey
      : currentSubjectList[0].name;
    setSelectedSubjectKey(nextKey);
    const nextSubject = currentSubjectList.find((item) => item.name === nextKey);
    setSubjectDraft(JSON.parse(JSON.stringify(nextSubject)));
  }, [tab, subjectKind, charactersText, selectedSubjectKey]);

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

  function saveArtifact(stage, text) {
    startTransition(async () => {
      try {
        const artifactValue = JSON.parse(text);
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
        if (stage === "characters") {
          setCharactersText(prettyJson(data.artifacts?.characters));
        }
        if (stage === "adaptation") {
          setAdaptationText(prettyJson(data.artifacts?.adaptation));
        }
        if (stage === "storyboard") {
          setStoryboardText(prettyJson(data.artifacts?.storyboard));
        }
        setMessage("结构已保存");
        setModalStage(null);
      } catch (error) {
        setMessage(error.message || "保存失败");
      }
    });
  }

  function updateSubjectDraft(field, value) {
    setSubjectDraft((current) => ({ ...current, [field]: value }));
  }

  function updateSubjectList(mutator) {
    const payload = clonePayload(charactersPayload);
    mutator(payload);
    setCharactersText(prettyJson(payload));
    setProject((current) => current
      ? {
          ...current,
          artifacts: {
            ...current.artifacts,
            characters: payload,
          },
        }
      : current);
    return payload;
  }

  function createSubject() {
    const payload = updateSubjectList((draft) => {
      const next = buildNewSubject(subjectKind, draft[currentKindConfig.key].length);
      draft[currentKindConfig.key].push(next);
      setSelectedSubjectKey(next.name);
      setSubjectDraft(next);
    });
    setMessage(`${subjectKind === "character" ? "角色" : subjectKind === "scene" ? "场景" : "道具"}已加入结构，记得保存。`);
    return payload;
  }

  function saveSelectedSubject({ regenerate = false } = {}) {
    if (!subjectDraft) {
      return;
    }

    startTransition(async () => {
      try {
        const currentKey = currentKindConfig.key;
        const payload = clonePayload(project?.artifacts?.characters);
        const targetIndex = payload[currentKey].findIndex((item) => item.name === selectedSubjectKey);
        if (targetIndex === -1) {
          throw new Error("未找到当前项");
        }
        payload[currentKey][targetIndex] = {
          ...payload[currentKey][targetIndex],
          ...subjectDraft,
          personality: typeof subjectDraft.personality === "string"
            ? subjectDraft.personality.split(/[,，、]/).map((item) => item.trim()).filter(Boolean)
            : subjectDraft.personality,
          visual_anchor: typeof subjectDraft.visual_anchor === "string"
            ? subjectDraft.visual_anchor.split(/[,，、]/).map((item) => item.trim()).filter(Boolean)
            : subjectDraft.visual_anchor,
        };

        const saveRes = await fetch(`/api/projects/${projectId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ artifactStage: "characters", artifactValue: payload }),
        });
        const saveData = await saveRes.json();
        if (!saveRes.ok) {
          throw new Error(saveData.message || "保存失败");
        }

        setProject(saveData);
        setCharactersText(prettyJson(saveData.artifacts?.characters));
        setSelectedSubjectKey(subjectDraft.name);
        setSubjectDraft(JSON.parse(JSON.stringify(
          saveData.artifacts?.characters?.[currentKey]?.find((item) => item.name === subjectDraft.name) || subjectDraft,
        )));

        if (!regenerate) {
          setMessage("当前项已保存");
          return;
        }

        const regenRes = await fetch(`/api/projects/${projectId}/subjects/regenerate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: subjectKind, key: subjectDraft.name }),
        });
        const regenData = await regenRes.json();
        if (!regenRes.ok) {
          throw new Error(regenData.message || "重生成失败");
        }
        setProject(regenData);
        setCharactersText(prettyJson(regenData.artifacts?.characters));
        setMessage("当前项已重生成");
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
    <section className="studio">
      <header className="studio-topbar">
        <div className="studio-project">
          <h1>{project.name}</h1>
          <span>点众 AI 真人剧 Demo</span>
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

      <div className="studio-body">
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
              <SceneCards adaptation={project.artifacts?.adaptation} />
            </section>
          ) : null}

          {tab === "characters" ? (
            <section className="studio-panel studio-main-panel">
              <div className="studio-panel__header">
                <h2>主体设定</h2>
                <span className="studio-panel__meta">按角色 / 场景 / 道具拆开控制</span>
              </div>
              <SubjectTypeTabs payload={charactersPayload} kind={subjectKind} onChange={setSubjectKind} />
              <SubjectGrid
                items={currentSubjectList}
                references={currentReferences}
                selectedKey={selectedSubjectKey}
                onSelect={setSelectedSubjectKey}
                kind={subjectKind}
                onCreate={createSubject}
              />
            </section>
          ) : null}

          {tab === "storyboard" ? (
            <section className="studio-panel studio-main-panel">
              <div className="studio-panel__header">
                <h2>分镜结构</h2>
              </div>
              <ShotCards storyboard={project.artifacts?.storyboard} />
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
              <h2>{tab === "characters" ? "当前主体" : "阶段设置"}</h2>
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
                    编辑结构
                  </button>
                </div>
              </>
            ) : null}

            {tab === "characters" ? (
              <>
                <label className="studio-field">
                  <span>角色模型</span>
                  <select value={models.characters || ""} onChange={(event) => setModels((current) => ({ ...current, characters: event.target.value }))}>
                    {modelOptions.characters.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <label className="studio-field">
                  <span>主体图模型</span>
                  <select value={models.roleImage || ""} onChange={(event) => setModels((current) => ({ ...current, roleImage: event.target.value }))}>
                    {modelOptions.roleImage.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <button className="studio-primary" type="button" onClick={() => runStage("characters")} disabled={isPending || jobRunning || !canRunStage(project, "characters", storyText)}>
                  生成主体
                </button>

                {subjectDraft ? (
                  <div className="studio-detail-editor">
                    <div className="studio-section-label">{subjectKind === "character" ? "角色" : subjectKind === "scene" ? "场景" : "道具"}</div>
                    <label className="studio-field">
                      <span>名称</span>
                      <input value={subjectDraft.name || ""} onChange={(event) => updateSubjectDraft("name", event.target.value)} />
                    </label>

                    {subjectKind === "character" ? (
                      <>
                        <label className="studio-field">
                          <span>角色定位</span>
                          <input value={subjectDraft.role || ""} onChange={(event) => updateSubjectDraft("role", event.target.value)} />
                        </label>
                        <label className="studio-field">
                          <span>年龄段</span>
                          <input value={subjectDraft.age_range || ""} onChange={(event) => updateSubjectDraft("age_range", event.target.value)} />
                        </label>
                        <label className="studio-field">
                          <span>性格关键词</span>
                          <input value={Array.isArray(subjectDraft.personality) ? subjectDraft.personality.join("、") : subjectDraft.personality || ""} onChange={(event) => updateSubjectDraft("personality", event.target.value)} />
                        </label>
                        <label className="studio-field">
                          <span>外形描述</span>
                          <textarea className="studio-textarea-small" value={subjectDraft.appearance || ""} onChange={(event) => updateSubjectDraft("appearance", event.target.value)} />
                        </label>
                        <label className="studio-field">
                          <span>稳定服装</span>
                          <textarea className="studio-textarea-small" value={subjectDraft.wardrobe || ""} onChange={(event) => updateSubjectDraft("wardrobe", event.target.value)} />
                        </label>
                        <label className="studio-field">
                          <span>声音气质</span>
                          <input value={subjectDraft.voice_style || ""} onChange={(event) => updateSubjectDraft("voice_style", event.target.value)} />
                        </label>
                      </>
                    ) : null}

                    {subjectKind === "scene" ? (
                      <>
                        <label className="studio-field">
                          <span>地点</span>
                          <input value={subjectDraft.location || ""} onChange={(event) => updateSubjectDraft("location", event.target.value)} />
                        </label>
                        <label className="studio-field">
                          <span>场景描述</span>
                          <textarea className="studio-textarea-small" value={subjectDraft.description || ""} onChange={(event) => updateSubjectDraft("description", event.target.value)} />
                        </label>
                      </>
                    ) : null}

                    {subjectKind === "prop" ? (
                      <label className="studio-field">
                        <span>道具描述</span>
                        <textarea className="studio-textarea-small" value={subjectDraft.description || ""} onChange={(event) => updateSubjectDraft("description", event.target.value)} />
                      </label>
                    ) : null}

                    <label className="studio-field">
                      <span>一致性提示词</span>
                      <textarea className="studio-textarea-small" value={subjectDraft.continuity_prompt || ""} onChange={(event) => updateSubjectDraft("continuity_prompt", event.target.value)} />
                    </label>
                    <label className="studio-field">
                      <span>负面提示词</span>
                      <textarea className="studio-textarea-small" value={subjectDraft.negative_prompt || ""} onChange={(event) => updateSubjectDraft("negative_prompt", event.target.value)} />
                    </label>

                    <div className="studio-action-stack">
                      <button className="studio-secondary" type="button" onClick={() => saveSelectedSubject()} disabled={isPending || jobRunning}>
                        保存当前项
                      </button>
                      <button className="studio-primary" type="button" onClick={() => saveSelectedSubject({ regenerate: true })} disabled={isPending || jobRunning}>
                        重生成当前项
                      </button>
                      <button className="studio-secondary" type="button" onClick={() => setModalStage("characters")}>
                        编辑整体结构
                      </button>
                    </div>
                  </div>
                ) : (
                  <EmptyCard title="当前未选中主体" detail="先生成，或先新建一个主体项。" />
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
                    编辑结构
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

      {modalStage === "script" ? (
        <StageEditorModal
          title="剧本结构编辑"
          value={adaptationText}
          onChange={setAdaptationText}
          onSave={() => saveArtifact("adaptation", adaptationText)}
          onClose={() => setModalStage(null)}
          isPending={isPending}
        />
      ) : null}

      {modalStage === "characters" ? (
        <StageEditorModal
          title="主体结构编辑"
          value={charactersText}
          onChange={setCharactersText}
          onSave={() => saveArtifact("characters", charactersText)}
          onClose={() => setModalStage(null)}
          isPending={isPending}
        />
      ) : null}

      {modalStage === "storyboard" ? (
        <StageEditorModal
          title="分镜结构编辑"
          value={storyboardText}
          onChange={setStoryboardText}
          onSave={() => saveArtifact("storyboard", storyboardText)}
          onClose={() => setModalStage(null)}
          isPending={isPending}
        />
      ) : null}
    </section>
  );
}
