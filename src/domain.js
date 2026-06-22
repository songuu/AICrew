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
    output: "Creative Brief JSON"
  },
  {
    id: "strategy",
    name: "Strategy Agent",
    title: "策略策划",
    accent: "#f9c74f",
    output: "受众、卖点、内容角度"
  },
  {
    id: "script",
    name: "Script Agent",
    title: "脚本生成",
    accent: "#ff7a90",
    output: "3 个广告脚本"
  },
  {
    id: "storyboard",
    name: "Storyboard Agent",
    title: "分镜拆解",
    accent: "#b8f27b",
    output: "镜头、时长、转场"
  },
  {
    id: "visual",
    name: "Visual Agent",
    title: "视觉资产",
    accent: "#a78bfa",
    output: "封面与画面方向"
  },
  {
    id: "video",
    name: "Video Agent",
    title: "视频合成",
    accent: "#45e0c6",
    output: "15 秒竖版视频"
  },
  {
    id: "copy",
    name: "Copywriting Agent",
    title: "文案包装",
    accent: "#ffb86b",
    output: "标题、Caption、Hashtag"
  },
  {
    id: "qa",
    name: "QA Agent",
    title: "质量检查",
    accent: "#6ee7b7",
    output: "质量分与合规建议"
  },
  {
    id: "export",
    name: "Export Agent",
    title: "导出适配",
    accent: "#93c5fd",
    output: "TikTok/Reels/Shorts/小红书 内容包"
  }
];

export const skills = [
  {
    id: "ecom_tiktok_product_ad_v1",
    name: "TikTok Product Ad",
    category: "电商广告",
    stage: "MVP",
    estimatedCredits: 120,
    formats: ["9:16 MP4", "封面 PNG", "文案 MD"],
    agents: ["brief", "strategy", "script", "storyboard", "visual", "video", "copy", "qa", "export"],
    promise: "一张商品图生成 3 条 TikTok 广告视频内容包",
    bestFor: "Shopify、TikTok Shop、Amazon 卖家",
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
    id: "tiktok",
    name: "TikTok",
    ratio: "9:16",
    hookSeconds: 3,
    tone: "快节奏、强 Hook、直接 CTA",
    creditMultiplier: 1,
    platformFit: 92
  },
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

// 按 name / id 解析平台预设，找不到回退到第一个（TikTok），供全链路统一取数。
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
      platform: "TikTok",
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
        name: "NovaGlow TikTok launch",
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
      projectName: "NovaGlow TikTok launch",
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
  const preset = findPlatformPreset(input.platform || "TikTok");
  return {
    productName: input.productName?.trim() || "Untitled Product",
    sellingPoints: input.sellingPoints?.trim() || "省时、高质、可规模化生产内容",
    targetAudience: input.targetAudience?.trim() || "跨境电商卖家和短视频运营",
    platform: preset.name,
    goal: input.goal?.trim() || "生成可发布广告内容包",
    style: input.style?.trim() || "现代、清晰、强视觉冲击",
    productCategory: input.productCategory?.trim() || "consumer product",
    promotion: input.promotion?.trim() || "限时新品优惠",
    locale: input.locale || "zh-CN"
  };
}

// 从自由文本中识别目标平台。用专属 token 匹配，避免 "red"/"ins" 等子串误命中。
function detectPlatform(text = "") {
  const lower = text.toLowerCase();
  if (text.includes("小红书") || lower.includes("xiaohongshu") || lower.includes("rednote") || lower.includes("xhs")) {
    return "小红书";
  }
  if (lower.includes("reels") || lower.includes("instagram")) return "Instagram Reels";
  if (lower.includes("shorts") || lower.includes("youtube")) return "YouTube Shorts";
  if (lower.includes("shopify") || text.includes("详情页")) return "Shopify PDP";
  return "TikTok";
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
  const skill = findSkill(skillId);
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
  const normalizedBrief = normalizeBrief(brief);
  const skill = findSkill(skillId);
  const credits = estimateCredits(normalizedBrief, skill.id);
  const workflowAgents = skill.agents.map((agentId, index) => {
    const agent = agents.find(item => item.id === agentId);
    return {
      ...agent,
      status: "completed",
      progress: 100,
      duration: `${(index + 1) * 7 + 8}s`,
      completedAt: now(),
      summary: buildAgentSummary(agentId, normalizedBrief, brandKit)
    };
  });
  const variants = buildVariants(normalizedBrief, brandKit, skill);
  const qa = buildQaReport(normalizedBrief, variants, brandKit, skill);
  return {
    id: makeId("task"),
    status: "completed",
    skillId: skill.id,
    skillName: skill.name,
    brief: normalizedBrief,
    agents: workflowAgents,
    variants,
    qa,
    credits: {
      ...credits,
      actual: Math.max(24, Math.round(credits.estimated * 0.94))
    },
    exports: buildExports(normalizedBrief, variants, skill),
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

export function buildExportRecord(project, variant, platform = "TikTok") {
  return {
    id: makeId("export"),
    projectName: project.name,
    projectId: project.id,
    variantId: variant.id,
    name: `${project.name} / ${variant.name}`,
    platform,
    files: exportFilesFor(findSkill(project.skillId)),
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

// 导出文件清单随交付物类型切换：视频包 vs 图文笔记包。
export function exportFilesFor(skill) {
  return isVideoSkill(skill)
    ? ["video.mp4", "cover.png", "copy.md", "storyboard.csv"]
    : ["cover.png", "note.md", "copy.md", "hashtags.txt"];
}

function buildExports(brief, variants, skill) {
  const files = exportFilesFor(skill);
  return variants.map(variant => ({
    name: `${brief.productName} / ${variant.name}`,
    platform: brief.platform,
    variantId: variant.id,
    status: "ready",
    files
  }));
}
