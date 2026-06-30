---
title: "排期层（绿区半自动）"
type: sprint
status: completed
created: "2026-06-30"
updated: "2026-06-30"
checkpoints: 0
tasks_total: 6
tasks_completed: 6
tags: [sprint, feature, 排期层, 发布交接, 绿区, 静态站]
aliases: ["排期层", "schedule-layer", "绿区半自动"]

# === 本 sprint 立的不变量，后续 sprint 必须保持 ===
invariants:
  - "排期是 WHEN-唤起轴，与 Tier 预填保真度轴正交；不混叫 Tier 0.5"
  - "发布永远复用 oneClickRednotePublish + supportsRednoteHandoff 硬门控（仅小红书一键带稿）；从不自动化官方发布器逐帖人工 gate"
  - "排期元数据=task 级标量 task.scheduledAt(ISO UTC Z) 写 aicrew_tasks.payload jsonb（按 task 分组，非 export 级），走现有 /api/state replace-all snapshot；不建 server-owned 队列(aicrew_publish_queue)、不加 scheduled_at 投影列"
  - "domain.js 零改动：排期 reducer/selector 落新 lib/schedule/queue.js；task↔export 反查走 export.projectId→project.taskId 两跳(export 无 taskId)，不臆造 export.taskId"
  - "scheduledAt 放 task 标量层，绝不进 task.variants（否则被 sanitizeStateForStorage stripVariantMedia 剥掉）"
  - "纯静态站真后台 push 物理不可能（无 VAPID push server + 无 cron，静态导出与生产 Next server 皆无）；提醒只走 .ics OS 日历 + in-page toast 双轨"
  - "lib/share/ics.js 纯逻辑零副作用，有单测；浏览器副作用(下载/计时器)留 components"

# === 本 sprint 不变量回归测试入口（Phase 3 每 task 必跑）===
invariant_tests:
  - tests/share-rednote.test.js
  - tests/share-ics.test.js
  - tests/schedule-queue.test.js
  - tests/schedule-persistence.test.js
  - tests/state-repository.test.js

deferred: []
deadcode_until: []
---

# 排期层（绿区半自动）

## Phase 1: 需求分析

### 来源
承接 2026-06-30「快速接入 RPA」调研 + workflow 对抗核证（5 agents / 309k tok / verdict ok / 0 P0P1）。用户选定形态=**站内绿区半自动**，非真 RPA。记忆锚点：[[aicrew-publish-handoff]]「排期层接入方案」段、[[aicrew-xiaoji-architecture-blueprint]] RPA 谱系绿区。

### 一句话
给已产出的 export 挂「排期发布时间」→ 到点双轨提醒（OS 日历 + 站内 toast）→ 复用现有一键带稿唤起官方发布器，**人工确认发布**。全程留在静态站内、零新增凭证、零合规风险。

### Scope（做）
1. **排期数据**：export 可设 `scheduledAt`（ISO 串），写 `aicrew_exports.payload` jsonb，搭现有 `/api/state` replace-all snapshot 持久化（刷新/换设备经云端同步可见）。
2. **.ics 日历导出**（主提醒，tab 关也准时）：纯逻辑 `lib/share/ics.js` 生成 VEVENT+VALARM，经现有 `triggerBrowserDownload` 下载，告警卸载给用户 OS 日历。
3. **in-page toast**（辅提醒，仅 tab 开）：net-new `useEffect`+`setInterval` 轮询到点 → 触发现有 `addNotificationToState`。
4. **due-queue 面板**：到点/逾期 export 列表，每项复用 `RednoteHandoff`（**必带 `imageFiles`**）一键带稿；`supportsRednoteHandoff` 硬门控仅小红书。
5. 纯逻辑单测 `tests/share-ics.test.js`。

