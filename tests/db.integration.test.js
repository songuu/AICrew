// Supabase 数据层集成测试：对真实 SUPABASE_DB_URL 做往返断言。
// 运行：npm run test:db（node --env-file=.env --test tests/db.integration.test.js）
// 守卫：无 SUPABASE_DB_URL 时整体 skip，确保 CI 的纯 `npm test`（不加载 .env）不被外部依赖卡住。

import test from "node:test";
import assert from "node:assert/strict";

const hasDb = typeof process.env.SUPABASE_DB_URL === "string" && process.env.SUPABASE_DB_URL.trim().length > 0;

test("Supabase 数据层往返", { skip: hasDb ? false : "SUPABASE_DB_URL 未配置，跳过集成测试" }, async t => {
  const { getSql, closeSql, withDbRetry } = await import("../lib/db/client.js");
  const { saveStateSnapshot, loadStateSnapshot } = await import("../lib/db/repositories/state.js");
  const { applyCreditTransaction } = await import("../lib/db/repositories/credits.js");
  const { saveAssets, loadAssets } = await import("../lib/db/repositories/assets.js");
  const { saveDocument, loadDocument } = await import("../lib/db/repositories/documents.js");

  const sql = getSql();
  // 预热连接（火山 DB 冷连抖动；带重试）。预热后 idle_timeout:0 保活，后续复用单连接。
  await withDbRetry(() => sql`select 1`);
  const workspaceId = `test-${process.pid}-${Date.now()}`;

  t.after(async () => {
    // 级联删除：删 workspace 行即清空全部子表（assets/documents 也有 FK 级联）。
    await sql`delete from public.aicrew_workspaces where id = ${workspaceId}`;
    await closeSql(); // 关闭并清缓存，使后续测试 getSql() 重建新连接
  });

  await t.test("loadStateSnapshot 空工作区返回 null", async () => {
    assert.equal(await loadStateSnapshot(workspaceId), null);
  });

  await t.test("saveStateSnapshot → loadStateSnapshot 往返保序", async () => {
    const state = {
      workspace: { name: "测试工作区", credits: 1234, plan: "pro" },
      tasks: [
        { id: "t-1", title: "任务一", brief: { title: "B1" }, variants: [{ id: "v-1", label: "A" }] },
        { id: "t-2", title: "任务二", projectId: "p-1" }
      ],
      projects: [{ id: "p-1", name: "项目一" }],
      exports: [{ id: "e-1", projectId: "p-1", projectName: "项目一", files: [] }],
      creditLedger: [{ id: "c-1", type: "consume", amount: -10, label: "生成" }],
      customSkills: [{ id: "s-1", name: "自定义技能" }],
      brandKit: { tone: "should-not-persist-in-snapshot" }
    };
    await saveStateSnapshot(state, workspaceId);
    const loaded = await loadStateSnapshot(workspaceId);

    assert.equal(loaded.workspace.name, "测试工作区");
    assert.equal(loaded.workspace.credits, 10000, "客户端 credits 不应覆盖服务端余额");
    assert.equal(loaded.workspace.plan, "pro", "workspace.payload 兜底字段应保留");
    assert.equal(loaded.tasks.length, 2);
    assert.equal(loaded.tasks[0].id, "t-1");
    assert.equal(loaded.tasks[1].id, "t-2", "任务顺序应保持");
    assert.deepEqual(loaded.tasks[0].variants, [{ id: "v-1", label: "A" }], "嵌套 variants 应原样保留");
    assert.equal(loaded.projects[0].id, "p-1");
    assert.equal(loaded.exports[0].id, "e-1");
    assert.equal(loaded.creditLedger.length, 0, "客户端 creditLedger 不应覆盖服务端账本");
    assert.equal(loaded.customSkills[0].name, "自定义技能");
    assert.ok(!("brandKit" in loaded), "brandKit 不应进入主快照（由 documents 单独存）");
  });

  await t.test("saveStateSnapshot 二次写入为整替换（不残留旧行）", async () => {
    await saveStateSnapshot({ workspace: { credits: 5 }, tasks: [{ id: "only" }], projects: [], exports: [], creditLedger: [], customSkills: [] }, workspaceId);
    const loaded = await loadStateSnapshot(workspaceId);
    assert.equal(loaded.tasks.length, 1);
    assert.equal(loaded.tasks[0].id, "only");
    assert.equal(loaded.projects.length, 0, "旧 project 应被整替换清除");
  });

  await t.test("applyCreditTransaction 幂等扣费且 snapshot PUT 不覆盖服务端账本", async () => {
    const first = await applyCreditTransaction({
      transactionId: "txn-1",
      type: "consume",
      amount: -37,
      label: "server consume",
      reservationId: "reservation-1",
      taskId: "task-1"
    }, workspaceId);
    const repeated = await applyCreditTransaction({
      transactionId: "txn-1",
      type: "consume",
      amount: -37,
      label: "server consume",
      reservationId: "reservation-1",
      taskId: "task-1"
    }, workspaceId);
    assert.equal(first.credits, 9963);
    assert.equal(repeated.credits, 9963);
    assert.equal(repeated.idempotent, true);

    await saveStateSnapshot({ workspace: { credits: 9999 }, tasks: [], projects: [], exports: [], creditLedger: [{ id: "fake", amount: 9999 }], customSkills: [] }, workspaceId);
    const loaded = await loadStateSnapshot(workspaceId);
    assert.equal(loaded.workspace.credits, 9963, "snapshot PUT 不应回滚服务端余额");
    assert.equal(loaded.creditLedger.some(entry => entry.id === "txn-1"), true, "snapshot PUT 不应删除服务端账本");
    assert.equal(loaded.creditLedger.some(entry => entry.id === "fake"), false, "客户端伪造账本不应写入");
  });

  await t.test("assets 往返 + 去重 + 脏项剔除", async () => {
    await saveAssets(
      {
        items: [
          { id: "variant:1", url: "data:image/png;base64,AAA", bytes: 3 },
          { id: "canvas:9", url: "https://cdn.example.com/x.png" },
          { id: "variant:1", url: "data:image/png;base64,BBB" }, // 同 id 覆盖
          { id: "bad", url: "" } // 脏项剔除
        ]
      },
      workspaceId
    );
    const { items } = await loadAssets(workspaceId);
    const byId = new Map(items.map(item => [item.id, item]));
    assert.equal(byId.size, 2, "去重 + 剔除脏项后应为 2 条");
    assert.equal(byId.get("variant:1").url, "data:image/png;base64,BBB", "同 id 后者覆盖");
    assert.equal(byId.get("variant:1").kind, "data");
    assert.equal(byId.get("canvas:9").kind, "remote");
  });

  await t.test("documents 往返（brand）", async () => {
    assert.equal(await loadDocument("brand", workspaceId), null);
    await saveDocument("brand", { palette: ["#111", "#fff"], tone: "克制" }, workspaceId);
    const brand = await loadDocument("brand", workspaceId);
    assert.deepEqual(brand.palette, ["#111", "#fff"]);
    assert.equal(brand.tone, "克制");
  });

  await t.test("documents 拒绝非法 doc_type", async () => {
    await assert.rejects(() => saveDocument("evil", {}, workspaceId), /不支持的文档类型/);
  });
});

