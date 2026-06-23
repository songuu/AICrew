const now = () => new Date().toISOString();

let idSequence = 0;

export function makeId(prefix) {
  idSequence += 1;
  return `${prefix}_${Date.now().toString(36)}_${idSequence.toString(36)}`;
}

export const agents = [
  {
    id: "brief",
    name: "Brief Agent",
    title: "需求理解",
    accent: "#8bd3ff",
    responsibility: "把用户自然语言和素材上下文转成可编辑的 Creative Brief。",
    input: "用户目标、商品信息、上传素材、平台偏好",
    output: "Creative Brief JSON",
    tools: ["brief_parser", "asset_tagger", "default_field_filler"],
    evaluation: "关键字段完整、平台/受众/目标明确、缺失项有默认值",
    cost: 6
  },
  {
    id: "strategy",
    name: "Strategy Agent",
    title: "策略策划",
    accent: "#f9c74f",
    responsibility: "把 Brief 转换成内容策略和转化角度。",
    input: "Creative Brief JSON、品牌语气、平台规则",
    output: "受众、卖点、内容角度",
    tools: ["audience_mapper", "platform_playbook", "compliance_rules"],
    evaluation: "前 3 秒 Hook 清晰、痛点具体、CTA 与平台匹配",
    cost: 10
  },
  {
    id: "script",
    name: "Script Agent",
    title: "脚本生成",
    accent: "#ff7a90",
    responsibility: "生成可直接进入视频/图文生产的脚本结构。",
    input: "内容策略、商品卖点、目标时长",
    output: "3 个广告脚本",
    tools: ["script_template_engine", "hook_generator", "cta_writer"],
    evaluation: "镜头服务转化、首屏有 Hook、结尾有 CTA",
    cost: 12
  },
  {
    id: "storyboard",
    name: "Storyboard Agent",
    title: "分镜拆解",
    accent: "#b8f27b",
    responsibility: "把脚本拆成镜头、时长、画面动作和转场。",
    input: "脚本、平台画幅、素材引用",
    output: "镜头、时长、转场",
    tools: ["shot_planner", "duration_allocator", "asset_reference_mapper"],
    evaluation: "镜头顺序完整、时长不超限、素材引用明确",
    cost: 10
  },
  {
    id: "visual",
    name: "Visual Agent",
    title: "视觉资产",
    accent: "#a78bfa",
    responsibility: "生成/编辑封面、背景、产品场景图和视觉方向。",
    input: "分镜、品牌资产、商品素材",
    output: "封面与画面方向",
    tools: ["cover_generator", "product_scene_builder", "brand_style_applier"],
    evaluation: "产品可见、品牌一致、画面清晰、适配安全边距",
    cost: 18
  },
  {
    id: "video",
    name: "Video Agent",
    title: "视频合成",
    accent: "#45e0c6",
    responsibility: "完成图生视频、片段合成、字幕和转场模拟。",
    input: "视觉资产、分镜、脚本字幕",
    output: "15 秒竖版视频",
    tools: ["image_to_video_router", "subtitle_burner", "clip_composer"],
    evaluation: "画幅正确、节奏匹配、产品连续可见、字幕可读",
    cost: 36
  },
  {
    id: "copy",
    name: "Copywriting Agent",
    title: "文案包装",
    accent: "#ffb86b",
    responsibility: "生成标题、Caption、Hashtag 和 CTA。",
    input: "策略、脚本、平台文案规则",
    output: "标题、Caption、Hashtag",
    tools: ["caption_writer", "hashtag_picker", "cta_optimizer"],
    evaluation: "文案可发布、标签贴合平台、CTA 明确",
    cost: 8
  },
  {
    id: "qa",
    name: "QA Agent",
    title: "质量检查",
    accent: "#6ee7b7",
    responsibility: "检查品牌一致性、平台适配、内容完整性与合规风险。",
    input: "全部资产、Brief、品牌禁用词",
    output: "质量分与合规建议",
    tools: ["quality_scorer", "forbidden_word_scan", "platform_fit_checker"],
    evaluation: "质量分可解释、风险可定位、修复建议明确",
    cost: 6
  },
  {
    id: "export",
    name: "Export Agent",
    title: "导出适配",
    accent: "#93c5fd",
    responsibility: "按平台输出视频/封面/文案/分镜或图文包。",
    input: "通过 QA 的变体、平台规格、项目元数据",
    output: "抖音/小红书 内容包",
    tools: ["format_packager", "platform_preset_mapper", "export_manifest_builder"],
    evaluation: "文件清单完整、画幅/格式正确、导出可追溯",
    cost: 8
  }
];

