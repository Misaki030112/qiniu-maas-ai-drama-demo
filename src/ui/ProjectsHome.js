"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";

function ProjectCardPreview({ project, index }) {
  const assets = (project.previewAssets || []).slice(0, 3);
  if (!assets.length) {
    return (
      <div className="project-card__stack project-card__stack--empty">
        <div className="project-card__paper project-card__paper--back" />
        <div className="project-card__paper project-card__paper--mid" />
        <div className="project-card__paper project-card__paper--front">
          <div className="project-card__paper-placeholder">{project.name.slice(0, 2) || "项目"}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="project-card__stack">
      {[0, 1, 2].map((slot) => {
        const asset = assets[slot] || null;
        const layerClass = slot === 0 ? "project-card__paper--front" : slot === 1 ? "project-card__paper--mid" : "project-card__paper--back";
        return (
          <div key={asset?.path || `${project.id}-${slot}`} className={`project-card__paper ${layerClass}`}>
            {asset ? <img src={asset.url} alt={`${project.name} 预览 ${slot + 1}`} /> : <div className="project-card__paper-placeholder">素材 {slot + 1}</div>}
          </div>
        );
      })}
      <div className="project-card__folder-tab">项目 {index + 1}</div>
    </div>
  );
}

export function ProjectsHome() {
  const [projects, setProjects] = useState([]);
  const [name, setName] = useState("AI 漫剧项目");
  const [activeTab] = useState("mine");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  async function loadProjects() {
    const res = await fetch("/api/projects", { cache: "no-store" });
    const data = await res.json();
    setProjects(data);
  }

  useEffect(() => {
    loadProjects();
  }, []);

  function handleCreateProject() {
    startTransition(async () => {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.message || "创建失败");
        return;
      }
      setProjects((current) => [data, ...current]);
      setMessage("项目已创建");
      window.location.href = `/projects/${data.id}`;
    });
  }

  return (
    <section className="projects-home">
      <header className="projects-home__header">
        <div className="projects-home__tabs">
          <button type="button" className={activeTab === "mine" ? "projects-home__tab active" : "projects-home__tab"}>
            我的项目 ({projects.length})
          </button>
          <button type="button" className="projects-home__tab muted">
            我参与的项目 (0)
          </button>
        </div>
        <div className="projects-home__create">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="项目名称"
          />
          <button type="button" className="projects-home__button" onClick={handleCreateProject} disabled={isPending}>
            {isPending ? "创建中" : "+ 创建项目"}
          </button>
        </div>
      </header>

      {message ? <div className="projects-home__message">{message}</div> : null}

      <div className="projects-home__grid">
        {projects.map((project, index) => (
          <Link key={project.id} href={`/projects/${project.id}`} className="project-card">
            <div className="project-card__cover">
              <div className="project-card__cover-glow" />
              <ProjectCardPreview project={project} index={index} />
            </div>
            <div className="project-card__body">
              <strong>{project.name}</strong>
              <span>{project.updatedAt ? new Date(project.updatedAt).toLocaleString("zh-CN") : "未更新"}</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
