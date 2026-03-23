import { ProjectWorkbench } from "../../../src/ui/ProjectWorkbench.js";

export default async function ProjectPage({ params }) {
  const { projectId } = await params;
  return <ProjectWorkbench projectId={projectId} />;
}