export const orchestratorAgent = {
  id: "orchestrator",
  name: "Orchestrator Agent",
  title: "总控调度",
  responsibility: "按 Skill 编排 Agent 顺序、记录结构化交接、控制重试与计费。",
  input: "Creative Brief、Skill workflow、Brand Memory、素材库",
  output: "任务计划、执行结果、事件日志",
  tools: ["workflow_router", "retry_controller", "credit_meter"],
  evaluation: "每步有状态、事件、成本、可追溯产物",
  retryPolicy: "单 Agent 可重试；失败时保留原任务并追加事件。"
};

export const skills = [
  {
    id: "ecom_tiktok_product_ad_v1",
    name: "抖音 商品广告",
    category: "电商广告",
    stage: "MVP",
    estimatedCredits: 120,
    formats: ["9:16 MP4", "封面 PNG", "文案 MD"],
    agents: ["brief", "strategy", "script", "storyboard", "visual", "video", "copy", "qa", "export"],
    promise: "一张商品图生成 3 条抖音广告视频内容包",
    bestFor: "抖音电商、品牌商家、跨境卖家",
    palette: ["#8bd3ff", "#ff7a90", "#f9c74f"]
  },
  {
    id: "product_photography_v1",
    name: "Product Photography",
    category: "产品摄影",
    stage: "P1",
    estimatedCredits: 60,
    formats: ["PNG", "JPG", "场景图组"],
    agents: ["brief", "visual", "qa", "export"],
    promise: "生成高级产品场景图、封面和详情页素材",
    bestFor: "详情页、广告图、社媒图",
    palette: ["#b8f27b", "#f9c74f", "#45e0c6"]
  },
  {
    id: "social_content_pack_v1",
    name: "Social Content Pack",
    category: "社媒增长",
    stage: "P1",
    estimatedCredits: 160,
    formats: ["7 天日历", "脚本", "封面", "Caption"],
    agents: ["strategy", "script", "visual", "copy", "qa", "export"],
    promise: "从账号定位生成 7 天社媒内容包",
    bestFor: "运营团队、创作者、品牌账号",
    palette: ["#a78bfa", "#8bd3ff", "#ffb86b"]
  },
  {
    id: "short_drama_starter_v1",
    name: "Short Drama Starter",
    category: "短剧分镜",
    stage: "V1",
    estimatedCredits: 260,
    formats: ["角色设定", "剧情大纲", "分镜表", "预告片"],
    agents: ["strategy", "script", "storyboard", "visual", "video", "qa"],
    promise: "生成短剧角色、冲突、分镜和预告片段",
    bestFor: "剧情号、短剧团队",
    palette: ["#ff7a90", "#a78bfa", "#f9c74f"]
  },
  {
    // 小红书生态专属：图文种草，不走视频合成 Agent，输出 3:4 封面 + 笔记正文 + 话题。
    id: "rednote_seeding_note_v1",
    name: "小红书种草笔记",
    category: "社媒种草",
    stage: "P1",
    estimatedCredits: 90,
    formats: ["3:4 封面", "图文笔记", "标题", "话题标签"],
    agents: ["brief", "strategy", "visual", "copy", "qa", "export"],
    promise: "从商品卖点生成小红书图文种草笔记（封面 + 正文 + 话题）",
    bestFor: "美妆、生活方式、母婴、家居品牌与买手",
    palette: ["#ff7a90", "#ffb86b", "#f9c74f"]
  }
];

// 每个平台预设携带其内容生态信号：画幅、Hook 节奏、调性，
// 以及驱动信用估算与质量分的 creditMultiplier / platformFit。
// 平台行为一律从这里取数，避免在业务逻辑里散落 `=== "TikTok"` 这类硬编码分支。
export const platformPresets = [
  {
    // 抖音：短视频主阵地，9:16 强 Hook、快节奏。沿用原 TikTok 预设，id 保持 "tiktok"
    // 以兼容历史数据与现有 skill / 检测逻辑，仅对外展示名改为「抖音」。
    id: "tiktok",
    name: "抖音",
    ratio: "9:16",
    hookSeconds: 3,
    tone: "快节奏、强 Hook、直接 CTA",
    creditMultiplier: 1,
    platformFit: 92
  },
  // 目前仅保留「小红书 + 抖音」两个平台，其余暂时注释（保留结构以便日后恢复）。
  /*
  {
    id: "reels",
    name: "Instagram Reels",
    ratio: "9:16",
    hookSeconds: 3,
    tone: "视觉高级、情绪化、轻量 CTA",
    creditMultiplier: 0.92,
    platformFit: 86
  },
  {
    id: "shorts",
    name: "YouTube Shorts",
    ratio: "9:16",
    hookSeconds: 5,
    tone: "问题驱动、信息密度高、强保留",
    creditMultiplier: 0.92,
    platformFit: 86
  },
  {
    id: "shopify",
    name: "Shopify PDP",
    ratio: "1:1",
    hookSeconds: 4,
    tone: "卖点清晰、信任背书、促销明确",
    creditMultiplier: 0.92,
    platformFit: 86
  },
  */
  {
    // 小红书：图文种草为主，3:4 竖图封面驱动，调性真诚轻软广。
    id: "rednote",
    name: "小红书",
    ratio: "3:4",
    hookSeconds: 2,
    tone: "真诚种草、生活方式、封面强吸引、轻软广",
    creditMultiplier: 0.9,
    platformFit: 88
  }
];

