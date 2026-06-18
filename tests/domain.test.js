import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateQualityScore,
  createInitialState,
  createProjectFromTask,
  defaultBrandKit,
  estimateCredits,
  normalizeBrief,
  parseBriefText,
  reviseVariantHook,
  runCreativeWorkflow,
  saveSkillFromProject
} from "../src/domain.js";

test("normalizes incomplete brief with PRD defaults", () => {
  const brief = normalizeBrief({ productName: "Pocket Camera" });

  assert.equal(brief.productName, "Pocket Camera");
  assert.equal(brief.platform, "TikTok");
  assert.match(brief.goal, /生成/);
});

test("parses freeform brief into structured creative brief", () => {
  const brief = parseBriefText("产品 Smart Bottle，受众 健身人群，目标 提升首单转化，TikTok 高级风格");

  assert.equal(brief.productName, "Smart Bottle");
  assert.equal(brief.targetAudience, "健身人群");
  assert.equal(brief.platform, "TikTok");
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

test("initial state contains PRD product surfaces", () => {
  const state = createInitialState();

  assert.ok(state.projects.length >= 1);
  assert.ok(state.tasks.length >= 1);
  assert.ok(state.assets.length >= 4);
  assert.ok(state.exports.length >= 3);
  assert.ok(state.workspace.credits > 0);
});
