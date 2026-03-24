# OpenMAIC 项目模块分析

## 项目概述

**OpenMAIC**（Open Multi-Agent Interactive Classroom，开放多智能体交互课堂）是一个开源 AI 教育平台，基于 **Next.js 16 + React 19 + TypeScript + LangGraph + Tailwind CSS** 构建。其核心目标是：将任意主题或文档一键转换为沉浸式、交互式的 AI 课堂体验，由 AI 教师与 AI 同学共同完成讲授、讨论、白板绘图和语音讲解。

---

## 一、整体架构

```
OpenMAIC/
├── app/              # Next.js App Router：页面 + API 路由
├── components/       # React UI 组件
├── lib/              # 核心业务逻辑
├── configs/          # 全局配置常量
├── packages/         # 内部工具包（mathml2omml、pptxgenjs）
├── skills/           # OpenClaw 集成技能脚本
├── e2e/              # Playwright E2E 测试
├── tests/            # Vitest 单元测试
└── public/           # 静态资源
```

---

## 二、各模块详细分析

### 1. `app/` — 应用路由层（Next.js App Router）

#### 1.1 页面路由

| 路由 | 功能 |
|------|------|
| `app/page.tsx` | 首页：课堂生成入口，用户输入主题或上传材料 |
| `app/classroom/[id]/` | 课堂播放页：按课堂 ID 加载并播放已生成的课堂 |
| `app/generation-preview/` | 生成预览页：实时展示课堂生成进度与预览 |

#### 1.2 API 路由（`app/api/`，约 18 个端点）

| 端点 | 功能 |
|------|------|
| `/api/generate` | 场景内容生成流水线（大纲 + 场景 + 图片 + TTS）|
| `/api/generate-classroom` | 异步课堂生成任务提交与轮询 |
| `/api/chat` | 多智能体实时讨论（SSE 流式输出）|
| `/api/pbl` | 项目制学习（PBL）相关端点 |
| `/api/quiz-grade` | 测验实时 AI 评分与反馈 |
| `/api/parse-pdf` | PDF 文档解析（支持 MinerU 高级解析）|
| `/api/web-search` | 网络搜索（Tavily）|
| `/api/transcription` | 语音转文字（ASR）|
| `/api/azure-voices` | 获取 Azure TTS 可用声音列表 |
| `/api/classroom-media` | 课堂媒体资源管理 |
| `/api/proxy-media` | 媒体资源反向代理 |
| `/api/server-providers` | 服务端 AI 提供商配置查询 |
| `/api/verify-model` | 验证模型可用性 |
| `/api/verify-image-provider` | 验证图像生成提供商 |
| `/api/verify-pdf-provider` | 验证 PDF 解析提供商 |
| `/api/verify-video-provider` | 验证视频生成提供商 |
| `/api/health` | 服务健康检查 |

---

### 2. `lib/generation/` — 课堂内容生成引擎

两阶段流水线，将用户需求转化为完整课堂内容：

| 文件 | 功能 |
|------|------|
| `outline-generator.ts` | **Stage 1**：分析需求，生成结构化场景大纲 |
| `scene-generator.ts` | **Stage 2**：并行生成每个场景的详细内容（幻灯片/测验/交互/PBL）|
| `scene-builder.ts` | 根据大纲构建完整场景数据结构 |
| `action-parser.ts` | 解析 AI 输出的 Action 序列（语音、白板、动画等）|
| `pipeline-runner.ts` | 统一流水线调度器，管理各阶段进度与回调 |
| `generation-pipeline.ts` | 流水线统一导出入口 |
| `prompt-formatters.ts` | Prompt 格式化工具 |
| `interactive-post-processor.ts` | 交互式场景后处理（HTML 模拟器修正）|
| `json-repair.ts` | AI 输出 JSON 容错修复 |
| `prompts/` | Prompt 模板与片段（按场景类型分类）|

**支持场景类型**：`slide`（幻灯片）、`quiz`（测验）、`interactive`（HTML 交互模拟）、`pbl`（项目制学习）

---

### 3. `lib/orchestration/` — 多智能体编排引擎

基于 **LangGraph StateGraph** 实现的多智能体调度系统：