### Non-scope（不做）
- ❌ 真后台 push 提醒（tab 关弹窗）—— **物理不可能**（无 VAPID push server + 无 cron），不尝试 service worker/PushManager/web-push。
- ❌ 真 RPA 自动发布/自动确认 —— 黑区永久焊死。
- ❌ 非小红书的「一键带稿」—— 抖音/视频号无已验证预填通道，排期可提醒但发布降级为手动（见 Risks）。
- ❌ `aicrew_publish_queue` server-owned 队列 —— 无 server 处理它、反被客户端 replace-all 覆盖，违背 minimal。
- ❌ additive `scheduled_at` 列（仅未来服务端按时间查询才做，本 sprint 用 jsonb 足够）。

### Success（验收）
- export 能设排期时间并持久化，刷新后仍在。
- 到点：tab 开 → 站内 toast 弹；任何时候 → 可导出 .ics，OS 日历到点响。
- due-queue 面板列出到期项，点击经 `oneClickRednotePublish` 带图带文唤起小红书发布器。
- `lib/share/ics.js` 纯逻辑、有单测、零副作用；`tests/share-rednote.test.js` 仍绿。
- domain.js 零改动；无新增 server 路由；无 DB 迁移。

### Risks
| 风险 | 等级 | 缓解 |
|------|------|------|
| 非小红书排期只提醒无一键带稿 | 设计取舍 | 文档化：到点提醒通用，发布降级手动；待 Tier1 凭证或平台深链证实 |
| 多设备提醒一致性 | 中 | `scheduledAt` 进 payload 走云端同步，非纯 localStorage |
| .ics 时区歧义 | 中 | DTSTART 用 UTC `Z` 格式，避免本地时区漂移 |
| in-page timer 是净新增（非"复用"既有 setInterval） | 低（认知） | 明确标注 net-new useEffect；现有 setInterval 皆 blob-revoke/debounce/UI/fetch-abort/DB-backoff，无提醒计时器 |
| due-queue 漏传 imageFiles → 退化为纯文本丢图 | 中 | 复用 Exports 卡 :1974 的 `variant+imageFiles` 双参签名，强制带图 |

### 开放点（已闭合 — 用户 2026-06-30 决策）
1. ✅ **仅小红书**：非小红书（抖音/视频号）排期**完全出 scope**——无控件、无提醒、无带稿。待 Tier1 凭证或平台深链证实后另开。
2. ✅ **按 task 分组**：scheduledAt 挂 task 级（一个 task 一次创作运行=一整批产物=一个排期时间），非单 export variant。
3. ✅ **UTC Z**：scheduledAt 存 ISO UTC 串（`.toISOString()`），.ics DTSTART 用 `YYYYMMDDTHHMMSSZ`。

---

## Phase 2: 技术方案

> 设计经 grounded workflow（4 路并行侦察 41 findings → 综合 → 对抗核证 **verdict ok / 5-of-5 pass / 0 P0P1 / 3 P2**）。详见 workflow 输出。

### 数据模型（核证后落点）

`scheduledAt` 挂 **task 级标量**，写 `aicrew_tasks.payload` jsonb：

```
task.scheduledAt = "2026-06-30T14:00:00.000Z"   // ISO-8601 UTC Z，未排期=缺省/null
```

**为何挂 task 不挂 export**（recon 实测）：
- `export` 对象**无 taskId**（`buildExports`/`buildExportRecord` 只带 `projectId`+`variantId`，domain.js:3149-3157）。
- `project.taskId` 1:1（一个 task=一次创作运行=一个 project=一整批 export），task 是天然批次边界与所有者。
- 按 task 分组排期 = 一个 task 一个 `scheduledAt` 一行，**零同步压力**（对比 export 级要把同一时间写满 N 个 variant 行）。
- 发布期 task↔rednote-export 反查走两跳：`export.projectId → project(project.taskId===task.id) → 该 project 下 exports 过 supportsRednoteHandoff`。

