"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { MediaWorkbenchPanel } from "./MediaWorkbenchPanel.js";
import { getVoiceCatalog } from "../voice-catalog.js";

const tabs = [
  { id: "script", label: "剧本", stage: "adaptation" },
  { id: "characters", label: "主体", stage: "characters" },
  { id: "storyboard", label: "分镜", stage: "storyboard" },
  { id: "media", label: "故事板", stage: "media" },
  { id: "output", label: "成片", stage: "output" },
];

const subjectKinds = [
  { id: "character", label: "角色", key: "characters" },
  { id: "scene", label: "场景", key: "scenes" },
  { id: "prop", label: "道具", key: "props" },
];

const ratioOptions = [
  { value: "16:9", icon: "wide" },
  { value: "9:16", icon: "vertical" },
  { value: "4:3", icon: "classic" },
  { value: "3:4", icon: "poster" },
];
const styleOptions = ["写实", "写实电影", "都市职场", "冷灰质感", "高压夜战"];
const voiceOptions = getVoiceCatalog();

const emptyStoryboardDraft = {
  style_guide: {},
  groups: [],
  shots: [],
};

const stageDeps = {
  adaptation: [],
  characters: ["adaptation"],
  storyboard: ["characters"],
  media: ["storyboard"],
  output: ["media"],
  video: ["media"],
};

function stageStatusText(status) {
  return {
    idle: "未开始",
    ready: "可执行",
    queued: "排队中",
    running: "生成中",
    done: "已完成",
    stale: "待更新",
    error: "失败",
    blocked: "待接入",
  }[status] || "未开始";
}

function canRunStage(project, stage, storyText) {
  if (stage === "adaptation") {
    return Boolean(storyText.trim());
  }
  return (stageDeps[stage] || []).every((dependency) => project?.stageState?.[dependency]?.status === "done");
}

function findCurrentReference(items = []) {
  return items.find((item) => item?.isCurrent) || items[0] || null;
}

function nextTabFromProject(project) {
  if (!project) {
    return "script";
  }
  if (project.stageState.adaptation.status !== "done") {
    return "script";
  }
  if (project.stageState.storyboard.status !== "done") {
    return "characters";
  }
  if (project.stageState.media.status !== "done") {
    return "storyboard";
  }
  if (project.stageState.output.status !== "done" && project.stageState.video.status !== "done") {
    return "media";
  }
  return "output";
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (!/[",\n]/.test(text)) {
    return text;
  }
  return `"${text.replaceAll("\"", "\"\"")}"`;
}

function parseCsv(text) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        current += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(current);
      current = "";
      if (row.some((item) => item !== "")) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    current += char;
  }

  row.push(current);
  if (row.some((item) => item !== "")) {
    rows.push(row);
  }
  return rows;
}

function createEmptyStoryboardItem(groupIndex, itemIndex) {
  const shotNo = `${groupIndex + 1}-${itemIndex + 1}`;
  return {
    item_id: shotNo,
    shot_no: shotNo,
    scene_name: "",
    shot_size: "",
    composition: "",
    camera_move: "",
    lighting: "",
    shot_description: "",
    sound_fx: "",
    dialogue: "",
    duration_sec: 4,
    speaker: "",
    subject_refs: [],
    image_prompt: "",
    video_prompt: "",
    negative_prompt: "",
  };
}

function normalizeImportedStoryboard(payload) {
  const groups = Array.isArray(payload?.groups) ? payload.groups : [];
  const normalizedGroups = groups.map((group, groupIndex) => {
    const items = Array.isArray(group?.items) && group.items.length
      ? group.items.map((item, itemIndex) => ({
          ...createEmptyStoryboardItem(groupIndex, itemIndex),
          ...item,
          item_id: item?.item_id || item?.shot_no || `${groupIndex + 1}-${itemIndex + 1}`,
          shot_no: item?.shot_no || item?.item_id || `${groupIndex + 1}-${itemIndex + 1}`,
          duration_sec: Number(item?.duration_sec || 4),
        }))
      : [createEmptyStoryboardItem(groupIndex, 0)];

    return {
      group_id: group?.group_id || `group_${groupIndex + 1}`,
      title: group?.title || `镜头${groupIndex + 1}`,
      source_text: group?.source_text || "",
      order_index: Number(group?.order_index ?? groupIndex),
      collapsed: Boolean(group?.collapsed),
      items,
    };
  });

  return {
    style_guide: payload?.style_guide || {},
    groups: normalizedGroups,
    shots: normalizedGroups.flatMap((group) =>
      group.items.map((item) => ({
        shot_id: item.item_id,
        scene_id: group.group_id,
        title: group.title,
        camera: item.camera_move,
        visual_focus: item.shot_description,
        transition: "",
        speaker: item.speaker || "旁白",
        subject_refs: item.subject_refs || [],
        line: item.dialogue || "",
        subtitle: item.dialogue || "",
        duration_sec: Number(item.duration_sec || 4),
        image_prompt: item.image_prompt || item.shot_description || "",
        video_prompt: item.video_prompt || item.shot_description || "",
        negative_prompt: item.negative_prompt || "",
      })),
    ),
  };
}

function buildStoryboardRows(storyboard) {
  const groups = storyboard?.groups || [];
  return groups.flatMap((group, groupIndex) =>
    (group.items || []).map((item, itemIndex) => ({
      group_title: group.title || `镜头${groupIndex + 1}`,
      source_text: group.source_text || "",
      shot_no: item.shot_no || `${groupIndex + 1}-${itemIndex + 1}`,
      scene_name: item.scene_name || "",
      shot_size: item.shot_size || "",
      composition: item.composition || "",
      camera_move: item.camera_move || "",
      lighting: item.lighting || "",
      shot_description: item.shot_description || "",
      sound_fx: item.sound_fx || "",
      dialogue: item.dialogue || "",
      speaker: item.speaker || "",
      subject_refs: (item.subject_refs || []).map((ref) => `${ref.kind}:${ref.key}`).join(" | "),
      duration_sec: item.duration_sec || 4,
      image_prompt: item.image_prompt || "",
      video_prompt: item.video_prompt || "",
      negative_prompt: item.negative_prompt || "",
    })),
  );
}

function serializeStoryboardCsv(storyboard) {
  const headers = [
    ["镜头组", "group_title"],
    ["剧情原句", "source_text"],
    ["分镜号", "shot_no"],
    ["场景", "scene_name"],
    ["景别", "shot_size"],
    ["构图", "composition"],
    ["运镜", "camera_move"],
    ["光影", "lighting"],
    ["分镜描述", "shot_description"],
    ["音效", "sound_fx"],
    ["对白", "dialogue"],
    ["说话人", "speaker"],
    ["关联主体", "subject_refs"],
    ["时长", "duration_sec"],
    ["静帧提示词", "image_prompt"],
    ["视频提示词", "video_prompt"],
    ["负向提示词", "negative_prompt"],
  ];

  const lines = [
    headers.map(([label]) => csvEscape(label)).join(","),
    ...buildStoryboardRows(storyboard).map((row) =>
      headers.map(([, key]) => csvEscape(row[key])).join(","),
    ),
  ];
  return "\uFEFF" + lines.join("\n");
}

function storyboardFromCsv(text) {
  const rows = parseCsv(text.trim());
  if (rows.length < 2) {
    throw new Error("导入文件为空");
  }

  const headerMap = {
    镜头组: "group_title",
    剧情原句: "source_text",
    分镜号: "shot_no",
    场景: "scene_name",
    景别: "shot_size",
    构图: "composition",
    运镜: "camera_move",
    光影: "lighting",
    分镜描述: "shot_description",
    音效: "sound_fx",
    对白: "dialogue",
    说话人: "speaker",
    关联主体: "subject_refs",
    时长: "duration_sec",
    静帧提示词: "image_prompt",
    视频提示词: "video_prompt",
    负向提示词: "negative_prompt",
  };

  const headers = rows[0].map((item) => headerMap[item.trim()] || item.trim());
  const groupMap = new Map();

  for (const row of rows.slice(1)) {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = row[index] || "";
    });

    const groupTitle = record.group_title || `镜头${groupMap.size + 1}`;
    const groupKey = `${groupTitle}__${record.source_text || ""}`;
    if (!groupMap.has(groupKey)) {
      groupMap.set(groupKey, {
        group_id: `group_${groupMap.size + 1}`,
        title: groupTitle,
        source_text: record.source_text || "",
        order_index: groupMap.size,
        collapsed: false,
        items: [],
      });
    }

    const group = groupMap.get(groupKey);
    group.items.push({
      item_id: record.shot_no || `${groupMap.size}-${group.items.length + 1}`,
      shot_no: record.shot_no || `${groupMap.size}-${group.items.length + 1}`,
      scene_name: record.scene_name || "",
      shot_size: record.shot_size || "",
      composition: record.composition || "",
      camera_move: record.camera_move || "",
      lighting: record.lighting || "",
      shot_description: record.shot_description || "",
      sound_fx: record.sound_fx || "",
      dialogue: record.dialogue || "",
      speaker: record.speaker || "",
      subject_refs: String(record.subject_refs || "")
        .split("|")
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => {
          const [kind, ...rest] = item.split(":");
          return { kind: (kind || "").trim(), key: rest.join(":").trim() };
        })
        .filter((item) => item.kind && item.key),
      duration_sec: Number(record.duration_sec || 4),
      image_prompt: record.image_prompt || "",
      video_prompt: record.video_prompt || "",
      negative_prompt: record.negative_prompt || "",
    });
  }

  return normalizeImportedStoryboard({ groups: [...groupMap.values()] });
}

function StatusDot({ status }) {
  return <span className={`studio-status-dot ${status || "idle"}`} />;
}

function uniqueStrings(items = []) {
  return [...new Set(items.filter((item) => typeof item === "string" && item.trim()))];
}

function buildModelOptions(modelCatalog) {
  const byCapability = (capability) => {
    const items = modelCatalog
      .filter((item) => item.capabilities?.includes(capability))
      .map((item) => item.modelId);
    return uniqueStrings(items);
  };

  if (!modelCatalog?.length) {
    return {
      adaptation: [],
      characters: [],
      storyboard: [],
      roleImage: [],
      shotImage: [],
      shotVideo: [],
    };
  }

  return {
    adaptation: byCapability("script"),
    characters: byCapability("subject_analysis"),
    storyboard: byCapability("storyboard"),
    roleImage: byCapability("subject_reference"),
    shotImage: byCapability("shot_image"),
    shotVideo: byCapability("video_generation"),
  };
}

function requiredModelsForStage(stage) {
  return {
    adaptation: ["adaptation", "characters"],
    characters: ["characters"],
    storyboard: ["storyboard"],
    media: ["shotImage"],
    output: [],
    video: ["shotVideo"],
  }[stage] || [];
}

