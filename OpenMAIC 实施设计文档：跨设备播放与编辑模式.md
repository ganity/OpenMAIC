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

这说明“分享播放 URL”在架构上已经有雏形。

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

#### 问题 C：媒体很多仍是本地 Blob

`lib/utils/database.ts` 中可见：

- `mediaFiles.blob`
- `audioFiles.blob`
- `imageFiles.blob`

虽然 schema 中已有：

- `ossKey`
- `posterOssKey`

但说明当前更像“具备 OSS 扩展位”，未必已经形成完整发布链路。

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

1. 统一生成完成后调用服务端持久化
   - 无论从哪个生成入口完成，都调用 `persistClassroom(...)`
2. 调整 `app/classroom/[id]/page.tsx` 加载优先级
   - 建议改为“服务端优先，本地补充”
3. 增加“已发布/未发布”概念
   - `draft`：仅本地可见
   - `published`：服务端可分享

阶段结果：

- 别的设备可打开课件结构
- 但媒体可能还不完整

#### Phase 2：稳定跨设备播放

目标：让跨设备播放尽量完整。

要做的事：

1. 将本地媒体文件转为服务端文件或 OSS URL
2. 发布时生成媒体 manifest
3. 持久化 generated agents 到服务端 package
4. 页面播放时优先读取服务端 assets，而不是依赖本地 Dexie 恢复

阶段结果：

- 课件、媒体、Agent 基本都可跨设备恢复

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

#### 4.1.1 服务端数据结构扩展

建议扩展 `lib/server/classroom-storage.ts` 的持久化结构：

- 现状：`stage + scenes`
- 建议增加：`agents + mediaManifest + audioManifest + status + version`

#### 4.1.2 页面加载策略调整

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

### 4.2 建议涉及的文件

重点文件：

- `app/classroom/[id]/page.tsx`
- `app/api/classroom/route.ts`
- `lib/server/classroom-storage.ts`
- `lib/utils/database.ts`
- `lib/media/*`
- `lib/utils/image-storage.ts`
- 相关存储 provider 或上传逻辑

### 4.3 风险

1. 本地与服务端双写一致性
2. 生成尚未完成时被提前分享
3. scene 内残留 blob URL，导致异设备无法访问
4. published 与 draft 混淆，造成用户理解错误

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

1. 统一生成完成后的服务端持久化
   - 无论入口来自本地生成、流式生成还是 API 生成，最终都要落一次服务端
   - 输出统一的 `classroomId`
2. 调整播放页加载策略
   - 分享页优先走服务端数据
   - 本地存储仅作为草稿或回退
3. 增加发布状态字段
   - `draft`
   - `published`

交付标准：

- `/classroom/:id` 在另一台设备可打开
- 页面不再依赖“当前设备一定已有本地数据”
- 用户可区分“本地草稿”与“可分享版本”

### 5.2 Phase 2：可稳定跨设备播放版

目标：

- 分享链接在其他设备上能尽可能完整播放
- 媒体、agents、基础上下文一起可恢复

实施重点：

1. 持久化 agents
2. 增加 `mediaManifest` / `audioManifest`
3. 将本地 blob 转为可访问 URL
4. 加发布前完整性校验

交付标准：

- 图片、视频、音频跨设备大部分可用
- agent profiles 不再依赖本地 Dexie
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

### 6.2 后端任务

- [ ] 梳理所有生成完成路径，统一接入服务端持久化
- [ ] 改造 `lib/server/classroom-storage.ts` 支持更完整结构
- [ ] 改造 `app/api/classroom/route.ts` 返回完整 package
- [ ] 为“发布”动作增加独立 API（建议）
- [ ] 为媒体转存增加后端支持
- [ ] 为 agent profiles 服务端持久化增加读取接口

### 6.3 前端任务

