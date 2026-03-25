import { runProjectStage } from "./project-pipeline.js";
import { assertExecutable } from "./stages/stage-requirements.js";
import {
  createJob,
  markJobDone,
  markJobError,
  markJobProgress,
  markJobRunning,
  readCurrentJob,
  readJob,
  readProject,
  readProjectDetail,
  writeProject,
} from "./project-store.js";

const activeProjects = new Set();

async function clearProjectCurrentJob(projectId, jobId) {
  const project = await readProject(projectId);
  if (project.currentJobId !== jobId) {
    return;
  }
  project.currentJobId = null;
  await writeProject(project);
}

async function runQueuedJob(jobId) {
  const job = await readJob(jobId);
  if (!job) {
    return;
  }

  if (activeProjects.has(job.projectId)) {
    return;
  }

  activeProjects.add(job.projectId);
  try {
    await markJobRunning(jobId, "开始执行");
    await runProjectStage(job.projectId, job.stage, {
      onProgress: async ({ progressText, payload }) => {
        await markJobProgress(jobId, progressText, payload);
      },
    });
    await markJobDone(jobId);
  } catch (error) {
    await markJobError(jobId, error.message);
  } finally {
    await clearProjectCurrentJob(job.projectId, jobId);
    activeProjects.delete(job.projectId);
  }
}

export async function enqueueProjectStageExecution(projectId, stage) {
  const project = await readProject(projectId);
  const currentJob = await readCurrentJob(projectId);
  if (currentJob && ["queued", "running"].includes(currentJob.status)) {
    throw new Error("当前项目已有任务在执行中。");
  }

  await assertExecutable(project, stage);

  const job = await createJob(projectId, stage, {
    requestedStage: stage,
  });

  project.currentJobId = job.id;
  project.stageState[stage] = {
    status: "queued",
    updatedAt: new Date().toISOString(),
    error: null,
  };
  await writeProject(project);

  setTimeout(() => {
    runQueuedJob(job.id).catch((error) => {
      console.error(`[job-runner] ${job.id} failed`, error);
    });
  }, 0);

  return readProjectDetail(projectId);
}
