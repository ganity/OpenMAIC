# OpenMAIC 实施设计文档：跨设备播放与编辑模式

## 1. 文档目标

本文档聚焦两个产品化方向：

1. 跨设备播放：让生成课件可通过 URL 在其他设备稳定播放
2. 编辑模式：让课件进入类似 PPT 的修改流程

同时补充两份开发任务清单：

- 选项 1：《跨设备播放实施清单》
- 选项 2：《编辑模式实施清单》

本文分析尽量基于当前仓库已有代码能力，而不是抽象设计。

---

## 2. 当前代码基础判断

### 2.1 跨设备播放相关基础

当前 `app/classroom/[id]/page.tsx` 的加载逻辑是：

1. 先调用 `useStageStore().loadFromStorage(classroomId)` 从浏览器本地加载
2. 如果本地没有，再请求 `/api/classroom?id=...` 从服务端回退加载

这说明当前系统已经不是“纯浏览器本地播放”，而是：

- 本地 IndexedDB 优先
- 服务端 JSON 存储兜底

同时，`lib/server/classroom-storage.ts` 已经存在明确的服务端课件持久化能力：

- `CLASSROOMS_DIR = data/classrooms`
- `persistClassroom(...)`
- 返回 `url: ${baseUrl}/classroom/${id}`

这说明”分享播放 URL”在架构上已经有雏形。

**重要补充：当前存在两条完全不同的生成路径，跨设备能力差异显著：**

- **服务端生成路径**：`POST /api/generate-classroom` → `classroom-job-runner` → `classroom-generation.ts`，生成完成后已调用 `persistClassroom()`，服务端有数据，该路径天然支持跨设备。
- **前端流式生成路径**：`use-scene-generator.ts` → 逐个调用 `/api/generate/scene-content`、`/api/generate/scene-actions`，生成结果写入 IndexedDB，**没有任何地方调用服务端持久化**，`onComplete` 回调只触发媒体生成，不写服务端。前端流式生成的课件在跨设备场景下完全无效。

前端流式生成是当前主要的用户侧路径，修复这一遗漏是跨设备方案 Phase 1 的最高优先任务。

### 2.2 编辑模式相关基础

当前类型中：

```ts
export type StageMode = 'autonomous' | 'playback';
```

说明正式的 `edit` 模式还没有建立。

但同时，已有明显的编辑器基础设施：

- `components/stage/scene-renderer.tsx`
- `components/slide-renderer/Editor`
- `lib/store/stage.ts` 已支持 `updateScene/addScene/deleteScene/setMode`
- `components/canvas/canvas-area.tsx` 已有舞台容器与工具栏承载区
- `lib/prosemirror/*` 说明已有富文本能力

结论：

- 当前页面更像“播放器 + 渲染器”
- 但底层已具备向编辑器演进的基础

---

## 3. 方案 A：跨设备播放实施设计

### 3.1 现状问题本质

当前不能天然跨设备播放，不是因为没有 URL，而是因为“资产持久化不完整”。

#### 问题 A：不是所有课堂都一定落服务端

浏览器侧 Dexie 当前存了大量数据：

- `stages`
- `scenes`
- `generatedAgents`
- `mediaFiles`
- `audioFiles`
- `imageFiles`
- `chatSessions`
- `playbackState`
- `stageOutlines`

如果某个课堂只存在本地 IndexedDB，那么把 `/classroom/:id` 发到另一台设备是没有意义的。

#### 问题 B：服务端当前只保存了 stage + scenes

当前 `PersistedClassroomData` 主要是：

- `id`
- `stage`
- `scenes`
- `createdAt`

但完整播放往往还依赖：

- 图片/视频资源
- TTS 音频
- generated agents
- 某些续生成信息

**补充说明：agents 的跨设备行为需区分两种模式：**

- **preset 模式**：agentIds 保存在 `stage.agentIds` 中，服务端 stage 已包含该字段，preset 模式实际上已可跨设备恢复，无需额外工作。
- **auto 模式（生成的 agents）**：完全存储在 IndexedDB 的 `generatedAgents` 表中，跨设备时会静默降级为 preset 模式，用户不会收到提示但功能有所缺失。

#### 问题 C：媒体 placeholder 跨设备静默失败

`lib/utils/database.ts` 中可见：

- `mediaFiles.blob`
- `audioFiles.blob`
- `imageFiles.blob`