function stageModelLabel(key) {
  return {
    adaptation: "剧本模型",
    characters: "主体分析模型",
    storyboard: "分镜模型",
    roleImage: "角色参考图模型",
    shotImage: "镜头图片模型",
    shotVideo: "视频模型",
  }[key] || key;
}

function findMissingStageModels(stage, models) {
  return requiredModelsForStage(stage).filter((key) => !String(models?.[key] || "").trim());
}

function RatioPreview({ icon }) {
  return (
    <span className={`studio-ratio-icon ${icon}`}>
      <span />
    </span>
  );
}

function EmptyCard({ title, detail }) {
  return (
    <div className="studio-placeholder-card">
      <strong>{title}</strong>
      {detail ? <span>{detail}</span> : null}
    </div>
  );
}

function ImagePreviewModal({ asset, onClose }) {
  if (!asset?.url) {
    return null;
  }
  return (
    <div className="studio-modal-backdrop studio-modal-backdrop--image" onClick={onClose}>
      <div className="studio-image-modal" onClick={(event) => event.stopPropagation()}>
        <div className="studio-panel__header">
          <h2>{asset.title || "图片预览"}</h2>
          <button className="studio-ghost" type="button" onClick={onClose}>关闭</button>
        </div>
        <img src={asset.url} alt={asset.title || "preview"} className="studio-image-modal__image" />
      </div>
    </div>
  );
}

function deriveChapterList(project) {
  const chapters = project?.artifacts?.adaptation?.chapters || [];
  if (chapters.length) {
    return chapters.map((chapter, index) => ({
      key: chapter.chapter_id || `chapter_${index + 1}`,
      title: chapter.title || `第${index + 1}章`,
      detail: chapter.summary || "已整理",
    }));
  }
  const text = project?.storyText || project?.artifacts?.storyText || "";
  if (!text.trim()) {
    return [];
  }
  return [
    {
      key: "chapter_1",
      title: "第1章",
      detail: "当前剧本",
    },
  ];
}

function SideList({ tab, project }) {
  if (tab === "script") {
    const chapters = deriveChapterList(project);
    return (
      <div className="studio-side-list">
        {chapters.length
          ? chapters.map((chapter) => (
              <button key={chapter.key} type="button" className="studio-side-item">
                <strong>{chapter.title}</strong>
                <span>{chapter.detail}</span>
              </button>
            ))
          : <EmptyCard title="暂无章节" detail="先输入剧本文本" />}
      </div>
    );
  }

  if (tab === "storyboard" || tab === "media" || tab === "output") {
    const chapters = deriveChapterList(project);
    return (
      <div className="studio-side-list">
        {chapters.length
          ? chapters.map((chapter) => (
              <button key={chapter.key} type="button" className="studio-side-item">
                <strong>{chapter.title}</strong>
                <span>{chapter.detail}</span>
              </button>
            ))
          : <EmptyCard title="暂无章节" detail="先完成剧本阶段" />}
      </div>
    );
  }

  if (tab === "characters") {
    const characters = project?.artifacts?.characters?.characters || [];
    return (
      <div className="studio-side-list">
        {characters.length
          ? characters.map((item) => (
              <button key={item.name} type="button" className="studio-side-item">
                <strong>{item.name}</strong>
                <span>{item.role || "未定义"}</span>
              </button>
            ))
          : <EmptyCard title="暂无主体" detail="先生成主体" />}
      </div>
    );
  }

  const shots = project?.artifacts?.storyboard?.shots || project?.artifacts?.shots || [];
  return (
    <div className="studio-side-list">
      {shots.length
        ? shots.map((shot, index) => (
            <button key={shot.shot_id || shot.shotId || index} type="button" className="studio-side-item">
              <strong>{shot.title || shot.shot_id || shot.shotId || `镜头 ${index + 1}`}</strong>
              <span>{shot.speaker || shot.visual_focus || shot.subtitle || "未填"}</span>
            </button>
          ))
        : <EmptyCard title="暂无镜头" detail="先完成上游阶段" />}
    </div>
  );
}

function EllipsisText({ value, className = "" }) {
  return (
    <span className={className} title={value || "-"}>
      {value || "-"}
    </span>
  );
}