- [ ] 改造 `app/classroom/[id]/page.tsx` 为服务端优先加载
- [ ] 补充“未发布草稿 / 已发布版本”状态提示
- [ ] 增加分享入口按钮
- [ ] 分享前校验课堂是否已发布
- [ ] 分享失败时给出具体原因（未发布、媒体未完成、服务端不存在）

### 6.4 媒体任务

- [ ] 识别 scene 中所有图片/视频/音频引用
- [ ] 将本地 blob 转存到服务端可访问位置
- [ ] 将 scene 内的本地引用替换为 URL 引用
- [ ] 建立 media manifest 生成逻辑
- [ ] 建立发布前媒体完整性校验

### 6.5 测试任务

- [ ] 同浏览器不同设备打开同一 URL 测试
- [ ] 无本地 IndexedDB 条件下打开分享 URL 测试
- [ ] 媒体缺失场景测试
- [ ] agent 讨论场景恢复测试
- [ ] 未完成生成课件的分享限制测试

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

- slide → `components/slide-renderer/Editor`
- quiz → `QuizView`
- interactive → `InteractiveRenderer`
- pbl → `PBLRenderer`

这说明：

- slide 已有较强编辑器基础
- 其他 scene type 更适合走“结构化编辑”而不是统一的 PPT 画布编辑

#### 7.2.3 store 层面

`lib/store/stage.ts` 已有：

- `updateScene`
- `addScene`
- `deleteScene`
- `setScenes`
- `setMode`
- `saveToStorage`
- `loadFromStorage`

说明场景级修改和本地自动保存链路已经存在。

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

建议把 `StageMode` 扩展为：

```ts
export type StageMode = 'autonomous' | 'playback' | 'edit';
```

`lib/store/stage.ts` 需要补充编辑态状态：

- `selectedElementId`
- `selectedElementIds`
- `isDirty`
- `undoStack`
- `redoStack`
- `editorSidebarOpen`

并补充动作：

- `updateStageMeta(...)`
- `updateSceneContent(...)`
- `selectElement(...)`
- `updateElement(...)`
- `addElement(...)`
- `deleteElement(...)`
- `moveElement(...)`
- `resizeElement(...)`

### 8.2 页面与组件结构

建议新增：

- `app/classroom/[id]/edit/page.tsx`
- `components/editor/editor-layout.tsx`
- `components/editor/scene-list-panel.tsx`
- `components/editor/scene-properties-panel.tsx`
- `components/editor/element-properties-panel.tsx`

布局建议：

- 左侧：scene 列表 / 缩略图
- 中间：编辑画布
- 右侧：属性面板
- 顶部：编辑工具栏

### 8.3 可复用模块

重点复用：

- `components/stage/scene-renderer.tsx`
- `components/slide-renderer/Editor`
- `lib/store/stage.ts`
- `lib/prosemirror/*`
- 现有 stage/canvas/scene 相关 API

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

---

## 9. 方案 B 分阶段实施路线

### 9.1 Phase 1：编辑 MVP

目标：先实现“可修改课件”，不追求完整 PPT 体验。

范围：

- 新增 `/classroom/[id]/edit`
- 支持 stage 名称/描述编辑
- 支持 scene 增删改排序
- 支持 slide 文本与图片替换
- 支持 quiz 表单编辑
- 支持本地草稿保存

交付标准：

- 用户无需重新生成即可手工改内容
- 主要课件类型都能被修改
- 基本保存与恢复成立

### 9.2 Phase 2：轻量 PPT 式编辑

范围：

- slide 元素选中
- 拖拽 / 缩放
- 文本框原位编辑
- 属性面板编辑
- undo / redo

交付标准：

- slide 类页面具备基本 PPT 修改体验
- 编辑后可立即进入播放态验证

### 9.3 Phase 3：发布工作流整合

范围：

- 草稿 / 发布版区分
- 编辑后重新发布
- 生成新的分享 URL 或版本
- 与方案 A 的服务端 package 打通

交付标准：

- 编辑和分享形成完整闭环
- 课件成为可修改、可发布、可分享的资产