// 按 name / id 解析平台预设，找不到回退到第一个（抖音），供全链路统一取数。
export function findPlatformPreset(platform = "") {
  const value = String(platform).toLowerCase();
  return (
    platformPresets.find(
      item => item.name === platform || item.name.toLowerCase() === value || item.id === value
    ) || platformPresets[0]
  );
}

export const defaultBrandKit = {
  name: "NovaGlow",
  slogan: "Clean energy for modern rituals",
  colors: ["#8bd3ff", "#ff7a90", "#f9c74f", "#111318"],
  typography: "Inter / Manrope",
  voice: "专业、轻快、有行动号召",
  forbiddenWords: ["100% cure", "guaranteed result", "medical miracle"],
  productLine: "便携式生活方式设备"
};

export const modelRoutes = [
  { id: "llm_fast", name: "LLM Fast", type: "copy", cost: 1.2, latency: "1.2s", health: 99 },
  { id: "image_plus", name: "Image Plus", type: "image", cost: 4.5, latency: "8.4s", health: 97 },
  { id: "video_spark", name: "Video Spark", type: "video", cost: 16.8, latency: "44s", health: 94 },
  { id: "safety_guard", name: "Safety Guard", type: "moderation", cost: 0.4, latency: "0.7s", health: 100 }
];

export function createInitialState() {
  const completedTask = runCreativeWorkflow({
    brief: normalizeBrief({
      productName: "NovaGlow Lamp",
      sellingPoints: "便携、柔光、露营和桌搭都适合",
      targetAudience: "25-38 岁生活方式消费者",
      platform: "抖音",
      goal: "推广新品并提升首周转化",
      style: "高级、明亮、快节奏"
    }),
    skillId: "ecom_tiktok_product_ad_v1",
    brandKit: defaultBrandKit
  });

  return {
    currentUser: {
      name: "Ava Chen",
      email: "ava@aicrew.local",
      role: "Owner"
    },
    workspace: {
      name: "AICrew Studio Demo",
      plan: "Studio",
      credits: 3840,
      monthlyCredits: 5000,
      locale: "zh-CN"
    },
    brandKit: { ...defaultBrandKit },
    assets: [
      createAsset("image", "NovaGlow hero product", "upload", ["product", "hero", "lamp"]),
      createAsset("logo", "NovaGlow mark", "upload", ["brand", "logo"]),
      createAsset("image", "Lifestyle desk scene", "generated", ["scene", "desktop"]),
      createAsset("video", "UGC opening clip", "generated", ["hook", "ugc"])
    ],
    projects: [
      {
        id: makeId("project"),
        name: "NovaGlow 抖音 launch",
        type: "ecommerce_video",
        status: "completed",
        skillId: "ecom_tiktok_product_ad_v1",
        updatedAt: now(),
        taskId: completedTask.id,
        variants: completedTask.variants,
        qualityScore: completedTask.qa.overallScore,
        exports: completedTask.exports
      }
    ],
    tasks: [completedTask],
    exports: completedTask.exports.map(item => ({
      ...item,
      id: makeId("export"),
      projectName: "NovaGlow 抖音 launch",
      createdAt: now()
    })),
    creditLedger: [
      {
        id: makeId("credit"),
        type: "grant",
        amount: 5000,
        label: "Studio monthly grant",
        createdAt: now()
      },
      {
        id: makeId("credit"),
        type: "consume",
        amount: -completedTask.credits.actual,
        label: "NovaGlow launch generation",
        createdAt: now()
      }
    ],
    notifications: [
      {
        id: makeId("notice"),
        level: "success",
        title: "NovaGlow 内容包已导出",
        createdAt: now()
      },
      {
        id: makeId("notice"),
        level: "warning",
        title: "Video Spark 延迟高于基线",
        createdAt: now()
      }
    ],
    customSkills: []
  };
}

