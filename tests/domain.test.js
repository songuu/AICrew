import test from "node:test";
import assert from "node:assert/strict";
import {
  agents,
  buildExportFiles,
  calculateQualityScore,
  createInitialState,
  createProjectFromTask,
  defaultBrandKit,
  estimateCredits,
  findSkill,
  findPlatformPreset,
  scoreHookStrength,
  mergeCreativeParams,
  normalizeBrief,
  orchestratorAgent,
  parseBriefText,
  reviseVariantHook,
  retryAgentStep,
  runCreativeWorkflow,
  saveSkillFromProject,
  skills,
  skillGroups,
  skillsInGroup
} from "../lib/domain.js";

test("normalizes incomplete brief with PRD defaults", () => {
  const brief = normalizeBrief({ productName: "Pocket Camera" });

  assert.equal(brief.productName, "Pocket Camera");
  assert.equal(brief.platform, "抖音");
  assert.match(brief.goal, /生成/);
});

test("normalizeBrief carries uploaded materials and defaults to empty array", () => {
  assert.deepEqual(normalizeBrief({ productName: "Lamp" }).materials, []);
  const withMaterials = normalizeBrief({
    productName: "Lamp",
    materials: [{ name: "front.png", type: "image/png", ref: "data:image/png;base64,AAA" }]
  });
  assert.equal(withMaterials.materials.length, 1);
  assert.equal(withMaterials.materials[0].name, "front.png");
});

test("mergeCreativeParams overrides platform/audience/materials onto a brief", () => {
  const base = normalizeBrief({ productName: "Lamp", platform: "抖音", targetAudience: "默认受众" });
  const merged = mergeCreativeParams(base, {
    platform: "小红书",
    audience: "25-35 岁都市女性",
    materials: [{ name: "ref.png", type: "image/png", ref: "data:image/png;base64,AAA" }]
  });
  assert.equal(merged.platform, "小红书");
  assert.equal(merged.targetAudience, "25-35 岁都市女性");
  assert.equal(merged.materials[0].name, "ref.png");
  // 原 brief 不被修改（不可变）
  assert.equal(base.platform, "抖音");
  assert.equal(base.materials.length, 0);
});

test("mergeCreativeParams leaves untouched fields when params are empty", () => {
  const base = normalizeBrief({ productName: "Lamp", platform: "小红书", targetAudience: "原受众" });
  const merged = mergeCreativeParams(base, { audience: "   " });
  assert.equal(merged.platform, "小红书");
  assert.equal(merged.targetAudience, "原受众");
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
  const fileNames = task.exports[0].fileNames;
  assert.ok(!fileNames.includes("video.mp4"));
  assert.ok(fileNames.includes("note.md"));
  // note.md 现内联真实 markdown 内容
  assert.ok(task.exports[0].files.find(file => file.name === "note.md").content.length > 0);
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

  assert.ok(task.exports[0].fileNames.includes("video.mp4"));
  // 视频文件本期仍为占位，不生成真实二进制（守护硬约束）
  assert.equal(task.exports[0].files.find(file => file.name === "video.mp4").kind, "placeholder");
  assert.equal(task.variants[0].duration, 15);
  assert.ok(task.credits.video > 0);
});

test("detects 小红书 platform from freeform brief", () => {
  const brief = parseBriefText("产品 玻尿酸面膜，受众 抗老人群，目标 提升收藏，小红书 种草风格");
  assert.equal(brief.platform, "小红书");
});

// ---- RoboNeo 式技能选择器：数据模型 ----
test("skillGroups exposes 推荐 first, then the 带货 categories", () => {
  assert.equal(skillGroups[0].id, "featured");
  assert.equal(skillGroups[0].name, "推荐");
  const ids = skillGroups.map(group => group.id);
  assert.deepEqual(ids, ["featured", "ecom", "beauty", "shortvideo"]);
});

