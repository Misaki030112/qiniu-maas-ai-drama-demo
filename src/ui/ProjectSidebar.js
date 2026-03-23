"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

export function ProjectSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [projects, setProjects] = useState([]);
  const [name, setName] = useState("点众 AI 真人剧 Demo");
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

  function handleCreateProject(event) {
    event.preventDefault();
    startTransition(async () => {
      setMessage("正在创建项目…");
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.message || "创建失败。");
        return;
      }
      setMessage("项目已创建。");
      setProjects((current) => [data, ...current]);
      router.push(`/projects/${data.id}`);
      router.refresh();
    });
  }

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <div className="sidebar__eyebrow">项目制工作台</div>
        <h1>点众 AI 真人剧</h1>
        <p>左侧只做一件事：管理项目。进入项目后再做分阶段执行。</p>
      </div>

      <nav className="sidebar__nav">
        <Link href="/projects" className={pathname === "/projects" ? "sidebar__home active" : "sidebar__home"}>
          项目首页
        </Link>
        <div className="sidebar__section-title">项目列表</div>
        <div className="sidebar__projects">
          {projects.map((project) => {
            const active = pathname === `/projects/${project.id}`;
            return (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className={active ? "project-link active" : "project-link"}
              >
                <strong>{project.name}</strong>
                <span>{project.updatedAt ? new Date(project.updatedAt).toLocaleString("zh-CN") : "未更新"}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      <form className="sidebar__create" onSubmit={handleCreateProject}>
        <label htmlFor="projectName">新项目</label>
        <input
          id="projectName"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="输入项目名称"
        />
        <button type="submit" disabled={isPending}>
          {isPending ? "创建中…" : "创建项目"}
        </button>
        <div className="sidebar__message">{message}</div>
      </form>
    </aside>
  );
}