| 文件 | 功能 |
|------|------|
| `director-graph.ts` | 核心图结构：`START → director → agent_generate → director（循环）→ END` |
| `director-prompt.ts` | Director 决策 Prompt：决定下一个发言智能体 |
| `prompt-builder.ts` | 动态构建智能体 Prompt（含历史对话、角色信息）|
| `tool-schemas.ts` | 智能体可调用的工具 Schema 定义 |
| `ai-sdk-adapter.ts` | Vercel AI SDK 与 LangGraph 的适配层 |
| `stateless-generate.ts` | 无状态单次生成调用 |
| `registry/` | 智能体注册表（存储与类型定义）|

**调度策略**：
- 单智能体：纯代码逻辑，零 LLM 调用，第 0 轮直接派发
- 多智能体：LLM（Director）决策下一位发言者，支持快速路径（首轮触发指定智能体）

---

### 4. `lib/pbl/` — 项目制学习（PBL）模块

通过 MCP（Model Context Protocol）工具链，让 LLM 以 Agentic Loop 方式设计完整项目：

| 文件 | 功能 |
|------|------|
| `generate-pbl.ts` | PBL 项目生成主入口，驱动多步 LLM 工具调用循环 |
| `pbl-system-prompt.ts` | PBL 生成系统 Prompt |
| `types.ts` | PBL 相关类型定义 |
| `mcp/project-mcp.ts` | 管理项目基本信息（标题、描述）|
| `mcp/agent-mcp.ts` | 管理 PBL 中的智能体角色配置 |
| `mcp/issueboard-mcp.ts` | 管理议题看板（Issues）与工作流 |
| `mcp/mode-mcp.ts` | 管理 PBL 生成阶段状态机 |
| `mcp/agent-templates.ts` | 预置智能体模板（提问智能体、评判智能体等）|

---

### 5. `lib/playback/` — 课堂播放引擎

驱动课堂播放的状态机，管理播放进度与实时交互：
- 控制幻灯片切换、Action 队列执行节奏
- 支持暂停、跳转、实时用户介入
- 与 Action Engine 协同执行具体动作

---

### 6. `lib/action/` — Action 执行引擎

执行 28+ 种课堂动作类型：

| 动作类别 | 具体动作 |
|----------|----------|
| 语音 | TTS 语音合成与播放 |
| 白板 | 绘图、写文字、画图形、画图表、清除 |
| 舞台效果 | 聚光灯（Spotlight）、激光笔（Laser）|
| 场景控制 | 场景切换、元素显隐、动画触发 |

---

### 7. `lib/audio/` — 音频处理模块

| 文件 | 功能 |
|------|------|
| `tts-providers.ts` | TTS 提供商适配（Azure、OpenAI、浏览器原生等）|
| `asr-providers.ts` | ASR 语音识别提供商适配 |
| `voice-resolver.ts` | 根据语言/角色解析最优声音 |
| `tts-utils.ts` | TTS 工具函数 |
| `browser-tts-preview.ts` | 浏览器端 TTS 实时预览 |
| `use-tts-preview.ts` | TTS 预览 React Hook |
| `azure.json` | Azure 支持的声音列表数据 |

---

### 8. `lib/ai/` — AI 提供商抽象层

| 文件 | 功能 |
|------|------|
| `llm.ts` | 统一 LLM 调用入口，封装 Vercel AI SDK |
| `providers.ts` | 多提供商注册与切换（OpenAI、Anthropic、Google、DeepSeek、Grok 等）|
| `thinking-context.ts` | 链式思维（Chain-of-Thought）上下文管理 |

---

### 9. `lib/store/` — 全局状态管理（Zustand）

| 文件 | 功能 |
|------|------|
| `stage.ts` | 舞台核心状态（场景列表、当前场景、播放状态）|
| `canvas.ts` | 画布状态（元素位置、选中状态）|
| `whiteboard-history.ts` | 白板操作历史（撤销/重做）|
| `media-generation.ts` | 媒体生成任务状态 |
| `settings.ts` | 用户设置（模型、提供商、语言等）|
| `snapshot.ts` | 舞台快照（用于导出）|
| `keyboard.ts` | 键盘快捷键状态 |
| `user-profile.ts` | 用户档案状态 |

---

### 10. `lib/export/` — 导出模块

