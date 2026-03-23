export function buildAdaptationMessages(storyText) {
  return {
    system: [
      "你是短剧编剧策划，任务是把输入故事改写成适合 AI 真人剧 demo 的紧凑剧情结构。",
      "必须输出 JSON，不要输出任何解释。",
      "整体风格要偏短剧、强目标、强冲突、强推进，但保持现实职场语境。",
    ].join(" "),
    user: `
请把下面的故事改写成 3 场戏以内、4 到 6 个镜头可承载的真人剧骨架。

返回 JSON，结构如下：
{
  "title": "剧名",
  "theme": "一句话主题",
  "logline": "一句话梗概",
  "tone": ["关键词1", "关键词2"],
  "scenes": [
    {
      "scene_id": "scene_1",
      "title": "场景标题",
      "location": "地点",
      "objective": "该场戏推进什么",
      "conflict": "主要冲突",
      "turning_point": "转折点",
      "must_show": ["必须出现的画面或信息"]
    }
  ],
  "ending_hook": "结尾钩子"
}

原始故事：
${storyText}
`.trim(),
  };
}

export function buildCharacterMessages(adaptation) {
  return {
    system: [
      "你是人物设定导演，负责从剧情骨架中提炼角色，并为后续图像生成提供稳定的人物一致性描述。",
      "必须输出 JSON。",
    ].join(" "),
    user: `
基于以下剧情骨架，为真人剧 demo 输出 2 到 3 个核心角色。

返回 JSON：
{
  "characters": [
    {
      "name": "角色名",
      "role": "角色定位",
      "gender": "female|male|neutral",
      "age_range": "年龄段",
      "personality": ["关键词1", "关键词2"],
      "appearance": "外形描述，强调服装、发型、气质",
      "continuity_prompt": "给画面模型的人物一致性提示语，中文，写实真人风格",
      "voice_style": "更适合什么声音气质"
    }
  ]
}

剧情骨架：
${JSON.stringify(adaptation, null, 2)}
`.trim(),
  };
}

export function buildStoryboardMessages(adaptation, characters) {
  return {
    system: [
      "你是分镜导演，任务是把剧情骨架拆成适合 20 到 35 秒 demo 的连续镜头。",
      "必须输出 JSON。",
      "每个镜头都要有明确的画面提示词、说话人和字幕文案。",
    ].join(" "),
    user: `
请根据剧情骨架和角色设定，输出 4 到 6 个镜头。

要求：
1. 镜头之间必须有因果推进，不是静态拼图。
2. 画面风格统一为写实电影感真人剧，16:9，适合短视频展示。
3. 台词要短，能直接拿去配音和字幕。
4. 每个镜头最好 4 到 7 秒。

返回 JSON：
{
  "style_guide": {
    "visual_style": "统一视觉风格",
    "continuity_rules": ["角色一致性规则1", "规则2"]
  },
  "shots": [
    {
      "shot_id": "shot_01",
      "scene_id": "scene_1",
      "title": "镜头标题",
      "camera": "景别和机位",
      "visual_focus": "镜头重点",
      "speaker": "说话人名称，若为旁白则写旁白",
      "line": "要配音的文本",
      "subtitle": "要上屏的字幕文本",
      "duration_sec": 5,
      "image_prompt": "完整中文画面提示词，含人物、地点、情绪、光线、摄影感"
    }
  ]
}

剧情骨架：
${JSON.stringify(adaptation, null, 2)}

角色设定：
${JSON.stringify(characters, null, 2)}
`.trim(),
  };
}