虽然 schema 中已有：

- `ossKey`
- `posterOssKey`

但说明当前更像“具备 OSS 扩展位”，未必已经形成完整发布链路。

更严重的问题在于：`lib/utils/stage-storage.ts` 加载媒体时，会把 scene 中的 `elementId` 格式 placeholder 从 IndexedDB 的 `mediaFiles` 表查找对应 blob，再转为 `URL.createObjectURL(blob)`。这意味着服务端保存的 scenes 里，媒体 src 存的是 placeholder 字符串而非真实 URL。跨设备打开时这些 placeholder 无法解析，图片/视频会静默显示为空白，不会有任何错误提示，比“媒体可能不完整”更严重。

### 3.2 目标架构

建议将分享课件抽象为服务端资产包：

```ts
interface ClassroomPackage {
  id: string;
  stage: Stage;
  scenes: Scene[];
  agents?: AgentConfig[];
  outlines?: SceneOutline[];
  mediaManifest?: unknown;
  audioManifest?: unknown;
  createdAt: string;
  updatedAt?: string;
  version?: number;
  status?: 'draft' | 'published';
}
```

核心原则：

1. 分享 URL 只依赖服务端可还原数据
2. 本地 IndexedDB 仅承担草稿/缓存/恢复职责
3. 媒体必须从本地 blob 转为可访问 URL

### 3.3 分阶段实施

#### Phase 1：最小可用跨设备播放

目标：让 URL 在其他设备至少能打开 stage + scenes。

要做的事：

1. **【最高优先】修复前端流式生成路径的服务端持久化缺失**
   - `use-scene-generator.ts` 的 `onComplete` 中增加调用 `POST /api/classroom`，把当前 stage + scenes 写服务端
   - 服务端生成路径（`classroom-generation.ts`）已正确调用 `persistClassroom()`，无需改动
   - 这是让前端生成课件具备基本跨设备能力的最小改动
2. 调整 `app/classroom/[id]/page.tsx` 加载优先级
   - **前提：** 必须在步骤 1 完成后才能改为“服务端优先，本地补充”
3. 增加“已发布/未发布”概念
   - `draft`：仅本地可见
   - `published`：服务端可分享

阶段结果：

- 别的设备可打开课件结构（stage + scenes）
- 媒体 placeholder 无法解析，图片/视频静默显示为空白（Phase 2 解决）
- preset 模式 agents 已可恢复；auto 模式 agents 静默降级为 preset（Phase 2 解决）

#### Phase 2：稳定跨设备播放

目标：让跨设备播放尽量完整。

要做的事：

1. 将媒体 placeholder 转为服务端可访问 URL：发布时把 IndexedDB blob 转存服务端或 OSS，回写 scene 中的 src
2. 发布时生成 `mediaManifest` / `audioManifest`
3. 持久化 auto 模式的 generated agents 到服务端 package（preset 模式已自动恢复，无需处理）
4. 页面播放时优先读取服务端 assets，而不是依赖本地 Dexie 恢复

阶段结果：

- 课件、媒体、Agent 基本都可跨设备恢复
- auto 模式 agents 可正确恢复，不再静默降级

#### Phase 3：产品化发布能力

目标：让分享 URL 成为正式资产。

增加：

- 访问权限（公开/私有/token）
- 有效期
- 版本号
- 发布历史
- 草稿与正式版分离

---

## 4. 方案 A 技术实现建议

### 4.1 关键改造点

#### 4.1.0 【最高优先】修复前端流式生成路径的持久化缺失

当前 `use-scene-generator.ts` 的 `onComplete` 回调只触发媒体生成，不写服务端。需要在此处调用 `POST /api/classroom`，将 stage + scenes 写入服务端。

涉及文件：`lib/hooks/use-scene-generator.ts`

注意：服务端生成路径（`lib/server/classroom-generation.ts`）已正确调用 `persistClassroom()`，无需改动。

#### 4.1.1 服务端数据结构扩展

建议扩展 `lib/server/classroom-storage.ts` 的持久化结构：

- 现状：`stage + scenes`
- 建议增加：`agents + mediaManifest + audioManifest + status + version`

#### 4.1.2 页面加载策略调整

**前提：必须先完成 4.1.0 的前端流式生成路径修复，否则改为服务端优先会导致前端生成的本地草稿无法访问。**

