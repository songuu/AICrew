import test from "node:test";
import assert from "node:assert/strict";
import {
  agents,
  calculateQualityScore,
  createInitialState,
  createProjectFromTask,
  defaultBrandKit,
  estimateCredits,
  normalizeBrief,
  orchestratorAgent,
  parseBriefText,
  reviseVariantHook,
  retryAgentStep,
  runCreativeWorkflow,
  saveSkillFromProject
} from "../lib/domain.js";

test("normalizes incomplete brief with PRD defaults", () => {
  const brief = normalizeBrief({ productName: "Pocket Camera" });

  assert.equal(brief.productName, "Pocket Camera");
  assert.equal(brief.platform, "抖音");
  assert.match(brief.goal, /生成/);
});

test("parses freeform brief into structured creative brief", () => {
  const brief = parseBriefText("产品 Smart Bottle，受众 健身人群，目标 提升首单转化，抖音 高级风格");

  assert.equal(brief.productName, "Smart Bottle");
  assert.equal(brief.targetAudience, "健身人群");
  assert.equal(brief.platform, "抖音");
  assert.match(brief.style, /高级/);
});

test("estimates credits by skill and brief complexity", () => {
  const brief = normalizeBrief({
    productName: "Lamp",
    sellingPoints: "soft light ".repeat(20),
    platform: "TikTok"
  });
  const credits = estimateCredits(brief, "ecom_tiktok_product_ad_v1");

  assert.ok(credits.estimated >= 120);
  assert.ok(credits.video > credits.llm);
  assert.ok(credits.export >= 6);
});

test("runs full creative workflow with three content variants and exports", () => {
  const task = runCreativeWorkflow({
    brief: normalizeBrief({
      productName: "NovaGlow Lamp",
      sellingPoints: "便携柔光，适合露营和桌搭",
      targetAudience: "生活方式消费者"
    }),
    skillId: "ecom_tiktok_product_ad_v1",
    brandKit: defaultBrandKit
  });

  assert.equal(task.status, "completed");
  assert.equal(task.variants.length, 3);
  assert.equal(task.exports.length, 3);
  assert.ok(task.agents.length >= 8);
  assert.ok(task.qa.overallScore >= 80);
  assert.ok(task.credits.actual > 0);
});

test("creates project and saved skill from generated task", () => {
  const task = runCreativeWorkflow({
    brief: normalizeBrief({ productName: "Creator Mic" }),
    skillId: "ecom_tiktok_product_ad_v1"
  });
  const project = createProjectFromTask(task, "Creator Mic launch");
  const skill = saveSkillFromProject(project, "team");

  assert.equal(project.status, "completed");
  assert.equal(project.taskId, task.id);
  assert.equal(skill.visibility, "team");
  assert.equal(skill.sourceProjectId, project.id);
});

test("revises hook without mutating original variant", () => {
  const task = runCreativeWorkflow({
    brief: normalizeBrief({ productName: "Desk Pad" }),
    skillId: "ecom_tiktok_product_ad_v1"
  });
  const original = task.variants[0];
  const revised = reviseVariantHook(original, "前三秒更强");

  assert.notEqual(revised.id, original.id);
  assert.equal(revised.version, original.version + 1);
  assert.match(revised.timeline[0].action, /前三秒更强/);
  assert.equal(original.version, 1);
});

test("quality score follows PRD weighted formula", () => {
  const score = calculateQualityScore({
    briefMatch: 100,
    productVisibility: 80,
    hookStrength: 80,
    visualQuality: 80,
    brandConsistency: 90,
    platformFit: 90,
    compliance: 100
  });

  assert.equal(score, 88);
});

test("supports 小红书 platform across the ecosystem", () => {
  const brief = normalizeBrief({ productName: "玻尿酸面膜", platform: "小红书" });
  assert.equal(brief.platform, "小红书");

  const task = runCreativeWorkflow({
    brief,
    skillId: "rednote_seeding_note_v1",
    brandKit: defaultBrandKit
  });

  assert.equal(task.skillName, "小红书种草笔记");
  assert.equal(task.variants[0].aspectRatio, "3:4");
  assert.ok(task.variants[0].hashtags.includes("#小红书"));
  assert.ok(task.qa.overallScore >= 80);
});

