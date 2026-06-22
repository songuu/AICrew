"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildExportRecord,
  createAsset,
  createInitialState,
  createProjectFromTask,
  makeId,
  modelRoutes,
  normalizeBrief,
  parseBriefText,
  platformPresets,
  reviseVariantHook,
  runCreativeWorkflow,
  saveSkillFromProject,
  skills
} from "./domain.js";
import {
  AI_PROVIDERS,
  defaultAiConfig,
  isAiConfigured,
  loadAiConfig,
  saveAiConfig,
  clearAiConfig,
  validateAiConfig
} from "./ai/config.js";
import { testConnection } from "./ai/providers.js";
import { runCreativeWorkflowWithAI } from "./ai/workflow.js";

const storageKey = "aicrew-studio-next-state-v1";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "/aicrew";

const navItems = [
  ["dashboard", "Dashboard", "◎"],
  ["workbench", "Workbench", "▣"],
  ["projects", "Projects", "▤"],
  ["assets", "Assets", "◫"],
  ["skills", "Skills", "✦"],
  ["brand", "Brand Kit", "◈"],
  ["exports", "Exports", "⇩"],
  ["billing", "Billing", "$"],
  ["admin", "Admin", "⌁"],
  ["settings", "AI 接入", "⚙"]
];

const metricLabels = {
  briefMatch: "Brief match",
  productVisibility: "Product",
  hookStrength: "Hook",
  visualQuality: "Visual",
  brandConsistency: "Brand",
  platformFit: "Platform",
  compliance: "Compliance"
};

const routeTitles = {
  dashboard: "创作总控台",
  workbench: "AI 创作工作台",
  projects: "项目",
  assets: "素材库",
  skills: "Skill 模板库",
  brand: "品牌记忆",
  exports: "导出中心",
  billing: "计费与积分",
  admin: "运营后台",
  settings: "AI 接入",
  onboarding: "Onboarding",
  login: "Login",
  signup: "Signup"
};

