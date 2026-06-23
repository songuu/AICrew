---
title: "图文真实化冲刺（不接视频）"
type: sprint
status: completed
created: "2026-06-23"
updated: "2026-06-23"
checkpoints: 0
tasks_total: 18
tasks_completed: 18
tags: [sprint, make-it-real, no-video]
aliases: ["图文真实化", "make-it-real-no-video"]

# 本 sprint 立的不变量，后续 sprint 必须保持
invariants:
  - "domain.test.js 与全部 node:test（106+）保持全绿；契约变更（exports.files、aiMeta）须在同一任务内同步更新对应测试，不留红"
  - "export 文件清单契约升级须向后兼容：新增 fileNames:string[] 保留旧消费方按 name 读取的能力"
  - "credits/积分维持现有模拟模型——任何任务不接真实计费，不改 credits 计算契约"
  - "Flow 三模式统一经 flowToSkill 单桥物化为 skill，task 契约与预设 skill 同构；execute.js 不重新发明评分/导出/事件"
  - "canvas 一手势一历史：批量 AI 生成/编辑结果必须包进单次 history.commit()，禁止 N 次 commit 破坏 undo/redo"
  - "canvas 零 import domain/ai 业务逻辑：AI 能力一律经 props 注入的句柄传入，保持隔离契约"
  - "纯函数 + 不可变：所有新增逻辑层返回新对象，不 mutate 入参"
  - "客户端不持有 token：系统模型一律经 /api/ai/generate 代理；新增端点不暴露 secret"
  - "AI 层包装而非修改 domain：runCreativeWorkflowWithAI 继续 wrap，评分/结构/导出确定性契约不被 AI 分支改写"
  - "isVideoSkill 决定交付物形态的现有分支不变；视频分支文件（video.mp4/storyboard.csv）保持 placeholder，不生成真实二进制"
  - "graceful degradation：任一 AI 调用失败局部回退、整体不抛错，aiMeta 记录降级；无 AI 配置时原样回退确定性模拟"
  - "director 的 video 节点硬拒规则保留；意图分类层 entities 白名单只含非 video agent"

invariant_tests:
  - tests/domain.test.js
  - tests/flow.test.js
  - tests/ai.test.js
  - tests/canvas.test.js

deferred:
  - sprint: next
    item: "视频生成接入（generateVideo → workflow → jobId 轮询 UI）+ video.mp4 取回端点"
    deadline: "TBD"
    reason: "用户本期决策：暂不接入视频"
  - sprint: next
    item: "Motion Control 运镜 / 关键帧 / 镜头编排"
    deadline: "TBD"
    reason: "依赖视频"
  - sprint: next
    item: "真实计费/积分扣减 / 多品牌·workspace 关联 / 服务端 DB 持久化 brandKit / 移动端"
    deadline: "TBD"
    reason: "规模化阶段，避免 scope creep"
---

# 图文真实化冲刺（不接视频）

> 本计划由多 agent 编排核验 + 对抗式审查（verdict: needs-changes）生成，审查发现的 line 级破绽已全部内联修复。
> 背景见 [[2026-06-23-roboneo-vs-aicrew-gap-analysis]]。

## 目标

在**暂不接入视频**的约束下，把**图文路径做到真实可交付**，并让**对话/画布/记忆体验真实化**。
核心架构判断：「图文真实可交付」是 Director / 画布 / Brand 三条体验线共同依赖的**底座**，故置于最前。

**Success（north-star）**
- 配置图像模型后，一次创作的**每个 variant 都有真实图**，刷新不丢，并能**真实下载**导出物。
- agent 编排节点的**存在性真实影响交付物**（不再恒定全装配）。
- Director 手动模式能用**自然语言**驱动 Flow（正则兜底）。
- 画布能**生成图像落画布**（单 commit、可撤销）。
- 品牌规范/审美偏好**跨会话保留**并稳定注入 prompt。

