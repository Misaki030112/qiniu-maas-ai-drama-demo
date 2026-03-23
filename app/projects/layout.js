import { AppRail } from "../../src/ui/AppRail.js";

export default function ProjectsLayout({ children }) {
  return (
    <div className="app-shell">
      <AppRail />
      <main className="app-main">{children}</main>
    </div>
  );
}
