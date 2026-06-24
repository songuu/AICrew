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
  platformPresets,
  recommendRednoteSkills,
  rednotePromotionSkills,
  rednotePromotionStages,
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
  // 视频文件本期仍为 deferred，不生成真实二进制（守护硬约束）
  const videoFile = task.exports[0].files.find(file => file.name === "video.mp4");
  assert.equal(videoFile.status, "deferred");
  assert.equal(videoFile.downloadable, false);
  assert.equal(task.variants[0].duration, 15);
  assert.ok(task.credits.video > 0);
});

test("detects 小红书 platform from freeform brief", () => {
  const brief = parseBriefText("产品 玻尿酸面膜，受众 抗老人群，目标 提升收藏，小红书 种草风格");
  assert.equal(brief.platform, "小红书");
});

const realDemandSkillIds = [
  "detail_page_conversion_v1",
  "ad_ab_test_pack_v1",
  "private_domain_conversion_v1",
  "ingredient_explainer_cards_v1",
  "new_product_launch_matrix_v1",
  "local_life_store_visit_v1",
  "knowledge_ip_shortvideo_v1",
  "comment_reply_conversion_v1"
];
const rednoteSystemSkillIds = [
  "rednote_account_diagnostic_v1",
  "rednote_competitor_benchmark_v1",
  "rednote_search_intent_map_v1",
  "rednote_topic_calendar_v1",
  "rednote_seo_note_v1",
  "rednote_cover_title_ab_v1",
  "rednote_product_comparison_v1",
  "rednote_scenario_seed_v1",
  "rednote_video_note_v1",
  "rednote_koc_brief_v1",
  "rednote_kol_matrix_v1",
  "rednote_juguang_launch_v1",
  "rednote_search_keyword_boost_v1",
  "rednote_comment_dm_conversion_v1",
  "rednote_performance_review_v1"
];
// ---- RoboNeo 式技能选择器：数据模型 ----
test("skillGroups exposes 推荐 first, then the 带货 categories", () => {
  assert.equal(skillGroups[0].id, "featured");
  assert.equal(skillGroups[0].name, "推荐");
  const ids = skillGroups.map(group => group.id);
  assert.deepEqual(ids, ["featured", "rednote", "ecom", "beauty", "shortvideo"]);
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

test("catalog adds real-demand skills instead of placeholder templates", () => {
  assert.ok(skills.length >= 19);
  assert.equal(new Set(skills.map(skill => skill.id)).size, skills.length);

  const groups = new Set();
  for (const id of realDemandSkillIds) {
    const skill = skills.find(item => item.id === id);
    assert.ok(skill, `${id} missing from catalog`);
    groups.add(skill.group);
    assert.ok(skill.formats.length >= 4, `${id} should describe concrete deliverables`);
    assert.ok(skill.agents.includes("qa"), `${id} should include QA for production use`);
    assert.ok(skill.agents.includes("export"), `${id} should include export for delivery`);
    assert.ok(skill.promise.length >= 24, `${id} promise is too thin`);
    assert.ok(skill.bestFor.length >= 16, `${id} bestFor is too thin`);
    assert.doesNotMatch(`${skill.name} ${skill.promise} ${skill.bestFor}`, /占位|待定|假数据|通用模板/);
  }

  assert.deepEqual([...groups].sort(), ["beauty", "ecom", "shortvideo"]);
  assert.ok(realDemandSkillIds.some(id => skills.find(skill => skill.id === id).featured));
});

test("new real-demand skills run and keep video/image delivery contracts", () => {
  for (const id of realDemandSkillIds) {
    const skill = findSkill(id);
    const task = runCreativeWorkflow({
      brief: normalizeBrief({
        productName: "新品测试套装",
        platform: skill.group === "beauty" ? "小红书" : "抖音",
        targetAudience: "内容运营团队"
      }),
      skillId: id,
      brandKit: defaultBrandKit
    });

    assert.equal(task.skillId, id);
    assert.equal(task.status, "completed");
    assert.equal(task.agents.length, skill.agents.length);
    assert.equal(task.exports.length, 3);

    if (skill.agents.includes("video")) {
      assert.ok(task.exports[0].fileNames.includes("video.mp4"), `${id} should export video`);
      assert.equal(task.variants[0].duration, 15);
      assert.ok(task.credits.video > 0, `${id} should bill video credits`);
    } else {
      assert.ok(!task.exports[0].fileNames.includes("video.mp4"), `${id} should be image-first`);
      assert.equal(task.variants[0].duration, null);
      assert.equal(task.credits.video, 0);
      assert.ok(task.qa.checks.some(check => check.label === "封面/标题吸引力"));
    }
  }
});
test("rednote promotion skill system covers the full recommendation funnel", () => {
  assert.deepEqual(
    rednotePromotionStages.map(stage => stage.id),
    ["diagnosis", "search_strategy", "content_production", "creator_seeding", "paid_amplification", "conversion", "measurement"]
  );

  const rednoteSkills = rednotePromotionSkills();
  const rednoteIds = rednoteSkills.map(skill => skill.id);
  for (const id of rednoteSystemSkillIds) {
    assert.ok(rednoteIds.includes(id), `${id} missing from rednote promotion system`);
  }
  assert.ok(rednoteIds.includes("rednote_seeding_note_v1"), "existing rednote seeding skill should stay in the system");
  assert.ok(rednoteIds.includes("ugc_review_v1"), "UGC review should be part of rednote promotion");

  const coveredStages = new Set(rednoteSkills.map(skill => skill.rednoteStage).filter(Boolean));
  assert.deepEqual([...coveredStages].sort(), rednotePromotionStages.map(stage => stage.id).sort());
});

test("rednote promotion skills are production-ready, not generic templates", () => {
  for (const skill of rednotePromotionSkills()) {
    assert.equal(skill.platform, "小红书", `${skill.id} should be scoped to 小红书`);
    assert.ok(skill.rednoteStage, `${skill.id} missing rednoteStage`);
    assert.ok((skill.recommendTags || []).length >= 4, `${skill.id} should expose recommendation tags`);
    assert.ok(skill.formats.length >= 4, `${skill.id} should describe concrete deliverables`);
    assert.ok(skill.agents.includes("qa"), `${skill.id} should include QA`);
    assert.ok(skill.agents.includes("export"), `${skill.id} should include export`);
    assert.doesNotMatch(`${skill.name} ${skill.promise} ${skill.bestFor}`, /占位|待定|假数据|通用模板/);
  }
});

test("skillsInGroup(rednote) returns the complete 小红书 promotion system", () => {
  const byGroup = skillsInGroup("rednote").map(skill => skill.id);
  const bySystem = rednotePromotionSkills().map(skill => skill.id);
  assert.deepEqual(byGroup, bySystem);
  assert.ok(byGroup.length >= 19);
});

test("recommendRednoteSkills routes real promotion intents to the right skill", () => {
  assert.equal(recommendRednoteSkills({ query: "搜索排名 关键词优化", limit: 1 })[0].id, "rednote_search_keyword_boost_v1");
  assert.equal(recommendRednoteSkills({ query: "达人 KOC 合作 brief", limit: 1 })[0].id, "rednote_koc_brief_v1");
  assert.equal(recommendRednoteSkills({ query: "评论 私信 转化", limit: 1 })[0].id, "rednote_comment_dm_conversion_v1");
  assert.equal(recommendRednoteSkills({ stage: "复盘优化", query: "投后 数据", limit: 1 })[0].id, "rednote_performance_review_v1");
});

test("new rednote system skills run through workflow contracts", () => {
  for (const id of rednoteSystemSkillIds) {
    const skill = findSkill(id);
    const task = runCreativeWorkflow({
      brief: normalizeBrief({ productName: "玻尿酸面膜", platform: "小红书", targetAudience: "25-35 岁都市女性" }),
      skillId: id,
      brandKit: defaultBrandKit
    });
    assert.equal(task.skillId, id);
    assert.equal(task.status, "completed");
    assert.equal(task.agents.length, skill.agents.length);
    assert.equal(task.exports.length, 3);
    if (skill.agents.includes("video")) {
      assert.ok(task.exports[0].fileNames.includes("video.mp4"), `${id} should export video`);
      assert.ok(task.credits.video > 0, `${id} should bill video credits`);
    } else {
      assert.ok(!task.exports[0].fileNames.includes("video.mp4"), `${id} should stay image/text first`);
      assert.equal(task.credits.video, 0);
    }
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
  assert.equal(without.find(file => file.name === "cover.png").status, "deferred");

  const withImage = buildExportFiles({ brief, variant: { ...base, imageUrl: "data:image/png;base64,X" }, skill });
  const cover = withImage.find(file => file.name === "cover.png");
  assert.equal(cover.status, "ready");
  assert.equal(cover.refKey, `variant:${base.id}`);
});

// ---- copy engine upgrade: platform DNA + 真打分 hookStrength ----
test("active platform presets carry structured copy DNA (hookPatterns + copyRules)", () => {
  // 遍历全部 active presets（不再硬编码 2 个）——新平台必须同样带结构化 DNA，否则文案引擎注入静默退化。
  for (const preset of platformPresets) {
    const id = preset.name;
    assert.ok(Array.isArray(preset.hookPatterns) && preset.hookPatterns.length >= 2, `${id} missing hookPatterns`);
    assert.ok(preset.copyRules && preset.copyRules.hookMaxChars > 0, `${id} missing copyRules.hookMaxChars`);
    assert.ok(Array.isArray(preset.copyRules.captionRange) && preset.copyRules.captionRange.length === 2, `${id} missing copyRules.captionRange`);
    assert.ok(Array.isArray(preset.copyRules.ctaExamples) && preset.copyRules.ctaExamples.length > 0, `${id} missing ctaExamples`);
    assert.ok(preset.creditMultiplier > 0 && preset.platformFit > 0, `${id} missing credit/fit`);
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

  const video = files.find(file => file.name === "video.mp4");
  assert.equal(video.status, "deferred");
  assert.equal(video.downloadable, false);
  assert.ok(files.find(file => file.name === "storyboard.csv").content.startsWith("time,shot,action,caption"));
});

// ---- agent expansion + flow optimization (trend / persona / seo) ----
test("catalog exposes new trend/persona/seo agents with full contract", () => {
  for (const id of ["trend", "persona", "seo"]) {
    const agent = agents.find(a => a.id === id);
    assert.ok(agent, `${id} agent missing from catalog`);
    assert.ok(agent.responsibility && agent.input && agent.output && agent.evaluation, `${id} contract fields missing`);
    assert.ok(agent.cost > 0 && agent.tools.length >= 2, `${id} cost/tools missing`);
  }
});

test("new agents produce distinct artifacts/summaries (not dead nodes) when orchestrated", () => {
  const task = runCreativeWorkflow({
    brief: normalizeBrief({ productName: "玻尿酸面膜", platform: "小红书" }),
    skillId: "viral_content_engine_v1",
    brandKit: defaultBrandKit
  });
  for (const id of ["trend", "persona", "seo"]) {
    const step = task.agents.find(a => a.id === id);
    assert.ok(step, `${id} not orchestrated in flagship pipeline`);
    assert.ok(step.artifact && step.artifact !== "Agent artifact recorded", `${id} should have a distinct artifact`);
    assert.ok(step.summary && step.summary !== "完成工作流步骤。", `${id} should have a distinct summary`);
  }
  // 派生契约仍同构：plan === agent ids，events 数 === agents 数
  assert.deepEqual(task.orchestrator.plan, task.agents.map(a => a.id));
  assert.equal(task.events.length, task.agents.length);
});

test("flagship viral_content_engine_v1 is featured, image-first, full-chain", () => {
  const skill = skills.find(s => s.id === "viral_content_engine_v1");
  assert.ok(skill, "viral_content_engine_v1 missing");
  assert.equal(skill.featured, true);
  assert.ok(!skill.agents.includes("video"), "flagship is image-first");
  for (const id of ["trend", "strategy", "hook", "persona", "copy", "seo", "qa", "export"]) {
    assert.ok(skill.agents.includes(id), `flagship pipeline missing ${id}`);
  }
  const task = runCreativeWorkflow({
    brief: normalizeBrief({ productName: "玻尿酸面膜", platform: "小红书" }),
    skillId: "viral_content_engine_v1"
  });
  assert.equal(task.variants.length, 3); // 提质不增量：变体数仍恒 3
  assert.ok(task.qa.overallScore >= 80);
});

test("flow optimization wires new agents into existing skills without breaking contracts", () => {
  const ecom = skills.find(s => s.id === "ecom_tiktok_product_ad_v1");
  assert.ok(ecom.agents.includes("trend") && ecom.agents.includes("seo"));
  assert.ok(ecom.agents.length >= 8); // 只增不减，守 domain.test 主 skill 契约
  const rednote = skills.find(s => s.id === "rednote_seeding_note_v1");
  assert.ok(["trend", "persona", "seo"].every(id => rednote.agents.includes(id)));
  const ugc = skills.find(s => s.id === "ugc_review_v1");
  assert.ok(ugc.agents.includes("persona"));
});

// ---- 跨境平台扩容：reels / shorts / shopify ----
test("cross-border platforms are active in platformPresets with distinct ratios/hooks", () => {
  const byId = Object.fromEntries(platformPresets.map(p => [p.id, p]));
  assert.ok(byId.reels && byId.shorts && byId.shopify, "reels/shorts/shopify must be active presets");
  assert.equal(byId.reels.ratio, "9:16");
  assert.equal(byId.shorts.hookSeconds, 5); // YT 更长 hook 窗口
  assert.equal(byId.shopify.ratio, "1:1"); // PDP 方图
  // 平台差异真实存在：CTA 范例各不相同
  assert.notDeepEqual(byId.reels.copyRules.ctaExamples, byId.shorts.copyRules.ctaExamples);
});

test("detectPlatform routes new platform tokens from freeform brief", () => {
  assert.equal(parseBriefText("给露营灯做一组 Instagram Reels 视频").platform, "Instagram Reels");
  assert.equal(parseBriefText("产品 X，发 YouTube Shorts").platform, "YouTube Shorts");
  assert.equal(parseBriefText("独立站 Shopify PDP 详情页主图").platform, "Shopify PDP");
  // 回退不变：无专属 token → 抖音
  assert.equal(parseBriefText("随便做点带货内容").platform, "抖音");
  // 过短缩写不误命中：design 含 "ig" 不应路由到 Reels
  assert.equal(parseBriefText("做个 design 风格的带货图").platform, "抖音");
});

test("new platforms drive the full pipeline via findPlatformPreset (ratio + qa, no platform=== branch)", () => {
  for (const id of ["Instagram Reels", "YouTube Shorts", "Shopify PDP"]) {
    const preset = findPlatformPreset(id);
    const task = runCreativeWorkflow({
      brief: normalizeBrief({ productName: "便携补光灯", platform: id, targetAudience: "跨境内容团队" }),
      skillId: "ecom_tiktok_product_ad_v1",
      brandKit: defaultBrandKit
    });
    assert.equal(task.variants[0].aspectRatio, preset.ratio, `${id} aspectRatio should follow preset`);
    assert.ok(task.variants[0].hashtags.includes(`#${id.replace(/\s+/g, "")}`), `${id} hashtags should carry #platform`);
    assert.ok(task.qa.overallScore >= 80, `${id} qa should stay >= 80`);
    assert.ok(task.credits.estimated > 0);
  }
});

// ---- 文案 i18n：platform preset.lang ----
test("platform presets declare lang (zh for 抖音/小红书, en for Western); en CTA is English", () => {
  const byId = Object.fromEntries(platformPresets.map(p => [p.id, p]));
  assert.equal(byId.tiktok.lang, "zh");
  assert.equal(byId.rednote.lang, "zh");
  assert.equal(byId.reels.lang, "en");
  assert.equal(byId.shorts.lang, "en");
  assert.equal(byId.shopify.lang, "en");
  // en 平台 CTA 范例为英文（单源：prompt 示例 + 确定性兜底 CTA 同步）；zh 平台仍中文
  const hasCJK = s => /[一-鿿]/.test(s);
  for (const id of ["reels", "shorts", "shopify"]) {
    assert.ok(byId[id].copyRules.ctaExamples.every(c => !hasCJK(c)), `${id} CTA examples should be English`);
  }
  for (const id of ["tiktok", "rednote"]) {
    assert.ok(byId[id].copyRules.ctaExamples.every(c => hasCJK(c)), `${id} CTA examples should stay Chinese`);
  }
});

// ---- variant 扩量（可配置变体数 + A/B 标记）----
test("default variantCount stays 3 (backward compatible); each variant carries an abLabel", () => {
  const task = runCreativeWorkflow({
    brief: normalizeBrief({ productName: "NovaGlow Lamp", platform: "抖音" }),
    skillId: "ecom_tiktok_product_ad_v1",
    brandKit: defaultBrandKit
  });
  assert.equal(task.variants.length, 3); // 默认仍 3
  assert.deepEqual(task.variants.map(v => v.abLabel), ["A", "B", "C"]);
});

test("variantCount expands variants + exports end-to-end and keeps qa >= 80", () => {
  const task = runCreativeWorkflow({
    brief: normalizeBrief({ productName: "NovaGlow Lamp", platform: "抖音" }),
    skillId: "ecom_tiktok_product_ad_v1",
    brandKit: defaultBrandKit,
    variantCount: 5
  });
  assert.equal(task.variants.length, 5);
  assert.equal(task.exports.length, 5); // 导出随变体数派生
  assert.deepEqual(task.variants.map(v => v.abLabel), ["A", "B", "C", "D", "E"]);
  // 前 3 角度逐字不变（守既有断言）
  assert.equal(task.variants[0].name, "痛点直击");
  // 扩量变体也满足 hookStrength floor + qa
  assert.ok(task.variants.every(v => v.metrics.hookStrength >= 80));
  assert.ok(task.qa.overallScore >= 80);
});

test("variantCount clamps out-of-range values (>pool→pool cap, 0/NaN→3)", () => {
  const run = count => runCreativeWorkflow({
    brief: normalizeBrief({ productName: "Lamp", platform: "抖音" }),
    skillId: "ecom_tiktok_product_ad_v1",
    variantCount: count
  }).variants.length;
  assert.equal(run(99), 6); // 角度池上限
  assert.equal(run(0), 3); // 0/NaN → 默认 3
  assert.equal(run(1), 1);
});