## Out of Scope（本期不做）
- ❌ 视频生成 / video.mp4 真实二进制（永为 `kind=placeholder`）/ jobId 轮询 / 取回端点
- ❌ Motion Control / 关键帧 / 镜头编排
- ❌ 真实计费 / 积分扣减
- ❌ 多品牌 / workspace:brands 关联 / 品牌版本历史 / 服务端 DB 持久化 brandKit（本期止于浏览器独立 key）
- ❌ 移动端适配
- ❌ 画布 inpaint 的 ROI/mask 绘制 UI（如做 AI 编辑则整图重绘）
- ❌ 图像 upscale / 背景移除 / 风格迁移端点
- ❌ zip 打包导出（YAGNI，逐文件下载）

---

## 入场扫描

### Invariants 继承（见 frontmatter `invariants`）
关键三条：① exports.files 契约**叠加不替换**（加 `fileNames`）；② canvas **零 import domain/ai**，AI 经 props 注入；③ AI 层**包装不改** domain。

### 集成路径声明
| 改动点 | 触发 | 中间层 | 持久化 | 刷新可见 |
|--------|------|--------|--------|----------|
| 多 variant 出图 | runCreativeWorkflowWithAI | generateImage ×N（逐项降级）| imageStore(独立 key) | ✅(P3) |
| 真实导出 | 前端 Blob/a.download | assembleExportBundle | 下载即落地 | ✅ |
| 封面跨会话 | strip 前写 imageStore | imageStore data/remote 分治 | ✅ localStorage v1 | ✅ |
| Brand Memory | saveBrandKit | brandStore 独立 key | ✅ aicrew-brand-v1 | ✅ |
| 节点真路由 | runFlowWithAI | flowToAiModes + enabledModes | task 契约 | ✅ |
| Director 真对话 | 自然语言→intent→model 变更 | LLM + 正则兜底 | Flow 状态 | ✅ |
| 画布生成 | 提示→注入句柄 generateImage→placeImage | 组件层(保隔离) | canvas v1 | ✅ |

### 半完成债务清单
| 来源 | 议题 | 本期决策 |
|------|------|----------|
| 既有 | providers.generateVideo 未接入 | ⏭ deferred（不做视频）|
| 既有 | jobId 异步态 UI 未建 | ⏭ 随视频推迟 |
| 既有 | stripVariantMedia 无差别丢 imageUrl | ✅ 本期 P3 修 |

---

## 任务拆解（6 阶段 · 18 核心任务 + 3 可选）

> 风险：L0 免测 / L1 冒烟 / L2 标准 / L3 严格 / L4 全面。每 Task 完成跑 `invariant_tests`。TDD 先写测试。
> ⚠️ 审查修复点用 **[审查修复]** 标注。`[可选]` = 对抗审查判定 scope creep，默认 deferred。

### Phase P1 — 多 variant 真出图（解除 variant[0] 单图假设）

- **P1-T1 抽取 per-variant 图像生成纯函数 `generateVariantImages`**
  - detail：`lib/ai/workflow.js` 新增纯协调函数 `generateVariantImages({variants,brief,brandKit,preset,aiConfig,signal,fetchImpl})`，把现 `workflow.js:121-137` 单图逻辑改为 `Promise.all(variants.map(...))` 遍历全部 variant，复用 `buildImagePrompt`（已按 `variant.angle` 区分）与 `imageSizeFor`；map 内逐项 try/catch 返回 `{index,imageUrl|null}`，单 variant 失败仅其回退无图。不可变返回新数组。
  - **[审查修复]** detail 明确：**copy 文案已是全 variant**（`workflow.js:101-116` 的 `Promise.all`），本阶段**只动 image**，不要重写 copy 分支（守 `ai.test.js:336` 的 `copyApplied===3`）。
  - files：`lib/ai/workflow.js`、`tests/ai.test.js`
  - risk：L2 ｜ deps：—
  - test：『3 variant 全获不同 imageUrl』（桩按调用序返回不同 data URL）；『第 2 项 reject 仅其无图，整体不抛，imageErrors 长度=1』
  - acceptance：纯函数；3 variant 各独立 imageUrl；单项失败隔离；新增 2 单测绿 + 既有 ai.test.js 不回归

