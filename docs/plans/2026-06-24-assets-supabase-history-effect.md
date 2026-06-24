---
title: "素材库二进制下沉 Supabase + 历史点卡片就地出效果"
type: sprint
status: completed
created: "2026-06-24"
updated: "2026-06-24"
checkpoints: 0
tasks_total: 5
tasks_completed: 5
tags: [sprint, assets, supabase, history, aicrew]
aliases: ["assets-supabase", "history-effect"]
goal: "资源库直接接入 Supabase（上传二进制成为 aicrew_assets 一等行，不再内联撑大主 snapshot）；历史点卡片右侧就地呈现之前的效果。结束条件：npm test + npm run build 通过、路由 200。"
goal_status: met
goal_iteration: 0
invariants:
  - "Supabase 主 snapshot 仍是工作区状态权威源；localStorage 只做离线兜底。"
  - "图像/二进制走独立 aicrew_assets 表，主 snapshot 只留轻量元数据（变体封面与库素材同源治理）。"
  - "aicrew_assets 命名空间隔离：variant:<id> / canvas:<id> / library:<id> 三类共表不串键。"
  - "每次 pushAssetStore 必须把全部命名空间写入同一 store 后整存替换，杜绝某一类被 replace-all 抹掉。"
  - "锁定历史记录后不得触发重编辑等编辑动作（沿用上一 sprint 不变量）。"
invariant_tests:
  - "npm test"
  - "npm run build"
deferred:
  - "本地缓存路径下 library: 与 variant: 共享 4MB LRU 配额，大库素材会加剧变体封面被逐（仅离线缓存；云端 UNBOUNDED 权威源不受影响）。如需可拆分双命名空间各自配额。"
  - "saveAssets 整存替换为事务内逐行 INSERT，且大 dataURL 单次 PUT；高延迟/超大批量下有失败风险。属既有架构（变体封面同路径），既往 plan 已记录『不做云对象存储/signed upload』权衡。彻底解法是改对象存储 + signed upload。"
  - "迁移分支 pushAssetStore 先于 pushSnapshot，两次写之间崩溃存在极小时序窗口。属既有迁移结构。"
  - "aicrew_assets.ref_key 无命名空间 CHECK 约束；写入错误服务端静默无日志。均为既有，可后续加固。"
---

# 素材库二进制下沉 Supabase + 历史点卡片就地出效果

## Phase 1: Think

### 现状诊断
- 素材库：`state.assets[]` 元数据随主 snapshot 持久化到 Supabase，但上传二进制 `asset.ref`（dataURL）**内联在 snapshot**（`sanitizeStateForStorage` 未剥离），而变体封面早已走独立 `aicrew_assets` 表。落差 = 库素材未成为 Supabase 一等行，且撑大 snapshot。
- 历史：点卡片 `openHistoryTask` 直接**跳走 workbench**；右侧 SELECTED 仅 `VariantCompare`（文字 name/hook/score）+ `AgentTimeline`，无真实"效果"（无封面预览/产出）。

### Scope
- 库素材二进制下沉 `aicrew_assets`，命名空间 `library:<id>`，与变体封面同源 stash/rehydrate。
- 主 snapshot 剥离 `asset.ref`，加载回填；旧内联 ref 首启迁移上云。
- 历史点卡片就地选中（不跳走），右侧 detail 用封面预览 + 文案 + 评分 + 变体切换呈现"之前的效果"；保留显式"在工作台打开"。

### Non-scope
- 不改对象存储 / signed upload（沿用 dataURL 入表，承接上一 sprint 权衡）。
- 不动 saveAssets 整存替换语义、不改 workspace 鉴权模型。

## Phase 2: 技术方案
- `lib/artifacts.js`：新增 `libraryAssetRefKey(id)` → `library:<id>`。
- `lib/storage/imageStore.js`：新增 `stashLibraryAssets` / `rehydrateLibraryAssets`，对照既有变体两函数；与 stashVariantImages 顺序调用即合并进同一 store。
- `components/AICrewStudio.jsx`：
  - `sanitizeStateForStorage` 新增 `stripAssetMedia` 剥离 `asset.ref`。
  - 加载三分支（snapshot+assets可达 / 可达但 assets 不可达回退本地 / 本地兜底+迁移）均接入 `rehydrateLibraryAssets`；迁移分支新增 `stashLibraryAssets` 上云。
  - 保存副作用本地缓存与云推送均新增 `stashLibraryAssets`（云推送写同一 shim 后单次 pushAssetStore —— 关键：避免整存替换抹掉库素材行）。
  - History 新增 `selectHistoryTask`（就地选中不导航）、`HistoryEffect` 组件（PhonePreview large + 变体切换 + 文案 + 评分）；卡片点击/查看效果 → 就地选中；detail 头加"在工作台打开"。

## Phase 3: Work Tasks
- [x] Task 1: 库素材二进制下沉 aicrew_assets（纯函数 + TDD）。
- [x] Task 2: 客户端 rehydrate/stash 接线 + 旧 snapshot 迁移。
- [x] Task 3: 历史就地选中 + 右侧真实效果面板。
- [x] Task 4: CSS + 验证（test/build/路由）。
- [x] Task 5: 并行审查 + compound。

## Phase 4: Review
- 正确性评审：无 P0/P1。核验双命名空间合并写入无互抹、rehydrate 不覆盖已有 ref、HistoryEffect 切换/空态安全。
- DB 评审：所列 P0/P1 经核验均为既有同路径架构属性（saveAssets 整存替换/逐行 INSERT/请求体/迁移时序），非本 sprint 引入的回归（"App Router 4MB body 限制"前提不成立，仅适用 Pages Router）。记入 deferred。

## Phase 5: Compound

### 已验证事实
- `npm test` 通过：241 tests，239 pass，2 skipped（`SUPABASE_DB_URL` 未配置的集成测试）。
- `npm run build` 通过；Next route table 含 `/history`、`/assets`、`/workbench`。
- `npx next start` 路由 200：`/aicrew/history/`、`/aicrew/assets/`、`/aicrew/workbench/`。
- 构建曾因 `postgres` 依赖未安装失败（package.json 已声明），`npm install` 补齐后恢复。

### 收口
- 素材库：上传二进制成为 `aicrew_assets` 一等行（`library:` 命名空间），主 snapshot 不再内联 base64，跨会话从 Supabase 回填。
- 历史：点卡片就地选中，右侧实时呈现该任务封面预览 + 文案 + 评分 + 多变体切换，无需跳走 workbench；保留显式"在工作台打开"。

### 复用经验（可沉淀本能）
- `aicrew_assets` 是单表多命名空间 + 整存替换：任何新增图像类别，**必须在每条云写路径把所有命名空间 stash 进同一 store 再单次 push**，否则 delete-then-insert 会抹掉未 stash 的类别。这是该架构的硬约束。
- 给主 snapshot 减负的统一模式：`stripXxxMedia`（剥离）+ `stashXxx`（落独立表）+ `rehydrateXxx`（回填，仅在字段空时填，不覆盖 live 值）。新增任何大二进制字段都套此三件套。
