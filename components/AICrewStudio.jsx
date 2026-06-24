"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  agents as agentCatalog,
  buildExportRecord,
  createAsset,
  createInitialState,
  createProjectFromTask,
  makeId,
  modelRoutes,
  normalizeBrief,
  parseBriefText,
  reconcileInterruptedTasks,
  reviseVariantHook,
  retryAgentStep,
  runCreativeWorkflow,
  saveSkillFromProject,
  skills
} from "../lib/domain.js";
import {
  AI_MODE_LABELS,
  describeSelectedModel,
  hasAiMode,
  isAiConfigured,
  loadAiSelection,
  normalizeAiSelection,
  normalizeSystemAiConfig,
  saveAiSelection
} from "../lib/ai/config.js";
import { runCreativeWorkflowWithAI } from "../lib/ai/workflow.js";
import { runFlow, runFlowWithAI } from "../lib/flow/execute.js";
import { stashVariantImages, rehydrateVariantImages, IMAGE_STORE_KEY, STASH_UNBOUNDED } from "../lib/storage/imageStore.js";
import { assembleExportBundle } from "../lib/export/bundle.js";
import { stripArtifactsForStorage } from "../lib/artifacts.js";
import { loadBrandKit, saveBrandKit, normalizeBrandKit } from "../lib/brand/store.js";
import * as remote from "../lib/storage/remote.js";
import { generateImage } from "../lib/ai/providers.js";
import { renderBrandImageHint } from "../lib/brand/prompt.js";
import { CanvasStudio } from "./canvas/CanvasStudio.jsx";
import { OrchestratorConsole } from "./OrchestratorConsole.jsx";

const storageKey = "aicrew-studio-next-state-v1";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "/aicrew";

const navItems = [
  ["dashboard", "Dashboard", "◎"],
  ["workbench", "Workbench", "▣"],
  ["canvas", "Canvas", "◳"],
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
  canvas: "无限画布",
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

// 兼容旧 localStorage 形状：新 export 是 {files: 对象数组, fileNames}，旧版可能是 files: string[]。
function exportFileNames(item) {
  if (Array.isArray(item.fileNames)) return item.fileNames;
  return (item.files || []).map(file => (typeof file === "string" ? file : file.name));
}

function findVariantById(state, variantId) {
  for (const list of [state?.tasks, state?.projects]) {
    for (const item of list || []) {
      const found = (item?.variants || []).find(variant => variant.id === variantId);
      if (found) return found;
    }
  }
  return null;
}

function triggerBrowserDownload(name, href, revoke = false) {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  if (revoke) setTimeout(() => URL.revokeObjectURL(href), 0);
}

// 文本文件：内容已内联，直接 Blob 下载。
function downloadTextFile(file) {
  const url = URL.createObjectURL(new Blob([file.content], { type: file.mimeType || "text/plain" }));
  triggerBrowserDownload(file.name, url, true);
}

// 图片：data URL 直接下载；https 先 fetch→blob，失败回退原始 URL（跨域/防盗链兜底）。
async function downloadImageFile(file) {
  if (file.dataUrl) {
    triggerBrowserDownload(file.name, file.dataUrl);
    return;
  }
  try {
    const response = await fetch(file.url);
    const url = URL.createObjectURL(await response.blob());
    triggerBrowserDownload(file.name, url, true);
  } catch {
    triggerBrowserDownload(file.name, file.url);
  }
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
// 不写入主 blob 可避免 localStorage 配额溢出。剥离前会先 stash 到独立 imageStore（见保存副作用），
// 因此封面跨会话不再丢失——读取时由 rehydrateVariantImages 回填。
function stripVariantMedia(variant) {
  if (!variant) return variant;
  const next = variant.artifacts ? { ...variant, artifacts: stripArtifactsForStorage(variant.artifacts) } : variant;
  if (!next.imageUrl) return next;
  const { imageUrl, ...rest } = next;
  return rest;
}

function stripExportMedia(record) {
  if (!record?.files) return record;
  return { ...record, files: stripArtifactsForStorage(record.files) };
}

function sanitizeStateForStorage(state) {
  const stripList = list =>
    (list || []).map(item => (item?.variants ? { ...item, variants: item.variants.map(stripVariantMedia) } : item));
  return {
    ...state,
    tasks: stripList(state.tasks),
    projects: stripList(state.projects),
    exports: (state.exports || []).map(stripExportMedia)
  };
}

// 内存 Storage shim：把服务端 assets store 喂给 imageStore 的纯函数（stash/rehydrate 内部按 storage 读写），
// 从而零改 imageStore.js 即可让封面图走 Supabase。键 IMAGE_STORE_KEY 承载传入 store。
function imageShim(initialStore) {
  const map = new Map();
  if (initialStore) map.set(IMAGE_STORE_KEY, JSON.stringify(initialStore));
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key)
  };
}