- **P1-T2 `runCreativeWorkflowWithAI` 接入多图 + 向后兼容扩展 aiMeta**
  - detail：替换 `workflow.js:121-137` 为 `generateVariantImages`。aiMeta 保留 `imageApplied:boolean`（=`imageAppliedCount>0`），新增 `imageAppliedCount:number` 与可选 `imageErrors`；`used` 纳入 `imageAppliedCount>0`。
  - **[审查修复]** 测试显式说明：`ai.test.js:321-341` 既有用例的**图像请求次数从 1 变 3** 属预期；若该用例对 `calls` 长度有精确断言需同步更新；`imageApplied` 仍为 boolean 守旧消费方。
  - files：`lib/ai/workflow.js`、`tests/ai.test.js`
  - risk：L2 ｜ deps：P1-T1
  - acceptance：aiMeta 同时含 `imageApplied`(boolean)+`imageAppliedCount`(number)；既有 106+ 全绿

- **P1-T3 并发预算与可关闭多图软上限**
  - detail：从 aiConfig 读可选 `maxImagesPerRun`（缺省=`variants.length` 全出图），超上限的 variant 跳过图像保留文案。防 SiliconFlow/OpenAI 限流的逃生阀。纯参数。
  - files：`lib/ai/workflow.js`、`lib/ai/config.js`、`tests/ai.test.js`
  - risk：L1 ｜ deps：P1-T2
  - acceptance：默认全出图；显式上限生效

- **P1-T4 `runCreativeWorkflowWithAI` 增 `enabledModes` 参数（P5 前置）** **[审查修复 / 补缺依赖]**
  - detail：审查指出 `flowToAiModes` 仅在 execute.js 无法门控出图（`hasAiMode` 读 provider 配置与 flow 无关）。故为 `runCreativeWorkflowWithAI` 增可选 `enabledModes={text,image}`（缺省全开，向后兼容）；image 分支改为 `hasAiMode(...) && enabledModes.image!==false && variants[index]`。
  - files：`lib/ai/workflow.js`、`tests/ai.test.js`
  - risk：L2 ｜ deps：P1-T2
  - acceptance：缺省行为不变（既有 ai.test.js 绿）；`enabledModes.image===false` 时图像桩零调用

### Phase P2 — exports 升级为可真实下载内容包

- **P2-T1 内容化纯函数 `buildExportFiles`**
  - detail：`lib/domain.js` 新增纯函数 `buildExportFiles({brief,variant,skill})` → `Array<{name,mimeType,kind,content?,source?}>`。图文：`copy.md`(content 由 hook/caption/cta 组装)、`note.md`(timeline 渲染)、`hashtags.txt`(hashtags join)、`cover.png`(有 imageUrl→`source=variantImage` 否则 placeholder)。**视频分支：`video.mp4` 标 `kind=placeholder`，不生成二进制**（守硬约束）。
  - files：`lib/domain.js`、`tests/domain.test.js`
  - risk：L3 ｜ deps：P1-T1
  - test：copy.md 含 hook/cta；hashtags 行数=数量；cover source 随 imageUrl 切换；**video.mp4 仍 placeholder 回归**

- **P2-T2 `buildExports` 携带 files 内容引用 + 全量消费方迁移** **[审查修复 / 关键]**
  - detail：`domain.js` 每个 export 的 `files` 改为 `buildExportFiles` 对象数组；新增 `fileNames:string[]`(=`files.map(f=>f.name)`) 保留旧形态。`exportFilesFor` **仍返回 `string[]`**（作 name 源）。
  - **[审查修复] 必改的全部消费方**（原计划仅列 3 处，审查补足）：
    - `lib/domain.js:542-554` `buildExportRecord` → 同步改 `{files:对象数组, fileNames}`
    - `lib/domain.js:615-628` `buildAgentArtifact` → `exportFilesFor(skill).join(', ')` 保持读 `string[]`（不读对象数组，避免 `[object Object]`）
    - `components/AICrewStudio.jsx:964` `item.files.some(f=>f.endsWith('.mp4'))` → `fileNames.some(n=>n.endsWith('.mp4'))`（**保留"是否视频包"语义**）
    - `components/AICrewStudio.jsx:967` `item.files.join(' / ')` → `fileNames.join(' / ')`
  - files：`lib/domain.js`、`tests/domain.test.js`、`components/AICrewStudio.jsx`
  - risk：L3 ｜ deps：P2-T1
  - test：更新 `domain.test.js:49-66`、`126-143` **及 `145-154`（视频包 `includes('video.mp4')`→`fileNames.includes('video.mp4')` 且 `file.kind==='placeholder'`）**；前端图文/视频两类卡片冒烟不崩