`app/classroom/[id]/page.tsx` 建议改为：

1. 先请求 `/api/classroom?id=...`
2. 服务端有数据则直接使用
3. 没有时再尝试本地 `loadFromStorage`
4. 如果本地存在但服务端不存在，则标记为 draft

#### 4.1.3 媒体归一化发布

发布时增加一步：

- 扫描 scenes 中引用的资源
- 如果还是本地 blob，则上传/转存
- 回写为服务端 URL
- 产出 manifest

#### 4.1.4 编辑模式与持久化的兼容性

**本地 IndexedDB 层天然支持编辑，无需改造。**

`saveStageData` 每次执行时先删除旧 scenes 再全量 bulkPut，`updateScene` / `addScene` / `deleteScene` 都会触发 `debouncedSave`，编辑结果自动持久化到 IndexedDB，无需为编辑模式单独处理本地保存。

**服务端层完全不支持编辑，需要新增更新接口。**

当前服务端只有一次性写入，没有更新语义。编辑后的内容无法同步到服务端，导致分享 URL 始终是生成时的旧版本。需要：

- 新增 `PUT /api/classroom`，支持更新 stage + scenes（全量覆盖即可）
- 编辑完成后显式触发服务端同步（而非依赖 debouncedSave，debouncedSave 只写 IndexedDB）

**加载优先级改造后的编辑内容覆盖风险。**

一旦 `page.tsx` 改为服务端优先加载，若用户在本地编辑了内容但未同步服务端，下次打开时服务端旧版本会覆盖本地修改。解决方案：加载时比较服务端 `updatedAt` 与本地 IndexedDB `updatedAt`，本地更新时间更新时提示用户选择保留哪个版本，而不是静默覆盖。

### 4.2 建议涉及的文件

重点文件：

- `app/classroom/[id]/page.tsx`
- `app/api/classroom/route.ts`（需新增 PUT 更新接口）
- `lib/server/classroom-storage.ts`（需新增 updateClassroom 方法）
- `lib/hooks/use-scene-generator.ts`（onComplete 补充写服务端）
- `lib/utils/stage-storage.ts`（加载时增加 updatedAt 冲突检测）
- `lib/utils/database.ts`
- `lib/media/*`
- `lib/utils/image-storage.ts`

### 4.3 风险

1. **前端流式生成路径未写服务端**（当前已存在，Phase 1 最高优先修复）
2. 媒体 placeholder 跨设备静默失败：scene 中媒体 src 是 elementId 格式字符串，跨设备时无法解析，图片/视频静默显示为空白
3. **编辑后本地与服务端数据不一致**：服务端优先加载改造完成后，本地未同步的编辑内容会被服务端旧版本静默覆盖，需通过 updatedAt 冲突检测解决
4. 本地与服务端双写一致性（前端生成写服务端后引入）
5. 生成尚未完成时被提前分享
6. auto 模式 agents 跨设备静默降级为 preset 模式，用户无提示
7. published 与 draft 混淆，造成用户理解错误

---

## 5. 选项 1：《跨设备播放实施清单》

### 5.1 数据与存储层任务

- [ ] 扩展 `PersistedClassroomData` 为服务端 `ClassroomPackage`
- [ ] 为 package 增加 `status: draft | published`
- [ ] 为 package 增加 `version`
- [ ] 增加 `agents` 服务端持久化字段
- [ ] 增加 `mediaManifest` 服务端持久化字段
- [ ] 增加 `audioManifest` 服务端持久化字段
- [ ] 设计媒体资源从本地 blob 到 URL 的映射规则

### 5.2 API 层任务

- [ ] 检查并补强 `app/api/classroom/route.ts` 的 GET 返回结构
- [ ] 增加发布接口：如 `POST /api/classroom/publish`
- [ ] 增加草稿保存接口：如 `PUT /api/classroom`
- [ ] 增加课堂元数据读取接口（状态/版本/时间）
- [ ] 增加服务端 package 完整性校验

### 5.3 前端播放层任务

- [ ] 修改 `app/classroom/[id]/page.tsx` 为服务端优先加载
- [ ] 为服务端缺失、本地存在的情况显示 draft 提示
- [ ] 为资源缺失场景增加降级 UI
- [ ] 调整加载时序，避免先加载本地再被服务端覆盖造成闪烁
- [ ] 明确 URL 分享只对应 published 版本