export function createAsset(type, name, source = "upload", tags = []) {
  return {
    id: makeId("asset"),
    type,
    name,
    source,
    tags,
    size: type === "video" ? "18.4 MB" : "2.8 MB",
    createdAt: now()
  };
}

export function normalizeBrief(input = {}) {
  const preset = findPlatformPreset(input.platform || "抖音");
  return {
    productName: input.productName?.trim() || "Untitled Product",
    sellingPoints: input.sellingPoints?.trim() || "省时、高质、可规模化生产内容",
    targetAudience: input.targetAudience?.trim() || "跨境电商卖家和短视频运营",
    platform: preset.name,
    goal: input.goal?.trim() || "生成可发布广告内容包",
    style: input.style?.trim() || "现代、清晰、强视觉冲击",
    productCategory: input.productCategory?.trim() || "consumer product",
    promotion: input.promotion?.trim() || "限时新品优惠",
    locale: input.locale || "zh-CN",
    // 用户上传的参考素材（{name,type,ref}）。brief 是唯一事实来源，素材随 brief
    // 流经全链路（prompt 注入 / 导出引用），不另开旁路。无上传时恒为空数组。
    materials: Array.isArray(input.materials) ? input.materials : []
  };
}

// 把三模式 UI 的创作参数（平台 / 受众 / 素材）覆盖进 brief。
// skillId 不进 brief（它驱动 flow 而非内容事实），由编排台经 skillToFlow 单独处理。
// 收敛于 brief 这一唯一事实来源，避免参数在组件里散落成旁路 prop。返回新 brief（不可变）。
export function mergeCreativeParams(brief, params = {}) {
  const next = { ...brief };
  if (params.platform) next.platform = findPlatformPreset(params.platform).name;
  if (typeof params.audience === "string" && params.audience.trim()) {
    next.targetAudience = params.audience.trim();
  }
  if (Array.isArray(params.materials)) next.materials = params.materials;
  return normalizeBrief(next);
}

// 从自由文本中识别目标平台。平台已收敛为「小红书 + 抖音」：
// 命中小红书专属 token 走小红书，其余（含抖音/douyin/tiktok 等）一律回退抖音。
function detectPlatform(text = "") {
  const lower = text.toLowerCase();
  if (text.includes("小红书") || lower.includes("xiaohongshu") || lower.includes("rednote") || lower.includes("xhs")) {
    return "小红书";
  }
  return "抖音";
}

export function parseBriefText(text = "") {
  const compact = text.replace(/\s+/g, " ").trim();
  const productMatch = compact.match(/(?:产品|商品|product)[:：]?\s*([^,，。.;；]+)/i);
  const audienceMatch = compact.match(/(?:受众|人群|audience)[:：]?\s*([^,，。.;；]+)/i);
  const goalMatch = compact.match(/(?:目标|goal)[:：]?\s*([^,，。.;；]+)/i);
  return normalizeBrief({
    productName: productMatch?.[1] || "AICrew Product",
    sellingPoints: compact || "上传商品图后生成广告视频、封面和文案",
    targetAudience: audienceMatch?.[1] || "跨境电商卖家",
    goal: goalMatch?.[1] || "提升广告点击与转化",
    platform: detectPlatform(compact),
    style: compact.includes("高级") ? "高级、干净、强品牌感" : "快节奏、强 Hook、明亮"
  });
}

// 交付物是否为视频，取决于 skill 是否编排了 video Agent。
// 图文型 skill（小红书种草、产品摄影、社媒包）据此切换产出格式与成本结构。
export function isVideoSkill(skill) {
  return skill.agents.includes("video");
}

export function estimateCredits(brief, skillId) {
  return estimateCreditsForSkill(brief, findSkill(skillId));
}

// 估算信用：接受任意 skill 形状对象。预设 skill 与 Flow 编排图动态合成的临时 skill
// 共用同一套成本模型，保证三种编排模式的报价口径一致。
export function estimateCreditsForSkill(brief, skill) {
  const platformMultiplier = findPlatformPreset(brief.platform).creditMultiplier;
  const complexity = Math.min(1.35, 1 + brief.sellingPoints.length / 260);
  const estimated = Math.round(skill.estimatedCredits * platformMultiplier * complexity);
  // 无视频合成时把视频算力份额转入图像生成，保持各档之和不变。
  const hasVideo = isVideoSkill(skill);
  return {
    estimated,
    llm: Math.round(estimated * 0.14),
    image: Math.round(estimated * (hasVideo ? 0.26 : 0.74)),
    video: hasVideo ? Math.round(estimated * 0.48) : 0,
    qa: Math.round(estimated * 0.04),
    export: Math.max(6, Math.round(estimated * 0.08))
  };
}