- **P2-T3 内容包纯函数 `assembleExportBundle`**
  - detail：新建 `lib/export/bundle.js`，`assembleExportBundle(exportRecord,variant)` → `{textFiles:[{name,mimeType,content}], imageFiles:[{name,mimeType,dataUrl|url}]}`。无网络无写盘，仅产可被前端 Blob 化的结构。
  - files：`lib/export/bundle.js`、`tests/export.test.js`
  - risk：L2 ｜ deps：P2-T1
  - acceptance：文本即时可下；图像按 imageUrl 有无产引用；纯函数无副作用

- **P2-T5 前端真实下载入口（纯前端 Blob + 图片下载）**
  - detail：`AICrewStudio.jsx` 导出区每个 export 加下载：文本 `new Blob([content])+createObjectURL` 即时下载；图片 data URL 直接 `a.download`，https 则 `fetch→blob`。复用 `assembleExportBundle`。无 imageUrl 时 cover.png 项禁用并提示『重新生成以获取封面』。无 zip 依赖。
  - files：`components/AICrewStudio.jsx`
  - risk：L2 ｜ deps：P2-T3、P2-T2、P3-T2（封面跨会话存活后下载体验才完整）
  - acceptance：可下载真实文本+图片（非占位串）；无封面优雅禁用

- **P2-T4 `[可选]` 服务端图像取回端点** **[审查: scope creep]**
  - detail：`app/api/exports/route.ts` 把 data URL 解码为 image blob / 对 https 做 302。**审查判定非必需**：纯图文下载前端已可 `a.download`(data URL) + `fetch→blob`(https)。**仅当**有跨域/防盗链/大图服务端流式需求时才做；否则 deferred。视频请求一律 501。
  - risk：L3 ｜ deps：P2-T3、P3-T1 ｜ 默认 **deferred**

### Phase P3 — 封面 imageUrl 跨会话持久化（解除 stripVariantMedia 单向丢弃）
> **[审查重排]** P3-T1（imageStore 纯层）应与 P1 **并行/前置**，使 P2 下载从一开始就建立在持久封面上。

- **P3-T1 独立图像存储层 `imageStore`（独立 key，data/https 分治）**
  - detail：新建 `lib/storage/imageStore.js`（复用 `lib/ai/config.js` 的 resolveStorage 模式），key=`aicrew-variant-images-v1`，`Map<variantId,{url,kind:'data'|'remote',bytes}>`。`putImage/getImage/pruneToQuota`（总字节软上限，超限 LRU 丢最旧 data URL，remote https 永久保留）。空/损坏存储回退空 Map。
  - **[审查修复]** key 命名空间区分 `variant:<id>` 与 `canvas:<objId>`（防 P6-T5 画布图与封面互相 LRU 挤兑）。
  - files：`lib/storage/imageStore.js`、`tests/imageStore.test.js`
  - risk：L2 ｜ deps：—（可与 P1 并行）
  - acceptance：独立 key 不污染主 blob；data/remote 分治；LRU 修剪；降级安全

- **P3-T2 `sanitizeStateForStorage` 改为分离存储而非丢弃**
  - detail：`AICrewStudio.jsx:108-117` strip 前把 `{variantId,imageUrl}` 写 imageStore（https 体积小可留 blob，data URL 走 store）。抽纯函数 `rehydrateVariantImages(state,store)→state` 供 readState 回填。配额 prune 命中给『部分封面已过期，可重新生成』提示。
  - files：`components/AICrewStudio.jsx`、`lib/storage/imageStore.js`
  - risk：L3 ｜ deps：P3-T1
  - test：『strip 前写入、hydrate 后 imageUrl 恢复』『store 缺失保持 undefined 不报错』『主 blob 序列化后不含 base64』

### Phase P4 — 跨会话 Brand Memory（独立持久化 + prompt 注入稳定化）