### 5.4 媒体层任务

- [ ] 梳理当前图片/视频/音频生成后存储链路
- [ ] 为媒体增加上传到服务端或 OSS 的流程
- [ ] 将 scene 中媒体引用统一改为远程 URL
- [ ] 为 poster、audio、image 生成可持久访问地址
- [ ] 发布时做媒体完整性校验


## 5. 方案 A 分阶段实施路线

### 5.1 Phase 1：最小可用版（可分享基础播放）

目标：

- 让课件可以生成一个稳定 URL
- 让其他设备至少能打开并看到完整 stage/scenes
- 建立“草稿 / 已发布”基本区分

实施重点：

1. **【最高优先】修复 `use-scene-generator.ts` 的 `onComplete` 缺少服务端持久化**
   - 在 `onComplete` 中调用 `POST /api/classroom`，把 stage + scenes 写服务端
   - 服务端生成路径（`classroom-generation.ts`）已正确处理，无需改动
2. 调整播放页加载策略（须在步骤 1 完成后执行）
   - 分享页优先走服务端数据
   - 本地存储仅作为草稿或回退
3. 增加发布状态字段
   - `draft`
   - `published`

交付标准：

- `/classroom/:id` 在另一台设备可打开（stage + scenes 可见，媒体暂为空白）
- 页面不再依赖“当前设备一定已有本地数据”
- 用户可区分“本地草稿”与“可分享版本”

### 5.2 Phase 2：可稳定跨设备播放版

目标：

- 分享链接在其他设备上能尽可能完整播放
- 媒体、agents、基础上下文一起可恢复

实施重点：

1. 将媒体 placeholder 转为服务端可访问 URL：发布时把 IndexedDB blob 转存服务端或 OSS，回写 scene 中的 src
2. 增加 `mediaManifest` / `audioManifest`
3. 持久化 auto 模式的 generated agents（preset 模式已自动随 stage 恢复，无需处理）
4. 加发布前完整性校验

交付标准：

- 图片、视频、音频跨设备大部分可用
- auto 模式 agents 不再依赖本地 Dexie，不再静默降级
- 分享页与本地页效果差异明显缩小

### 5.3 Phase 3：正式产品化分享

目标：

- 把分享能力升级为正式发布机制

建议增加：

- 权限控制（公开 / 私有 / token）
- 发布历史
- 版本号
- 失效时间
- 查看权限与编辑权限区分

---

## 6. 选项 1：《跨设备播放实施清单》

### 6.1 数据结构任务

- [ ] 扩展服务端 `PersistedClassroomData` 为更完整的 classroom package
- [ ] 增加 `status: draft | published`
- [ ] 增加 `version` 字段
- [ ] 增加 `agents` 字段
- [ ] 增加 `mediaManifest` 字段
- [ ] 增加 `audioManifest` 字段

### 6.2 前端生成路径任务（最高优先）

- [ ] **在 `lib/hooks/use-scene-generator.ts` 的 `onComplete` 中调用 `POST /api/classroom`，写入 stage + scenes**

### 6.3 后端任务

- [ ] 改造 `lib/server/classroom-storage.ts` 支持更完整结构（agents、mediaManifest、audioManifest、status、version）
- [ ] 在 `lib/server/classroom-storage.ts` 新增 `updateClassroom` 方法（支持编辑后更新）
- [ ] 改造 `app/api/classroom/route.ts` 返回完整 package
- [ ] **新增 `PUT /api/classroom` 接口，供编辑完成后同步到服务端**
- [ ] 为发布动作增加独立 API：`POST /api/classroom/publish`
- [ ] 为媒体转存增加后端支持
- [ ] 为 auto 模式 generated agents 服务端持久化增加读取接口

### 6.4 前端播放层任务

- [ ] 改造 `app/classroom/[id]/page.tsx` 为服务端优先加载（须在 6.2 完成后执行）
- [ ] **加载时比较服务端与本地 `updatedAt`，本地更新时提示用户选择版本，防止编辑内容被静默覆盖**
- [ ] 补充“未发布草稿 / 已发布版本”状态提示
- [ ] 增加分享入口按钮
- [ ] 分享前校验课堂是否已发布
- [ ] 分享失败时给出具体原因（未发布、媒体未完成、服务端不存在）

### 6.5 媒体任务

