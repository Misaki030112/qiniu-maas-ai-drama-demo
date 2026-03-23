# AI 真人剧 Demo

围绕“点众科技 AI 漫剧/真人剧”的业务链路，构建一个最小可闭环 demo：

输入一段剧情文本，依次完成剧情改编、角色设定、角色首图、分镜、画面生成、配音、字幕和视频合成，最终输出一条可播放的短样片，并保留每一步的中间结果。

## 为什么这样设计

- 业务层只描述“当前节点需要什么能力”，不直接绑死某个模型。
- 七牛/Sufy 大模型服务作为统一推理入口，文本、图像、语音都通过同一个 provider 管理。
- 每个节点都落盘，方便导师回看“用了哪个模型、输入是什么、输出效果怎样”。

## 当前实现

- 文本节点：`/v1/chat/completions`
- 画面节点：`/v1/images/generations`
- 语音节点：`/v1/voice/tts`
- 视频合成：本地 `ffmpeg-static`
- 工作台：本地 Node 服务，回看每次 run 的中间结果和最终样片

说明：

- 当前最终视频仍然不是“原生连续视频模型生成”，而是“角色首图/镜头图 + 配音 + 字幕 + 轻运动合成”。
- 这比纯静帧拼接更接近样片，但和真正的 `text-to-video` / `image-to-video` 还有明显差距。
- 仓库里已经给“镜头视频生成”预留了独立模型位，方便后续接入 `Veo 3`、`Sora 2` 等视频模型。

## 快速运行

```bash
npm install
cp .env.example .env
npm run demo
```

指定剧本文本：

```bash
node src/index.js --story input/story.txt
```

打开工作台：

```bash
npm run workbench
```

然后访问 [http://localhost:3210](http://localhost:3210)。

## 输出目录

每次运行都会生成一个新目录：

```text
output/runs/<timestamp>/
```

主要产物：

- `01-input/story.txt`
- `02-adaptation/adaptation.json`
- `03-characters/characters.json`
- `04-role-reference/*.png`
- `05-storyboard/storyboard.json`
- `06-images/*.png`
- `07-audio/*.mp3`
- `08-subtitles/subtitles.srt`
- `09-video/final-demo.mp4`
- `manifest.json`
- `model-matrix.json`

## 模型切换与对比

在 `.env` 中修改：

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

当前仓库把“业务阶段”和“模型入口”分开处理。实际默认模型优先选能跑通的组合，但也把你关心的模型类型整理成了阶段建议，方便演示时讲清楚为什么不同节点适合不同模型。

| 流程 | 当前默认调用 | 适合继续对比的模型方向 | 重点观察 |
| --- | --- | --- | --- |
| 剧本改编 / 剧情理解 | `openai/gpt-5.4-mini` | GPT-5.4、Gemini 2.5 Pro、MiniMax M 系列 | 结构化输出稳定性、剧情推进、人物关系准确性 |
| 角色设定 | `openai/gpt-5.4-mini` | GPT-5.4、Gemini 2.5 Pro | 人物标签是否清晰、是否利于后续画面一致性 |
| 角色首图 | `gemini-2.5-flash-image` | GPT Image 1、Imagen 4、MiniMax image 系列 | 真人感、稳定性、参考复用能力 |
| 镜头图 / 关键帧 | `gemini-2.5-flash-image` | Imagen 4、Gemini Flash Image、MiniMax image 系列 | 跨场景一致性、风格统一、提示词可控性 |
| 镜头视频生成 | 预留 `veo-3` 模型位，当前未真正启用 | Sora 2、Veo 3、Runway、Hailuo | 动作自然度、剧情连贯性、成本与速度 |
| 配音 / 旁白 | 七牛 `/voice/tts` + 音色配置 | GPT-4o mini TTS、Gemini TTS、MiniMax Speech | 中文自然度、情绪、角色区分度 |

## 适合演示的讲法

- 剧情改编、角色设定、分镜更适合文本模型。
- 角色首图和镜头图更适合图像模型，重点看角色一致性和镜头感。
- 真正连续镜头要靠视频模型，不应该继续伪装成“静帧拼接就是视频生成”。
- 配音更适合语音模型，重点看情绪和角色区分。
- 七牛 MAAS/Sufy 在这里承担统一模型接入层，业务代码不用散落地直连不同厂商。

## 协作方式

- 需求和改进项放在 GitHub Issues。
- 具体改动通过分支和 Pull Request 推进。
- 当前路线图见 [docs/roadmap.md](docs/roadmap.md)。
- 模型阶段策略见 [docs/model-strategy.md](docs/model-strategy.md)。