- **P4-T1 独立 Brand Memory 存储层 `brandStore`**
  - detail：复用 resolveStorage 模式，新建 `lib/brand/store.js`，key=`aicrew-brand-v1`，与主 blob 解耦。`loadBrandKit/saveBrandKit/normalizeBrandKit`（缺字段回退 defaultBrandKit，校验 colors/forbiddenWords 数组、voice 字符串）。AICrewStudio 写穿独立 key。
  - files：`lib/brand/store.js`、`lib/domain.js`、`components/AICrewStudio.jsx`、`tests/brand-store.test.js`
  - risk：L2 ｜ deps：—
  - acceptance：跨会话恢复；类型校验；空回退 default；不污染主 blob

- **P4-T2 brandKit 注入契约稳定化 + 禁用词转义**
  - detail：抽 `lib/brand/prompt.js` 纯函数 `renderBrandClause(brandKit)`，对 forbiddenWords/voice 清洗（去换行、截断、去控制字符，防 prompt 注入）。`workflow.js:12-26 buildCopyPrompt` 与 `29-35 buildImagePrompt` 调用它。
  - files：`lib/brand/prompt.js`、`lib/ai/workflow.js`、`tests/brand-prompt.test.js`
  - risk：L2 ｜ deps：P4-T1
  - acceptance：纯函数；注入集中且转义；既有 AI 测试不回归

- **P4-T3 Brand 编辑页字段补全 + 持久化反馈**
  - detail：`AICrewStudio.jsx:897-949` 当前仅 5 字段、colors 只读、用 defaultValue（刷新回退）。补全为受控编辑（colors 增删、typography、productLine、slogan、forbiddenWords 标签式），提交走 `saveBrandKit`，给『已保存』反馈。**不引入多品牌/workspace**。
  - files：`components/AICrewStudio.jsx`
  - risk：L1 ｜ deps：P4-T1
  - acceptance：全字段受控；刷新保留；forbiddenWords 变更影响 QA 评分（`domain.js:819-841` 回归）

### Phase P5 — agent 节点真路由到引擎调用（Flow 真实化）

- **P5-T1 `runFlowWithAI` 节点级路由（复用 P1 多图 + enabledModes）** **[审查修复]**
  - detail：runFlowWithAI 经 flowToSkill 已委托 runCreativeWorkflowWithAI（自动继承 P1 多图、P2 内容化 exports）。新增纯函数 `flowToAiModes(flow)→{text,image}`（copy 节点存在→text、visual 节点存在→image）。
  - **[审查修复]** **必须把 `flowToAiModes(flow)` 透传为 P1-T4 的 `enabledModes`**（仅在 execute.js 算无法门控出图）。files 增 `lib/ai/workflow.js` 确认签名。
  - files：`lib/flow/execute.js`、`lib/ai/workflow.js`、`tests/flow.test.js`
  - risk：L3 ｜ deps：P1-T4、P2-T2
  - test：『含 copy+visual 节点→产 AI 文案+多图』『仅 copy 无 visual→图像桩零调用』『flowToAiModes 真值表』

- **P5-T2 qa/export 节点存在性真装配**
  - detail：qa 节点存在才跑 forbiddenWords 合规扫描写 task.qa；export 节点存在才产 P2 内容化 exports。节点"存在"真实影响交付物组成。保持 flowToSkill 同构，不碰 director 的 video 硬拒。
  - files：`lib/flow/execute.js`、`lib/domain.js`、`tests/flow.test.js`
  - risk：L3 ｜ deps：P5-T1
  - test：『无 qa 节点→跳过合规』vs『有 qa→命中降分』；『无 export 节点→不产 exports』；既有 106+ flow 测试全绿

### Phase P6 — 对话/画布体验真实化（能力闭环后）