export function runCreativeWorkflow({ brief, skillId, brandKit = defaultBrandKit }) {
  return runCreativeWorkflowWithSkill({ brief, skill: findSkill(skillId), brandKit });
}

// 用显式 skill 对象执行编排管线。预设 skill 与 Flow 编排图合成的临时 skill 走同一入口，
// 因此自动 / 半自动 / 手动三种模式产出的 task 结构、评分、事件、导出契约完全一致——
// 这是「三模式只是同一个 Flow 的不同创作方式」在执行层的落点。
export function runCreativeWorkflowWithSkill({ brief, skill, brandKit = defaultBrandKit }) {
  const normalizedBrief = normalizeBrief(brief);
  const credits = estimateCreditsForSkill(normalizedBrief, skill);
  const workflowAgents = skill.agents.map((agentId, index) => {
    const agent = agents.find(item => item.id === agentId);
    return buildAgentStep(agent, normalizedBrief, skill, brandKit, index);
  });
  const variants = buildVariants(normalizedBrief, brandKit, skill);
  // 节点/Agent 存在性真实影响交付物：编排了 qa 节点才做质检与合规扫描，编排了 export 节点才打包导出。
  // 该门控对预设 skill 与 Flow 合成 skill 一致生效，保持「三模式经 flowToSkill 同构」不变量。
  const qa = skill.agents.includes("qa")
    ? buildQaReport(normalizedBrief, variants, brandKit, skill)
    : buildSkippedQa(variants);
  return {
    id: makeId("task"),
    status: "completed",
    skillId: skill.id,
    skillName: skill.name,
    brief: normalizedBrief,
    orchestrator: buildOrchestratorRecord(skill, normalizedBrief),
    agents: workflowAgents,
    events: buildAgentEvents(workflowAgents),
    variants,
    qa,
    credits: {
      ...credits,
      actual: Math.max(24, Math.round(credits.estimated * 0.94))
    },
    exports: skill.agents.includes("export") ? buildExports(normalizedBrief, variants, skill) : [],
    createdAt: now(),
    updatedAt: now()
  };
}

export function createProjectFromTask(task, name) {
  return {
    id: makeId("project"),
    name: name || `${task.brief.productName} ${task.brief.platform} campaign`,
    type: "ecommerce_video",
    status: task.status,
    skillId: task.skillId,
    updatedAt: now(),
    taskId: task.id,
    variants: task.variants,
    qualityScore: task.qa.overallScore,
    exports: task.exports
  };
}

export function reviseVariantHook(variant, instruction = "") {
  const sharperHook = instruction.trim()
    ? `${instruction.trim()}：${variant.hook}`
    : `Stop scrolling: ${variant.hook}`;
  return {
    ...variant,
    id: makeId("variant"),
    version: variant.version + 1,
    hook: sharperHook,
    score: Math.min(99, variant.score + 4),
    timeline: variant.timeline.map((shot, index) =>
      index === 0
        ? {
            ...shot,
            action: sharperHook,
            caption: "New hook"
          }
        : shot
    )
  };
}

export function saveSkillFromProject(project, visibility = "private") {
  return {
    id: makeId("skill"),
    name: `${project.name} Winning Structure`,
    category: "Saved Skill",
    stage: visibility === "team" ? "Team" : "Private",
    estimatedCredits: 96,
    formats: ["脚本结构", "镜头结构", "文案结构"],
    agents: ["strategy", "script", "storyboard", "visual", "copy", "qa"],
    promise: "复用当前项目中表现最好的广告结构",
    bestFor: "相似商品与同平台复投",
    palette: ["#45e0c6", "#f9c74f", "#ff7a90"],
    visibility,
    sourceProjectId: project.id,
    createdAt: now()
  };
}

export function buildExportRecord(project, variant, platform = "抖音") {
  const files = buildExportFiles({ brief: { productName: project.name }, variant, skill: findSkill(project.skillId) });
  return {
    id: makeId("export"),
    projectName: project.name,
    projectId: project.id,
    variantId: variant.id,
    name: `${project.name} / ${variant.name}`,
    platform,
    files,
    fileNames: files.map(file => file.name),
    status: "ready",
    createdAt: now()
  };
}

export function calculateQualityScore(metrics) {
  const weights = {
    briefMatch: 0.2,
    productVisibility: 0.2,
    hookStrength: 0.15,
    visualQuality: 0.15,
    brandConsistency: 0.1,
    platformFit: 0.1,
    compliance: 0.1
  };
  const score = Object.entries(weights).reduce((total, [key, weight]) => {
    return total + (metrics[key] ?? 0) * weight;
  }, 0);
  return Math.round(score);
}

