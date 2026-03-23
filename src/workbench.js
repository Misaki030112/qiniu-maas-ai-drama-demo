import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { URL } from "node:url";
import { config } from "./config.js";
import { ensureDir, makeRunId, readJson, readText, writeText } from "./utils.js";

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

const runningJobs = new Map();

const modelOptions = {
  text: [
    "openai/gpt-5.4-mini",
    "openai/gpt-5.4",
    "deepseek-v3-0324",
    "glm-4.5-air",
    "minimax/minimax-m2.5",
  ],
  image: [
    "gemini-2.5-flash-image",
    "gpt-image-1",
    "imagen-4",
    "minimax-image-01",
  ],
  video: ["veo-3", "sora-2", "runway-gen-4", "hailuo-2.3"],
};

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function htmlPage() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AI 真人剧执行台</title>
  <style>
    :root {
      --bg: #111317;
      --panel: #171a20;
      --panel-2: #1d2128;
      --line: rgba(255,255,255,0.08);
      --text: #eef2f8;
      --muted: #98a0ad;
      --accent: #9bff3d;
      --danger: #ff8d73;
      --shadow: 0 20px 50px rgba(0,0,0,0.28);
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      background:
        radial-gradient(circle at top right, rgba(155,255,61,0.08), transparent 22%),
        #111317;
      color: var(--text);
      font-family: "SF Pro Display","PingFang SC","Helvetica Neue",sans-serif;
      min-height: 100%;
    }
    button, input, select, textarea { font: inherit; }
    .layout {
      display: grid;
      grid-template-columns: 280px 1fr 360px;
      min-height: 100vh;
    }
    .left, .right {
      background: rgba(18,20,24,0.94);
      border-right: 1px solid var(--line);
      padding: 20px;
    }
    .right {
      border-right: none;
      border-left: 1px solid var(--line);
    }
    .center {
      min-width: 0;
      display: flex;
      flex-direction: column;
    }
    .topbar {
      padding: 18px 22px;
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      background: rgba(17,19,23,0.72);
      backdrop-filter: blur(12px);
      position: sticky;
      top: 0;
      z-index: 2;
    }
    .topbar h1 {
      margin: 0;
      font-size: 24px;
      letter-spacing: -0.04em;
    }
    .topbar p {
      margin: 6px 0 0;
      color: var(--muted);
      font-size: 13px;
    }
    .tabs {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .tab {
      border: 1px solid var(--line);
      border-radius: 999px;
      background: transparent;
      color: var(--muted);
      padding: 10px 14px;
      cursor: pointer;
    }
    .tab.active {
      color: #111317;
      background: var(--accent);
      border-color: transparent;
      font-weight: 700;
    }
    .section {
      padding: 22px;
      display: grid;
      gap: 18px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 18px;
      box-shadow: var(--shadow);
      padding: 18px;
      min-width: 0;
    }
    .card h2, .card h3, .panel-title {
      margin: 0 0 10px;
      letter-spacing: -0.03em;
    }
    .small, .muted, .body, .meta, .mono {
      color: var(--muted);
      line-height: 1.6;
      font-size: 13px;
    }
    .mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      word-break: break-all;
    }
    .stack { display: grid; gap: 12px; }
    .pill-row { display: flex; flex-wrap: wrap; gap: 8px; }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 10px;
      border-radius: 999px;
      background: rgba(255,255,255,0.05);
      font-size: 12px;
      color: var(--text);
    }
    .pill.good { color: var(--accent); background: rgba(155,255,61,0.12); }
    .pill.warn { color: #ffc3b2; background: rgba(255,141,115,0.12); }
    .stage-grid {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 12px;
    }
    .stage-box {
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 14px;
      background: var(--panel);
    }
    .stage-box strong {
      display: block;
      margin-bottom: 8px;
      font-size: 14px;
    }
    .hero-grid {
      display: grid;
      grid-template-columns: 1.2fr 0.8fr;
      gap: 18px;
    }
    video {
      width: 100%;
      aspect-ratio: 16 / 9;
      background: #0a0c0e;
      border-radius: 14px;
    }
    .split {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px;
    }
    .stage-list, .asset-grid, .shot-grid {
      display: grid;
      gap: 12px;
    }
    .asset-grid {
      grid-template-columns: repeat(2, 1fr);
    }
    .shot-grid {
      grid-template-columns: repeat(2, 1fr);
    }
    .mini-card {
      background: var(--panel-2);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 14px;
    }
    .mini-card img {
      width: 100%;
      aspect-ratio: 16 / 10;
      object-fit: cover;
      display: block;
      border-radius: 12px;
      background: #0a0c0e;
      margin-bottom: 10px;
    }
    .shot-card img {
      aspect-ratio: 16 / 9;
    }
    audio {
      width: 100%;
      margin-top: 10px;
    }
    .text-block {
      background: var(--panel-2);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 16px;
      white-space: pre-wrap;
      line-height: 1.8;
      min-height: 220px;
    }
    .field {
      display: grid;
      gap: 8px;
      margin-bottom: 14px;
    }
    .field label {
      color: var(--text);
      font-size: 13px;
      font-weight: 600;
    }
    .input, .select, .textarea {
      width: 100%;
      border: 1px solid var(--line);
      background: #111317;
      color: var(--text);
      border-radius: 14px;
      padding: 12px 14px;
    }
    .textarea {
      min-height: 180px;
      resize: vertical;
      line-height: 1.7;
    }
    .btn-row {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .btn {
      border: 1px solid var(--line);
      background: transparent;
      color: var(--text);
      border-radius: 14px;
      padding: 11px 14px;
      cursor: pointer;
    }
    .btn.primary {
      background: var(--accent);
      color: #111317;
      border-color: transparent;
      font-weight: 700;
    }
    .note {
      padding: 12px 14px;
      border-radius: 14px;
      background: rgba(255,255,255,0.04);
      border: 1px solid var(--line);
      color: var(--muted);
      font-size: 13px;
      line-height: 1.6;
    }
    .empty {
      border: 1px dashed var(--line);
      border-radius: 16px;
      padding: 24px;
      text-align: center;
      color: var(--muted);
    }
    .link {
      color: inherit;
    }
    @media (max-width: 1360px) {
      .layout { grid-template-columns: 260px 1fr 320px; }
      .stage-grid { grid-template-columns: repeat(3, 1fr); }
      .hero-grid, .split { grid-template-columns: 1fr; }
      .shot-grid, .asset-grid { grid-template-columns: 1fr; }
    }
    @media (max-width: 1080px) {
      .layout { grid-template-columns: 1fr; }
      .left, .right { border: none; }
      .stage-grid { grid-template-columns: repeat(2, 1fr); }
    }
  </style>
</head>
<body>
  <div class="layout">
    <aside class="left">
      <div class="stack">
        <div>
          <div class="panel-title">当前状态</div>
          <div class="muted">这里只展示当前这次链路的真实状态，不展示历史 run 堆叠。</div>
        </div>
        <div class="card stack" id="statusPanel"></div>
        <div class="btn-row">
          <button class="btn" id="refreshBtn">刷新状态</button>
          <button class="btn" id="resetBtn">清空旧结果</button>
        </div>
      </div>
    </aside>

    <main class="center">
      <div class="topbar">
        <div>
          <h1>点众 AI 真人剧 Demo</h1>
          <p>核心流程：剧本 -> 角色 -> 分镜 -> 画面 -> 配音。视频模型未接通，所以这里只展示前置链路结果。</p>
        </div>
        <div class="tabs" id="tabs"></div>
      </div>
      <div class="section" id="app"></div>
    </main>

    <aside class="right">
      <div class="stack">
        <div>
          <div class="panel-title">执行配置</div>
          <div class="muted">这里的按钮代表当前产品真的能做什么。现在只保留模型切换、执行和结果查看。</div>
        </div>

        <div class="field">
          <label for="storyInput">故事输入</label>
          <textarea id="storyInput" class="textarea" placeholder="输入一段剧情文本，用来生成一条真人剧 demo。"></textarea>
        </div>

        <div class="field">
          <label for="adaptationModel">剧本改编模型</label>
          <select id="adaptationModel" class="select"></select>
        </div>
        <div class="field">
          <label for="characterModel">角色设定模型</label>
          <select id="characterModel" class="select"></select>
        </div>
        <div class="field">
          <label for="storyboardModel">分镜模型</label>
          <select id="storyboardModel" class="select"></select>
        </div>
        <div class="field">
          <label for="roleImageModel">角色首图模型</label>
          <select id="roleImageModel" class="select"></select>
        </div>
        <div class="field">
          <label for="shotImageModel">镜头图模型</label>
          <select id="shotImageModel" class="select"></select>
        </div>

        <div class="btn-row">
          <button class="btn primary" id="runBtn">执行一条新链路</button>
        </div>

        <div class="note" id="runMessage">
          视频模型还没接通。当前只能生成静态镜头 + 配音 + 字幕的合成输出，用来检查前置链路是否跑通。
        </div>
      </div>
    </aside>
  </div>

  <script>
    const stageTabs = [
      { id: "overview", label: "总览" },
      { id: "script", label: "剧本" },
      { id: "characters", label: "角色" },
      { id: "storyboard", label: "分镜" },
      { id: "output", label: "输出" },
    ];

    const state = {
      runs: [],
      currentRunId: null,
      currentRun: null,
      currentTab: "overview",
      config: null,
    };

    const appEl = document.getElementById("app");
    const statusPanelEl = document.getElementById("statusPanel");
    const tabsEl = document.getElementById("tabs");
    const runMessageEl = document.getElementById("runMessage");
    const modelFields = {
      adaptation: document.getElementById("adaptationModel"),
      characters: document.getElementById("characterModel"),
      storyboard: document.getElementById("storyboardModel"),
      roleImage: document.getElementById("roleImageModel"),
      shotImage: document.getElementById("shotImageModel"),
    };

    document.getElementById("refreshBtn").addEventListener("click", async () => {
      await loadRuns();
      if (state.currentRunId) {
        await loadRun(state.currentRunId);
      } else {
        state.currentRun = null;
        render();
      }
    });

    document.getElementById("resetBtn").addEventListener("click", resetWorkspace);
    document.getElementById("runBtn").addEventListener("click", executeRun);

    function safe(value) {
      return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
    }

    function artifactUrl(runId, filePath) {
      return "/artifacts/" + encodeURIComponent(runId) + "/" + filePath.split("/").map(encodeURIComponent).join("/");
    }

    function pill(text, type = "") {
      return '<span class="pill ' + type + '">' + safe(text) + "</span>";
    }

    function empty(message) {
      return '<div class="empty">' + safe(message) + "</div>";
    }

    function renderTabs() {
      tabsEl.innerHTML = stageTabs.map((tab) => {
        const cls = state.currentTab === tab.id ? "tab active" : "tab";
        return '<button class="' + cls + '" data-tab="' + tab.id + '">' + tab.label + "</button>";
      }).join("");
      [...tabsEl.querySelectorAll(".tab")].forEach((node) => {
        node.addEventListener("click", () => {
          state.currentTab = node.dataset.tab;
          renderCenter();
        });
      });
    }

    function renderStatusPanel() {
      const run = state.currentRun;
      if (!run) {
        statusPanelEl.innerHTML =
          "<h3>尚未执行</h3>" +
          '<div class="body">清空旧结果后，界面只保留一次真实执行。先在右侧输入故事并启动链路。</div>' +
          '<div class="meta">视频模型：未接通</div>' +
          '<div class="meta">当前输出：无</div>';
        return;
      }

      const completedStages = new Set((run.manifest?.stages || []).map((item) => item.stage));
      const stagePills = [
        ["剧本", completedStages.has("adaptation")],
        ["角色", completedStages.has("characters")],
        ["角色首图", completedStages.has("role_reference")],
        ["分镜", completedStages.has("storyboard")],
        ["画面/配音", completedStages.has("images_audio")],
        ["输出合成", Boolean(run.manifest?.completedAt)],
      ].map(([label, ok]) => pill(label + " " + (ok ? "已完成" : "未完成"), ok ? "good" : "warn")).join("");

      statusPanelEl.innerHTML =
        "<h3>当前执行</h3>" +
        '<div class="pill-row">' +
          pill(run.runId, "good") +
          pill(run.isComplete ? "已完成" : "运行中", run.isComplete ? "good" : "warn") +
        "</div>" +
        '<div class="meta">开始时间：' + safe(run.startedAt || "未记录") + "</div>" +
        '<div class="meta">完成时间：' + safe(run.completedAt || "未完成") + "</div>" +
        '<div class="meta">视频模型：未接通</div>' +
        '<div class="meta">当前输出：静态镜头 + 配音 + 字幕合成</div>' +
        '<div class="pill-row" style="margin-top:8px">' + stagePills + "</div>";
    }

    function getRunData() {
      const run = state.currentRun;
      return {
        adaptation: run?.artifacts?.adaptation || null,
        characters: run?.artifacts?.characters?.characters || [],
        storyboard: run?.artifacts?.storyboard || null,
        subtitles: run?.artifacts?.subtitles || "",
        storyText: run?.artifacts?.storyText || "",
        roleReferences: run?.manifest?.roleReferences || [],
        shots: run?.manifest?.shots || [],
        outputVideo: (run?.manifest?.outputs?.outputVideo || run?.manifest?.outputs?.previewVideo || run?.manifest?.outputs?.finalVideo)
          ? artifactUrl(run.runId, run.manifest.outputs.outputVideo || run.manifest.outputs.previewVideo || run.manifest.outputs.finalVideo)
          : "",
      };
    }

    function renderOverview() {
      const run = state.currentRun;
      if (!run) {
        appEl.innerHTML = empty("还没有当前结果。先在右侧输入故事并执行一条链路。");
        return;
      }

      const { adaptation, shots, outputVideo } = getRunData();
      const stageNames = ["adaptation", "characters", "role_reference", "storyboard", "images_audio", "final"];
      const completedStages = new Set((run.manifest?.stages || []).map((item) => item.stage));
      const stageBoxes = [
        ["剧本", "adaptation", run.modelMatrix?.primary?.adaptation || run.modelMatrix?.primary?.text],
        ["角色", "characters", run.modelMatrix?.primary?.characters || run.modelMatrix?.primary?.text],
        ["角色首图", "role_reference", run.modelMatrix?.primary?.roleImage || run.modelMatrix?.primary?.image],
        ["分镜", "storyboard", run.modelMatrix?.primary?.storyboard || run.modelMatrix?.primary?.text],
        ["镜头图/配音", "storyboard", run.modelMatrix?.primary?.shotImage || run.modelMatrix?.primary?.image],
        ["输出合成", "final", "静态合成，视频模型未接通"],
      ].map(([label, key, model]) => {
        const ok = completedStages.has(key) || (key === "final" && run.manifest?.completedAt);
        return (
          '<div class="stage-box">' +
            "<strong>" + safe(label) + "</strong>" +
            '<div class="pill-row">' + pill(ok ? "已产出" : "待完成", ok ? "good" : "warn") + "</div>" +
            '<div class="meta" style="margin-top:8px">' + safe(model || "未记录") + "</div>" +
          "</div>"
        );
      }).join("");

      const duration = shots.reduce((sum, shot) => sum + Number(shot.durationSec || 0), 0);

      appEl.innerHTML =
        '<div class="hero-grid">' +
          '<div class="card">' +
            "<h2>当前输出</h2>" +
            '<div class="body">这里显示的是静态镜头合成结果，只用来核对文本、角色、分镜、画面和配音有没有串起来。项目还没完成，因为视频模型还没接通。</div>' +
            '<div style="margin-top:14px">' +
              (outputVideo ? '<video controls src="' + outputVideo + '"></video>' : empty("当前运行还没有可播放输出。")) +
            "</div>" +
          "</div>" +
          '<div class="card stack">' +
            "<div>" +
              "<h2>本次运行</h2>" +
              '<div class="pill-row">' +
                pill(run.runId, "good") +
                pill(run.isComplete ? "已完成" : "运行中", run.isComplete ? "good" : "warn") +
                pill(run.manifest?.renderStrategy?.mode || "legacy") +
              "</div>" +
            "</div>" +
            '<div class="body">' + safe(adaptation?.logline || adaptation?.theme || "当前还没有可展示的剧情摘要。") + "</div>" +
            '<div class="stack">' +
              '<div class="meta">镜头数：' + shots.length + "</div>" +
              '<div class="meta">输出时长：' + duration + "s</div>" +
              '<div class="meta">说明：' + safe(run.manifest?.renderStrategy?.note || "") + "</div>" +
              '<div class="meta">状态：视频模型未接通，当前不是成片。</div>' +
            "</div>" +
          "</div>" +
        "</div>" +
        '<div class="card">' +
          "<h2>核心流程</h2>" +
          '<div class="body">只保留最小产品闭环，不再堆和当前能力无关的入口。</div>' +
          '<div class="stage-grid" style="margin-top:14px">' + stageBoxes + "</div>" +
        "</div>";
    }

    function renderScript() {
      const run = state.currentRun;
      if (!run) {
        appEl.innerHTML = empty("没有选中运行。");
        return;
      }
      const { adaptation, storyText } = getRunData();
      const scenes = (adaptation?.scenes || []).map((scene) => (
        '<div class="mini-card">' +
          "<strong>" + safe(scene.title || scene.scene_id) + "</strong>" +
          '<div class="meta">地点：' + safe(scene.location || "未填") + "</div>" +
          '<div class="meta">目标：' + safe(scene.objective || "未填") + "</div>" +
          '<div class="meta">冲突：' + safe(scene.conflict || "未填") + "</div>" +
          '<div class="meta">转折：' + safe(scene.turning_point || "未填") + "</div>" +
        "</div>"
      )).join("");

      appEl.innerHTML =
        '<div class="split">' +
          '<div class="card">' +
            "<h2>输入故事</h2>" +
            '<div class="text-block">' + safe(storyText || "暂无输入故事。") + "</div>" +
          "</div>" +
          '<div class="card">' +
            "<h2>剧本改编结果</h2>" +
            '<div class="body">' + safe(adaptation?.logline || "暂无改编结果。") + "</div>" +
            '<div class="stage-list" style="margin-top:14px">' + (scenes || empty("暂无场景结构。")) + "</div>" +
          "</div>" +
        "</div>";
    }

    function renderCharacters() {
      const run = state.currentRun;
      if (!run) {
        appEl.innerHTML = empty("没有选中运行。");
        return;
      }
      const { characters, roleReferences } = getRunData();
      const characterCards = characters.map((item) => {
        const reference = roleReferences.find((entry) => entry.name === item.name);
        const image = reference ? artifactUrl(run.runId, "04-role-reference/" + reference.imagePath) : "";
        return (
          '<div class="mini-card">' +
            (image ? '<img src="' + image + '" alt="' + safe(item.name) + '">' : "") +
            "<strong>" + safe(item.name) + "</strong>" +
            '<div class="meta">角色：' + safe(item.role || "未填") + "</div>" +
            '<div class="meta">性格：' + safe((item.personality || []).join("、") || "未填") + "</div>" +
            '<div class="meta">音色建议：' + safe(item.voice_style || "未填") + "</div>" +
            '<div class="body" style="margin-top:8px">' + safe(item.continuity_prompt || item.appearance || "") + "</div>" +
          "</div>"
        );
      }).join("");

      appEl.innerHTML =
        '<div class="card">' +
          "<h2>角色与角色首图</h2>" +
          '<div class="body">这个页面只回答两个问题：角色定义是否清楚，角色参考图是否已经出来。</div>' +
          '<div class="asset-grid" style="margin-top:14px">' + (characterCards || empty("暂无角色结果。")) + "</div>" +
        "</div>";
    }

    function renderStoryboard() {
      const run = state.currentRun;
      if (!run) {
        appEl.innerHTML = empty("没有选中运行。");
        return;
      }
      const { storyboard, shots } = getRunData();
      const shotCards = shots.map((shot, index) => {
        const shotData = storyboard?.shots?.[index] || {};
        return (
          '<div class="mini-card shot-card">' +
            '<img src="' + artifactUrl(run.runId, shot.imagePath) + '" alt="' + safe(shot.shotId) + '">' +
            "<strong>" + safe(shot.shotId) + "</strong>" +
            '<div class="meta">说话人：' + safe(shot.speaker) + "</div>" +
            '<div class="meta">时长：' + safe(shot.durationSec + "s") + "</div>" +
            '<div class="body" style="margin-top:8px">' + safe(shotData.subtitle || shotData.line || "") + "</div>" +
            '<audio controls src="' + artifactUrl(run.runId, shot.audioPath) + '"></audio>' +
          "</div>"
        );
      }).join("");

      appEl.innerHTML =
        '<div class="split">' +
          '<div class="card">' +
            "<h2>镜头卡片</h2>" +
            '<div class="shot-grid" style="margin-top:14px">' + (shotCards || empty("暂无镜头结果。")) + "</div>" +
          "</div>" +
          '<div class="card">' +
            "<h2>分镜结构</h2>" +
            '<div class="stage-list">' +
              ((storyboard?.shots || []).map((item) => (
                '<div class="mini-card">' +
                  "<strong>" + safe(item.shot_id || item.title) + "</strong>" +
                  '<div class="meta">镜头：' + safe(item.camera || "未填") + "</div>" +
                  '<div class="meta">焦点：' + safe(item.visual_focus || "未填") + "</div>" +
                  '<div class="body" style="margin-top:8px">' + safe(item.image_prompt || "未填") + "</div>" +
                "</div>"
              )).join("") || empty("暂无分镜数据。")) +
            "</div>" +
          "</div>" +
        "</div>";
    }

    function renderOutput() {
      const run = state.currentRun;
      if (!run) {
        appEl.innerHTML = empty("没有选中运行。");
        return;
      }
      const { outputVideo, subtitles } = getRunData();
      appEl.innerHTML =
        '<div class="split">' +
          '<div class="card">' +
            "<h2>当前输出（静态合成）</h2>" +
            '<div class="body">这里只展示目前真实能跑出来的结果。视频模型未接通，所以这里不是成片。</div>' +
            '<div style="margin-top:14px">' +
            (outputVideo ? '<video controls src="' + outputVideo + '"></video>' : empty("当前还没有可播放输出。")) +
            "</div>" +
          "</div>" +
          '<div class="card">' +
            "<h2>字幕与状态说明</h2>" +
            '<div class="text-block">' + safe(subtitles || "暂无字幕。") + "</div>" +
          "</div>" +
        "</div>";
    }

    function renderCenter() {
      const map = {
        overview: renderOverview,
        script: renderScript,
        characters: renderCharacters,
        storyboard: renderStoryboard,
        output: renderOutput,
      };
      const renderFn = map[state.currentTab] || renderOverview;
      renderFn();
    }

    function render() {
      renderTabs();
      renderStatusPanel();
      renderCenter();
    }

    function setSelectOptions(selectEl, values, currentValue) {
      selectEl.innerHTML = values.map((value) => {
        const selected = value === currentValue ? " selected" : "";
        return '<option value="' + safe(value) + '"' + selected + ">" + safe(value) + "</option>";
      }).join("");
    }

    function fillFormFromConfig(configData) {
      document.getElementById("storyInput").value = configData.storyText || "";
      setSelectOptions(modelFields.adaptation, configData.modelOptions.text, configData.defaults.adaptation);
      setSelectOptions(modelFields.characters, configData.modelOptions.text, configData.defaults.characters);
      setSelectOptions(modelFields.storyboard, configData.modelOptions.text, configData.defaults.storyboard);
      setSelectOptions(modelFields.roleImage, configData.modelOptions.image, configData.defaults.roleImage);
      setSelectOptions(modelFields.shotImage, configData.modelOptions.image, configData.defaults.shotImage);
    }

    async function executeRun() {
      const payload = {
        storyText: document.getElementById("storyInput").value.trim(),
        models: {
          adaptation: modelFields.adaptation.value,
          characters: modelFields.characters.value,
          storyboard: modelFields.storyboard.value,
          roleImage: modelFields.roleImage.value,
          shotImage: modelFields.shotImage.value,
        },
      };

      if (!payload.storyText) {
        runMessageEl.textContent = "请先输入故事文本。";
        return;
      }

      runMessageEl.textContent = "正在启动一条新链路…";
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        runMessageEl.textContent = data.message || "启动失败。";
        return;
      }
      runMessageEl.textContent = "已启动 run " + data.runId + "。视频模型还没接通，所以这次只会生成前置链路结果。";
      await loadRuns();
      await loadRun(data.runId);
    }

    async function resetWorkspace() {
      const yes = window.confirm("这会删除当前所有输出和生成过的故事输入。确定继续吗？");
      if (!yes) {
        return;
      }
      runMessageEl.textContent = "正在清空旧结果…";
      const res = await fetch("/api/reset", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        runMessageEl.textContent = data.message || "清空失败。";
        return;
      }
      state.runs = [];
      state.currentRunId = null;
      state.currentRun = null;
      runMessageEl.textContent = "旧结果已清空。现在可以从空状态重新走一遍流程。";
      render();
    }

    async function loadConfig() {
      const res = await fetch("/api/config");
      state.config = await res.json();
      fillFormFromConfig(state.config);
    }

    async function loadRuns() {
      const res = await fetch("/api/runs");
      state.runs = await res.json();
      state.currentRunId = state.runs[0] ? state.runs[0].runId : null;
    }

    async function loadRun(runId) {
      state.currentRunId = runId;
      const res = await fetch("/api/runs/" + encodeURIComponent(runId));
      state.currentRun = await res.json();
      render();
    }

    (async () => {
      await loadConfig();
      await loadRuns();
      if (state.currentRunId) {
        await loadRun(state.currentRunId);
      } else {
        render();
      }
    })();
  </script>
</body>
</html>`;
}

async function listRuns() {
  try {
    const entries = await fs.readdir(config.outputRoot, { withFileTypes: true });
    const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    const runs = [];
    for (const runId of dirs) {
      const manifestPath = path.join(config.outputRoot, runId, "manifest.json");
      try {
        const manifest = await readJson(manifestPath);
        runs.push({
          runId,
          startedAt: manifest.startedAt || null,
          completedAt: manifest.completedAt || null,
          isComplete: Boolean(manifest.completedAt && (manifest.outputs?.outputVideo || manifest.outputs?.previewVideo || manifest.outputs?.finalVideo)),
          statusText: manifest.completedAt ? "已完成" : "运行中",
        });
      } catch {
        runs.push({
          runId,
          startedAt: null,
          completedAt: null,
          isComplete: false,
          statusText: "运行中",
        });
      }
    }

    for (const job of runningJobs.values()) {
      if (!runs.find((item) => item.runId === job.runId)) {
        runs.push({
          runId: job.runId,
          startedAt: job.startedAt,
          completedAt: null,
          isComplete: false,
          statusText: "运行中",
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
  const modelMatrix = await readOptionalJson(path.join(runDir, "model-matrix.json"));
  const storyText = await readOptionalText(path.join(runDir, "01-input", "story.txt"));
  const adaptation = await readOptionalJson(path.join(runDir, "02-adaptation", "adaptation.json"));
  const characters = await readOptionalJson(path.join(runDir, "03-characters", "characters.json"));

  const storyboard = (await readOptionalJson(path.join(runDir, "05-storyboard", "storyboard.json")))
    || (await readOptionalJson(path.join(runDir, "04-storyboard", "storyboard.json")));
  const subtitles = (await readOptionalText(path.join(runDir, "08-subtitles", "subtitles.srt")))
    || (await readOptionalText(path.join(runDir, "07-subtitles", "subtitles.srt")));

  if (!manifest.renderStrategy) {
    manifest.renderStrategy = {
      mode: "legacy",
      note: "这是旧版运行结果，属于静态镜头合成，不是真正的视频模型输出。",
      plannedVideoModel: modelMatrix?.primary?.shotVideo || "未配置",
    };
  }

  return {
    runId,
    manifest,
    modelMatrix: modelMatrix || {
      primary: {},
      recommendations: config.strategy.recommendations,
    },
    artifacts: {
      storyText,
      adaptation,
      characters,
      storyboard,
      subtitles,
    },
  };
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

async function startRun({ storyText, models }) {
  const runId = makeRunId();
  const storyDir = path.join(config.workspaceRoot, "input", "generated");
  await ensureDir(storyDir);
  const storyPath = path.join(storyDir, `${runId}.txt`);
  await writeText(storyPath, `${storyText.trim()}\n`);

  const child = spawn(
    process.execPath,
    ["src/index.js", "--story", storyPath, "--run-id", runId],
    {
      cwd: config.workspaceRoot,
      env: {
        ...process.env,
        RUN_ID: runId,
        QINIU_ADAPTATION_MODEL: models.adaptation,
        QINIU_CHARACTER_MODEL: models.characters,
        QINIU_STORYBOARD_MODEL: models.storyboard,
        QINIU_ROLE_IMAGE_MODEL: models.roleImage,
        QINIU_SHOT_IMAGE_MODEL: models.shotImage,
      },
      stdio: "ignore",
      detached: true,
    },
  );
  child.unref();

  runningJobs.set(runId, {
    runId,
    pid: child.pid,
    startedAt: new Date().toISOString(),
  });

  const cleanup = () => runningJobs.delete(runId);
  child.on("exit", cleanup);
  child.on("error", cleanup);

  return { runId, storyPath };
}

async function resetWorkspace() {
  await fs.rm(config.outputRoot, { recursive: true, force: true });
  await fs.rm(path.join(config.workspaceRoot, "input", "generated"), { recursive: true, force: true });
  await ensureDir(config.outputRoot);
  await ensureDir(path.join(config.workspaceRoot, "input", "generated"));
  runningJobs.clear();
}

function sendJson(res, payload, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
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

  if (requestUrl.pathname === "/api/config" && req.method === "GET") {
    sendJson(res, {
      storyText: await readOptionalText(config.inputStoryPath),
      defaults: {
        adaptation: config.qiniu.models.adaptation,
        characters: config.qiniu.models.characters,
        storyboard: config.qiniu.models.storyboard,
        roleImage: config.qiniu.models.roleImage,
        shotImage: config.qiniu.models.shotImage,
        shotVideo: config.qiniu.models.shotVideo,
      },
      modelOptions,
    });
    return;
  }

  if (requestUrl.pathname === "/api/run" && req.method === "POST") {
    try {
      const body = await readRequestBody(req);
      const storyText = String(body.storyText || "").trim();
      if (!storyText) {
        sendJson(res, { message: "缺少故事文本。" }, 400);
        return;
      }
      const models = body.models || {};
      const result = await startRun({
        storyText,
        models: {
          adaptation: models.adaptation || config.qiniu.models.adaptation,
          characters: models.characters || config.qiniu.models.characters,
          storyboard: models.storyboard || config.qiniu.models.storyboard,
          roleImage: models.roleImage || config.qiniu.models.roleImage,
          shotImage: models.shotImage || config.qiniu.models.shotImage,
        },
      });
      sendJson(res, result, 201);
    } catch (error) {
      sendJson(res, { message: error.message }, 500);
    }
    return;
  }

  if (requestUrl.pathname === "/api/reset" && req.method === "POST") {
    try {
      await resetWorkspace();
      sendJson(res, { ok: true });
    } catch (error) {
      sendJson(res, { message: error.message }, 500);
    }
    return;
  }

  if (requestUrl.pathname === "/api/runs" && req.method === "GET") {
    sendJson(res, await listRuns());
    return;
  }

  if (requestUrl.pathname.startsWith("/api/runs/") && req.method === "GET") {
    const runId = decodeURIComponent(requestUrl.pathname.replace("/api/runs/", ""));
    try {
      sendJson(res, await loadRun(runId));
    } catch (error) {
      sendJson(res, { message: error.message }, 404);
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
  console.log(`AI 真人剧执行台已启动: http://localhost:${config.workbenchPort}`);
});
