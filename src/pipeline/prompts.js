export function buildAdaptationMessages(storyText) {
  return {
    system: [
      "你是短剧总编剧兼制片统筹。",
      "你的输出不是文学创作，而是能直接驱动角色、分镜、画面、视频和配音生产的结构化生产稿。",
      "必须严格输出 JSON，不要输出任何解释、前后缀、markdown。",
      "整体风格要偏真人短剧：强目标、强冲突、强推进、强转折，但保持现实职场语境，不能飘。",
    ].join(" "),
    user: `
请把下面的故事改写成适合 25 到 45 秒真人剧 demo 的剧情骨架。

硬性要求：
1. 只保留 2 到 3 个核心角色。
2. 总场景数不超过 3 场。
3. 每场戏都必须推动局势变化，不能只是说明背景。
4. 结果必须适合后续镜头化，禁止空泛抽象描述。
5. 角色、地点、情绪、关键道具必须明确，方便后续画面和视频复用。
6. 结尾必须留下明确钩子，但不能引入全新世界观。

返回 JSON，结构如下：
{
  "title": "剧名",
  "theme": "一句话主题",
  "logline": "一句话梗概",
  "tone": ["关键词1", "关键词2", "关键词3"],
  "scenes": [
    {
      "scene_id": "scene_1",
      "title": "场景标题",
      "location": "地点",
      "time_of_day": "时间",
      "objective": "该场戏推进什么",
      "conflict": "主要冲突",
      "turning_point": "转折点",
      "emotional_shift": "情绪如何变化",
      "must_show": ["必须出现的画面或信息"],
      "key_props": ["关键道具1", "关键道具2"]
    }
  ],
  "continuity_tokens": [
    "角色服装/道具/环境里必须跨镜头保持的元素"
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
      "你是人物设定导演兼连续性设计师。",
      "你的任务是产出可以直接给图像模型和视频模型复用的人设卡。",
      "必须严格输出 JSON，不要解释。",
    ].join(" "),
    user: `
基于以下剧情骨架，为真人剧 demo 输出 2 到 3 个核心角色。

硬性要求：
1. 角色名字必须和剧情骨架一致。
2. 外形描述必须具体到发型、服装、年龄感、体型、表情特征，避免“好看、帅气、普通”这种空词。
3. continuity_prompt 必须是能反复复用的统一人物锚点。
4. 每个角色都要给出 negative_prompt，避免后续画面和视频漂移。
5. 如果角色会出现在多镜头里，要优先保证辨识度而不是华丽辞藻。

返回 JSON：
{
  "characters": [
    {
      "name": "角色名",
      "role": "角色定位",
      "gender": "female|male|neutral",
      "age_range": "年龄段",
      "personality": ["关键词1", "关键词2"],
      "appearance": "外形描述，强调服装、发型、体型、面部特征、气质",
      "wardrobe": "稳定服装描述",
      "visual_anchor": ["最稳定的视觉锚点1", "锚点2"],
      "continuity_prompt": "给画面和视频模型的人物一致性提示语，中文，写实真人风格",
      "negative_prompt": "必须避免的偏差，例如卡通脸、古装、年龄漂移、服装漂移",
      "voice_style": "更适合什么声音气质"
    }
  ],
  "scenes": [
    {
      "name": "场景名",
      "location": "场景地点",
      "description": "这个场景需要被画成什么样",
      "continuity_prompt": "场景一致性提示词",
      "negative_prompt": "这个场景应避免的问题"
    }
  ],
  "props": [
    {
      "name": "道具名",
      "description": "这个道具的材质、形态和作用",
      "continuity_prompt": "道具一致性提示词",
      "negative_prompt": "这个道具应避免的问题"
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
      "你是分镜导演兼视频提示词工程师。",
      "你的任务是把剧情骨架拆成适合连续生成的真人剧镜头，并同时给出图像提示词和视频提示词。",
      "必须严格输出 JSON，不要解释。",
      "镜头之间必须有明显因果推进，不能像 PPT 拼图。",
    ].join(" "),
    user: `
请根据剧情骨架和角色设定，输出 4 到 6 个镜头。

要求：
1. 角色名只能使用角色设定里已有的名字。
2. 镜头之间必须有因果推进，不是静态拼图。
3. 画面风格统一为写实电影感真人剧，16:9，适合短视频展示。
4. 台词要短，能直接拿去配音和字幕。
5. 每个镜头最好 4 到 7 秒。
6. image_prompt 偏静帧生成，video_prompt 偏连续动作生成。
7. 如果镜头里有人物动作，必须写清楚动作起点和动作终点。

返回 JSON：
{
  "style_guide": {
    "visual_style": "统一视觉风格",
    "continuity_rules": ["角色一致性规则1", "规则2"],
    "negative_prompt": "全局负面提示词"
  },
  "shots": [
    {
      "shot_id": "shot_01",
      "scene_id": "scene_1",
      "title": "镜头标题",
      "camera": "景别和机位",
      "visual_focus": "镜头重点",
      "transition": "和上一个镜头如何衔接",
      "speaker": "说话人名称，若为旁白则写旁白",
      "line": "要配音的文本",
      "subtitle": "要上屏的字幕文本",
      "duration_sec": 5,
      "image_prompt": "完整中文静帧提示词，含人物、地点、情绪、光线、摄影感",
      "video_prompt": "完整中文视频提示词，含动作、镜头运动、节奏、人物状态变化",
      "negative_prompt": "这个镜头要避免的问题"
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