- [ ] 识别 scene 中所有媒体 placeholder（elementId 格式 src）
- [ ] 发布时将 IndexedDB blob 转存到服务端可访问位置（服务端文件或 OSS）
- [ ] 将 scene 内的 placeholder src 替换为真实 URL 后再写服务端
- [ ] 建立 mediaManifest / audioManifest 生成逻辑
- [ ] 建立发布前媒体完整性校验

### 6.6 测试任务

- [ ] 同浏览器不同设备打开同一 URL 测试（前端流式生成的课件）
- [ ] 无本地 IndexedDB 条件下打开分享 URL 测试
- [ ] 媒体 placeholder 跨设备是否静默显示空白（Phase 1 预期行为）
- [ ] 媒体跨设备正常显示测试（Phase 2 完成后）
- [ ] preset 模式 agents 跨设备恢复测试
- [ ] auto 模式 agents 跨设备恢复测试（Phase 2 完成后，不应静默降级）
- [ ] 未完成生成课件的分享限制测试
- [ ] 编辑内容后通过 PUT 接口同步服务端，另一设备可看到最新版本
- [ ] 本地有未同步编辑、服务端优先加载时，冲突提示是否正确触发

## 7. 方案 B：编辑模式实施设计

### 7.1 目标定义

编辑模式不建议一开始就定义为“完整 PPT 编辑器”，而应分三层目标：

1. 结构化内容编辑
2. 轻量可视化编辑
3. 完整 PPT 风格编辑

当前最推荐先做前两层。

### 7.2 当前代码基础

#### 7.2.1 模式层面

当前 `lib/types/stage.ts` 中：

```ts
export type StageMode = 'autonomous' | 'playback';
```

说明系统还没有正式 `edit` 模式，需要先在类型和 store 层建立。

#### 7.2.2 渲染层面

`components/stage/scene-renderer.tsx` 当前会：

- slide → `components/slide-renderer/Editor`（`SlideEditor`）
- quiz → `QuizView`
- interactive → `InteractiveRenderer`
- pbl → `PBLRenderer`

**关键发现：`SlideEditor` 内部已根据 mode 分支：**

```tsx
// components/slide-renderer/Editor/index.tsx
export function SlideEditor({ mode }) {
  return mode === 'autonomous' ? <Canvas /> : <ScreenCanvas />;
}
```

- `autonomous` → `Canvas`：完整 PPT 编辑器，已支持元素拖拽、缩放、文本编辑、对齐等
- `playback`/其他 → `ScreenCanvas`：只读播放渲染器

这说明：

- **slide 编辑能力实际上已经完整存在**，只需让 edit mode 路由到 `Canvas` 分支即可
- 不需要为 slide 编辑另建组件，只需把 `edit` mode 视同 `autonomous` 处理
- quiz / interactive / pbl 更适合走结构化表单编辑，与 slide 走不同路径“结构化编辑”而不是统一的 PPT 画布编辑

#### 7.2.3 store 层面

`lib/store/stage.ts` 已有：

- `updateScene`、`addScene`、`deleteScene`、`setScenes`、`setMode`
- `saveToStorage` / `loadFromStorage`（自动触发 debouncedSave）

说明场景级修改和本地自动保存链路已经存在。

**重要：以下两个 store 已经存在，文档原始设计的部分 store 改造实际上已不需要：**

`lib/store/canvas.ts`（`useCanvasStore`）已有：

- `activeElementIdList`（已实现多选）
- `handleElementId`（正在操作的元素）
- `editingElementId`（正在文本编辑的元素）
- `spotlightElementId`、`laserElementId`（播放态教学特性）
- 缩放、标尺、网格等画布视口状态

`lib/store/snapshot.ts`（`useSnapshotStore`）已有：

- 完整的 undo/redo 机制，基于 IndexedDB snapshots
- `addSnapshot`、`undo`、`redo`
- `canUndo()`、`canRedo()`

这意味着文档 8.1 节建议在 `stage.ts` 中增加的 `selectedElementId`、`undoStack`、`redoStack` **实际上已经由独立 store 实现**，不需要重复建设。

### 7.3 推荐产品形态

建议拆成两个路由：

- `/classroom/[id]`：播放态
- `/classroom/[id]/edit`：编辑态

不建议一开始用 query 参数混合播放与编辑，因为：

- 页面结构差异大
- 权限未来可能不同
- 播放器逻辑和编辑器逻辑容易互相污染

