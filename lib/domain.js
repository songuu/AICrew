import {
  createDeferredArtifact,
  createFailedArtifact,
  createReadyArtifact,
  isDownloadableArtifact,
  sanitizeArtifactError,
  variantImageRefKey
} from "./artifacts.js";
import { TASK_STATUS, lifecycleTimestamps } from "./lifecycle.js";
import { CreditAccountingError, createCreditWallet, releaseReservation, reserveCredits, settleReservation } from "./credits.js";

export { TASK_STATUS } from "./lifecycle.js";
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
    id: "hook",
    name: "Hook Lab Agent",
    title: "钩子工坊",
    accent: "#ffd166",
    responsibility: "为每条内容生成多个候选开场钩子（套用 PAS/好奇缺口/具体数字/反共识等框架），打分选出最强的一个。",
    input: "策略、卖点、受众痛点、平台 hook 框架",
    output: "最强开场钩子 + 候选钩子池",
    tools: ["hook_framework_library", "hook_scorer", "curiosity_gap_builder"],
    evaluation: "首句能停下滑动、套用可识别框架、贴合平台首屏字数",
    cost: 7
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
  },
  {
    // 趋势选题：管线前置，把"选题"从 strategy 内的隐式步骤提为独立环节——选题决定内容天花板。
    // 启发式 / prompt 级，不依赖外网（静态客户端边界）。
    id: "trend",
    name: "Trend Radar Agent",
    title: "趋势选题",
    accent: "#5eead4",
    responsibility: "扫描平台当下热点与季节节点，为内容选出高流量切入角度（启发式，不依赖外网）。",
    input: "Creative Brief、平台、品类、受众",
    output: "趋势选题角度 + 切入建议",
    tools: ["trend_scanner", "topic_angle_miner", "seasonal_calendar"],
    evaluation: "选题贴合平台当下热度、与卖点强相关、可直接转成钩子",
    cost: 7
  },
  {
    // 人设口吻：把文案塑成特定创作者第一人称真人口吻，去 AI 腔（区别于 hook 管开场、copy 管可发布文本）。
    id: "persona",
    name: "Persona Voice Agent",
    title: "人设口吻",
    accent: "#fca5a5",
    responsibility: "把文案塑造成特定创作者人设的第一人称真实口吻，去 AI 腔。",
    input: "受众、品牌语气、内容角度",
    output: "人设口吻指引 + 措辞改写方向",
    tools: ["persona_profiler", "tone_shifter", "voice_consistency_check"],
    evaluation: "口吻像真人创作者、人设一致、可信不做作",
    cost: 6
  },
  {
    // 搜索优化：平台搜索流量=关键词+标签策略（区别于 copy 的"挑标签"，这是"上搜索/被搜到"）。
    id: "seo",
    name: "Search Optimizer Agent",
    title: "搜索优化",
    accent: "#fcd34d",
    responsibility: "为内容做平台搜索流量优化：核心关键词、长尾词与标签策略，提升可发现性。",
    input: "卖点、受众、平台搜索习惯",
    output: "关键词 + 标签策略",
    tools: ["keyword_extractor", "hashtag_strategist", "search_intent_mapper"],
    evaluation: "关键词搜索量与相关性平衡、标签贴合平台、覆盖核心+长尾",
    cost: 5
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

// Skill「带货分组」（RoboNeo 式技能选择器的分类 tab）。
// group 用于选择器分组（推荐/电商带货/美妆护肤/短视频带货）；
// 与 category（细分品类，供 router 评分 + 模板库展示）正交，二者都保留、互不覆盖。
// 「featured」决定是否进入「推荐」tab；icon 给卡片一个轻量视觉身份。
export const skillGroups = [
  { id: "featured", name: "推荐", desc: "高频高转化的精选技能" },
  { id: "rednote", name: "小红书推广", desc: "搜索种草、达人投放、转化复盘" },
  { id: "douyin", name: "抖音获客", desc: "直播获客、本地到店、千川投流、私域承接" },
  { id: "ecom", name: "电商带货", desc: "商品广告、主图精修、产品摄影" },
  { id: "beauty", name: "美妆护肤", desc: "种草测评、模特上身、生活方式" },
  { id: "shortvideo", name: "短视频带货", desc: "短剧、直播切片、社媒内容包" }
];

export const skills = [
  {
    id: "ecom_tiktok_product_ad_v1",
    name: "抖音 商品广告",
    icon: "🛍️",
    group: "ecom",
    featured: true,
    category: "电商广告",
    stage: "MVP",
    estimatedCredits: 120,
    formats: ["9:16 MP4", "封面 PNG", "文案 MD"],
    agents: ["brief", "trend", "strategy", "script", "storyboard", "visual", "video", "copy", "seo", "qa", "export"],
    promise: "一张商品图生成 3 条抖音广告视频内容包",
    bestFor: "抖音电商、品牌商家、跨境卖家",
    palette: ["#8bd3ff", "#ff7a90", "#f9c74f"]
  },
  {
    id: "product_retouch_v1",
    name: "产品精修主图",
    icon: "✨",
    group: "ecom",
    featured: false,
    category: "电商主图",
    stage: "P1",
    estimatedCredits: 70,
    formats: ["主图精修", "白底图", "场景合成"],
    agents: ["brief", "visual", "qa", "export"],
    promise: "把普通产品图精修成电商级主图与场景图",
    bestFor: "电商主图、详情页、广告投放",
    palette: ["#45e0c6", "#8bd3ff", "#b8f27b"]
  },
  {
    id: "product_photography_v1",
    name: "Product Photography",
    icon: "📸",
    group: "ecom",
    featured: false,
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
    id: "detail_page_conversion_v1",
    name: "商品详情页转化",
    icon: "🧾",
    group: "ecom",
    featured: false,
    category: "详情页转化",
    stage: "P1",
    estimatedCredits: 100,
    formats: ["首屏卖点", "详情页模块", "FAQ", "转化文案"],
    agents: ["brief", "strategy", "visual", "copy", "seo", "qa", "export"],
    promise: "把商品卖点整理成可投放的详情页首屏、模块结构和信任背书",
    bestFor: "淘宝 / 天猫 / 京东 / 独立站详情页，投放落地页优化",
    palette: ["#8bd3ff", "#f9c74f", "#6ee7b7"]
  },
  {
    id: "ad_ab_test_pack_v1",
    name: "广告 A/B 测试包",
    icon: "🧪",
    group: "ecom",
    featured: true,
    category: "投放测试",
    stage: "P1",
    estimatedCredits: 140,
    formats: ["3 组卖点角度", "A/B 标题", "封面方案", "投放文案"],
    agents: ["brief", "trend", "strategy", "hook", "visual", "copy", "seo", "qa", "export"],
    promise: "围绕同一商品生成多组投放角度、标题钩子和封面方案，方便素材测试",
    bestFor: "信息流投放、千川素材测试、跨境广告投手与品牌增长团队",
    palette: ["#ffd166", "#8bd3ff", "#ff7a90"]
  },
  {
    id: "private_domain_conversion_v1",
    name: "私域成交素材包",
    icon: "💬",
    group: "ecom",
    featured: false,
    category: "私域转化",
    stage: "P1",
    estimatedCredits: 85,
    formats: ["社群海报", "朋友圈文案", "私聊话术", "复购提醒"],
    agents: ["brief", "strategy", "persona", "visual", "copy", "qa", "export"],
    promise: "把商品卖点转成微信私域可直接使用的社群、朋友圈和私聊成交素材",
    bestFor: "微信私域、社群团购、导购客服、老客复购运营",
    palette: ["#45e0c6", "#ffb86b", "#a78bfa"]
  },
  {
    // 小红书生态专属：图文种草，不走视频合成 Agent，输出 3:4 封面 + 笔记正文 + 话题。
    id: "rednote_seeding_note_v1",
    name: "小红书种草笔记",
    icon: "📕",
    group: "beauty",
    featured: true,
    category: "社媒种草",
    stage: "P1",
    platform: "小红书",
    rednoteStage: "content_production",
    recommendTags: ["种草", "图文笔记", "封面", "标题", "话题", "搜索"],
    estimatedCredits: 90,
    formats: ["3:4 封面", "图文笔记", "标题", "话题标签"],
    agents: ["brief", "trend", "strategy", "visual", "persona", "copy", "seo", "qa", "export"],
    promise: "从商品卖点生成小红书图文种草笔记（封面 + 正文 + 话题）",
    bestFor: "美妆、生活方式、母婴、家居品牌与买手",
    palette: ["#ff7a90", "#ffb86b", "#f9c74f"]
  },
  {
    // UGC 种草测评：真人体验视角的图文 + 口播脚本（对标 RoboNeo「UGC 种草测评」技能）。
    id: "ugc_review_v1",
    name: "UGC 种草测评",
    icon: "📱",
    group: "beauty",
    featured: true,
    category: "达人测评",
    stage: "P1",
    platform: "小红书",
    rednoteStage: "creator_seeding",
    recommendTags: ["UGC", "测评", "素人", "达人", "体验", "口播"],
    estimatedCredits: 95,
    formats: ["测评封面", "图文测评", "真人口播脚本", "话题标签"],
    agents: ["brief", "strategy", "visual", "persona", "copy", "qa", "export"],
    promise: "从真实使用体验生成 UGC 种草测评图文 + 口播脚本",
    bestFor: "美妆、个护、生活方式品牌的达人投放与素人种草",
    palette: ["#ff9ecf", "#a78bfa", "#ffb86b"]
  },
  {
    // 模特上身展示：服饰/美妆的真人上身图组，纯视觉链路（无视频）。
    id: "model_tryon_v1",
    name: "模特上身展示",
    icon: "👗",
    group: "beauty",
    featured: false,
    category: "模特展示",
    stage: "P1",
    estimatedCredits: 80,
    formats: ["模特图组", "场景封面", "卖点标注"],
    agents: ["brief", "visual", "qa", "export"],
    promise: "为服饰 / 美妆生成模特上身展示图组与场景封面",
    bestFor: "服饰、配饰、美妆品牌的详情页与社媒",
    palette: ["#f9c74f", "#ff7a90", "#a78bfa"]
  },
  {
    id: "ingredient_explainer_cards_v1",
    name: "成分功效科普卡",
    icon: "🧬",
    group: "beauty",
    featured: false,
    category: "成分科普",
    stage: "P1",
    platform: "小红书",
    rednoteStage: "content_production",
    recommendTags: ["成分", "功效", "科普", "护肤", "合规", "搜索"],
    estimatedCredits: 75,
    formats: ["成分卡", "功效解释", "避坑说明", "小红书标题"],
    agents: ["brief", "strategy", "visual", "copy", "seo", "qa", "export"],
    promise: "把复杂成分和功效转成用户看得懂、可收藏的科普卡片内容",
    bestFor: "护肤、美妆、个护、保健品品牌的合规科普和搜索种草",
    palette: ["#6ee7b7", "#8bd3ff", "#ff9ecf"]
  },
  {
    id: "new_product_launch_matrix_v1",
    name: "新品上市种草矩阵",
    icon: "🌱",
    group: "beauty",
    featured: true,
    category: "新品上市",
    stage: "P1",
    platform: "小红书",
    rednoteStage: "creator_seeding",
    recommendTags: ["新品", "上市", "KOL", "KOC", "预热", "种草矩阵"],
    estimatedCredits: 130,
    formats: ["上市节奏", "KOL Brief", "种草笔记", "搜索标签"],
    agents: ["brief", "trend", "strategy", "hook", "visual", "persona", "copy", "seo", "qa", "export"],
    promise: "为新品上市规划预热、首发、复投三阶段的种草内容和达人 Brief",
    bestFor: "美妆新品、生活方式新品、上市前 14 天内容矩阵",
    palette: ["#5eead4", "#ff7a90", "#f9c74f"]
  },
  {
    id: "rednote_account_diagnostic_v1",
    name: "小红书账号诊断",
    icon: "🧭",
    group: "rednote",
    featured: true,
    category: "账号诊断",
    stage: "P1",
    platform: "小红书",
    rednoteStage: "diagnosis",
    recommendTags: ["账号", "诊断", "定位", "竞品", "内容结构", "主页"],
    estimatedCredits: 80,
    formats: ["账号定位报告", "主页改版清单", "竞品差异", "内容机会点"],
    agents: ["brief", "trend", "strategy", "seo", "qa", "export"],
    promise: "诊断账号定位、主页表达、内容结构和搜索机会，给出可执行改版清单",
    bestFor: "品牌号冷启动、账号增长停滞、投放前基础盘诊断",
    palette: ["#5eead4", "#8bd3ff", "#ffd166"]
  },
  {
    id: "rednote_competitor_benchmark_v1",
    name: "小红书竞品拆解",
    icon: "🔎",
    group: "rednote",
    featured: false,
    category: "竞品研究",
    stage: "P1",
    platform: "小红书",
    rednoteStage: "diagnosis",
    recommendTags: ["竞品", "对标", "爆文", "差异", "赛道", "机会"],
    estimatedCredits: 90,
    formats: ["竞品矩阵", "爆文拆解", "差异化角度", "可复制结构"],
    agents: ["brief", "trend", "strategy", "hook", "seo", "qa", "export"],
    promise: "拆解同赛道竞品内容结构、爆文钩子和差异化机会，沉淀可复制打法",
    bestFor: "新品牌入局、老品牌换赛道、投放前内容方向验证",
    palette: ["#a78bfa", "#5eead4", "#ffb86b"]
  },
  {
    id: "rednote_search_intent_map_v1",
    name: "小红书搜索意图图谱",
    icon: "🗺️",
    group: "rednote",
    featured: true,
    category: "搜索策略",
    stage: "P1",
    platform: "小红书",
    rednoteStage: "search_strategy",
    recommendTags: ["搜索", "关键词", "意图", "需求", "长尾词", "SEO"],
    estimatedCredits: 95,
    formats: ["关键词分层", "用户意图图谱", "内容选题池", "标签策略"],
    agents: ["brief", "trend", "strategy", "seo", "qa", "export"],
    promise: "把用户搜索需求拆成核心词、场景词、问题词和转化词，形成选题地图",
    bestFor: "依赖搜索流量的美妆、母婴、家居、个护、食品品牌",
    palette: ["#8bd3ff", "#6ee7b7", "#f9c74f"]
  },
  {
    id: "rednote_topic_calendar_v1",
    name: "小红书月度选题日历",
    icon: "📅",
    group: "rednote",
    featured: false,
    category: "选题规划",
    stage: "P1",
    platform: "小红书",
    rednoteStage: "search_strategy",
    recommendTags: ["选题", "日历", "月度", "节点", "内容规划", "栏目"],
    estimatedCredits: 90,
    formats: ["30 天选题", "栏目结构", "发布时间建议", "素材需求表"],
    agents: ["brief", "trend", "strategy", "hook", "copy", "seo", "qa", "export"],
    promise: "按搜索词、节点、场景和人群痛点规划 30 天小红书内容日历",
    bestFor: "品牌自运营、代运营团队、需要稳定更新的垂类账号",
    palette: ["#ffd166", "#8bd3ff", "#ff7a90"]
  },
  {
    id: "rednote_seo_note_v1",
    name: "小红书 SEO 笔记",
    icon: "🔤",
    group: "rednote",
    featured: true,
    category: "搜索笔记",
    stage: "P1",
    platform: "小红书",
    rednoteStage: "content_production",
    recommendTags: ["SEO", "搜索", "关键词", "排名", "笔记", "长尾词"],
    estimatedCredits: 100,
    formats: ["SEO 标题", "正文结构", "关键词布局", "话题标签"],
    agents: ["brief", "trend", "strategy", "hook", "visual", "persona", "copy", "seo", "qa", "export"],
    promise: "生成围绕目标关键词的小红书搜索型笔记，兼顾标题点击和正文关键词布局",
    bestFor: "想长期获取站内搜索流量的品牌词、品类词、功效词内容",
    palette: ["#5eead4", "#ffd166", "#ff9ecf"]
  },
  {
    id: "rednote_cover_title_ab_v1",
    name: "小红书封面标题 A/B",
    icon: "🧪",
    group: "rednote",
    featured: false,
    category: "点击优化",
    stage: "P1",
    platform: "小红书",
    rednoteStage: "content_production",
    recommendTags: ["封面", "标题", "A/B", "点击", "测试", "首图"],
    estimatedCredits: 80,
    formats: ["封面方向", "标题 A/B", "首图文案", "点击理由"],
    agents: ["brief", "strategy", "hook", "visual", "copy", "qa", "export"],
    promise: "为同一笔记生成多组封面和标题测试方案，提高首页点击率",
    bestFor: "已有选题但点击弱、爆文复用、投放素材前测",
    palette: ["#ffd166", "#ff7a90", "#8bd3ff"]
  },
  {
    id: "rednote_product_comparison_v1",
    name: "小红书横评种草",
    icon: "⚖️",
    group: "rednote",
    featured: false,
    category: "测评横评",
    stage: "P1",
    platform: "小红书",
    rednoteStage: "content_production",
    recommendTags: ["横评", "测评", "对比", "榜单", "避坑", "清单"],
    estimatedCredits: 105,
    formats: ["横评表格", "榜单封面", "测评正文", "购买建议"],
    agents: ["brief", "strategy", "visual", "persona", "copy", "seo", "qa", "export"],
    promise: "把产品放进真实对比语境，生成榜单/横评式小红书种草内容",
    bestFor: "竞争激烈品类、需要解释差异化卖点的品牌",
    palette: ["#8bd3ff", "#ffb86b", "#6ee7b7"]
  },
  {
    id: "rednote_scenario_seed_v1",
    name: "小红书场景化种草",
    icon: "🏕️",
    group: "rednote",
    featured: false,
    category: "场景种草",
    stage: "P1",
    platform: "小红书",
    rednoteStage: "content_production",
    recommendTags: ["场景", "生活方式", "痛点", "清单", "教程", "种草"],
    estimatedCredits: 95,
    formats: ["场景脚本", "封面图组", "图文笔记", "收藏清单"],
    agents: ["brief", "trend", "strategy", "visual", "persona", "copy", "seo", "qa", "export"],
    promise: "把卖点放进通勤、露营、护肤、育儿等真实场景，生成收藏型种草笔记",
    bestFor: "生活方式、家居、母婴、食品、户外、个护品牌",
    palette: ["#6ee7b7", "#f9c74f", "#ffb86b"]
  },
  {
    id: "rednote_video_note_v1",
    name: "小红书视频笔记",
    icon: "🎥",
    group: "rednote",
    featured: false,
    category: "视频笔记",
    stage: "P1",
    platform: "小红书",
    rednoteStage: "content_production",
    recommendTags: ["视频", "口播", "教程", "开箱", "笔记", "9:16"],
    estimatedCredits: 170,
    formats: ["视频脚本", "9:16 视频", "封面", "字幕文案"],
    agents: ["brief", "trend", "strategy", "hook", "script", "storyboard", "visual", "video", "persona", "copy", "seo", "qa", "export"],
    promise: "生成适合小红书的视频笔记脚本、分镜、封面和字幕文案",
    bestFor: "教程、开箱、测评、探店、口播类小红书视频内容",
    palette: ["#ff7a90", "#8bd3ff", "#45e0c6"]
  },
  {
    id: "rednote_koc_brief_v1",
    name: "小红书 KOC Brief",
    icon: "👥",
    group: "rednote",
    featured: true,
    category: "达人 Brief",
    stage: "P1",
    platform: "小红书",
    rednoteStage: "creator_seeding",
    recommendTags: ["KOC", "达人", "brief", "合作", "素人", "投放"],
    estimatedCredits: 90,
    formats: ["KOC Brief", "拍摄要求", "口吻禁区", "验收标准"],
    agents: ["brief", "strategy", "persona", "visual", "copy", "qa", "export"],
    promise: "生成给达人/KOC 可直接执行的合作 Brief，明确卖点、口吻、画面和验收标准",
    bestFor: "达人投放、素人铺量、蒲公英合作、批量内容外包",
    palette: ["#a78bfa", "#ff9ecf", "#ffd166"]
  },
  {
    id: "rednote_kol_matrix_v1",
    name: "小红书达人矩阵投放",
    icon: "🧩",
    group: "rednote",
    featured: true,
    category: "达人矩阵",
    stage: "P1",
    platform: "小红书",
    rednoteStage: "creator_seeding",
    recommendTags: ["KOL", "KOC", "达人矩阵", "铺量", "蒲公英", "投放"],
    estimatedCredits: 120,
    formats: ["达人分层", "内容角度矩阵", "投放节奏", "验收口径"],
    agents: ["brief", "trend", "strategy", "persona", "copy", "seo", "qa", "export"],
    promise: "按头部、腰部、KOC 分层规划达人矩阵、内容角度和发布节奏",
    bestFor: "新品上市、品牌声量、节点大促、需要规模化种草的团队",
    palette: ["#5eead4", "#a78bfa", "#ffb86b"]
  },
  {
    id: "rednote_juguang_launch_v1",
    name: "小红书聚光投放素材",
    icon: "📣",
    group: "rednote",
    featured: true,
    category: "聚光投放",
    stage: "P1",
    platform: "小红书",
    rednoteStage: "paid_amplification",
    recommendTags: ["聚光", "信息流", "投放", "广告", "素材", "放量"],
    estimatedCredits: 135,
    formats: ["投放角度", "广告封面", "信息流文案", "A/B 测试点"],
    agents: ["brief", "trend", "strategy", "hook", "visual", "copy", "seo", "qa", "export"],
    promise: "为小红书聚光投放生成信息流素材角度、封面文案和 A/B 测试点",
    bestFor: "已有内容验证后需要付费放量、搜索/信息流投放团队",
    palette: ["#ffd166", "#ff7a90", "#8bd3ff"]
  },
  {
    id: "rednote_search_keyword_boost_v1",
    name: "小红书搜索排名投放",
    icon: "📈",
    group: "rednote",
    featured: false,
    category: "搜索投放",
    stage: "P1",
    platform: "小红书",
    rednoteStage: "paid_amplification",
    recommendTags: ["搜索", "排名", "搜索排名", "关键词", "关键词优化", "搜索投放", "聚光搜索", "品类词", "投放"],
    estimatedCredits: 110,
    formats: ["关键词包", "搜索广告标题", "落地笔记", "出价意图分层"],
    agents: ["brief", "strategy", "copy", "seo", "qa", "export"],
    promise: "围绕品类词、功效词和品牌词生成搜索推广关键词包与落地笔记结构",
    bestFor: "需要抢占小红书搜索结果页、品牌词防守、品类词拓量的团队",
    palette: ["#8bd3ff", "#5eead4", "#f9c74f"]
  },
  {
    id: "rednote_comment_dm_conversion_v1",
    name: "小红书评论私信转化",
    icon: "💌",
    group: "rednote",
    featured: false,
    category: "转化承接",
    stage: "P1",
    platform: "小红书",
    rednoteStage: "conversion",
    recommendTags: ["评论", "私信", "转化", "异议", "客服", "追单"],
    estimatedCredits: 70,
    formats: ["评论回复", "私信话术", "异议处理", "导购 CTA"],
    agents: ["brief", "strategy", "persona", "copy", "qa", "export"],
    promise: "把笔记互动中的问题转成评论回复、私信承接、异议处理和导购话术",
    bestFor: "高互动笔记、达人种草后承接、客服和导购团队",
    palette: ["#ffb86b", "#ff9ecf", "#6ee7b7"]
  },
  {
    id: "rednote_performance_review_v1",
    name: "小红书投后复盘",
    icon: "📊",
    group: "rednote",
    featured: false,
    category: "投后复盘",
    stage: "P1",
    platform: "小红书",
    rednoteStage: "measurement",
    recommendTags: ["复盘", "数据", "投后", "CTR", "收藏", "转化"],
    estimatedCredits: 85,
    formats: ["数据复盘", "爆点归因", "优化动作", "下一轮测试清单"],
    agents: ["brief", "strategy", "seo", "qa", "export"],
    promise: "把笔记、达人和投放结果整理成归因复盘，输出下一轮优化动作",
    bestFor: "月度复盘、达人投放复盘、聚光投放复盘、内容团队周会",
    palette: ["#8bd3ff", "#a78bfa", "#6ee7b7"]
  },  {
    id: "social_content_pack_v1",
    name: "Social Content Pack",
    icon: "📈",
    group: "shortvideo",
    featured: false,
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
    icon: "🎬",
    group: "shortvideo",
    featured: true,
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
    // 直播切片带货：从直播录像合成高转化带货切片视频内容包（含视频 Agent）。
    id: "live_clip_commerce_v1",
    name: "直播切片带货",
    icon: "📹",
    group: "shortvideo",
    featured: false,
    category: "直播切片",
    stage: "P1",
    estimatedCredits: 180,
    formats: ["切片脚本", "9:16 视频", "爆点封面", "带货文案"],
    agents: ["strategy", "script", "visual", "video", "copy", "qa", "export"],
    promise: "从直播录像生成高转化带货切片视频内容包",
    bestFor: "直播带货团队、达人切片号",
    palette: ["#8bd3ff", "#ff9ecf", "#f9c74f"]
  },
  {
    id: "local_life_store_visit_v1",
    name: "本地生活探店",
    icon: "📍",
    group: "shortvideo",
    featured: true,
    category: "本地生活",
    stage: "P1",
    estimatedCredits: 170,
    formats: ["探店脚本", "9:16 视频", "团购卖点", "POI 标题"],
    agents: ["brief", "trend", "strategy", "hook", "script", "storyboard", "visual", "video", "copy", "seo", "qa", "export"],
    promise: "从门店卖点生成同城探店短视频、团购转化点和 POI 搜索标题",
    bestFor: "餐饮、酒旅、美业、亲子、健身门店的同城团购内容",
    palette: ["#f9c74f", "#45e0c6", "#ff7a90"]
  },
  {
    id: "knowledge_ip_shortvideo_v1",
    name: "知识 IP 短视频",
    icon: "🎓",
    group: "shortvideo",
    featured: false,
    category: "知识 IP",
    stage: "P1",
    estimatedCredits: 125,
    formats: ["选题日历", "开场钩子", "口播脚本", "图文卡片"],
    agents: ["brief", "trend", "strategy", "hook", "script", "visual", "persona", "copy", "seo", "qa", "export"],
    promise: "把专业观点转成适合连续发布的知识口播脚本、开场钩子和卡片封面",
    bestFor: "教育课程、咨询顾问、知识博主、B2B 专业服务账号",
    palette: ["#8bd3ff", "#a78bfa", "#ffd166"]
  },
  {
    id: "comment_reply_conversion_v1",
    name: "评论区追单话术",
    icon: "↩️",
    group: "shortvideo",
    featured: false,
    category: "互动转化",
    stage: "P1",
    estimatedCredits: 65,
    formats: ["评论回复", "私信承接", "异议处理", "促单话术"],
    agents: ["brief", "strategy", "persona", "copy", "qa", "export"],
    promise: "把短视频和直播评论里的疑问转成可复制的回复、私信承接和促单话术",
    bestFor: "直播间运营、短视频评论区、客服承接、达人种草后的追单转化",
    palette: ["#ffb86b", "#6ee7b7", "#ff7a90"]
  },
  {
    // Hook Lab：纯文案 / 钩子技能（对标"爆款标题工厂"）。编排 hook agent，
    // 套用 PAS / 好奇缺口 / 具体数字 / 反共识等框架，产出多候选开场钩子 + 可发布文案包。
    // 图文链路（无 video Agent）→ 交付图文包，吸引力是该技能的一等目标。
    id: "hook_lab_v1",
    name: "Hook Lab 爆款钩子",
    icon: "🪝",
    group: "shortvideo",
    featured: true,
    category: "爆款文案",
    stage: "P1",
    estimatedCredits: 70,
    formats: ["候选钩子组", "标题", "正文文案", "话题标签"],
    agents: ["brief", "strategy", "hook", "copy", "seo", "qa", "export"],
    promise: "套用爆款框架生成多个高吸引力开场钩子 + 可发布文案包",
    bestFor: "抖音 / 小红书带货、内容创作者、需要高点击文案的品牌",
    palette: ["#ffd166", "#ff7a90", "#8bd3ff"]
  },
  {
    // 全链路爆款内容引擎：串起本轮新增的 trend(选题前置) + persona(人设口吻) + seo(搜索优化)，
    // 与既有 strategy/hook/copy/qa/export 组成完整流水线，是「流程优化」的集中展示位。
    // 图文链路（无 video）→ 交付图文包；选题→搜索全链路是该技能的一等卖点。
    id: "viral_content_engine_v1",
    name: "全链路爆款内容引擎",
    icon: "🚀",
    group: "shortvideo",
    featured: true,
    category: "全链路内容",
    stage: "P1",
    estimatedCredits: 110,
    formats: ["选题角度", "候选钩子组", "人设文案", "搜索标签", "封面", "图文包"],
    agents: ["brief", "trend", "strategy", "hook", "persona", "copy", "seo", "qa", "export"],
    promise: "从选题到搜索标签一条龙：趋势选题→爆款钩子→真人口吻→搜索优化的完整内容包",
    bestFor: "抖音 / 小红书带货、内容团队、追求选题到流量全链路的品牌",
    palette: ["#5eead4", "#ffd166", "#fca5a5"]
  },
  // —— 小红书获客生态扩展（参照小鸡AI 产品矩阵 + 小红书获客全景研究）——
  // 边界：AICrew 是静态站内容生成器，只复刻小鸡AI 的「内容/话术/策略产物」层，
  // 不做爬虫 / 自动私信 / 自动养号 / 批量发布（既越界又踩平台 2025 合规红线）。
  // 这批技能均为话术 / SOP / 策略类图文产物（agents 不含 video），覆盖
  // 诊断→搜索→内容→投放→线索捕捉→转化→私域 的完整获客漏斗缺口。
  {
    // 评论区截流：去「别人」的高赞/竞品笔记下用神评引流，区别于 comment_dm（承接「自己」笔记的评论）。
    // 接入获客专属钩子框架（截流神评钩 / 痛点筛选钩），让截流话术真正有套路而非泛泛硬广。
    id: "rednote_comment_intercept_v1",
    name: "评论区截流话术",
    icon: "🎯",
    group: "rednote",
    featured: true,
    category: "评论截流",
    stage: "P1",
    platform: "小红书",
    rednoteStage: "lead_capture",
    recommendTags: ["截流", "评论区", "竞品评论", "求平替", "求链接", "引流话术"],
    estimatedCredits: 85,
    formats: ["分场景话术库", "竞品笔记锚点", "软引导 CTA", "防删防限词清单"],
    agents: ["brief", "strategy", "persona", "hook", "copy", "qa", "export"],
    hookPatterns: ["截流神评钩", "痛点筛选钩", "真实自白", "社会证明"],
    promise: "为同行/竞品/热门笔记生成分场景截流评论话术（求链接/问价/找平替/求教程），自然引流不硬广",
    bestFor: "想去高赞/竞品笔记评论区截流但怕被删的品牌号、买手、本地服务",
    palette: ["#ff7a90", "#ffb86b", "#ffd166"]
  },
  {
    // 引流钩子诱饵库：设计资料包/清单/福利诱饵 + 笔记内植入 + 评论区领取引导。
    // 诱饵留白钩是核心框架：价值前置 + 留白 + 唯一低门槛行动指令。
    id: "rednote_lead_magnet_hook_v1",
    name: "引流钩子诱饵库",
    icon: "🪝",
    group: "rednote",
    featured: true,
    category: "引流钩子",
    stage: "P1",
    platform: "小红书",
    rednoteStage: "lead_capture",
    recommendTags: ["钩子", "诱饵", "资料包", "福利钩子", "清单引流", "领取引导"],
    estimatedCredits: 80,
    formats: ["钩子诱饵命名", "笔记植入话术", "评论区领取引导", "诱饵资料包大纲"],
    agents: ["brief", "strategy", "hook", "copy", "seo", "qa", "export"],
    hookPatterns: ["诱饵留白钩", "痛点筛选钩", "具体数字", "好奇缺口"],
    promise: "设计资料包/清单/福利钩子的命名、笔记内植入方式和评论区领取引导，沉淀可复用诱饵库",
    bestFor: "用免费资料/清单/福利换线索的知识付费、教培、B 端、私域操盘手",
    palette: ["#f9c74f", "#ff9ecf", "#a78bfa"]
  },
  {
    // 私信获客 SOP 漏斗：开场→挖需→给价值→留资/加微 的多轮话术漏斗，内置防违规替换。
    // 只生成话术 SOP 文档，不含自动发送（自动私信踩平台红线）。
    id: "rednote_dm_funnel_sop_v1",
    name: "私信获客 SOP 漏斗",
    icon: "💬",
    group: "rednote",
    featured: true,
    category: "私信获客",
    stage: "P1",
    platform: "小红书",
    rednoteStage: "private_domain",
    recommendTags: ["获客SOP", "加微", "留资", "防违规", "漏斗话术", "私信开场"],
    estimatedCredits: 100,
    formats: ["私信漏斗 SOP", "分阶段话术脚本", "留资/加微 CTA", "违规词替换表"],
    agents: ["brief", "strategy", "persona", "hook", "copy", "qa", "export"],
    hookPatterns: ["诱饵留白钩", "痛点筛选钩", "真实自白", "社会证明"],
    promise: "把私信获客拆成开场→需求确认→价值给予→留资/加微 CTA 的多轮话术漏斗，内置防违规表达",
    bestFor: "靠私信承接线索、需多轮养信再加微的咨询/服务/教培/本地商家",
    palette: ["#a78bfa", "#8bd3ff", "#5eead4"]
  },
  {
    // 企业号主页与私信菜单：专业号/企业号承接基建——主页定位/简介/精选排布 + 私信菜单/欢迎语。
    // 合规话术层，实际配置走官方组件（留资卡/企微名片）。
    id: "rednote_pro_account_setup_v1",
    name: "企业号主页与私信菜单",
    icon: "🏢",
    group: "rednote",
    featured: false,
    category: "企业号承接",
    stage: "P1",
    platform: "小红书",
    rednoteStage: "private_domain",
    recommendTags: ["企业号", "专业号", "主页搭建", "私信菜单", "欢迎语", "简介定位"],
    estimatedCredits: 90,
    formats: ["主页定位与简介", "精选笔记排布", "私信自动菜单文案", "欢迎语与留资引导"],
    agents: ["brief", "strategy", "persona", "seo", "copy", "qa", "export"],
    promise: "搭建专业号/企业号主页定位、简介、精选笔记排布和私信自动菜单+欢迎语承接体系（合规话术，执行用官方组件）",
    bestFor: "刚开专业号/企业号、要把主页和私信菜单一次性配置成承接闸门的商家",
    palette: ["#5eead4", "#ffd166", "#8bd3ff"]
  },
  {
    // 群聊运营 SOP：建群钩子 + 群内容 SOP + 群内转化路径，把公域流量沉到站内群聊做私域。
    id: "rednote_group_chat_ops_v1",
    name: "群聊运营 SOP",
    icon: "👥",
    group: "rednote",
    featured: false,
    category: "群聊运营",
    stage: "P1",
    platform: "小红书",
    rednoteStage: "private_domain",
    recommendTags: ["群聊", "社群", "建群", "私域沉淀", "群运营", "群转化路径"],
    estimatedCredits: 85,
    formats: ["建群钩子", "群内容 SOP", "群内转化路径", "群规与活跃话术"],
    agents: ["brief", "strategy", "persona", "hook", "copy", "qa", "export"],
    hookPatterns: ["诱饵留白钩", "社会证明", "具体数字", "真实自白"],
    promise: "设计建群钩子、群内容运营 SOP 和群内转化路径，把笔记流量沉淀进群做站内私域",
    bestFor: "已有粉丝基础、想把公域流量沉到小红书群聊做持续触达与促单的运营",
    palette: ["#ff9ecf", "#a78bfa", "#8bd3ff"]
  },
  {
    // 爆文对标改写：贴入对标爆文 → 结构/钩子拆解 → 套用到自己产品改写成不撞车原创笔记。
    // 与 competitor_benchmark（diagnosis，只出拆解+机会）正交——本技能出「改写成品」。
    id: "rednote_viral_rewrite_v1",
    name: "爆文对标改写",
    icon: "♻️",
    group: "rednote",
    featured: true,
    category: "爆文改写",
    stage: "P1",
    platform: "小红书",
    rednoteStage: "content_production",
    recommendTags: ["改写", "仿写", "爆文改写", "对标改写", "结构套用", "二创"],
    estimatedCredits: 95,
    formats: ["爆文结构拆解", "钩子迁移映射", "改写后笔记", "原创度避雷清单"],
    agents: ["brief", "trend", "strategy", "hook", "persona", "copy", "seo", "qa", "export"],
    promise: "拆解一篇对标爆文的结构与钩子，套用到自己产品，改写成不撞车的原创笔记",
    bestFor: "贴入对标爆文链接/截图想快速产出同结构原创笔记的运营与买手",
    palette: ["#5eead4", "#8bd3ff", "#ffb86b"]
  },
  {
    // 账号矩阵起号养号：多账号差异化人设 + 30 天养号内容计划 + 矩阵分发改写规则。
    // 仅内容计划层（区别 kol_matrix 的「达人矩阵」=外部达人），不含批量登录/自动发布。
    id: "rednote_account_matrix_warmup_v1",
    name: "账号矩阵起号养号",
    icon: "🧱",
    group: "rednote",
    featured: false,
    category: "矩阵起号",
    stage: "P1",
    platform: "小红书",
    rednoteStage: "content_production",
    recommendTags: ["起号", "养号", "账号矩阵", "多账号", "人设差异化", "矩阵分发"],
    estimatedCredits: 120,
    formats: ["多账号人设矩阵", "30 天养号内容计划", "矩阵分发改写规则", "起号避坑清单"],
    agents: ["brief", "trend", "strategy", "persona", "hook", "copy", "seo", "qa", "export"],
    promise: "为多账号设计差异化人设、30 天养号内容计划和矩阵分发改写规则，批量起号不踩限流红线",
    bestFor: "做账号矩阵/多号铺量、需要差异化人设与养号节奏的品牌与机构（仅内容计划，不含自动化发布）",
    palette: ["#8bd3ff", "#a78bfa", "#6ee7b7"]
  },
  {
    // 合规违禁词体检改写：横切守卫——任意话术 → 标红违禁词与导流红线 → 合规替代版 + 风险等级。
    // 对位小红书 2025 强制合规收口，可接在其他获客技能输出后做后处理。
    id: "rednote_compliance_check_v1",
    name: "合规违禁词体检改写",
    icon: "🛡️",
    group: "rednote",
    featured: true,
    category: "合规质检",
    stage: "P1",
    platform: "小红书",
    rednoteStage: "content_production",
    recommendTags: ["违禁词", "合规", "质检", "敏感词", "限流自查", "合规改写"],
    estimatedCredits: 60,
    formats: ["违规点标红清单", "风险等级评分", "合规替代版文案", "导流红线对照表"],
    agents: ["brief", "qa", "copy", "export"],
    promise: "输入任意笔记/评论/私信话术，标红违禁词与导流红线，给出合规替代版与风险等级",
    bestFor: "所有导流/获客类内容发布前的合规自查，可作为横切守卫接在其他技能输出后",
    palette: ["#6ee7b7", "#ffd166", "#ff7a90"]
  },
  {
    // 数据选题库：从笔记数据/评论高频词/搜索趋势反推可复制爆文选题，分级+打分。
    // 放 search_strategy 而非 measurement，避免与 performance_review 的「复盘优化」stage 抢路由。
    // 非实时抓取——LLM 知识驱动（静态站边界）。
    id: "rednote_data_topic_mining_v1",
    name: "数据选题库",
    icon: "📊",
    group: "rednote",
    featured: true,
    category: "数据选题",
    stage: "P1",
    platform: "小红书",
    rednoteStage: "search_strategy",
    recommendTags: ["选题库", "数据选题", "爆文选题", "选题灵感", "数据反推", "选题打分"],
    estimatedCredits: 85,
    formats: ["数据洞察摘要", "选题机会清单", "分级爆文选题库", "选题打分排序"],
    agents: ["brief", "trend", "strategy", "seo", "qa", "export"],
    promise: "从笔记数据、评论高频词和搜索趋势反推可复制的爆文选题，沉淀分级选题库（LLM 知识驱动，非实时抓取）",
    bestFor: "需要持续产出选题、想把零散数据洞察沉淀成可复用选题库的内容团队",
    palette: ["#8bd3ff", "#6ee7b7", "#f9c74f"]
  },
  {
    // 目标人群画像与人设定位：复用此前闲置的 persona 节点，补冷启动定位缺口。
    id: "rednote_audience_persona_profile_v1",
    name: "目标人群画像与人设定位",
    icon: "🧑",
    group: "rednote",
    featured: false,
    category: "人群画像",
    stage: "P1",
    platform: "小红书",
    rednoteStage: "diagnosis",
    recommendTags: ["人群画像", "目标用户", "人设定位", "IP定位", "用户分层", "痛点场景"],
    estimatedCredits: 80,
    formats: ["目标人群画像", "痛点场景地图", "账号人设/IP 定位", "内容口吻指南"],
    agents: ["brief", "persona", "strategy", "qa", "export"],
    promise: "基于品类与卖点产出目标人群画像、痛点场景和匹配的账号人设/IP 定位，统一内容口吻",
    bestFor: "冷启动定位、不清楚写给谁/用什么人设说的品牌号与个人 IP",
    palette: ["#a78bfa", "#ff9ecf", "#8bd3ff"]
  },
  {
    // 卖点洞察与产品力诊断：把功能堆砌提炼成可种草的核心卖点与记忆点（对位灵犀 SPU 诊断）。
    id: "rednote_selling_point_diagnosis_v1",
    name: "卖点洞察与产品力诊断",
    icon: "💎",
    group: "rednote",
    featured: false,
    category: "卖点诊断",
    stage: "P1",
    platform: "小红书",
    rednoteStage: "diagnosis",
    recommendTags: ["卖点", "产品力", "SPU", "差异化", "记忆点", "卖点排序"],
    estimatedCredits: 85,
    formats: ["卖点提炼清单", "差异化定位", "卖点优先级排序", "场景化卖点话术"],
    agents: ["brief", "strategy", "persona", "qa", "export"],
    promise: "诊断产品力与差异化，把功能堆砌提炼成可种草的核心卖点与记忆点，并按场景排序",
    bestFor: "卖点不清晰、想找到差异化记忆点再做种草的新品与白牌商家",
    palette: ["#ffd166", "#ff7a90", "#a78bfa"]
  },
  {
    // 人群反漏斗投放策略：核心人群→兴趣人群→泛人群的渗透节奏（对位灵犀人群反漏斗）。
    id: "rednote_anti_funnel_targeting_v1",
    name: "人群反漏斗投放策略",
    icon: "📡",
    group: "rednote",
    featured: false,
    category: "投放人群策略",
    stage: "P1",
    platform: "小红书",
    rednoteStage: "paid_amplification",
    recommendTags: ["人群反漏斗", "人群包", "渗透节奏", "核心人群", "破圈", "投放人群"],
    estimatedCredits: 95,
    formats: ["反漏斗人群分层", "人群包定向建议", "渗透节奏表", "各层投放创意方向"],
    agents: ["brief", "strategy", "persona", "seo", "qa", "export"],
    promise: "按核心人群→兴趣人群→泛人群的反漏斗逻辑，产出人群分层、人群包定向与渗透节奏策略",
    bestFor: "做聚光/信息流投放、需要先打透核心人群再破圈的预算型品牌",
    palette: ["#5eead4", "#8bd3ff", "#a78bfa"]
  },
  // —— 抖音获客生态（参照巨量引擎/千川/星图/抖音来客/企业号矩阵 + 抖音获客全景研究）——
  // 镜像小红书获客体系：group="douyin" + platform="抖音" + douyinStage，经 douyinPromotionSkills() 聚合成「抖音获客」tab。
  // 边界同 rednote：只产内容/话术/脚本/SOP/策略产物，不做投放出价/账号自动化/平台配置/数据采集。
  // 抖音是视频主场——直播/口播/短视频/探店类含 video（视频链路），话术/策略/选题类走图文链路。
  {
    id: "douyin_account_positioning_v1",
    name: "抖音账号定位诊断",
    icon: "🧭",
    group: "douyin",
    featured: true,
    category: "账号定位",
    stage: "P1",
    platform: "抖音",
    douyinStage: "positioning",
    recommendTags: ["账号定位", "人设差异化", "对标拆解", "人群画像", "卖点诊断", "赛道选择"],
    estimatedCredits: 90,
    formats: ["账号定位诊断报告", "人设差异化方案", "对标爆款结构拆解", "卖点-人群匹配表"],
    agents: ["brief", "trend", "strategy", "persona", "hook", "copy", "qa", "export"],
    hookPatterns: ["反共识", "好奇缺口", "痛点筛选钩", "具体数字"],
    promise: "诊断抖音账号定位与人设差异化，拆解对标爆款的结构与钩子，输出不撞车的差异化定位方案",
    bestFor: "刚起号或定位模糊的品牌号、个人 IP、本地服务商",
    palette: ["#161823", "#25F4EE", "#FE2C55"]
  },
  {
    id: "douyin_search_seo_v1",
    name: "抖音搜索SEO卡位",
    icon: "🔍",
    group: "douyin",
    featured: true,
    category: "搜索卡位",
    stage: "P1",
    platform: "抖音",
    douyinStage: "search_seo",
    recommendTags: ["抖音搜索", "SEO卡位", "关键词布局", "话题标签", "口播埋词", "搜索流量"],
    estimatedCredits: 85,
    formats: ["核心词/长尾词/场景词/疑问词分层词库", "关键词卡位标题模板", "话题标签矩阵", "评论区埋词话术"],
    agents: ["brief", "trend", "strategy", "seo", "persona", "copy", "qa", "export"],
    promise: "围绕业务词产出分层关键词库、卡位标题、话题标签与埋词方案，抢占抖音搜索与同城排名",
    bestFor: "想吃搜索/同城自然流量的本地商家、知识 IP、B 端获客",
    palette: ["#161823", "#25F4EE", "#73FBD3"]
  },
  {
    // 视频链路：信息流口播引流短视频（含 script/storyboard/video）。完播钩为核心框架。
    id: "douyin_lead_gen_shortvideo_v1",
    name: "抖音引流短视频脚本",
    icon: "🎬",
    group: "douyin",
    featured: true,
    category: "短视频引流",
    stage: "P1",
    platform: "抖音",
    douyinStage: "content_engine",
    recommendTags: ["短视频引流", "口播脚本", "黄金3秒钩子", "完播率", "扣评引导", "信息流"],
    estimatedCredits: 110,
    formats: ["9:16 口播脚本", "3秒钩子开场库", "分镜脚本", "主页/扣评引流 CTA"],
    agents: ["brief", "trend", "hook", "script", "storyboard", "video", "copy", "qa", "export"],
    hookPatterns: ["痛点开场", "好奇缺口", "完播钩", "痛点筛选钩"],
    promise: "把卖点拆成钩子开场→价值证明→引导私信/主页/扣评的信息流口播短视频脚本与分镜",
    bestFor: "靠信息流公域引流到私信/主页的品牌号、获客型商家",
    palette: ["#161823", "#FE2C55", "#FF6B81"]
  },
  {
    id: "douyin_viral_rewrite_v1",
    name: "抖音爆款对标改写",
    icon: "♻️",
    group: "douyin",
    featured: false,
    category: "对标改写",
    stage: "P1",
    platform: "抖音",
    douyinStage: "content_engine",
    recommendTags: ["爆款改写", "对标二创", "结构拆解", "同结构原创", "选题复用", "去重不撞车"],
    estimatedCredits: 85,
    formats: ["爆款结构拆解", "钩子-节奏-CTA 复用框架", "同结构原创脚本", "批量改写选题清单"],
    agents: ["brief", "trend", "strategy", "hook", "copy", "qa", "export"],
    hookPatterns: ["反共识", "好奇缺口", "具体数字", "真实自白"],
    promise: "贴入对标爆款，拆解其开头-节奏-钩子-CTA 结构，改写成不撞车的同结构原创选题",
    bestFor: "想快速复用验证过的爆款结构、批量产内容的运营与矩阵号",
    palette: ["#161823", "#25F4EE", "#A685FF"]
  },
  {
    id: "douyin_matrix_warmup_v1",
    name: "抖音矩阵起号养号计划",
    icon: "🧩",
    group: "douyin",
    featured: false,
    category: "矩阵起号",
    stage: "P1",
    platform: "抖音",
    douyinStage: "content_engine",
    recommendTags: ["矩阵号", "起号养号", "多账号人设", "混剪改写规则", "30天内容日历", "选题分发"],
    estimatedCredits: 95,
    formats: ["多账号差异化人设", "30天起号内容日历", "混剪改写规则", "矩阵选题分发表"],
    agents: ["brief", "strategy", "persona", "trend", "script", "seo", "qa", "export"],
    promise: "生成多账号差异化人设、30 天起号内容计划与混剪改写规则，只做内容计划层不碰批量发布",
    bestFor: "做矩阵号但要规避同质化与防关联红线的操盘手、MCN",
    palette: ["#161823", "#73FBD3", "#25F4EE"]
  },
  {
    // 视频链路：直播全场脚本 SOP。直播憋单钩/直播逼单钩为核心框架（含 2025 合规改写版）。
    id: "douyin_live_acquisition_script_v1",
    name: "抖音直播获客脚本SOP",
    icon: "📡",
    group: "douyin",
    featured: true,
    category: "直播脚本",
    stage: "P1",
    platform: "抖音",
    douyinStage: "live_commerce",
    recommendTags: ["直播脚本", "憋单话术", "逼单催单", "留资承接", "场控SOP", "福袋互动"],
    estimatedCredits: 125,
    formats: ["分段直播脚本(开场/憋单/逼单/过款)", "憋单/逼单话术(含合规版)", "留资/加群承接话术", "场控SOP时间轴"],
    agents: ["brief", "strategy", "script", "hook", "storyboard", "video", "copy", "qa", "export"],
    hookPatterns: ["直播憋单钩", "直播逼单钩", "紧迫", "社会证明"],
    promise: "生成开场留人→憋单→逼单→留资承接的直播全场脚本与场控 SOP，憋单逼单含 2025 合规改写版",
    bestFor: "带货/线索型直播间的主播、场控、操盘手",
    palette: ["#161823", "#FE2C55", "#25F4EE"]
  },
  {
    // 视频链路：本地探店短视频脚本（绑 POI/团购）。
    id: "douyin_local_store_acquisition_v1",
    name: "抖音探店到店获客",
    icon: "📍",
    group: "douyin",
    featured: true,
    category: "本地探店",
    stage: "P1",
    platform: "抖音",
    douyinStage: "local_life",
    recommendTags: ["探店脚本", "到店钩子", "五感体验", "团购引导", "同城获客", "POI挂载"],
    estimatedCredits: 105,
    formats: ["探店短视频脚本", "拍摄分镜+BGM/字幕建议", "到店钩子口播", "团购引导 CTA"],
    agents: ["brief", "trend", "script", "storyboard", "video", "copy", "seo", "qa", "export"],
    hookPatterns: ["具体数字", "社会证明", "好奇缺口", "紧迫"],
    promise: "输入店铺类型与卖点，生成到店钩子→五感体验→价值锚点→团购引导的探店短视频脚本与分镜",
    bestFor: "本地餐饮/丽人/亲子门店与探店达人合作",
    palette: ["#161823", "#FFB86B", "#FE2C55"]
  },
  {
    id: "douyin_local_group_buy_v1",
    name: "抖音团购转化包",
    icon: "🎟️",
    group: "douyin",
    featured: false,
    category: "团购转化",
    stage: "P1",
    platform: "抖音",
    douyinStage: "local_life",
    recommendTags: ["团购套餐", "套餐命名", "到店核销", "同城投放", "本地推策略", "复购召回"],
    estimatedCredits: 90,
    formats: ["套餐命名+卖点短句", "团购详情页文案", "到店核销引导话术", "同城本地推投放命题"],
    agents: ["brief", "strategy", "seo", "persona", "copy", "qa", "export"],
    hookPatterns: ["具体数字", "紧迫", "社会证明", "痛点筛选钩"],
    promise: "按锚点原价→到手价→限时限量→适用场景→怕踩雷承诺公式产出团购套餐卖点、核销与复购话术",
    bestFor: "做抖音来客团购的本地连锁与单店商家",
    palette: ["#161823", "#F9C74F", "#FE2C55"]
  },
  {
    // 视频链路：千川/DOU+ 三态投放素材（短视频+直播间+商品卡）+ 封面标题 A/B 矩阵。
    id: "douyin_qianchuan_creative_v1",
    name: "千川DOU+投流素材包",
    icon: "🚀",
    group: "douyin",
    featured: true,
    category: "投流素材",
    stage: "P1",
    platform: "抖音",
    douyinStage: "paid_traffic",
    recommendTags: ["千川", "DOU+", "投流素材", "带货脚本", "商品卡文案", "封面标题AB"],
    estimatedCredits: 120,
    formats: ["多角度短视频带货脚本", "直播间引流切片脚本", "商品卡标题/卖点", "封面+标题 A/B 测试矩阵"],
    agents: ["brief", "trend", "strategy", "hook", "script", "storyboard", "video", "copy", "qa", "export"],
    hookPatterns: ["痛点开场", "具体数字", "反共识", "紧迫"],
    promise: "围绕同一商品/直播间产出短视频+直播间+商品卡三态多角度投放素材与封面标题 A/B 矩阵，赛马跑量",
    bestFor: "跑千川/DOU+ 的电商商家与投手，解决素材同质化",
    palette: ["#161823", "#FE2C55", "#25F4EE"]
  },
  {
    id: "douyin_anti_funnel_targeting_v1",
    name: "抖音人群反漏斗策略",
    icon: "🎯",
    group: "douyin",
    featured: false,
    category: "投放策略",
    stage: "P1",
    platform: "抖音",
    douyinStage: "paid_traffic",
    recommendTags: ["人群反漏斗", "人群包定向", "核心人群破圈", "投放策略", "内容命题", "放量节奏"],
    estimatedCredits: 85,
    formats: ["人群反漏斗分层方案", "各圈层内容命题", "定向标签建议", "测款-放量节奏表"],
    agents: ["brief", "strategy", "persona", "trend", "copy", "qa", "export"],
    promise: "按核心人群→兴趣人群→泛人群反漏斗顺序输出分层定向策略与各圈层对应内容命题（策略产物非后台操作）",
    bestFor: "需要人群破圈与放量节奏规划的投手与品牌",
    palette: ["#161823", "#A685FF", "#25F4EE"]
  },
  {
    id: "douyin_comment_intercept_v1",
    name: "抖音评论区截流话术",
    icon: "💬",
    group: "douyin",
    featured: false,
    category: "评论截流",
    stage: "P1",
    platform: "抖音",
    douyinStage: "lead_capture",
    recommendTags: ["评论截流", "竞品评论", "神评话术", "求平替", "主页承接", "软引导"],
    estimatedCredits: 80,
    formats: ["分场景截流话术库", "竞品/热门视频锚点", "软引导 CTA", "防删防限词清单"],
    agents: ["brief", "strategy", "persona", "hook", "copy", "qa", "export"],
    hookPatterns: ["截流神评钩", "痛点筛选钩", "真实自白", "社会证明"],
    promise: "为同行/竞品/高赞视频生成分场景截流神评话术（干货补充/反差观点+主页承接暗示），自然引流不放联系方式",
    bestFor: "想去竞品/爆款评论区截流但怕被删限的品牌号、本地服务",
    palette: ["#161823", "#FE2C55", "#FFB86B"]
  },
  {
    id: "douyin_lead_capture_funnel_v1",
    name: "抖音线索留资漏斗",
    icon: "🪝",
    group: "douyin",
    featured: true,
    category: "线索留资",
    stage: "P1",
    platform: "抖音",
    douyinStage: "lead_capture",
    recommendTags: ["线索留资", "引流诱饵", "原生表单", "私信关键词", "小风车", "承接SOP"],
    estimatedCredits: 90,
    formats: ["钩子诱饵命名+原生表单文案", "私信自动回复/快捷菜单话术树", "小风车/关键词触发话术", "线索承接 SOP"],
    agents: ["brief", "strategy", "persona", "hook", "copy", "qa", "export"],
    hookPatterns: ["诱饵留白钩", "痛点筛选钩", "紧迫", "社会证明"],
    promise: "设计资料包/福利诱饵+原生表单+私信关键词/小风车触发话术与承接 SOP，只产话术合规走官方组件",
    bestFor: "用免费资料/福利换线索的教培、B 端、本地服务获客",
    palette: ["#161823", "#73FBD3", "#FE2C55"]
  },
  {
    id: "douyin_private_domain_handoff_v1",
    name: "抖音企业号私域承接",
    icon: "🏠",
    group: "douyin",
    featured: false,
    category: "私域承接",
    stage: "P1",
    platform: "抖音",
    douyinStage: "private_domain",
    recommendTags: ["企业号装修", "私信菜单", "粉丝群SOP", "企微导流", "合规话术", "欢迎语"],
    estimatedCredits: 85,
    formats: ["主页装修与简介文案", "私信菜单/欢迎语脚本树", "粉丝群运营SOP+福利日历", "企微导流合规话术(含红线清单)"],
    agents: ["brief", "strategy", "persona", "seo", "copy", "qa", "export"],
    hookPatterns: ["诱饵留白钩", "社会证明", "真实自白", "痛点筛选钩"],
    promise: "搭建企业号主页装修、私信菜单、粉丝群 SOP 与企微合规导流话术，导流走官方组件强调红线不做自动化",
    bestFor: "需要把抖音线索沉淀进私域且怕踩导流红线的企业号、本地商家",
    palette: ["#161823", "#25F4EE", "#A685FF"]
  },
  {
    id: "douyin_campaign_review_v1",
    name: "抖音数据复盘诊断",
    icon: "📊",
    group: "douyin",
    featured: false,
    category: "数据复盘",
    stage: "P1",
    platform: "抖音",
    douyinStage: "review",
    recommendTags: ["投后复盘", "爆点归因", "赛马诊断", "数据诊断", "测试假设", "优化清单"],
    estimatedCredits: 80,
    formats: ["数据复盘报告", "爆点/哑火归因", "赛马机制诊断", "下一轮测试假设+优化action清单"],
    agents: ["brief", "trend", "strategy", "persona", "qa", "export"],
    promise: "根据用户贴入的投放/内容数据复盘爆点归因、解读赛马机制，输出下一轮可执行测试假设（基于贴入数据无爬虫）",
    bestFor: "需要把单次投放/内容数据转成迭代动作的运营与操盘手",
    palette: ["#161823", "#25F4EE", "#F9C74F"]
  }
];

export const rednotePromotionStages = [
  { id: "diagnosis", name: "诊断定位", desc: "账号定位、竞品拆解、人群画像、卖点诊断" },
  { id: "search_strategy", name: "搜索策略", desc: "关键词、搜索意图、选题日历、数据选题库" },
  { id: "content_production", name: "内容生产", desc: "图文/视频笔记、封面标题、横评场景、对标改写、矩阵起号、合规质检" },
  { id: "creator_seeding", name: "达人种草", desc: "KOC Brief、达人矩阵、新品铺量" },
  { id: "paid_amplification", name: "投放放大", desc: "聚光素材、搜索排名、人群反漏斗、广告 A/B" },
  // 线索捕捉：把公域曝光主动收口成线索（评论区截流 / 引流钩子诱饵 / 私信关键词触发），
  // 与下游「转化承接」的被动承接正交——一个是抢流量进私信，一个是承接进来的对话。
  { id: "lead_capture", name: "线索捕捉", desc: "评论区截流、引流钩子诱饵、关键词触发留资" },
  { id: "conversion", name: "转化承接", desc: "评论、私信、客服、导购话术" },
  // 私域承接：线索沉淀进站内外私域（私信多轮 SOP / 群聊运营 / 企业号承接基建），
  // 与公域「转化承接」分层——这里是把线索养成复购的长期阵地。
  { id: "private_domain", name: "私域承接", desc: "私信 SOP、群聊运营、企业号主页与私信菜单" },
  { id: "measurement", name: "复盘优化", desc: "投后复盘、爆点归因、下一轮测试" }
];

export function rednotePromotionSkills() {
  return skills.filter(skill => skill.platform === "小红书" || skill.group === "rednote" || skill.id.startsWith("rednote_"));
}

function normalizeRecommendationText(value = "") {
  return String(value || "").trim().toLowerCase();
}

// —— 通用「获客漏斗」推荐内核：小红书(rednote) / 抖音(douyin) 两套体系共用 ——
// 差异仅在传入的 skillset / stages / stageKey（技能上的阶段字段名 "rednoteStage" | "douyinStage"），
// 评分数学单一来源，避免每加一个平台漏斗就复制一遍打分逻辑（DRY）。
function resolvePromotionStage(stages, stage = "") {
  const text = normalizeRecommendationText(stage);
  if (!text) return "";
  const matched = stages.find(item => {
    const haystack = `${item.id} ${item.name} ${item.desc}`.toLowerCase();
    return item.id === text || haystack.includes(text) || text.includes(item.name.toLowerCase());
  });
  return matched?.id || text;
}

function promotionRecommendationScore(skill, query, stageId, stages, stageKey) {
  let score = 0;
  const haystack = `${skill.name} ${skill.category} ${skill.promise} ${skill.bestFor} ${(skill.formats || []).join(" ")} ${(skill.recommendTags || []).join(" ")}`.toLowerCase();
  const tokens = query.split(/[\s,，。；;、/]+/).filter(token => token.length >= 2);
  for (const tag of skill.recommendTags || []) {
    const term = normalizeRecommendationText(tag);
    if (term && query.includes(term)) score += 12 + Math.min(term.length, 6);
  }
  for (const token of tokens) {
    if (haystack.includes(token)) score += 3;
  }
  if (stageId && skill[stageKey] === stageId) score += 30;
  if (stageId) {
    const stage = stages.find(item => item.id === stageId);
    if (stage && haystack.includes(stage.name.toLowerCase())) score += 6;
  }
  if (skill.featured) score += 1;
  return score;
}

function recommendPromotionSkills({ skillset, stages, stageKey, input = {} }) {
  const query = normalizeRecommendationText(
    [input.query, input.intent, input.goal, input.productCategory, input.audience].filter(Boolean).join(" ")
  );
  const stageId = resolvePromotionStage(stages, input.stage || input.funnelStage || "");
  const limit = Math.max(1, Math.min(Number(input.limit) || 6, 12));
  const ranked = skillset
    .map((skill, index) => ({ skill, index, score: promotionRecommendationScore(skill, query, stageId, stages, stageKey) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const hasSignal = Boolean(query || stageId);
  const filtered = hasSignal ? ranked.filter(item => item.score > 0) : ranked;
  return (filtered.length ? filtered : ranked).slice(0, limit).map(item => item.skill);
}

export function recommendRednoteSkills(input = {}) {
  return recommendPromotionSkills({ skillset: rednotePromotionSkills(), stages: rednotePromotionStages, stageKey: "rednoteStage", input });
}

// —— 抖音获客体系：镜像 rednote 体系，复用通用 recommendPromotionSkills 内核 ——
// 抖音漏斗比小红书多 直播获客 / 本地到店 / 投流放大 三个抖音特有环节（视频主场 + 千川/本地推 + 直播）。
export const douyinPromotionStages = [
  { id: "positioning", name: "定位诊断", desc: "账号定位与人设、人群画像、对标爆款拆解、卖点诊断" },
  { id: "search_seo", name: "搜索卡位", desc: "抖音搜索关键词布局、标题/标签/话题矩阵、口播埋词、搜索意图选题" },
  { id: "content_engine", name: "内容引流", desc: "黄金 3 秒钩子短视频脚本与分镜、爆款对标改写、矩阵起号养号内容计划" },
  { id: "live_commerce", name: "直播获客", desc: "直播全场脚本(开场留人/憋单/逼单/留资承接)、场控 SOP、福袋互动、直播预热引流" },
  { id: "local_life", name: "本地到店", desc: "探店短视频、团购套餐卖点、POI 标题、到店核销与同城本地推策略" },
  { id: "paid_traffic", name: "投流放大", desc: "千川/DOU+ 多角度带货素材(短视频+直播间+商品卡)、封面标题 A/B、人群反漏斗定向" },
  { id: "lead_capture", name: "线索留资", desc: "评论区截流神评、引流钩子诱饵、原生表单/私信关键词/小风车留资承接" },
  { id: "private_domain", name: "私域承接", desc: "企业号主页装修、私信菜单与欢迎语、粉丝群运营 SOP、企微合规导流" },
  { id: "review", name: "数据复盘", desc: "投后数据复盘、爆点/哑火归因、赛马机制诊断、下一轮测试假设" }
];

export function douyinPromotionSkills() {
  return skills.filter(skill => skill.group === "douyin" || skill.id.startsWith("douyin_"));
}

export function recommendDouyinSkills(input = {}) {
  return recommendPromotionSkills({ skillset: douyinPromotionSkills(), stages: douyinPromotionStages, stageKey: "douyinStage", input });
}
// 按 group 取技能；「featured」/空 → 推荐 tab（featured 标记的技能）。
// 供 RoboNeo 式技能选择器的分类 tab 直接驱动卡片列表，UI 不再硬编码分组逻辑。
export function skillsInGroup(groupId) {
  if (!groupId || groupId === "featured") {
    return skills.filter(skill => skill.featured);
  }
  if (groupId === "rednote") {
    return rednotePromotionSkills();
  }
  if (groupId === "douyin") {
    return douyinPromotionSkills();
  }
  return skills.filter(skill => skill.group === groupId);
}

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
    lang: "zh",
    // 平台文案 DNA：结构化替代单句 tone，供 buildCopyPrompt 把"平台调性"落成可执行约束。
    // hookPatterns 为该平台优先的钩子框架名（语义见 ai/workflow.js HOOK_FRAMEWORKS）。
    hookPatterns: ["痛点开场", "好奇缺口", "具体数字", "反共识"],
    copyRules: {
      hookMaxChars: 20,
      captionRange: [60, 280],
      emoji: "首句含 1 个 emoji，全文 2-4 个，不堆叠",
      lineBreaks: "CTA 前换行单独成行",
      ctaStyle: "直接、有紧迫感（限时/马上/点链接），中文口语",
      ctaExamples: ["现在点链接抢", "马上去试试", "划走前先点赞收藏"]
    },
    creditMultiplier: 1,
    platformFit: 92
  },
  {
    // Instagram Reels：跨境短视频，9:16 视觉高级、情绪化，CTA 轻（互动/收藏）。
    // 文案本轮仍 zh（i18n defer），平台差异体现在 hook 框架 / 字数 / emoji / CTA 风格。
    id: "reels",
    name: "Instagram Reels",
    ratio: "9:16",
    hookSeconds: 3,
    tone: "视觉高级、情绪化、轻量 CTA",
    lang: "en",
    hookPatterns: ["真实自白", "社会证明", "好奇缺口", "具体数字"],
    copyRules: {
      hookMaxChars: 16,
      captionRange: [40, 220],
      emoji: "情绪化 emoji 1-3 个，点缀氛围",
      lineBreaks: "短句多换行，营造留白感",
      ctaStyle: "轻 CTA，引导互动/收藏，不硬推",
      ctaExamples: ["Save this for later", "Follow for more", "Double-tap if this helped"]
    },
    creditMultiplier: 0.92,
    platformFit: 86
  },
  {
    // YouTube Shorts：问题驱动、信息密度高、强保留，hook 窗口更长（5s）。
    id: "shorts",
    name: "YouTube Shorts",
    ratio: "9:16",
    hookSeconds: 5,
    tone: "问题驱动、信息密度高、强保留",
    lang: "en",
    hookPatterns: ["好奇缺口", "具体数字", "痛点开场", "反共识"],
    copyRules: {
      hookMaxChars: 24,
      captionRange: [50, 200],
      emoji: "克制，0-2 个",
      lineBreaks: "首行抛问题，正文分点列信息",
      ctaStyle: "引导关注/看下一条，强保留",
      ctaExamples: ["Subscribe for the full guide", "Like to unlock the next tip", "Comment '1' and I'll send the list"]
    },
    creditMultiplier: 0.95,
    platformFit: 85
  },
  {
    // Shopify PDP：独立站商品详情页，1:1 主图，卖点清晰、信任背书、促销明确。
    id: "shopify",
    name: "Shopify PDP",
    ratio: "1:1",
    hookSeconds: 4,
    tone: "卖点清晰、信任背书、促销明确",
    lang: "en",
    hookPatterns: ["社会证明", "具体数字", "痛点开场", "紧迫"],
    copyRules: {
      hookMaxChars: 28,
      captionRange: [80, 300],
      emoji: "0-1 个，专业克制",
      lineBreaks: "卖点分点 + 信任背书单独成段",
      ctaStyle: "促销明确 + 信任背书，直接转化",
      ctaExamples: ["Shop now at the launch price", "30-day hassle-free returns", "Add to cart to lock your stock"]
    },
    creditMultiplier: 0.9,
    platformFit: 87
  },
  {
    // 小红书：图文种草为主，3:4 竖图封面驱动，调性真诚轻软广。
    id: "rednote",
    name: "小红书",
    ratio: "3:4",
    hookSeconds: 2,
    tone: "真诚种草、生活方式、封面强吸引、轻软广",
    lang: "zh",
    // 小红书文案 DNA：标题短钩子 + emoji 节奏 + 软性 CTA（收藏/关注/评论区互动）。
    hookPatterns: ["真实自白", "具体数字", "好奇缺口", "社会证明"],
    copyRules: {
      hookMaxChars: 20,
      captionRange: [120, 500],
      emoji: "全文 3-5 个 emoji，对称分布，配合分段",
      lineBreaks: "每个种草点单独成段，段间留白",
      ctaStyle: "软性、真诚（收藏/关注/评论区扣字），不硬推",
      ctaExamples: ["记得点收藏不然划走就找不到啦", "关注我持续分享", "评论区告诉我你想看哪款"]
    },
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
    creditReservations: [],
    creditReservationLedger: [],
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

function objectOr(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function arrayOr(value, fallback = []) {
  return Array.isArray(value) ? value : fallback;
}

export function normalizeStateShape(input = {}) {
  const fallback = createInitialState();
  const source = objectOr(input);
  return {
    ...fallback,
    ...source,
    currentUser: { ...fallback.currentUser, ...objectOr(source.currentUser) },
    workspace: { ...fallback.workspace, ...objectOr(source.workspace) },
    brandKit: { ...fallback.brandKit, ...objectOr(source.brandKit) },
    assets: arrayOr(source.assets, fallback.assets),
    projects: arrayOr(source.projects, fallback.projects),
    tasks: arrayOr(source.tasks, fallback.tasks),
    exports: arrayOr(source.exports, fallback.exports),
    creditLedger: arrayOr(source.creditLedger, fallback.creditLedger),
    creditReservations: arrayOr(source.creditReservations, fallback.creditReservations),
    creditReservationLedger: arrayOr(source.creditReservationLedger, fallback.creditReservationLedger),
    notifications: arrayOr(source.notifications, fallback.notifications),
    customSkills: arrayOr(source.customSkills, fallback.customSkills)
  };
}

function numericCredit(value, fallback = 0) {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? Math.max(0, Math.trunc(numberValue)) : fallback;
}

function creditWalletFromState(state) {
  const workspace = objectOr(state?.workspace);
  return createCreditWallet({
    id: workspace.id || "workspace_default",
    available: numericCredit(workspace.credits),
    reserved: numericCredit(workspace.reservedCredits),
    openingBalance: workspace.creditOpeningBalance,
    reservations: arrayOr(state?.creditReservations),
    ledger: arrayOr(state?.creditReservationLedger)
  });
}

function creditReservationIdFor(task, options = {}) {
  return options.reservationId || (task?.id || makeId("task")) + ":" + (options.reason || "generation");
}

function applyCreditWalletToState(state, wallet) {
  return {
    ...state,
    workspace: {
      ...state.workspace,
      credits: wallet.available,
      reservedCredits: wallet.reserved,
      creditOpeningBalance: wallet.openingBalance
    },
    creditReservations: wallet.reservations,
    creditReservationLedger: wallet.ledger
  };
}

function displayCreditEntry({ task, label, amount, type, reservationId }) {
  return {
    id: makeId("credit"),
    type,
    amount,
    label,
    reservationId,
    taskId: task?.id || null,
    createdAt: now()
  };
}

function hasDisplayCreditEntry(state, reservationId, type) {
  return arrayOr(state?.creditLedger).some(entry => entry?.reservationId === reservationId && entry?.type === type);
}

export function reserveTaskCreditsInState(state, task, options = {}) {
  const reserveAmount = numericCredit(options.reserveAmount, numericCredit(task?.credits?.estimated, numericCredit(task?.credits?.actual)));
  if (reserveAmount <= 0) return state;

  const reservationId = creditReservationIdFor(task, options);
  const wallet = creditWalletFromState(state);
  const reserved = reserveCredits(wallet, {
    amount: reserveAmount,
    reservationId,
    idempotencyKey: "reserve:" + reservationId,
    referenceId: options.referenceId || task?.id || null,
    priceCatalogVersion: options.priceCatalogVersion || "demo-v1",
    metadata: { reason: options.reason || "generation" }
  });

  return applyCreditWalletToState(state, reserved.wallet);
}

export function settleTaskCreditsInState(state, task, options = {}) {
  const reserveAmount = numericCredit(options.reserveAmount, numericCredit(task?.credits?.estimated, numericCredit(task?.credits?.actual)));
  if (reserveAmount <= 0) return state;

  const actualAmount = numericCredit(options.actualAmount, numericCredit(task?.credits?.actual));
  const reservationId = creditReservationIdFor(task, options);
  const wallet = creditWalletFromState(state);
  const hasReservation = wallet.reservations.some(reservation => reservation.id === reservationId);
  if (!hasReservation) {
    throw new CreditAccountingError(
      "RESERVATION_REQUIRED",
      "Cannot settle task credits before an active reservation exists.",
      { walletId: wallet.id, reservationId, taskId: task?.id || null }
    );
  }
  const shouldRelease = options.release === true || task?.status === TASK_STATUS.failed;
  const final = shouldRelease
    ? releaseReservation(wallet, reservationId, { idempotencyKey: "release:" + reservationId })
    : settleReservation(wallet, reservationId, {
        actualAmount,
        idempotencyKey: "settle:" + reservationId
      });
  const displayAmount = shouldRelease ? 0 : -final.settledAmount;
  const displayType = shouldRelease ? "release" : "consume";
  const displayLabel = options.label || (shouldRelease ? "Task reservation released" : "Task generation settled");
  const nextState = applyCreditWalletToState(state, final.wallet);

  if (final.idempotent || hasDisplayCreditEntry(state, reservationId, displayType)) return nextState;

  return {
    ...nextState,
    creditLedger: [
      displayCreditEntry({
        task,
        label: displayLabel,
        amount: displayAmount,
        type: displayType,
        reservationId
      }),
      ...arrayOr(state.creditLedger)
    ]
  };
}

export function removeAssetFromState(state, assetId) {
  if (!state || typeof state !== "object") return state;
  const assets = arrayOr(state.assets);
  if (!assetId || !assets.some(asset => asset?.id === assetId)) {
    return assets === state.assets ? state : { ...state, assets };
  }
  return { ...state, assets: assets.filter(asset => asset?.id !== assetId) };
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
  // 跨境平台：仅匹配清晰 token，避开 ig/yt/ins 等过短易误命中的缩写（如 "design" 含 "ig"）。
  if (lower.includes("reels") || lower.includes("instagram")) {
    return "Instagram Reels";
  }
  if (lower.includes("shorts") || lower.includes("youtube")) {
    return "YouTube Shorts";
  }
  if (lower.includes("shopify") || lower.includes("pdp") || text.includes("独立站")) {
    return "Shopify PDP";
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

export function runCreativeWorkflow({ brief, skillId, brandKit = defaultBrandKit, variantCount }) {
  return runCreativeWorkflowWithSkill({ brief, skill: findSkill(skillId), brandKit, variantCount });
}

// PLAN 相：构造尚未执行的 queued task 骨架（全 agent queued，variants/qa/exports 留空，credits.actual=0）。
// 与 DRIVE 分离，让失败/重试/未来真异步执行有可注入的 seam，而非一次性同步全产。
export function planCreativeTask({ brief, skill, brandKit = defaultBrandKit, variantCount } = {}) {
  const normalizedBrief = normalizeBrief(brief);
  const credits = estimateCreditsForSkill(normalizedBrief, skill);
  const taskId = makeId("task");
  const queuedAgents = skill.agents.map((agentId, index) => {
    const agent = agents.find(item => item.id === agentId);
    return buildAgentStep(agent, normalizedBrief, skill, brandKit, index, { status: TASK_STATUS.queued });
  });
  const ts = now();
  return {
    id: taskId,
    status: TASK_STATUS.queued,
    skillId: skill.id,
    skillName: skill.name,
    brief: normalizedBrief,
    orchestrator: buildOrchestratorRecord(skill, normalizedBrief),
    agents: queuedAgents,
    events: [],
    variants: [],
    qa: null,
    artifacts: [],
    credits: { ...credits, actual: 0 },
    exports: [],
    createdAt: ts,
    updatedAt: ts
  };
}

// 默认同步执行器：把一个 queued 步推进为 completed（计算 summary/artifact/duration/时间戳）。
// queuedAt 沿用 plan 相写入，startedAt/finishedAt 取执行时刻——失败/异步执行器(T3+)替换此 seam。
function defaultAgentExecutor(step, { brief, skill, brandKit, index }) {
  const finishedAt = now();
  return {
    ...step,
    status: TASK_STATUS.completed,
    progress: 100,
    startedAt: step.startedAt || step.queuedAt || finishedAt,
    finishedAt,
    completedAt: finishedAt,
    duration: String((index + 1) * 7 + 8) + "s",
    summary: buildAgentSummary(step.id, brief, brandKit),
    artifact: buildAgentArtifact(step.id, brief, skill),
    error: null
  };
}

// 把一个步标记为失败：脱敏 error（原始报错可能含 token/url），归零 progress，记 finishedAt。
function markAgentFailed(step, error) {
  const finishedAt = now();
  return {
    ...step,
    status: TASK_STATUS.failed,
    progress: 0,
    startedAt: step.startedAt || step.queuedAt || finishedAt,
    finishedAt,
    error: sanitizeArtifactError(error)
  };
}

// DRIVE 相：按 skill.agents 顺序（flowToSkill 已 topo 排序 → 顺序即拓扑序）逐个执行，
// 实时追加 agent_completed 事件，再算 variants/qa/artifacts/exports（保留节点存在性门控），结算 status。
// executor 为可注入 seam；本相不感知 flow.mode，三模式同构由此保持。
// 失败一等公民：executor throw → 标该步 failed（脱敏 error），其后步留 queued（sequential 拓扑下皆下游），
// task 落 failed 但仍组装 exports/qa（只消费 ready artifacts），失败不致整单丢产物。
export function driveCreativeTask(plannedTask, { skill, brandKit = defaultBrandKit, variantCount, executor = defaultAgentExecutor } = {}) {
  const brief = plannedTask.brief;
  const total = Math.max(1, plannedTask.agents.length);
  const events = [];
  const ranAgents = [];
  let anyFailed = false;
  plannedTask.agents.forEach((step, index) => {
    if (anyFailed) {
      // 上游已失败 → 下游不启动，保持 queued 占位
      ranAgents.push(step);
      return;
    }
    try {
      const completed = executor(step, { brief, skill, brandKit, index });
      ranAgents.push(completed);
      events.push({
        id: makeId("event"),
        event: "agent_completed",
        agentId: completed.id,
        agent: completed.name,
        progress: Math.round(((index + 1) / total) * 100),
        message: completed.output + " completed.",
        credits: completed.cost,
        createdAt: completed.completedAt || now()
      });
    } catch (error) {
      const failedStep = markAgentFailed(step, error);
      ranAgents.push(failedStep);
      events.push({
        id: makeId("event"),
        event: "agent_failed",
        agentId: failedStep.id,
        agent: failedStep.name,
        progress: 0,
        message: (failedStep.output || failedStep.name) + " failed: " + failedStep.error,
        credits: 0,
        createdAt: failedStep.finishedAt
      });
      anyFailed = true;
    }
  });
  // variantCount 透传（undefined → buildVariants 默认 3，向后兼容）。
  const variants = buildVariants(brief, brandKit, skill, variantCount)
    .map(variant => refreshVariantArtifacts(brief, variant, skill));
  // 节点/Agent 存在性真实影响交付物：编排了 qa 节点才质检，编排了 export 节点才打包。门控对预设/合成 skill 一致。
  const qa = skill.agents.includes("qa")
    ? buildQaReport(brief, variants, brandKit, skill)
    : buildSkippedQa(variants);
  const taskArtifacts = buildTaskArtifacts(qa, plannedTask.id);
  return {
    ...plannedTask,
    status: anyFailed ? TASK_STATUS.failed : TASK_STATUS.completed,
    agents: ranAgents,
    events,
    variants,
    qa,
    artifacts: taskArtifacts,
    credits: {
      ...plannedTask.credits,
      actual: Math.max(24, Math.round(plannedTask.credits.estimated * 0.94))
    },
    exports: skill.agents.includes("export") ? buildExports(brief, variants, skill, taskArtifacts) : [],
    updatedAt: now()
  };
}

// 用显式 skill 对象执行编排管线。预设 skill 与 Flow 编排图合成的临时 skill 走同一入口，
// 因此自动 / 半自动 / 手动三种模式产出的 task 结构、评分、事件、导出契约完全一致——
// 这是「三模式只是同一个 Flow 的不同创作方式」在执行层的落点。
// 同步 run-to-completion 包装器：plan → drive，保持既有调用方拿到「成品 task」的契约。
export function runCreativeWorkflowWithSkill({ brief, skill, brandKit = defaultBrandKit, variantCount }) {
  const planned = planCreativeTask({ brief, skill, brandKit, variantCount });
  return driveCreativeTask(planned, { skill, brandKit, variantCount });
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

export function canEditTask(task) {
  return Boolean(task && !task.locked);
}

export function setTaskLocked(state, taskId, locked = true) {
  const nextLocked = Boolean(locked);
  return {
    ...state,
    tasks: (state.tasks || []).map(task =>
      task.id === taskId
        ? {
            ...task,
            locked: nextLocked,
            updatedAt: now()
          }
        : task
    ),
    projects: (state.projects || []).map(project =>
      project.taskId === taskId
        ? {
            ...project,
            locked: nextLocked,
            updatedAt: now()
          }
        : project
    )
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

export function buildExportRecord(project, variant, platform = "抖音", { brief, taskArtifacts = [] } = {}) {
  // 与 auto 路径 buildExports 对齐：优先用真实 brief（保证 copy/note 文案一致），并带上 taskArtifacts（含 qa-report.json）。
  const effectiveBrief = brief || { productName: project.name, platform };
  const files = buildExportFiles({ brief: effectiveBrief, variant, skill: findSkill(project.skillId), taskArtifacts });
  return {
    id: makeId("export"),
    projectName: project.name,
    projectId: project.id,
    variantId: variant.id,
    name: `${project.name} / ${variant.name}`,
    platform,
    files,
    fileNames: files.map(file => file.name),
    artifactSummary: summarizeExportFiles(files),
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

// 真实度量钩子吸引力，替代既有 `82 + boost + index` 的假分。
// 从 80 floor 起按「钩子是否具备可识别的高吸引力特征」加分，上限 99：
//   数字 / 问句 / 紧迫·行动词 / 好奇·反差词 / 痛点词 / 精炼（≤ 平台 hookMaxChars+缓冲）。
// 空钩子返回 0（无内容不该得分）；非空恒 >= 80，守住既有 `qa.overallScore >= 80` 不变量。
// 纯函数、可单测，是「QA 真正评估吸引力」的落点（替代从不浮动的占位分）。
export function scoreHookStrength(hook, preset) {
  const text = String(hook || "").trim();
  if (!text) return 0;
  let score = 80;
  if (/[0-9０-９]/.test(text)) score += 4; // 具体数字
  if (/[？?]/.test(text)) score += 3; // 问句 / 好奇
  if (/(限时|马上|现在|错过|别|趁|抢|今天|仅|快)/.test(text)) score += 4; // 紧迫 / 行动
  if (/(最|没人|多数人|忽略|秘密|真相|为什么|居然|竟然|原来)/.test(text)) score += 4; // 好奇 / 反差
  if (/(痛|烦|愁|头疼|踩坑|难|累)/.test(text)) score += 3; // 痛点
  const max = preset?.copyRules?.hookMaxChars;
  if (max && Array.from(text).length <= max + 8) score += 2; // 精炼度（首屏可读）
  return Math.min(99, score);
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

// status 默认 completed，保持同步管线（runCreativeWorkflowWithSkill）的向后兼容；
// T2 的 plan 相会以 status=queued 调用，产出未执行的占位步。生命周期字段一律附带（加法）。
function buildAgentStep(agent, brief, skill, brandKit, index, { status = TASK_STATUS.completed } = {}) {
  const ts = now();
  const base = {
    ...agent,
    status,
    retryCount: 0,
    error: null,
    ...lifecycleTimestamps(status, ts)
  };
  if (status === TASK_STATUS.queued) {
    // 占位步：尚未执行，无 duration/completedAt/summary/artifact（drive 相填）。
    return { ...base, progress: 0 };
  }
  return {
    ...base,
    progress: 100,
    duration: String((index + 1) * 7 + 8) + "s",
    completedAt: ts,
    summary: buildAgentSummary(agent.id, brief, brandKit),
    artifact: buildAgentArtifact(agent.id, brief, skill)
  };
}

function buildAgentArtifact(agentId, brief, skill) {
  const artifacts = {
    brief: "Brief: " + brief.productName + " / " + brief.platform + " / " + brief.targetAudience,
    strategy: "Strategy: " + brief.goal + " with " + brief.style,
    script: skill.agents.includes("video") ? "Scripts: 3 video ad variants" : "Scripts: image-first content outline",
    storyboard: skill.agents.includes("video") ? "Storyboard: 5 timed shots" : "Storyboard: cover + note sections",
    trend: "Trend: 平台热点选题角度 + 切入建议",
    persona: "Persona: 真人创作者口吻指引",
    seo: "SEO: 核心关键词 + 标签策略",
    hook: "Hook pack: 多候选钩子 + 最强项已选",
    visual: "Visual: " + brief.style + " cover and product scenes",
    video: "Video: " + brief.platform + " " + findPlatformPreset(brief.platform).ratio + " content simulation",
    copy: "Copy package: title, caption, hashtags, CTA",
    qa: "QA report: quality score, compliance, platform fit",
    export: "Export manifest: " + exportFilesFor(skill).join(", ")
  };
  return artifacts[agentId] || "Agent artifact recorded";
}

// 重试一个（通常是 failed 的）agent：走 running→completed|failed 生命周期，而非无条件落 completed。
// executor 可注入（AI 路径让重试仍可能失败）；默认执行器同步完成（无 skill 依赖，刷新产物）。
// 契约：恰好一次 agent_retried 事件 + 恰好一次 credits.actual += cost（无论成败，扣的是「这次尝试」）。
// 成功则解封后续被阻塞的 queued 步（同步 mock 下必成功）；失败则下游仍 queued。最后据 agent 集合重新结算 task.status。
export function retryAgentStep(task, agentId, { executor } = {}) {
  const index = task.agents.findIndex(agent => agent.id === agentId);
  if (index < 0) throw new Error("Agent not found: " + agentId);

  const currentAgent = task.agents[index];
  const retryCount = (currentAgent.retryCount || 0) + 1;
  const cost = currentAgent.cost || agents.find(agent => agent.id === agentId)?.cost || 8;
  const ts = now();

  const completeRetry = step => ({
    ...step,
    status: TASK_STATUS.completed,
    progress: 100,
    startedAt: ts,
    finishedAt: ts,
    completedAt: ts,
    duration: String(Number.parseInt(step.duration, 10) || 12) + "s · retry " + retryCount,
    summary: step.title + " 已按当前 Brief 重新执行，结构化产物已刷新。",
    artifact: step.output + " · retry " + retryCount,
    error: null
  });

  let retriedAgent;
  let retryFailed = false;
  const runningStep = { ...currentAgent, status: TASK_STATUS.running, startedAt: ts, error: null };
  try {
    const result = executor ? executor(runningStep, { brief: task.brief, index }) : completeRetry(runningStep);
    retriedAgent = { ...result, retryCount };
  } catch (error) {
    retriedAgent = { ...markAgentFailed({ ...currentAgent, startedAt: ts }, error), retryCount };
    retryFailed = true;
  }

  // 成功重试解封后续 queued 步（这些步此前因上游失败被跳过，同步 mock 下可直接完成）；失败则保持 queued。
  const nextAgents = task.agents.map((agent, position) => {
    if (agent.id === agentId) return retriedAgent;
    if (!retryFailed && position > index && agent.status === TASK_STATUS.queued) return completeRetry(agent);
    return agent;
  });

  const settledStatus = nextAgents.some(agent => agent.status === TASK_STATUS.failed)
    ? TASK_STATUS.failed
    : nextAgents.every(agent => agent.status === TASK_STATUS.completed)
      ? TASK_STATUS.completed
      : task.status;

  const retryEvent = {
    id: makeId("event"),
    event: "agent_retried",
    agentId,
    agent: currentAgent.name,
    progress: retryFailed ? 0 : 100,
    message: retryFailed
      ? currentAgent.name + " retry failed: " + retriedAgent.error
      : currentAgent.name + " retried successfully.",
    credits: cost,
    createdAt: ts
  };

  return {
    cost,
    task: {
      ...task,
      status: settledStatus,
      updatedAt: ts,
      agents: nextAgents,
      events: [...(task.events || []), retryEvent],
      credits: {
        ...task.credits,
        actual: task.credits.actual + cost
      }
    }
  };
}

// 启动调和：同步 in-process 执行下，持久化态仍为 running/queued 的 task 必是被 reload 打断的孤儿，
// 翻成 failed(标记 interrupted)，避免 UI 永久卡在「运行中」。running agent → failed，queued agent 原样留存。
// 纯函数：加载快照后施用。无孤儿则返回同一引用（避免无谓 re-render churn）。
export function reconcileInterruptedTasks(state) {
  if (!state || !Array.isArray(state.tasks)) return state;
  let changed = false;
  const tasks = state.tasks.map(task => {
    if (!task || (task.status !== TASK_STATUS.running && task.status !== TASK_STATUS.queued)) return task;
    changed = true;
    const agents = Array.isArray(task.agents)
      ? task.agents.map(agent => (agent && agent.status === TASK_STATUS.running
          ? { ...agent, status: TASK_STATUS.failed, error: agent.error || "运行被中断（页面刷新或重载）" }
          : agent))
      : task.agents;
    return { ...task, status: TASK_STATUS.failed, interrupted: true, agents };
  });
  return changed ? { ...state, tasks } : state;
}

function buildAgentSummary(agentId, brief, brandKit) {
  const preset = findPlatformPreset(brief.platform);
  const summaries = {
    brief: `已结构化 ${brief.productName} 的目标、受众、平台和卖点。`,
    strategy: `主轴：${brief.goal}；面向 ${brief.targetAudience} 强化首 ${preset.hookSeconds} 秒 Hook。`,
    script: `生成 3 个脚本方向：痛点开场、场景反差、促销冲刺。`,
    storyboard: `拆成 5 个镜头，保持产品露出和 CTA。`,
    trend: `扫描 ${brief.platform} 当下热点，为 ${brief.productName} 选出高流量选题角度。`,
    persona: `把文案调成面向 ${brief.targetAudience} 的真人创作者口吻，去 AI 腔。`,
    seo: `为 ${brief.platform} 搜索流量提取核心关键词与标签策略。`,
    hook: `生成多个候选钩子并选最强：套用平台框架强化首 ${preset.hookSeconds}s 停留。`,
    visual: `套用 ${brandKit.name} 色彩和 ${brief.style} 视觉语言。`,
    video: `模拟 15 秒${preset.ratio === "1:1" ? "方形" : "竖版"}内容，适配 ${brief.platform}。`,
    copy: `生成标题、Caption、Hashtag 和 CTA。`,
    qa: `检查品牌一致性、平台适配和违规词。`,
    export: `打包 ${preset.ratio} 主视觉、封面 PNG、文案 Markdown。`
  };
  return summaries[agentId] || "完成工作流步骤。";
}

function buildVariants(brief, brandKit, skill, count = 3) {
  const preset = findPlatformPreset(brief.platform);
  const hasVideo = isVideoSkill(skill);
  // 3 个角度各映射一种公认钩子框架（PAS 痛点 / 好奇缺口 / 紧迫促销），
  // 让兜底文案也"有套路"而非泛词。CTA 优先取平台原生范例（preset.copyRules.ctaExamples），
  // 缺省回退角度默认值——确定性路径也产出 zh-native、平台贴合的 CTA。
  const angles = [
    {
      name: "痛点直击",
      hook: `${brief.targetAudience}最头疼的问题，${brief.productName} 一招解决，别再用老办法硬扛。`,
      angle: "痛点开场",
      cta: "点链接马上试试",
      scoreBoost: 0
    },
    {
      name: "好奇缺口",
      hook: `买${brief.productCategory}多数人忽略了一个关键细节——看完你就懂为什么是 ${brief.productName}。`,
      angle: "好奇缺口",
      cta: "往下看别划走",
      scoreBoost: 3
    },
    {
      name: "限时冲刺",
      hook: `${brief.promotion}！趁这波把 ${brief.productName} 的好处一次讲清，错过再等一年。`,
      angle: "促销冲刺",
      cta: "现在下单最划算",
      scoreBoost: 1
    },
    // 角度 4-6：扩量时启用（默认 3 不取用，前 3 个逐字不变以守既有断言）。
    // angle 值取自 HOOK_FRAMEWORKS（社会证明/具体数字/反共识）→ renderAngleFramework 自动锁框架。
    {
      name: "口碑背书",
      hook: `已经有一堆${brief.targetAudience}回购 ${brief.productName}，看看他们的真实反馈再决定。`,
      angle: "社会证明",
      cta: "看看大家怎么说",
      scoreBoost: 2
    },
    {
      name: "数据说话",
      hook: `${brief.productName} 凭什么火？3 个硬数据让你一眼看懂到底值不值。`,
      angle: "具体数字",
      cta: "数据都摆这了",
      scoreBoost: 2
    },
    {
      name: "反差对比",
      hook: `别人家的${brief.productCategory} vs ${brief.productName}，用过才知道差距有多离谱。`,
      angle: "反共识",
      cta: "对比一下就懂",
      scoreBoost: 1
    }
  ];

  // 变体数：默认 3（向后兼容，既有 variants===3 / exports===3 契约不破）；clamp 到 [1, 角度池上限]。
  const n = Math.max(1, Math.min(Math.round(count) || 3, angles.length));

  return angles.slice(0, n).map((item, index) => {
    // CTA 优先取平台原生范例（T1 copyRules.ctaExamples），缺省回退角度默认 —— 确定性兜底也 zh-native。
    const cta = preset.copyRules?.ctaExamples?.[index] || item.cta;
    const angleWithCta = { ...item, cta };
    const metrics = {
      briefMatch: 86 + index * 2,
      productVisibility: 88 - index,
      // 真打分：钩子吸引力随钩子内容浮动（不再是 82+index 占位），守 >=80 floor。
      hookStrength: Math.min(99, scoreHookStrength(item.hook, preset) + item.scoreBoost),
      visualQuality: 84 + index * 3,
      brandConsistency: 90,
      platformFit: preset.platformFit,
      compliance: 94
    };
    return {
      id: makeId("variant"),
      version: 1,
      name: item.name,
      // A/B 标记：每个变体一个测试臂标签（A/B/C…），供前端 A/B pack 对比展示。
      abLabel: String.fromCharCode(65 + index),
      angle: item.angle,
      hook: item.hook,
      caption: `${brief.productName}，专为${brief.targetAudience}打造：${brief.sellingPoints}。`,
      hashtags: ["#AICrewStudio", "#ProductAd", `#${brief.platform.replace(/\s+/g, "")}`],
      cta,
      duration: hasVideo ? 15 : null,
      aspectRatio: preset.ratio,
      score: calculateQualityScore(metrics),
      palette: skill.palette,
      brand: brandKit.name,
      timeline: hasVideo ? buildStoryboard(brief, angleWithCta) : buildNoteStructure(brief, angleWithCta),
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
function imageArtifactForVariant(variant) {
  const current = (variant?.artifacts || []).find(artifact => artifact.type === "image");
  if (variant?.imageUrl) {
    return createReadyArtifact({
      scopeId: variant.id,
      type: "image",
      name: "cover.png",
      mimeType: "image/png",
      url: variant.imageUrl,
      refKey: variantImageRefKey(variant.id),
      source: "generated",
      variantId: variant.id,
      agentId: "visual"
    });
  }
  if (current?.status === "failed" || current?.status === "deferred") return current;
  return createDeferredArtifact({
    scopeId: variant?.id,
    type: "image",
    name: "cover.png",
    mimeType: "image/png",
    refKey: variant?.id ? variantImageRefKey(variant.id) : undefined,
    source: "generated",
    variantId: variant?.id,
    agentId: "visual",
    reason: "封面图尚未生成"
  });
}

function videoArtifactForVariant(variant, skill) {
  if (!isVideoSkill(skill)) return null;
  return createDeferredArtifact({
    scopeId: variant?.id,
    type: "video",
    name: "video.mp4",
    mimeType: "video/mp4",
    source: "deferred",
    variantId: variant?.id,
    agentId: "video",
    reason: "视频生成引擎尚未接入，本 sprint 不生成 MP4"
  });
}

function variantTextArtifacts(brief, variant, skill) {
  const common = { scopeId: variant.id, variantId: variant.id, source: "generated" };
  const copy = createReadyArtifact({
    ...common,
    type: "text",
    name: "copy.md",
    mimeType: "text/markdown",
    agentId: "copy",
    content: renderCopyMarkdown(brief, variant)
  });
  const structure = isVideoSkill(skill)
    ? createReadyArtifact({
        ...common,
        type: "document",
        name: "storyboard.csv",
        mimeType: "text/csv",
        agentId: "storyboard",
        content: renderStoryboardCsv(variant)
      })
    : createReadyArtifact({
        ...common,
        type: "document",
        name: "note.md",
        mimeType: "text/markdown",
        agentId: "storyboard",
        content: renderNoteMarkdown(brief, variant)
      });
  const hashtags = createReadyArtifact({
    ...common,
    type: "text",
    name: "hashtags.txt",
    mimeType: "text/plain",
    agentId: "copy",
    content: (variant?.hashtags || []).join("\n")
  });
  return [copy, structure, hashtags];
}

export function refreshVariantArtifacts(brief, variant, skill) {
  if (!variant) return variant;
  return {
    ...variant,
    artifacts: [
      ...(videoArtifactForVariant(variant, skill) ? [videoArtifactForVariant(variant, skill)] : []),
      imageArtifactForVariant(variant),
      ...variantTextArtifacts(brief, variant, skill)
    ]
  };
}

function buildTaskArtifacts(qa, taskId) {
  if (qa?.skipped) {
    return [createDeferredArtifact({
      scopeId: taskId,
      taskId,
      type: "document",
      name: "qa-report.json",
      mimeType: "application/json",
      source: "deferred",
      agentId: "qa",
      reason: qa.recommendation || "未编排 QA 节点"
    })];
  }
  return [createReadyArtifact({
    scopeId: taskId,
    taskId,
    type: "document",
    name: "qa-report.json",
    mimeType: "application/json",
    source: "generated",
    agentId: "qa",
    content: JSON.stringify(qa, null, 2)
  })];
}

// 把导出清单从「纯文件名」升级为「带真实内容/引用的描述符」。
// - 图文文件（copy.md / note.md / hashtags.txt / storyboard.csv）内联确定性 content，前端可即时 Blob 下载。
// - cover.png 绑定 variant 的图像：有 imageUrl → source=variantImage（下载层取真实图），否则 placeholder。
// - video.mp4 始终 kind=placeholder（本期不生成视频二进制，守护硬约束）。
// 文件顺序与 exportFilesFor 一致，保持既有 UI/测试对 name 的预期。
function exportFileFromArtifact(artifact) {
  const kind = artifact.type === "image" ? "image" : artifact.type === "video" ? "video" : "text";
  return {
    artifactId: artifact.id,
    name: artifact.name,
    mimeType: artifact.mimeType,
    kind,
    type: artifact.type,
    status: artifact.status,
    source: artifact.source,
    ...(artifact.content ? { content: artifact.content } : {}),
    ...(artifact.url ? { url: artifact.url } : {}),
    ...(artifact.refKey ? { refKey: artifact.refKey } : {}),
    ...(artifact.error ? { error: artifact.error } : {}),
    ...(artifact.reason ? { reason: artifact.reason } : {}),
    downloadable: isDownloadableArtifact(artifact)
  };
}

function artifactByName(artifacts) {
  return new Map((artifacts || []).map(artifact => [artifact.name, artifact]));
}

export function buildExportFiles({ brief, variant, skill, taskArtifacts = [] }) {
  const normalized = refreshVariantArtifacts(brief, variant, skill);
  const artifacts = [...(normalized?.artifacts || []), ...(taskArtifacts || [])];
  const byName = artifactByName(artifacts);
  const orderedNames = [...exportFilesFor(skill), "qa-report.json"].filter((name, index, arr) => arr.indexOf(name) === index);
  return orderedNames
    .map(name => byName.get(name))
    .filter(Boolean)
    .map(exportFileFromArtifact);
}

function summarizeExportFiles(files) {
  return (files || []).reduce(
    (summary, file) => ({ ...summary, [file.status]: (summary[file.status] || 0) + 1 }),
    { ready: 0, failed: 0, deferred: 0 }
  );
}

function buildExports(brief, variants, skill, taskArtifacts = []) {
  return variants.map(variant => {
    const files = buildExportFiles({ brief, variant, skill, taskArtifacts });
    return {
      name: `${brief.productName} / ${variant.name}`,
      platform: brief.platform,
      variantId: variant.id,
      files,
      // 向后兼容：旧消费方按文件名读取 export.files 字符串数组的能力，迁移到 fileNames。
      fileNames: files.map(file => file.name),
      artifactSummary: summarizeExportFiles(files)
    };
  });
}

export function rebuildTaskExports(task, skill = findSkill(task?.skillId)) {
  if (!task || !skill?.agents?.includes("export")) return [];
  return buildExports(task.brief, task.variants || [], skill, task.artifacts || []);
}
