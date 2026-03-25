"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function RailIcon({ type }) {
  if (type === "home") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 10.5 12 3l9 7.5" />
        <path d="M5.5 9.5V20h13V9.5" />
        <path d="M9.5 20v-5.5h5V20" />
      </svg>
    );
  }
  if (type === "folder") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3.5 7.5h5l2 2h10v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
        <path d="M3.5 7.5v-.5a2 2 0 0 1 2-2h4l2 2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 6.5h16" />
      <path d="M6.5 4h11v4h-11z" />
      <path d="M5.5 10.5h13l-1 8h-11z" />
      <path d="M9 14h6" />
    </svg>
  );
}

const railItems = [
  { href: "/projects", label: "首页", icon: "home" },
  { href: "/projects", label: "项目", icon: "folder" },
];

export function AppRail() {
  const pathname = usePathname();

  return (
    <aside className="app-rail">
      <Link href="/projects" className="app-rail__brand" aria-label="AI 漫剧工作站" title="AI 漫剧工作站">
        <RailIcon type="brand" />
      </Link>
      <nav className="app-rail__nav">
        {railItems.map((item, index) => {
          const active = index === 0
            ? pathname === "/projects"
            : pathname.startsWith("/projects/");
          return (
            <Link
              key={`${item.href}-${item.label}`}
              href={item.href}
              className={active ? "app-rail__link active" : "app-rail__link"}
              aria-label={item.label}
              title={item.label}
            >
              <RailIcon type={item.icon} />
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
