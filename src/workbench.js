import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import http from "node:http";
import path from "node:path";
import { URL } from "node:url";
import { config } from "./config.js";
import { readJson } from "./utils.js";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".srt": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".ppm": "image/x-portable-pixmap",
};

function htmlPage() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AI 真人剧工作台</title>
  <style>
    :root {
      --bg: #f4efe7;
      --card: rgba(255,255,255,0.82);
      --ink: #1e1d1b;
      --muted: #625b52;
      --line: rgba(30,29,27,0.08);
      --accent: #b24c2f;
      --accent-2: #1e6f66;
      --shadow: 0 18px 50px rgba(25,20,15,0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "SF Pro Display","PingFang SC","Helvetica Neue",sans-serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(178,76,47,0.18), transparent 34%),
        radial-gradient(circle at top right, rgba(30,111,102,0.14), transparent 30%),
        linear-gradient(180deg, #f9f4eb 0%, var(--bg) 100%);
      min-height: 100vh;
    }
    .shell {
      display: grid;
      grid-template-columns: 320px 1fr;
      min-height: 100vh;
    }
    .sidebar {
      border-right: 1px solid var(--line);
      padding: 28px 20px;
      backdrop-filter: blur(12px);
      background: rgba(255,255,255,0.45);
    }
    .brand {
      margin-bottom: 18px;
    }
    .brand h1 {
      margin: 0;
      font-size: 28px;
      line-height: 1;
      letter-spacing: -0.03em;
    }
    .brand p {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.5;
    }
    .run-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .run-item {
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.72);
      border-radius: 18px;
      padding: 14px;
      cursor: pointer;
      transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease;
    }
    .run-item:hover, .run-item.active {
      transform: translateY(-1px);
      box-shadow: var(--shadow);
      border-color: rgba(178,76,47,0.28);
    }
    .run-item strong {
      display: block;
      font-size: 14px;
      margin-bottom: 6px;
    }
    .run-item span {
      display: block;
      color: var(--muted);
      font-size: 12px;
    }
    .content {
      padding: 28px;
      display: grid;
      gap: 18px;
    }
    .hero, .panel {
      background: var(--card);
      border: 1px solid rgba(255,255,255,0.7);
      border-radius: 24px;
      box-shadow: var(--shadow);
      padding: 20px;
      backdrop-filter: blur(14px);
    }
    .hero-grid {
      display: grid;
      grid-template-columns: 1.2fr 0.8fr;
      gap: 18px;
      align-items: start;
    }
    .panel h2, .hero h2 {
      margin: 0 0 12px;
      font-size: 20px;
      letter-spacing: -0.02em;
    }
    .meta, .badges {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border-radius: 999px;
      background: rgba(30,29,27,0.06);
      padding: 8px 12px;
      font-size: 12px;
      color: var(--ink);
    }
    .badge.accent { background: rgba(178,76,47,0.12); color: #8e3118; }
    .badge.alt { background: rgba(30,111,102,0.12); color: #165750; }
    video {
      width: 100%;
      border-radius: 18px;
      background: #111;
      aspect-ratio: 16 / 9;
    }
    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px;
    }
    .grid-3 {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 14px;
    }
    .card {
      border: 1px solid var(--line);
      border-radius: 18px;
      background: rgba(255,255,255,0.7);
      padding: 14px;
    }
    .card h3 {
      margin: 0 0 8px;
      font-size: 16px;
    }
    .card p, .card li, .empty, .mono {
      color: var(--muted);
      line-height: 1.55;
      font-size: 13px;
    }
    .mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      word-break: break-all;
    }
    .shot-card img, .role-card img {
      width: 100%;
      aspect-ratio: 16 / 9;
      object-fit: cover;
      border-radius: 14px;
      display: block;
      background: #ddd;
    }
    .shot-card audio {
      width: 100%;
      margin-top: 8px;
    }
    .table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .table th, .table td {
      text-align: left;
      vertical-align: top;
      padding: 10px 8px;
      border-bottom: 1px solid var(--line);
    }
    .table th {
      color: var(--muted);
      font-weight: 600;
    }
    a { color: inherit; }
    .toolbar {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      margin-bottom: 12px;
    }
    .btn {
      appearance: none;
      border: none;
      border-radius: 999px;
      background: var(--ink);
      color: white;
      padding: 10px 14px;
      font-size: 13px;
      cursor: pointer;
    }
    @media (max-width: 980px) {
      .shell { grid-template-columns: 1fr; }
      .hero-grid, .grid-2, .grid-3 { grid-template-columns: 1fr; }
      .sidebar { border-right: none; border-bottom: 1px solid var(--line); }
    }
  </style>
