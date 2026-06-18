import {
  agents,
  buildExportRecord,
  createAsset,
  createInitialState,
  createProjectFromTask,
  defaultBrandKit,
  makeId,
  modelRoutes,
  normalizeBrief,
  parseBriefText,
  reviseVariantHook,
  runCreativeWorkflow,
  saveSkillFromProject,
  skills
} from "./domain.js";

const storageKey = "aicrew-studio-state-v1";
const app = document.querySelector("#app");
let state = loadState();
let selectedVariantId = latestTask()?.variants?.[0]?.id || null;

const navItems = [
  ["dashboard", "Dashboard", "◎"],
  ["workbench", "Workbench", "▣"],
  ["projects", "Projects", "▤"],
  ["assets", "Assets", "◫"],
  ["skills", "Skills", "✦"],
  ["brand", "Brand Kit", "◈"],
  ["exports", "Exports", "⇩"],
  ["billing", "Billing", "$"],
  ["admin", "Admin", "⌁"]
];

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
  onboarding: "Onboarding",
  login: "Login",
  signup: "Signup"
};

function loadState() {
  try {
    const saved = localStorage.getItem(storageKey);
    return saved ? JSON.parse(saved) : createInitialState();
  } catch (error) {
    console.warn("State reset:", error);
    return createInitialState();
  }
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function route() {
  return (location.hash.replace(/^#\/?/, "") || "dashboard").split("?")[0];
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function latestTask() {
  return state.tasks?.[0];
}

function latestProject() {
  return state.projects?.[0];
}

function allSkills() {
  return [...skills, ...(state.customSkills || [])];
}

function activeVariant() {
  const task = latestTask();
  return task?.variants.find(item => item.id === selectedVariantId) || task?.variants?.[0];
}

function qualityTone(score) {
  if (score >= 88) return "great";
  if (score >= 78) return "good";
  return "warn";
}

function render() {
  const currentRoute = route();
  if (currentRoute === "login" || currentRoute === "signup") {
    app.innerHTML = renderAuth(currentRoute);
    return;
  }

  app.innerHTML = `
    <div class="app-shell">
      ${renderSidebar(currentRoute)}
      <main class="main-surface">
        ${renderTopbar(currentRoute)}
        <section class="page-stack">
          ${renderPage(currentRoute)}
        </section>
      </main>
    </div>
  `;
}

function renderSidebar(currentRoute) {
  return `
    <aside class="sidebar">
      <a class="brand-lockup" href="#/dashboard" aria-label="AICrew Studio">
        <span class="brand-mark">AI</span>
        <span>
          <strong>AICrew</strong>
          <small>Creative OS</small>
        </span>
      </a>
      <nav class="nav-list" aria-label="Main navigation">
        ${navItems
          .map(
            ([id, label, icon]) => `
              <a class="nav-item ${currentRoute === id ? "active" : ""}" href="#/${id}">
                <span>${icon}</span>
                <em>${label}</em>
              </a>
            `
          )
          .join("")}
      </nav>
      <div class="sidebar-footer">
        <div class="credit-ring" style="--value:${Math.min(100, Math.round((state.workspace.credits / state.workspace.monthlyCredits) * 100))}">
          <span>${state.workspace.credits}</span>
          <small>credits</small>
        </div>
        <a class="text-link" href="#/billing">Studio plan</a>
      </div>
    </aside>
  `;
}

function renderTopbar(currentRoute) {
  return `
    <header class="topbar">
      <div>
        <p class="eyebrow">${escapeHtml(state.workspace.name)}</p>
        <h1>${routeTitles[currentRoute] || "AICrew Studio"}</h1>
      </div>
      <div class="topbar-actions">
        <a class="ghost-button" href="#/workbench">New run</a>
        <button class="icon-button" data-action="seed-demo" title="Reset demo state" aria-label="Reset demo state">↻</button>
        <a class="user-pill" href="#/onboarding">
          <span>${escapeHtml(state.currentUser.name.slice(0, 1))}</span>
          <strong>${escapeHtml(state.currentUser.role)}</strong>
        </a>
      </div>
    </header>
  `;
}

function renderPage(currentRoute) {
  const pages = {
    dashboard: renderDashboard,
    workbench: renderWorkbench,
    projects: renderProjects,
    assets: renderAssets,
    skills: renderSkills,
    brand: renderBrand,
    exports: renderExports,
    billing: renderBilling,
    admin: renderAdmin,
    onboarding: renderOnboarding
  };
  return (pages[currentRoute] || renderDashboard)();
}

function renderDashboard() {
  const task = latestTask();
  const project = latestProject();
  const completionRate = state.tasks.length
    ? Math.round((state.tasks.filter(item => item.status === "completed").length / state.tasks.length) * 100)
    : 0;
  return `
    <div class="dashboard-grid">
      <section class="hero-console">
        <div class="hero-copy">
          <p class="eyebrow">AI Creative Operating System</p>
          <h2>让一个人拥有一支 AI 创意团队</h2>
          <form class="quick-brief" data-form="quick-brief">
            <textarea name="briefText" rows="4">产品 NovaGlow Lamp，受众 25-38 岁生活方式消费者，目标 推广新品并提升首周转化，TikTok 高级快节奏</textarea>
            <button class="primary-button" type="submit">Run Agent Team</button>
          </form>
        </div>
        <div class="hero-stage">
          ${renderPhonePreview(task?.variants?.[0], "large")}
        </div>
      </section>

      <section class="metric-strip">
        ${renderMetric("完成率", `${completionRate}%`, "completed / submitted")}
        ${renderMetric("平均质量分", `${project?.qualityScore || 0}`, "QA weighted score")}
        ${renderMetric("可用积分", state.workspace.credits.toLocaleString(), "current balance")}
        ${renderMetric("导出包", state.exports.length, "ready packages")}
      </section>

      <section class="panel wide">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Agent Team</p>
            <h3>当前工作流</h3>
          </div>
          <a class="text-link" href="#/workbench">Open workbench</a>
        </div>
        ${renderAgentTimeline(task)}
      </section>

      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Content Package</p>
            <h3>${escapeHtml(project?.name || "No project")}</h3>
          </div>
        </div>
        <div class="variant-mini-list">
          ${(task?.variants || []).map(renderVariantMini).join("")}
        </div>
      </section>

      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Queue</p>
            <h3>任务状态</h3>
          </div>
        </div>
        ${renderTaskTable(state.tasks.slice(0, 5))}
      </section>
    </div>
  `;
}

function renderWorkbench() {
  const task = latestTask();
  const variant = activeVariant();
  const selectedSkill = task ? allSkills().find(item => item.id === task.skillId) : skills[0];
  return `
    <div class="workbench-layout">
      <section class="panel composer-panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Brief</p>
            <h3>生成电商广告内容包</h3>
          </div>
          <span class="status-chip">MVP Flow</span>
        </div>
        <form class="brief-form" data-form="creative-brief">
          <label>
            商品名称
            <input name="productName" value="${escapeHtml(task?.brief.productName || "NovaGlow Lamp")}" />
          </label>
          <label>
            卖点
            <textarea name="sellingPoints" rows="4">${escapeHtml(task?.brief.sellingPoints || "便携、柔光、露营和桌搭都适合")}</textarea>
          </label>
          <div class="form-grid">
            <label>
              目标受众
              <input name="targetAudience" value="${escapeHtml(task?.brief.targetAudience || "25-38 岁生活方式消费者")}" />
            </label>
            <label>
              平台
              <select name="platform">
                ${["TikTok", "Instagram Reels", "YouTube Shorts", "Shopify PDP"]
                  .map(name => `<option ${task?.brief.platform === name ? "selected" : ""}>${name}</option>`)
                  .join("")}
              </select>
            </label>
          </div>
          <div class="form-grid">
            <label>
              目标
              <input name="goal" value="${escapeHtml(task?.brief.goal || "推广新品并提升首周转化")}" />
            </label>
            <label>
              风格
              <input name="style" value="${escapeHtml(task?.brief.style || "高级、明亮、快节奏")}" />
            </label>
          </div>
          <label>
            Skill
            <select name="skillId">
              ${allSkills()
                .map(skill => `<option value="${skill.id}" ${selectedSkill?.id === skill.id ? "selected" : ""}>${escapeHtml(skill.name)}</option>`)
                .join("")}
            </select>
          </label>
          <div class="upload-well" data-action="add-asset">
            <strong>Product asset</strong>
            <span>${state.assets.length} items in library</span>
          </div>
          <button class="primary-button full" type="submit">Generate Content Pack</button>
        </form>
      </section>

      <section class="workspace-canvas">
        <div class="canvas-toolbar">
          <div>
            <p class="eyebrow">Output</p>
            <h3>${escapeHtml(task?.brief.productName || "No task")}</h3>
          </div>
          <div class="toolbar-actions">
            <button class="ghost-button" data-action="save-skill">Save Skill</button>
            <button class="primary-button" data-action="export-variant">Export</button>
          </div>
        </div>
        <div class="output-grid">
          <div class="video-bay">
            ${renderPhonePreview(variant, "large")}
          </div>
          <div class="variant-detail">
            ${renderVariantDetail(variant)}
          </div>
        </div>
        <div class="variant-tabs" role="tablist">
          ${(task?.variants || [])
            .map(
              item => `
                <button class="variant-tab ${item.id === variant?.id ? "active" : ""}" data-action="select-variant" data-id="${item.id}">
                  <span>${escapeHtml(item.name)}</span>
                  <strong>${item.score}</strong>
                </button>
              `
            )
            .join("")}
        </div>
      </section>

      <section class="panel run-panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Runtime</p>
            <h3>Agent 执行记录</h3>
          </div>
          <span class="status-chip">${task?.credits.actual || 0} credits</span>
        </div>
        ${renderAgentTimeline(task)}
        ${renderQa(task)}
      </section>
    </div>
  `;
}

function renderProjects() {
  return `
    <div class="page-grid two">
      <section class="panel wide">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Projects</p>
            <h3>项目库</h3>
          </div>
          <a class="primary-button" href="#/workbench">New project</a>
        </div>
        <div class="project-list">
          ${state.projects
            .map(
              project => `
                <article class="project-row">
                  <div>
                    <strong>${escapeHtml(project.name)}</strong>
                    <span>${escapeHtml(project.type)} · ${formatDate(project.updatedAt)}</span>
                  </div>
                  <div class="score-badge ${qualityTone(project.qualityScore)}">${project.qualityScore}</div>
                  <span class="status-chip">${escapeHtml(project.status)}</span>
                </article>
              `
            )
            .join("")}
        </div>
      </section>
      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Version</p>
            <h3>版本对比</h3>
          </div>
        </div>
        ${renderVariantCompare(latestTask())}
      </section>
    </div>
  `;
}

function renderAssets() {
  return `
    <div class="page-grid">
      <section class="panel wide">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Assets</p>
            <h3>素材库</h3>
          </div>
          <button class="primary-button" data-action="add-asset">Add asset</button>
        </div>
        <div class="asset-grid">
          ${state.assets.map(renderAssetCard).join("")}
        </div>
      </section>
    </div>
  `;
}

function renderSkills() {
  return `
    <div class="page-grid">
      <section class="panel wide">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Skills</p>
            <h3>生产方法库</h3>
          </div>
          <span class="status-chip">${allSkills().length} workflows</span>
        </div>
        <div class="skill-grid">
          ${allSkills().map(renderSkillCard).join("")}
        </div>
      </section>
    </div>
  `;
}

function renderBrand() {
  const brand = state.brandKit;
  return `
    <div class="page-grid two">
      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Brand Memory</p>
            <h3>${escapeHtml(brand.name)}</h3>
          </div>
        </div>
        <form class="brief-form" data-form="brand-kit">
          <label>
            品牌名
            <input name="name" value="${escapeHtml(brand.name)}" />
          </label>
          <label>
            Slogan
            <input name="slogan" value="${escapeHtml(brand.slogan)}" />
          </label>
          <label>
            语气
            <textarea name="voice" rows="3">${escapeHtml(brand.voice)}</textarea>
          </label>
          <label>
            禁用词
            <input name="forbiddenWords" value="${escapeHtml(brand.forbiddenWords.join(", "))}" />
          </label>
          <button class="primary-button full" type="submit">Save Brand Kit</button>
        </form>
      </section>
      <section class="panel brand-preview">
        <div class="brand-board" style="--brand-a:${brand.colors[0]};--brand-b:${brand.colors[1]};--brand-c:${brand.colors[2]}">
          <div class="brand-card">
            <span>${escapeHtml(brand.name.slice(0, 2))}</span>
            <strong>${escapeHtml(brand.slogan)}</strong>
          </div>
          <div class="swatches">
            ${brand.colors.map(color => `<i style="background:${escapeHtml(color)}"></i>`).join("")}
          </div>
          <p>${escapeHtml(brand.voice)}</p>
        </div>
      </section>
    </div>
  `;
}

function renderExports() {
  return `
    <div class="page-grid">
      <section class="panel wide">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Exports</p>
            <h3>可发布内容包</h3>
          </div>
        </div>
        <div class="export-grid">
          ${state.exports
            .map(
              item => `
                <article class="export-card">
                  <div class="export-icon">MP4</div>
                  <strong>${escapeHtml(item.name)}</strong>
                  <span>${escapeHtml(item.platform)} · ${escapeHtml(item.files.join(" / "))}</span>
                  <small>${formatDate(item.createdAt)}</small>
                </article>
              `
            )
            .join("")}
        </div>
      </section>
    </div>
  `;
}

function renderBilling() {
  return `
    <div class="page-grid two">
      <section class="panel billing-panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Plan</p>
            <h3>${escapeHtml(state.workspace.plan)}</h3>
          </div>
          <span class="status-chip">${state.workspace.credits} / ${state.workspace.monthlyCredits}</span>
        </div>
        <div class="credit-meter"><span style="width:${Math.min(100, (state.workspace.credits / state.workspace.monthlyCredits) * 100)}%"></span></div>
        <div class="pricing-grid">
          ${["Starter", "Pro", "Studio", "Business"]
            .map(
              plan => `
                <article class="price-card ${state.workspace.plan === plan ? "active" : ""}">
                  <strong>${plan}</strong>
                  <span>${plan === "Studio" ? "$99" : plan === "Business" ? "Custom" : plan === "Pro" ? "$49" : "$19"}</span>
                </article>
              `
            )
            .join("")}
        </div>
      </section>
      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Ledger</p>
            <h3>积分流水</h3>
          </div>
        </div>
        <div class="ledger-list">
          ${state.creditLedger
            .map(
              item => `
                <div class="ledger-row">
                  <span>${escapeHtml(item.label)}</span>
                  <strong class="${item.amount > 0 ? "positive" : "negative"}">${item.amount > 0 ? "+" : ""}${item.amount}</strong>
                </div>
              `
            )
            .join("")}
        </div>
      </section>
    </div>
  `;
}

function renderAdmin() {
  return `
    <div class="page-grid two">
      <section class="panel wide">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Admin</p>
            <h3>任务与成本监控</h3>
          </div>
        </div>
        ${renderTaskTable(state.tasks)}
      </section>
      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Model Router</p>
            <h3>模型健康度</h3>
          </div>
        </div>
        <div class="model-list">
          ${modelRoutes
            .map(
              model => `
                <article class="model-row">
                  <div>
                    <strong>${escapeHtml(model.name)}</strong>
                    <span>${escapeHtml(model.type)} · ${escapeHtml(model.latency)}</span>
                  </div>
                  <div class="health-bar"><span style="width:${model.health}%"></span></div>
                  <em>${model.health}%</em>
                </article>
              `
            )
            .join("")}
        </div>
      </section>
    </div>
  `;
}

function renderOnboarding() {
  return `
    <div class="page-grid two">
      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Workspace</p>
            <h3>账号与团队</h3>
          </div>
        </div>
        <form class="brief-form" data-form="profile">
          <label>
            姓名
            <input name="name" value="${escapeHtml(state.currentUser.name)}" />
          </label>
          <label>
            Email
            <input name="email" value="${escapeHtml(state.currentUser.email)}" />
          </label>
          <label>
            工作区
            <input name="workspace" value="${escapeHtml(state.workspace.name)}" />
          </label>
          <button class="primary-button full" type="submit">Save Profile</button>
        </form>
      </section>
      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Notices</p>
            <h3>通知</h3>
          </div>
        </div>
        <div class="notice-list">
          ${state.notifications
            .map(
              item => `
                <div class="notice-row ${item.level}">
                  <strong>${escapeHtml(item.title)}</strong>
                  <span>${formatDate(item.createdAt)}</span>
                </div>
              `
            )
            .join("")}
        </div>
      </section>
    </div>
  `;
}

function renderAuth(mode) {
  return `
    <main class="auth-screen">
      <section class="auth-panel">
        <a class="brand-lockup" href="#/dashboard">
          <span class="brand-mark">AI</span>
          <span>
            <strong>AICrew</strong>
            <small>Creative OS</small>
          </span>
        </a>
        <h1>${mode === "signup" ? "Create workspace" : "Welcome back"}</h1>
        <form class="brief-form" data-form="auth">
          <label>
            Email
            <input name="email" value="ava@aicrew.local" />
          </label>
          <label>
            Password
            <input name="password" type="password" value="demo-demo" />
          </label>
          <button class="primary-button full" type="submit">${mode === "signup" ? "Create account" : "Login"}</button>
        </form>
      </section>
      <section class="auth-visual">
        ${renderPhonePreview(latestTask()?.variants?.[0], "large")}
      </section>
    </main>
  `;
}

function renderMetric(label, value, caption) {
  return `
    <article class="metric-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(caption)}</small>
    </article>
  `;
}

function renderAgentTimeline(task) {
  if (!task) return `<p class="empty-state">No active task</p>`;
  return `
    <div class="agent-rail">
      ${task.agents
        .map(
          agent => `
            <article class="agent-step" style="--agent:${agent.accent}">
              <span></span>
              <div>
                <strong>${escapeHtml(agent.title)}</strong>
                <em>${escapeHtml(agent.duration)}</em>
                <p>${escapeHtml(agent.summary)}</p>
              </div>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderPhonePreview(variant, size = "") {
  const colors = variant?.palette || ["#8bd3ff", "#ff7a90", "#f9c74f"];
  return `
    <div class="phone-preview ${size}" style="--c1:${colors[0]};--c2:${colors[1]};--c3:${colors[2]}">
      <div class="phone-top"></div>
      <div class="video-frame">
        <div class="product-plinth">
          <span></span>
          <i></i>
        </div>
        <div class="motion-bars"><b></b><b></b><b></b></div>
        <div class="video-copy">
          <strong>${escapeHtml(variant?.hook || "Create product videos with your AI crew")}</strong>
          <span>${escapeHtml(variant?.cta || "Launch campaign")}</span>
        </div>
      </div>
    </div>
  `;
}

function renderVariantMini(variant) {
  return `
    <article class="variant-mini">
      <div class="score-badge ${qualityTone(variant.score)}">${variant.score}</div>
      <div>
        <strong>${escapeHtml(variant.name)}</strong>
        <span>${escapeHtml(variant.angle)} · v${variant.version}</span>
      </div>
    </article>
  `;
}

function renderVariantDetail(variant) {
  if (!variant) return `<p class="empty-state">Generate a content pack first</p>`;
  return `
    <div class="variant-header">
      <div>
        <p class="eyebrow">${escapeHtml(variant.angle)}</p>
        <h3>${escapeHtml(variant.name)}</h3>
      </div>
      <div class="score-badge ${qualityTone(variant.score)}">${variant.score}</div>
    </div>
    <p class="hook-line">${escapeHtml(variant.hook)}</p>
    <div class="storyboard-list">
      ${variant.timeline
        .map(
          shot => `
            <article>
              <span>${escapeHtml(shot.time)}</span>
              <strong>${escapeHtml(shot.shot)}</strong>
              <p>${escapeHtml(shot.action)}</p>
            </article>
          `
        )
        .join("")}
    </div>
    <div class="copy-pack">
      <strong>${escapeHtml(variant.caption)}</strong>
      <span>${variant.hashtags.map(escapeHtml).join(" ")}</span>
    </div>
    <form class="revision-bar" data-form="revision">
      <input name="instruction" value="前三秒更强，更直接点出痛点" />
      <button class="ghost-button" type="submit">Revise hook</button>
    </form>
  `;
}

function renderQa(task) {
  if (!task) return "";
  return `
    <div class="qa-box">
      <div>
        <span class="score-badge ${qualityTone(task.qa.overallScore)}">${task.qa.overallScore}</span>
        <strong>${escapeHtml(task.qa.recommendation)}</strong>
      </div>
      ${task.qa.checks
        .map(
          check => `
            <p>
              <span>${escapeHtml(check.label)}</span>
              <b>${check.score}</b>
            </p>
          `
        )
        .join("")}
    </div>
  `;
}

function renderTaskTable(tasks) {
  return `
    <div class="task-table">
      ${tasks
        .map(
          task => `
            <article>
              <div>
                <strong>${escapeHtml(task.brief.productName)}</strong>
                <span>${escapeHtml(task.skillName)} · ${formatDate(task.updatedAt)}</span>
              </div>
              <span class="status-chip">${escapeHtml(task.status)}</span>
              <strong>${task.credits.actual}</strong>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderVariantCompare(task) {
  if (!task) return `<p class="empty-state">No variants</p>`;
  return `
    <div class="compare-list">
      ${task.variants
        .map(
          item => `
            <article>
              <span class="score-badge ${qualityTone(item.score)}">${item.score}</span>
              <div>
                <strong>${escapeHtml(item.name)} v${item.version}</strong>
                <p>${escapeHtml(item.hook)}</p>
              </div>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderAssetCard(asset) {
  return `
    <article class="asset-card">
      <div class="asset-thumb ${asset.type}">
        <span>${escapeHtml(asset.type.toUpperCase())}</span>
      </div>
      <strong>${escapeHtml(asset.name)}</strong>
      <span>${escapeHtml(asset.source)} · ${escapeHtml(asset.size)}</span>
      <div class="tag-row">${asset.tags.map(tag => `<em>${escapeHtml(tag)}</em>`).join("")}</div>
    </article>
  `;
}

function renderSkillCard(skill) {
  return `
    <article class="skill-card" style="--c1:${skill.palette?.[0] || "#8bd3ff"};--c2:${skill.palette?.[1] || "#ff7a90"}">
      <div class="skill-topline">
        <span>${escapeHtml(skill.category)}</span>
        <em>${escapeHtml(skill.stage)}</em>
      </div>
      <strong>${escapeHtml(skill.name)}</strong>
      <p>${escapeHtml(skill.promise)}</p>
      <div class="tag-row">${skill.formats.map(format => `<em>${escapeHtml(format)}</em>`).join("")}</div>
      <small>${escapeHtml(skill.bestFor)}</small>
    </article>
  `;
}

function commitGeneratedTask(task, projectName, creditLabel) {
  const project = createProjectFromTask(task, projectName);
  state.tasks.unshift(task);
  state.projects.unshift(project);
  selectedVariantId = task.variants[0]?.id;
  state.workspace.credits = Math.max(0, state.workspace.credits - task.credits.actual);
  state.creditLedger.unshift({
    id: makeId("credit"),
    type: "consume",
    amount: -task.credits.actual,
    label: creditLabel,
    createdAt: new Date().toISOString()
  });
  state.exports.unshift(
    ...task.exports.map(item => ({
      ...item,
      id: makeId("export"),
      projectId: project.id,
      projectName: project.name,
      createdAt: new Date().toISOString()
    }))
  );
  state.notifications.unshift({
    id: makeId("notice"),
    level: "success",
    title: `${task.brief.productName} 内容包已生成`,
    createdAt: new Date().toISOString()
  });
  return project;
}

function handleGenerate(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  const brief = normalizeBrief(data);
  const task = runCreativeWorkflow({
    brief,
    skillId: data.skillId || "ecom_tiktok_product_ad_v1",
    brandKit: state.brandKit
  });
  commitGeneratedTask(task, `${brief.productName} ${brief.platform} launch`, `${brief.productName} generation`);
  saveState();
  location.hash = "#/workbench";
  render();
}

function handleQuickBrief(form) {
  const text = new FormData(form).get("briefText");
  const brief = parseBriefText(text);
  const fakeForm = new FormData();
  Object.entries(brief).forEach(([key, value]) => fakeForm.set(key, value));
  fakeForm.set("skillId", "ecom_tiktok_product_ad_v1");
  const data = Object.fromEntries(fakeForm.entries());
  const task = runCreativeWorkflow({
    brief: data,
    skillId: data.skillId,
    brandKit: state.brandKit
  });
  commitGeneratedTask(task, `${brief.productName} quick campaign`, `${brief.productName} quick generation`);
  saveState();
  location.hash = "#/workbench";
  render();
}

function updateProjectVariants(task) {
  const project = state.projects.find(item => item.taskId === task.id);
  if (project) {
    project.variants = task.variants;
    project.qualityScore = Math.round(task.variants.reduce((sum, item) => sum + item.score, 0) / task.variants.length);
    project.updatedAt = new Date().toISOString();
  }
}

document.addEventListener("submit", event => {
  const form = event.target.closest("form");
  if (!form) return;
  event.preventDefault();
  const kind = form.dataset.form;
  if (kind === "creative-brief") handleGenerate(form);
  if (kind === "quick-brief") handleQuickBrief(form);
  if (kind === "brand-kit") {
    const data = Object.fromEntries(new FormData(form).entries());
    state.brandKit = {
      ...state.brandKit,
      name: data.name,
      slogan: data.slogan,
      voice: data.voice,
      forbiddenWords: data.forbiddenWords.split(",").map(item => item.trim()).filter(Boolean)
    };
    saveState();
    render();
  }
  if (kind === "profile") {
    const data = Object.fromEntries(new FormData(form).entries());
    state.currentUser.name = data.name;
    state.currentUser.email = data.email;
    state.workspace.name = data.workspace;
    saveState();
    render();
  }
  if (kind === "revision") {
    const task = latestTask();
    const variant = activeVariant();
    if (!task || !variant) return;
    const instruction = new FormData(form).get("instruction") || "";
    const revised = reviseVariantHook(variant, instruction);
    const index = task.variants.findIndex(item => item.id === variant.id);
    task.variants.splice(index, 1, revised);
    task.updatedAt = new Date().toISOString();
    selectedVariantId = revised.id;
    updateProjectVariants(task);
    saveState();
    render();
  }
  if (kind === "auth") {
    location.hash = "#/dashboard";
  }
});

document.addEventListener("click", event => {
  const control = event.target.closest("[data-action]");
  if (!control) return;
  const action = control.dataset.action;
  const task = latestTask();
  const variant = activeVariant();

  if (action === "seed-demo") {
    localStorage.removeItem(storageKey);
    state = createInitialState();
    selectedVariantId = latestTask()?.variants?.[0]?.id;
    saveState();
    render();
  }

  if (action === "select-variant") {
    selectedVariantId = control.dataset.id;
    render();
  }

  if (action === "add-asset") {
    state.assets.unshift(createAsset("image", `Uploaded asset ${state.assets.length + 1}`, "upload", ["product", "new"]));
    saveState();
    render();
  }

  if (action === "save-skill") {
    const project = latestProject();
    if (!project) return;
    state.customSkills.unshift(saveSkillFromProject(project, "team"));
    saveState();
    location.hash = "#/skills";
    render();
  }

  if (action === "export-variant" && variant) {
    const project = latestProject();
    const record = buildExportRecord(project, variant, variant.platform || latestTask()?.brief.platform || "TikTok");
    state.exports.unshift(record);
    saveState();
    location.hash = "#/exports";
    render();
  }
});

window.addEventListener("hashchange", render);
render();