function ScriptSummary({ adaptation }) {
  return (
    <div className="studio-structured">
      {adaptation?.logline ? (
        <section className="studio-summary-card">
          <span className="studio-section-label">一句话梗概</span>
          <p>{adaptation.logline}</p>
        </section>
      ) : null}
      {adaptation?.style_notes?.length ? (
        <section className="studio-summary-card">
          <span className="studio-section-label">整体基调</span>
          <div className="studio-tag-list">
            {adaptation.style_notes.map((item) => <span key={item} className="studio-tag">{item}</span>)}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function StoryboardBoard({
  storyboard,
  selectedItemId,
  onImport,
  onExport,
  onSelectItem,
  onToggleGroup,
  onAddGroup,
  onAddItem,
  onDuplicateGroup,
  onDeleteGroup,
  onDuplicateItem,
  onDeleteItem,
}) {
  const groups = storyboard?.groups || [];
  return groups.length ? (
    <section className="studio-storyboard-board">
      <div className="studio-storyboard-head">
        <div>
          <h2>智能分镜</h2>
          <span>按镜头组组织分镜条目，结构更接近制作工作台。</span>
        </div>
        <div className="studio-inline-actions">
          <button type="button" onClick={onImport}>导入分镜表</button>
          <button type="button" onClick={onExport}>导出分镜表</button>
        </div>
      </div>
      {groups.map((group, groupIndex) => (
        <article key={group.group_id || groupIndex} className="studio-storyboard-group">
          <div className="studio-storyboard-group__header">
            <button type="button" className="studio-storyboard-group__toggle" onClick={() => onToggleGroup(groupIndex)}>
              <span>{group.collapsed ? "▸" : "▾"}</span>
              <strong>{group.title || `镜头${groupIndex + 1}`}</strong>
            </button>
            <p>{group.source_text || "未填写剧情原句"}</p>
            <div className="studio-inline-actions">
              <button type="button" onClick={() => onDuplicateGroup(groupIndex)}>复制组</button>
              <button type="button" onClick={() => onDeleteGroup(groupIndex)}>删除组</button>
            </div>
          </div>
          {!group.collapsed ? (
            <>
              <div className="studio-storyboard-scroll">
                <div className="studio-storyboard-table studio-storyboard-table--head">
                  <span>分镜号</span>
                  <span>场景</span>
                  <span>景别</span>
                  <span>构图</span>
                  <span>运镜</span>
                  <span>光影</span>
                  <span>分镜描述</span>
                  <span>音效</span>
                  <span>对白</span>
                  <span>时长</span>
                  <span>操作</span>
                </div>
                {(group.items || []).map((item) => (
                  <div key={item.item_id} className={item.item_id === selectedItemId ? "studio-storyboard-table active" : "studio-storyboard-table"}>
                    <button type="button" className="studio-storyboard-row__cell studio-storyboard-row__cell--index" onClick={() => onSelectItem(item.item_id)}>
                      {item.shot_no || item.item_id}
                    </button>
                    <button type="button" className="studio-storyboard-row__cell" onClick={() => onSelectItem(item.item_id)}>
                      <EllipsisText value={item.scene_name} />
                    </button>
                    <button type="button" className="studio-storyboard-row__cell" onClick={() => onSelectItem(item.item_id)}>
                      <EllipsisText value={item.shot_size} />
                    </button>
                    <button type="button" className="studio-storyboard-row__cell" onClick={() => onSelectItem(item.item_id)}>
                      <EllipsisText value={item.composition} />
                    </button>
                    <button type="button" className="studio-storyboard-row__cell" onClick={() => onSelectItem(item.item_id)}>
                      <EllipsisText value={item.camera_move} />
                    </button>
                    <button type="button" className="studio-storyboard-row__cell studio-storyboard-row__cell--text" onClick={() => onSelectItem(item.item_id)}>
                      <EllipsisText value={item.lighting} className="studio-storyboard-clamp studio-storyboard-clamp--2" />
                    </button>
                    <button type="button" className="studio-storyboard-row__cell studio-storyboard-row__cell--wide" onClick={() => onSelectItem(item.item_id)}>
                      <EllipsisText value={item.shot_description} className="studio-storyboard-clamp studio-storyboard-clamp--3" />
                    </button>
                    <button type="button" className="studio-storyboard-row__cell studio-storyboard-row__cell--text" onClick={() => onSelectItem(item.item_id)}>
                      <EllipsisText value={item.sound_fx} className="studio-storyboard-clamp studio-storyboard-clamp--2" />
                    </button>
                    <button type="button" className="studio-storyboard-row__cell studio-storyboard-row__cell--text" onClick={() => onSelectItem(item.item_id)}>
                      <EllipsisText value={item.dialogue} className="studio-storyboard-clamp studio-storyboard-clamp--2" />
                    </button>
                    <button type="button" className="studio-storyboard-row__cell studio-storyboard-row__cell--time" onClick={() => onSelectItem(item.item_id)}>
                      {Number(item.duration_sec || 0)}s
                    </button>
                    <div className="studio-inline-actions">
                      <button type="button" onClick={() => onDuplicateItem(group.group_id, item.item_id)}>复制</button>
                      <button type="button" onClick={() => onDeleteItem(group.group_id, item.item_id)}>删除</button>
                    </div>
                  </div>
                ))}
              </div>
              <button type="button" className="studio-storyboard-add" onClick={() => onAddItem(group.group_id)}>
                + 添加分镜
              </button>
            </>
          ) : null}
        </article>
      ))}
      <button type="button" className="studio-storyboard-add studio-storyboard-add--group" onClick={onAddGroup}>
        + 添加新镜头
      </button>
    </section>
  ) : <EmptyCard title="当前还没有分镜结果" detail="先完成主体阶段。" />;
}

function OutputPanel({ project }) {
  const finalUrl = project.artifacts?.outputVideoPublicUrl || project.artifacts?.outputVideoUrl;
  return (
    <div className="studio-output-grid studio-output-grid--single">
      <section className="studio-panel studio-main-panel studio-output-panel">
        <div className="studio-panel__header">
          <h2>最终成片</h2>
          <span className="studio-panel__meta">{stageStatusText(project.stageState?.output?.status)}</span>
        </div>
        {finalUrl ? <video controls src={finalUrl} /> : <EmptyCard title="暂无成片结果" detail="先为每个分镜准备好已选中视频，再执行成片完成。" />}
      </section>
    </div>
  );
}

function formatLogTime(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDuration(durationMs) {
  if (durationMs === undefined || durationMs === null) {
    return "";
  }
  return durationMs >= 1000 ? `${(durationMs / 1000).toFixed(2)}s` : `${durationMs}ms`;
}

function translateLogStatus(status) {
  return {
    start: "开始",
    done: "完成",
    error: "失败",
    queued: "排队中",
    running: "执行中",
    unknown: "未知",
  }[status] || status || "未知";
}

function translateLogStage(stage) {
  return {
    adaptation: "剧本",
    characters: "主体分析",
    storyboard: "分镜",
    media: "故事板",
    output: "成片",
    video: "视频",
    subject_reference: "主体参考图",
  }[stage] || stage || "";
}

function translateLogProvider(provider) {
  return {
    chat: "文本模型",
    image: "图片模型",
    video: "视频模型",
    tts: "语音合成",
    veo: "Veo",
    openai: "OpenAI",
  }[provider] || provider || "";
}

function translateLogStep(step) {
  if (!step) {
    return "执行事件";
  }
  if (step === "adaptation") return "剧本阶段";
  if (step === "adaptation_chat") return "剧本生成";
  if (step === "characters") return "主体分析阶段";
  if (step === "characters_chat") return "主体分析";
  if (step === "storyboard") return "分镜阶段";
  if (step === "storyboard_chat") return "分镜生成";
  if (step === "subject_reference:batch") return "批量生成主体参考图";
  if (step.startsWith("subject_reference:")) {
    const [, kind, name] = step.split(":");
    const kindLabel = kind === "character" ? "角色" : kind === "scene" ? "场景" : kind === "prop" ? "道具" : kind;
    return `生成${kindLabel}参考图${name ? `：${name}` : ""}`;
  }
  if (step.startsWith("shot_image:")) {
    return `生成镜头图：${step.split(":")[1] || ""}`;
  }
  if (step.startsWith("tts:")) {
    return `生成配音：${step.split(":")[1] || ""}`;
  }
  if (step.startsWith("video_task:")) {
    return `创建视频任务：${step.split(":")[1] || ""}`;
  }
  if (step.startsWith("video_poll:")) {
    return `轮询视频结果：${step.split(":")[1] || ""}`;
  }
  return step;
}

function buildDisplayLogs(logs) {
  const merged = [];

  for (const entry of logs || []) {
    const previous = merged[merged.length - 1];
    const sameExecution =
      previous &&
      previous.step === entry.step &&
      previous.status === entry.status &&
      previous.stage === entry.stage &&
      (previous.model || "") === (entry.model || "") &&
      (previous.provider || "") === (entry.provider || "") &&
      (previous.error || "") === (entry.error || "");

    if (!sameExecution) {
      merged.push({ ...entry });
      continue;
    }

    merged[merged.length - 1] = {
      ...previous,
      ...entry,
      event:
        previous.event === entry.event
          ? entry.event
          : `${previous.event || ""}+${entry.event || ""}`.replace(/^\+|\+$/g, ""),
      message: previous.message || entry.message,
      durationMs: previous.durationMs ?? entry.durationMs,
      ts: entry.ts || previous.ts,
    };
  }

  return merged;
}

function ProjectLogPanel({ logs }) {
  if (!logs?.length) {
    return (
      <section className="studio-panel studio-main-panel">
        <div className="studio-panel__header">
          <h2>执行日志</h2>
        </div>
        <EmptyCard title="暂无日志" detail="执行阶段任务或主体生图后会在这里显示链路日志。" />
      </section>
    );
  }

  const recentLogs = [...buildDisplayLogs(logs)].reverse().slice(0, 80);
  return (
    <section className="studio-panel studio-main-panel">
      <div className="studio-panel__header">
        <h2>执行日志</h2>
        <span className="studio-panel__meta">最近 {recentLogs.length} 条</span>
      </div>
      <div className="studio-log-list">
        {recentLogs.map((entry, index) => (
          <article key={`${entry.ts || "log"}-${index}`} className={`studio-log-item ${entry.status || "unknown"}`}>
            <div className="studio-log-item__top">
              <strong>{translateLogStep(entry.step || entry.event || "event")}</strong>
              <span>{translateLogStatus(entry.status || "unknown")}</span>
            </div>
            <div className="studio-log-item__meta">
              <span>{formatLogTime(entry.ts)}</span>
              {entry.stage ? <span>阶段：{translateLogStage(entry.stage)}</span> : null}
              {entry.model ? <span>模型：{entry.model}</span> : null}
              {entry.provider ? <span>类型：{translateLogProvider(entry.provider)}</span> : null}
              {entry.durationMs !== undefined ? <span>耗时：{formatDuration(entry.durationMs)}</span> : null}
            </div>
            {entry.message ? <p>{entry.message}</p> : null}
            {entry.error ? <p className="studio-log-item__error">{entry.error}</p> : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function SubjectTypeTabs({ payload, kind, onChange }) {
  return (
    <div className="studio-subject-tabs">
      {subjectKinds.map((item) => (
        <button
          key={item.id}
          type="button"
          className={item.id === kind ? "studio-subject-tab active" : "studio-subject-tab"}
          onClick={() => onChange(item.id)}
        >
          {item.label}
          <span>{payload?.[item.key]?.length || 0}</span>
        </button>
      ))}
    </div>
  );
}

function subjectDescription(item, kind) {
  if (!item) {
    return "";
  }
  if (item.full_description) {
    return item.full_description;
  }
  if (kind === "character") {
    return item.continuity_prompt || item.appearance || "";
  }
  return item.continuity_prompt || item.description || "";
}

function subjectSubtitle(item, kind) {
  if (kind === "character") {
    return item.role || "未设定角色定位";
  }
  if (kind === "scene") {
    return item.location || "未设定场景地点";
  }
  return item.description || "未设定道具描述";
}

function SubjectGrid({
  items,
  references,
  kind,
  selectedKey,
  onSelect,
  onPreview,
  onCreate,
  onDuplicate,
  onDelete,
  onMove,
}) {
  return (
    <section className="studio-subject-grid">
      {items.map((item, index) => {
        const ref = references.find((candidate) => candidate.key === item.name);
        const active = selectedKey === item.name;
        return (
          <article key={`${item.name}-${index}`} className={active ? "studio-subject-card active" : "studio-subject-card"}>
            <button type="button" className="studio-subject-card__select" onClick={() => onSelect(item.name)}>
              <div className="studio-subject-card__media">
                {ref?.url ? (
                  <>
                    <img src={ref.url} alt={item.name} />
                  </>
                ) : <div className="studio-subject-card__placeholder">{kind === "character" ? "角色" : kind === "scene" ? "场景" : "道具"}</div>}
              </div>
              <div className="studio-subject-card__body">
                <strong>{item.name}</strong>
                <span>{subjectSubtitle(item, kind)}</span>
              </div>
            </button>
            <div className="studio-inline-actions">
              <button type="button" onClick={() => onSelect(item.name)}>聚焦</button>
              <button type="button" onClick={() => onPreview(ref, item.name)} disabled={!ref?.url}>看图</button>
              <button type="button" onClick={() => onMove(index, -1)} disabled={index === 0}>上移</button>
              <button type="button" onClick={() => onMove(index, 1)} disabled={index === items.length - 1}>下移</button>
              <button type="button" onClick={() => onDuplicate(index)}>复制</button>
              <button type="button" onClick={() => onDelete(index)}>删除</button>
            </div>
          </article>
        );
      })}
      <button type="button" className="studio-subject-card studio-subject-card--create" onClick={onCreate}>
        <div className="studio-subject-card__placeholder">+</div>
        <strong>{kind === "character" ? "新增角色" : kind === "scene" ? "新增场景" : "新增道具"}</strong>
      </button>
    </section>
  );
}

function StructuredScriptModal({ value, onChange, onSave, onClose, isPending }) {
  function updateScene(index, key, fieldValue) {
    onChange((current) => {
      const next = deepClone(current);
      next.scenes[index][key] = fieldValue;
      return next;
    });
  }

  function moveScene(index, offset) {
    onChange((current) => {
      const next = deepClone(current);
      const target = index + offset;
      if (target < 0 || target >= next.scenes.length) {
        return next;
      }
      const [item] = next.scenes.splice(index, 1);
      next.scenes.splice(target, 0, item);
      return next;
    });
  }

  function addScene() {
    onChange((current) => {
      const next = deepClone(current);
      const count = next.scenes?.length || 0;
      next.scenes = [
        ...(next.scenes || []),
        {
          scene_id: `scene_${count + 1}`,
          title: `新场景${count + 1}`,
          location: "",
          time_of_day: "",
          objective: "",
          conflict: "",
          turning_point: "",
        },
      ];
      return next;
    });
  }

  function removeScene(index) {
    onChange((current) => {
      const next = deepClone(current);
      next.scenes.splice(index, 1);
      return next;
    });
  }

  return (
    <div className="studio-modal-backdrop">
      <div className="studio-modal">
        <div className="studio-panel__header">
          <h2>剧本结构编辑</h2>
          <button className="studio-ghost" type="button" onClick={onClose}>关闭</button>
        </div>
        <label className="studio-field">
          <span>一句话梗概</span>
          <textarea className="studio-textarea-small" value={value.logline || ""} onChange={(event) => onChange((current) => ({ ...current, logline: event.target.value }))} />
        </label>
        <div className="studio-modal-list">
          {(value.scenes || []).map((scene, index) => (
            <div key={scene.scene_id || index} className="studio-modal-card">
              <div className="studio-panel__header">
                <strong>{scene.title || `场景 ${index + 1}`}</strong>
                <div className="studio-inline-actions">
                  <button type="button" onClick={() => moveScene(index, -1)} disabled={index === 0}>上移</button>
                  <button type="button" onClick={() => moveScene(index, 1)} disabled={index === value.scenes.length - 1}>下移</button>
                  <button type="button" onClick={() => removeScene(index)}>删除</button>
                </div>
              </div>
              <label className="studio-field"><span>标题</span><input value={scene.title || ""} onChange={(event) => updateScene(index, "title", event.target.value)} /></label>
              <label className="studio-field"><span>地点</span><input value={scene.location || ""} onChange={(event) => updateScene(index, "location", event.target.value)} /></label>
              <label className="studio-field"><span>推进目标</span><textarea className="studio-textarea-small" value={scene.objective || ""} onChange={(event) => updateScene(index, "objective", event.target.value)} /></label>
              <label className="studio-field"><span>冲突</span><textarea className="studio-textarea-small" value={scene.conflict || ""} onChange={(event) => updateScene(index, "conflict", event.target.value)} /></label>
              <label className="studio-field"><span>转折</span><textarea className="studio-textarea-small" value={scene.turning_point || ""} onChange={(event) => updateScene(index, "turning_point", event.target.value)} /></label>
            </div>
          ))}
        </div>
        <div className="studio-modal__actions">
          <button className="studio-secondary" type="button" onClick={addScene}>新增场景</button>
          <button className="studio-secondary" type="button" onClick={onClose}>取消</button>
          <button className="studio-primary" type="button" onClick={onSave} disabled={isPending}>保存结构</button>
        </div>
      </div>
    </div>
  );
}

function StructuredStoryboardModal({ value, onChange, onSave, onClose, isPending }) {
  function updateShot(index, key, fieldValue) {
    onChange((current) => {
      const next = deepClone(current);
      next.shots[index][key] = key === "duration_sec" ? Number(fieldValue || 0) : fieldValue;
      return next;
    });
  }

  return (
    <div className="studio-modal-backdrop">
      <div className="studio-modal">
        <div className="studio-panel__header">
          <h2>分镜结构编辑</h2>
          <button className="studio-ghost" type="button" onClick={onClose}>关闭</button>
        </div>
        <div className="studio-modal-list">
          {(value.shots || []).map((shot, index) => (
            <div key={shot.shot_id || index} className="studio-modal-card">
              <strong>{shot.title || `镜头 ${index + 1}`}</strong>
              <label className="studio-field"><span>标题</span><input value={shot.title || ""} onChange={(event) => updateShot(index, "title", event.target.value)} /></label>
              <label className="studio-field"><span>机位</span><input value={shot.camera || ""} onChange={(event) => updateShot(index, "camera", event.target.value)} /></label>
              <label className="studio-field"><span>镜头重点</span><textarea className="studio-textarea-small" value={shot.visual_focus || ""} onChange={(event) => updateShot(index, "visual_focus", event.target.value)} /></label>
              <label className="studio-field"><span>说话人</span><input value={shot.speaker || ""} onChange={(event) => updateShot(index, "speaker", event.target.value)} /></label>
              <label className="studio-field"><span>字幕</span><textarea className="studio-textarea-small" value={shot.subtitle || ""} onChange={(event) => updateShot(index, "subtitle", event.target.value)} /></label>
              <label className="studio-field"><span>时长</span><input type="number" value={shot.duration_sec || 0} onChange={(event) => updateShot(index, "duration_sec", event.target.value)} /></label>
            </div>
          ))}
        </div>
        <div className="studio-modal__actions">
          <button className="studio-secondary" type="button" onClick={onClose}>取消</button>
          <button className="studio-primary" type="button" onClick={onSave} disabled={isPending}>保存结构</button>
        </div>
      </div>
    </div>
  );
}

function buildNewSubject(kind, index) {
  if (kind === "character") {
    return {
      name: `新角色${index + 1}`,
      role: "角色定位",
      full_description: "",
      reference_prompt: "",
      continuity_prompt: "",
      appearance: "",
      voice_style: "",
      voice_profile: {
        label: "高冷御姐",
        voiceType: "qiniu_zh_female_wwxkjx",
        ageGroup: "adult",
        sceneTags: ["都市", "对白"],
        styleTags: ["高冷", "干练"],
        supportsEmotion: true,
        emotion: "",
        speedRatio: 1,
        volume: 5,
        pitch: 1,
      },
    };
  }
  if (kind === "scene") {
    return {
      name: `新场景${index + 1}`,
      location: "",
      description: "",
      full_description: "",
      reference_prompt: "",
      continuity_prompt: "",
    };
  }
  return {
    name: `新道具${index + 1}`,
    description: "",
    full_description: "",
    reference_prompt: "",
    continuity_prompt: "",
  };
}

export function ProjectWorkbench({ projectId }) {
  const [project, setProject] = useState(null);
  const [tab, setTab] = useState("script");
  const [storyText, setStoryText] = useState("");
  const [models, setModels] = useState({});
  const [modelCatalog, setModelCatalog] = useState([]);
  const [message, setMessage] = useState("");
  const [localBusyText, setLocalBusyText] = useState("");
  const [subjectKind, setSubjectKind] = useState("character");
  const [selectedSubjectKey, setSelectedSubjectKey] = useState("");
  const [previewAsset, setPreviewAsset] = useState(null);
  const [modalStage, setModalStage] = useState(null);
  const [adaptationDraft, setAdaptationDraft] = useState(null);
  const [charactersDraft, setCharactersDraft] = useState(null);
  const [storyboardDraft, setStoryboardDraft] = useState(null);
  const [selectedStoryboardItemId, setSelectedStoryboardItemId] = useState("");
  const [sideCollapsed, setSideCollapsed] = useState(true);
  const [isPending, startTransition] = useTransition();
  const bootedRef = useRef(false);
  const storyboardImportRef = useRef(null);

  function applyProjectData(data, options = {}) {
    const { preserveStoryText = false } = options;
    setProject(data);
    if (!preserveStoryText) {
      setStoryText(data.storyText || data.artifacts?.storyText || "");
    }
    setModels(data.models || {});
    setAdaptationDraft(data.artifacts?.adaptation || { scenes: [] });
    setCharactersDraft(data.artifacts?.characters || { characters: [], scenes: [], props: [] });
    setStoryboardDraft(data.artifacts?.storyboard || emptyStoryboardDraft);
  }

  async function loadProject(options = {}) {
    const { preserveTab = true } = options;
    const res = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
    const data = await res.json();
    applyProjectData(data);
    if (!bootedRef.current || !preserveTab) {
      setTab(nextTabFromProject(data));
      bootedRef.current = true;
    }
  }

  useEffect(() => {
    loadProject({ preserveTab: false });
  }, [projectId]);

  useEffect(() => {
    fetch("/api/model-catalog", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setModelCatalog(data);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!project?.currentJob || !["queued", "running"].includes(project.currentJob.status)) {
      return undefined;
    }
    const timer = setInterval(() => {
      loadProject();
    }, 2500);
    return () => clearInterval(timer);
  }, [project?.id, project?.currentJob?.id, project?.currentJob?.status]);

  const currentKindConfig = subjectKinds.find((item) => item.id === subjectKind) || subjectKinds[0];
  const modelOptions = useMemo(() => buildModelOptions(modelCatalog), [modelCatalog]);
  const subjectItems = useMemo(
    () => charactersDraft?.[currentKindConfig.key] || [],
    [charactersDraft, currentKindConfig.key],
  );

  useEffect(() => {
    if (tab !== "characters") {
      return;
    }
    if (!subjectItems.length) {
      setSelectedSubjectKey("");
      return;
    }
    if (!subjectItems.some((item) => item.name === selectedSubjectKey)) {
      setSelectedSubjectKey(subjectItems[0].name);
    }
  }, [tab, subjectItems, selectedSubjectKey]);

  const currentSubject = useMemo(
    () => subjectItems.find((item) => item.name === selectedSubjectKey) || null,
    [subjectItems, selectedSubjectKey],
  );

  const currentReferences = subjectKind === "character"
    ? project?.artifacts?.roleReferences || []
    : subjectKind === "scene"
      ? project?.artifacts?.sceneReferences || []
      : project?.artifacts?.propReferences || [];
  const currentReferenceHistory = currentSubject
    ? currentReferences.filter((item) => item.key === currentSubject.name)
    : [];
  const currentReference = findCurrentReference(currentReferenceHistory);
  const storyboardGroups = storyboardDraft?.groups || [];
  const storyboardItems = storyboardGroups.flatMap((group) => (group.items || []).map((item) => ({ ...item, group_id: group.group_id })));
  const currentStoryboardItem = storyboardItems.find((item) => item.item_id === selectedStoryboardItemId) || null;
  const mediaWorkbench = project?.artifacts?.mediaWorkbench || { shots: [] };

  useEffect(() => {
    if (tab !== "storyboard") {
      return;
    }
    if (!storyboardItems.length) {
      setSelectedStoryboardItemId("");
      return;
    }
    if (!storyboardItems.some((item) => item.item_id === selectedStoryboardItemId)) {
      setSelectedStoryboardItemId(storyboardItems[0].item_id);
    }
  }, [tab, storyboardItems, selectedStoryboardItemId]);

  function persistBase(nextMessage = "") {
    return fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storyText, models }),
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "保存失败");
      }
      applyProjectData(data, { preserveStoryText: true });
      if (nextMessage) {
        setMessage(nextMessage);
      }
      return data;
    });
  }

  async function saveArtifact(stage, artifactValue, nextMessage = "已保存") {
    const res = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artifactStage: stage, artifactValue, models }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || "保存失败");
    }
    applyProjectData(data, { preserveStoryText: true });
    setMessage(nextMessage);
    return data;
  }

  async function persistModelsOnly() {
    const res = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ models }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || "保存模型失败");
    }
    applyProjectData(data, { preserveStoryText: true });
    return data;
  }

  function runStage(stage) {
    startTransition(async () => {
      try {
        const missingModels = findMissingStageModels(stage, models);
        if (missingModels.length) {
          throw new Error(`当前阶段缺少模型配置：${missingModels.map(stageModelLabel).join("、")}`);
        }
        setLocalBusyText(stage === "adaptation" ? "正在整理剧本并分析主体" : "正在提交任务");
        await persistBase();
        const res = await fetch(`/api/projects/${projectId}/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.message || "执行失败");
        }
        applyProjectData(data, { preserveStoryText: true });
        setMessage("任务已提交");
      } catch (error) {
        setMessage(error.message);
      } finally {
        setLocalBusyText("");
      }
    });
  }

  function updateSubjectList(mutator) {
    setCharactersDraft((current) => {
      const next = deepClone(current || { characters: [], scenes: [], props: [] });
      mutator(next);
      return next;
    });
  }

  function createSubject() {
    updateSubjectList((draft) => {
      const next = buildNewSubject(subjectKind, draft[currentKindConfig.key].length);
      draft[currentKindConfig.key].push(next);
      setSelectedSubjectKey(next.name);
    });
    setMessage("已新增当前项，记得保存。");
  }

  function duplicateSubject(index) {
    updateSubjectList((draft) => {
      const current = draft[currentKindConfig.key][index];
      const clone = deepClone(current);
      clone.name = `${clone.name}-副本`;
      draft[currentKindConfig.key].splice(index + 1, 0, clone);
      setSelectedSubjectKey(clone.name);
    });
    setMessage("已复制当前项，记得保存。");
  }

  function deleteSubject(index) {
    updateSubjectList((draft) => {
      const [removed] = draft[currentKindConfig.key].splice(index, 1);
      if (removed?.name === selectedSubjectKey) {
        const next = draft[currentKindConfig.key][Math.max(0, index - 1)];
        setSelectedSubjectKey(next?.name || "");
      }
    });
    setMessage("已删除当前项，记得保存。");
  }

  function moveSubject(index, offset) {
    updateSubjectList((draft) => {
      const list = draft[currentKindConfig.key];
      const target = index + offset;
      if (target < 0 || target >= list.length) {
        return;
      }
      const [item] = list.splice(index, 1);
      list.splice(target, 0, item);
    });
    setMessage("已调整顺序，记得保存。");
  }

  function updateCurrentSubject(field, value) {
    updateSubjectList((draft) => {
      const index = draft[currentKindConfig.key].findIndex((item) => item.name === selectedSubjectKey);
      if (index === -1) {
        return;
      }
      draft[currentKindConfig.key][index][field] = value;
      if (field === "name") {
        setSelectedSubjectKey(value);
      }
    });
  }

  function appendReferenceImage(image) {
    if (!currentSubject) {
      return;
    }
    updateSubjectList((draft) => {
      const index = draft[currentKindConfig.key].findIndex((item) => item.name === selectedSubjectKey);
      if (index === -1) {
        return;
      }
      draft[currentKindConfig.key][index].reference_images = [
        ...(draft[currentKindConfig.key][index].reference_images || []),
        image,
      ];
    });
    setMessage("参考图已加入当前主体，记得保存或直接生成。");
  }

  function removeReferenceImage(imagePath) {
    updateSubjectList((draft) => {
      const index = draft[currentKindConfig.key].findIndex((item) => item.name === selectedSubjectKey);
      if (index === -1) {
        return;
      }
      draft[currentKindConfig.key][index].reference_images = (draft[currentKindConfig.key][index].reference_images || [])
        .filter((item) => item.path !== imagePath);
    });
    setMessage("已移除参考图，记得保存。");
  }

  function uploadReferenceImage(file) {
    if (!file || !currentSubject) {
      return;
    }
    startTransition(async () => {
      try {
        setLocalBusyText("正在上传参考图");
        const form = new FormData();
        form.append("file", file);
        form.append("kind", subjectKind);
        form.append("name", currentSubject.name || "subject");
        const res = await fetch(`/api/projects/${projectId}/subjects/reference-images`, {
          method: "POST",
          body: form,
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.message || "上传参考图失败");
        }
        appendReferenceImage(data);
      } catch (error) {
        setMessage(error.message || "上传失败");
      } finally {
        setLocalBusyText("");
      }
    });
  }

  function saveCurrentSubject(regenerate = false) {
    startTransition(async () => {
      try {
        setLocalBusyText(regenerate ? "正在保存并重生成当前主体" : "正在保存当前主体");
        const latestDraft = deepClone(charactersDraft);
        await persistBase();
        await saveArtifact("characters", latestDraft, regenerate ? "当前项已保存，准备重生成" : "当前项已保存");
        if (regenerate && currentSubject?.name) {
          const res = await fetch(`/api/projects/${projectId}/subjects/regenerate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: subjectKind, key: currentSubject.name }),
          });
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.message || "重生成失败");
          }
          applyProjectData(data, { preserveStoryText: true });
          setMessage("当前项已重生成");
        }
      } catch (error) {
        setMessage(error.message || "处理失败");
      } finally {
        setLocalBusyText("");
      }
    });
  }

  function renderSubjectReferences() {
    startTransition(async () => {
      try {
        setLocalBusyText("正在批量生成主体参考图");
        const latestDraft = deepClone(charactersDraft);
        await persistBase();
        await saveArtifact("characters", latestDraft, "主体分析已保存");
        const res = await fetch(`/api/projects/${projectId}/subjects/render`, {
          method: "POST",
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.message || "生成参考图失败");
        }
        applyProjectData(data, { preserveStoryText: true });
        setMessage("主体参考图已生成");
      } catch (error) {
        setMessage(error.message || "生成失败");
      } finally {
        setLocalBusyText("");
      }
    });
  }

  function openPreview(reference, defaultTitle) {
    if (!reference?.url) {
      return;
    }
    setPreviewAsset({
      url: reference.url,
      title: reference.name || defaultTitle,
    });
  }

  function setCurrentSubjectReference(reference) {
    if (!reference?.path || !currentSubject?.name) {
      return;
    }
    startTransition(async () => {
      try {
        setLocalBusyText("正在切换当前主体图");
        const res = await fetch(`/api/projects/${projectId}/subjects/current`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: subjectKind,
            key: currentSubject.name,
            path: reference.path,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.message || "切换当前主体图失败");
        }
        applyProjectData(data, { preserveStoryText: true });
        setMessage("当前主体图已切换");
      } catch (error) {
        setMessage(error.message || "切换失败");
      } finally {
        setLocalBusyText("");
      }
    });
  }

  function updateStoryboardDraftState(mutator) {
    setStoryboardDraft((current) => {
      const next = deepClone(current || { style_guide: {}, groups: [], shots: [] });
      mutator(next);
      next.shots = (next.groups || []).flatMap((group) =>
        (group.items || []).map((item) => ({
          shot_id: item.item_id,
          scene_id: group.group_id,
          title: group.title,
          camera: item.camera_move,
          visual_focus: item.shot_description,
          transition: "",
          speaker: item.speaker || "旁白",
          line: item.dialogue || "",
          subtitle: item.dialogue || "",
          duration_sec: Number(item.duration_sec || 4),
          image_prompt: item.image_prompt || item.shot_description || "",
          video_prompt: item.video_prompt || item.shot_description || "",
          negative_prompt: item.negative_prompt || "",
        })),
      );
      return next;
    });
  }

  function toggleStoryboardGroup(index) {
    updateStoryboardDraftState((draft) => {
      draft.groups[index].collapsed = !draft.groups[index].collapsed;
    });
  }

  function addStoryboardGroup() {
    updateStoryboardDraftState((draft) => {
      const nextIndex = (draft.groups?.length || 0) + 1;
      const itemId = `${nextIndex}-1`;
      const nextGroup = {
        group_id: `group_${nextIndex}`,
        title: `镜头${nextIndex}`,
        source_text: "",
        order_index: nextIndex - 1,
        collapsed: false,
        items: [{
          item_id: itemId,
          shot_no: itemId,
          scene_name: "",
          shot_size: "",
          composition: "",
          camera_move: "",
          lighting: "",
          shot_description: "",
          sound_fx: "",
          dialogue: "",
          duration_sec: 4,
          speaker: "",
          image_prompt: "",
          video_prompt: "",
          negative_prompt: "",
        }],
      };
      draft.groups = [...(draft.groups || []), nextGroup];
      setSelectedStoryboardItemId(itemId);
    });
    setMessage("已新增镜头组，记得保存。");
  }

  function addStoryboardItem(groupId) {
    updateStoryboardDraftState((draft) => {
      const group = (draft.groups || []).find((item) => item.group_id === groupId);
      if (!group) return;
      const nextIndex = (group.items?.length || 0) + 1;
      const prefix = String(group.title || "镜头").replace(/^镜头/, "");
      const itemId = `${prefix || groupId}-${nextIndex}`;
      group.items.push({
        item_id: itemId,
        shot_no: itemId,
        scene_name: "",
        shot_size: "",
        composition: "",
        camera_move: "",
        lighting: "",
        shot_description: "",
        sound_fx: "",
        dialogue: "",
        duration_sec: 4,
        speaker: "",
        image_prompt: "",
        video_prompt: "",
        negative_prompt: "",
      });
      setSelectedStoryboardItemId(itemId);
    });
    setMessage("已添加分镜，记得保存。");
  }

  function duplicateStoryboardGroup(index) {
    updateStoryboardDraftState((draft) => {
      const source = draft.groups[index];
      const clone = deepClone(source);
      const nextIndex = draft.groups.length + 1;
      clone.group_id = `group_${nextIndex}`;
      clone.title = `镜头${nextIndex}`;
      clone.items = (clone.items || []).map((item, itemIndex) => ({
        ...item,
        item_id: `${nextIndex}-${itemIndex + 1}`,
        shot_no: `${nextIndex}-${itemIndex + 1}`,
      }));
      draft.groups.splice(index + 1, 0, clone);
      setSelectedStoryboardItemId(clone.items?.[0]?.item_id || "");
    });
    setMessage("已复制镜头组，记得保存。");
  }

  function deleteStoryboardGroup(index) {
    updateStoryboardDraftState((draft) => {
      const [removed] = draft.groups.splice(index, 1);
      if (removed?.items?.some((item) => item.item_id === selectedStoryboardItemId)) {
        const next = draft.groups[index] || draft.groups[index - 1];
        setSelectedStoryboardItemId(next?.items?.[0]?.item_id || "");
      }
    });
    setMessage("已删除镜头组，记得保存。");
  }

  function duplicateStoryboardItem(groupId, itemId) {
    updateStoryboardDraftState((draft) => {
      const group = draft.groups.find((item) => item.group_id === groupId);
      if (!group) return;
      const index = group.items.findIndex((item) => item.item_id === itemId);
      if (index === -1) return;
      const clone = deepClone(group.items[index]);
      clone.item_id = `${group.title.replace(/^镜头/, "") || "x"}-${group.items.length + 1}`;
      clone.shot_no = clone.item_id;
      group.items.splice(index + 1, 0, clone);
      setSelectedStoryboardItemId(clone.item_id);
    });
    setMessage("已复制分镜，记得保存。");
  }

  function deleteStoryboardItem(groupId, itemId) {
    updateStoryboardDraftState((draft) => {
      const group = draft.groups.find((item) => item.group_id === groupId);
      if (!group) return;
      const index = group.items.findIndex((item) => item.item_id === itemId);
      if (index === -1) return;
      group.items.splice(index, 1);
      if (!group.items.length) {
        group.items.push({
          item_id: `${group.title.replace(/^镜头/, "") || "x"}-1`,
          shot_no: `${group.title.replace(/^镜头/, "") || "x"}-1`,
          scene_name: "",
          shot_size: "",
          composition: "",
          camera_move: "",
          lighting: "",
          shot_description: "",
          sound_fx: "",
          dialogue: "",
          duration_sec: 4,
          speaker: "",
          image_prompt: "",
          video_prompt: "",
          negative_prompt: "",
        });
      }
      if (selectedStoryboardItemId === itemId) {
        setSelectedStoryboardItemId(group.items[0]?.item_id || "");
      }
    });
    setMessage("已删除分镜，记得保存。");
  }

  function updateCurrentStoryboardItem(field, value) {
    updateStoryboardDraftState((draft) => {
      for (const group of draft.groups || []) {
        const target = (group.items || []).find((item) => item.item_id === selectedStoryboardItemId);
        if (!target) continue;
        target[field] = field === "duration_sec" ? Number(value || 0) : value;
        if (field === "shot_description") {
          target.image_prompt = target.image_prompt || value;
          target.video_prompt = target.video_prompt || value;
        }
        return;
      }
    });
  }

  function handleStoryboardExport() {
    try {
      const csv = serializeStoryboardCsv(storyboardDraft);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${project?.name || "storyboard"}-分镜表.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage("分镜表已导出");
    } catch (error) {
      setMessage(error.message || "导出失败");
    }
  }

  function handleStoryboardImportClick() {
    storyboardImportRef.current?.click();
  }

  function handleStoryboardImport(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || "");
        const imported = file.name.endsWith(".json")
          ? normalizeImportedStoryboard(JSON.parse(text))
          : storyboardFromCsv(text);
        setStoryboardDraft(imported);
        setSelectedStoryboardItemId(imported.groups?.[0]?.items?.[0]?.item_id || "");
        setMessage("分镜表已导入，记得保存。");
      } catch (error) {
        setMessage(error.message || "导入失败");
      } finally {
        event.target.value = "";
      }
    };
    reader.onerror = () => {
      setMessage("读取文件失败");
      event.target.value = "";
    };
    reader.readAsText(file, "utf-8");
  }

  function patchMediaShotLocal(shotId, patch) {
    setProject((current) => {
      if (!current?.artifacts?.mediaWorkbench) {
        return current;
      }
      return {
        ...current,
        artifacts: {
          ...current.artifacts,
          mediaWorkbench: {
            ...current.artifacts.mediaWorkbench,
            shots: (current.artifacts.mediaWorkbench.shots || []).map((shot) =>
              shot.shot_id === shotId
                ? {
                    ...shot,
                    ...patch,
                    subject_refs: patch.subject_refs ?? shot.subject_refs,
                    reference_images: patch.reference_images ?? shot.reference_images,
                    frame_assets: patch.frame_assets ?? shot.frame_assets,
                    video_assets: patch.video_assets ?? shot.video_assets,
                    video_options: patch.video_options ? { ...(shot.video_options || {}), ...patch.video_options } : shot.video_options,
                    audio_config: patch.audio_config ? { ...(shot.audio_config || {}), ...patch.audio_config } : shot.audio_config,
                  }
                : shot,
            ),
          },
        },
      };
    });
  }

  function patchMediaShot(shotId, patch) {
    patchMediaShotLocal(shotId, patch);
  }

  async function persistMediaShotPayload(shotId, payload) {
    await persistModelsOnly();
    const res = await fetch(`/api/projects/${projectId}/media/shots/${encodeURIComponent(shotId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || "保存镜头失败");
    }
    applyProjectData(data, { preserveStoryText: true });
    return data;
  }

  async function persistMediaShotSnapshot(shotId, patch = null) {
    const localShot = (project?.artifacts?.mediaWorkbench?.shots || []).find((item) => item.shot_id === shotId);
    const payload = patch ? { ...(localShot || {}), ...patch } : (localShot || {});
    return await persistMediaShotPayload(shotId, payload);
  }

  function saveMediaShot(shotId, patch = null) {
    startTransition(async () => {
      try {
        setLocalBusyText("正在保存当前镜头");
        if (patch) {
          patchMediaShotLocal(shotId, patch);
        }
        await persistMediaShotSnapshot(shotId, patch);
        setMessage("当前镜头已保存");
      } catch (error) {
        setMessage(error.message || "保存失败");
      } finally {
        setLocalBusyText("");
      }
    });
  }

  function generateMediaShotImageAction(shotId) {
    startTransition(async () => {
      try {
        setLocalBusyText("正在生成当前镜头图片");
        await persistMediaShotSnapshot(shotId);
        const res = await fetch(`/api/projects/${projectId}/media/shots/${encodeURIComponent(shotId)}/image`, {
          method: "POST",
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.message || "生成图片失败");
        }
        applyProjectData(data, { preserveStoryText: true });
        setMessage("当前镜头图片已生成");
      } catch (error) {
        setMessage(error.message || "生成图片失败");
      } finally {
        setLocalBusyText("");
      }
    });
  }

  function generateMediaShotVideoAction(shotId, options = {}) {
    startTransition(async () => {
      try {
        setLocalBusyText("正在生成当前镜头视频");
        await persistMediaShotSnapshot(shotId);
        const res = await fetch(`/api/projects/${projectId}/media/shots/${encodeURIComponent(shotId)}/video`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(options),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.message || "生成视频失败");
        }
        applyProjectData(data, { preserveStoryText: true });
        setMessage("当前镜头视频已生成");
      } catch (error) {
        setMessage(error.message || "生成视频失败");
      } finally {
        setLocalBusyText("");
      }
    });
  }

  function generateMediaShotAudioAction(shotId) {
    startTransition(async () => {
      try {
        setLocalBusyText("正在生成当前镜头配音");
        await persistMediaShotSnapshot(shotId);
        const res = await fetch(`/api/projects/${projectId}/media/shots/${encodeURIComponent(shotId)}/audio`, {
          method: "POST",
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.message || "生成配音失败");
        }
        applyProjectData(data, { preserveStoryText: true });
        setMessage("当前镜头配音已生成");
      } catch (error) {
        setMessage(error.message || "生成配音失败");
      } finally {
        setLocalBusyText("");
      }
    });
  }

  function applyMediaShotAudioToVideoAction(shotId) {
    startTransition(async () => {
      try {
        setLocalBusyText("正在合成当前镜头配音到视频");
        const res = await fetch(`/api/projects/${projectId}/media/shots/${encodeURIComponent(shotId)}/video/audio`, {
          method: "POST",
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.message || "合成视频失败");
        }
        applyProjectData(data, { preserveStoryText: true });
        setMessage("当前镜头已生成带配音视频");
      } catch (error) {
        setMessage(error.message || "合成视频失败");
      } finally {
        setLocalBusyText("");
      }
    });
  }

  async function previewMediaShotAudio(shotId) {
    try {
      setLocalBusyText("正在生成试听");
      await persistMediaShotSnapshot(shotId);
      const res = await fetch(`/api/projects/${projectId}/media/shots/${encodeURIComponent(shotId)}/audio?preview=1`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "试听失败");
      }
      return await res.blob();
    } finally {
      setLocalBusyText("");
    }
  }

  function batchGenerateMedia(kind) {
    startTransition(async () => {
      try {
        const shots = project?.artifacts?.mediaWorkbench?.shots || [];
        if (!shots.length) {
          throw new Error("当前没有可批量执行的镜头。");
        }
        setLocalBusyText(kind === "image" ? "正在批量生成镜头图片" : "正在批量生成镜头视频");
        for (const shot of shots) {
          await persistMediaShotPayload(shot.shot_id, shot);
          const endpoint = kind === "image"
            ? `/api/projects/${projectId}/media/shots/${encodeURIComponent(shot.shot_id)}/image`
            : `/api/projects/${projectId}/media/shots/${encodeURIComponent(shot.shot_id)}/video`;
          const body = kind === "video"
            ? JSON.stringify({
                durationSec: shot.video_options?.durationSec || shot.duration_sec || 4,
                resolution: shot.video_options?.resolution || "",
                enableAudio: Boolean(shot.video_options?.enableAudio),
              })
            : null;
          const res = await fetch(endpoint, {
            method: "POST",
            headers: body ? { "Content-Type": "application/json" } : undefined,
            body,
          });
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.message || `${shot.shot_no || shot.shot_id} 生成失败`);
          }
          applyProjectData(data, { preserveStoryText: true });
        }
        setMessage(kind === "image" ? "批量镜头图片生成完成" : "批量镜头视频生成完成");
      } catch (error) {
        setMessage(error.message || "批量执行失败");
      } finally {
        setLocalBusyText("");
      }
    });
  }

  function uploadMediaReferenceImage(shotId, file) {
    startTransition(async () => {
      try {
        setLocalBusyText("正在上传镜头参考图");
        const form = new FormData();
        form.append("file", file);
        const uploadRes = await fetch(`/api/projects/${projectId}/media/shots/${encodeURIComponent(shotId)}/reference-images`, {
          method: "POST",
          body: form,
        });
        const image = await uploadRes.json();
        if (!uploadRes.ok) {
          throw new Error(image.message || "上传参考图失败");
        }
        const currentShot = (project?.artifacts?.mediaWorkbench?.shots || []).find((item) => item.shot_id === shotId);
        const nextRefs = [...(currentShot?.reference_images || []), image];
        await persistMediaShotPayload(shotId, { ...(currentShot || {}), reference_images: nextRefs });
        setMessage("镜头参考图已加入");
      } catch (error) {
        setMessage(error.message || "上传失败");
      } finally {
        setLocalBusyText("");
      }
    });
  }

  function uploadMediaFrameImage(shotId, file, kind) {
    startTransition(async () => {
      try {
        setLocalBusyText(kind === "first" ? "正在上传首帧图片" : "正在上传尾帧图片");
        const form = new FormData();
        form.append("file", file);
        const uploadRes = await fetch(`/api/projects/${projectId}/media/shots/${encodeURIComponent(shotId)}/reference-images`, {
          method: "POST",
          body: form,
        });
        const image = await uploadRes.json();
        if (!uploadRes.ok) {
          throw new Error(image.message || "上传图片失败");
        }
        const currentShot = (project?.artifacts?.mediaWorkbench?.shots || []).find((item) => item.shot_id === shotId);
        await persistMediaShotPayload(shotId, {
          ...(currentShot || {}),
          video_options: {
            ...(currentShot?.video_options || {}),
            useFirstFrame: kind === "first" ? true : currentShot?.video_options?.useFirstFrame,
            firstFramePath: kind === "first" ? image.path : (currentShot?.video_options?.firstFramePath || ""),
            firstFrameLabel: kind === "first" ? (image.name || file.name || "上传首帧") : (currentShot?.video_options?.firstFrameLabel || ""),
            lastFrameAssetId: kind === "last" ? "" : (currentShot?.video_options?.lastFrameAssetId || ""),
            lastFramePath: kind === "last" ? image.path : (currentShot?.video_options?.lastFramePath || ""),
            lastFrameLabel: kind === "last" ? (image.name || file.name || "上传尾帧") : (currentShot?.video_options?.lastFrameLabel || ""),
          },
        });
        setMessage(kind === "first" ? "首帧已直接上传并引用" : "尾帧已直接上传并引用");
      } catch (error) {
        setMessage(error.message || "上传失败");
      } finally {
        setLocalBusyText("");
      }
    });
  }

  function removeMediaReferenceImage(shotId, imagePath) {
    const currentShot = (project?.artifacts?.mediaWorkbench?.shots || []).find((item) => item.shot_id === shotId);
    const nextRefs = (currentShot?.reference_images || []).filter((item) => item.path !== imagePath);
    saveMediaShot(shotId, { reference_images: nextRefs });
    if (currentShot?.video_options?.firstFramePath === imagePath || currentShot?.video_options?.lastFramePath === imagePath) {
      setMessage("已从参考区移出图片；首帧/尾帧引用不会被删除。");
    }
  }

  if (!project) {
    return <div className="project-loading">加载中</div>;
  }

  const currentTab = tabs.find((item) => item.id === tab) || tabs[0];
  const currentStageStatus = project.stageState?.[currentTab.stage]?.status;
  const job = project.currentJob;
  const jobRunning = job && ["queued", "running"].includes(job.status);
  const busy = jobRunning || isPending;
  const activeBusyText = localBusyText || job?.progressText || "";
  const busyTitle = jobRunning && job?.status === "queued" ? "任务排队中" : "正在处理中";
  const busyDetail = activeBusyText && activeBusyText !== busyTitle ? activeBusyText : "";
  const subjectReferenceCount = (project.artifacts?.subjectReferences || []).length;

  return (
    <section className="studio studio--workspace">
      <header className="workspace-topbar">
        <div className="workspace-topbar__left">
          <Link href="/projects" className="workspace-back">返回</Link>
          <div className="workspace-title">
            <h1>{project.name}</h1>
            <span>AI 漫剧工作站</span>
          </div>
        </div>
        <nav className="studio-tabs">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === tab ? "studio-tab active" : "studio-tab"}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="studio-badges">
          <span className="studio-badge">{currentTab.label}</span>
          <span className="studio-badge muted">{stageStatusText(currentStageStatus)}</span>
          {jobRunning ? <span className="studio-badge running">{job.progressText || "生成中"}</span> : null}
          {message ? <span className="studio-badge muted">{message}</span> : null}
        </div>
      </header>

      <div
        className={
          tab === "media"
            ? sideCollapsed
              ? "studio-body studio-body--workspace studio-body--media studio-body--side-collapsed"
              : "studio-body studio-body--workspace studio-body--media"
            : sideCollapsed
              ? "studio-body studio-body--workspace studio-body--side-collapsed"
              : "studio-body studio-body--workspace"
        }
      >
        <aside className={sideCollapsed ? "studio-side studio-side--collapsed" : "studio-side"}>
          <div className="studio-side__tools">
            {!sideCollapsed ? <span className="studio-side__label">项目目录</span> : null}
            <button
              type="button"
              className="studio-side__toggle"
              onClick={() => setSideCollapsed((current) => !current)}
              title={sideCollapsed ? "展开左侧目录" : "收起左侧目录"}
              aria-label={sideCollapsed ? "展开左侧目录" : "收起左侧目录"}
            >
              {sideCollapsed ? "›" : "‹"}
            </button>
          </div>
          {!sideCollapsed ? <SideList tab={tab} project={project} /> : null}
        </aside>

        <main className="studio-main">
          {tab === "script" ? (
            <section className="studio-panel studio-main-panel">
              <div className="studio-panel__header">
                <h2>{adaptationDraft?.chapters?.[0]?.title || "第1章"}</h2>
                <span className="studio-panel__meta">{storyText.length}/2000</span>
              </div>
              <textarea className="studio-editor" value={storyText} onChange={(event) => setStoryText(event.target.value)} />
              <ScriptSummary adaptation={adaptationDraft} />
            </section>
          ) : null}

          {tab === "characters" ? (
            <section className="studio-panel studio-main-panel">
              <div className="studio-panel__header">
                <h2>主体资产</h2>
                <div className="studio-inline-actions">
                  <button type="button" onClick={() => runStage("characters")} disabled={busy || !canRunStage(project, "characters", storyText)}>
                    重新分析主体
                  </button>
                  <button type="button" onClick={renderSubjectReferences} disabled={busy || project.stageState?.characters?.status !== "done"}>
                    批量生成参考图
                  </button>
                </div>
              </div>
              <div className="studio-subject-steps">
                <div className="studio-summary-card">
                  <span className="studio-section-label">步骤 1</span>
                  <p>{project.stageState?.characters?.status === "done" ? "主体分析已完成" : "主体分析待执行"}</p>
                </div>
                <div className="studio-summary-card">
                  <span className="studio-section-label">步骤 2</span>
                  <p>{subjectReferenceCount ? `已生成 ${subjectReferenceCount} 份参考图` : "尚未生成参考图"}</p>
                </div>
              </div>
              <SubjectTypeTabs payload={charactersDraft} kind={subjectKind} onChange={setSubjectKind} />
              <SubjectGrid
                items={subjectItems}
                references={currentReferences}
                kind={subjectKind}
                selectedKey={selectedSubjectKey}
                onSelect={setSelectedSubjectKey}
                onPreview={openPreview}
                onCreate={createSubject}
                onDuplicate={duplicateSubject}
                onDelete={deleteSubject}
                onMove={moveSubject}
              />
            </section>
          ) : null}

          {tab === "storyboard" ? (
            <section className="studio-panel studio-main-panel">
              <StoryboardBoard
                storyboard={storyboardDraft}
                selectedItemId={selectedStoryboardItemId}
                onImport={handleStoryboardImportClick}
                onExport={handleStoryboardExport}
                onSelectItem={setSelectedStoryboardItemId}
                onToggleGroup={toggleStoryboardGroup}
                onAddGroup={addStoryboardGroup}
                onAddItem={addStoryboardItem}
                onDuplicateGroup={duplicateStoryboardGroup}
                onDeleteGroup={deleteStoryboardGroup}
                onDuplicateItem={duplicateStoryboardItem}
                onDeleteItem={deleteStoryboardItem}
              />
            </section>
          ) : null}

          {tab === "media" ? (
            <section className="studio-panel studio-main-panel">
              <MediaWorkbenchPanel
                project={project}
                workbench={mediaWorkbench}
                models={models}
                modelOptions={modelOptions}
                onChangeModels={(patch) => setModels((current) => ({ ...current, ...patch }))}
                onPatchShot={patchMediaShot}
                onSaveShot={saveMediaShot}
                onGenerateShotImage={generateMediaShotImageAction}
                onGenerateShotVideo={generateMediaShotVideoAction}
                onGenerateShotAudio={generateMediaShotAudioAction}
                onApplyShotAudioToVideo={applyMediaShotAudioToVideoAction}
                onPreviewShotAudio={previewMediaShotAudio}
                onBatchGenerateImages={() => batchGenerateMedia("image")}
                onBatchGenerateVideos={() => batchGenerateMedia("video")}
                onUploadReferenceImage={uploadMediaReferenceImage}
                onUploadFirstFrameImage={(shotId, file) => uploadMediaFrameImage(shotId, file, "first")}
                onUploadLastFrameImage={(shotId, file) => uploadMediaFrameImage(shotId, file, "last")}
                onRemoveReferenceImage={removeMediaReferenceImage}
                onNotify={setMessage}
                busy={busy}
              />
            </section>
          ) : null}

          {tab === "output" ? <OutputPanel project={project} /> : null}

          <ProjectLogPanel logs={project.logs} />

          <div className={busy ? "studio-loading-mask active" : "studio-loading-mask"} aria-hidden={!busy}>
            <div className="studio-loading-card">
              <div className="studio-spinner" />
              <strong>{busyTitle}</strong>
              {busyDetail ? <span>{busyDetail}</span> : null}
            </div>
          </div>
        </main>

        {tab !== "media" ? (
        <aside className="studio-settings">
          <section className="studio-panel">
            <div className="studio-panel__header">
              <h2>{tab === "script" ? "全局设置" : tab === "characters" ? "主体设置" : "阶段设置"}</h2>
              <span className="studio-panel__meta">{stageStatusText(currentStageStatus)}</span>
            </div>

            {tab === "script" ? (
              <>
                <label className="studio-field">
                  <span>剧本模型</span>
                  <select value={models.adaptation || ""} onChange={(event) => setModels((current) => ({ ...current, adaptation: event.target.value }))}>
                    <option value="">请选择数据库中的模型</option>
                    {modelOptions.adaptation.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <div className="studio-field">
                  <span>视频比例</span>
                  <div className="studio-option-grid">
                    {ratioOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={models.scriptRatio === option.value ? "studio-option-card active" : "studio-option-card"}
                        onClick={() => setModels((current) => ({ ...current, scriptRatio: option.value }))}
                      >
                        <RatioPreview icon={option.icon} />
                        <strong>{option.value}</strong>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="studio-field">
                  <span>风格参考</span>
                  <div className="studio-style-grid">
                    {styleOptions.map((option) => (
                      <button
                        key={option}
                        type="button"
                        className={models.scriptStyle === option ? "studio-style-card active" : "studio-style-card"}
                        onClick={() => setModels((current) => ({ ...current, scriptStyle: option }))}
                      >
                        <strong>{option}</strong>
                        <span>确定整体质感与主体分析风格</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="studio-action-stack">
                  <button className="studio-primary" type="button" onClick={() => runStage("adaptation")} disabled={busy || !canRunStage(project, "adaptation", storyText)}>
                    主体提取
                  </button>
                  <button className="studio-secondary" type="button" onClick={() => persistBase("剧本已保存")} disabled={busy}>
                    保存
                  </button>
                </div>
                <div className="studio-summary-card">
                  <span className="studio-section-label">当前策略</span>
                  <p>剧本阶段只确定文本、比例、风格与主体线索，不在这里拆剧情分镜。</p>
                </div>
              </>
            ) : null}

            {tab === "characters" ? (
              <>
                <label className="studio-field">
                  <span>主体分析模型</span>
                  <select value={models.characters || ""} onChange={(event) => setModels((current) => ({ ...current, characters: event.target.value }))}>
                    <option value="">请选择数据库中的模型</option>
                    {modelOptions.characters.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <label className="studio-field">
                  <span>参考图模型</span>
                  <select value={models.roleImage || ""} onChange={(event) => setModels((current) => ({ ...current, roleImage: event.target.value }))}>
                    <option value="">请选择数据库中的模型</option>
                    {modelOptions.roleImage.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>

                {currentSubject ? (
                  <div className="studio-detail-editor">
                    <span className="studio-section-label">{currentSubject.name}</span>
                    {currentReference?.url ? (
                      <button
                        type="button"
                        className="studio-current-preview"
                        onClick={() => openPreview(currentReference, currentSubject.name)}
                      >
                        <img src={currentReference.url} alt={currentSubject.name} />
                        <span>查看当前大图</span>
                      </button>
                    ) : null}
                    {currentReferenceHistory.length ? (
                      <div className="studio-field">
                        <span>已生成版本</span>
                        <div className="studio-reference-grid">
                          {currentReferenceHistory.map((item, index) => (
                            <div
                              key={item.path || item.url || `${item.key}-${index}`}
                              className={item.isCurrent ? "studio-reference-tile studio-reference-tile--active" : "studio-reference-tile"}
                            >
                              <button
                                type="button"
                                className="studio-reference-tile__preview"
                                onClick={() => setCurrentSubjectReference(item)}
                              >
                                <img src={item.url} alt={item.name || currentSubject.name} />
                              </button>
                              <div className="studio-reference-tile__actions">
                                <button type="button" onClick={() => setCurrentSubjectReference(item)} disabled={item.isCurrent}>
                                  {item.isCurrent ? "当前图" : "设为当前"}
                                </button>
                                <button type="button" onClick={() => openPreview(item, item.name || currentSubject.name)}>查看</button>
                                <button type="button" disabled>
                                  {formatLogTime(item.generatedAt)}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <label className="studio-field">
                      <span>{subjectKind === "character" ? "角色名" : subjectKind === "scene" ? "场景名" : "道具名"}</span>
                      <input value={currentSubject.name || ""} onChange={(event) => updateCurrentSubject("name", event.target.value)} />
                    </label>
                    {subjectKind === "character" ? (
                      <>
                        <label className="studio-field">
                          <span>角色定位</span>
                          <input value={currentSubject.role || ""} onChange={(event) => updateCurrentSubject("role", event.target.value)} />
                        </label>
                        <label className="studio-field">
                          <span>声音气质</span>
                          <input value={currentSubject.voice_style || ""} onChange={(event) => updateCurrentSubject("voice_style", event.target.value)} />
                        </label>
                        <label className="studio-field">
                          <span>默认音色</span>
                          <select
                            value={currentSubject.voice_profile?.label || ""}
                            onChange={(event) => {
                              const preset = voiceOptions.find((item) => item.label === event.target.value) || voiceOptions[0];
                              updateCurrentSubject("voice_profile", {
                                ...(currentSubject.voice_profile || {}),
                                label: preset?.label || "",
                                voiceType: preset?.voiceType || "",
                                ageGroup: preset?.ageGroup || currentSubject.voice_profile?.ageGroup || "adult",
                                sceneTags: preset?.sceneTags || currentSubject.voice_profile?.sceneTags || [],
                                styleTags: preset?.styleTags || currentSubject.voice_profile?.styleTags || [],
                                supportsEmotion: preset?.supportsEmotion ?? true,
                                emotion: currentSubject.voice_profile?.emotion || "",
                                speedRatio: Number(currentSubject.voice_profile?.speedRatio || 1),
                                volume: Number(currentSubject.voice_profile?.volume || 5),
                                pitch: Number(currentSubject.voice_profile?.pitch || 1),
                              });
                            }}
                          >
                            {voiceOptions.map((item) => <option key={item.key} value={item.label}>{item.label}</option>)}
                          </select>
                        </label>
                      </>
                    ) : null}
                    {subjectKind === "scene" ? (
                      <label className="studio-field">
                        <span>场景地点</span>
                        <input value={currentSubject.location || ""} onChange={(event) => updateCurrentSubject("location", event.target.value)} />
                      </label>
                    ) : null}
                    <label className="studio-field">
                      <span>完整描述</span>
                      <textarea
                        className="studio-description"
                        value={subjectDescription(currentSubject, subjectKind)}
                        onChange={(event) => {
                          updateCurrentSubject("full_description", event.target.value);
                          updateCurrentSubject("reference_prompt", event.target.value);
                          updateCurrentSubject("continuity_prompt", event.target.value);
                          if (subjectKind !== "character") {
                            updateCurrentSubject("description", event.target.value);
                          }
                        }}
                      />
                    </label>
                    <div className="studio-action-stack">
                      <button className="studio-secondary" type="button" onClick={() => saveCurrentSubject(false)} disabled={busy}>
                        保存当前项
                      </button>
                      <button className="studio-primary" type="button" onClick={() => saveCurrentSubject(true)} disabled={busy}>
                        生成当前项图片
                      </button>
                    </div>
                    <div className="studio-field">
                      <span>参考图片</span>
                      <div className="studio-reference-grid">
                        <label className="studio-reference-upload">
                          <input
                            className="studio-reference-upload__input"
                            type="file"
                            accept="image/png,image/jpeg,image/jpg"
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              if (file) {
                                uploadReferenceImage(file);
                                event.target.value = "";
                              }
                            }}
                          />
                          <span className="studio-reference-upload__plus">+</span>
                          <span className="studio-reference-upload__label">图片</span>
                        </label>
                        {(currentSubject.reference_images || []).map((item) => (
                          <div key={item.path || item.url} className="studio-reference-tile">
                            <button type="button" className="studio-reference-tile__preview" onClick={() => openPreview(item, item.name || currentSubject.name)}>
                              <img src={item.url} alt={item.name || "reference"} />
                            </button>
                            <div className="studio-reference-tile__actions">
                              <button type="button" onClick={() => openPreview(item, item.name || currentSubject.name)}>查看</button>
                              <button type="button" onClick={() => removeReferenceImage(item.path)}>移除</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <EmptyCard title="当前未选中主体" detail="左侧选择或新增一个主体项。" />
                )}
              </>
            ) : null}

            {tab === "storyboard" ? (
              <>
                <label className="studio-field">
                  <span>分镜模型</span>
                  <select value={models.storyboard || ""} onChange={(event) => setModels((current) => ({ ...current, storyboard: event.target.value }))}>
                    <option value="">请选择数据库中的模型</option>
                    {modelOptions.storyboard.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <div className="studio-action-stack">
                  <button className="studio-primary" type="button" onClick={() => runStage("storyboard")} disabled={busy || !canRunStage(project, "storyboard", storyText)}>
                    生成分镜
                  </button>
                  <button
                    className="studio-secondary"
                    type="button"
                    onClick={() => {
                      startTransition(async () => {
                        try {
                          await saveArtifact("storyboard", storyboardDraft, "分镜结构已保存");
                        } catch (error) {
                          setMessage(error.message || "保存失败");
                        }
                      });
                    }}
                    disabled={busy}
                  >
                    保存分镜
                  </button>
                </div>
                {currentStoryboardItem ? (
                  <div className="studio-detail-editor">
                    <span className="studio-section-label">{currentStoryboardItem.shot_no || currentStoryboardItem.item_id}</span>
                    <label className="studio-field">
                      <span>场景</span>
                      <input value={currentStoryboardItem.scene_name || ""} onChange={(event) => updateCurrentStoryboardItem("scene_name", event.target.value)} />
                    </label>
                    <label className="studio-field">
                      <span>景别</span>
                      <input value={currentStoryboardItem.shot_size || ""} onChange={(event) => updateCurrentStoryboardItem("shot_size", event.target.value)} />
                    </label>
                    <label className="studio-field">
                      <span>构图</span>
                      <input value={currentStoryboardItem.composition || ""} onChange={(event) => updateCurrentStoryboardItem("composition", event.target.value)} />
                    </label>
                    <label className="studio-field">
                      <span>运镜</span>
                      <input value={currentStoryboardItem.camera_move || ""} onChange={(event) => updateCurrentStoryboardItem("camera_move", event.target.value)} />
                    </label>
                    <label className="studio-field">
                      <span>光影</span>
                      <textarea className="studio-textarea-small" value={currentStoryboardItem.lighting || ""} onChange={(event) => updateCurrentStoryboardItem("lighting", event.target.value)} />
                    </label>
                    <label className="studio-field">
                      <span>分镜描述</span>
                      <textarea className="studio-textarea-small" value={currentStoryboardItem.shot_description || ""} onChange={(event) => updateCurrentStoryboardItem("shot_description", event.target.value)} />
                    </label>
                    <label className="studio-field">
                      <span>音效</span>
                      <textarea className="studio-textarea-small" value={currentStoryboardItem.sound_fx || ""} onChange={(event) => updateCurrentStoryboardItem("sound_fx", event.target.value)} />
                    </label>
                    <label className="studio-field">
                      <span>对白</span>
                      <textarea className="studio-textarea-small" value={currentStoryboardItem.dialogue || ""} onChange={(event) => updateCurrentStoryboardItem("dialogue", event.target.value)} />
                    </label>
                    <label className="studio-field">
                      <span>时长</span>
                      <input type="number" value={currentStoryboardItem.duration_sec || 4} onChange={(event) => updateCurrentStoryboardItem("duration_sec", event.target.value)} />
                    </label>
                    <label className="studio-field">
                      <span>静帧提示词</span>
                      <textarea className="studio-textarea-small" value={currentStoryboardItem.image_prompt || ""} onChange={(event) => updateCurrentStoryboardItem("image_prompt", event.target.value)} />
                    </label>
                    <label className="studio-field">
                      <span>视频提示词</span>
                      <textarea className="studio-textarea-small" value={currentStoryboardItem.video_prompt || ""} onChange={(event) => updateCurrentStoryboardItem("video_prompt", event.target.value)} />
                    </label>
                  </div>
                ) : (
                  <EmptyCard title="当前未选中分镜" detail="点击左侧表格中的分镜行后，在这里编辑。" />
                )}
              </>
            ) : null}

            {tab === "media" ? (
              <>
                <div className="studio-summary-card">
                  <span className="studio-section-label">当前模式</span>
                  <p>故事板阶段已切换成镜头级制作工作台。中间区聚焦当前镜头，右侧分别处理绘图、视频和台词配音。</p>
                </div>
              </>
            ) : null}

            {tab === "output" ? (
              <>
                <label className="studio-field">
                  <span>视频模型</span>
                  <select value={models.shotVideo || ""} onChange={(event) => setModels((current) => ({ ...current, shotVideo: event.target.value }))}>
                    <option value="">请选择数据库中的模型</option>
                    {modelOptions.shotVideo.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <div className="studio-action-stack">
                  <button className="studio-secondary" type="button" onClick={() => runStage("output")} disabled={busy || !canRunStage(project, "output", storyText)}>
                    成片完成
                  </button>
                  <button className="studio-primary" type="button" onClick={() => runStage("video")} disabled={busy || !canRunStage(project, "video", storyText)}>
                    批量生成分镜视频
                  </button>
                </div>
              </>
            ) : null}

            <div className="studio-summary-card">
              <span className="studio-section-label">当前任务</span>
              <p>{job ? `${job.stage} / ${stageStatusText(job.status)} / ${job.progressText || "已创建"}` : "当前无任务"}</p>
            </div>
          </section>
        </aside>
        ) : null}
      </div>

      {modalStage === "script" && adaptationDraft ? (
        <StructuredScriptModal
          value={adaptationDraft}
          onChange={setAdaptationDraft}
          onSave={() => {
            startTransition(async () => {
              try {
                await saveArtifact("adaptation", adaptationDraft, "剧情结构已保存");
                setModalStage(null);
              } catch (error) {
                setMessage(error.message || "保存失败");
              }
            });
          }}
          onClose={() => setModalStage(null)}
          isPending={isPending}
        />
      ) : null}

      {modalStage === "storyboard" && storyboardDraft ? (
        <StructuredStoryboardModal
          value={storyboardDraft}
          onChange={setStoryboardDraft}
          onSave={() => {
            startTransition(async () => {
              try {
                await saveArtifact("storyboard", storyboardDraft, "分镜结构已保存");
                setModalStage(null);
              } catch (error) {
                setMessage(error.message || "保存失败");
              }
            });
          }}
          onClose={() => setModalStage(null)}
          isPending={isPending}
        />
      ) : null}

      <ImagePreviewModal asset={previewAsset} onClose={() => setPreviewAsset(null)} />
      <input
        ref={storyboardImportRef}
        hidden
        type="file"
        accept=".csv,.json,text/csv,application/json"
        onChange={handleStoryboardImport}
      />
    </section>
  );
}
