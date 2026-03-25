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
