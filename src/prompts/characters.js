import { getVoiceCatalog } from "../voice-catalog.js";

export function buildCharacterMessages(adaptation, settings = {}) {
  const style = settings.scriptStyle || settings.stylePreset || adaptation?.style_preset || "写实";
  const ratio = settings.scriptRatio || settings.videoRatio || adaptation?.video_ratio || "9:16";
  const voiceCatalog = getVoiceCatalog()
    .map((item) => `${item.label}（voiceType=${item.voiceType}；适合=${item.sceneTags.join("/") || "通用"}；气质=${item.styleTags.join("/") || "通用"}）`)
    .join("\n");
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
12. 所有主体参考图都必须是纯画面设计稿，禁止出现任何文字、数字、字母、标题、标签、批注、说明、对白、UI 截图、水印、logo、品牌字样、海报排版元素。
13. 每个角色都必须给出结构化 voice_profile，用于后续默认配音。voice_profile 必须从给定音色目录中选择一个最贴合角色气质和年龄的音色，不能自造音色名。

可选音色目录（必须精确使用其中的 label 和 voiceType）：
${voiceCatalog}

角色 full_description 的推荐结构：
- 开头先定总质感：例如 8K画质、真实材质、超写实、电影级摄影。
- 再写人物静态属性：年龄、身高、体型、国籍或族裔、发型、脸型、眉眼鼻唇、肤色、服装、鞋、配饰。
- 再写专业设定稿版式：左区正脸特写；右区标准三视图，侧视/正视/背视完整无遮挡。
- 再写核心约束：特写与三视图必须是同一角色，五官/服装/配饰/体态保持100%一致。
- 再写拍摄与背景限制：背景、无阴影或阴影要求、镜头焦距、无畸变、平视、动作限制、表情限制、手持物限制。
- 明确写出“画面内不能出现任何文字、标签、编号、logo、水印、UI”。

场景 full_description 的推荐结构：
- 总质感 + 摄影语言。
- 空间类型、材质、主色调、照明方式、关键陈设。
- 景别、机位、是否有人物、画面中必须稳定复现的元素。
- 明确写出“画面内不能出现任何文字、标题、屏幕字幕、水印、logo、海报字样”。

道具 full_description 的推荐结构：
- 总质感 + 摄影语言。
- 主体材质、颜色、结构细节、屏幕或表面信息。
- 正视/侧视/背视或三视图要求，纯背景或干净背景要求。
- 明确写出“除非剧情要求道具自身屏幕内容，否则画面内不能出现任何解释性文字、标签、水印、logo”。

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
      "voice_style": "更适合什么声音气质",
      "voice_profile": {
        "label": "从给定音色目录中选择的音色名",
        "voiceType": "与音色目录严格一致的 voiceType",
        "ageGroup": "young_adult|adult|mature",
        "sceneTags": ["适用场景1", "场景2"],
        "styleTags": ["声音气质1", "气质2"],
        "supportsEmotion": true,
        "emotion": "默认情绪，没有则空字符串",
        "speedRatio": 1,
        "volume": 5,
        "pitch": 1
      }
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