**持久化路径（逐行核证，零迁移）**：
```
写: setState(c=>setTaskScheduledAt(c,taskId,isoUtc)) → useEffect[state] → 600ms debounce(AICrewStudio.jsx:480)
    → remote.serializeWrite FIFO → pushSnapshot(sanitizeStateForStorage) → PUT /api/state
    → saveStateSnapshot 单事务 → delete aicrew_tasks + insert payload=tx.json(item)(state.js:166，无字段白名单)
读: GET /api/state → loadStateSnapshot → tasks.map(row=>row.payload)(state.js:101) 原样回灌
脱敏豁免: sanitizeStateForStorage stripList 只剥 item.variants 媒体(AICrewStudio.jsx:286)，不动 task 标量 → scheduledAt 必活
```
不建 `aicrew_publish_queue`、不加 `scheduled_at` 投影列（照 status 先例 payload-only）、**domain.js 零改**（`setTaskScheduledAt` 落新 `lib/schedule/queue.js`）。

### 入场扫描 - Invariants 继承（回归扫描）

| 子系统 | 既有 invariant | 本 sprint 如何保持 |
|--------|----------------|--------------------|
| 持久化脱敏盲区 [[aicrew-persist-sanitization-blindspot]] | stripList 只剥 variant 媒体不碰 task 标量 | scheduledAt 放 task 标量层、**绝不进 variants**；T4 焊双向回归 |
| 发布交接门控 [[aicrew-publish-handoff]] | supportsRednoteHandoff 仅小红书、从不自动化官方发布器 | T2 门控 + T6 复用 RednoteHandoff/oneClickRednotePublish；非小红书 export 滤掉、连控件都不出现 |
| replace-all snapshot | 集合表零迁移走 jsonb payload（status 先例） | 不建队列、不加列、payload-only |
| domain.js 稳定 | 业务管线集中 domain.js | 排期逻辑落 lib/schedule/queue.js，domain.js 零改 |
| 纯逻辑/副作用分离 [[aicrew-canvas-runtime]] | lib/share/rednote.js 纯逻辑零副作用 | ics 同构落 lib/share/ics.js 纯逻辑，副作用留 components |
| serializeWrite FIFO | 单写通道串行 | 排期写搭现有 600ms debounce→pushSnapshot，不另开写路径 |

### 入场扫描 - 集成路径声明

| 改动点 | 触发动作 | 中间层 | 持久化 | 刷新/换设备可见 |
|--------|----------|--------|--------|------------------|
| 设排期 (T3) | History task 卡 ScheduleControl（isTaskScheduleEligible 门控） | setState→600ms debounce:480→serializeWrite→pushSnapshot | ✅ aicrew_tasks.payload jsonb | ✅ loadStateSnapshot 回灌 + 云端同步 |
| 到点-主轨 (T1) | .ics 下载 | triggerBrowserDownload Blob text/calendar | ✅ 卸载给 OS 日历 | ✅ tab 关也响（VALARM） |
| 到点-辅轨 (T5) | useEffect setInterval ~60s | selectDueTasks→addNotificationToState | — 内存 toast | ⚠️ 仅 tab 开有效 |
| 一键带稿 (T6) | due-queue 每 rednote export RednoteHandoff | oneClickRednotePublish(variant,imageFiles) | — 唤起官方发布器 | ✅ 人工确认发布 |

**全链路无静默 ❌**（核证 antiDriftComplete=pass）。非小红书路径全程不接入=按约束完全出 scope。

### 入场扫描 - 半完成债务清单

| 议题 | 本 sprint 决策 | 备注 |
|------|----------------|------|
| 跨设备并发排期写 last-write-wins | ⏭ 推迟 | 整替换 PUT 无版本守卫；本期接受静默覆盖，未来加乐观并发 |
| 多 tab 重复 toast | ⏭ 推迟 | 本期 useRef 单 tab 去重 + .ics 权威兜底；未来 BroadcastChannel |
| additive scheduled_at 投影列 | ⏭ 推迟 | 仅未来服务端按时间 SQL 查询(cron/push)才加 |
| 非小红书排期 | ⏭ 推迟 | 待 Tier1 凭证或平台深链证实预填通道 |
| 后台标签 setInterval 节流≥1min | 接受 | 辅轨精度受限；主轨 .ics 不受影响 |

