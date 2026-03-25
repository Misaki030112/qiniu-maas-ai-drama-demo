# AI 漫剧工作站

一个面向内容团队的 AI 漫剧一站式工作站。

目标不是做“单次脚本调用 demo”，而是把故事输入、剧本改编、角色设定、分镜、画面、配音、视频生成、成片输出放进同一个项目工作台里，让每一步都有结果、上下文和可回看记录。

当前版本只支持接入七牛云 MaaS。

## 产品定位

- 面向“AI 漫剧”生产链路，而不是通用聊天应用。
- 面向项目制协作，而不是一次性 run 完就结束的脚本。
- 面向可回看、可重试、可替换模型的工作流，而不是黑盒生成。

## 当前能力

- 项目工作台：创建项目、保存故事文本、按阶段推进。
- 文本阶段：剧情改编、角色设定、分镜生成。
- 图片阶段：角色参考图、镜头图、带参考图生图。
- 语音阶段：镜头配音、音频预览。
- 视频阶段：按模型能力生成镜头视频，支持部分首帧、尾帧、参考图模式。
- 输出阶段：本地合成、字幕、音视频资产管理。
- 模型目录：基于七牛云 MaaS MCP / OAS 种子写入数据库，不再运行时在线抓取。

## 当前边界

- 当前只维护七牛云 MaaS 接入，不承诺其他 provider。
- 不同模型是否可用，取决于你的七牛账户开通情况和额度。
- 视频链路已经接入，但具体可用模型、分辨率、音频能力仍受上游接口约束。
- `eslint` 目前没有装进仓库，`npm run lint` 不能作为准入项。

## 技术结构

- 前端：Next.js App Router
- 后端：Next.js Route Handlers
- 数据库：PostgreSQL
- 本地合成：ffmpeg-static
- 可选对象存储：阿里云 OSS
- 模型接入层：按文本 / 语音 / 生图 / 视频拆分 adapter

关键目录：

- `app/`: 页面和 API
- `src/project-pipeline.js`: 项目执行编排
- `src/providers/`: 模型调用适配层
- `src/prompts/`: 按阶段拆分的提示词构建器
- `src/model-catalog.js`: 模型目录入库与读取
- `src/model-catalog-seed.js`: 七牛 MaaS 模型种子
- `scripts/`: 数据初始化和历史脚本工具
- `test/`: 按模型家族拆分的集成测试

## 模型接入层

当前模型调用层已经按能力拆分：

- 文本：`src/providers/text-runtime.js`
- 语音：`src/providers/speech-runtime.js`
- 图片：`src/providers/image-runtime.js` 和 `src/providers/image/*`
- 视频：`src/providers/video-runtime.js` 和 `src/providers/video/*`
- 公共 HTTP / 错误处理：`src/providers/runtime-http.js`
- 模型分类：`src/providers/model-classification.js`

设计原则：

- 业务层不直接拼 endpoint。
- 每个模型家族有单独 adapter。
- 通用 transport、错误归一化、请求发送下沉到公共层。
- 模型目录按 `category / family / capabilities` 管理。

## 快速开始

```bash
npm install
cp .env.example .env
npm run db:init
npm run dev
```

模型列表只从数据库读取。`model_catalog` 为空时，工作台不会显示任何可选模型。

打开：

```text
http://localhost:3000/projects
```

## 必要环境变量

最少需要配置：

- `QINIU_API_KEY`
- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`

常用可选项：

- `QINIU_BASE_URL`
- `APP_BASE_URL`
- `ALIYUN_OSS_ENABLED`
- `ALIYUN_OSS_ACCESS_KEY_ID`
- `ALIYUN_OSS_ACCESS_KEY_SECRET`
- `ALIYUN_OSS_BUCKET`
- `ALIYUN_OSS_PUBLIC_BASE_URL`

## 数据与输出

项目数据：

```text
.data/projects/
```

项目输出：

```text
output/projects/<project-id>/
```

典型产物结构：

- `01-input/story.txt`
- `02-adaptation/adaptation.json`
- `03-characters/characters.json`
- `04-role-reference/`
- `05-storyboard/storyboard.json`
- `06-images/`
- `07-audio/`
- `08-subtitles/`
- `09-video/`
- `10-video-model/`
- `manifest.json`
- `model-matrix.json`

## 数据库初始化与模型目录

初始化数据库并写入模型目录：

```bash
npm run db:init
```

模型目录当前不是运行时去七牛接口抓取，而是基于仓库内的种子写入数据库。这样做有两个目的：

- 避免线上接口波动污染工作台的模型选项。
- 让模型分类、能力标签、适配族和测试保持一致。

数据库中的 `model_catalog` 目前包含：

- `model_id`
- `display_name`
- `provider`
- `category`
- `family`
- `capabilities`
- `source`
- `metadata`

## 测试

运行测试：

```bash
npm test
```

当前测试直接使用真实 `QINIU_API_KEY` 调用线上接口，不再使用本地 mock server：

- 文本测试会真实调用七牛文本模型并校验结构化 JSON。
- 语音测试会真实调用 `/voice/tts` 并校验返回音频。
- 图片测试会使用 OSS 上的真实参考图调用图片模型并校验返回二进制图片。
- 视频测试会读取 OSS 上的真实首帧图片，真实创建远程任务并校验状态查询链路。
- 模型目录写库测试仍保留本地数据库逻辑校验。

如需重传测试图片到 OSS：

```bash
npm run test:assets:sync
```

测试文件示例：

- `test/providers.text.live.integration.test.js`
- `test/providers.speech.live.integration.test.js`
- `test/providers.image.live.integration.test.js`
- `test/providers.video.live.integration.test.js`
- `test/model-catalog.seed.integration.test.js`
- `test/model-catalog.write.integration.test.js`
- `test/model-catalog.read.integration.test.js`

构建校验：

```bash
npm run build
```

## 适合怎么介绍这个项目

一句话版本：

“这是一个接入七牛云 MaaS 的 AI 漫剧工作站，把故事到成片的关键制作节点放进同一个项目工具里。”

更准确一点的版本：

“它不是单一模型 demo，而是一个面向 AI 漫剧生产的项目工作台。文本、图片、语音、视频都通过统一的模型接入层管理，所有中间结果会被保存，方便创作、比对和重跑。”

## 历史脚本

仓库里仍保留了一条离线演示脚本链路，但它已经迁到 `scripts/legacy-demo.js`，不再作为产品主入口：

```bash
npm run legacy:demo
```

## 后续重点

- 继续补每个视频模型族的约束测试和失败路径测试。
- 继续清理业务编排层里与模型请求细节耦合的逻辑。
- 继续收缩历史脚本与工作台主链路之间的重复实现。