test("every skill carries picker metadata (icon/group/promise/bestFor)", () => {
  const groupIds = new Set(skillGroups.map(group => group.id));
  for (const skill of skills) {
    assert.ok(skill.icon, `${skill.id} missing icon`);
    assert.ok(groupIds.has(skill.group), `${skill.id} has unknown group ${skill.group}`);
    assert.ok(skill.group !== "featured", `${skill.id} group must be a real category, not the 推荐 alias`);
    assert.ok(skill.promise && skill.bestFor, `${skill.id} missing promise/bestFor`);
  }
});

test("skillsInGroup(featured) returns only featured skills", () => {
  const featured = skillsInGroup("featured");
  assert.ok(featured.length > 0);
  assert.ok(featured.every(skill => skill.featured === true));
  // 无参 / 未知分类回退到推荐，避免空列表
  assert.deepEqual(skillsInGroup().map(s => s.id), featured.map(s => s.id));
});

test("skillsInGroup filters by group and includes UGC 种草测评 under 美妆护肤", () => {
  const beauty = skillsInGroup("beauty");
  assert.ok(beauty.every(skill => skill.group === "beauty"));
  assert.ok(beauty.some(skill => skill.id === "ugc_review_v1"));
});

test("new UGC 种草测评 skill runs as an image-first pack (no video)", () => {
  const task = runCreativeWorkflow({
    brief: normalizeBrief({ productName: "玻尿酸面膜", platform: "小红书" }),
    skillId: "ugc_review_v1",
    brandKit: defaultBrandKit
  });
  assert.equal(task.skillName, "UGC 种草测评");
  assert.ok(task.variants.length >= 1);
  assert.equal(task.variants[0].duration, null);
  assert.equal(task.credits.video, 0);
  assert.ok(!task.exports[0].fileNames.includes("video.mp4"));
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

// ---- export files content-ization (P2) ----
test("buildExportFiles inlines real text content for image-first notes", () => {
  const brief = normalizeBrief({ productName: "玻尿酸面膜", platform: "小红书" });
  const skill = findSkill("rednote_seeding_note_v1");
  const variant = runCreativeWorkflow({ brief, skillId: "rednote_seeding_note_v1" }).variants[0];
  const files = buildExportFiles({ brief, variant, skill });
  const byName = Object.fromEntries(files.map(file => [file.name, file]));

  assert.ok(byName["copy.md"].content.includes(variant.hook));
  assert.ok(byName["copy.md"].content.includes(variant.cta));
  assert.equal(byName["hashtags.txt"].content.split("\n").length, variant.hashtags.length);
  assert.ok(!files.some(file => file.name === "video.mp4"));
});

test("buildExportFiles cover source toggles with variant.imageUrl", () => {
  const brief = normalizeBrief({ productName: "玻尿酸面膜", platform: "小红书" });
  const skill = findSkill("rednote_seeding_note_v1");
  const base = runCreativeWorkflow({ brief, skillId: "rednote_seeding_note_v1" }).variants[0];

  const without = buildExportFiles({ brief, variant: base, skill });
  assert.equal(without.find(file => file.name === "cover.png").source, "placeholder");

  const withImage = buildExportFiles({ brief, variant: { ...base, imageUrl: "data:image/png;base64,X" }, skill });
  assert.equal(withImage.find(file => file.name === "cover.png").source, "variantImage");
});

// ---- copy engine upgrade: platform DNA + 真打分 hookStrength ----
test("active platform presets carry structured copy DNA (hookPatterns + copyRules)", () => {
  for (const id of ["抖音", "小红书"]) {
    const preset = findPlatformPreset(id);
    assert.ok(Array.isArray(preset.hookPatterns) && preset.hookPatterns.length >= 2, `${id} missing hookPatterns`);
    assert.ok(preset.copyRules && preset.copyRules.hookMaxChars > 0, `${id} missing copyRules.hookMaxChars`);
    assert.ok(Array.isArray(preset.copyRules.ctaExamples) && preset.copyRules.ctaExamples.length > 0, `${id} missing ctaExamples`);
  }
});

test("scoreHookStrength is a real signal: empty=0, plain>=80, feature-rich scores higher, capped 99", () => {
  const preset = findPlatformPreset("抖音");
  assert.equal(scoreHookStrength("", preset), 0);
  assert.equal(scoreHookStrength("   ", preset), 0);

  const plain = scoreHookStrength("这是一个普通的产品介绍文字内容没有任何钩子特征在里面", preset);
  assert.ok(plain >= 80, `plain non-empty hook should floor at 80, got ${plain}`);

  // 含数字 + 问句 + 痛点 + 紧迫词 → 明显高于平铺
  const strong = scoreHookStrength("还在为3个老问题头疼？现在马上解决", preset);
  assert.ok(strong > plain, `feature-rich hook (${strong}) should beat plain (${plain})`);
  assert.ok(strong <= 99, `score must cap at 99, got ${strong}`);
});

test("hookStrength flows into variant metrics and keeps qa overallScore >= 80", () => {
  const task = runCreativeWorkflow({
    brief: normalizeBrief({ productName: "NovaGlow Lamp", platform: "抖音" }),
    skillId: "ecom_tiktok_product_ad_v1",
    brandKit: defaultBrandKit
  });
  // 角度被改写为带框架的钩子 → hookStrength 应 >= 80（不再是占位 82+index 的恒定值）
  assert.ok(task.variants.every(variant => variant.metrics.hookStrength >= 80));
  assert.ok(task.qa.overallScore >= 80);
});

// ---- new hook agent + Hook Lab skill ----
test("catalog exposes the new hook (Hook Lab) agent with full contract", () => {
  const hook = agents.find(agent => agent.id === "hook");
  assert.ok(hook, "hook agent missing from catalog");
  assert.ok(hook.responsibility && hook.input && hook.output && hook.evaluation);
  assert.ok(hook.cost > 0 && hook.tools.length >= 2);
});

test("Hook Lab skill is featured, image-first, and orchestrates the hook agent", () => {
  const hookLab = skills.find(skill => skill.id === "hook_lab_v1");
  assert.ok(hookLab, "hook_lab_v1 skill missing");
  assert.equal(hookLab.featured, true);
  assert.ok(hookLab.agents.includes("hook"));
  assert.ok(!hookLab.agents.includes("video"), "Hook Lab must be image-first (no video)");

  const task = runCreativeWorkflow({
    brief: normalizeBrief({ productName: "玻尿酸面膜", platform: "小红书" }),
    skillId: "hook_lab_v1",
    brandKit: defaultBrandKit
  });
  assert.equal(task.skillName, "Hook Lab 爆款钩子");
  assert.equal(task.credits.video, 0);
  assert.ok(!task.exports[0].fileNames.includes("video.mp4"));
  assert.ok(task.qa.overallScore >= 80);
});

test("deterministic fallback CTA is platform-native (zh), not English boilerplate", () => {
  const task = runCreativeWorkflow({
    brief: normalizeBrief({ productName: "NovaGlow Lamp", platform: "抖音" }),
    skillId: "ecom_tiktok_product_ad_v1",
    brandKit: defaultBrandKit
  });
  const ctas = task.variants.map(variant => variant.cta).join(" ");
  assert.ok(!/Shop the drop|Save this setup|Try the launch kit/.test(ctas), "English boilerplate CTA leaked");
  assert.ok(/[一-龥]/.test(ctas), "CTA should contain Chinese");
});

test("buildExportFiles keeps video.mp4 a placeholder (no binary this sprint)", () => {
  const brief = normalizeBrief({ productName: "NovaGlow Lamp", platform: "抖音" });
  const skill = findSkill("ecom_tiktok_product_ad_v1");
  const variant = runCreativeWorkflow({ brief, skillId: "ecom_tiktok_product_ad_v1" }).variants[0];
  const files = buildExportFiles({ brief, variant, skill });

  assert.equal(files.find(file => file.name === "video.mp4").kind, "placeholder");
  assert.ok(files.find(file => file.name === "storyboard.csv").content.startsWith("time,shot,action,caption"));
});
