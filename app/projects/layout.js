import { ProjectSidebar } from "../../src/ui/ProjectSidebar.js";

export default function ProjectsLayout({ children }) {
  return (
    <div className="app-shell">
      <ProjectSidebar />
      <main className="app-main">{children}</main>
    </div>
  );
}
