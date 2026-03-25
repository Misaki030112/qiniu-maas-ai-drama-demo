import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { config } from "../src/config.js";
import { persistProjectArtifact } from "../src/object-storage.js";

const LIVE_TEST_PROJECT_ID = "live-tests";

const assets = [
  {
    sourceUrl: "https://picsum.photos/id/1025/1024/1024",
    relativePath: "fixtures/subject-reference.jpg",
    contentType: "image/jpeg",
  },
  {
    sourceUrl: "https://picsum.photos/id/1062/1280/720",
    relativePath: "fixtures/video-first-frame.jpg",
    contentType: "image/jpeg",
  },
];

async function main() {
  if (!config.objectStorage.enabled) {
    throw new Error("对象存储未启用，无法同步真实测试图片。");
  }

  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "ai-drama-live-assets-"));
  const uploaded = [];

  try {
    for (const asset of assets) {
      const response = await fetch(asset.sourceUrl);
      if (!response.ok) {
        throw new Error(`下载测试图片失败: ${response.status} ${asset.sourceUrl}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const absolutePath = path.join(workspace, path.basename(asset.relativePath));
      const result = await persistProjectArtifact({
        projectId: LIVE_TEST_PROJECT_ID,
        absolutePath,
        relativePath: asset.relativePath,
        buffer,
        contentType: asset.contentType,
      });
      uploaded.push({
        relativePath: asset.relativePath,
        publicUrl: result.publicUrl,
      });
    }

    console.log(JSON.stringify({ uploaded }, null, 2));
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
