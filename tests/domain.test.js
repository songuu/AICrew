import test from "node:test";
import assert from "node:assert/strict";
import {
  agents,
  buildExportFiles,
  canEditTask,
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
  normalizeStateShape,
  orchestratorAgent,
  parseBriefText,
  platformPresets,
  recommendRednoteSkills,
  recommendDouyinSkills,
  recommendChannelsSkills,
  removeAssetFromState,
  rednotePromotionSkills,
  rednotePromotionStages,
  douyinPromotionSkills,
  douyinPromotionStages,
  channelsPromotionSkills,
  channelsPromotionStages,
  reviseVariantHook,
  retryAgentStep,
  runCreativeWorkflow,
  saveSkillFromProject,
  setTaskLocked,
  reserveTaskCreditsInState,
  settleTaskCreditsInState,
  skills,
  skillGroups,
  skillsInGroup
} from "../lib/domain.js";
import { createCreditWallet, reconcileWallet } from "../lib/credits.js";

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
  "rednote_performance_review_v1",
  // 获客生态扩展（参照小鸡AI 产品矩阵）：线索捕捉 / 私域承接 / 内容 / 诊断 / 投放缺口补全
  "rednote_comment_intercept_v1",
  "rednote_lead_magnet_hook_v1",
  "rednote_dm_funnel_sop_v1",
  "rednote_pro_account_setup_v1",
  "rednote_group_chat_ops_v1",
  "rednote_viral_rewrite_v1",
  "rednote_account_matrix_warmup_v1",
  "rednote_compliance_check_v1",
  "rednote_data_topic_mining_v1",
  "rednote_audience_persona_profile_v1",
  "rednote_selling_point_diagnosis_v1",
  "rednote_anti_funnel_targeting_v1"
];
// ---- RoboNeo 式技能选择器：数据模型 ----
test("skillGroups exposes 推荐 first, then the 带货 categories", () => {
  assert.equal(skillGroups[0].id, "featured");
  assert.equal(skillGroups[0].name, "推荐");
  const ids = skillGroups.map(group => group.id);
  assert.deepEqual(ids, ["featured", "rednote", "douyin", "channels", "ecom", "beauty", "shortvideo"]);
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
    ["diagnosis", "search_strategy", "content_production", "creator_seeding", "paid_amplification", "lead_capture", "conversion", "private_domain", "measurement"]
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

test("recommendRednoteSkills routes acquisition (获客) intents to the new skills", () => {
  // 新获客技能的意图归属，固化路由防回归；同时反证未抢走上一组 4 条焊死路由。
  assert.equal(recommendRednoteSkills({ query: "评论区 截流 竞品", limit: 1 })[0].id, "rednote_comment_intercept_v1");
  assert.equal(recommendRednoteSkills({ query: "引流钩子 诱饵 资料包 领取引导", limit: 1 })[0].id, "rednote_lead_magnet_hook_v1");
  assert.equal(recommendRednoteSkills({ query: "私信开场 获客SOP 加微 留资", limit: 1 })[0].id, "rednote_dm_funnel_sop_v1");
  assert.equal(recommendRednoteSkills({ query: "爆文 仿写 改写 结构套用", limit: 1 })[0].id, "rednote_viral_rewrite_v1");
  assert.equal(recommendRednoteSkills({ query: "起号 养号 账号矩阵 多账号", limit: 1 })[0].id, "rednote_account_matrix_warmup_v1");
  assert.equal(recommendRednoteSkills({ query: "企业号 主页搭建 私信菜单 欢迎语", limit: 1 })[0].id, "rednote_pro_account_setup_v1");
  assert.equal(recommendRednoteSkills({ query: "群聊 社群 建群 私域沉淀", limit: 1 })[0].id, "rednote_group_chat_ops_v1");
  assert.equal(recommendRednoteSkills({ query: "数据选题 爆文选题库 选题打分", limit: 1 })[0].id, "rednote_data_topic_mining_v1");
  assert.equal(recommendRednoteSkills({ query: "违禁词 合规 质检 限流自查", limit: 1 })[0].id, "rednote_compliance_check_v1");
  assert.equal(recommendRednoteSkills({ query: "目标人群 画像 人设定位", limit: 1 })[0].id, "rednote_audience_persona_profile_v1");
  assert.equal(recommendRednoteSkills({ query: "卖点 产品力 差异化 记忆点", limit: 1 })[0].id, "rednote_selling_point_diagnosis_v1");
  assert.equal(recommendRednoteSkills({ query: "人群反漏斗 人群包 渗透 破圈", limit: 1 })[0].id, "rednote_anti_funnel_targeting_v1");
});

// ---- 抖音获客体系（镜像小红书 rednote 体系：9 阶段漏斗 + 路由 + 视频/图文双链路）----
const douyinSystemSkillIds = [
  "douyin_account_positioning_v1",
  "douyin_search_seo_v1",
  "douyin_lead_gen_shortvideo_v1",
  "douyin_viral_rewrite_v1",
  "douyin_matrix_warmup_v1",
  "douyin_live_acquisition_script_v1",
  "douyin_local_store_acquisition_v1",
  "douyin_local_group_buy_v1",
  "douyin_qianchuan_creative_v1",
  "douyin_anti_funnel_targeting_v1",
  "douyin_comment_intercept_v1",
  "douyin_lead_capture_funnel_v1",
  "douyin_private_domain_handoff_v1",
  "douyin_campaign_review_v1"
];

test("douyin acquisition system covers the full promotion funnel", () => {
  assert.deepEqual(
    douyinPromotionStages.map(stage => stage.id),
    ["positioning", "search_seo", "content_engine", "live_commerce", "local_life", "paid_traffic", "lead_capture", "private_domain", "review"]
  );
  const douyinSkills = douyinPromotionSkills();
  const ids = douyinSkills.map(skill => skill.id);
  for (const id of douyinSystemSkillIds) {
    assert.ok(ids.includes(id), `${id} missing from douyin promotion system`);
  }
  const coveredStages = new Set(douyinSkills.map(skill => skill.douyinStage).filter(Boolean));
  assert.deepEqual([...coveredStages].sort(), douyinPromotionStages.map(stage => stage.id).sort());
});

test("douyin promotion skills are production-ready, not generic templates", () => {
  for (const skill of douyinPromotionSkills()) {
    assert.equal(skill.platform, "抖音", `${skill.id} should be scoped to 抖音`);
    assert.ok(skill.douyinStage, `${skill.id} missing douyinStage`);
    assert.ok((skill.recommendTags || []).length >= 4, `${skill.id} should expose recommendation tags`);
    assert.ok(skill.formats.length >= 4, `${skill.id} should describe concrete deliverables`);
    assert.ok(skill.agents.includes("qa"), `${skill.id} should include QA`);
    assert.ok(skill.agents.includes("export"), `${skill.id} should include export`);
    assert.doesNotMatch(`${skill.name} ${skill.promise} ${skill.bestFor}`, /占位|待定|假数据|通用模板/);
  }
});

test("skillsInGroup(douyin) returns the complete 抖音 promotion system", () => {
  const byGroup = skillsInGroup("douyin").map(skill => skill.id);
  const bySystem = douyinPromotionSkills().map(skill => skill.id);
  assert.deepEqual(byGroup, bySystem);
  assert.ok(byGroup.length >= 14);
});

test("recommendDouyinSkills routes acquisition intents to the right douyin skill", () => {
  assert.equal(recommendDouyinSkills({ query: "账号定位 人设差异化 卖点诊断", limit: 1 })[0].id, "douyin_account_positioning_v1");
  assert.equal(recommendDouyinSkills({ query: "抖音搜索 SEO卡位 关键词布局", limit: 1 })[0].id, "douyin_search_seo_v1");
  assert.equal(recommendDouyinSkills({ query: "短视频引流 口播脚本 黄金3秒钩子", limit: 1 })[0].id, "douyin_lead_gen_shortvideo_v1");
  assert.equal(recommendDouyinSkills({ query: "爆款改写 对标二创 同结构原创", limit: 1 })[0].id, "douyin_viral_rewrite_v1");
  assert.equal(recommendDouyinSkills({ query: "矩阵号 起号养号 多账号人设", limit: 1 })[0].id, "douyin_matrix_warmup_v1");
  assert.equal(recommendDouyinSkills({ query: "直播脚本 憋单话术 逼单催单 场控SOP", limit: 1 })[0].id, "douyin_live_acquisition_script_v1");
  assert.equal(recommendDouyinSkills({ query: "探店脚本 到店钩子 POI挂载", limit: 1 })[0].id, "douyin_local_store_acquisition_v1");
  assert.equal(recommendDouyinSkills({ query: "团购套餐 套餐命名 到店核销", limit: 1 })[0].id, "douyin_local_group_buy_v1");
  assert.equal(recommendDouyinSkills({ query: "千川 DOU+ 投流素材 带货脚本", limit: 1 })[0].id, "douyin_qianchuan_creative_v1");
  assert.equal(recommendDouyinSkills({ query: "人群反漏斗 人群包定向 核心人群破圈", limit: 1 })[0].id, "douyin_anti_funnel_targeting_v1");
  assert.equal(recommendDouyinSkills({ query: "评论截流 竞品评论 神评话术", limit: 1 })[0].id, "douyin_comment_intercept_v1");
  assert.equal(recommendDouyinSkills({ query: "线索留资 引流诱饵 原生表单 私信关键词", limit: 1 })[0].id, "douyin_lead_capture_funnel_v1");
  assert.equal(recommendDouyinSkills({ query: "企业号装修 私信菜单 粉丝群SOP 企微导流", limit: 1 })[0].id, "douyin_private_domain_handoff_v1");
  assert.equal(recommendDouyinSkills({ query: "投后复盘 爆点归因 赛马诊断", limit: 1 })[0].id, "douyin_campaign_review_v1");
});

// ---- 视频号获客体系（镜像 rednote/douyin：9 阶段漏斗 + 路由 + 视频/图文双链路 + 微信生态闭环）----
const channelsSystemSkillIds = [
  "channels_account_positioning_v1",
  "channels_search_seo_v1",
  "channels_lead_gen_shortvideo_v1",
  "channels_viral_rewrite_v1",
  "channels_matrix_warmup_v1",
  "channels_social_fission_pack_v1",
  "channels_live_acquisition_script_v1",
  "channels_shop_product_material_v1",
  "channels_official_account_linkage_v1",
  "channels_lead_magnet_funnel_v1",
  "channels_compliance_guard_v1",
  "channels_private_domain_handoff_v1"
];

test("channels acquisition system covers the full promotion funnel", () => {
  assert.deepEqual(
    channelsPromotionStages.map(stage => stage.id),
    ["positioning", "search_seo", "content_engine", "social_fission", "live_acquisition", "wechat_commerce", "ecosystem_linkage", "lead_capture", "private_domain"]
  );
  const channelsSkills = channelsPromotionSkills();
  const ids = channelsSkills.map(skill => skill.id);
  for (const id of channelsSystemSkillIds) {
    assert.ok(ids.includes(id), `${id} missing from channels promotion system`);
  }
  const coveredStages = new Set(channelsSkills.map(skill => skill.channelsStage).filter(Boolean));
  assert.deepEqual([...coveredStages].sort(), channelsPromotionStages.map(stage => stage.id).sort());
});

test("channels promotion skills are production-ready, not generic templates", () => {
  for (const skill of channelsPromotionSkills()) {
    assert.equal(skill.platform, "视频号", `${skill.id} should be scoped to 视频号`);
    assert.ok(skill.channelsStage, `${skill.id} missing channelsStage`);
    assert.ok((skill.recommendTags || []).length >= 4, `${skill.id} should expose recommendation tags`);
    assert.ok(skill.formats.length >= 4, `${skill.id} should describe concrete deliverables`);
    assert.ok(skill.agents.includes("qa"), `${skill.id} should include QA`);
    assert.ok(skill.agents.includes("export"), `${skill.id} should include export`);
    assert.doesNotMatch(`${skill.name} ${skill.promise} ${skill.bestFor}`, /占位|待定|假数据|通用模板/);
  }
});

test("skillsInGroup(channels) returns the complete 视频号 promotion system", () => {
  const byGroup = skillsInGroup("channels").map(skill => skill.id);
  const bySystem = channelsPromotionSkills().map(skill => skill.id);
  assert.deepEqual(byGroup, bySystem);
  assert.ok(byGroup.length >= 12);
});

test("recommendChannelsSkills routes acquisition intents to the right channels skill", () => {
  assert.equal(recommendChannelsSkills({ query: "账号定位 人设差异化 卖点诊断 主页优化", limit: 1 })[0].id, "channels_account_positioning_v1");
  assert.equal(recommendChannelsSkills({ query: "搜一搜 视频号SEO 关键词布局 话题标签", limit: 1 })[0].id, "channels_search_seo_v1");
  assert.equal(recommendChannelsSkills({ query: "引流短视频 完播结构 钩子开场 加企微引导", limit: 1 })[0].id, "channels_lead_gen_shortvideo_v1");
  assert.equal(recommendChannelsSkills({ query: "爆款改写 对标拆解 同结构原创 二创", limit: 1 })[0].id, "channels_viral_rewrite_v1");
  assert.equal(recommendChannelsSkills({ query: "矩阵号 起号养号 多账号人设 选题分发", limit: 1 })[0].id, "channels_matrix_warmup_v1");
  assert.equal(recommendChannelsSkills({ query: "社交裂变 朋友圈转发 点赞助力 裂变海报", limit: 1 })[0].id, "channels_social_fission_pack_v1");
  assert.equal(recommendChannelsSkills({ query: "直播脚本 直播预约 憋单逼单 场控SOP", limit: 1 })[0].id, "channels_live_acquisition_script_v1");
  assert.equal(recommendChannelsSkills({ query: "视频号小店 带货素材 商品卡 过款话术", limit: 1 })[0].id, "channels_shop_product_material_v1");
  assert.equal(recommendChannelsSkills({ query: "公众号联动 互导文案 视频号挂载 涨粉钩子", limit: 1 })[0].id, "channels_official_account_linkage_v1");
  assert.equal(recommendChannelsSkills({ query: "引流诱饵 线索留资 资料包 承接路径", limit: 1 })[0].id, "channels_lead_magnet_funnel_v1");
  assert.equal(recommendChannelsSkills({ query: "合规改写 红线校验 诱导分享 违规词替换", limit: 1 })[0].id, "channels_compliance_guard_v1");
  assert.equal(recommendChannelsSkills({ query: "企微承接 社群运营 欢迎语 复购召回", limit: 1 })[0].id, "channels_private_domain_handoff_v1");
});

test("channels system skills run through workflow contracts (video & text first)", () => {
  for (const id of channelsSystemSkillIds) {
    const skill = findSkill(id);
    const task = runCreativeWorkflow({
      brief: normalizeBrief({ productName: "便携补光灯", platform: "视频号", targetAudience: "私域运营团队" }),
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

test("视频号 platform preset drives ratio + qa via findPlatformPreset (no platform=== branch)", () => {
  const preset = findPlatformPreset("视频号");
  assert.equal(preset.id, "channels");
  assert.equal(preset.lang, "zh");
  const task = runCreativeWorkflow({
    brief: normalizeBrief({ productName: "玻尿酸面膜", platform: "视频号" }),
    skillId: "channels_lead_gen_shortvideo_v1",
    brandKit: defaultBrandKit
  });
  assert.equal(task.variants[0].aspectRatio, preset.ratio);
  assert.ok(task.qa.overallScore >= 80);
});

test("douyin system skills run through workflow contracts (video & text first)", () => {
  for (const id of douyinSystemSkillIds) {
    const skill = findSkill(id);
    const task = runCreativeWorkflow({
      brief: normalizeBrief({ productName: "便携补光灯", platform: "抖音", targetAudience: "内容运营团队" }),
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
  assert.equal(parseBriefText("做一条视频号引流短视频").platform, "视频号");
  assert.equal(parseBriefText("发到 WeChat Channels 的口播").platform, "视频号");
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

test("normalizes legacy snapshots before UI render", () => {
  const state = normalizeStateShape({
    workspace: { credits: 120 },
    tasks: undefined,
    projects: null,
    assets: undefined,
    brandKit: { name: "Legacy Brand" }
  });

  assert.equal(state.workspace.credits, 120);
  assert.equal(state.workspace.monthlyCredits, 5000);
  assert.equal(state.brandKit.name, "Legacy Brand");
  assert.ok(Array.isArray(state.tasks));
  assert.ok(Array.isArray(state.projects));
  assert.ok(Array.isArray(state.assets));
  assert.ok(state.tasks.length > 0);
  assert.ok(state.assets.length > 0);
});

test("settleTaskCreditsInState records reserve-settle while display balance uses actual spend", () => {
  const state = normalizeStateShape({
    workspace: { credits: 120, monthlyCredits: 5000 },
    creditLedger: []
  });
  const task = {
    id: "task-credit-1",
    status: "completed",
    credits: { estimated: 50, actual: 35 }
  };

  const reserved = reserveTaskCreditsInState(state, task, {
    reservationId: "reservation-credit-1",
    reserveAmount: 50
  });
  const next = settleTaskCreditsInState(reserved, task, {
    label: "Task settled",
    reservationId: "reservation-credit-1"
  });

  assert.equal(next.workspace.credits, 85);
  assert.equal(next.workspace.reservedCredits, 0);
  assert.equal(next.creditReservations[0].status, "settled");
  assert.equal(next.creditReservations[0].amountReserved, 50);
  assert.equal(next.creditReservations[0].amountSettled, 35);
  assert.deepEqual(next.creditReservationLedger.map(entry => entry.type), ["reserve", "settle"]);
  assert.equal(next.creditReservationLedger.at(-1).balanceAfter, 85);
  assert.equal(next.creditLedger[0].type, "consume");
  assert.equal(next.creditLedger[0].amount, -35);
  assert.equal(state.workspace.credits, 120);
});

test("settleTaskCreditsInState releases a failed task reservation without consuming credits", () => {
  const state = normalizeStateShape({
    workspace: { credits: 120, monthlyCredits: 5000 },
    creditLedger: []
  });
  const task = {
    id: "task-credit-2",
    status: "failed",
    credits: { estimated: 50, actual: 35 }
  };

  const reserved = reserveTaskCreditsInState(state, task, {
    reservationId: "reservation-credit-2",
    reserveAmount: 50
  });
  const next = settleTaskCreditsInState(reserved, task, {
    label: "Task released",
    reservationId: "reservation-credit-2"
  });

  assert.equal(next.workspace.credits, 120);
  assert.equal(next.workspace.reservedCredits, 0);
  assert.equal(next.creditReservations[0].status, "released");
  assert.deepEqual(next.creditReservationLedger.map(entry => entry.type), ["reserve", "release"]);
  assert.equal(next.creditLedger[0].type, "release");
  assert.equal(next.creditLedger[0].amount, 0);
});

test("settleTaskCreditsInState rejects settlement without an active reservation", () => {
  const state = normalizeStateShape({
    workspace: { credits: 120, monthlyCredits: 5000 },
    creditLedger: []
  });
  const task = { id: "task-no-reserve", status: "completed", credits: { estimated: 50, actual: 35 } };

  assert.throws(
    () => settleTaskCreditsInState(state, task, { reservationId: "missing-reservation" }),
    /active reservation/
  );
});

test("removes an asset from state without touching the original", () => {
  const state = createInitialState();
  const removedId = state.assets[0].id;
  const next = removeAssetFromState(state, removedId);

  assert.equal(next.assets.some(asset => asset.id === removedId), false);
  assert.equal(state.assets.some(asset => asset.id === removedId), true);
  assert.equal(next.assets.length, state.assets.length - 1);
});

test("locks generated tasks without mutating the original state", () => {
  const state = createInitialState();
  const taskId = state.tasks[0].id;
  const locked = setTaskLocked(state, taskId, true);

  assert.equal(canEditTask(locked.tasks[0]), false);
  assert.equal(locked.tasks[0].locked, true);
  assert.equal(locked.projects[0].locked, true);
  assert.equal(state.tasks[0].locked, undefined);

  const unlocked = setTaskLocked(locked, taskId, false);
  assert.equal(canEditTask(unlocked.tasks[0]), true);
});


test("reserveTaskCreditsInState creates an active reservation before settlement", () => {
  const state = normalizeStateShape({
    workspace: { credits: 120, monthlyCredits: 5000 },
    creditLedger: []
  });
  const task = { id: "task-active-reserve", status: "running", credits: { estimated: 50, actual: 0 } };

  const reserved = reserveTaskCreditsInState(state, task, {
    reservationId: "reservation-active-1",
    reserveAmount: 50,
    reason: "generation"
  });

  assert.equal(reserved.workspace.credits, 70);
  assert.equal(reserved.workspace.reservedCredits, 50);
  assert.equal(reserved.creditReservations[0].status, "reserved");
  assert.deepEqual(reserved.creditReservationLedger.map(entry => entry.type), ["reserve"]);
  assert.equal(reserved.creditLedger.length, 0, "active reserve should not create a display consume row");
});

test("settleTaskCreditsInState settles an existing active reservation and remains display-idempotent", () => {
  const state = normalizeStateShape({
    workspace: { credits: 120, monthlyCredits: 5000 },
    creditLedger: []
  });
  const task = { id: "task-active-settle", status: "completed", credits: { estimated: 50, actual: 35 } };
  const reserved = reserveTaskCreditsInState(state, task, {
    reservationId: "reservation-active-2",
    reserveAmount: 50,
    reason: "generation"
  });

  const settled = settleTaskCreditsInState(reserved, task, {
    label: "Task settled",
    reservationId: "reservation-active-2",
    reserveAmount: 50
  });
  const repeated = settleTaskCreditsInState(settled, task, {
    label: "Task settled",
    reservationId: "reservation-active-2",
    reserveAmount: 50
  });

  assert.equal(settled.workspace.credits, 85);
  assert.equal(settled.workspace.reservedCredits, 0);
  assert.deepEqual(settled.creditReservationLedger.map(entry => entry.type), ["reserve", "settle"]);
  assert.equal(repeated.workspace.credits, 85);
  assert.equal(repeated.creditLedger.filter(entry => entry.reservationId === "reservation-active-2").length, 1);
  assert.doesNotThrow(() => reconcileWallet(createCreditWallet({
    id: repeated.workspace.id || "workspace_default",
    available: repeated.workspace.credits,
    reserved: repeated.workspace.reservedCredits,
    openingBalance: repeated.workspace.creditOpeningBalance,
    reservations: repeated.creditReservations,
    ledger: repeated.creditReservationLedger
  })));
});
