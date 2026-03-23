# 模型阶段策略

这个文档不等于“当前已经全部落地”，而是把业务链路里的模型职责拆清楚，方便展示时解释为什么不同节点不该混用同一类模型。

## 当前原则

- 先跑通最小闭环，再把单点质量逐步替换上去。
- 业务层只描述能力，不直接绑死某个具体厂商模型。
- 每个节点都保留输入、输出、模型选择和结果文件，便于回看。

## 阶段拆分

| 流程 | 当前默认调用 | 候选方向 | 说明 |
| --- | --- | --- | --- |
| 剧本改编 / 剧情理解 | `openai/gpt-5.4-mini` | GPT-5.4、Gemini 2.5 Pro、MiniMax M 系列 | 负责把原始剧情整理成结构化故事骨架 |
| 角色设定 | `openai/gpt-5.4-mini` | GPT-5.4、Gemini 2.5 Pro | 负责补齐角色人格、外观、连续性提示词 |
| 角色首图 | `gemini-2.5-flash-image` | GPT Image 1、Imagen 4、MiniMax image 系列 | 负责形成可反复复用的角色参考图 |
| 镜头图 / 关键帧 | `gemini-2.5-flash-image` | Imagen 4、Gemini Flash Image、MiniMax image 系列 | 负责单镜头画面与关键帧 |
| 镜头视频生成 | `veo-3` 模型位已预留 | Sora 2、Veo 3、Runway、Hailuo | 负责真正的连续镜头，不应和静帧合成混淆 |
| 配音 / 旁白 | 七牛 `/voice/tts` | GPT-4o mini TTS、Gemini TTS、MiniMax Speech | 负责多角色对白和旁白 |

## 当前限制

- 当前样片已经从“纯静帧拼接”升级为“静帧 + 轻运动合成”，但仍不是真正的视频生成。
- 七牛/Sufy 的模型广场页面可见 `GPT-5.4`、`Gemini 2.5 Pro`、`Gemini 2.5 Flash Image`、`MiniMax M1`、`Sora 2`、`Veo 3` 等方向，适合拿来解释分工。
- 真正的连续视频质量，需要后续把 `镜头视频生成` 这个阶段接成独立能力，而不是继续堆在 `ffmpeg` 上。
