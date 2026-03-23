import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import http from "node:http";
import path from "node:path";
import { URL } from "node:url";
import { config } from "./config.js";
import { readJson, readText } from "./utils.js";

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
  <title>点众 AI 真人剧工作台</title>
  <style>
    :root {
      --bg: #111214;
      --bg-2: #17181b;
      --panel: #1b1c20;
      --panel-2: #202126;
      --panel-3: #27282f;
      --line: rgba(255,255,255,0.08);
      --line-2: rgba(177, 255, 69, 0.18);
      --text: #f5f7fa;
      --muted: #90949f;
      --accent: #9cff38;
      --accent-2: #72d61b;
      --danger: #ef7c62;
      --shadow: 0 22px 60px rgba(0,0,0,0.38);
      --radius: 18px;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      min-height: 100%;
      background:
        radial-gradient(circle at top right, rgba(156,255,56,0.08), transparent 26%),
        radial-gradient(circle at bottom left, rgba(72,87,255,0.06), transparent 22%),
        var(--bg);
      color: var(--text);
      font-family: "SF Pro Display", "PingFang SC", "Helvetica Neue", sans-serif;
    }
    button, input, textarea, select { font: inherit; }
    .app-shell {
      display: grid;
      grid-template-columns: 74px 260px 1fr 380px;
      min-height: 100vh;
    }
    .rail {
      background: #15161a;
      border-right: 1px solid var(--line);
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 18px 0;
      gap: 18px;
    }
    .avatar, .avatar-small {
      border-radius: 50%;
      display: grid;
      place-items: center;
      background: linear-gradient(135deg, #9cff38, #2ce0c8);
      color: #10110f;
      font-weight: 700;
      box-shadow: 0 10px 30px rgba(156,255,56,0.2);
    }
    .avatar { width: 36px; height: 36px; font-size: 14px; }
    .avatar-small { width: 32px; height: 32px; font-size: 12px; }
    .rail-group {
      display: flex;
      flex-direction: column;
      gap: 14px;
      margin-top: 8px;
      width: 100%;
      align-items: center;
    }
    .rail-btn {
      width: 42px;
      height: 42px;
      border-radius: 14px;
      border: 1px solid transparent;
      background: transparent;
      color: var(--muted);
      display: grid;
      place-items: center;
      cursor: pointer;
      transition: all .18s ease;
      font-size: 18px;
    }
    .rail-btn.active,
    .rail-btn:hover {
      background: rgba(156,255,56,0.08);
      border-color: rgba(156,255,56,0.18);
      color: var(--accent);
    }
    .rail-spacer { flex: 1; }
    .project-column {
      background: #1a1b1f;
      border-right: 1px solid var(--line);
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .project-head {
      padding: 18px 18px 14px;
      border-bottom: 1px solid var(--line);
    }
    .back-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 16px;
    }
    .ghost-btn {
      border: 1px solid var(--line);
      background: transparent;
      color: var(--text);
      border-radius: 12px;
      padding: 10px 12px;
      cursor: pointer;
    }
    .project-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .project-title h1 {
      margin: 0;
      font-size: 28px;
      letter-spacing: -0.04em;
    }
    .project-title p {
      margin: 6px 0 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.5;
    }
    .run-column {
      padding: 16px 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-height: 0;
      overflow: auto;
    }
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 0 6px;
    }
    .toolbar strong {
      font-size: 13px;
      color: var(--muted);
      font-weight: 600;
      letter-spacing: 0.01em;
    }
    .green-btn {
      background: var(--accent);
      color: #11130c;
      border: none;
      border-radius: 14px;
      padding: 10px 14px;
      font-weight: 700;
      cursor: pointer;
    }
    .run-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .run-item {
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 16px;
      padding: 14px;
      cursor: pointer;
      transition: all .18s ease;
    }
    .run-item.active,
    .run-item:hover {
      background: #202126;
      border-color: var(--line-2);
      box-shadow: 0 10px 30px rgba(0,0,0,0.22);
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
      line-height: 1.5;
    }
    .run-footer {
      margin-top: auto;
      padding: 14px 12px 18px;
      border-top: 1px solid var(--line);
    }
    .studio {
      min-width: 0;
      display: flex;
      flex-direction: column;
    }
    .topbar {
      height: 78px;
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      padding: 0 22px;
      background: rgba(18,19,22,0.7);
      backdrop-filter: blur(10px);
      position: sticky;
      top: 0;
      z-index: 2;
    }
    .stage-tabs {
      display: flex;
      align-items: center;
      gap: 0;
      padding: 6px;
      background: #17181c;
      border: 1px solid var(--line);
      border-radius: 16px;
    }
    .stage-tab {
      min-width: 92px;
      padding: 10px 14px;
      border-radius: 12px;
      border: none;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
      font-weight: 600;
    }
    .stage-tab.active {
      color: var(--accent);
      background: rgba(156,255,56,0.08);
    }
    .top-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .metric-pill, .outline-pill {
      border-radius: 14px;
      padding: 12px 16px;
      border: 1px solid var(--line);
      background: var(--panel);
      color: var(--text);
      font-weight: 600;
    }
    .outline-pill { background: transparent; color: var(--muted); }
    .content {
      padding: 22px;
      display: flex;
      flex-direction: column;
      gap: 18px;
      min-height: calc(100vh - 78px);
      overflow: auto;
    }
    .studio-card {
      background: rgba(24,25,29,0.96);
      border: 1px solid var(--line);
      border-radius: 20px;
      box-shadow: var(--shadow);
    }
    .hero {
      padding: 18px;
      display: grid;
      grid-template-columns: 1.12fr 0.88fr;
      gap: 18px;
    }
    .video-stage {
      background: #0f1013;
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 14px;
    }
    .video-stage video {
      width: 100%;
      aspect-ratio: 16 / 9;
      border-radius: 14px;
      background: #090a0b;
    }
    .section-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }
    .section-title h2 {
      margin: 0;
      font-size: 20px;
      letter-spacing: -0.03em;
    }
    .section-title p {
      margin: 4px 0 0;
      color: var(--muted);
      font-size: 13px;
    }
    .badges {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 10px;
      border-radius: 999px;
      background: rgba(255,255,255,0.05);
      color: var(--text);
      font-size: 12px;
    }
    .badge.accent { background: rgba(156,255,56,0.12); color: var(--accent); }
    .badge.warn { background: rgba(239,124,98,0.14); color: #ffb39f; }
    .overview-grid,
    .panel-grid {
      display: grid;
      gap: 18px;
    }
    .overview-grid { grid-template-columns: repeat(3, 1fr); }
    .panel-grid { grid-template-columns: repeat(2, 1fr); }
    .pane {
      padding: 18px;
      min-width: 0;
    }
    .pane h3 {
      margin: 0 0 10px;
      font-size: 16px;
    }
    .mono, .muted, .body-copy, .script-block, .list-item p, .shot-meta, .small {
      color: var(--muted);
      line-height: 1.6;
      font-size: 13px;
    }
    .mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      word-break: break-all;
    }
    .stat-card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 16px;
    }
    .stat-card strong {
      font-size: 26px;
      display: block;
      margin-bottom: 6px;
      letter-spacing: -0.04em;
    }
    .board-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
    }
    .asset-card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 18px;
      overflow: hidden;
    }
    .asset-card img {
      width: 100%;
      aspect-ratio: 16 / 10;
      object-fit: cover;
      display: block;
      background: #0d0e10;
    }
    .asset-body {
      padding: 14px;
    }
    .asset-body h4 {
      margin: 0 0 6px;
      font-size: 15px;
    }
    .script-shell {
      display: grid;
      grid-template-columns: 280px 1fr;
      gap: 18px;
    }
    .chapter-card, .text-surface, .side-panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 18px;
    }
    .chapter-card {
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .chapter-pill {
      border-radius: 14px;
      background: rgba(255,255,255,0.05);
      padding: 16px;
      font-weight: 700;
      border: 1px solid var(--line);
    }
    .text-surface {
      padding: 22px;
      min-height: 540px;
      white-space: pre-wrap;
      line-height: 1.9;
      font-size: 15px;
    }
    .tab-strip {
      display: flex;
      gap: 24px;
      padding: 0 4px 10px;
      border-bottom: 1px solid var(--line);
      margin-bottom: 16px;
    }
    .tab-mini {
      position: relative;
      color: var(--muted);
      font-weight: 700;
      padding-bottom: 10px;
      cursor: pointer;
    }
    .tab-mini.active {
      color: var(--text);
    }
    .tab-mini.active::after {
      content: "";
      position: absolute;
      left: 0;
      right: 0;
      bottom: -1px;
      height: 3px;
      border-radius: 999px;
      background: var(--accent);
    }
    .shot-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px;
    }
    .shot-card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 18px;
      overflow: hidden;
    }
    .shot-card img {
      width: 100%;
      aspect-ratio: 16 / 9;
      object-fit: cover;
      display: block;
      background: #0f1013;
    }
    .shot-card .asset-body audio {
      width: 100%;
      margin-top: 10px;
    }
    .list-surface {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .list-item {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 16px;
    }
    .list-item h4 {
      margin: 0 0 6px;
      font-size: 15px;
    }
    .side-panel {
      border-left: 1px solid var(--line);
      background: #1c1d21;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 18px;
      min-width: 0;
    }
    .side-title {
      color: var(--accent);
      font-size: 16px;
      font-weight: 800;
      margin: 0;
    }
    .control-block {
      border-top: 1px solid var(--line);
      padding-top: 18px;
    }
    .control-block h4 {
      margin: 0 0 12px;
      font-size: 15px;
    }
    .ratio-grid, .mode-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
    }
    .mode-grid { grid-template-columns: 1fr; }
    .ratio-pill, .mode-pill, .light-pill {
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 12px;
      background: var(--panel);
      text-align: center;
      color: var(--muted);
    }
    .ratio-pill.active, .mode-pill.active, .light-pill.active {
      color: var(--accent);
      border-color: rgba(156,255,56,0.5);
      background: rgba(156,255,56,0.08);
    }
    .textarea {
      width: 100%;
      min-height: 160px;
      background: #15161a;
      color: var(--text);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 14px;
      resize: vertical;
      line-height: 1.7;
    }
    .helper-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
    }
    .helper-thumb {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 10px;
    }
    .helper-thumb img {
      width: 100%;
      aspect-ratio: 4 / 3;
      object-fit: cover;
      border-radius: 10px;
      display: block;
    }
    .helper-thumb span {
      display: block;
      margin-top: 8px;
      font-size: 12px;
      color: var(--muted);
    }
    .empty-state {
      display: grid;
      place-items: center;
      min-height: 240px;
      text-align: center;
      color: var(--muted);
      border: 1px dashed var(--line);
      border-radius: 18px;
      background: rgba(255,255,255,0.02);
      padding: 20px;
    }
    .link-row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .link-chip {
      border-radius: 999px;
      border: 1px solid var(--line);
      padding: 8px 12px;
      color: var(--muted);
      text-decoration: none;
    }
    .link-chip:hover {
      color: var(--text);
      border-color: var(--line-2);
    }
    .hidden { display: none !important; }
    @media (max-width: 1480px) {
      .app-shell {
        grid-template-columns: 74px 220px 1fr 340px;
      }
      .board-grid { grid-template-columns: repeat(2, 1fr); }
      .hero { grid-template-columns: 1fr; }
    }
    @media (max-width: 1180px) {
      .app-shell {
        grid-template-columns: 74px 1fr;
      }
      .project-column, .side-panel { display: none; }
      .board-grid, .panel-grid, .overview-grid, .script-shell, .shot-grid {
        grid-template-columns: 1fr;
      }
      .topbar {
        flex-direction: column;
        height: auto;
        padding: 16px;
        align-items: stretch;
      }
      .top-actions {
        justify-content: flex-end;
      }
    }
  </style>
