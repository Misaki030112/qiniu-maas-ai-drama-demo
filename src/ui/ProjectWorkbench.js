"use client";

import { useEffect, useState, useTransition } from "react";

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
    running: "执行中",
    done: "已完成",
    stale: "待重跑",
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

function SideList({ tab, project }) {
  if (tab === "script") {
    const scenes = project?.artifacts?.adaptation?.scenes || [];
    return (
      <div className="studio-side-list">
        {scenes.length
          ? scenes.map((scene) => (
              <button key={scene.scene_id} type="button" className="studio-side-item">
                <strong>{scene.title || scene.scene_id}</strong>
                <span>{scene.location || "未填"}</span>
              </button>
            ))
          : (
            <div className="studio-empty">暂无场景结构</div>
          )}
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
                <span>{item.role}</span>
              </button>
            ))
          : (
            <div className="studio-empty">暂无主体</div>
          )}
      </div>
    );
  }

  const shots = project?.artifacts?.storyboard?.shots || project?.artifacts?.shots || [];
  return (
    <div className="studio-side-list">
      {shots.length
        ? shots.map((shot) => (
            <button key={shot.shot_id || shot.shotId} type="button" className="studio-side-item">
              <strong>{shot.title || shot.shot_id || shot.shotId}</strong>
              <span>{shot.speaker || shot.visual_focus || "未填"}</span>
            </button>
          ))
        : (
          <div className="studio-empty">暂无镜头</div>
        )}
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
  const [isPending, startTransition] = useTransition();

  async function loadProject() {
    const res = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
    const data = await res.json();
    setProject(data);
    setStoryText(data.storyText || data.artifacts?.storyText || "");
    setModels(data.models || {});
    setAdaptationText(prettyJson(data.artifacts?.adaptation));
    setCharactersText(prettyJson(data.artifacts?.characters));
    setStoryboardText(prettyJson(data.artifacts?.storyboard));
    setTab(nextTabFromProject(data));
  }

  useEffect(() => {
    loadProject();
  }, [projectId]);

  function persistBase(nextMessage = "") {
    return fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storyText, models }),
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "保存失败。");
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
          throw new Error(data.message || "执行失败。");
        }
        setProject(data);
        setAdaptationText(prettyJson(data.artifacts?.adaptation));
        setCharactersText(prettyJson(data.artifacts?.characters));
        setStoryboardText(prettyJson(data.artifacts?.storyboard));
        setMessage(stage === "video" ? "视频任务已完成。" : "阶段执行完成。");
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
          throw new Error(data.message || "保存失败。");
        }
        setProject(data);
        setMessage("已保存，并已使下游阶段失效。");
      } catch (error) {
        setMessage(error.message || "保存失败。");
      }
    });
  }

  if (!project) {
    return <div className="project-loading">加载中</div>;
  }

  const currentTab = tabs.find((item) => item.id === tab) || tabs[0];
  const currentStageStatus = project.stageState?.[currentTab.stage]?.status;
  const videoStatus = project.stageState?.video?.status;

  return (
    <section className="studio">
      <header className="studio-topbar">
        <div className="studio-project">
          <h1>{project.name}</h1>
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
          {message ? <span className="studio-badge muted">{message}</span> : null}
        </div>
      </header>

      <div className="studio-body">
        <aside className="studio-side">
          <SideList tab={tab} project={project} />
        </aside>

        <main className="studio-main">
          {tab === "script" ? (
            <section className="studio-panel">
              <div className="studio-panel__header">
                <h2>故事</h2>
                <div className="studio-panel__meta">{storyText.length}/2000</div>
              </div>
              <textarea
                className="studio-editor"
                value={storyText}
                onChange={(event) => setStoryText(event.target.value)}
                placeholder="输入故事"
              />
              <div className="studio-subpanel">
                <div className="studio-panel__header">
                  <h3>剧本骨架</h3>
                  <button className="studio-ghost" onClick={() => saveArtifact("adaptation", adaptationText)} disabled={isPending}>
                    保存
                  </button>
                </div>
                <textarea
                  className="studio-json"
                  value={adaptationText}
                  onChange={(event) => setAdaptationText(event.target.value)}
                  placeholder="等待生成"
                />
              </div>
            </section>
          ) : null}

          {tab === "characters" ? (
            <section className="studio-panel">
              <div className="studio-panel__header">
                <h2>主体</h2>
                <button className="studio-ghost" onClick={() => saveArtifact("characters", charactersText)} disabled={isPending}>
                  保存
                </button>
              </div>
              <textarea
                className="studio-json"
                value={charactersText}
                onChange={(event) => setCharactersText(event.target.value)}
                placeholder="等待生成"
              />
              <div className="studio-gallery">
                {(project.artifacts?.roleReferences || []).map((item) => (
                  <article key={item.name} className="studio-gallery__item">
                    <img src={item.url} alt={item.name} />
                    <strong>{item.name}</strong>
                    <span>{item.role}</span>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {tab === "storyboard" ? (
            <section className="studio-panel">
              <div className="studio-panel__header">
                <h2>分镜</h2>
                <button className="studio-ghost" onClick={() => saveArtifact("storyboard", storyboardText)} disabled={isPending}>
                  保存
                </button>
              </div>
              <textarea
                className="studio-json"
                value={storyboardText}
                onChange={(event) => setStoryboardText(event.target.value)}
                placeholder="等待生成"
              />
            </section>
          ) : null}

          {tab === "media" ? (
            <section className="studio-panel">
              <div className="studio-panel__header">
                <h2>画面与配音</h2>
              </div>
              <div className="studio-shot-grid">
                {(project.artifacts?.shots || []).map((shot) => (
                  <article key={shot.shotId} className="studio-shot">
                    {shot.imageUrl ? <img src={shot.imageUrl} alt={shot.shotId} /> : null}
                    <strong>{shot.shotId}</strong>
                    <span>{shot.speaker}</span>
                    <p>{shot.subtitle}</p>
                    {shot.audioUrl ? <audio controls src={shot.audioUrl} /> : null}
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {tab === "output" ? (
            <section className="studio-panel">
              <div className="studio-panel__header">
                <h2>成片</h2>
              </div>
              {project.artifacts?.videoOutputUrl || project.artifacts?.outputVideoUrl ? (
                <video controls src={project.artifacts.videoOutputUrl || project.artifacts.outputVideoUrl} />
              ) : (
                <div className="studio-empty">暂无输出</div>
              )}
            </section>
          ) : null}
        </main>

        <aside className="studio-settings">
          <section className="studio-panel">
            {tab === "script" ? (
              <>
                <div className="studio-panel__header"><h2>全局设定</h2></div>
                <label className="studio-field">
                  <span>剧本模型</span>
                  <select value={models.adaptation || ""} onChange={(event) => setModels((current) => ({ ...current, adaptation: event.target.value }))}>
                    {modelOptions.adaptation.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <button className="studio-primary" onClick={() => runStage("adaptation")} disabled={isPending || !canRunStage(project, "adaptation", storyText)}>
                  生成剧本
                </button>
                <button className="studio-secondary" onClick={() => persistBase("已保存")} disabled={isPending}>
                  保存
                </button>
              </>
            ) : null}

            {tab === "characters" ? (
              <>
                <div className="studio-panel__header"><h2>全局设定</h2></div>
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
                <button className="studio-primary" onClick={() => runStage("characters")} disabled={isPending || !canRunStage(project, "characters", storyText)}>
                  生成主体
                </button>
              </>
            ) : null}

            {tab === "storyboard" ? (
              <>
                <div className="studio-panel__header"><h2>全局设定</h2></div>
                <label className="studio-field">
                  <span>分镜模型</span>
                  <select value={models.storyboard || ""} onChange={(event) => setModels((current) => ({ ...current, storyboard: event.target.value }))}>
                    {modelOptions.storyboard.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <button className="studio-primary" onClick={() => runStage("storyboard")} disabled={isPending || !canRunStage(project, "storyboard", storyText)}>
                  生成分镜
                </button>
              </>
            ) : null}

            {tab === "media" ? (
              <>
                <div className="studio-panel__header"><h2>全局设定</h2></div>
                <label className="studio-field">
                  <span>画面模型</span>
                  <select value={models.shotImage || ""} onChange={(event) => setModels((current) => ({ ...current, shotImage: event.target.value }))}>
                    {modelOptions.shotImage.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <button className="studio-primary" onClick={() => runStage("media")} disabled={isPending || !canRunStage(project, "media", storyText)}>
                  生成画面
                </button>
              </>
            ) : null}

            {tab === "output" ? (
              <>
                <div className="studio-panel__header"><h2>全局设定</h2></div>
                <label className="studio-field">
                  <span>视频模型</span>
                  <select value={models.shotVideo || ""} onChange={(event) => setModels((current) => ({ ...current, shotVideo: event.target.value }))}>
                    {modelOptions.shotVideo.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <div className="studio-action-stack">
                  <button className="studio-secondary" onClick={() => runStage("output")} disabled={isPending || !canRunStage(project, "output", storyText)}>
                    静态合成
                  </button>
                  <button className="studio-primary" onClick={() => runStage("video")} disabled={isPending || !canRunStage(project, "video", storyText)}>
                    视频生成
                  </button>
                </div>
                <div className="studio-footnote">
                  静态合成和视频生成分开执行。
                  <br />
                  当前视频状态：{stageStatusText(videoStatus)}
                </div>
              </>
            ) : null}
          </section>
        </aside>
      </div>
    </section>
  );
}