function hrefFor(view) {
  return view === "dashboard" ? `${basePath}/` : `${basePath}/${view}/`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function qualityTone(score) {
  if (score >= 88) return "great";
  if (score >= 78) return "good";
  return "warn";
}

function readState() {
  try {
    const saved = window.localStorage.getItem(storageKey);
    return saved ? JSON.parse(saved) : createInitialState();
  } catch {
    return createInitialState();
  }
}

// 持久化前剥离 variant.imageUrl：AI 封面（base64 data URL）可能很大且属生成态，
// 不写入主 blob 可避免 localStorage 配额溢出与图像引用的留存。图仅存于当前会话内存。
function stripVariantMedia(variant) {
  if (!variant || !variant.imageUrl) return variant;
  const { imageUrl, ...rest } = variant;
  return rest;
}

function sanitizeStateForStorage(state) {
  const stripList = list =>
    (list || []).map(item => (item?.variants ? { ...item, variants: item.variants.map(stripVariantMedia) } : item));
  return { ...state, tasks: stripList(state.tasks), projects: stripList(state.projects) };
}

export function AICrewStudio({ initialView = "dashboard" }) {
  const [state, setState] = useState(null);
  const [view, setView] = useState(initialView);
  const [selectedVariantId, setSelectedVariantId] = useState(null);
  // AI 配置独立于主 state：token 只存自己的 localStorage key，绝不进 state blob（防 reset/导出泄漏）。
  const [aiConfig, setAiConfig] = useState(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    const nextState = readState();
    setState(nextState);
    setSelectedVariantId(nextState.tasks?.[0]?.variants?.[0]?.id || null);
    setAiConfig(loadAiConfig());
  }, []);

  useEffect(() => {
    if (!state) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(sanitizeStateForStorage(state)));
    } catch {
      // 配额超限/序列化失败时静默降级：内存态不受影响，仅本次不落盘。
    }
  }, [state]);

  const task = state?.tasks?.[0];
  const project = state?.projects?.[0];
  const allSkills = useMemo(() => [...skills, ...(state?.customSkills || [])], [state]);
  const activeVariant = task?.variants.find(item => item.id === selectedVariantId) || task?.variants?.[0];

  function navigate(nextView) {
    setView(nextView);
    window.history.pushState(null, "", hrefFor(nextView));
  }

  function commitGeneratedTask(nextTask, projectName, creditLabel) {
    setState(current => {
      const nextProject = createProjectFromTask(nextTask, projectName);
      return {
        ...current,
        tasks: [nextTask, ...current.tasks],
        projects: [nextProject, ...current.projects],
        exports: [
          ...nextTask.exports.map(item => ({
            ...item,
            id: makeId("export"),
            projectId: nextProject.id,
            projectName: nextProject.name,
            createdAt: new Date().toISOString()
          })),
          ...current.exports
        ],
        workspace: {
          ...current.workspace,
          credits: Math.max(0, current.workspace.credits - nextTask.credits.actual)
        },
        creditLedger: [
          {
            id: makeId("credit"),
            type: "consume",
            amount: -nextTask.credits.actual,
            label: creditLabel,
            createdAt: new Date().toISOString()
          },
          ...current.creditLedger
        ],
        notifications: [
          {
            id: makeId("notice"),
            level: "success",
            title: `${nextTask.brief.productName} 内容包已生成${
              nextTask.aiMeta?.used ? `（${nextTask.aiMeta.provider} AI）` : ""
            }`,
            createdAt: new Date().toISOString()
          },
          ...current.notifications
        ]
      };
    });
    setSelectedVariantId(nextTask.variants[0]?.id || null);
    navigate("workbench");
  }

  // 已配置 AI → 走真实 LLM（+OpenAI 封面图）；否则回退确定性模拟。
  // runCreativeWorkflowWithAI 内部已兜底，不会抛错；仍以 try/finally 保证 generating 复位。
  async function runAndCommit(brief, skillId, projectName, creditLabel) {
    setGenerating(true);
    try {
      const nextTask = isAiConfigured(aiConfig)
        ? await runCreativeWorkflowWithAI({ brief, skillId, brandKit: state.brandKit, aiConfig })
        : runCreativeWorkflow({ brief, skillId, brandKit: state.brandKit });
      commitGeneratedTask(nextTask, projectName, creditLabel);
    } finally {
      setGenerating(false);
    }
  }

  function generateFromBrief(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const brief = normalizeBrief(data);
    runAndCommit(
      brief,
      data.skillId || "ecom_tiktok_product_ad_v1",
      `${brief.productName} ${brief.platform} launch`,
      `${brief.productName} generation`
    );
  }

  function generateQuick(event) {
    event.preventDefault();
    const text = new FormData(event.currentTarget).get("briefText");
    const brief = parseBriefText(text);
    runAndCommit(brief, "ecom_tiktok_product_ad_v1", `${brief.productName} quick campaign`, `${brief.productName} quick generation`);
  }

  function saveAi(config) {
    saveAiConfig(config); // 校验失败会抛错，由面板捕获展示
    setAiConfig(loadAiConfig());
  }

  function clearAi() {
    clearAiConfig();
    setAiConfig(null);
  }

  function updateBrand(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    setState(current => ({
      ...current,
      brandKit: {
        ...current.brandKit,
        name: data.name,
        slogan: data.slogan,
        voice: data.voice,
        forbiddenWords: data.forbiddenWords.split(",").map(item => item.trim()).filter(Boolean)
      }
    }));
  }

  function updateProfile(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    setState(current => ({
      ...current,
      currentUser: {
        ...current.currentUser,
        name: data.name,
        email: data.email
      },
      workspace: {
        ...current.workspace,
        name: data.workspace
      }
    }));
  }

  function reviseHook(event) {
    event.preventDefault();
    if (!task || !activeVariant) return;
    const instruction = new FormData(event.currentTarget).get("instruction") || "";
    const revised = reviseVariantHook(activeVariant, instruction);
    setSelectedVariantId(revised.id);
    setState(current => {
      const nextTasks = current.tasks.map(item => {
        if (item.id !== task.id) return item;
        return {
          ...item,
          updatedAt: new Date().toISOString(),
          variants: item.variants.map(variant => (variant.id === activeVariant.id ? revised : variant))
        };
      });
      const nextProjects = current.projects.map(item => {
        if (item.taskId !== task.id) return item;
        const nextVariants = item.variants.map(variant => (variant.id === activeVariant.id ? revised : variant));
        return {
          ...item,
          updatedAt: new Date().toISOString(),
          variants: nextVariants,
          qualityScore: Math.round(nextVariants.reduce((sum, variant) => sum + variant.score, 0) / nextVariants.length)
        };
      });
      return {
        ...current,
        tasks: nextTasks,
        projects: nextProjects
      };
    });
  }

  function addAsset() {
    setState(current => ({
      ...current,
      assets: [createAsset("image", `Uploaded asset ${current.assets.length + 1}`, "upload", ["product", "new"]), ...current.assets]
    }));
  }

  function saveCurrentSkill() {
    if (!project) return;
    setState(current => ({
      ...current,
      customSkills: [saveSkillFromProject(project, "team"), ...current.customSkills]
    }));
    navigate("skills");
  }

  function exportVariant() {
    if (!project || !activeVariant) return;
    const record = buildExportRecord(project, activeVariant, task?.brief.platform || "TikTok");
    setState(current => ({
      ...current,
      exports: [record, ...current.exports]
    }));
    navigate("exports");
  }

  function resetDemo() {
    window.localStorage.removeItem(storageKey);
    const nextState = createInitialState();
    setState(nextState);
    setSelectedVariantId(nextState.tasks?.[0]?.variants?.[0]?.id || null);
    navigate("dashboard");
  }

  if (!state) {
    return (
      <main className="loading-screen">
        <span className="brand-mark">AI</span>
        <strong>AICrew Studio</strong>
      </main>
    );
  }

  if (view === "login" || view === "signup") {
    return (
      <AuthScreen
        mode={view}
        task={task}
        onSubmit={event => {
          event.preventDefault();
          navigate("dashboard");
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <Sidebar state={state} view={view} navigate={navigate} aiConfig={aiConfig} />
      <main className="main-surface">
        <Topbar state={state} view={view} navigate={navigate} resetDemo={resetDemo} />
        <section className="page-stack">
          {view === "dashboard" && (
            <Dashboard
              state={state}
              task={task}
              project={project}
              generateQuick={generateQuick}
              navigate={navigate}
              generating={generating}
              aiConfig={aiConfig}
            />
          )}
          {view === "workbench" && (
            <Workbench
              state={state}
              task={task}
              variant={activeVariant}
              allSkills={allSkills}
              selectedVariantId={selectedVariantId}
              setSelectedVariantId={setSelectedVariantId}
              generateFromBrief={generateFromBrief}
              reviseHook={reviseHook}
              addAsset={addAsset}
              saveCurrentSkill={saveCurrentSkill}
              exportVariant={exportVariant}
              generating={generating}
              aiConfig={aiConfig}
            />
          )}
          {view === "settings" && <AiSettings aiConfig={aiConfig} onSave={saveAi} onClear={clearAi} />}
          {view === "projects" && <Projects state={state} task={task} navigate={navigate} />}
          {view === "assets" && <Assets state={state} addAsset={addAsset} />}
          {view === "skills" && <Skills allSkills={allSkills} />}
          {view === "brand" && <Brand state={state} updateBrand={updateBrand} />}
          {view === "exports" && <Exports state={state} />}
          {view === "billing" && <Billing state={state} />}
          {view === "admin" && <Admin state={state} />}
          {view === "onboarding" && <Onboarding state={state} updateProfile={updateProfile} />}
        </section>
      </main>
      <FloatingCommandLayer state={state} view={view} navigate={navigate} generating={generating} />
    </div>
  );
}

function Sidebar({ state, view, navigate, aiConfig }) {
  const creditRatio = Math.min(100, Math.round((state.workspace.credits / state.workspace.monthlyCredits) * 100));
  return (
    <aside className="sidebar">
      <button className="brand-lockup reset-button" onClick={() => navigate("dashboard")} aria-label="AICrew Studio">
        <span className="brand-mark">AI</span>
        <span>
          <strong>AICrew</strong>
          <small>Creative OS</small>
        </span>
      </button>
      <SidebarAssistant state={state} aiConfig={aiConfig} navigate={navigate} />
      <nav className="nav-list" aria-label="Main navigation">
        {navItems.map(([id, label, icon]) => (
          <a
            className={`nav-item ${view === id ? "active" : ""}`}
            href={hrefFor(id)}
            key={id}
            onClick={event => {
              event.preventDefault();
              navigate(id);
            }}
          >
            <span>{icon}</span>
            <em>{label}</em>
          </a>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div className="credit-ring" style={{ "--value": creditRatio }}>
          <span>{state.workspace.credits}</span>
          <small>credits</small>
        </div>
        <button className="text-link reset-button" onClick={() => navigate("billing")}>
          Studio plan
        </button>
      </div>
    </aside>
  );
}

function SidebarAssistant({ state, aiConfig, navigate }) {
  const latestTask = state.tasks?.[0];
  const latestVariant = latestTask?.variants?.[0];
  return (
    <section className="assistant-card" aria-label="AI assistant summary">
      <div className="assistant-head">
        <span className="assistant-avatar">AI</span>
        <div>
          <strong>AICrew Pilot</strong>
          <small>{isAiConfigured(aiConfig) ? aiConfig.provider + " online" : "simulation runtime"}</small>
        </div>
      </div>
      <div className="assistant-message">
        <p>
          输入产品、受众和目标，我会调度脚本、视觉、QA 与导出 agent，生成一组可发布内容包。
        </p>
        <div className="assistant-tags">
          <span>图文</span>
          <span>视频脚本</span>
          <span>电商素材</span>
        </div>
      </div>
      <button className="assistant-compose reset-button" onClick={() => navigate("workbench")}>
        <span>{latestVariant?.score || latestTask?.qa?.overallScore || "GO"}</span>
        <em>向 AICrew 发送创作任务</em>
      </button>
    </section>
  );
}

function Topbar({ state, view, navigate, resetDemo }) {
  const liveAgents = state.tasks?.[0]?.agents?.length || 0;
  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">{state.workspace.name}</p>
        <h1>{routeTitles[view] || "AICrew Studio"}</h1>
      </div>
      <div className="topbar-actions">
        <div className="system-status" title="Agent runtime status">
          <i />
          {liveAgents ? `${liveAgents} agents online` : "runtime ready"}
        </div>
        <button className="ghost-button" onClick={() => navigate("workbench")}>
          New run
        </button>
        <button className="icon-button" onClick={resetDemo} title="Reset demo state" aria-label="Reset demo state">
          ↻
        </button>
        <button className="user-pill reset-button" onClick={() => navigate("onboarding")}>
          <span>{state.currentUser.name.slice(0, 1)}</span>
          <strong>{state.currentUser.role}</strong>
        </button>
      </div>
    </header>
  );
}

function FloatingCommandLayer({ state, view, navigate, generating }) {
  const latestTask = state.tasks?.[0];
  const agentsOnline = latestTask?.agents?.length || 0;
  return (
    <div className="floating-command-layer" aria-hidden={false}>
      <div className="right-tool-rail" aria-label="Quick actions">
        <button type="button" title="Open workbench" onClick={() => navigate("workbench")}>
          <span>+</span>
          <em>生成</em>
        </button>
        <button type="button" title="Open assets" onClick={() => navigate("assets")}>
          <span>□</span>
          <em>素材</em>
        </button>
        <button type="button" title="Open skills" onClick={() => navigate("skills")}>
          <span>✦</span>
          <em>技能</em>
        </button>
      </div>
      <div className="bottom-tool-dock" aria-label="Canvas tools">
        <button type="button" className={view === "dashboard" ? "active" : ""} onClick={() => navigate("dashboard")}>
          <span>⌖</span>
          <em>选择</em>
        </button>
        <button type="button" className={view === "workbench" ? "active" : ""} onClick={() => navigate("workbench")}>
          <span>✋</span>
          <em>{generating ? "调度中" : "抓手"}</em>
        </button>
        <button type="button" onClick={() => navigate("workbench")}>
          <span>▣</span>
          <em>添加</em>
        </button>
        <i />
        <button type="button" disabled title="Undo">
          <span>↶</span>
          <em>撤销</em>
        </button>
        <button type="button" disabled title="Redo">
          <span>↷</span>
          <em>重做</em>
        </button>
      </div>
      <div className="zoom-dock" aria-label="Canvas status">
        <span>{agentsOnline} agents</span>
        <strong>{state.workspace.credits.toLocaleString()}</strong>
        <em>credits</em>
      </div>
    </div>
  );
}

function Dashboard({ state, task, project, generateQuick, navigate, generating, aiConfig }) {
  const completionRate = state.tasks.length
    ? Math.round((state.tasks.filter(item => item.status === "completed").length / state.tasks.length) * 100)
    : 0;
  return (
    <div className="dashboard-grid">
      <section className="hero-console">
        <div className="hero-copy">
          <p className="eyebrow">AI Creative Operating System</p>
          <h2>让一个人拥有一支 AI 创意团队</h2>
          <form className="quick-brief" onSubmit={generateQuick}>
            <textarea
              name="briefText"
              rows="4"
              defaultValue="产品 NovaGlow Lamp，受众 25-38 岁生活方式消费者，目标 推广新品并提升首周转化，TikTok 高级快节奏"
            />
            <button className="primary-button" type="submit" disabled={generating}>
              {generating ? "AI 生成中…" : "Run Agent Team"}
            </button>
            <p className="ai-mode-hint">
              {isAiConfigured(aiConfig)
                ? `已接入 ${aiConfig.provider} · ${aiConfig.model}`
                : "未接入 AI（运行模拟）· 去「AI 接入」配置 token"}
            </p>
          </form>
        </div>
        <div className="hero-stage">
          <PhonePreview variant={task?.variants?.[0]} size="large" />
          <div className="runtime-card">
            <span>LIVE CANVAS</span>
            <strong>{task?.agents?.length || 0} agent chain</strong>
            <small>{project?.name || "Awaiting campaign"}</small>
          </div>
        </div>
      </section>
      <section className="metric-strip">
        <Metric label="完成率" value={`${completionRate}%`} caption="completed / submitted" />
        <Metric label="平均质量分" value={project?.qualityScore || 0} caption="QA weighted score" />
        <Metric label="可用积分" value={state.workspace.credits.toLocaleString()} caption="current balance" />
        <Metric label="导出包" value={state.exports.length} caption="ready packages" />
      </section>
      <section className="panel wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Agent Team</p>
            <h3>当前工作流</h3>
          </div>
          <button className="text-link reset-button" onClick={() => navigate("workbench")}>
            Open workbench
          </button>
        </div>
        <AgentTimeline task={task} />
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Content Package</p>
            <h3>{project?.name || "No project"}</h3>
          </div>
        </div>
        <div className="variant-mini-list">{task?.variants.map(variant => <VariantMini key={variant.id} variant={variant} />)}</div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Queue</p>
            <h3>任务状态</h3>
          </div>
        </div>
        <TaskTable tasks={state.tasks.slice(0, 5)} />
      </section>
    </div>
  );
}

function Workbench({
  state,
  task,
  variant,
  allSkills,
  selectedVariantId,
  setSelectedVariantId,
  generateFromBrief,
  reviseHook,
  addAsset,
  saveCurrentSkill,
  exportVariant,
  generating,
  aiConfig
}) {
  return (
    <div className="workbench-layout">
      <section className="panel composer-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Brief</p>
            <h3>生成电商广告内容包</h3>
          </div>
          <span className="status-chip">MVP Flow</span>
        </div>
        <form className="brief-form" onSubmit={generateFromBrief}>
          <label>
            商品名称
            <input name="productName" defaultValue={task?.brief.productName || "NovaGlow Lamp"} />
          </label>
          <label>
            卖点
            <textarea name="sellingPoints" rows="4" defaultValue={task?.brief.sellingPoints || "便携、柔光、露营和桌搭都适合"} />
          </label>
          <div className="form-grid">
            <label>
              目标受众
              <input name="targetAudience" defaultValue={task?.brief.targetAudience || "25-38 岁生活方式消费者"} />
            </label>
            <label>
              平台
              <select name="platform" defaultValue={task?.brief.platform || "TikTok"}>
                {platformPresets.map(preset => (
                  <option key={preset.id} value={preset.name}>
                    {preset.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-grid">
            <label>
              目标
              <input name="goal" defaultValue={task?.brief.goal || "推广新品并提升首周转化"} />
            </label>
            <label>
              风格
              <input name="style" defaultValue={task?.brief.style || "高级、明亮、快节奏"} />
            </label>
          </div>
          <label>
            Skill
            <select name="skillId" defaultValue={task?.skillId || "ecom_tiktok_product_ad_v1"}>
              {allSkills.map(skill => (
                <option key={skill.id} value={skill.id}>
                  {skill.name}
                </option>
              ))}
            </select>
          </label>
          <button className="upload-well reset-button" type="button" onClick={addAsset}>
            <strong>Product asset</strong>
            <span>{state.assets.length} items in library</span>
          </button>
          <button className="primary-button full" type="submit" disabled={generating}>
            {generating ? "AI 生成中…" : "Generate Content Pack"}
          </button>
          <p className="ai-mode-hint">
            {isAiConfigured(aiConfig)
              ? `已接入 ${aiConfig.provider} · ${aiConfig.model}${aiConfig.imageEnabled ? " · 封面图开" : ""}`
              : "未接入 AI（运行模拟）· 去「AI 接入」配置 token"}
          </p>
        </form>
      </section>
      <section className="workspace-canvas">
        <div className="canvas-toolbar">
          <div>
            <p className="eyebrow">Output</p>
            <h3>{task?.brief.productName || "No task"}</h3>
          </div>
          <div className="toolbar-actions">
            <button className="ghost-button" onClick={saveCurrentSkill}>
              Save Skill
            </button>
            <button className="primary-button" onClick={exportVariant}>
              Export
            </button>
          </div>
        </div>
        <div className="output-grid">
          <div className="video-bay">
            <PhonePreview variant={variant} size="large" />
          </div>
          <div className="variant-detail">
            <VariantDetail variant={variant} reviseHook={reviseHook} />
          </div>
        </div>
        <div className="variant-tabs" role="tablist">
          {task?.variants.map(item => (
            <button
              className={`variant-tab ${item.id === selectedVariantId ? "active" : ""}`}
              key={item.id}
              onClick={() => setSelectedVariantId(item.id)}
              type="button"
              role="tab"
              aria-selected={item.id === selectedVariantId}
            >
              <span>{item.name}</span>
              <strong>{item.score}</strong>
            </button>
          ))}
        </div>
      </section>
      <section className="panel run-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Runtime</p>
            <h3>Agent 执行记录</h3>
          </div>
          <span className="status-chip">{task?.credits.actual || 0} credits</span>
        </div>
        <AgentTimeline task={task} />
        <QaBox task={task} />
      </section>
    </div>
  );
}

function Projects({ state, task, navigate }) {
  return (
    <div className="page-grid two">
      <section className="panel wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Projects</p>
            <h3>项目库</h3>
          </div>
          <button className="primary-button" onClick={() => navigate("workbench")}>
            New project
          </button>
        </div>
        <div className="project-list">
          {state.projects.map(project => (
            <article className="project-row" key={project.id}>
              <div>
                <strong>{project.name}</strong>
                <span>
                  {project.type} · {formatDate(project.updatedAt)}
                </span>
              </div>
              <div className={`score-badge ${qualityTone(project.qualityScore)}`}>{project.qualityScore}</div>
              <span className="status-chip">{project.status}</span>
            </article>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Version</p>
            <h3>版本对比</h3>
          </div>
        </div>
        <VariantCompare task={task} />
      </section>
    </div>
  );
}

function Assets({ state, addAsset }) {
  return (
    <div className="page-grid">
      <section className="panel wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Assets</p>
            <h3>素材库</h3>
          </div>
          <button className="primary-button" onClick={addAsset}>
            Add asset
          </button>
        </div>
        <div className="asset-grid">{state.assets.map(asset => <AssetCard asset={asset} key={asset.id} />)}</div>
      </section>
    </div>
  );
}

function Skills({ allSkills }) {
  return (
    <div className="page-grid">
      <section className="panel wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Skills</p>
            <h3>生产方法库</h3>
          </div>
          <span className="status-chip">{allSkills.length} workflows</span>
        </div>
        <div className="skill-grid">{allSkills.map(skill => <SkillCard skill={skill} key={skill.id} />)}</div>
      </section>
    </div>
  );
}

function Brand({ state, updateBrand }) {
  const brand = state.brandKit;
  return (
    <div className="page-grid two">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Brand Memory</p>
            <h3>{brand.name}</h3>
          </div>
        </div>
        <form className="brief-form" onSubmit={updateBrand}>
          <label>
            品牌名
            <input name="name" defaultValue={brand.name} />
          </label>
          <label>
            Slogan
            <input name="slogan" defaultValue={brand.slogan} />
          </label>
          <label>
            语气
            <textarea name="voice" rows="3" defaultValue={brand.voice} />
          </label>
          <label>
            禁用词
            <input name="forbiddenWords" defaultValue={brand.forbiddenWords.join(", ")} />
          </label>
          <button className="primary-button full" type="submit">
            Save Brand Kit
          </button>
        </form>
      </section>
      <section className="panel brand-preview">
        <div
          className="brand-board"
          style={{
            "--brand-a": brand.colors[0],
            "--brand-b": brand.colors[1],
            "--brand-c": brand.colors[2]
          }}
        >
          <div className="brand-card">
            <span>{brand.name.slice(0, 2)}</span>
            <strong>{brand.slogan}</strong>
          </div>
          <div className="swatches">{brand.colors.map(color => <i key={color} style={{ background: color }} />)}</div>
          <p>{brand.voice}</p>
        </div>
      </section>
    </div>
  );
}

function Exports({ state }) {
  return (
    <div className="page-grid">
      <section className="panel wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Exports</p>
            <h3>可发布内容包</h3>
          </div>
        </div>
        <div className="export-grid">
          {state.exports.map(item => (
            <article className="export-card" key={item.id}>
              <div className="export-icon">{item.files.some(file => file.endsWith(".mp4")) ? "MP4" : "IMG"}</div>
              <strong>{item.name}</strong>
              <span>
                {item.platform} · {item.files.join(" / ")}
              </span>
              <small>{formatDate(item.createdAt)}</small>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function Billing({ state }) {
  return (
    <div className="page-grid two">
      <section className="panel billing-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Plan</p>
            <h3>{state.workspace.plan}</h3>
          </div>
          <span className="status-chip">
            {state.workspace.credits} / {state.workspace.monthlyCredits}
          </span>
        </div>
        <div className="credit-meter">
          <span style={{ width: `${Math.min(100, (state.workspace.credits / state.workspace.monthlyCredits) * 100)}%` }} />
        </div>
        <div className="pricing-grid">
          {["Starter", "Pro", "Studio", "Business"].map(plan => (
            <article className={`price-card ${state.workspace.plan === plan ? "active" : ""}`} key={plan}>
              <strong>{plan}</strong>
              <span>{plan === "Studio" ? "$99" : plan === "Business" ? "Custom" : plan === "Pro" ? "$49" : "$19"}</span>
            </article>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Ledger</p>
            <h3>积分流水</h3>
          </div>
        </div>
        <div className="ledger-list">
          {state.creditLedger.map(item => (
            <div className="ledger-row" key={item.id}>
              <span>{item.label}</span>
              <strong className={item.amount > 0 ? "positive" : "negative"}>
                {item.amount > 0 ? "+" : ""}
                {item.amount}
              </strong>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Admin({ state }) {
  return (
    <div className="page-grid two">
      <section className="panel wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Admin</p>
            <h3>任务与成本监控</h3>
          </div>
        </div>
        <TaskTable tasks={state.tasks} />
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Model Router</p>
            <h3>模型健康度</h3>
          </div>
        </div>
        <div className="model-list">
          {modelRoutes.map(model => (
            <article className="model-row" key={model.id}>
              <div>
                <strong>{model.name}</strong>
                <span>
                  {model.type} · {model.latency}
                </span>
              </div>
              <div className="health-bar">
                <span style={{ width: `${model.health}%` }} />
              </div>
              <em>{model.health}%</em>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function Onboarding({ state, updateProfile }) {
  return (
    <div className="page-grid two">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Workspace</p>
            <h3>账号与团队</h3>
          </div>
        </div>
        <form className="brief-form" onSubmit={updateProfile}>
          <label>
            姓名
            <input name="name" defaultValue={state.currentUser.name} />
          </label>
          <label>
            Email
            <input name="email" defaultValue={state.currentUser.email} />
          </label>
          <label>
            工作区
            <input name="workspace" defaultValue={state.workspace.name} />
          </label>
          <button className="primary-button full" type="submit">
            Save Profile
          </button>
        </form>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Notices</p>
            <h3>通知</h3>
          </div>
        </div>
        <div className="notice-list">
          {state.notifications.map(item => (
            <div className={`notice-row ${item.level}`} key={item.id}>
              <strong>{item.title}</strong>
              <span>{formatDate(item.createdAt)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function AiSettings({ aiConfig, onSave, onClear }) {
  const [form, setForm] = useState(() => aiConfig || defaultAiConfig("claude"));
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState(null); // null | {testing} | {ok,message}
  const [note, setNote] = useState("");
  const meta = AI_PROVIDERS[form.provider] || AI_PROVIDERS.claude;
  const configured = isAiConfigured(aiConfig);

  function update(patch) {
    setForm(prev => ({ ...prev, ...patch }));
    setNote("");
    setStatus(null);
  }

  function changeProvider(provider) {
    const next = AI_PROVIDERS[provider] || AI_PROVIDERS.claude;
    update({
      provider,
      model: next.defaultModel,
      baseURL: next.defaultBaseURL,
      imageEnabled: next.supportsImage ? form.imageEnabled : false
    });
  }

  async function handleTest() {
    const { valid, errors, config } = validateAiConfig(form);
    if (!valid) {
      setStatus({ ok: false, message: errors.join("；") });
      return;
    }
    setStatus({ testing: true });
    // 用户主动用自己的 key 发起一次真实连通性请求（浏览器直连）。
    const result = await testConnection(config);
    setStatus(result);
  }

  function handleSave(event) {
    event.preventDefault();
    try {
      onSave(form);
      setNote("已保存到本地浏览器（仅存于此设备）");
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    }
  }

  function handleClear() {
    onClear();
    setForm(defaultAiConfig("claude"));
    setStatus(null);
    setNote("已清除本地 token");
  }

  return (
    <div className="page-grid two">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">AI 接入</p>
            <h3>配置 Claude / OpenAI Token</h3>
          </div>
          <span className={`status-chip ${configured ? "" : "muted"}`}>{configured ? "已接入" : "未接入"}</span>
        </div>
        <form className="brief-form" onSubmit={handleSave}>
          <label>
            服务商
            <select value={form.provider} onChange={event => changeProvider(event.target.value)}>
              {Object.values(AI_PROVIDERS).map(provider => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            API Token
            <span className="token-field">
              <input
                name="apiKey"
                type={showKey ? "text" : "password"}
                autoComplete="off"
                spellCheck={false}
                placeholder={meta.id === "claude" ? "sk-ant-..." : "sk-..."}
                value={form.apiKey}
                onChange={event => update({ apiKey: event.target.value })}
              />
              <button type="button" className="ghost-button slim" onClick={() => setShowKey(value => !value)}>
                {showKey ? "隐藏" : "显示"}
              </button>
            </span>
          </label>
          <div className="form-grid">
            <label>
              模型
              <input
                name="model"
                list="ai-model-options"
                value={form.model}
                onChange={event => update({ model: event.target.value })}
              />
              <datalist id="ai-model-options">
                {meta.models.map(model => (
                  <option key={model} value={model} />
                ))}
              </datalist>
            </label>
            <label>
              Base URL
              <input name="baseURL" value={form.baseURL} onChange={event => update({ baseURL: event.target.value })} />
            </label>
          </div>
          {meta.supportsImage && (
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={Boolean(form.imageEnabled)}
                onChange={event => update({ imageEnabled: event.target.checked })}
              />
              生成 OpenAI 封面图（额外消耗与时延）
            </label>
          )}
          <div className="toolbar-actions">
            <button type="button" className="ghost-button" onClick={handleTest} disabled={status?.testing}>
              {status?.testing ? "测试中…" : "测试连接"}
            </button>
            <button type="submit" className="primary-button">
              保存
            </button>
            {configured && (
              <button type="button" className="ghost-button" onClick={handleClear}>
                清除
              </button>
            )}
          </div>
          {status && !status.testing && (
            <p className={`ai-status ${status.ok ? "ok" : "fail"}`}>{status.message}</p>
          )}
          {note && <p className="ai-status note">{note}</p>}
        </form>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">安全须知</p>
            <h3>Token 如何被处理</h3>
          </div>
        </div>
        <ul className="security-notes">
          <li>本应用是纯静态站点（无后端）。Token 仅保存在你当前浏览器的 localStorage，永不上传到任何服务器。</li>
          <li>生成请求由你的浏览器直接发往 {meta.name} 官方 API，使用你自己的 key、由你自己计费。</li>
          <li>浏览器直连意味着 key 暴露在前端，存在被恶意脚本（XSS）窃取的风险；请仅在受信任的设备上使用，并优先使用额度受限的 key。</li>
          <li>Token 不会进入演示数据、不会随导出包外泄、不写入日志。点「清除」可随时移除。</li>
          <li>未配置 Token 时，平台运行确定性模拟内容，不产生任何外部调用。</li>
        </ul>
      </section>
    </div>
  );
}

function AuthScreen({ mode, task, onSubmit }) {
  return (
    <main className="auth-screen">
      <section className="auth-panel">
        <span className="brand-lockup">
          <span className="brand-mark">AI</span>
          <span>
            <strong>AICrew</strong>
            <small>Creative OS</small>
          </span>
        </span>
        <h1>{mode === "signup" ? "Create workspace" : "Welcome back"}</h1>
        <form className="brief-form" onSubmit={onSubmit}>
          <label>
            Email
            <input name="email" defaultValue="ava@aicrew.local" />
          </label>
          <label>
            Password
            <input name="password" type="password" defaultValue="demo-demo" />
          </label>
          <button className="primary-button full" type="submit">
            {mode === "signup" ? "Create account" : "Login"}
          </button>
        </form>
      </section>
      <section className="auth-visual">
        <PhonePreview variant={task?.variants?.[0]} size="large" />
      </section>
    </main>
  );
}

function Metric({ label, value, caption }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{caption}</small>
    </article>
  );
}

function AgentTimeline({ task }) {
  if (!task) return <p className="empty-state">No active task</p>;
  return (
    <div className="agent-rail">
      {task.agents.map(agent => (
        <article className="agent-step" key={agent.id} style={{ "--agent": agent.accent }}>
          <span />
          <div>
            <strong>{agent.title}</strong>
            <em>{agent.duration}</em>
            <p>{agent.summary}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

function PhonePreview({ variant, size = "" }) {
  const colors = variant?.palette || ["#8bd3ff", "#ff7a90", "#f9c74f"];
  const imageUrl = variant?.imageUrl;
  return (
    <div className={`phone-preview ${size}`} style={{ "--c1": colors[0], "--c2": colors[1], "--c3": colors[2] }}>
      <div className="phone-top" />
      <div className={`video-frame ${imageUrl ? "has-image" : ""}`}>
        {imageUrl ? (
          <img className="ai-cover" src={imageUrl} alt={variant?.name || "AI 封面图"} />
        ) : (
          <>
            <div className="product-plinth">
              <span />
              <i />
            </div>
            <div className="motion-bars">
              <b />
              <b />
              <b />
            </div>
          </>
        )}
        {variant?.aiGenerated && <span className="ai-badge">AI</span>}
        <div className="video-copy">
          <strong>{variant?.hook || "Create product videos with your AI crew"}</strong>
          <span>{variant?.cta || "Launch campaign"}</span>
        </div>
      </div>
    </div>
  );
}

function VariantMini({ variant }) {
  return (
    <article className="variant-mini">
      <div className={`score-badge ${qualityTone(variant.score)}`}>{variant.score}</div>
      <div>
        <strong>{variant.name}</strong>
        <span>
          {variant.angle} · v{variant.version}
        </span>
      </div>
    </article>
  );
}

function VariantDetail({ variant, reviseHook }) {
  if (!variant) return <p className="empty-state">Generate a content pack first</p>;
  return (
    <>
      <div className="variant-header">
        <div>
          <p className="eyebrow">{variant.angle}</p>
          <h3>{variant.name}</h3>
        </div>
        <div className={`score-badge ${qualityTone(variant.score)}`}>{variant.score}</div>
      </div>
      <p className="hook-line">{variant.hook}</p>
      <div className="storyboard-list">
        {variant.timeline.map(shot => (
          <article key={`${variant.id}-${shot.time}`}>
            <span>{shot.time}</span>
            <strong>{shot.shot}</strong>
            <p>{shot.action}</p>
          </article>
        ))}
      </div>
      <div className="copy-pack">
        <strong>{variant.caption}</strong>
        <span>{variant.hashtags.join(" ")}</span>
      </div>
      {variant.metrics && (
        <div className="metric-bars">
          <p>Quality telemetry</p>
          {Object.entries(metricLabels).map(([key, label]) => (
            <div className="metric-bar" key={key}>
              <span>{label}</span>
              <div className="bar">
                <i style={{ width: `${Math.min(100, variant.metrics[key] || 0)}%` }} />
              </div>
              <b>{variant.metrics[key]}</b>
            </div>
          ))}
        </div>
      )}
      <form className="revision-bar" onSubmit={reviseHook}>
        <input name="instruction" defaultValue="前三秒更强，更直接点出痛点" />
        <button className="ghost-button" type="submit">
          Revise hook
        </button>
      </form>
    </>
  );
}

function QaBox({ task }) {
  if (!task) return null;
  return (
    <div className="qa-box">
      <div>
        <span className={`score-badge ${qualityTone(task.qa.overallScore)}`}>{task.qa.overallScore}</span>
        <strong>{task.qa.recommendation}</strong>
      </div>
      {task.qa.checks.map(check => (
        <p key={check.label}>
          <span>{check.label}</span>
          <b>{check.score}</b>
        </p>
      ))}
    </div>
  );
}

function TaskTable({ tasks }) {
  return (
    <div className="task-table">
      {tasks.map(task => (
        <article key={task.id}>
          <div>
            <strong>{task.brief.productName}</strong>
            <span>
              {task.skillName} · {formatDate(task.updatedAt)}
            </span>
          </div>
          <span className="status-chip">{task.status}</span>
          <strong>{task.credits.actual}</strong>
        </article>
      ))}
    </div>
  );
}

function VariantCompare({ task }) {
  if (!task) return <p className="empty-state">No variants</p>;
  return (
    <div className="compare-list">
      {task.variants.map(item => (
        <article key={item.id}>
          <span className={`score-badge ${qualityTone(item.score)}`}>{item.score}</span>
          <div>
            <strong>
              {item.name} v{item.version}
            </strong>
            <p>{item.hook}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

function AssetCard({ asset }) {
  return (
    <article className="asset-card">
      <div className={`asset-thumb ${asset.type}`}>
        <span>{asset.type.toUpperCase()}</span>
      </div>
      <strong>{asset.name}</strong>
      <span>
        {asset.source} · {asset.size}
      </span>
      <div className="tag-row">{asset.tags.map(tag => <em key={tag}>{tag}</em>)}</div>
    </article>
  );
}

function SkillCard({ skill }) {
  return (
    <article className="skill-card" style={{ "--c1": skill.palette?.[0] || "#8bd3ff", "--c2": skill.palette?.[1] || "#ff7a90" }}>
      <div className="skill-topline">
        <span>{skill.category}</span>
        <em>{skill.stage}</em>
      </div>
      <strong>{skill.name}</strong>
      <p>{skill.promise}</p>
      <div className="tag-row">{skill.formats.map(format => <em key={format}>{format}</em>)}</div>
      <small>{skill.bestFor}</small>
    </article>
  );
}