- **P6-T1 Director 意图分类层（LLM 优先 + 正则兜底，签名不变）** **[审查修复]**
  - detail：`parseDirectorCommand` 拆为纯同步 `parseDirectorCommandRegex`（=现状，保留全部 director 测试绿）+ 新异步 `resolveDirectorCommand`。新增 `lib/flow/intent.js` `classifyDirectorIntent(...)` 经 generateText 输出严格 JSON（复用 extractJson），映射到 model.js 的 addNode/connect/reorderNode；LLM 超时/低置信/无 aiConfig→回退正则。video 意图沿用硬拒文案，entities 白名单只含非 video agent。
  - **[审查修复] reply 契约**：**不破坏 `reply:string`**——保留 `reply` 为 string，**新增兄弟字段** `action`/`confidence`（而非把 reply 变对象）；OrchestratorConsole:200 渲染 `result.reply` 不变。守 director.test.js reply 形状。
  - files：`lib/flow/intent.js`、`lib/flow/director.js`、`components/OrchestratorConsole.jsx`、`tests/director-intent.test.js`
  - risk：L3 ｜ deps：P1-T2（解除对 P4-T2 的弱依赖，可更早并行——审查建议）
  - test：『LLM 桩 add+strategy→真添加』『LLM 超时→回退正则仍得可执行 reply』『video 意图→硬拒 future、flow 不变』；director.js 原同步用例全绿

- **P6-T3 画布 AI 生成图落地（generate 动作 + 原子 commit）**
  - detail：`CanvasStudio.jsx` `handleAddItem` 增 `kind=generate`：prompt→经 **props 注入的** generateImage 句柄（带 brandKit 片段复用 `lib/brand/prompt.js`）→`createShape('image')`→**单次 history.commit**（N 张也一次 commit 守 undo）。`aiGenerating` 锁工具切换；复用 gestureRef 的 AbortController 取消；配额预检复用 imageStore.pruneToQuota。**画布仍零 import domain/ai——AI 经 props 注入**。
  - files：`components/canvas/CanvasStudio.jsx`、`lib/canvas/model.js`、`lib/canvas/tools.js`、`tests/canvas.test.js`
  - risk：L3 ｜ deps：P1-T1、P3-T1、P4-T2
  - test：『批量生成单次 commit、undo 一步回退全部』『生成失败不入场景、history 不变、工具回 select』『生成中按 R/O/T/A 不武装手势』；注入句柄不破坏零依赖契约

- **P6-T5 多 variant 封面批量铺入画布（画布↔workflow 同步）**
  - detail：复用 P1 多 variant imageUrl，画布提供『导入本次任务封面』把 `variants[0..N].imageUrl` 网格布局铺入（z-order 追加顶部），整批单次 commit。AI 生成结果回写 variant.imageUrl，落盘走 P3 imageStore（**用 `canvas:`/`variant:` 命名空间区分**防 LRU 挤兑）。
  - files：`components/canvas/CanvasStudio.jsx`、`lib/canvas/model.js`、`lib/storage/imageStore.js`
  - risk：L2 ｜ deps：P1-T1、P3-T1、P6-T3
  - test：『3 封面网格铺入、末尾追加、LayersPanel 逆序可选/重排』『单次 commit undo 一次清空』『回写 imageUrl 经 imageStore 刷新存活』

- **P6-T2 `[可选]` Director 多轮引用绑定 + 对话持久化** **[审查: scope creep]**
  - detail：引用消解（它/上一个/中间那个）+ brief 首轮冻结 + `lib/flow/transcript-store.js`（key `aicrew-director-v1`）存对话+flow 快照。**审查判定**：LLM 意图层（P6-T1）已满足"对话真实化"核心，多轮持久化更接近产品增强。默认 deferred。
  - risk：L2 ｜ deps：P6-T1 ｜ 默认 **deferred**

- **P6-T4 `[可选]` 选中对象 AI 编辑（providers 增 editImage）** **[审查: scope creep]**
  - detail：`providers.js` 增 `editImage`（SiliconFlow `/v1/images/inpaint`、OpenAI `/v1/images/edits`，整图重绘，mask UI deferred）、`config.js` 增 `image_edit` mode、能力位降级隐藏入口。**审查判定**：跨 4+ 文件改 provider 契约，是独立 AI 能力域，体量近一个独立特性。建议**拆为后续 sprint**。（注：这对应 RoboNeo「图像编辑」差距，价值高，但本期可选）
  - risk：L3 ｜ deps：P6-T3 ｜ 默认 **deferred（建议独立 sprint）**

---

## 执行顺序与批次

