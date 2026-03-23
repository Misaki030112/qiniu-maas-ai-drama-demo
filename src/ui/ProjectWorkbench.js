"use client";

import { useEffect, useState, useTransition } from "react";

const stageMeta = [
  {
    id: "adaptation",
    label: "1. 剧本改编",
    hint: "把故事改成结构化剧情骨架。",
    modelFields: ["adaptation"],
  },
  {
    id: "characters",
    label: "2. 角色设定",
    hint: "输出角色 JSON，并生成角色参考图。",
    modelFields: ["characters", "roleImage"],
  },
  {
    id: "storyboard",
    label: "3. 分镜",
    hint: "生成连续镜头和 shot list。",
    modelFields: ["storyboard"],
  },
  {
    id: "media",
    label: "4. 画面与配音",
    hint: "生成镜头图、音频、字幕和镜头片段。",
    modelFields: ["shotImage"],
  },
  {
    id: "output",
    label: "5. 输出合成",
    hint: "把镜头片段合成为当前可播放输出。",
    modelFields: [],
  },
  {
    id: "video",
    label: "6. 视频生成",
    hint: "保留在流程里，但当前还没有接通。",
    modelFields: ["shotVideo"],
  },
];

const modelOptions = {
  adaptation: ["openai/gpt-5.4-mini", "openai/gpt-5.4", "deepseek-v3-0324", "gemini-2.5-pro", "minimax/minimax-m2.5"],
  characters: ["openai/gpt-5.4-mini", "openai/gpt-5.4", "deepseek-v3-0324", "gemini-2.5-pro", "minimax/minimax-m2.5"],
  storyboard: ["openai/gpt-5.4-mini", "openai/gpt-5.4", "deepseek-v3-0324", "gemini-2.5-pro", "minimax/minimax-m2.5"],
  roleImage: ["gemini-2.5-flash-image", "gpt-image-1", "imagen-4", "minimax-image-01"],
  shotImage: ["gemini-2.5-flash-image", "gpt-image-1", "imagen-4", "minimax-image-01"],
  shotVideo: ["veo-3", "sora-2", "runway-gen-4", "hailuo-2.3"],
};

const dependencyMap = {
  adaptation: [],
  characters: ["adaptation"],
  storyboard: ["characters"],
  media: ["storyboard"],
  output: ["media"],
  video: ["output"],
};

function prettyJson(value) {
  return value ? JSON.stringify(value, null, 2) : "";
}

function pickDefaultStage(project) {
  for (const stage of stageMeta) {
    const status = project?.stageState?.[stage.id]?.status;
    if (status !== "done" && status !== "blocked") {
      return stage.id;
    }
  }
  return "output";
}

function statusText(status) {
  const map = {
    idle: "未开始",
    ready: "可执行",
    running: "执行中",
    done: "已完成",
    error: "失败",
    stale: "待重跑",
    blocked: "待接入",
  };
  return map[status] || "未开始";
}

function stageCanExecute(project, stageId, storyText) {
  if (stageId === "video") {
    return false;
  }
  if (stageId === "adaptation") {
    return Boolean(storyText.trim());
  }
  return dependencyMap[stageId].every((dependency) => project?.stageState?.[dependency]?.status === "done");
}