test("image-first 小红书 note delivers image artifacts, not a video pack", () => {
  const task = runCreativeWorkflow({
    brief: normalizeBrief({ productName: "玻尿酸面膜", platform: "小红书" }),
    skillId: "rednote_seeding_note_v1",
    brandKit: defaultBrandKit
  });

  // 交付物不应包含视频文件，且应是图文笔记结构而非时间码分镜
  const files = task.exports[0].files;
  assert.ok(!files.includes("video.mp4"));
  assert.ok(files.includes("note.md"));
  assert.equal(task.variants[0].duration, null);
  assert.equal(task.variants[0].timeline[0].time, "封面");
  // 图文型不计视频算力
  assert.equal(task.credits.video, 0);
  // QA 改用封面/标题吸引力而非视频 Hook
  assert.ok(task.qa.checks.some(check => check.label === "封面/标题吸引力"));
});

test("video skills still deliver a video pack", () => {
  const task = runCreativeWorkflow({
    brief: normalizeBrief({ productName: "NovaGlow Lamp", platform: "TikTok" }),
    skillId: "ecom_tiktok_product_ad_v1",
    brandKit: defaultBrandKit
  });

  assert.ok(task.exports[0].files.includes("video.mp4"));
  assert.equal(task.variants[0].duration, 15);
  assert.ok(task.credits.video > 0);
});

test("detects 小红书 platform from freeform brief", () => {
  const brief = parseBriefText("产品 玻尿酸面膜，受众 抗老人群，目标 提升收藏，小红书 种草风格");
  assert.equal(brief.platform, "小红书");
});

test("initial state contains PRD product surfaces", () => {
  const state = createInitialState();

  assert.ok(state.projects.length >= 1);
  assert.ok(state.tasks.length >= 1);
  assert.ok(state.assets.length >= 4);
  assert.ok(state.exports.length >= 3);
  assert.ok(state.workspace.credits > 0);
});


test("agent catalog exposes PRD execution contract", () => {
  assert.equal(orchestratorAgent.id, "orchestrator");
  assert.match(orchestratorAgent.retryPolicy, /重试/);

  for (const agent of agents) {
    assert.ok(agent.responsibility, agent.id + " responsibility missing");
    assert.ok(agent.input, agent.id + " input missing");
    assert.ok(agent.output, agent.id + " output missing");
    assert.ok(agent.evaluation, agent.id + " evaluation missing");
    assert.ok(agent.cost > 0, agent.id + " cost missing");
    assert.ok(agent.tools.length >= 2, agent.id + " tools missing");
  }
});

test("workflow records orchestrator plan and per-agent events", () => {
  const task = runCreativeWorkflow({
    brief: normalizeBrief({ productName: "NovaGlow Lamp", platform: "TikTok" }),
    skillId: "ecom_tiktok_product_ad_v1",
    brandKit: defaultBrandKit
  });

  assert.equal(task.orchestrator.id, "orchestrator");
  assert.deepEqual(task.orchestrator.plan, task.agents.map(agent => agent.id));
  assert.equal(task.events.length, task.agents.length);
  assert.ok(task.events.every(event => event.event === "agent_completed"));
  assert.ok(task.agents.every(agent => agent.artifact && agent.evaluation && agent.tools.length));
});

test("single agent retry is traceable and billed", () => {
  const task = runCreativeWorkflow({
    brief: normalizeBrief({ productName: "NovaGlow Lamp", platform: "TikTok" }),
    skillId: "ecom_tiktok_product_ad_v1"
  });
  const beforeCredits = task.credits.actual;
  const beforeEvents = task.events.length;
  const { task: retried, cost } = retryAgentStep(task, "script");
  const scriptAgent = retried.agents.find(agent => agent.id === "script");

  assert.equal(cost, scriptAgent.cost);
  assert.equal(scriptAgent.retryCount, 1);
  assert.equal(retried.credits.actual, beforeCredits + cost);
  assert.equal(retried.events.length, beforeEvents + 1);
  assert.equal(retried.events.at(-1).event, "agent_retried");
  assert.equal(retried.events.at(-1).agentId, "script");
});