export function findSkill(skillId) {
  const skill = skills.find(item => item.id === skillId) || skills[0];
  return skill;
}

function buildOrchestratorRecord(skill, brief) {
  return {
    ...orchestratorAgent,
    status: "completed",
    skillId: skill.id,
    plan: skill.agents,
    summary: "调度 " + skill.name + "：" + skill.agents.length + " 个 Agent，目标 " + brief.goal + "。",
    completedAt: now()
  };
}

function buildAgentStep(agent, brief, skill, brandKit, index) {
  return {
    ...agent,
    status: "completed",
    progress: 100,
    duration: String((index + 1) * 7 + 8) + "s",
    completedAt: now(),
    summary: buildAgentSummary(agent.id, brief, brandKit),
    artifact: buildAgentArtifact(agent.id, brief, skill),
    retryCount: 0
  };
}

function buildAgentEvents(workflowAgents) {
  const total = Math.max(1, workflowAgents.length);
  return workflowAgents.map((agent, index) => ({
    id: makeId("event"),
    event: "agent_completed",
    agentId: agent.id,
    agent: agent.name,
    progress: Math.round(((index + 1) / total) * 100),
    message: agent.output + " completed.",
    credits: agent.cost,
    createdAt: agent.completedAt
  }));
}

function buildAgentArtifact(agentId, brief, skill) {
  const artifacts = {
    brief: "Brief: " + brief.productName + " / " + brief.platform + " / " + brief.targetAudience,
    strategy: "Strategy: " + brief.goal + " with " + brief.style,
    script: skill.agents.includes("video") ? "Scripts: 3 video ad variants" : "Scripts: image-first content outline",
    storyboard: skill.agents.includes("video") ? "Storyboard: 5 timed shots" : "Storyboard: cover + note sections",
    visual: "Visual: " + brief.style + " cover and product scenes",
    video: "Video: " + brief.platform + " " + findPlatformPreset(brief.platform).ratio + " content simulation",
    copy: "Copy package: title, caption, hashtags, CTA",
    qa: "QA report: quality score, compliance, platform fit",
    export: "Export manifest: " + exportFilesFor(skill).join(", ")
  };
  return artifacts[agentId] || "Agent artifact recorded";
}

export function retryAgentStep(task, agentId) {
  const index = task.agents.findIndex(agent => agent.id === agentId);
  if (index < 0) throw new Error("Agent not found: " + agentId);

  const currentAgent = task.agents[index];
  const retryCount = (currentAgent.retryCount || 0) + 1;
  const cost = currentAgent.cost || agents.find(agent => agent.id === agentId)?.cost || 8;
  const completedAt = now();
  const updatedAgent = {
    ...currentAgent,
    status: "completed",
    progress: 100,
    retryCount,
    completedAt,
    duration: String(Number.parseInt(currentAgent.duration, 10) || 12) + "s · retry " + retryCount,
    summary: currentAgent.title + " 已按当前 Brief 重新执行，结构化产物已刷新。",
    artifact: currentAgent.output + " · retry " + retryCount
  };
  const retryEvent = {
    id: makeId("event"),
    event: "agent_retried",
    agentId,
    agent: currentAgent.name,
    progress: 100,
    message: currentAgent.name + " retried successfully.",
    credits: cost,
    createdAt: completedAt
  };

  return {
    cost,
    task: {
      ...task,
      updatedAt: completedAt,
      agents: task.agents.map(agent => (agent.id === agentId ? updatedAgent : agent)),
      events: [...(task.events || []), retryEvent],
      credits: {
        ...task.credits,
        actual: task.credits.actual + cost
      }
    }
  };
}

function buildAgentSummary(agentId, brief, brandKit) {
  const preset = findPlatformPreset(brief.platform);
  const summaries = {
    brief: `已结构化 ${brief.productName} 的目标、受众、平台和卖点。`,
    strategy: `主轴：${brief.goal}；面向 ${brief.targetAudience} 强化首 ${preset.hookSeconds} 秒 Hook。`,
    script: `生成 3 个脚本方向：痛点开场、场景反差、促销冲刺。`,
    storyboard: `拆成 5 个镜头，保持产品露出和 CTA。`,
    visual: `套用 ${brandKit.name} 色彩和 ${brief.style} 视觉语言。`,
    video: `模拟 15 秒${preset.ratio === "1:1" ? "方形" : "竖版"}内容，适配 ${brief.platform}。`,
    copy: `生成标题、Caption、Hashtag 和 CTA。`,
    qa: `检查品牌一致性、平台适配和违规词。`,
    export: `打包 ${preset.ratio} 主视觉、封面 PNG、文案 Markdown。`
  };
  return summaries[agentId] || "完成工作流步骤。";
}