### 7.4 编辑模式分类型策略

#### Slide

使用可视化编辑：

- 选中元素
- 改文本
- 换图片
- 拖拽位置
- 调整尺寸
- 改字体、颜色、对齐

#### Quiz

使用表单编辑：

- 题目
- 选项
- 正确答案
- 解析
- 分值

#### Interactive

使用配置编辑：

- url
- html
- 其他配置字段

#### PBL

使用结构化表单编辑：

- `projectConfig`
- 角色
- milestone
- issue board 等配置

---

## 8. 方案 B 技术实现建议

### 8.1 类型与 store 改造

**实际改造量远小于原始设计，大部分能力已存在。**

#### 8.1.1 StageMode 类型扩展（必须做）

```ts
// lib/types/stage.ts
export type StageMode = 'autonomous' | 'playback' | 'edit';
```

同步更新引用处：`lib/api/stage-api-mode.ts`、`lib/api/stage-api-types.ts`、`lib/types/chat.ts`。

#### 8.1.2 SlideEditor 分支处理（必须做）

```tsx
// components/slide-renderer/Editor/index.tsx
export function SlideEditor({ mode }) {
  // edit 模式复用 Canvas（已有完整编辑能力）
  return (mode === 'autonomous' || mode === 'edit') ? <Canvas /> : <ScreenCanvas />;
}
```

#### 8.1.3 不需要新建的 store（已存在）

- 元素选中状态：`useCanvasStore.activeElementIdList` 已实现，无需在 `stage.ts` 新增
- undo/redo：`useSnapshotStore` 已完整实现，无需在 `stage.ts` 新增 `undoStack`/`redoStack`
- `isDirty`：可直接用 `snapshotCursor > 0` 判断（有快照说明有改动）

#### 8.1.4 stage.ts 仅需补充（可选）

- `editorSidebarOpen`：控制编辑器侧边栏显示，放 `stage.ts` 或独立 UI store 均可
- 服务端同步触发：编辑完成后调用 `PUT /api/classroom`，可在编辑页面组件层处理，不必进 store

### 8.2 页面与组件结构

**最小新增组件：**

- `app/classroom/[id]/edit/page.tsx`：编辑页入口，设置 `mode = 'edit'`，加载 stage + scenes
- `components/editor/edit-layout.tsx`：编辑态三栏布局（左侧场景列表、中间画布、右侧属性面板）
- `components/editor/scene-list-panel.tsx`：场景缩略图列表，支持增删改排序
- `components/editor/quiz-editor.tsx`：quiz 表单编辑（slide 复用 Canvas，quiz 需独立）
- `components/editor/interactive-editor.tsx`：interactive 配置编辑

**可直接复用，无需新建：**

- 中间画布：`SceneRenderer` + `SlideEditor`（mode=edit 时自动走 Canvas 分支）
- 元素操作手柄：`components/slide-renderer/Editor/Canvas/Operate/` 全套（已有拖拽/缩放/旋转）
- 属性面板：`components/slide-renderer/Editor/` 下的 Panel 系列组件（已有文本/图片/形状属性编辑）
- undo/redo 工具栏按钮：直接调用 `useSnapshotStore.undo()` / `useSnapshotStore.redo()`

布局建议：

- 左侧：scene 列表 / 缩略图（新建）
- 中间：编辑画布（复用现有渲染器）
- 右侧：属性面板（复用 slide-renderer 已有面板）
- 顶部：编辑工具栏（undo/redo + 保存/发布按钮）

### 8.3 可复用模块

| 模块 | 路径 | 作用 |
|------|------|------|
| 场景渲染器 | `components/stage/scene-renderer.tsx` | 根据 scene type 分发渲染 |
| Slide 完整编辑器 | `components/slide-renderer/Editor/Canvas/` | 元素选中/拖拽/缩放/旋转/文本编辑 |
| 操作手柄 | `components/slide-renderer/Editor/Canvas/Operate/` | resize/rotate/border 全套 |
| 元素选中状态 | `lib/store/canvas.ts`（useCanvasStore） | 无需重新实现 |
| undo/redo | `lib/store/snapshot.ts`（useSnapshotStore） | 无需重新实现 |
| 富文本编辑 | `lib/prosemirror/*` | 文本元素原位编辑 |
| stage 元数据更新 | `lib/api/stage-api-mode.ts`（createStageMetaAPI） | 已有 update(Partial<Stage>) |
| 场景增删改 | `lib/store/stage.ts`（updateScene/addScene/deleteScene） | 无需重新实现 |

