"use client";

import { useEffect, useRef, useState, useTransition } from "react";

const tabs = [
  { id: "script", label: "剧本", stage: "adaptation" },
  { id: "characters", label: "主体", stage: "characters" },
  { id: "storyboard", label: "分镜", stage: "storyboard" },
  { id: "media", label: "画面", stage: "media" },
  { id: "output", label: "成片", stage: "output" },
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
  if (project.stageState.storyboard.status === "done" && project.stageState.media.status !== "done") {
    return "media";
  }
  if (project.stageState.characters.status !== "done") {
    return "script";
  }
  if (project.stageState.storyboard.status !== "done") {
    return "characters";
  }
  if (project.stageState.output.status !== "done" && project.stageState.video.status !== "done") {
    return "storyboard";
  }
  return "output";
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
          : <div className="studio-empty">暂无场景</div>}
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
          : <div className="studio-empty">暂无主体</div>}
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
        : <div className="studio-empty">暂无镜头</div>}
    </div>
  );
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
        <div className="studio-empty">当前还没有剧本骨架结果</div>
      )}
      {relations.length ? (
        <section className="studio-summary-card">
          <span className="studio-section-label">人物关系</span>
          <div className="studio-tag-list">
            {relations.map((item, index) => (
              <span key={index} className="studio-tag">
                {typeof item === "string" ? item : `${item.source || item.a || "角色A"} / ${item.target || item.b || "角色B"} / ${item.relation || item.type || "关系"}`}
              </span>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function CharacterCards({ characters, roleReferences }) {
  const list = characters?.characters || [];
  return (
    <div className="studio-structured">
      {list.length ? (
        <section className="studio-card-grid">
          {list.map((item) => (
            <article key={item.name} className="studio-card">
              <div className="studio-card__top">
                <strong>{item.name}</strong>
                <span>{item.role || "未定义角色"}</span>
              </div>
              <p>{item.appearance || "暂无外形描述"}</p>
              <dl className="studio-meta-list">
                <div>
                  <dt>年龄</dt>
                  <dd>{item.age_range || "未填"}</dd>
                </div>
                <div>
                  <dt>声音</dt>
                  <dd>{item.voice_style || "未填"}</dd>
                </div>
              </dl>
              <div className="studio-tag-list">
                {(item.personality || []).map((tag) => (
                  <span key={tag} className="studio-tag">{tag}</span>
                ))}
              </div>
            </article>
          ))}
        </section>
      ) : (
        <div className="studio-empty">当前还没有主体设定结果</div>
      )}
      {roleReferences?.length ? (
        <section className="studio-gallery">
          {roleReferences.map((item) => (
            <article key={item.name} className="studio-gallery__item">
              <img src={item.url} alt={item.name} />
              <strong>{item.name}</strong>
              <span>{item.role}</span>
            </article>
          ))}
        </section>
      ) : null}
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
    <div className="studio-empty">当前还没有分镜结果</div>
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
    <div className="studio-empty">当前还没有画面结果</div>
  );
}

function OutputPanel({ project }) {
  const staticUrl = project.artifacts?.outputVideoUrl;
  const videoUrl = project.artifacts?.videoOutputUrl;
  return (
    <div className="studio-output-grid">
      <section className="studio-panel">
        <div className="studio-panel__header">
          <h2>静态合成</h2>
          <span className="studio-panel__meta">{stageStatusText(project.stageState?.output?.status)}</span>
        </div>
        {staticUrl ? <video controls src={staticUrl} /> : <div className="studio-empty">暂无静态合成结果</div>}
      </section>
      <section className="studio-panel">
        <div className="studio-panel__header">
          <h2>视频模型结果</h2>
          <span className="studio-panel__meta">{stageStatusText(project.stageState?.video?.status)}</span>
        </div>
        {videoUrl ? <video controls src={videoUrl} /> : <div className="studio-empty">暂无视频模型结果</div>}
      </section>
    </div>
  );
}

function JsonEditor({ value, onChange, onSave, isPending }) {
  return (
    <div className="studio-subpanel">
      <div className="studio-panel__header">
        <h3>结构编辑</h3>
        <button className="studio-ghost" type="button" onClick={onSave} disabled={isPending}>
          保存
        </button>
      </div>
      <textarea
        className="studio-json"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
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
  const [editorTab, setEditorTab] = useState(null);
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
        setMessage("结构已保存");
        setEditorTab(null);
      } catch (error) {
        setMessage(error.message || "保存失败");
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
              <textarea
                className="studio-editor"
                value={storyText}
                onChange={(event) => setStoryText(event.target.value)}
                placeholder=""
              />
              <SceneCards adaptation={project.artifacts?.adaptation} />
              {editorTab === "script" ? (
                <JsonEditor
                  value={adaptationText}
                  onChange={setAdaptationText}
                  onSave={() => saveArtifact("adaptation", adaptationText)}
                  isPending={isPending}
                />
              ) : null}
            </section>
          ) : null}

          {tab === "characters" ? (
            <section className="studio-panel studio-main-panel">
              <div className="studio-panel__header">
                <h2>主体设定</h2>
              </div>
              <CharacterCards
                characters={project.artifacts?.characters}
                roleReferences={project.artifacts?.roleReferences}
              />
              {editorTab === "characters" ? (
                <JsonEditor
                  value={charactersText}
                  onChange={setCharactersText}
                  onSave={() => saveArtifact("characters", charactersText)}
                  isPending={isPending}
                />
              ) : null}
            </section>
          ) : null}

          {tab === "storyboard" ? (
            <section className="studio-panel studio-main-panel">
              <div className="studio-panel__header">
                <h2>分镜结构</h2>
              </div>
              <ShotCards storyboard={project.artifacts?.storyboard} />
              {editorTab === "storyboard" ? (
                <JsonEditor
                  value={storyboardText}
                  onChange={setStoryboardText}
                  onSave={() => saveArtifact("storyboard", storyboardText)}
                  isPending={isPending}
                />
              ) : null}
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
              <h2>阶段设置</h2>
              <span className="studio-panel__meta">{stageStatusText(currentStageStatus)}</span>
            </div>

            {tab === "script" ? (
              <>
                <label className="studio-field">
                  <span>剧本模型</span>
                  <select
                    value={models.adaptation || ""}
                    onChange={(event) => setModels((current) => ({ ...current, adaptation: event.target.value }))}
                  >
                    {modelOptions.adaptation.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <div className="studio-action-stack">
                  <button
                    className="studio-primary"
                    type="button"
                    onClick={() => runStage("adaptation")}
                    disabled={isPending || jobRunning || !canRunStage(project, "adaptation", storyText)}
                  >
                    生成剧本
                  </button>
                  <button className="studio-secondary" type="button" onClick={() => persistBase("已保存")} disabled={isPending || jobRunning}>
                    保存
                  </button>
                  <button className="studio-secondary" type="button" onClick={() => setEditorTab(editorTab === "script" ? null : "script")}>
                    {editorTab === "script" ? "收起结构编辑" : "编辑结构"}
                  </button>
                </div>
              </>
            ) : null}

            {tab === "characters" ? (
              <>
                <label className="studio-field">
                  <span>角色模型</span>
                  <select
                    value={models.characters || ""}
                    onChange={(event) => setModels((current) => ({ ...current, characters: event.target.value }))}
                  >
                    {modelOptions.characters.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <label className="studio-field">
                  <span>主体图模型</span>
                  <select
                    value={models.roleImage || ""}
                    onChange={(event) => setModels((current) => ({ ...current, roleImage: event.target.value }))}
                  >
                    {modelOptions.roleImage.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <div className="studio-action-stack">
                  <button
                    className="studio-primary"
                    type="button"
                    onClick={() => runStage("characters")}
                    disabled={isPending || jobRunning || !canRunStage(project, "characters", storyText)}
                  >
                    生成主体
                  </button>
                  <button className="studio-secondary" type="button" onClick={() => setEditorTab(editorTab === "characters" ? null : "characters")}>
                    {editorTab === "characters" ? "收起结构编辑" : "编辑结构"}
                  </button>
                </div>
              </>
            ) : null}

            {tab === "storyboard" ? (
              <>
                <label className="studio-field">
                  <span>分镜模型</span>
                  <select
                    value={models.storyboard || ""}
                    onChange={(event) => setModels((current) => ({ ...current, storyboard: event.target.value }))}
                  >
                    {modelOptions.storyboard.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <div className="studio-action-stack">
                  <button
                    className="studio-primary"
                    type="button"
                    onClick={() => runStage("storyboard")}
                    disabled={isPending || jobRunning || !canRunStage(project, "storyboard", storyText)}
                  >
                    生成分镜
                  </button>
                  <button className="studio-secondary" type="button" onClick={() => setEditorTab(editorTab === "storyboard" ? null : "storyboard")}>
                    {editorTab === "storyboard" ? "收起结构编辑" : "编辑结构"}
                  </button>
                </div>
              </>
            ) : null}

            {tab === "media" ? (
              <>
                <label className="studio-field">
                  <span>画面模型</span>
                  <select
                    value={models.shotImage || ""}
                    onChange={(event) => setModels((current) => ({ ...current, shotImage: event.target.value }))}
                  >
                    {modelOptions.shotImage.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <button
                  className="studio-primary"
                  type="button"
                  onClick={() => runStage("media")}
                  disabled={isPending || jobRunning || !canRunStage(project, "media", storyText)}
                >
                  生成画面
                </button>
              </>
            ) : null}

            {tab === "output" ? (
              <>
                <label className="studio-field">
                  <span>视频模型</span>
                  <select
                    value={models.shotVideo || ""}
                    onChange={(event) => setModels((current) => ({ ...current, shotVideo: event.target.value }))}
                  >
                    {modelOptions.shotVideo.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <div className="studio-action-stack">
                  <button
                    className="studio-secondary"
                    type="button"
                    onClick={() => runStage("output")}
                    disabled={isPending || jobRunning || !canRunStage(project, "output", storyText)}
                  >
                    静态合成
                  </button>
                  <button
                    className="studio-primary"
                    type="button"
                    onClick={() => runStage("video")}
                    disabled={isPending || jobRunning || !canRunStage(project, "video", storyText)}
                  >
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
    </section>
  );
}
