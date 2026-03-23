# AI 真人剧 Demo

围绕“点众科技 AI 漫剧/真人剧”的业务链路，构建一个最小可闭环 demo：

输入一段剧情文本，依次完成剧情改编、角色设定、分镜、画面生成、配音、字幕和视频合成，最终输出一条可播放的短样片，并保留每一步的中间结果。

## 为什么这样设计

- 业务层只描述“当前节点需要什么能力”，不直接绑死某个模型。
- 七牛/Sufy 大模型服务作为统一推理入口，文本、图像、语音都通过同一个 provider 管理。
- 每个节点都落盘，方便导师回看“用了哪个模型、输入是什么、输出效果怎样”。

## 当前实现

- 文本节点：`/v1/chat/completions`
- 画面节点：`/v1/images/generations`
- 语音节点：`/v1/voice/tts`
- 视频合成：本地 `ffmpeg-static`

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

## 输出目录

每次运行都会生成一个新目录：

```text
output/runs/<timestamp>/
```

主要产物：

- `01-input/story.txt`
- `02-adaptation/adaptation.json`
- `03-characters/characters.json`
- `04-storyboard/storyboard.json`
- `05-images/*.png`
- `06-audio/*.mp3`
- `07-subtitles/subtitles.srt`
- `08-video/final-demo.mp4`
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

## 适合演示的讲法

- 剧情改编、角色设定、分镜更适合文本模型。
- 画面生成更适合图像模型，重点看角色一致性和镜头感。
- 配音更适合语音模型，重点看情绪和角色区分。
- 七牛 MAAS/Sufy 在这里承担统一模型接入层，业务代码不用散落地直连不同厂商。
