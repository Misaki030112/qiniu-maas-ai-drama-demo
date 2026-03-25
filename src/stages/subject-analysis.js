function buildValidationError(message, details = {}) {
  const error = new Error(message);
  error.details = details;
  return error;
}

function collectScriptText(adaptation) {
  return [
    adaptation?.script_text || "",
    ...(adaptation?.chapters || []).map((item) => item.content || item.summary || ""),
  ].join("\n");
}

function uniqueNamesFromText(text) {
  const matches = String(text || "").match(/[\u4e00-\u9fa5]{2,3}/g) || [];
  return [...new Set(matches)];
}

function extractCharacterCandidates(adaptation) {
  const text = collectScriptText(adaptation);
  const stop = new Set([
    "项目",
    "样片",
    "会议室",
    "数据",
    "剧情",
    "角色",
    "镜头",
    "场景",
    "场戏",
    "深夜",
    "真人剧",
    "点众",
    "科技",
    "业务",
    "模型",
    "链路",
    "旁白",
    "用户",
    "理由",
    "技术",
    "参数",
    "生成",
    "界面",
    "剧情片",
    "台词",
    "模块",
    "晨光",
    "百叶",
    "发送",
    "键转",
  ]);

  const patterns = [
    /(?:^|[，。；：、\s\n“”"'‘’【】（）()])([\u4e00-\u9fa5]{2,3})(?=(?:将|把|对|向|在|从|正|默默|突然|快速|调试|收到|冲进|走进|看着|盯着|按住|说|问|答|听|拿|坐|站|抬|调出))/g,
    /(?:^|[，。；：、\s\n“”"'‘’【】（）()])([\u4e00-\u9fa5]{2,3})(?=[:：])/g,
  ];

  const names = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = match[1];
      if (!value || stop.has(value) || names.includes(value)) {
        continue;
      }
      names.push(value);
    }
  }

  if (!names.length) {
    for (const value of uniqueNamesFromText(text)) {
      if (!stop.has(value) && !names.includes(value)) {
        names.push(value);
      }
    }
  }

  return names.slice(0, 3);
}

function isLikelyCharacterName(name, adaptation) {
  const scriptText = collectScriptText(adaptation);
  if (!name || !scriptText) {
    return false;
  }
  if (!scriptText.includes(name)) {
    return false;
  }
  const banned = ["工牌", "键盘", "报告", "进度条", "工作台", "会议室", "玻璃", "倒影", "样片", "标题", "平台", "午夜"];
  return !banned.some((item) => name.includes(item));
}

export function validateCharacterPayload(payload, adaptation) {
  const candidates = extractCharacterCandidates(adaptation);
  const characters = payload.characters || [];
  if (!characters.length) {
    throw buildValidationError("主体分析失败：AI 未返回任何角色。", {
      expectedNames: candidates,
    });
  }

  const invalidNames = characters
    .map((item) => item.name)
    .filter((name) => !isLikelyCharacterName(name, adaptation));

  if (invalidNames.length) {
    throw buildValidationError("主体分析失败：AI 返回的角色名未在剧本正文中正确出现。", {
      invalidNames,
      expectedNames: candidates,
    });
  }

  return payload;
}
