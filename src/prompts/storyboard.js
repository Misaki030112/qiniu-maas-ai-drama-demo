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
请根据剧情骨架和角色设定，输出适合“镜头组 + 分镜行”结构的智能分镜。

要求：
1. 角色名只能使用角色设定里已有的名字。
2. 顶层先拆成 4 到 6 个“镜头组”，每个镜头组对应一段剧情原句或动作单元。
3. 每个镜头组下至少有 1 条分镜行，必要时可拆成 2 到 3 条分镜行。
4. 镜头组之间必须有因果推进，不是静态拼图。
5. 画面风格统一为写实电影感真人剧，视频比例=${ratio}，适合短视频展示。
6. 台词要短，能直接拿去配音和字幕。
7. 每条分镜最好 4 到 7 秒。
8. image_prompt 偏静帧生成，video_prompt 偏连续动作生成。
9. 如果镜头里有人物动作，必须写清楚动作起点和动作终点。
10. 每条分镜行必须尽量填完整：场景、景别、构图、运镜、光影、分镜描述、音效、对白、时长。
11. 每条分镜行必须显式给出 subject_refs，列出这条镜头会用到的角色/场景/道具。后续进入故事板时，这些主体要默认被选中。
12. 如果镜头里有人物对白，speaker 必须填写角色名，并尽量让 subject_refs 中包含该角色。

返回 JSON：
{
  "style_guide": {
    "visual_style": "统一视觉风格",
    "continuity_rules": ["角色一致性规则1", "规则2"],
    "negative_prompt": "全局负面提示词"
  },
  "groups": [
    {
      "group_id": "group_1",
      "title": "镜头1",
      "source_text": "这一组对应的剧情原句或剧情段落",
      "items": [
        {
          "item_id": "1-1",
          "shot_no": "1-1",
          "scene_name": "科技会议室",
          "shot_size": "近景",
          "composition": "中心构图",
          "camera_move": "固定镜头",
          "lighting": "高对比侧光，人物面部明暗反差明显",
          "shot_description": "这一条分镜具体拍什么",
          "sound_fx": "环境音或音效",
          "dialogue": "这一条分镜的对白，没有就写空字符串",
          "speaker": "说话人，没有就写旁白或空字符串",
          "subject_refs": [
            {
              "kind": "character|scene|prop",
              "key": "必须与角色设定/场景设定/道具设定中的 name 完全一致"
            }
          ],
          "duration_sec": 4,
          "image_prompt": "完整中文静帧提示词",
          "video_prompt": "完整中文视频提示词",
          "negative_prompt": "这一条分镜应避免的问题"
        }
      ]
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
