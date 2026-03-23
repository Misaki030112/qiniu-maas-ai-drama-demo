"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const railItems = [
  { href: "/projects", label: "首页", short: "首" },
  { href: "/projects", label: "项目", short: "项" },
];

export function AppRail() {
  const pathname = usePathname();

  return (
    <aside className="app-rail">
      <div className="app-rail__brand">点</div>
      <nav className="app-rail__nav">
        {railItems.map((item, index) => {
          const active = index === 0
            ? pathname === "/projects"
            : pathname.startsWith("/projects/");
          return (
            <Link
              key={`${item.href}-${item.short}`}
              href={item.href}
              className={active ? "app-rail__link active" : "app-rail__link"}
              aria-label={item.label}
              title={item.label}
            >
              {item.short}
            </Link>
          );
        })}
      </nav>
      <div className="app-rail__footer">剧</div>
    </aside>
  );
}