// AI 模型选择：Supabase 权威源，失败/空回退 localStorage（仅 model id，无 token）。
async function resolveAiSelection(config) {
  try {
    const doc = await remote.fetchAiSelectionDoc();
    if (doc) return normalizeAiSelection(doc, config);
  } catch {
    // 服务端不可达：回退本地缓存。
  }
  return loadAiSelection(config);
}

async function fetchSystemAiConfig(fetchImpl = fetch) {
  const endpoint = `${basePath}/api/ai/generate`;
  try {
    const response = await fetchImpl(`${basePath}/api/ai/config`, { cache: "no-store" });
    if (!response.ok) throw new Error(`系统 AI 配置读取失败 (${response.status})`);
    const config = normalizeSystemAiConfig({ ...(await response.json()), endpoint });
    return { ...config, selection: await resolveAiSelection(config) };
  } catch (error) {
    const config = normalizeSystemAiConfig({
      configured: false,
      endpoint,
      error: error instanceof Error ? error.message : String(error)
    });
    return { ...config, selection: loadAiSelection(config) };
  }
}

function aiRuntimeText(aiConfig) {
  if (!isAiConfigured(aiConfig)) return "未配置系统 AI · 运行模拟";
  return `${aiConfig.providerName} · ${describeSelectedModel(aiConfig, aiConfig.selection, "text")}`;
}

