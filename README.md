# 点众 AI 真人剧 Demo

围绕“点众科技 AI 漫剧/真人剧”的业务链路，构建一个最小可闭环 demo：

先创建项目，再输入一段剧情文本，按阶段依次完成剧情改编、角色设定、角色首图、分镜、画面生成、配音、字幕和输出合成，并保留每一步的中间结果。

## 为什么这样设计

- 业务层只描述“当前节点需要什么能力”，不直接绑死某个模型。
- 七牛/Sufy 大模型服务作为统一推理入口，文本、图像、语音都通过同一个 provider 管理。
- 每个节点都落盘，方便导师回看“用了哪个模型、输入是什么、输出效果怎样”。

## 当前实现

- 前端工作台：`Next.js App Router`
- 项目管理：左侧项目栏 + 项目详情工作台
- 文本节点：`/v1/chat/completions`
- 画面节点：`/v1/images/generations`
- 语音节点：`/v1/voice/tts`
- 视频合成：本地 `ffmpeg-static`
- 阶段执行：项目内按阶段递进执行，而不是整条链路一把执行

说明：

- 视频模型目前还没有接通。
- 当前只能输出“角色首图/镜头图 + 配音 + 字幕 + 合成”的静态镜头结果，用来验证前置链路是否跑通。
- 这不是成片，也不应该被当成成片对外表述。

## 快速运行

```bash
npm install
cp .env.example .env
npm run dev
```

打开：

```bash
[http://localhost:3000/projects](http://localhost:3000/projects)
```

旧的 CLI 方式仍然保留：

```bash
npm run demo
```

项目工作台的主要结构：

- `01-input/story.txt`
- `02-adaptation/adaptation.json`
- `03-characters/characters.json`
- `04-role-reference/*.png`
- `05-storyboard/storyboard.json`
- `06-images/*.png`
- `07-audio/*.mp3`
- `08-subtitles/subtitles.srt`
- `09-video/output.mp4`
- `manifest.json`
- `model-matrix.json`

默认输出目录：

```text
output/projects/<project-id>/
```

Provider 默认值：

- `MAAS_PROVIDER=qiniu` 时默认走 `https://api.qnaigc.com/v1`
- `MAAS_PROVIDER=sufy` 时默认走 `https://api.sufy.com/aitoken/v1`

## 模型切换与对比

在项目工作台中，每个阶段都可以切换模型。也可以直接在 `.env` 中修改默认值：

- `QINIU_TEXT_MODEL`
- `QINIU_TEXT_COMPARE_MODELS`
- `QINIU_IMAGE_MODEL`
- `QINIU_IMAGE_COMPARE_MODELS`

文本对比结果会保存在：

```text
output/runs/<timestamp>/comparisons/text/
```

图像对比结果会保存在：

```text
output/runs/<timestamp>/comparisons/image/
```

## 阶段与模型理解

当前仓库把“业务阶段”和“模型入口”分开处理。现在界面里是按阶段推进的：先输入故事，再执行剧本、角色、分镜、画面与配音、输出合成，最后保留视频模型阶段。

| 流程 | 当前默认调用 | 适合继续对比的模型方向 | 重点观察 |
| --- | --- | --- | --- |
| 剧本改编 / 剧情理解 | `openai/gpt-5.4-mini` | GPT-5.4、Gemini 2.5 Pro、MiniMax M 系列 | 结构化输出稳定性、剧情推进、人物关系准确性 |
| 角色设定 | `openai/gpt-5.4-mini` | GPT-5.4、Gemini 2.5 Pro | 人物标签是否清晰、是否利于后续画面一致性 |
| 角色首图 | `gemini-2.5-flash-image` | GPT Image 1、Imagen 4、MiniMax image 系列 | 真人感、稳定性、参考复用能力 |
| 镜头图 / 关键帧 | `gemini-2.5-flash-image` | Imagen 4、Gemini Flash Image、MiniMax image 系列 | 跨场景一致性、风格统一、提示词可控性 |
| 镜头视频生成 | 预留 `veo-3` 阶段，当前未真正启用 | Sora 2、Veo 3、Runway、Hailuo | 动作自然度、剧情连贯性、成本与速度 |
| 配音 / 旁白 | 七牛 `/voice/tts` + 音色配置 | GPT-4o mini TTS、Gemini TTS、MiniMax Speech | 中文自然度、情绪、角色区分度 |

## 适合演示的讲法

- 剧情改编、角色设定、分镜更适合文本模型。
- 角色首图和镜头图更适合图像模型，重点看角色一致性和镜头感。
- 真正连续镜头要靠视频模型，不应该继续伪装成“静帧拼接就是视频生成”。
- 配音更适合语音模型，重点看情绪和角色区分。
- 七牛 MAAS/Sufy 在这里承担统一模型接入层，业务代码不用散落地直连不同厂商。

## 当前工作台逻辑

- 左侧是项目列表，不再展示一堆历史 run。
- 中间是主工作区，顶部阶段标签切换 `剧本 / 主体 / 分镜 / 画面 / 成片`。
- 每个阶段执行完都能看当前结果，并允许手动修改 `adaptation / characters / storyboard`。
- 如果你修改上游阶段结果，下游阶段会自动失效，避免拿旧结果误判。
- 成片页同时保留 `静态合成` 和 `视频生成` 两种执行方式。

## 协作方式

- 需求和改进项放在 GitHub Issues。
- 具体改动通过分支和 Pull Request 推进。
- 当前路线图见 [docs/roadmap.md](docs/roadmap.md)。
- 模型阶段策略见 [docs/model-strategy.md](docs/model-strategy.md)。