function buildVariants(brief, brandKit, skill) {
  const preset = findPlatformPreset(brief.platform);
  const hasVideo = isVideoSkill(skill);
  const angles = [
    {
      name: "Painkiller Hook",
      hook: `${brief.targetAudience} 最烦的内容制作问题，用 ${brief.productName} 一次解决。`,
      angle: "痛点开场",
      cta: "Try the launch kit today",
      scoreBoost: 0
    },
    {
      name: "Lifestyle Proof",
      hook: `把 ${brief.productName} 放进真实场景，15 秒看见改变。`,
      angle: "生活方式证明",
      cta: "Save this setup",
      scoreBoost: 3
    },
    {
      name: "Offer Sprint",
      hook: `${brief.promotion}，现在用一个内容包讲清所有卖点。`,
      angle: "促销冲刺",
      cta: "Shop the drop",
      scoreBoost: 1
    }
  ];

  return angles.map((item, index) => {
    const metrics = {
      briefMatch: 86 + index * 2,
      productVisibility: 88 - index,
      hookStrength: 82 + item.scoreBoost + index,
      visualQuality: 84 + index * 3,
      brandConsistency: 90,
      platformFit: preset.platformFit,
      compliance: 94
    };
    return {
      id: makeId("variant"),
      version: 1,
      name: item.name,
      angle: item.angle,
      hook: item.hook,
      caption: `${brief.productName} for ${brief.targetAudience}. ${brief.sellingPoints}.`,
      hashtags: ["#AICrewStudio", "#ProductAd", `#${brief.platform.replace(/\s+/g, "")}`],
      cta: item.cta,
      duration: hasVideo ? 15 : null,
      aspectRatio: preset.ratio,
      score: calculateQualityScore(metrics),
      palette: skill.palette,
      brand: brandKit.name,
      timeline: hasVideo ? buildStoryboard(brief, item) : buildNoteStructure(brief, item),
      metrics
    };
  });
}

function buildStoryboard(brief, angle) {
  return [
    {
      time: "0-3s",
      shot: "Hook",
      action: angle.hook,
      caption: "Stop-scroll opening"
    },
    {
      time: "3-6s",
      shot: "Problem",
      action: `展示 ${brief.targetAudience} 的内容生产压力。`,
      caption: "Pain"
    },
    {
      time: "6-10s",
      shot: "Product",
      action: `${brief.productName} 进入画面，突出 ${brief.sellingPoints}。`,
      caption: "Product proof"
    },
    {
      time: "10-13s",
      shot: "Result",
      action: `呈现 ${brief.goal} 的结果感。`,
      caption: "Outcome"
    },
    {
      time: "13-15s",
      shot: "CTA",
      action: angle.cta,
      caption: "Action"
    }
  ];
}

// 图文笔记结构：复用 storyboard 的 {time, shot, action, caption} 形状（slot 标签替代时间码），
// 让前端 storyboard-list 无需改动即可渲染封面 + 正文段 + 话题收尾。
function buildNoteStructure(brief, angle) {
  return [
    {
      time: "封面",
      shot: "Cover",
      action: angle.hook,
      caption: "封面强吸引"
    },
    {
      time: "正文 1",
      shot: "种草点",
      action: `分享 ${brief.productName} 如何解决 ${brief.targetAudience} 的痛点。`,
      caption: "Pain → 种草"
    },
    {
      time: "正文 2",
      shot: "场景",
      action: `把 ${brief.productName} 放进真实生活场景，突出 ${brief.sellingPoints}。`,
      caption: "场景体验"
    },
    {
      time: "正文 3",
      shot: "细节",
      action: `近景细节图配真实使用感受，建立信任。`,
      caption: "信任背书"
    },
    {
      time: "结尾",
      shot: "话题",
      action: `${angle.cta}，引导收藏与关注。`,
      caption: "话题 + CTA"
    }
  ];
}

function buildQaReport(brief, variants, brandKit, skill) {
  const average = Math.round(variants.reduce((sum, item) => sum + item.score, 0) / variants.length);
  const forbiddenHits = brandKit.forbiddenWords.filter(word => {
    const haystack = `${brief.sellingPoints} ${variants.map(item => item.caption).join(" ")}`.toLowerCase();
    return haystack.includes(word.toLowerCase());
  });
  // 图文型平台没有视频 Hook，质检项相应改为封面/标题吸引力。
  const hookLabel = skill && !isVideoSkill(skill) ? "封面/标题吸引力" : "Hook strength";
  return {
    overallScore: forbiddenHits.length ? Math.min(average, 72) : average,
    checks: [
      { label: "Brief match", status: "pass", score: 88 },
      { label: "Product visibility", status: "pass", score: 87 },
      { label: hookLabel, status: "pass", score: 85 },
      { label: "Brand consistency", status: "pass", score: 90 },
      { label: "Compliance", status: forbiddenHits.length ? "warning" : "pass", score: forbiddenHits.length ? 72 : 94 }
    ],
    forbiddenHits,
    recommendation: forbiddenHits.length
      ? "发现禁用词，请调整卖点或 CTA。"
      : `可以优先导出 ${variants[0].name} 并复用为 Skill。`
  };
}