结论：编辑模式不是从零做，而是“在现有渲染基础上补交互和属性编辑层”。

### 8.4 最大工程风险

最大风险不是 UI，而是“编辑后与播放动作系统的耦合”。

当前 scene 不只有静态内容，还有：

- `actions`
- `whiteboards`
- `multiAgent`
- spotlight / laser 对 `elementId` 的引用

如果编辑模式允许删除或替换元素，就可能导致：

- action target 丢失
- spotlight/laser 指向失效
- 白板解释逻辑与当前布局不一致

建议第一阶段做三件事：

1. 尽量不改 elementId
2. 删除元素时做引用校验
3. 增加 `validateSceneActions(scene)` 之类的检查器

**风险 2：edit mode 与 autonomous mode 复用同一 Canvas 的副作用**

`Canvas` 组件在 `autonomous` 模式下设计为 AI 控制播放，内部可能有依赖 `autonomous` 语义的逻辑（如 spotlight、laser 控制）。直接让 edit mode 走 Canvas 分支前，需确认：

- Canvas 中是否有 `if (mode === 'autonomous')` 的分支逻辑需要同步处理
- edit 模式下播放态特性（spotlight/laser）应当关闭而非触发

**风险 3：undo/redo 与 IndexedDB 自动保存的频率冲突**

`useSnapshotStore` 的 undo/redo 直接操作 `stageStore.setScenes()`，而 `setScenes` 会触发 `debouncedSave` 写 IndexedDB。高频 undo 操作会导致大量写入，需评估是否需要在 edit mode 下暂停 debouncedSave，改为手动触发保存。

**风险 4：编辑完成后未同步服务端即分享**

IndexedDB 自动保存不等于服务端已更新。用户编辑后若直接复制 URL 分享，对方看到的仍是旧版本。需在编辑页面明确区分“本地已保存”与“已同步服务端可分享”两种状态，编辑页面需提供显式的“发布”按钮。

---

## 9. 方案 B 分阶段实施路线

### 9.1 Phase 1：编辑 MVP

目标：先实现”可修改课件”，不追求完整 PPT 体验。

范围：

- 新增 `app/classroom/[id]/edit/page.tsx`，设置 mode = 'edit'
- 新增 `StageMode` 类型扩展（加 'edit'），更新所有引用处
- 修改 `SlideEditor` 让 edit mode 走 Canvas 分支（一行改动）
- 新建 `edit-layout.tsx`：三栏布局
- 新建 `scene-list-panel.tsx`：场景列表，支持增删改排序
- 支持 stage 名称/描述编辑（复用 `createStageMetaAPI().update()`）
- 新建 `quiz-editor.tsx`：quiz 表单编辑
- 本地自动保存已由现有 `debouncedSave` 覆盖，无需额外工作
- **暂不包含**：服务端同步（Phase 3 整合）、PBL 编辑（结构复杂，延后）

交付标准：

- 用户无需重新生成即可手工改 slide 内容（完整 Canvas 编辑能力）
- quiz / interactive 可通过表单编辑
- 编辑后本地自动保存，刷新后恢复

### 9.2 Phase 2：服务端同步与发布

目标：让编辑结果可以分享。

范围：

- 新增 `PUT /api/classroom` 接口
- 编辑页面增加”发布”按钮，触发服务端同步
- 显示”本地已保存 / 已发布”状态区分
- 加载时 updatedAt 冲突检测，防止服务端旧版本覆盖本地编辑
- undo/redo 工具栏（复用 `useSnapshotStore`，已有完整实现）

交付标准：

- 编辑后可发布，分享 URL 反映最新内容
- 本地与服务端版本不一致时有明确提示

### 9.3 Phase 3：PBL 编辑 + 完整发布闭环

范围：

- 新建 `pbl-editor.tsx`：支持 `projectConfig`、角色、milestone、issue board 等结构化编辑
- 与方案 A 的服务端 package 完整打通（mediaManifest、agents、version）
- 发布历史与版本号
- 权限控制（公开 / 私有）

交付标准：

- 所有 scene 类型均可编辑
- 编辑和分享形成完整闭环
- 课件成为可修改、可发布、可分享、有版本管理的资产