</head>
<body>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">
        <h1>AI 真人剧工作台</h1>
        <p>回看每次运行的剧情骨架、角色、首图、镜头、音频、字幕与最终样片。</p>
      </div>
      <div class="toolbar">
        <strong>运行记录</strong>
        <button class="btn" id="refreshBtn">刷新</button>
      </div>
      <div id="runList" class="run-list"></div>
    </aside>
    <main class="content" id="app">
      <div class="hero"><div class="empty">加载中…</div></div>
    </main>
  </div>
  <script>
    const runListEl = document.getElementById("runList");
    const appEl = document.getElementById("app");
    document.getElementById("refreshBtn").addEventListener("click", loadRuns);

    function badge(text, type = "") {
      return '<span class="badge ' + type + '">' + text + '</span>';
    }

    function artifactUrl(runId, filePath) {
      return '/artifacts/' + encodeURIComponent(runId) + '/' + filePath.split('/').map(encodeURIComponent).join('/');
    }

    function renderRunList(runs, activeRunId) {
      runListEl.innerHTML = runs.map((run) => {
        const cls = run.runId === activeRunId ? 'run-item active' : 'run-item';
        return '<div class="' + cls + '" data-run-id="' + run.runId + '">' +
          '<strong>' + run.runId + '</strong>' +
          '<span>' + (run.completedAt || '运行中') + '</span>' +
          '<span>' + (run.renderNote || '') + '</span>' +
        '</div>';
      }).join('');
      [...runListEl.querySelectorAll('.run-item')].forEach((node) => {
        node.addEventListener('click', () => loadRun(node.dataset.runId));
      });
    }

    function safe(text) {
      return String(text || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    }

    function renderRun(run) {
      if (!run) {
        appEl.innerHTML = '<div class="hero"><div class="empty">没有可展示的运行记录。</div></div>';
        return;
      }
      const finalVideo = run.manifest?.outputs?.finalVideo
        ? artifactUrl(run.runId, run.manifest.outputs.finalVideo)
        : '';
      const storyFile = artifactUrl(run.runId, '01-input/story.txt');
      const roleCards = (run.manifest.roleReferences || []).map((item) => {
        const image = artifactUrl(run.runId, '04-role-reference/' + item.imagePath);
        return '<div class="card role-card">' +
          '<img src="' + image + '" alt="' + safe(item.name) + '">' +
          '<h3>' + safe(item.name) + '</h3>' +
          '<p>' + safe(item.role) + '</p>' +
          '<p class="mono">' + safe(item.model) + '</p>' +
        '</div>';
      }).join('');
      const shotCards = (run.manifest.shots || []).map((shot) => {
        const image = artifactUrl(run.runId, shot.imagePath);
        const audio = artifactUrl(run.runId, shot.audioPath);
        const segment = artifactUrl(run.runId, shot.segmentPath);
        return '<div class="card shot-card">' +
          '<img src="' + image + '" alt="' + safe(shot.shotId) + '">' +
          '<h3>' + safe(shot.shotId) + '</h3>' +
          '<p>' + safe(shot.speaker) + ' · ' + safe(shot.durationSec + 's') + '</p>' +
          '<div class="badges">' +
            badge('画面：' + shot.imageStatus, shot.imageStatus === 'ok' ? 'alt' : 'accent') +
            badge('音频：' + shot.audioStatus, shot.audioStatus === 'ok' ? 'alt' : 'accent') +
          '</div>' +
          '<audio controls src="' + audio + '"></audio>' +
          '<p><a href="' + segment + '" target="_blank">查看镜头片段</a></p>' +
        '</div>';
      }).join('');
      const stages = (run.manifest.stages || []).map((stage) =>
        '<tr><td>' + safe(stage.stage) + '</td><td class="mono">' + safe(stage.model) + '</td><td class="mono">' + safe(stage.output) + '</td></tr>'
      ).join('');
      const recs = (run.modelMatrix?.recommendations || []).map((item) =>
        '<tr><td>' + safe(item.stage) + '</td><td class="mono">' + safe(item.current) + '</td><td>' + safe((item.candidates || []).join(' / ')) + '</td><td>' + safe(item.focus) + '</td></tr>'
      ).join('');

      appEl.innerHTML =
        '<section class="hero">' +
          '<div class="hero-grid">' +
            '<div>' +
              '<h2>最终样片</h2>' +
              (finalVideo ? '<video controls src="' + finalVideo + '"></video>' : '<div class="empty">当前没有最终视频。</div>') +
            '</div>' +
            '<div>' +
              '<h2>运行概览</h2>' +
              '<div class="meta">' +
                badge(run.runId, 'accent') +
                badge(run.manifest.renderStrategy?.mode || 'unknown') +
                badge(run.modelMatrix?.provider || 'provider', 'alt') +
              '</div>' +
              '<p>' + safe(run.manifest.renderStrategy?.note || '') + '</p>' +
              '<p class="mono">视频模型位：' + safe(run.manifest.renderStrategy?.plannedVideoModel || '未配置') + '</p>' +
              '<p><a href="' + storyFile + '" target="_blank">查看输入故事</a></p>' +
              '<p><a href="/api/runs/' + encodeURIComponent(run.runId) + '" target="_blank">查看 run JSON</a></p>' +
            '</div>' +
          '</div>' +
        '</section>' +
        '<section class="grid-2">' +
          '<div class="panel">' +
            '<h2>阶段模型</h2>' +
            '<table class="table"><thead><tr><th>阶段</th><th>实际模型</th><th>产物</th></tr></thead><tbody>' + stages + '</tbody></table>' +
          '</div>' +
          '<div class="panel">' +
            '<h2>模型策略</h2>' +
            '<table class="table"><thead><tr><th>流程</th><th>当前默认</th><th>候选方向</th><th>观察重点</th></tr></thead><tbody>' + recs + '</tbody></table>' +
          '</div>' +
        '</section>' +
        '<section class="panel">' +
          '<h2>角色首图</h2>' +
          '<div class="grid-3">' + (roleCards || '<div class="empty">暂无角色首图。</div>') + '</div>' +
        '</section>' +
        '<section class="panel">' +
          '<h2>镜头工作区</h2>' +
          '<div class="grid-3">' + (shotCards || '<div class="empty">暂无镜头数据。</div>') + '</div>' +
        '</section>';
    }

    async function loadRuns() {
      const res = await fetch('/api/runs');
      const runs = await res.json();
      renderRunList(runs, runs[0]?.runId);
      if (runs[0]?.runId) {
        await loadRun(runs[0].runId);
      } else {
        renderRun(null);
      }
    }

    async function loadRun(runId) {
      const res = await fetch('/api/runs/' + encodeURIComponent(runId));
      const run = await res.json();
      const listRes = await fetch('/api/runs');
      const runs = await listRes.json();
      renderRunList(runs, runId);
      renderRun(run);
    }

    loadRuns();
  </script>
</body>
</html>`;
}

async function listRuns() {
  try {
    const entries = await fs.readdir(config.outputRoot, { withFileTypes: true });
    const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    const runs = [];
    for (const runId of dirs.sort().reverse()) {
      const manifestPath = path.join(config.outputRoot, runId, "manifest.json");
      try {
        const manifest = await readJson(manifestPath);
        runs.push({
          runId,
          completedAt: manifest.completedAt || null,
          renderNote: manifest.renderStrategy?.note || "",
          isComplete: Boolean(manifest.completedAt && manifest.outputs?.finalVideo),
        });
      } catch {
        runs.push({ runId, completedAt: null, renderNote: "", isComplete: false });
      }
    }
    return runs.sort((a, b) => {
      if (a.isComplete !== b.isComplete) {
        return a.isComplete ? -1 : 1;
      }
      return (b.runId || "").localeCompare(a.runId || "");
    });
  } catch {
    return [];
  }
}

async function loadRun(runId) {
  const runDir = path.join(config.outputRoot, runId);
  const manifest = await readJson(path.join(runDir, "manifest.json"));
  const modelMatrix = await readJson(path.join(runDir, "model-matrix.json"));
  if (!manifest.renderStrategy) {
    manifest.renderStrategy = {
      mode: "legacy",
      note: "这是旧版运行结果，尚未记录渲染策略；该样片属于静帧合成链路。",
      plannedVideoModel: modelMatrix?.primary?.shotVideo || "未配置",
    };
  }
  if (!modelMatrix.recommendations) {
    modelMatrix.recommendations = config.strategy.recommendations;
  }
  return { runId, manifest, modelMatrix };
}

function sendJson(res, payload) {
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

async function sendFile(res, filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const stat = await fs.stat(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Content-Length": stat.size,
    });
    createReadStream(filePath).pipe(res);
  } catch {
    sendText(res, 404, "文件不存在");
  }
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (requestUrl.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(htmlPage());
    return;
  }

  if (requestUrl.pathname === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (requestUrl.pathname === "/api/runs") {
    sendJson(res, await listRuns());
    return;
  }

  if (requestUrl.pathname.startsWith("/api/runs/")) {
    const runId = decodeURIComponent(requestUrl.pathname.replace("/api/runs/", ""));
    try {
      sendJson(res, await loadRun(runId));
    } catch (error) {
      sendText(res, 404, error.message);
    }
    return;
  }

  if (requestUrl.pathname.startsWith("/artifacts/")) {
    const pieces = requestUrl.pathname.split("/").slice(2).map(decodeURIComponent);
    const [runId, ...rest] = pieces;
    const filePath = path.join(config.outputRoot, runId, ...rest);
    if (!filePath.startsWith(path.join(config.outputRoot, runId))) {
      sendText(res, 403, "非法路径");
      return;
    }
    await sendFile(res, filePath);
    return;
  }

  sendText(res, 404, "未找到");
});

server.listen(config.workbenchPort, () => {
  console.log(`AI 真人剧工作台已启动: http://localhost:${config.workbenchPort}`);
});