### 任务拆解（T1-T6，全 L1-L3）

| Task | 标题 | 文件 | Risk | 测试 |
|------|------|------|------|------|
| **T1** | .ics 纯逻辑生成器（主提醒） | `lib/share/ics.js` + `tests/share-ics.test.js` | L2 | DTSTART/DTSTAMP UTC-Z 无 floating（喂同一 Date 任意 host TZ 输出恒定）·VCALENDAR/VEVENT/VALARM 三层·RFC5545 转义(逗号/分号/反斜杠/换行,CRLF)·UID 基于 taskId+scheduledAt 稳定 |
| **T2** | 排期纯逻辑：reducer+门控+到点判定 | `lib/schedule/queue.js` + `tests/schedule-queue.test.js` | L2 | setTaskScheduledAt 不可变(原 state.tasks 引用不变,传 null 清除)·selectRednoteExportsForTask 两跳反查仅返小红书 export·isTaskScheduleEligible·selectDueTasks 边界(<=now 含/future 排/缺值排/非 eligible 排)·**project 缺失 case 返 []**(P2#1)·import supportsRednoteHandoff DRY |
| **T3** | task 卡排期控件 + .ics 下载接线 | `components/AICrewStudio.jsx` | L2 | 无 DOM 测试框架→冒烟：History task 卡(仅 eligible 显示)datetime-local→toISOString 存 UTC→下载 .ics 复用 triggerBrowserDownload(照 :146-149)→刷新回显 |
| **T4** | 持久化往返回归（脱敏不丢） | `tests/schedule-persistence.test.js` + `components/AICrewStudio.jsx` | L3 | sanitizeClientStateForSave 透传 task·导出 sanitizeStateForStorage(加一行 export,**仅供测试**P2#2)断言 stripList 保 task.scheduledAt 标量只剥 variants·round-trip tasks.map(row=>payload) 不丢 |
| **T5** | in-page toast 到点轮询（辅提醒） | `components/AICrewStudio.jsx` | L2 | **净新增** useEffect+setInterval(全仓零 setInterval,首个周期计时器)·判定用 T2 selectDueTasks·去重 useRef Set 键 `${taskId}:${scheduledAt}`·卸载 clearInterval·冒烟 |
| **T6** | due-queue 面板 + 复用 RednoteHandoff 一键带稿 | `components/AICrewStudio.jsx` | L2 | 派生逻辑 T2 已测·冒烟：内嵌 History 顶部到期区块(不新建 view)·每 rednote export 渲 RednoteHandoff variant=findVariantById imageFiles=assembleExportBundle(export,variant).imageFiles(同 :1974 签名强制带图)→oneClickRednotePublish 人工确认 |

**依赖序**：T1、T2 无依赖可并行起步 → T3 依赖 T1+T2 → T4 依赖 T2 → T5 依赖 T2 → T6 依赖 T2(+T3 控件)。建议序：T1‖T2 → T4 → T3 → T5 → T6。

### 测试策略

运行器 `node --test`（package.json），纯 node:test + node:assert/strict，**全仓零 jsdom**。策略=纯逻辑沉可测模块 + 组件只编排：
- **L2 纯逻辑**(T1/T2)：RFC5545 正确性 + reducer 不可变 + 门控空数组 + 到点边界。
- **L3 持久化**(T4)：scheduledAt 经 sanitize 双路径透传 + round-trip 不丢（零迁移证明，永不删）。
- **UI**(T3/T5/T6)：无自动化网，逻辑已被 T2/T4 覆盖，组件做手动冒烟。
- **回归基线**：`tests/share-rednote.test.js` + `tests/state-repository.test.js` 必持绿。

### 3 个 P2（核证产出，已纳入对应 task）
- **P2#1** → T2 增 project 缺失 case 单测（two-hop 返 [] / eligible=false 安全排除）。
- **P2#2** → T4 给 `sanitizeStateForStorage` 加 export **仅供测试 import**，不引入外部耦合。
- **P2#3** → 已修：本文档 frontmatter invariant 已改 task 级、setInterval 措辞已标 net-new、open point #2 已闭合。

---

## Phase 3: 变更日志（Work，T1-T6 全完成）

| Task | 文件 | 关键实现 |
|------|------|----------|
| T1 | `lib/share/ics.js` + `tests/share-ics.test.js` | `buildIcsCalendar`/`formatIcsUtc`(UTC-Z)/`escapeIcsText`/`buildScheduleUid`/`foldIcsLine`(RFC5545 §3.1) + VALARM；纯逻辑 |
| T2 | `lib/schedule/queue.js` + `tests/schedule-queue.test.js` | `setTaskScheduledAt`(不可变) / `selectRednoteExportsForTask` / `isTaskScheduleEligible` / `selectDueTasks`(fail-closed)；**从 task.exports 驱动**（修正 plan 的 projectId 两跳：seed 路径 state.exports 缺 projectId） |
| T3 | `components/AICrewStudio.jsx` | `ScheduleControl` 组件（History task 卡，eligible 门控）+ .ics 下载复用 triggerBrowserDownload + 本地↔UTC 互转 |
| T4 | `lib/state/storage-sanitize.js` + `tests/schedule-persistence.test.js` + `components/AICrewStudio.jsx` | 抽 `stripCollectionMedia` 纯逻辑（修正 plan：jsx 无法 node:test import）+ sanitizeClientStateForSave/jsonb 往返回归 |
| T5 | `components/AICrewStudio.jsx` | due-poll useEffect（净新增单 setInterval，nowTick 驱动 + 双重去重 toast 辅轨） |
| T6 | `components/AICrewStudio.jsx` | `DueScheduleQueue` 到期面板（History 顶部）+ 复用 RednoteHandoff（imageFiles 经 assembleExportBundle 带图） |

CSS：`styles/globals.css` 增 `.schedule-control*`/`.schedule-due-*`/`.schedule-control-hint`。domain.js **零改动**（已验证）。

验证：`node --test` 326 tests / 324 pass / 0 fail / 2 skipped(db)；TS JSX 解析 OK；`next build` exit 0（全路由含 /history 编译）。

---

## Phase 4: 审查结果（5 lens 并行 + 逐发现对抗核证）

workflow：19 agents / 977k tok / 171 tool uses。**verdict: P0=0 / P1=0 / P2=11 确认 / 3 误报剔除**。

### 3 误报（对抗核证准确剔除）
- `firedRemindersRef 单调增长`：主轨 DueScheduleQueue 无去重恒渲染，完全补偿；增长量级可忽略。
- `占位 a.js`：integration-continuity lens 返回模板占位值（a.js 不存在），无实指。
- `setTaskScheduledAt 未同步 updatedAt`：「任何 task 变更刷 updatedAt」非不变量（reconcileInterruptedTasks 即反例）；TaskTable 不按 updatedAt 排序；clock-free 是 queue.js 明示设计。

### 11 P2 处置（10 修 / 1 cosmetic 接受）
| # | lens | 问题 | 处置 |
|---|------|------|------|
| 1 | correctness | selectDueTasks 对非数值 nowMs fail-open（漏未来排期） | ✅ 修：`if(!Number.isFinite(cutoff)) return []` + 回归测试 |
| 2 | security | escapeIcsText 漏转义孤立 `\r`（换行注入面） | ✅ 修：`/\r\n\|[\r\n]/g` + 回归测试 |
| 3 | correctness | 过期排期每刷新重复追加 notifications 无界增长 | ✅ 修：reminderKey 跨刷新去重（内存 firedRef + 已落库 key 双重） |
| 4 | security | downloadIcs 对损坏 scheduledAt 未兜底致抛出 | ✅ 修：`hasValidSchedule` 门控按钮 disabled + 早返回 |
| 5 | react-perf | DueScheduleQueue render 内 Date.now()、到点刷新隐式依赖 toast 副作用 | ✅ 修：nowTick state 由同一 interval 驱动，now 经 prop 入 render 纯化 |
| 6 | react-perf | render 体内写 ref + 空 deps 捕获组件内函数 | ✅ 修：ref 写入移进 `useEffect([state])` |
| 7 | correctness | .ics VALARM 被 Google 日历丢弃，「tab 关也准时」过度承诺 | ✅ 修：软化 ics.js 头注措辞 + ScheduleControl 加客户端提示 |
| 8 | code-quality | `productName \|\| "内容"` 三处重复 | ✅ 修：抽 `taskProductName` helper |
| 9 | code-quality | 60000 魔法数 | ✅ 修：`DUE_POLL_INTERVAL_MS` 具名常量 |
| 10 | correctness | .ics 无 RFC5545 §3.1 行折叠，中文超 75 octet | ✅ 修：`foldIcsLine`（UTF-8 字节感知、不切多字节）+ 折叠测试 |
| 11 | code-quality | History fragment 内层 JSX 缩进 2 空格偏移 | ⏭ **cosmetic 接受**：核证员自评零功能影响、仓库无 formatter；75 行纯空白重排会淹没真实 diff、损害可审性，故不在本 feature PR 混入 |

修复后复验：`node --test` 324 pass / 0 fail；`next build` exit 0。

---

## Phase 5: 复利记录（Compound）

### 沉淀到记忆
- `aicrew-publish-handoff`：排期层「方案」→「已落地」，记 3 处实现期 grounding 纠正。
- `tooling-jsx-not-node-testable`（新）：`.jsx` 组件无法 node:test import → 抽纯逻辑到 `lib/` 才可测；组件改动用 `next build` + TS `transpileModule` parse-check 验证。
- `MEMORY.md`：两条索引同步。

### 可复用经验
1. **plan 的数据模型推测必须落地核实**：plan/workflow 推荐「export.projectId→project 两跳」反查 task 产物，落地发现 auto/seed 路径 `state.exports` 缺 projectId（domain.js:1975），改用 **task 自描述**（`task.exports` 自带 platform/variantId/files + `task.variants`）——按 task 分组的操作天然该从 task 驱动，别绕 projectId。
2. **「加 export 即可单测」是伪可行**：仓库无 JSX transform，`.jsx` import 不进 node:test；要测组件内逻辑必抽纯函数到 `lib/`（本 sprint 抽 `stripCollectionMedia`）。
3. **诚实声明能力边界**：.ics VALARM 被 Google 日历丢弃 → 「tab 关也准时」非绝对，头注 + UI 提示如实说明，不过度承诺（绿区护城河 = 不夸大）。
4. **静态站零后端提醒的物理上限**已实证落地：.ics OS 日历（主，tab 关）+ in-page toast（辅，仅 tab 开）双轨；真后台 push 不可能（无 VAPID + 无 cron）。

### 工程方法
- think→plan→work→review→compound 全程：plan 与 review 各跑一次多 agent workflow（grounded 侦察 + 对抗核证），P0/P1 零、P2 高召回（11 真 + 3 误报准确剔除）。
- 测试随风险：纯逻辑 L2/L3 全单测（含 fail-closed/注入/折叠回归，永不删）；组件 L2 冒烟 + build 集成验证。

🏁 Sprint 完成。文档：本文件。知识：1 记忆更新 + 1 新建 + 索引。验证：324 pass / 0 fail · next build exit 0 · domain.js 零改。