export function AICrewStudio({ initialView = "dashboard" }) {
  const [state, setState] = useState(null);
  const [view, setView] = useState(initialView);
  const [selectedVariantId, setSelectedVariantId] = useState(null);
  // AI 平台配置来自 server env；浏览器只保存“选择哪个系统模型”的 id，不接收 token/baseURL。
  const [aiConfig, setAiConfig] = useState(() => normalizeSystemAiConfig());
  const [generating, setGenerating] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [workbenchMode, setWorkbenchMode] = useState("auto");
  // 服务端可达门：仅当挂载时成功读到 server（snapshot 与 assets 均可达）才允许后续破坏性 replace-all 写，
  // 否则一旦 server 临时不可达就回退本地态、跳过云写，杜绝用空/降级态整覆写清空云端权威数据（评审 D 项）。
  const serverReadyRef = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      // 1) 主快照：Supabase 权威源。服务端有 → 用之 + 用服务端 assets 回填封面；
      //    服务端空 → 读 localStorage 旧数据并迁移上云（首次接入不丢历史）；服务端不可达 → 纯本地兜底。
      let snapshot = null; // undefined=不可达；null=可达但空
      let assetStore = null;
      let assetsReachable = false;
      try {
        snapshot = await remote.fetchSnapshot();
      } catch {
        snapshot = undefined;
      }
      try {
        assetStore = await remote.fetchAssetStore();
        assetsReachable = true;
      } catch {
        assetStore = null;
        assetsReachable = false;
      }
      const snapshotReachable = snapshot !== undefined;
      // 服务端完全可达才开放云写门：任一读失败都说明可能存在未读到的云端数据，不可用本地态去 replace-all 覆写。
      serverReadyRef.current = snapshotReachable && assetsReachable;

      let baseState;
      if (snapshot) {
        // assets 可达 → 用服务端 assets 回填；assets 不可达 → 回退本地 imageStore（默认 storage），不可用空 shim 抹掉封面。
        baseState = assetsReachable
          ? rehydrateVariantImages(snapshot, imageShim(assetStore))
          : rehydrateVariantImages(snapshot);
      } else {
        // 本地兜底（默认 window.localStorage）。
        baseState = rehydrateVariantImages(readState());
        // 仅当服务端可达且确为空（null）时迁移本地历史上云；不可达（undefined）不写，避免污染。
        if (snapshot === null) {
          try {
            const shim = imageShim(null);
            stashVariantImages(baseState, shim, STASH_UNBOUNDED); // 迁移不裁剪：云端无配额
            const migratedAssets = shim.getItem(IMAGE_STORE_KEY);
            if (migratedAssets) await remote.pushAssetStore(JSON.parse(migratedAssets));
            await remote.pushSnapshot(sanitizeStateForStorage(baseState));
            serverReadyRef.current = true; // 迁移成功 → 已与云端对齐，开放后续云写
          } catch {
            // 迁移失败不阻断启动；下次状态变更会重试落库。
          }
        }
      }

      // 2) 品牌记忆：Supabase 优先；服务端空则把本地品牌迁移上云。
      let brandKit;
      try {
        const remoteBrand = await remote.fetchBrand();
        if (remoteBrand) {
          brandKit = normalizeBrandKit(remoteBrand);
        } else {
          brandKit = loadBrandKit();
          remote.pushBrand(brandKit).catch(() => {});
        }
      } catch {
        brandKit = loadBrandKit();
      }

      if (!alive) return;
      // 启动调和：被 reload 打断的孤儿 running/queued task → failed-interrupted，避免永久卡「运行中」。
      const nextState = reconcileInterruptedTasks({ ...baseState, brandKit });
      setState(nextState);
      setSelectedVariantId(nextState.tasks?.[0]?.variants?.[0]?.id || null);
    })();

    fetchSystemAiConfig().then(config => {
      if (alive) setAiConfig(config);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!state) return undefined;
    // 本地缓存（离线兜底）：保持既有 stash + 主 blob 落 localStorage，断网仍可恢复。
    try {
      stashVariantImages(state);
      window.localStorage.setItem(storageKey, JSON.stringify(sanitizeStateForStorage(state)));
    } catch {
      // 配额超限/序列化失败时静默降级：内存态不受影响，仅本次不落本地缓存。
    }
    // Supabase 权威写入（防抖 600ms）：仅在服务端可达门开放时执行，避免用降级态 replace-all 清空云端。
    // 经 serializeWrite 串行化，杜绝两次写乱序落库致旧态覆写新态（评审 E 项）。stash 用 UNBOUNDED 不裁剪（评审 C 项）。
    if (!serverReadyRef.current) return undefined;
    const handle = setTimeout(() => {
      remote
        .serializeWrite(async () => {
          const shim = imageShim(null);
          stashVariantImages(state, shim, STASH_UNBOUNDED);
          const raw = shim.getItem(IMAGE_STORE_KEY);
          await remote.pushAssetStore(raw ? JSON.parse(raw) : { items: [] });
          await remote.pushSnapshot(sanitizeStateForStorage(state));
        })
        .catch(() => {
          // 服务端不可达：本地缓存已留底，下次状态变更自动重试，不丢数据。
        });
    }, 600);
    return () => clearTimeout(handle);
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

  // 把本次 brief 携带的上传素材登记进素材库（按 name 去重），闭合「上传→刷新后素材库可见」链路。
  // 素材的 dataURL 存在 asset.ref 上，避免后续静默丢失。
  function ingestBriefMaterials(brief) {
    const materials = Array.isArray(brief?.materials) ? brief.materials : [];
    if (!materials.length) return;
    setState(current => {
      const existing = new Set(current.assets.map(asset => asset.name));
      const fresh = materials
        .filter(material => material.name && !existing.has(material.name))
        .map(material => ({ ...createAsset("image", material.name, "upload", ["uploaded", "material"]), ref: material.ref }));
      if (!fresh.length) return current;
      return { ...current, assets: [...fresh, ...current.assets] };
    });
  }

  // Flow 编排执行：三模式控制台统一入口。与 runAndCommit 同样的 AI/模拟兜底与提交逻辑，
  // 区别仅在用 Flow 编排图（runFlow）而非预设 skillId 驱动管线。
  async function runFlowAndCommit(brief, flow, meta) {
    setGenerating(true);
    ingestBriefMaterials(brief);
    try {
      const nextTask = isAiConfigured(aiConfig)
        ? await runFlowWithAI({ brief, flow, brandKit: state.brandKit, aiConfig, meta })
        : runFlow({ brief, flow, brandKit: state.brandKit, meta });
      commitGeneratedTask(
        nextTask,
        `${brief.productName} ${brief.platform} 编排`,
        `${brief.productName} 编排生成（${meta?.category || "Flow"}）`
      );
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

  async function refreshAiConfig() {
    setAiConfig(await fetchSystemAiConfig());
  }

  function updateAiSelection(nextSelection) {
    setAiConfig(current => {
      const normalized = normalizeSystemAiConfig(current);
      const selection = saveAiSelection(nextSelection, normalized); // 本地缓存
      remote.pushAiSelectionDoc(selection).catch(() => {}); // Supabase 权威源（best-effort，本地已留底）
      return { ...normalized, selection };
    });
  }

  // 写穿 Supabase（权威）+ 本地 brandStore（离线缓存）并同步内存态；brandKit 由 store 归一化后回填。
  function saveBrand(nextBrandKit) {
    const normalized = saveBrandKit(nextBrandKit);
    remote.pushBrand(normalized).catch(() => {});
    setState(current => ({ ...current, brandKit: normalized }));
  }

  // 注入给画布的 AI 生成句柄：真调用 generateImage + 品牌审美提示。lib/canvas 不直接 import ai，保隔离。
  async function generateCanvasImage(prompt) {
    const hint = renderBrandImageHint(state.brandKit);
    return generateImage(aiConfig, { prompt: hint ? `${prompt}。${hint}` : prompt });
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

  function retryAgent(agentId) {
    if (!task) return;
    const { task: nextTask, cost } = retryAgentStep(task, agentId);
    setState(current => {
      const nextTasks = current.tasks.map(item => (item.id === task.id ? nextTask : item));
      const nextProjects = current.projects.map(item =>
        item.taskId === task.id
          ? {
              ...item,
              status: nextTask.status,
              updatedAt: nextTask.updatedAt,
              qualityScore: nextTask.qa.overallScore
            }
          : item
      );
      return {
        ...current,
        tasks: nextTasks,
        projects: nextProjects,
        workspace: {
          ...current.workspace,
          credits: Math.max(0, current.workspace.credits - cost)
        },
        creditLedger: [
          {
            id: makeId("credit"),
            type: "consume",
            amount: -cost,
            label: "Agent retry: " + agentId,
            createdAt: new Date().toISOString()
          },
          ...current.creditLedger
        ],
        notifications: [
          {
            id: makeId("notice"),
            level: "success",
            title: "Agent 已重试：" + agentId,
            createdAt: new Date().toISOString()
          },
          ...current.notifications
        ]
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
    const record = buildExportRecord(project, activeVariant, task?.brief.platform || "抖音", { brief: task?.brief, taskArtifacts: task?.artifacts });
    setState(current => ({
      ...current,
      exports: [record, ...current.exports]
    }));
    navigate("exports");
  }

  // 重置 demo：清本地缓存 + 内存初始态。setState 触发 save effect 把初始 snapshot/assets replace-all 重置云端；
  // 品牌为独立单例文档（不在主 snapshot），故显式重置云端 brand，避免「重置」后旧品牌记忆从云端回流。
  function resetDemo() {
    const freshBrand = normalizeBrandKit({});
    window.localStorage.removeItem(storageKey);
    saveBrandKit(freshBrand);
    const nextState = { ...createInitialState(), brandKit: freshBrand };
    setState(nextState);
    setSelectedVariantId(nextState.tasks?.[0]?.variants?.[0]?.id || null);
    if (serverReadyRef.current) {
      remote.serializeWrite(() => remote.pushBrand(freshBrand)).catch(() => {});
    }
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
    <div className={`app-shell ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`}>
      <Sidebar
        state={state}
        view={view}
        navigate={navigate}
        aiConfig={aiConfig}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed(value => !value)}
      />
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
              onRetryAgent={retryAgent}
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
              onRunFlow={runFlowAndCommit}
              reviseHook={reviseHook}
              addAsset={addAsset}
              saveCurrentSkill={saveCurrentSkill}
              exportVariant={exportVariant}
              generating={generating}
              aiConfig={aiConfig}
              onRetryAgent={retryAgent}
              onModeChange={setWorkbenchMode}
              onGenerateImage={isAiConfigured(aiConfig) ? generateCanvasImage : undefined}
            />
          )}
          {view === "canvas" && (
            <CanvasStudio
              onGenerateImage={isAiConfigured(aiConfig) ? generateCanvasImage : undefined}
              covers={(task?.variants || []).filter(variant => variant.imageUrl).map(variant => ({ src: variant.imageUrl, name: variant.name }))}
            />
          )}
          {view === "settings" && (
            <AiSettings aiConfig={aiConfig} onSelectionChange={updateAiSelection} onRefresh={refreshAiConfig} agentCatalog={agentCatalog} />
          )}
          {view === "projects" && <Projects state={state} task={task} navigate={navigate} />}
          {view === "assets" && <Assets state={state} addAsset={addAsset} />}
          {view === "skills" && <Skills allSkills={allSkills} />}
          {view === "brand" && <Brand state={state} saveBrand={saveBrand} />}
          {view === "exports" && <Exports state={state} />}
          {view === "billing" && <Billing state={state} />}
          {view === "admin" && <Admin state={state} />}
          {view === "onboarding" && <Onboarding state={state} updateProfile={updateProfile} />}
        </section>
      </main>
      <FloatingCommandLayer state={state} view={view} navigate={navigate} manualWorkbench={view === "workbench" && workbenchMode === "manual"} />
    </div>
  );
}

function Sidebar({ state, view, navigate, aiConfig, collapsed, onToggleCollapsed }) {
  const creditRatio = Math.min(100, Math.round((state.workspace.credits / state.workspace.monthlyCredits) * 100));
  return (
    <aside className={`sidebar ${collapsed ? "is-collapsed" : ""}`}>
      <div className="sidebar-head">
        <button className="brand-lockup reset-button" onClick={() => navigate("dashboard")} aria-label="AICrew Studio">
          <span className="brand-mark">AI</span>
          <span>
            <strong>AICrew</strong>
            <small>Creative OS</small>
          </span>
        </button>
        <button
          type="button"
          className="sidebar-toggle reset-button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "展开左侧栏" : "折叠左侧栏"}
          aria-pressed={collapsed}
          title={collapsed ? "展开左侧栏" : "折叠左侧栏"}
        >
          <span>{collapsed ? "›" : "‹"}</span>
        </button>
      </div>
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

function FloatingCommandLayer({ state, view, navigate, manualWorkbench }) {
  const latestTask = state.tasks?.[0];
  const agentsOnline = latestTask?.agents?.length || 0;
  // 画布视图自带真实工具坞，隐藏全局装饰 dock 避免双坞重叠。
  if (view === "canvas") return null;
  return (
    <div className={`floating-command-layer ${manualWorkbench ? "is-manual-workbench" : ""}`} aria-hidden={false}>
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
      {/* 底部操作栏（选择/抓手/添加/撤销/重做）由手动模式内嵌的 CanvasStudio 自带真实工具坞承担，
          满足「只在手动模式显示」要求；此处全局装饰版移除，避免双坞与跨模式显示。*/}
      {!manualWorkbench && (
        <div className="zoom-dock" aria-label="Canvas status">
          <span>{agentsOnline} agents</span>
          <strong>{state.workspace.credits.toLocaleString()}</strong>
          <em>credits</em>
        </div>
      )}
    </div>
  );
}

function Dashboard({ state, task, project, generateQuick, navigate, generating, aiConfig, onRetryAgent }) {
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
              defaultValue="产品 NovaGlow Lamp，受众 25-38 岁生活方式消费者，目标 推广新品并提升首周转化，抖音 高级快节奏"
            />
            <button className="primary-button" type="submit" disabled={generating}>
              {generating ? "AI 生成中…" : "Run Agent Team"}
            </button>
            <p className="ai-mode-hint">
              {aiRuntimeText(aiConfig)}
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
        <AgentTimeline task={task} onRetry={onRetryAgent} />
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
  onRunFlow,
  reviseHook,
  addAsset,
  saveCurrentSkill,
  exportVariant,
  generating,
  aiConfig,
  onRetryAgent,
  onModeChange,
  onGenerateImage
}) {
  // orchestrator mode 上提到 Workbench：手动模式要让画布占右侧主栏、隐藏 OUTPUT/Runtime，
  // 这些决策在 OrchestratorConsole 之外，故 mode 必须由外层持有并按其重排布局。
  const [orchMode, setOrchMode] = useState("auto");
  // 手动模式默认无 OUTPUT 面板（画布占主区）；运行 Director 后才在画布下方显现结果，
  // 既保留「画布为主区」又解决「手动运行结果不可见」(P1)。切换模式时复位。
  const [manualResultShown, setManualResultShown] = useState(false);
  const isManual = orchMode === "manual";

  useEffect(() => {
    onModeChange?.(orchMode);
  }, [orchMode, onModeChange]);

  // 切模式复位结果显现，避免上一轮结果残留到新模式/新编排。
  function handleModeChange(nextMode) {
    setOrchMode(nextMode);
    setManualResultShown(false);
  }
  // 包一层：手动模式运行完成后显现 OUTPUT（非手动模式 OUTPUT 始终在，无需此标记）。
  async function handleRunFlow(brief, flow, meta) {
    await onRunFlow(brief, flow, meta);
    if (orchMode === "manual") setManualResultShown(true);
  }

  const showOutput = !isManual || manualResultShown;
  return (
    <div className={`workbench-layout ${isManual ? "is-manual" : ""} ${isManual && manualResultShown ? "manual-result" : ""}`}>
      <OrchestratorConsole
        mode={orchMode}
        onModeChange={handleModeChange}
        onRun={handleRunFlow}
        generating={generating}
        aiReady={isAiConfigured(aiConfig)}
        aiConfig={aiConfig}
        task={task}
        onGenerateImage={onGenerateImage}
      />
      {/* 手动模式：流程画布接管右侧主区；OUTPUT + Runtime 默认隐藏，运行后于画布下方整宽显现 */}
      {showOutput && (
        <>
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
        <AgentTimeline task={task} onRetry={onRetryAgent} />
        <QaBox task={task} />
      </section>
        </>
      )}
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
              <span className={"status-chip status-chip--" + project.status}>{statusLabel(project.status)}</span>
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

function Brand({ state, saveBrand }) {
  const brand = state.brandKit;
  // 受控表单：跨会话 Brand Memory，提交后写穿独立 store 并刷新预览。
  const [form, setForm] = useState(() => ({
    name: brand.name,
    slogan: brand.slogan,
    voice: brand.voice,
    aesthetic: brand.aesthetic || "",
    productLine: brand.productLine || "",
    typography: brand.typography || "",
    colors: (brand.colors || []).join(", "),
    forbiddenWords: (brand.forbiddenWords || []).join(", ")
  }));
  const [saved, setSaved] = useState(false);

  function field(key) {
    return event => {
      const { value } = event.target;
      setForm(prev => ({ ...prev, [key]: value }));
      setSaved(false);
    };
  }

  function splitList(value) {
    return value.split(",").map(item => item.trim()).filter(Boolean);
  }

  function submit(event) {
    event.preventDefault();
    saveBrand({
      ...brand,
      name: form.name,
      slogan: form.slogan,
      voice: form.voice,
      aesthetic: form.aesthetic,
      productLine: form.productLine,
      typography: form.typography,
      colors: splitList(form.colors),
      forbiddenWords: splitList(form.forbiddenWords)
    });
    setSaved(true);
  }

  return (
    <div className="page-grid two">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Brand Memory</p>
            <h3>{brand.name}</h3>
          </div>
          {saved && <span className="status-chip">已保存 ✓</span>}
        </div>
        <form className="brief-form" onSubmit={submit}>
          <label>
            品牌名
            <input value={form.name} onChange={field("name")} />
          </label>
          <label>
            Slogan
            <input value={form.slogan} onChange={field("slogan")} />
          </label>
          <label>
            语气
            <textarea rows="2" value={form.voice} onChange={field("voice")} />
          </label>
          <label>
            审美偏好
            <textarea rows="2" value={form.aesthetic} onChange={field("aesthetic")} placeholder="如：高级、留白、冷色调" />
          </label>
          <label>
            产品线
            <input value={form.productLine} onChange={field("productLine")} />
          </label>
          <label>
            字体
            <input value={form.typography} onChange={field("typography")} />
          </label>
          <label>
            品牌色（逗号分隔）
            <input value={form.colors} onChange={field("colors")} />
          </label>
          <label>
            禁用词（逗号分隔）
            <input value={form.forbiddenWords} onChange={field("forbiddenWords")} />
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
          {state.exports.map(item => {
            const fileNames = exportFileNames(item);
            const bundle = assembleExportBundle(item, findVariantById(state, item.variantId));
            return (
              <article className="export-card" key={item.id}>
                <div className="export-icon">{fileNames.some(name => name.endsWith(".mp4")) ? "MP4" : "IMG"}</div>
                <strong>{item.name}</strong>
                <span>
                  {item.platform} · {fileNames.join(" / ")}
                </span>
                <div className="export-downloads">
                  {bundle.textFiles.map(file => (
                    <button key={file.name} type="button" className="ghost-btn" onClick={() => downloadTextFile(file)}>
                      ⇩ {file.name}
                    </button>
                  ))}
                  {bundle.imageFiles.map(file => (
                    <button key={file.name} type="button" className="ghost-btn" onClick={() => downloadImageFile(file)}>
                      ⇩ {file.name}
                    </button>
                  ))}
                  {bundle.failedFiles.map(file => (
                    <button key={file.name} type="button" className="ghost-btn" disabled title={file.error}>
                      失败 · {file.name}
                    </button>
                  ))}
                  {bundle.deferredFiles.map(file => (
                    <button key={file.name} type="button" className="ghost-btn" disabled title={file.reason}>
                      暂未支持 · {file.name}
                    </button>
                  ))}
                </div>
                <small>{formatDate(item.createdAt)}</small>
              </article>
            );
          })}
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

function AiSettings({ aiConfig, onSelectionChange, onRefresh, agentCatalog }) {
  const [mode, setMode] = useState("text");
  const [refreshing, setRefreshing] = useState(false);
  const configured = isAiConfigured(aiConfig);
  const modes = aiConfig?.modes || { text: [], image: [], video: [] };
  const selection = aiConfig?.selection || {};
  const options = modes[mode] || [];

  function chooseModel(nextMode, modelId) {
    onSelectionChange({ ...selection, [nextMode]: modelId });
  }

  async function refresh() {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="page-grid two">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">AI 平台</p>
            <h3>系统模型配置</h3>
          </div>
          <span className={`status-chip ${configured ? "" : "muted"}`}>{configured ? "系统已接入" : "系统未配置"}</span>
        </div>
        <div className="system-ai-summary">
          <strong>{aiConfig?.providerName || "AI Platform"}</strong>
          <span>{configured ? "由项目环境变量提供模型与密钥" : "设置环境变量后重启服务即可启用真实生成"}</span>
        </div>
        <div className="model-mode-tabs" role="tablist" aria-label="AI model modes">
          {Object.entries(AI_MODE_LABELS).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={mode === id ? "active" : ""}
              onClick={() => setMode(id)}
              role="tab"
              aria-selected={mode === id}
            >
              {label}
              <span>{modes[id]?.length || 0}</span>
            </button>
          ))}
        </div>
        <div className="system-model-list">
          {options.length ? (
            options.map(option => (
              <button
                type="button"
                key={option.id}
                className={`system-model-card ${selection[mode] === option.id ? "active" : ""}`}
                onClick={() => chooseModel(mode, option.id)}
                aria-pressed={selection[mode] === option.id}
              >
                <span>
                  <strong>{option.name}</strong>
                  <em>{option.description}</em>
                </span>
                <i>{selection[mode] === option.id ? "✓" : ""}</i>
              </button>
            ))
          ) : (
            <p className="empty-state">未配置{AI_MODE_LABELS[mode]}模型</p>
          )}
        </div>
        <div className="toolbar-actions">
          <button type="button" className="ghost-button" onClick={refresh} disabled={refreshing}>
            {refreshing ? "刷新中…" : "刷新系统配置"}
          </button>
        </div>
        {aiConfig?.error && <p className="ai-status fail">{aiConfig.error}</p>}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Env Contract</p>
            <h3>项目级配置</h3>
          </div>
        </div>
        <ul className="security-notes">
          <li>用户不能输入 token、baseURL 或自定义模型；这些只从服务端环境变量读取。</li>
          <li>前端只拿到模型名称、说明和选择 id；`AICREW_AI_API_KEY` 不返回浏览器。</li>
          <li>必填：`AICREW_AI_BASE_URL`、`AICREW_AI_API_KEY`、`AICREW_AI_TEXT_MODEL`。</li>
          <li>可选：`AICREW_AI_IMAGE_MODEL`、`AICREW_AI_IMAGE_API`、`AICREW_AI_VIDEO_MODEL`、`AICREW_AI_PROVIDER`、`AICREW_AI_MODELS_JSON`。</li>
          <li>未配置时平台保留确定性模拟，所有生成链路仍可演示。</li>
        </ul>
      </section>
      <section className="panel wide agent-settings-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Agent Runtime</p>
            <h3>Agent 设置与执行契约</h3>
          </div>
          <span className="status-chip">{agentCatalog.length} agents</span>
        </div>
        <div className="agent-settings-grid">
          {agentCatalog.map(agent => (
            <article className="agent-settings-card" key={agent.id} style={{ "--agent": agent.accent }}>
              <div>
                <strong>{agent.name}</strong>
                <span>{agent.responsibility}</span>
              </div>
              <dl>
                <div>
                  <dt>Input</dt>
                  <dd>{agent.input}</dd>
                </div>
                <div>
                  <dt>Tools</dt>
                  <dd>{agent.tools.join(" / ")}</dd>
                </div>
                <div>
                  <dt>Eval</dt>
                  <dd>{agent.evaluation}</dd>
                </div>
              </dl>
              <em>{agent.cost} credits / retry</em>
            </article>
          ))}
        </div>
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

const TASK_STATUS_LABELS = { queued: "排队中", running: "运行中", completed: "已完成", failed: "失败" };
function statusLabel(status) {
  return TASK_STATUS_LABELS[status] || status || "";
}

function AgentTimeline({ task, onRetry }) {
  if (!task) return <p className="empty-state">No active task</p>;
  const recentEvents = (task.events || []).slice(-4).reverse();
  return (
    <div className="agent-runtime-stack">
      {task.orchestrator && (
        <article className="orchestrator-card">
          <div>
            <span>ORCH</span>
            <strong>{task.orchestrator.title}</strong>
            <p>{task.orchestrator.summary}</p>
          </div>
          <em>{task.orchestrator.plan?.length || task.agents.length} steps</em>
        </article>
      )}
      <div className="agent-rail">
        {task.agents.map(agent => (
          <article className="agent-step" key={agent.id} style={{ "--agent": agent.accent }}>
            <span />
            <div className="agent-step-body">
              <div className="agent-step-head">
                <div>
                  <strong>{agent.title}</strong>
                  <em>{agent.duration || ""}{agent.retryCount ? " · retried " + agent.retryCount : ""}</em>
                </div>
                <div className="agent-step-actions">
                  <span className={"agent-status agent-status--" + agent.status}>{statusLabel(agent.status)}</span>
                  {onRetry && agent.status === "failed" && (
                    <button className="ghost-button slim" type="button" onClick={() => onRetry(agent.id)}>
                      Retry
                    </button>
                  )}
                </div>
              </div>
              {agent.error && <p className="agent-error">⚠ {agent.error}</p>}
              {agent.summary && <p>{agent.summary}</p>}
              <details className="agent-details">
                <summary>查看输入 / 工具 / 评价</summary>
                <dl>
                  <div>
                    <dt>Input</dt>
                    <dd>{agent.input || "Brief context"}</dd>
                  </div>
                  <div>
                    <dt>Tools</dt>
                    <dd>{agent.tools?.join(" / ") || "workflow tool"}</dd>
                  </div>
                  <div>
                    <dt>Output</dt>
                    <dd>{agent.artifact || agent.output}</dd>
                  </div>
                  <div>
                    <dt>Eval</dt>
                    <dd>{agent.evaluation || "Completed"}</dd>
                  </div>
                </dl>
                <small>{agent.cost || 0} credits · {agent.status}</small>
              </details>
            </div>
          </article>
        ))}
      </div>
      {recentEvents.length > 0 && (
        <div className="agent-events">
          {recentEvents.map(event => (
            <p key={event.id}>
              <span>{event.event}</span>
              <strong>{event.agent}</strong>
              <em>{event.credits} cr</em>
            </p>
          ))}
        </div>
      )}
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
          <span className={"status-chip status-chip--" + task.status}>{statusLabel(task.status)}</span>
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
