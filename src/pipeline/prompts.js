export function buildAdaptationMessages(storyText, settings = {}) {
  const ratio = settings.scriptRatio || settings.videoRatio || "9:16";
  const style = settings.scriptStyle || settings.stylePreset || "写实";
  const mode = settings.scriptMode || settings.createMode || "生图转视频";
  return {
    system: [
      "你是短剧总编剧兼前期策划。",
      "你的输出不是文学创作，而是一个可以直接进入主体分析、分镜和故事板阶段的剧本工作稿。",
      "必须严格输出 JSON，不要输出任何解释、前后缀、markdown。",
      "项目目标是生成真人表演视频内容，但美术风格、时代背景、题材气质不能被写死，必须以全局设定和故事内容为准。",
      "剧情节奏需要有目标、冲突、推进和转折，但题材语境不能被你擅自固定成都市职场。",
    ].join(" "),
    user: `
请把下面的故事整理成适合 25 到 45 秒真人剧情视频 demo 的剧本工作稿。

硬性要求：
1. 只保留 2 到 3 个核心角色，整体体量控制在 1 章内容内。
2. 这里不要做镜头级拆解，也不要输出 shot list。
3. 输出重点是：剧本标题、梗概、整体基调、章节正文、主体线索。
4. 章节正文要是可直接阅读和继续编辑的中文短剧剧本稿，而不是 JSON 笔记。
5. 角色、场景、关键道具要为后续“主体分析”留出明确线索，但不要提前拆成分镜。
6. 结尾必须留下明确钩子，但不能引入全新世界观。
7. 当前全局设定：视频比例=${ratio}，风格参考=${style}，创作模式=${mode}。

返回 JSON，结构如下：
{
  "title": "剧名",
  "logline": "一句话梗概",
  "theme": "一句话主题",
  "tone": ["关键词1", "关键词2", "关键词3"],
  "video_ratio": "${ratio}",
  "style_preset": "${style}",
  "create_mode": "${mode}",
  "chapters": [
    {
      "chapter_id": "chapter_1",
      "title": "章节标题",
      "summary": "本章摘要",
      "content": "本章完整剧本文字，按自然段输出"
    }
  ],
  "script_text": "合并后的完整剧本文字",
  "style_notes": ["整体基调说明1", "说明2"],
  "subject_hints": {
    "characters": ["角色名或角色线索1", "角色线索2"],
    "scenes": ["场景线索1", "场景线索2"],
    "props": ["关键道具1", "关键道具2"]
  },
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

export function buildCharacterMessages(adaptation, settings = {}) {
  const style = settings.scriptStyle || settings.stylePreset || adaptation?.style_preset || "写实";
  const ratio = settings.scriptRatio || settings.videoRatio || adaptation?.video_ratio || "9:16";
  return {
    system: [
      "你是人物设定导演兼连续性设计师。",
      "你的任务是产出可以直接给图像模型和视频模型复用的主体分析结果。",
      "主体分为角色、场景、道具三类。",
      "你现在只做分析，不生成图片。",
      "项目类型是真人表演视频，不代表美术风格固定。风格、时代、色调、材质语言都必须服从全局设定和剧本内容。",
      "你的输出必须像专业设计稿说明，而不是泛泛而谈的形容词堆砌。",
      "必须严格输出 JSON，不要解释。",
    ].join(" "),
    user: `
基于以下剧本工作稿，为真人剧情视频 demo 输出角色、场景、道具三类主体分析结果。

硬性要求：
1. 角色名字必须来自剧本正文中真实出现的人名，禁止使用标题词、章节词、道具名、场景词、抽象概念词来充当角色名。
2. 每个主体都必须给出“完整描述”，它是后续生成参考图的主提示词，要接近真实生产可用水平。
3. 角色完整描述必须达到专业设定稿粒度：画质、摄影感、年龄、身高、体型、国籍、发型、脸型、五官、服装、鞋、配饰、表情、姿态、左区正脸特写、右区标准三视图、背景、光线、镜头焦距、无畸变、无遮挡、一致性约束。
4. 场景完整描述必须达到专业设定稿粒度：画质、摄影感、空间类型、时代感、色调、材质、陈设、机位、景别、是否有人物、构图重心、需要稳定复用的环境元素。
5. 道具完整描述必须达到专业设定稿粒度：画质、摄影感、背景、材质、结构细节、功能信息、屏幕或纹理信息、标准三视图要求。
6. 每个主体都要有 full_description、reference_prompt、negative_prompt，reference_prompt 默认等于 full_description 的精炼版，但仍要完整可用。
7. 整体风格参考=${style}，视频比例=${ratio}。这里的“风格参考”必须真实影响你的输出，不允许你默认写成都市职场、冷灰写实或别的固定方案。
8. 输出要能直接拿去生成“专业设计稿”级别的参考图，不能只有几句简单外貌描述。
9. 如果信息不够，允许合理补全，但必须服务于“角色一致性、场景稳定复用、道具连续出现”。
10. 若剧本本身偏古风、幻想、悬疑、末日、喜剧、医疗、校园等题材，你必须跟着题材走，不得自行拉回都市职场。
11. subject_hints.characters 只是辅助线索，不代表最终角色名；最终角色名必须以剧本正文出现的人名为准。

角色 full_description 的推荐结构：
- 开头先定总质感：例如 8K画质、真实材质、超写实、电影级摄影。
- 再写人物静态属性：年龄、身高、体型、国籍或族裔、发型、脸型、眉眼鼻唇、肤色、服装、鞋、配饰。
- 再写专业设定稿版式：左区正脸特写；右区标准三视图，侧视/正视/背视完整无遮挡。
- 再写核心约束：特写与三视图必须是同一角色，五官/服装/配饰/体态保持100%一致。
- 再写拍摄与背景限制：背景、无阴影或阴影要求、镜头焦距、无畸变、平视、动作限制、表情限制、手持物限制。

场景 full_description 的推荐结构：
- 总质感 + 摄影语言。
- 空间类型、材质、主色调、照明方式、关键陈设。
- 景别、机位、是否有人物、画面中必须稳定复现的元素。

道具 full_description 的推荐结构：
- 总质感 + 摄影语言。
- 主体材质、颜色、结构细节、屏幕或表面信息。
- 正视/侧视/背视或三视图要求，纯背景或干净背景要求。

返回 JSON：
{
  "characters": [
    {
      "name": "角色名",
      "role": "角色定位",
      "gender": "female|male|neutral",
      "age_range": "年龄段",
      "personality": ["关键词1", "关键词2"],
      "appearance": "外形概述，强调服装、发型、体型、面部特征、气质",
      "wardrobe": "稳定服装描述",
      "visual_anchor": ["最稳定的视觉锚点1", "锚点2"],
      "full_description": "完整角色参考图描述，接近生产级提示词",
      "reference_prompt": "用于生成角色参考图的提示词",
      "continuity_prompt": "给后续分镜、画面、视频模型的人物一致性提示语，中文，写实真人风格",
      "negative_prompt": "必须避免的偏差，例如卡通脸、古装、年龄漂移、服装漂移",
      "voice_style": "更适合什么声音气质"
    }
  ],
  "scenes": [
    {
      "name": "场景名",
      "location": "场景地点",
      "description": "场景概述",
      "full_description": "完整场景参考图描述，接近生产级提示词",
      "reference_prompt": "用于生成场景参考图的提示词",
      "continuity_prompt": "场景一致性提示词",
      "negative_prompt": "这个场景应避免的问题"
    }
  ],
  "props": [
    {
      "name": "道具名",
      "description": "道具概述",
      "full_description": "完整道具参考图描述，接近生产级提示词",
      "reference_prompt": "用于生成道具参考图的提示词",
      "continuity_prompt": "道具一致性提示词",
      "negative_prompt": "这个道具应避免的问题"
    }
  ]
}

剧本工作稿：
${JSON.stringify(adaptation, null, 2)}
`.trim(),
  };
}

export function buildStoryboardMessages(adaptation, characters, settings = {}) {
  const ratio = settings.scriptRatio || settings.videoRatio || adaptation?.video_ratio || "9:16";
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
3. 画面风格统一为写实电影感真人剧，视频比例=${ratio}，适合短视频展示。
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