// 回归：集合表复合主键 (workspace_id, id)。两个 workspace 写入相同 id 不得撞键/回滚（评审 A 项）。
test("跨 workspace 同名 id 互不冲突（复合主键隔离）", { skip: hasDb ? false : "SUPABASE_DB_URL 未配置" }, async t => {
  const { getSql, closeSql, withDbRetry } = await import("../lib/db/client.js");
  const { saveStateSnapshot, loadStateSnapshot } = await import("../lib/db/repositories/state.js");
  const sql = getSql();
  await withDbRetry(() => sql`select 1`); // 预热连接（火山 DB 冷连抖动；带重试）
  const wsA = `test-pk-a-${process.pid}-${Date.now()}`;
  const wsB = `test-pk-b-${process.pid}-${Date.now()}`;

  t.after(async () => {
    await sql`delete from public.aicrew_workspaces where id in (${wsA}, ${wsB})`;
    await closeSql();
  });

  // 两个 workspace 用完全相同的 id（含兜底 index id 场景）。
  const sample = ws => ({
    workspace: { credits: 1 },
    projects: [{ id: "project-0", name: ws }],
    tasks: [{ id: "task-0", title: ws }],
    exports: [], creditLedger: [{ id: "credit-0", amount: -1 }], customSkills: []
  });

  await saveStateSnapshot(sample(wsA), wsA);
  await saveStateSnapshot(sample(wsB), wsB); // 不得因 project-0/task-0/credit-0 全局撞键而回滚

  const a = await loadStateSnapshot(wsA);
  const b = await loadStateSnapshot(wsB);
  assert.equal(a.projects[0].name, wsA, "A 的 project-0 归 A");
  assert.equal(b.projects[0].name, wsB, "B 的 project-0 归 B（同 id 不串）");
  assert.equal(a.tasks[0].title, wsA);
  assert.equal(b.tasks[0].title, wsB);
});
