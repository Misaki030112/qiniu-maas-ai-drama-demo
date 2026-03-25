import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

const schema = `ai_drama_demo_test_${crypto.randomBytes(6).toString("hex")}`;
process.env.DB_SCHEMA = schema;

const [{ ensureSchema, getPool }, { createProject, readProjectDetail, saveProjectArtifact, updateProject }, { createPipelineLogger }] = await Promise.all([
  import("../src/db.js"),
  import("../src/project-store.js"),
  import("../src/pipeline-logger.js"),
]);

async function dropSchema() {
  const pool = await getPool();
  await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await pool.end();
}

await ensureSchema();

test("projects stay isolated and persistent project data comes from database", async (t) => {
  await t.test("new project data does not affect another project", async () => {
    const projectA = await createProject("隔离项目 A");
    const projectB = await createProject("隔离项目 B");

    await updateProject(projectA.id, {
      storyText: "项目 A 的故事文本",
      models: {
        adaptation: "openai/gpt-5.4",
        characters: "openai/gpt-5.4",
        storyboard: "openai/gpt-5.4",
      },
    });
    await saveProjectArtifact(projectA.id, "adaptation", {
      title: "项目 A",
      script_text: "只属于 A 的改编稿",
      subject_hints: {
        scenes: [],
        props: [],
      },
    });

    const logger = await createPipelineLogger({
      projectId: projectA.id,
      stage: "adaptation",
    });
    await logger.log({
      event: "stage",
      step: "adaptation",
      status: "done",
      message: "写入数据库日志",
    });

    const detailA = await readProjectDetail(projectA.id);
    const detailB = await readProjectDetail(projectB.id);

    assert.equal(detailA.artifacts.storyText.trim(), "项目 A 的故事文本");
    assert.equal(detailB.artifacts.storyText, "");
    assert.equal(detailA.artifacts.adaptation?.script_text, "只属于 A 的改编稿");
    assert.equal(detailB.artifacts.adaptation, null);
    assert.equal(detailA.logs.length, 1);
    assert.equal(detailB.logs.length, 0);
  });
});

test.after(async () => {
  await dropSchema();
});