支持将课堂内容导出为多种格式：

| 文件 | 功能 |
|------|------|
| `use-export-pptx.ts` | 导出 `.pptx` 可编辑幻灯片（基于内部 pptxgenjs 包）|
| `latex-to-omml.ts` | LaTeX 公式转 OMML（Office 数学标记语言）|
| `html-parser/` | HTML 解析工具（用于交互式场景导出）|
| `svg-path-parser.ts` | SVG 路径解析（用于矢量图形导出）|
| `svg2base64.ts` | SVG 转 Base64 编码 |

---

### 11. `lib/api/` — Stage API 抽象层

为 AI 智能体提供操作舞台的统一 API：

| 文件 | 功能 |
|------|------|
| `stage-api.ts` | Stage API 主入口 |
| `stage-api-canvas.ts` | 画布元素操作 API |
| `stage-api-element.ts` | 元素增删改查 |
| `stage-api-scene.ts` | 场景切换与查询 API |
| `stage-api-navigation.ts` | 场景导航 API |
| `stage-api-mode.ts` | 模式切换 API（播放/编辑）|
| `stage-api-whiteboard.ts` | 白板操作 API |
| `stage-api-defaults.ts` | 默认值与工厂方法 |

---

### 12. `lib/storage/` — 持久化存储模块

基于 **Dexie（IndexedDB）** 实现本地持久化：

| 文件 | 功能 |
|------|------|
| `classroom-storage.ts` | 课堂数据存储（场景、元素、媒体）|
| `image-storage.ts` | 生成图片的本地缓存 |
| `chat-storage.ts` | 对话历史持久化 |
| `playback-storage.ts` | 播放进度与状态缓存 |
| `stage-storage.ts` | 舞台状态快照存储 |
| `database.ts` | Dexie 数据库实例与 Schema 定义 |

---

### 13. `lib/web-search/` — 网络搜索模块

集成 **Tavily** 搜索服务，为 AI 智能体提供实时网络搜索能力：
- `tavily.ts`：Tavily API 客户端封装
- `constants.ts`：搜索相关常量
- `types.ts`：搜索结果类型定义

---

### 14. `lib/pdf/` — PDF 解析模块

| 文件 | 功能 |
|------|------|
| `pdf-providers.ts` | PDF 解析提供商适配（内置 unpdf、MinerU 高级解析）|
| `pdf-parser.ts` | PDF 内容提取与结构化处理 |
| `types.ts` | PDF 相关类型定义 |

支持将 PDF 文档转化为课堂生成的输入材料，MinerU 提供高质量 OCR 和公式识别。

---

### 15. `lib/i18n/` — 国际化模块

基于 **next-intl** 实现多语言支持：
- 支持中文、英文等多语言界面
- 翻译文件位于 `messages/` 目录
- Action 翻译由 `lib/chat/action-translations.ts` 处理

---

### 16. `components/` — UI 组件层

#### 16.1 核心场景组件

| 目录/文件 | 功能 |
|-----------|------|
| `components/stage.tsx` | 舞台主容器，统筹渲染所有子组件 |
| `components/stage/` | 舞台内部子组件（控制栏、场景列表等）|
| `components/canvas/` | 画布与元素渲染系统 |
| `components/slide-renderer/` | 幻灯片渲染引擎 |
| `components/scene-renderers/` | 各类型场景渲染器（quiz、interactive、pbl）|
| `components/whiteboard/` | 白板绘图组件 |

#### 16.2 AI 交互组件

| 目录/文件 | 功能 |
|-----------|------|
| `components/chat/` | 多智能体对话界面（消息流、输入框）|
| `components/agent/` | 智能体头像、配置面板、角色管理 |
| `components/ai-elements/` | AI 输出元素（代码块、链式思维、引用、连接线、图像等）|
| `components/roundtable/` | 圆桌讨论组件（多智能体集体场景）|

#### 16.3 功能组件

| 目录/文件 | 功能 |
|-----------|------|
| `components/audio/` | 音频播放与录音组件 |
| `components/generation/` | 课堂生成进度面板 |
| `components/settings/` | 设置面板（模型、提供商、语音、主题等）|
| `components/header.tsx` | 顶部导航栏 |
| `components/user-profile.tsx` | 用户档案组件 |
| `components/server-providers-init.tsx` | 服务端提供商初始化组件 |
| `components/ui/` | 基础 UI 原子组件库（Button、Dialog、Select 等 30+ 组件）|