</head>
<body>
  <div class="app-shell">
    <aside class="rail">
      <div class="avatar">点</div>
      <div class="rail-group">
        <button class="rail-btn active" title="工作台">⌂</button>
        <button class="rail-btn" title="灵感">✦</button>
        <button class="rail-btn" title="收藏">♡</button>
        <button class="rail-btn" title="模型">⎇</button>
        <button class="rail-btn" title="资产">▣</button>
        <button class="rail-btn" title="账单">☰</button>
      </div>
      <div class="rail-spacer"></div>
      <div class="rail-group">
        <button class="rail-btn active" title="当前项目">⚡</button>
        <button class="rail-btn" title="通知">◔</button>
        <button class="rail-btn" title="文档">⌘</button>
      </div>
      <div class="avatar-small">晚</div>
    </aside>

    <aside class="project-column">
      <div class="project-head">
        <div class="back-row">
          <button class="ghost-btn" id="backBtn">返回</button>
        </div>
        <div class="project-title">
          <div>
            <h1>着急的样片</h1>
            <p>点众科技 AI 真人剧演示链路，围绕剧情、主体、分镜和成片组织全过程。</p>
          </div>
        </div>
      </div>
      <div class="run-column">
        <div class="toolbar">
          <strong>运行记录</strong>
          <button class="green-btn" id="refreshBtn">刷新</button>
        </div>
        <div id="runList" class="run-list"></div>
      </div>
      <div class="run-footer">
        <button class="ghost-btn" style="width:100%">添加新剧集</button>
      </div>
    </aside>

    <section class="studio">
      <div class="topbar">
        <div class="stage-tabs" id="stageTabs"></div>
        <div class="top-actions">
          <div class="metric-pill" id="favPill">0</div>
          <button class="outline-pill">分享</button>
          <button class="green-btn" id="actionBtn">进入工作台</button>
        </div>
      </div>
      <div class="content" id="app">
        <div class="studio-card pane"><div class="empty-state">加载中…</div></div>
      </div>
    </section>

    <aside class="side-panel">
      <h3 class="side-title" id="sideTitle">全局设置</h3>
      <div id="sideContent"></div>
    </aside>
  </div>

  <script>
    const state = {
      runs: [],
      currentRunId: null,
      currentRun: null,
      currentStage: "overview",
      assetTab: "characters",
      shotTab: "shots",
    };

    const runListEl = document.getElementById("runList");
    const appEl = document.getElementById("app");
    const sideContentEl = document.getElementById("sideContent");
    const sideTitleEl = document.getElementById("sideTitle");
    const stageTabsEl = document.getElementById("stageTabs");
    const actionBtnEl = document.getElementById("actionBtn");
    const favPillEl = document.getElementById("favPill");

    const stages = [
      { id: "overview", label: "概览" },
      { id: "script", label: "剧本" },
      { id: "assets", label: "主体" },
      { id: "storyboard", label: "分镜" },
      { id: "final", label: "成片" },
    ];

    document.getElementById("refreshBtn").addEventListener("click", loadRuns);
    document.getElementById("backBtn").addEventListener("click", () => {
      state.currentStage = "overview";
      render();
    });

    function safe(text) {
      return String(text || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
    }

    function badge(text, type = "") {
      return '<span class="badge ' + type + '">' + safe(text) + '</span>';
    }

    function artifactUrl(runId, filePath) {
      return "/artifacts/" + encodeURIComponent(runId) + "/" + filePath.split("/").map(encodeURIComponent).join("/");
    }

    function formatStatus(run) {
      return run.isComplete ? "已完成" : "运行中";
    }

    function renderStageTabs() {
      stageTabsEl.innerHTML = stages.map((stage) => {
        const cls = stage.id === state.currentStage ? "stage-tab active" : "stage-tab";
        return '<button class="' + cls + '" data-stage="' + stage.id + '">' + stage.label + "</button>";
      }).join("");
      [...stageTabsEl.querySelectorAll(".stage-tab")].forEach((node) => {
        node.addEventListener("click", () => {
          state.currentStage = node.dataset.stage;
          render();
        });
      });
    }

    function renderRunList() {
      runListEl.innerHTML = state.runs.map((run) => {
        const cls = run.runId === state.currentRunId ? "run-item active" : "run-item";
        return (
          '<div class="' + cls + '" data-run-id="' + run.runId + '">' +
            "<strong>" + safe(run.runId) + "</strong>" +
            "<span>" + safe(formatStatus(run)) + "</span>" +
            "<span>" + safe(run.completedAt || "等待链路完成") + "</span>" +
            "<span>" + safe(run.renderNote || "") + "</span>" +
          "</div>"
        );
      }).join("");
      [...runListEl.querySelectorAll(".run-item")].forEach((node) => {
        node.addEventListener("click", () => loadRun(node.dataset.runId));
      });
    }

    function sectionHeader(title, desc, extra = "") {
      return (
        '<div class="section-title">' +
          "<div>" +
            "<h2>" + safe(title) + "</h2>" +
            (desc ? "<p>" + safe(desc) + "</p>" : "") +
          "</div>" +
          extra +
        "</div>"
      );
    }

    function getRunData() {
      const run = state.currentRun;
      if (!run) {
        return {
          adaptation: null,
          characters: [],
          storyboard: null,
          subtitles: "",
          finalVideo: "",
          roleReferences: [],
          shots: [],
        };
      }

      const adaptation = run.artifacts?.adaptation || null;
      const characters = run.artifacts?.characters?.characters || run.manifest?.roleReferences || [];
      const storyboard = run.artifacts?.storyboard || null;
      const subtitles = run.artifacts?.subtitles || "";
      const roleReferences = run.manifest?.roleReferences || [];
      const shots = run.manifest?.shots || [];
      const finalVideo = run.manifest?.outputs?.finalVideo
        ? artifactUrl(run.runId, run.manifest.outputs.finalVideo)
        : "";
      return { adaptation, characters, storyboard, subtitles, finalVideo, roleReferences, shots };
    }

    function renderOverview(run) {
      const { adaptation, finalVideo, shots } = getRunData();
      const stageCount = run.manifest?.stages?.length || 0;
      const modelCount = Object.keys(run.modelMatrix?.primary || {}).length || 0;
      const duration = (shots || []).reduce((sum, shot) => sum + Number(shot.durationSec || 0), 0);
      const summary = adaptation?.logline || adaptation?.theme || "当前运行还没有生成完整剧情摘要。";
      const badges = [
        badge(run.runId, "accent"),
        badge(run.modelMatrix?.provider || "Qiniu MaaS / SUFY"),
        badge(run.manifest?.renderStrategy?.mode || "legacy"),
        !run.manifest?.completedAt ? badge("链路未完成", "warn") : "",
      ].join("");

      const left = (
        '<div class="video-stage">' +
          sectionHeader("最终样片", "这里展示最终视频，当前仍是“关键帧 + 音频 + 字幕 + 轻运动合成”链路。") +
          (finalVideo
            ? '<video controls src="' + finalVideo + '"></video>'
            : '<div class="empty-state">当前运行尚未产出最终样片。</div>') +
        "</div>"
      );

      const right = (
        '<div class="studio-card pane">' +
          sectionHeader("运行概览", "用一句话说清楚这次 run 在做什么。") +
          '<div class="badges">' + badges + "</div>" +
          '<p class="body-copy">' + safe(summary) + "</p>" +
          '<p class="body-copy">' + safe(run.manifest?.renderStrategy?.note || "") + "</p>" +
          '<div class="link-row">' +
            '<a class="link-chip" target="_blank" href="/api/runs/' + encodeURIComponent(run.runId) + '">查看 run JSON</a>' +
            '<a class="link-chip" target="_blank" href="' + artifactUrl(run.runId, "01-input/story.txt") + '">输入故事</a>' +
            (run.manifest?.outputs?.subtitles
              ? '<a class="link-chip" target="_blank" href="' + artifactUrl(run.runId, run.manifest.outputs.subtitles) + '">字幕文件</a>'
              : "") +
          "</div>" +
        "</div>"
      );

      const stats = (
        '<div class="overview-grid">' +
          '<div class="stat-card"><strong>' + stageCount + '</strong><span class="muted">已记录阶段</span></div>' +
          '<div class="stat-card"><strong>' + shots.length + '</strong><span class="muted">镜头数量</span></div>' +
          '<div class="stat-card"><strong>' + duration + 's</strong><span class="muted">样片时长</span></div>' +
        "</div>"
      );

      const stageRows = (run.manifest?.stages || []).map((stage) => {
        return (
          '<div class="list-item">' +
            '<h4>' + safe(stage.stage) + '</h4>' +
            '<p class="mono">' + safe(stage.model) + "</p>" +
            '<p class="mono">' + safe(stage.output) + "</p>" +
          "</div>"
        );
      }).join("");

      const recRows = (run.modelMatrix?.recommendations || []).map((item) => {
        return (
          '<div class="list-item">' +
            '<h4>' + safe(item.stage) + '</h4>' +
            '<p>当前默认：<span class="mono">' + safe(item.current) + "</span></p>" +
            '<p>候选方向：' + safe((item.candidates || []).join(" / ")) + "</p>" +
            '<p>重点观察：' + safe(item.focus) + "</p>" +
          "</div>"
        );
      }).join("");

      return (
        '<div class="studio-card hero">' + left + right + "</div>" +
        stats +
        '<div class="panel-grid">' +
          '<div class="studio-card pane">' +
            sectionHeader("阶段模型", "对应你在讲解时要说明的业务节点与实际模型。") +
            '<div class="list-surface">' + (stageRows || '<div class="empty-state">暂无阶段记录。</div>') + "</div>" +
          "</div>" +
          '<div class="studio-card pane">' +
            sectionHeader("模型策略", "保留业务阶段和模型职责，不把所有能力混成一个按钮。") +
            '<div class="list-surface">' + (recRows || '<div class="empty-state">暂无模型策略。</div>') + "</div>" +
          "</div>" +
        "</div>"
      );
    }

    function renderScript(run) {
      const { adaptation } = getRunData();
      const storyFile = artifactUrl(run.runId, "01-input/story.txt");
      const scriptText = run.artifacts?.storyText || "暂无输入故事。";
      const scenes = (adaptation?.scenes || []).map((scene) => {
        return (
          '<div class="list-item">' +
            '<h4>' + safe(scene.title || scene.scene_id) + '</h4>' +
            '<p>地点：' + safe(scene.location || "未填") + "</p>" +
            '<p>目标：' + safe(scene.objective || "未填") + "</p>" +
            '<p>冲突：' + safe(scene.conflict || "未填") + "</p>" +
            '<p>转折：' + safe(scene.turning_point || "未填") + "</p>" +
          "</div>"
        );
      }).join("");

      return (
        '<div class="script-shell">' +
          '<div class="chapter-card">' +
            '<div class="chapter-pill">第 1 章</div>' +
            '<div class="list-item">' +
              '<h4>剧情骨架</h4>' +
              '<p>' + safe(adaptation?.theme || "等待生成") + "</p>" +
              '<p class="mono">' + safe(adaptation?.title || "未命名剧本") + "</p>" +
            "</div>" +
            '<div class="list-item">' +
              '<h4>关键链接</h4>' +
              '<p><a class="link-chip" target="_blank" href="' + storyFile + '">输入剧本</a></p>' +
              '<p><a class="link-chip" target="_blank" href="' + artifactUrl(run.runId, "02-adaptation/adaptation.json") + '">改编结果</a></p>' +
            "</div>" +
            '<div class="list-surface">' + (scenes || '<div class="empty-state">暂无场景拆分。</div>') + "</div>" +
          "</div>" +
          '<div class="text-surface">' + safe(scriptText) + "</div>" +
        "</div>"
      );
    }

    function renderAssets(run) {
      const { characters, roleReferences } = getRunData();
      const active = state.assetTab;
      const roleCards = (roleReferences || []).map((item) => {
        const imagePath = artifactUrl(run.runId, "04-role-reference/" + item.imagePath);
        const promptPath = artifactUrl(run.runId, "04-role-reference/" + item.promptPath);
        const detail = characters.find((entry) => entry.name === item.name) || {};
        return (
          '<div class="asset-card">' +
            '<img src="' + imagePath + '" alt="' + safe(item.name) + '">' +
            '<div class="asset-body">' +
              '<h4>' + safe(item.name) + "</h4>" +
              '<p class="body-copy">' + safe(detail.role || item.role || "角色") + "</p>" +
              '<p class="small">' + safe((detail.personality || []).join(" / ")) + "</p>" +
              '<div class="badges">' + badge(item.status === "ok" ? "主体图已生成" : "主体图回退", item.status === "ok" ? "accent" : "warn") + "</div>" +
              '<p><a class="link-chip" target="_blank" href="' + promptPath + '">提示词</a></p>' +
            "</div>" +
          "</div>"
        );
      }).join("");

      const characterList = (characters || []).map((item) => {
        return (
          '<div class="list-item">' +
            '<h4>' + safe(item.name) + ' <span class="small">· ' + safe(item.role || "角色") + "</span></h4>" +
            '<p>' + safe(item.appearance || "暂无外观描述") + "</p>" +
            '<p>性格：' + safe((item.personality || []).join("、") || "未填") + "</p>" +
            '<p>音色建议：' + safe(item.voice_style || "未填") + "</p>" +
          "</div>"
        );
      }).join("");

      return (
        '<div class="studio-card pane">' +
          sectionHeader("主体工作区", "参考有戏 AI 的主体台，把角色、场景、道具分成单独入口。", '<button class="outline-pill">批量生成主体图</button>') +
          '<div class="tab-strip">' +
            '<div class="tab-mini ' + (active === "characters" ? "active" : "") + '" data-asset-tab="characters">角色 ' + characters.length + '</div>' +
            '<div class="tab-mini ' + (active === "scenes" ? "active" : "") + '" data-asset-tab="scenes">场景 0</div>' +
            '<div class="tab-mini ' + (active === "props" ? "active" : "") + '" data-asset-tab="props">道具 0</div>' +
          "</div>" +
          (
            active === "characters"
              ? '<div class="board-grid">' + (roleCards || '<div class="empty-state">还没有角色首图。</div>') + "</div>" +
                '<div class="panel-grid" style="margin-top:18px">' +
                  '<div class="studio-card pane">' + sectionHeader("角色设定", "把文本角色描述和主体图放在一起看。") + '<div class="list-surface">' + (characterList || '<div class="empty-state">暂无角色设定。</div>') + "</div></div>" +
                  '<div class="studio-card pane">' + sectionHeader("连续性提示词", "这里适合放角色连续性提示语，给后续镜头图或视频模型复用。") +
                    '<div class="list-surface">' + (characters.map((item) => '<div class="list-item"><h4>' + safe(item.name) + '</h4><p>' + safe(item.continuity_prompt || "暂无") + '</p></div>').join("") || '<div class="empty-state">暂无连续性提示词。</div>') + "</div></div>" +
                "</div>"
              : '<div class="empty-state">当前先聚焦角色主体。场景和道具入口保留，但还没接入生成链路。</div>'
          ) +
        "</div>"
      );
    }

    function renderStoryboard(run) {
      const { storyboard, shots } = getRunData();
      const shotCards = (shots || []).map((shot, index) => {
        const image = artifactUrl(run.runId, shot.imagePath);
        const audio = artifactUrl(run.runId, shot.audioPath);
        const segment = artifactUrl(run.runId, shot.segmentPath);
        const shotData = storyboard?.shots?.[index] || {};
        return (
          '<div class="shot-card">' +
            '<img src="' + image + '" alt="' + safe(shot.shotId) + '">' +
            '<div class="asset-body">' +
              '<h4>' + safe(shot.shotId) + ' · ' + safe(shotData.title || "镜头") + "</h4>" +
              '<p class="shot-meta">' + safe(shot.speaker) + " · " + safe((shotData.camera || "镜头") + " · " + shot.durationSec + "s") + "</p>" +
              '<p class="body-copy">' + safe(shotData.subtitle || shotData.line || "暂无字幕") + "</p>" +
              '<div class="badges">' +
                badge("画面：" + shot.imageStatus, shot.imageStatus === "ok" ? "accent" : "warn") +
                badge("音频：" + shot.audioStatus, shot.audioStatus === "ok" ? "accent" : "warn") +
              "</div>" +
              '<audio controls src="' + audio + '"></audio>' +
              '<p><a class="link-chip" target="_blank" href="' + segment + '">镜头片段</a></p>' +
            "</div>" +
          "</div>"
        );
      }).join("");

      const shotList = (storyboard?.shots || []).map((item) => {
        return (
          '<div class="list-item">' +
            '<h4>' + safe(item.shot_id || item.title) + "</h4>" +
            '<p>视觉焦点：' + safe(item.visual_focus || "未填") + "</p>" +
            '<p>画面提示词：' + safe(item.image_prompt || "未填") + "</p>" +
          "</div>"
        );
      }).join("");

      return (
        '<div class="panel-grid">' +
          '<div class="studio-card pane">' +
            sectionHeader("镜头板", "中间按镜头卡片查看，适合后续接视频模型时沿用。") +
            '<div class="shot-grid">' + (shotCards || '<div class="empty-state">暂无镜头卡片。</div>') + "</div>" +
          "</div>" +
          '<div class="studio-card pane">' +
            sectionHeader("分镜说明", "保留文字版 shot list，便于看模型输出是否稳定。") +
            '<div class="list-surface">' + (shotList || '<div class="empty-state">暂无分镜说明。</div>') + "</div>" +
          "</div>" +
        "</div>"
      );
    }

    function renderFinal(run) {
      const { finalVideo, subtitles, shots } = getRunData();
      const subtitlePreview = subtitles || "暂无字幕文件。";
      const segments = (shots || []).map((shot) => {
        const segment = artifactUrl(run.runId, shot.segmentPath);
        return (
          '<div class="list-item">' +
            '<h4>' + safe(shot.shotId) + "</h4>" +
            '<p>' + safe(shot.speaker) + " · " + safe(shot.durationSec + "s") + "</p>" +
            '<p><a class="link-chip" target="_blank" href="' + segment + '">查看镜头片段</a></p>' +
          "</div>"
        );
      }).join("");

      return (
        '<div class="panel-grid">' +
          '<div class="studio-card pane">' +
            sectionHeader("成片输出", "这里是最终向导师展示的短样片和产出说明。") +
            (finalVideo
              ? '<video controls src="' + finalVideo + '" style="width:100%;aspect-ratio:16 / 9;border-radius:14px;background:#090a0b"></video>'
              : '<div class="empty-state">当前 run 还没有最终成片。</div>') +
            '<div class="link-row" style="margin-top:14px">' +
              (run.manifest?.outputs?.finalVideo
                ? '<a class="link-chip" target="_blank" href="' + artifactUrl(run.runId, run.manifest.outputs.finalVideo) + '">打开成片文件</a>'
                : "") +
              (run.manifest?.outputs?.subtitles
                ? '<a class="link-chip" target="_blank" href="' + artifactUrl(run.runId, run.manifest.outputs.subtitles) + '">打开字幕文件</a>'
                : "") +
            "</div>" +
          "</div>" +
          '<div class="studio-card pane">' +
            sectionHeader("字幕与镜头清单", "把对白、字幕与最终镜头对应起来，方便查对齐情况。") +
            '<div class="text-surface" style="min-height:260px">' + safe(subtitlePreview) + "</div>" +
            '<div class="list-surface" style="margin-top:16px">' + (segments || "") + "</div>" +
          "</div>" +
        "</div>"
      );
    }

    function renderCenter() {
      const run = state.currentRun;
      if (!run) {
        appEl.innerHTML = '<div class="studio-card pane"><div class="empty-state">还没有可展示的运行结果。</div></div>';
        return;
      }

      const renderers = {
        overview: renderOverview,
        script: renderScript,
        assets: renderAssets,
        storyboard: renderStoryboard,
        final: renderFinal,
      };
      const renderer = renderers[state.currentStage] || renderOverview;
      appEl.innerHTML = renderer(run);

      [...appEl.querySelectorAll("[data-asset-tab]")].forEach((node) => {
        node.addEventListener("click", () => {
          state.assetTab = node.dataset.assetTab;
          render();
        });
      });
    }

    function renderSidePanel() {
      const run = state.currentRun;
      if (!run) {
        sideTitleEl.textContent = "全局设置";
        sideContentEl.innerHTML = '<div class="empty-state">请选择一个运行记录。</div>';
        return;
      }

      const { adaptation, roleReferences } = getRunData();
      const ratioButtons = ['16:9', '9:16', '4:3', '3:4'].map((item) => {
        const active = item === "16:9" ? " active" : "";
        return '<div class="ratio-pill' + active + '">' + item + '</div>';
      }).join("");

      const referenceThumbs = (roleReferences || []).slice(0, 4).map((item) => {
        return (
          '<div class="helper-thumb">' +
            '<img src="' + artifactUrl(run.runId, "04-role-reference/" + item.imagePath) + '" alt="' + safe(item.name) + '">' +
            '<span>' + safe(item.name) + "</span>" +
          "</div>"
        );
      }).join("");

      const rightPanels = {
        overview: {
          title: "全局设置",
          content:
            '<div class="control-block"><h4>视频比例</h4><div class="ratio-grid">' + ratioButtons + '</div></div>' +
            '<div class="control-block"><h4>创作模式</h4><div class="mode-grid">' +
              '<div class="mode-pill active">链路通路优先</div>' +
              '<div class="mode-pill">视频模型接入中</div>' +
            '</div></div>' +
            '<div class="control-block"><h4>运行策略</h4><p class="body-copy">' + safe(run.manifest?.renderStrategy?.note || "") + '</p></div>',
        },
        script: {
          title: "剧本设置",
          content:
            '<div class="control-block"><h4>剧情主题</h4><div class="light-pill active">' + safe(adaptation?.theme || "等待生成") + '</div></div>' +
            '<div class="control-block"><h4>一句话梗概</h4><textarea class="textarea">' + safe(adaptation?.logline || "") + '</textarea></div>' +
            '<div class="control-block"><h4>文本模型</h4><div class="light-pill active">' + safe(run.modelMatrix?.primary?.adaptation || run.modelMatrix?.primary?.text || "未记录") + '</div></div>',
        },
        assets: {
          title: "生成主体图",
          content:
            '<div class="control-block"><h4>主体描述</h4><textarea class="textarea">' + safe((run.artifacts?.characters?.characters || []).map((item) => item.continuity_prompt).join("\\n\\n")) + '</textarea></div>' +
            '<div class="control-block"><h4>模型选择</h4><div class="light-pill active">' + safe(run.modelMatrix?.primary?.roleImage || run.modelMatrix?.primary?.image || "未记录") + '</div></div>' +
            '<div class="control-block"><h4>参考图片</h4><div class="helper-grid">' + (referenceThumbs || '<div class="empty-state">暂无参考图。</div>') + '</div></div>',
        },
        storyboard: {
          title: "分镜参数",
          content:
            '<div class="control-block"><h4>当前视频模型位</h4><div class="light-pill active">' + safe(run.manifest?.renderStrategy?.plannedVideoModel || "未配置") + '</div></div>' +
            '<div class="control-block"><h4>镜头说明</h4><textarea class="textarea">' + safe((run.artifacts?.storyboard?.shots || []).map((item) => item.image_prompt).join("\\n\\n")) + '</textarea></div>',
        },
        final: {
          title: "成片说明",
          content:
            '<div class="control-block"><h4>当前状态</h4>' +
              '<div class="light-pill ' + (run.manifest?.completedAt ? "active" : "") + '">' + safe(run.manifest?.completedAt ? "成片已生成" : "等待成片") + '</div></div>' +
            '<div class="control-block"><h4>视频模型阶段</h4><p class="body-copy">当前还未真正接入连续视频生成，这里只是预留位。后续适合接入 Veo 3、Sora 2 或同类模型。</p></div>',
        },
      };

      const panel = rightPanels[state.currentStage] || rightPanels.overview;
      sideTitleEl.textContent = panel.title;
      sideContentEl.innerHTML = panel.content;
    }

    function render() {
      renderStageTabs();
      renderRunList();
      renderCenter();
      renderSidePanel();
      favPillEl.textContent = state.currentRun?.artifacts?.characters?.characters?.length || state.currentRun?.manifest?.roleReferences?.length || 0;
      actionBtnEl.textContent = state.currentStage === "assets" ? "智能分镜" : "主体提取";
    }

    async function loadRuns() {
      const res = await fetch("/api/runs");
      state.runs = await res.json();
      if (!state.currentRunId && state.runs[0]) {
        state.currentRunId = state.runs[0].runId;
      }
      if (state.currentRunId) {
        await loadRun(state.currentRunId);
      } else {
        render();
      }
    }

    async function loadRun(runId) {
      state.currentRunId = runId;
      const res = await fetch("/api/runs/" + encodeURIComponent(runId));
      state.currentRun = await res.json();
      render();
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
        runs.push({
          runId,
          completedAt: null,
          renderNote: "",
          isComplete: false,
        });
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

async function readOptionalJson(filePath) {
  try {
    return await readJson(filePath);
  } catch {
    return null;
  }
}

async function readOptionalText(filePath) {
  try {
    return await readText(filePath);
  } catch {
    return "";
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

  const storyText = await readOptionalText(path.join(runDir, "01-input", "story.txt"));
  const adaptation = await readOptionalJson(path.join(runDir, "02-adaptation", "adaptation.json"));
  const characters =
    (await readOptionalJson(path.join(runDir, "03-characters", "characters.json"))) ||
    (await readOptionalJson(path.join(runDir, "03-characters", "characters.json")));

  const storyboardCandidates = [
    path.join(runDir, "05-storyboard", "storyboard.json"),
    path.join(runDir, "04-storyboard", "storyboard.json"),
  ];
  let storyboard = null;
  for (const candidate of storyboardCandidates) {
    storyboard = await readOptionalJson(candidate);
    if (storyboard) {
      break;
    }
  }

  let subtitles = "";
  const subtitleCandidates = [
    path.join(runDir, "08-subtitles", "subtitles.srt"),
    path.join(runDir, "07-subtitles", "subtitles.srt"),
  ];
  for (const candidate of subtitleCandidates) {
    subtitles = await readOptionalText(candidate);
    if (subtitles) {
      break;
    }
  }

  return {
    runId,
    manifest,
    modelMatrix,
    artifacts: {
      storyText,
      adaptation,
      characters,
      storyboard,
      subtitles,
    },
  };
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