```
批一(并行底座): P1-T1 ─ P1-T2 ─ {P1-T3, P1-T4}     ‖  P3-T1(imageStore纯层)
批二(交付+持久): P2-T1 ─ P2-T2 ─ P2-T3            ‖  P3-T2  ‖  P4-T1 ─ {P4-T2, P4-T3}
批三(下载+真路由): P2-T5(deps P2-T3,P2-T2,P3-T2)   ‖  P5-T1(deps P1-T4,P2-T2) ─ P5-T2
批四(体验): P6-T1(deps P1-T2)  ─  P6-T3(deps P1-T1,P3-T1,P4-T2) ─ P6-T5
可选(默认 deferred): P2-T4 · P6-T2 · P6-T4(建议独立 sprint)
```

**建议起步**：P1-T1（解锁面最大）+ 并行 P3-T1 / P4-T1。

## Open Risks
- 多 variant 并行出图可能触发 SiliconFlow/OpenAI 限流——P1-T3 软上限是逃生阀，需真 provider 验证。
- data URL 封面(~3×200KB)即便独立 key 仍逼近 localStorage 配额；pruneToQuota LRU 丢弃→旧封面刷新后丢（产品需接受『可重新生成』降级）。
- exports.files 字符串数组→对象数组是破坏性变更；若有未枚举的历史 task 序列化消费方，反序列化旧数据形状不一致，需兼容读取。
- Director LLM 意图分类的成本/延迟 + 多语言误判——正则兜底须鲁棒。
- 画布 AI in-flight AbortController 与 undo/redo、工具切换的竞态——须与 gestureRef 现有取消通道一致。
- brandKit 仅浏览器独立 key——多设备/多标签并发最后写覆盖，无服务端同步（本期接受）。
- video.mp4 恒为 placeholder 与『可真实下载』有认知落差——UI 须明确标注视频为 deferred 占位。

## 测试策略
- 纯函数（generateVariantImages/buildExportFiles/assembleExportBundle/imageStore/brandStore/renderBrandClause/flowToAiModes/classifyDirectorIntent/placeImage）：节点级单测，免 API key。
- AI 层（多图/intent）：mock `fetchImpl`，断言请求体 + 应用 + 降级路径。
- 回归：每 Task 跑 `invariant_tests`（domain/flow/ai/canvas）。
- Bug 修复一律附回归测试，永不删除。

## 变更日志
- 2026-06-23：计划创建。经多 agent 编排核验 + 对抗审查（needs-changes）；审查的 8 条 line 级问题（P5-T1 漏 workflow.js、P2-T2 漏 buildExportRecord/buildAgentArtifact/前端 964·967、P6-T1 reply 契约、视频包 145-154、imageStore 命名空间等）已内联修复；3 条 scope creep（P2-T4/P6-T2/P6-T4）降级为可选。
- 2026-06-23：**全部 18 核心任务实施完成**（TDD），测试 106→148 全绿（+42），`next build` 通过（17 页）。逐阶段落点：
  - P1 多 variant 真出图：`generateVariantImages` 纯函数 + `enabledModes` + `maxImagesPerRun`（lib/ai/workflow.js）
  - P2 内容化导出：`buildExportFiles`/`assembleExportBundle` + `fileNames` 兼容迁移 + 前端真实下载（含旧 localStorage 形状防护）
  - P3 封面持久化：`lib/storage/imageStore.js`（data/remote 分治 + LRU）+ stash/rehydrate 接入 sanitizeStateForStorage
  - P4 Brand Memory：`lib/brand/store.js` 独立 key + `renderBrandClause/ImageHint`（防注入）+ 受控编辑页
  - P5 节点驱动：`flowToAiModes` 透传 enabledModes + qa/export 节点门控（统一在 domain，保等价不变量）
  - P6 体验：Director `lib/flow/intent.js`（LLM 意图 + applyDirectorOps，正则兜底）+ 画布 `placeGeneratedImage(s)`（AI 经 props 注入，lib/canvas 零依赖 ai，单 commit）
  - 不变量守护：canvas 零 import ai ✓、导出契约叠加 ✓、video.mp4 恒 placeholder ✓、graceful degradation ✓
  - 可选项（P2-T4 服务端端点 / P6-T2 对话持久化 / P6-T4 editImage）按审查建议仍 deferred。
  status: completed。建议下一步 `/review` 多视角复审 + `/compound` 沉淀。