// 未编排 QA 节点时的占位质检：保持 qa 对象形状（overallScore 仍有效，避免下游空引用），
// 但不执行合规/禁用词扫描——「编排了 qa 节点才做质检」在交付物上可见。
function buildSkippedQa(variants) {
  const average = Math.round(variants.reduce((sum, item) => sum + item.score, 0) / variants.length);
  return {
    overallScore: average,
    checks: [],
    forbiddenHits: [],
    recommendation: "未编排 QA 节点，已跳过质检与合规扫描。",
    skipped: true
  };
}

// 导出文件清单随交付物类型切换：视频包 vs 图文笔记包。
// 仍返回纯文件名 string[]（作为 fileNames 的来源与向后兼容契约）。
export function exportFilesFor(skill) {
  return isVideoSkill(skill)
    ? ["video.mp4", "cover.png", "copy.md", "storyboard.csv"]
    : ["cover.png", "note.md", "copy.md", "hashtags.txt"];
}

function csvCell(value) {
  const cell = String(value ?? "");
  return /[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

function renderCopyMarkdown(brief, variant) {
  return [
    `# ${brief.productName} · ${variant?.name || ""}`.trim(),
    "",
    `**Hook**：${variant?.hook || ""}`,
    "",
    `**Caption**：${variant?.caption || ""}`,
    "",
    `**CTA**：${variant?.cta || ""}`,
    "",
    `**Hashtags**：${(variant?.hashtags || []).join(" ")}`
  ].join("\n");
}

function renderNoteMarkdown(brief, variant) {
  const sections = (variant?.timeline || []).map(shot => `## ${shot.time} · ${shot.shot}\n${shot.action}`);
  return [`# ${brief.productName}`, "", ...sections].join("\n");
}

function renderStoryboardCsv(variant) {
  const rows = (variant?.timeline || []).map(shot =>
    [shot.time, shot.shot, shot.action, shot.caption].map(csvCell).join(",")
  );
  return ["time,shot,action,caption", ...rows].join("\n");
}

// 把导出清单从「纯文件名」升级为「带真实内容/引用的描述符」。
// - 图文文件（copy.md / note.md / hashtags.txt / storyboard.csv）内联确定性 content，前端可即时 Blob 下载。
// - cover.png 绑定 variant 的图像：有 imageUrl → source=variantImage（下载层取真实图），否则 placeholder。
// - video.mp4 始终 kind=placeholder（本期不生成视频二进制，守护硬约束）。
// 文件顺序与 exportFilesFor 一致，保持既有 UI/测试对 name 的预期。
export function buildExportFiles({ brief, variant, skill }) {
  const coverFile = {
    name: "cover.png",
    mimeType: "image/png",
    kind: "image",
    source: variant?.imageUrl ? "variantImage" : "placeholder"
  };
  const copyFile = { name: "copy.md", mimeType: "text/markdown", kind: "text", content: renderCopyMarkdown(brief, variant) };
  if (isVideoSkill(skill)) {
    return [
      { name: "video.mp4", mimeType: "video/mp4", kind: "placeholder", source: "deferred" },
      coverFile,
      copyFile,
      { name: "storyboard.csv", mimeType: "text/csv", kind: "text", content: renderStoryboardCsv(variant) }
    ];
  }
  return [
    coverFile,
    { name: "note.md", mimeType: "text/markdown", kind: "text", content: renderNoteMarkdown(brief, variant) },
    copyFile,
    { name: "hashtags.txt", mimeType: "text/plain", kind: "text", content: (variant?.hashtags || []).join("\n") }
  ];
}

function buildExports(brief, variants, skill) {
  return variants.map(variant => {
    const files = buildExportFiles({ brief, variant, skill });
    return {
      name: `${brief.productName} / ${variant.name}`,
      platform: brief.platform,
      variantId: variant.id,
      status: "ready",
      files,
      // 向后兼容：旧消费方按文件名读取 export.files 字符串数组的能力，迁移到 fileNames。
      fileNames: files.map(file => file.name)
    };
  });
}