---

### 17. `configs/` — 全局配置

| 文件 | 功能 |
|------|------|
| `server.ts` | 服务端配置（API 密钥、提供商 URL）|
| `storage.ts` | 存储配置（数据库名称、版本）|
| `symbol.ts` | 全局符号/常量定义 |
| `theme.ts` | 主题配置（颜色、字体）|

---

### 18. `packages/` — 内部工具包

| 包 | 功能 |
|----|------|
| `packages/pptxgenjs/` | 定制版 pptxgenjs，支持将课堂幻灯片导出为标准 `.pptx` 文件 |
| `packages/mathml2omml/` | MathML → OMML 转换器，确保数学公式在 Word/PowerPoint 中正确显示 |

---

### 19. `skills/openmaic/` — OpenClaw 集成技能

为 [OpenClaw](https://github.com/openclaw/openclaw) 框架提供的自动化 SOP 技能脚本，允许用户在 Feishu、Slack、Telegram 等聊天软件中直接操控 OpenMAIC：

| 文件 | 功能 |
|------|------|
| `SKILL.md` | 技能入口与阶段 SOP 定义 |
| `references/clone.md` | 引导克隆仓库与安装依赖 |
| `references/startup-modes.md` | 引导选择启动模式（dev / build / docker）|
| `references/provider-keys.md` | 引导配置 AI 提供商密钥 |
| `references/hosted-mode.md` | 托管模式（access code）使用引导 |

---

### 20. `e2e/` & `tests/` — 测试模块

| 目录 | 工具 | 说明 |
|------|------|------|
| `e2e/` | Playwright | 端到端浏览器测试（页面、fixtures、test cases）|
| `tests/server/` | Vitest | 服务端逻辑单元测试 |
| `tests/store/` | Vitest | Zustand Store 单元测试 |

---

## 三、模块依赖关系图

```
用户界面 (components/)
    │
    ├── 舞台 (stage) ←→ Zustand Store (lib/store/)
    │       │
    │       ├── 播放引擎 (lib/playback/)
    │       │       └── Action 引擎 (lib/action/)
    │       │               ├── 音频 (lib/audio/) → TTS/ASR 提供商
    │       │               └── 白板 (components/whiteboard/)
    │       │
    │       └── 场景渲染 (components/scene-renderers/)
    │
    ├── 对话界面 (components/chat/) ←→ 多智能体编排 (lib/orchestration/)
    │                                       └── AI 抽象层 (lib/ai/)
    │                                               └── LLM 提供商 (OpenAI/Anthropic/Google…)
    │
    └── 生成面板 (components/generation/) ←→ 生成引擎 (lib/generation/)
                                                    ├── outline-generator (Stage 1)
                                                    ├── scene-generator (Stage 2, 并行)
                                                    ├── PBL 生成 (lib/pbl/)
                                                    └── PDF 解析 (lib/pdf/)

API 层 (app/api/) ←→ 持久化 (lib/storage/) ←→ IndexedDB (Dexie)
                  ←→ 网络搜索 (lib/web-search/) ←→ Tavily
                  ←→ 导出 (lib/export/) → .pptx / .html

OpenClaw (skills/) → app/api/generate-classroom → 生成引擎
```

---

## 四、技术栈汇总

| 层次 | 技术 |
|------|------|
| 框架 | Next.js 16 (App Router) + React 19 + TypeScript |
| UI 样式 | Tailwind CSS 4 + Radix UI + shadcn/ui |
| 状态管理 | Zustand 5 + Immer |
| AI/LLM | Vercel AI SDK 6 + LangGraph（LangChain）|
| 多智能体 | LangGraph StateGraph + CopilotKit |
| 本地存储 | Dexie (IndexedDB) |
| 音频 | Azure TTS / OpenAI TTS / 浏览器原生 TTS |
| 导出 | pptxgenjs (定制版) + MathML2OMML |
| PDF 解析 | unpdf + MinerU |
| 网络搜索 | Tavily |
| 测试 | Vitest + Playwright |
| 部署 | Vercel / Docker Compose |