export function ProjectWorkbench({ projectId }) {
  const [project, setProject] = useState(null);
  const [selectedStage, setSelectedStage] = useState("adaptation");
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
    setSelectedStage((current) => current || pickDefaultStage(data));
  }

  useEffect(() => {
    loadProject();
  }, [projectId]);

  useEffect(() => {
    if (project) {
      setSelectedStage(pickDefaultStage(project));
    }
  }, [project?.id]);

  function persistProjectBase(nextMessage = "已保存项目输入。") {
    return fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storyText,
        models,
      }),
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "保存失败。");
      }
      setProject(data);
      setMessage(nextMessage);
      return data;
    });
  }

  function handleSaveBase() {
    startTransition(async () => {
      try {
        await persistProjectBase();
      } catch (error) {
        setMessage(error.message);
      }
    });
  }

  function handleExecuteStage(stageId) {
    startTransition(async () => {
      try {
        setMessage(`正在准备 ${stageMeta.find((item) => item.id === stageId)?.label} …`);
        await persistProjectBase("项目输入已保存。");
        const res = await fetch(`/api/projects/${projectId}/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage: stageId }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.message || "执行失败。");
        }
        setProject(data);
        setAdaptationText(prettyJson(data.artifacts?.adaptation));
        setCharactersText(prettyJson(data.artifacts?.characters));
        setStoryboardText(prettyJson(data.artifacts?.storyboard));
        setMessage(`${stageMeta.find((item) => item.id === stageId)?.label} 已完成。`);
        if (stageId !== "video") {
          const nextIndex = stageMeta.findIndex((item) => item.id === stageId) + 1;
          if (stageMeta[nextIndex]) {
            setSelectedStage(stageMeta[nextIndex].id);
          }
        }
      } catch (error) {
        setMessage(error.message);
      }
    });
  }

  function handleSaveArtifact(stageId, rawText) {
    startTransition(async () => {
      try {
        const value = JSON.parse(rawText);
        const res = await fetch(`/api/projects/${projectId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            artifactStage: stageId,
            artifactValue: value,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.message || "保存失败。");
        }
        setProject(data);
        setMessage(`${stageMeta.find((item) => item.id === stageId)?.label} 已保存，下游阶段已失效。`);
      } catch (error) {
        setMessage(error.message || "保存失败。");
      }
    });
  }

  if (!project) {
    return <div className="project-loading">正在加载项目…</div>;
  }

  const activeMeta = stageMeta.find((item) => item.id === selectedStage) || stageMeta[0];

  return (
    <section className="workspace">
      <header className="workspace__header">
        <div>
          <div className="workspace__eyebrow">项目工作台</div>
          <h1>{project.name}</h1>
          <p>先在中间写故事，再按阶段往下执行。每一步都能看结果、改结果，然后继续推进。</p>
        </div>
        <div className="workspace__status">{message || "当前是真实阶段流，不再是一把执行。"}</div>
      </header>

      <section className="story-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-heading__eyebrow">故事输入</span>
            <h2>先把故事写在这里</h2>
          </div>
          <button className="primary-button" onClick={handleSaveBase} disabled={isPending}>
            {isPending ? "处理中…" : "保存故事与模型配置"}
          </button>
        </div>
        <textarea
          className="story-panel__textarea"
          value={storyText}
          onChange={(event) => setStoryText(event.target.value)}
          placeholder="在这里输入剧情梗概或原始小说片段。"
        />
      </section>

      <section className="stage-strip">
        {stageMeta.map((stage) => {
          const state = project.stageState?.[stage.id] || { status: "idle" };
          const active = selectedStage === stage.id;
          return (
            <button
              key={stage.id}
              type="button"
              className={active ? "stage-chip active" : "stage-chip"}
              onClick={() => setSelectedStage(stage.id)}
            >
              <strong>{stage.label}</strong>
              <span>{statusText(state.status)}</span>
            </button>
          );
        })}
      </section>

      <section className="stage-view">
        <div className="stage-view__main">
          <div className="stage-card">
            <div className="panel-heading">
              <div>
                <span className="panel-heading__eyebrow">{activeMeta.label}</span>
                <h2>{activeMeta.hint}</h2>
              </div>
              <button
                className="primary-button"
                disabled={isPending || !stageCanExecute(project, activeMeta.id, storyText)}
                onClick={() => handleExecuteStage(activeMeta.id)}
              >
                {activeMeta.id === "video" ? "待接入" : "执行本阶段"}
              </button>
            </div>

            {activeMeta.id === "adaptation" ? (
              <textarea
                className="json-editor"
                value={adaptationText}
                onChange={(event) => setAdaptationText(event.target.value)}
                placeholder="这里会出现剧本改编后的 JSON。"
              />
            ) : null}

            {activeMeta.id === "characters" ? (
              <>
                <textarea
                  className="json-editor"
                  value={charactersText}
                  onChange={(event) => setCharactersText(event.target.value)}
                  placeholder="这里会出现角色设定 JSON。"
                />
                <div className="media-grid">
                  {(project.artifacts?.roleReferences || []).map((item) => (
                    <article key={item.name} className="media-card">
                      <img src={item.url} alt={item.name} />
                      <strong>{item.name}</strong>
                      <span>{item.role}</span>
                    </article>
                  ))}
                </div>
              </>
            ) : null}

            {activeMeta.id === "storyboard" ? (
              <textarea
                className="json-editor"
                value={storyboardText}
                onChange={(event) => setStoryboardText(event.target.value)}
                placeholder="这里会出现分镜 JSON。"
              />
            ) : null}

            {activeMeta.id === "media" ? (
              <div className="media-stage">
                <div className="shot-grid">
                  {(project.artifacts?.shots || []).map((shot) => (
                    <article key={shot.shotId} className="shot-card">
                      {shot.imageUrl ? <img src={shot.imageUrl} alt={shot.shotId} /> : null}
                      <strong>{shot.shotId}</strong>
                      <span>{shot.speaker}</span>
                      <p>{shot.subtitle}</p>
                      {shot.audioUrl ? <audio controls src={shot.audioUrl} /> : null}
                    </article>
                  ))}
                </div>
                <textarea
                  className="json-editor"
                  value={project.artifacts?.subtitles || ""}
                  readOnly
                />
              </div>
            ) : null}

            {activeMeta.id === "output" ? (
              <div className="output-stage">
                {project.artifacts?.outputVideoUrl ? (
                  <video controls src={project.artifacts.outputVideoUrl} />
                ) : (
                  <div className="empty-state">当前还没有输出视频。请先完成画面与配音，再执行输出合成。</div>
                )}
              </div>
            ) : null}

            {activeMeta.id === "video" ? (
              <div className="empty-state">
                视频模型阶段已经保留在流程中，但目前后端还没有接通，所以这里不会出现假按钮。
              </div>
            ) : null}

            {["adaptation", "characters", "storyboard"].includes(activeMeta.id) ? (
              <div className="stage-actions">
                <button
                  className="secondary-button"
                  onClick={() =>
                    handleSaveArtifact(
                      activeMeta.id,
                      activeMeta.id === "adaptation"
                        ? adaptationText
                        : activeMeta.id === "characters"
                          ? charactersText
                          : storyboardText,
                    )
                  }
                  disabled={isPending}
                >
                  保存当前阶段结果
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <aside className="stage-view__side">
          <div className="stage-card">
            <div className="panel-heading">
              <div>
                <span className="panel-heading__eyebrow">阶段配置</span>
                <h2>只展示本阶段相关模型</h2>
              </div>
            </div>
            <div className="config-stack">
              {activeMeta.modelFields.map((field) => (
                <label key={field} className="config-field">
                  <span>{field}</span>
                  <select
                    value={models[field] || ""}
                    onChange={(event) => setModels((current) => ({ ...current, [field]: event.target.value }))}
                  >
                    {(modelOptions[field] || []).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <div className="stage-note">
                {activeMeta.id === "video"
                  ? "这个阶段保留给真实视频模型。等后端接通后，再开放执行。"
                  : "模型配置变更会让当前阶段及下游阶段失效，所以要先保存，再执行。"}
              </div>
            </div>
          </div>

          <div className="stage-card">
            <div className="panel-heading">
              <div>
                <span className="panel-heading__eyebrow">阶段状态</span>
                <h2>当前项目进度</h2>
              </div>
            </div>
            <div className="status-list">
              {stageMeta.map((stage) => (
                <div key={stage.id} className="status-row">
                  <strong>{stage.label}</strong>
                  <span>{statusText(project.stageState?.[stage.id]?.status)}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </section>
    </section>
  );
}
