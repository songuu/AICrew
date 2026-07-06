"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  agents as agentCatalog,
  buildExportRecord,
  canEditTask,
  createAsset,
  createInitialState,
  createProjectFromTask,
  estimateCredits,
  estimateCreditsForSkill,
  makeId,
  modelRoutes,
  normalizeBrief,
  normalizeStateShape,
  parseBriefText,
  reconcileInterruptedTasks,
  removeAssetFromState,
  reviseVariantHook,
  retryAgentStep,
  runCreativeWorkflow,
  reserveTaskCreditsInState,
  settleTaskCreditsInState,
  saveSkillFromProject,
  setTaskLocked,
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
import { REDNOTE_PUBLISH_DEEPLINK, REDNOTE_PUBLISH_STEPS, supportsRednoteHandoff, buildRednoteShareText } from "../lib/share/rednote.js";
import { stripCollectionMedia } from "../lib/state/storage-sanitize.js";
import {
  setTaskScheduledAt,
  selectRednoteExportsForTask,
  isTaskScheduleEligible,
  selectDueTasks
} from "../lib/schedule/queue.js";
import { buildIcsCalendar, buildScheduleUid } from "../lib/share/ics.js";
import { flowToSkill } from "../lib/flow/model.js";
import { stashVariantImages, rehydrateVariantImages, stashLibraryAssets, rehydrateLibraryAssets, IMAGE_STORE_KEY, STASH_UNBOUNDED } from "../lib/storage/imageStore.js";
import { validateLibraryAsset, normalizeLibraryAsset, normalizeMaterial } from "../lib/storage/materialStore.js";
import { assembleExportBundle } from "../lib/export/bundle.js";
import { stripArtifactsForStorage } from "../lib/artifacts.js";
import { loadBrandKit, saveBrandKit, normalizeBrandKit } from "../lib/brand/store.js";
import * as remote from "../lib/storage/remote.js";
import { renderBrandImageHint } from "../lib/brand/prompt.js";
import { CanvasStudio } from "./canvas/CanvasStudio.jsx";
import { OrchestratorConsole } from "./OrchestratorConsole.jsx";
import { publicFeatureFlagsFromEnv } from "../lib/feature-flags.js";
import { getCreditCatalog, getDailyCheckInState } from "../lib/credit-system.js";

const storageKey = "aicrew-studio-next-state-v1";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "/aicrew";

const navItems = [
  ["dashboard", "Dashboard", "◎"],
  ["workbench", "Workbench", "▣"],
  ["history", "History", "◷"],
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
  history: "历史记录",
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

// .ics 日历文件下载：把排期事件交给用户 OS 日历（到点前原生提醒，tab 关也响）——
// 静态站无后台 push，日历是唯一「tab 关也准时」的零后端提醒主轨。
function downloadIcsFile(name, ics) {
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  triggerBrowserDownload(name, url, true);
}

// ISO UTC 串 ↔ <input type="datetime-local"> 本地值互转。input 用本地墙钟方便用户，
// 存储与 .ics 一律归一到 UTC（toISOString），杜绝 floating time 漂移。
function isoToLocalInput(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = value => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function localInputToIso(localValue) {
  if (!localValue) return null;
  const date = new Date(localValue);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// 到点轮询间隔：1min。对齐后台标签浏览器对 setInterval 的 ≥1min 节流下限；
// 准时性由 .ics OS 日历主轨兜底，本辅轨仅 tab 开时有效。
const DUE_POLL_INTERVAL_MS = 60000;

// task 的展示用产品名（缺省回退「内容」），统一一处避免默认串散落。
function taskProductName(task) {
  return task?.brief?.productName || "内容";
}

// scheduledAt 是否为可解析的有效时刻（防损坏/篡改存储里的非 ISO truthy 串触发下游抛出）。
function hasValidSchedule(task) {
  return Boolean(task?.scheduledAt) && !Number.isNaN(Date.parse(task.scheduledAt));
}

// —— 小红书一键带稿交接（Tier 0）的浏览器副作用层 ——
// 纯逻辑在 lib/share/rednote.js；这里只做 clipboard / Web Share / 文件抓取，全部带兜底。

// 复制结构化文案到剪贴板，返回是否成功（不抛错，UI 据此给反馈）。
async function copyShareText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// 把导出图片（dataUrl / https url）转成 Web Share 需要的 File；失败返回 null（被调用方过滤）。
async function fileFromExportImage(file) {
  try {
    const source = file.dataUrl || file.url;
    if (!source) return null;
    const blob = await (await fetch(source)).blob();
    return new File([blob], file.name || "image.png", { type: blob.type || "image/png" });
  } catch {
    return null;
  }
}

// 一键分享到小红书：优先 Web Share 带图+文案 → 退化为仅文案分享 → 再退化为复制文案。
// 返回一句给用户的状态文案；用户取消分享不算失败。
async function shareToRednote(text, imageFiles = []) {
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  let files = [];
  try {
    files = (await Promise.all(imageFiles.map(fileFromExportImage))).filter(Boolean);
  } catch {
    files = [];
  }
  try {
    if (canShare && files.length && navigator.canShare?.({ files })) {
      await navigator.share({ files, text, title: "小红书笔记" });
      return "已唤起系统分享，选择小红书完成发布";
    }
    if (canShare) {
      await navigator.share({ text, title: "小红书笔记" });
      return "已唤起系统分享（文案）；图片请用下方下载按钮保存后选图";
    }
  } catch (error) {
    if (error && error.name === "AbortError") return "已取消分享";
    // 其余错误（权限/不支持）落到复制兜底
  }
  const copied = await copyShareText(text);
  return copied
    ? "本设备不支持系统分享，已复制文案；下载图片后到小红书发布器粘贴"
    : "请手动复制文案并下载图片后到小红书发布";
}

// 一键带稿去发布（无凭证替代方案）：自动选最优合规路径——
// 移动端优先 Web Share 带图（文案随附）；否则复制文案 + 唤起官方发布器，落地后长按粘贴。
// 终点仍是用户在小红书发布器手动确认，不做任何自动发布。
async function oneClickRednotePublish(text, imageFiles = []) {
  let files = [];
  try {
    files = (await Promise.all((imageFiles || []).map(fileFromExportImage))).filter(Boolean);
  } catch {
    files = [];
  }
  // 路径一：Web Share 带图（text 已随附，无需先复制）
  if (typeof navigator !== "undefined" && typeof navigator.share === "function" && files.length && navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files, text, title: "小红书笔记" });
      return "已带图唤起分享，选择小红书后粘贴文案即可发布";
    } catch (error) {
      if (error && error.name === "AbortError") return "已取消";
      // 分享失败则落到深链路径
    }
  }
  // 路径二：复制文案 + 唤起官方发布器（落地后长按粘贴）
  const copied = await copyShareText(text);
  try {
    window.location.href = REDNOTE_PUBLISH_DEEPLINK;
    return copied ? "文案已复制并唤起发布器，落地后长按粘贴发布" : "已唤起发布器，请手动粘贴文案";
  } catch {
    return copied ? "文案已复制，请打开小红书新建笔记后粘贴发布" : "请手动复制文案到小红书发布";
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

// 持久化前剥离 asset.ref：上传素材的二进制（base64 data URL）下沉到独立 aicrew_assets
// （命名空间 library:<id>），与变体封面同源治理。剥离前由保存副作用 stashLibraryAssets，
// 读取时 rehydrateLibraryAssets 回填，因此素材跨会话不丢，又不撑爆主 snapshot。
function stripAssetMedia(asset) {
  if (!asset?.ref) return asset;
  const { ref, ...rest } = asset;
  return rest;
}

function sanitizeStateForStorage(state) {
  // 用纯逻辑 stripCollectionMedia 保证 task/project 项级标量（含 task.scheduledAt 排期）存活，
  // 只剥变体媒体；契约由 lib/state/storage-sanitize.js 单测守护（见 tests/schedule-persistence.test.js）。
  return {
    ...state,
    tasks: stripCollectionMedia(state.tasks, stripVariantMedia),
    projects: stripCollectionMedia(state.projects, stripVariantMedia),
    exports: (state.exports || []).map(stripExportMedia),
    assets: (state.assets || []).map(stripAssetMedia)
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

function initialSystemAiConfig(input) {
  return normalizeSystemAiConfig(input || {
    features: publicFeatureFlagsFromEnv({
      NEXT_PUBLIC_AICREW_CREDITS_ENABLED: process.env.NEXT_PUBLIC_AICREW_CREDITS_ENABLED
    })
  });
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
      features: publicFeatureFlagsFromEnv({
        NEXT_PUBLIC_AICREW_CREDITS_ENABLED: process.env.NEXT_PUBLIC_AICREW_CREDITS_ENABLED
      }),
      error: error instanceof Error ? error.message : String(error)
    });
    return { ...config, selection: loadAiSelection(config) };
  }
}

function aiRuntimeText(aiConfig) {
  if (!isAiConfigured(aiConfig)) return "未配置系统 AI · 运行模拟";
  return `${aiConfig.providerName} · ${describeSelectedModel(aiConfig, aiConfig.selection, "text")}`;
}

function creditsEnabledFor(aiConfig) {
  return aiConfig?.features?.creditsEnabled !== false;
}

function assetToMaterial(asset) {
  return normalizeMaterial({
    name: asset?.name,
    type: asset?.mimeType || asset?.type,
    ref: asset?.ref || ""
  });
}
export function AICrewStudio({ initialView = "dashboard", initialAiConfig = null }) {
  const [state, setState] = useState(null);
  const [view, setView] = useState(() => {
    const config = initialSystemAiConfig(initialAiConfig);
    return !creditsEnabledFor(config) && initialView === "billing" ? "dashboard" : initialView;
  });
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [selectedVariantId, setSelectedVariantId] = useState(null);
  const [editSeed, setEditSeed] = useState(null);
  const [referencedAssetIds, setReferencedAssetIds] = useState([]);
  // AI 平台配置来自 server env；浏览器只保存“选择哪个系统模型”的 id，不接收 token/baseURL。
  const [aiConfig, setAiConfig] = useState(() => initialSystemAiConfig(initialAiConfig));
  const [generating, setGenerating] = useState(false);
  const [retryingAgentId, setRetryingAgentId] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [workbenchMode, setWorkbenchMode] = useState("auto");
  const [dailyCheckInPending, setDailyCheckInPending] = useState(false);
  // 服务端可达门：仅当挂载时成功读到 server（snapshot 与 assets 均可达）才允许后续破坏性 replace-all 写，
  // 否则一旦 server 临时不可达就回退本地态、跳过云写，杜绝用空/降级态整覆写清空云端权威数据（评审 D 项）。
  const serverReadyRef = useRef(false);
  const generatingRef = useRef(false);
  const retryingAgentRef = useRef(null);
  // 排期到点提醒（站内 toast 辅轨）：最新态镜像 + 已触发去重集合。见下方 due-poll useEffect。
  const dueReminderStateRef = useRef(null);
  const firedRemindersRef = useRef(new Set());

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
        // assets 可达 → 用服务端 assets 同时回填变体封面与库素材 ref；assets 不可达 → 回退本地 imageStore（默认 storage），不可用空 shim 抹掉媒体。
        if (assetsReachable) {
          const shim = imageShim(assetStore);
          baseState = rehydrateLibraryAssets(rehydrateVariantImages(snapshot, shim), shim);
        } else {
          baseState = rehydrateLibraryAssets(rehydrateVariantImages(snapshot));
        }
      } else {
        // 本地兜底（默认 window.localStorage）。
        baseState = rehydrateLibraryAssets(rehydrateVariantImages(readState()));
        // 仅当服务端可达且确为空（null）时迁移本地历史上云；不可达（undefined）不写，避免污染。
        if (snapshot === null) {
          try {
            const shim = imageShim(null);
            stashVariantImages(baseState, shim, STASH_UNBOUNDED); // 迁移不裁剪：云端无配额
            stashLibraryAssets(baseState, shim, STASH_UNBOUNDED); // 库素材二进制一并迁移上云
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
      const nextState = reconcileInterruptedTasks(normalizeStateShape({ ...baseState, brandKit }));
      setState(nextState);
      setSelectedTaskId(nextState.tasks?.[0]?.id || null);
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
      stashLibraryAssets(state);
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
          stashLibraryAssets(state, shim, STASH_UNBOUNDED); // 同 shim 合并：避免 replace-all 抹掉库素材行
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

  const task = state?.tasks?.find(item => item.id === selectedTaskId) || state?.tasks?.[0];
  const project = state?.projects?.find(item => item.taskId === task?.id) || state?.projects?.[0];
  const allSkills = useMemo(() => [...skills, ...(state?.customSkills || [])], [state]);
  const creditsEnabled = creditsEnabledFor(aiConfig);
  const referencedMaterials = useMemo(() => {
    if (!state) return [];
    const ids = new Set(referencedAssetIds);
    return state.assets.filter(asset => ids.has(asset.id)).map(assetToMaterial);
  }, [state, referencedAssetIds]);
  const activeVariant = task?.variants.find(item => item.id === selectedVariantId) || task?.variants?.[0];

  useEffect(() => {
    if (!creditsEnabled && view === "billing") navigate("dashboard");
  }, [creditsEnabled, view]);

  useEffect(() => {
    if (!state || !creditsEnabled || view !== "billing") return undefined;
    let alive = true;
    remote
      .fetchCreditWallet()
      .then(result => {
        if (!alive || result?.disabled) return;
        setState(current => current ? mergeServerCreditTransaction(current, result) : current);
      })
      .catch(error => {
        if (!alive) return;
        setState(current => current ? addCreditFailureNoticeToState(current, "签到钱包同步", error) : current);
      });
    return () => {
      alive = false;
    };
  }, [creditsEnabled, view, state?.workspace?.id]);

  useEffect(() => {
    if (!task) return;
    if (!selectedTaskId || selectedTaskId !== task.id) setSelectedTaskId(task.id);
    if (!task.variants?.some(item => item.id === selectedVariantId)) {
      setSelectedVariantId(task.variants?.[0]?.id || null);
    }
  }, [task?.id, selectedTaskId, selectedVariantId]);

  // 排期到点最新态镜像（标准 latest-ref 模式，放进 effect 保持 render 纯度）。
  useEffect(() => {
    dueReminderStateRef.current = state;
  }, [state]);

  // 排期到点「站内 toast 辅轨」+ 到期队列时钟驱动：净新增单个周期计时器（全仓首个 setInterval）。
  // 每 tick 既刷新 nowTick（显式驱动 DueScheduleQueue 到点重渲染，render 保持纯函数、不在 render 内读时钟），
  // 又补发到点 toast。仅 tab 开时有效，后台标签被节流到 ≥1min——准时性由 .ics OS 日历主轨兜底。
  // 双重去重：内存 firedRef（本会话，改期自动重新武装）+ 已落库 notifications 的 reminderKey（跨刷新），
  // 杜绝过期排期每次刷新重复追加致 notifications 无界增长。卸载时 clearInterval。
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    function checkDueSchedules() {
      const stamp = Date.now();
      setNowTick(stamp);
      const snapshot = dueReminderStateRef.current;
      if (!snapshot) return;
      const persistedKeys = new Set(
        (snapshot.notifications || []).map(notice => notice.reminderKey).filter(Boolean)
      );
      const fresh = selectDueTasks(snapshot, stamp).filter(item => {
        const key = `${item.id}:${item.scheduledAt}`;
        return !firedRemindersRef.current.has(key) && !persistedKeys.has(key);
      });
      if (!fresh.length) return;
      fresh.forEach(item => firedRemindersRef.current.add(`${item.id}:${item.scheduledAt}`));
      setState(current =>
        fresh.reduce(
          (acc, item) =>
            addNotificationToState(acc, {
              level: "info",
              reminderKey: `${item.id}:${item.scheduledAt}`,
              title: `排期到点：${taskProductName(item)} 可一键带稿去小红书发布`
            }),
          current
        )
      );
    }
    checkDueSchedules();
    const timer = setInterval(checkDueSchedules, DUE_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  function navigate(nextView) {
    const targetView = !creditsEnabled && nextView === "billing" ? "dashboard" : nextView;
    setView(targetView);
    window.history.pushState(null, "", hrefFor(targetView));
  }

  // 就地选中：仅切换当前历史任务，不离开历史页 —— 右侧 detail 面板随即显示该任务的「之前效果」。
  function selectHistoryTask(nextTask) {
    if (!nextTask) return;
    setSelectedTaskId(nextTask.id);
    setSelectedVariantId(nextTask.variants?.[0]?.id || null);
  }

  function openHistoryTask(nextTask, nextView = "workbench") {
    if (!nextTask) return;
    setSelectedTaskId(nextTask.id);
    setSelectedVariantId(nextTask.variants?.[0]?.id || null);
    navigate(nextView);
  }

  function editHistoryTask(nextTask) {
    if (!canEditTask(nextTask)) return;
    openHistoryTask(nextTask, "workbench");
    setEditSeed({
      id: `${nextTask.id}:${Date.now()}`,
      brief: nextTask.brief,
      skillId: nextTask.skillId
    });
  }

  function toggleHistoryLock(taskId) {
    const nextTask = state?.tasks?.find(item => item.id === taskId);
    setState(current => setTaskLocked(current, taskId, !nextTask?.locked));
  }

  // 排期层：给 task 设/清排期时间（ISO UTC 串或 null）。纯逻辑落 lib/schedule/queue.js，
  // 写入即随顶层 [state] effect 的 600ms debounce→replace-all 持久化到 aicrew_tasks.payload。
  function setTaskSchedule(taskId, isoUtc) {
    setState(current => setTaskScheduledAt(current, taskId, isoUtc));
  }

  function toggleAssetReference(assetId) {
    setReferencedAssetIds(current =>
      current.includes(assetId) ? current.filter(id => id !== assetId) : [...current, assetId]
    );
  }

  function deleteAsset(assetId) {
    setState(current => removeAssetFromState(current, assetId));
    setReferencedAssetIds(current => current.filter(id => id !== assetId));
  }
  function addNotificationToState(current, notice) {
    return {
      ...current,
      notifications: [
        {
          id: makeId("notice"),
          createdAt: new Date().toISOString(),
          ...notice
        },
        ...current.notifications
      ]
    };
  }

  function addCreditFailureNoticeToState(current, label, error) {
    const detail = error instanceof Error ? error.message : String(error || "unknown error");
    return addNotificationToState(current, {
      level: "warning",
      title: label + " 积分处理失败：" + detail
    });
  }

  function addRunFailureNoticeToState(current, label, error) {
    const detail = error instanceof Error ? error.message : String(error || "unknown error");
    return addNotificationToState(current, {
      level: "warning",
      title: label + " 执行失败：" + detail
    });
  }

  function ensureCreditsBeforeRun(amount, label) {
    if (!creditsEnabled) return true;
    const required = Number.isFinite(amount) ? Math.max(0, Math.trunc(amount)) : 0;
    const available = Number.isFinite(state.workspace?.credits) ? Math.max(0, Math.trunc(state.workspace.credits)) : 0;
    if (required <= 0 || available >= required) return true;
    setState(current => addNotificationToState(current, {
      level: "warning",
      title: label + " 需要 " + required + " credits，当前可用 " + available + "，差额 " + (required - available) + "。"
    }));
    navigate("billing");
    return false;
  }

  function reservationTask(reservationId, reserveAmount, status = "running") {
    return {
      id: reservationId,
      status,
      credits: { estimated: reserveAmount, actual: 0 }
    };
  }

  function reserveRunCredits(reservationId, reserveAmount, label, reason) {
    if (!creditsEnabled) return true;
    try {
      const nextState = reserveTaskCreditsInState(state, reservationTask(reservationId, reserveAmount), {
        reservationId,
        reserveAmount,
        label,
        reason
      });
      setState(nextState);
      return true;
    } catch (error) {
      setState(current => addCreditFailureNoticeToState(current, label, error));
      navigate("billing");
      return false;
    }
  }

  function releaseRunCredits(reservationId, reserveAmount, label, reason) {
    if (!creditsEnabled) return;
    setState(current => {
      try {
        return settleTaskCreditsInState(current, reservationTask(reservationId, reserveAmount, "failed"), {
          reservationId,
          reserveAmount,
          actualAmount: 0,
          release: true,
          label,
          reason
        });
      } catch (error) {
        return addCreditFailureNoticeToState(current, label, error);
      }
    });
  }
  function mergeServerCreditTransaction(current, result) {
    const entry = result?.ledgerEntry;
    const nextCredits = Number.isFinite(result?.credits) ? result.credits : current.workspace.credits;
    const nextReservedCredits = Number.isFinite(result?.reservedCredits) ? result.reservedCredits : current.workspace.reservedCredits || 0;
    const nextLedger = entry
      ? [entry, ...current.creditLedger.filter(item => item.id !== entry.id && !(item.reservationId === entry.reservationId && item.type === entry.type))]
      : current.creditLedger;
    const creditWallet = result?.creditWallet || current.creditWallet || null;
    return {
      ...current,
      workspace: {
        ...current.workspace,
        credits: nextCredits,
        reservedCredits: nextReservedCredits,
        creditOpeningBalance: Number.isFinite(result?.openingBalance) ? result.openingBalance : current.workspace.creditOpeningBalance
      },
      creditLedger: Array.isArray(result?.ledger) ? result.ledger : nextLedger,
      creditWallet,
      creditCatalog: creditWallet?.catalog || result?.catalog || current.creditCatalog || null
    };
  }
  function claimDailyCredits() {
    if (!creditsEnabled || dailyCheckInPending) return;
    setDailyCheckInPending(true);
    remote
      .serializeWrite(async () => {
        const result = await remote.grantCredits({
          action: "daily_refresh",
          accountCreatedAt: state.currentUser?.createdAt || state.workspace?.createdAt || state.tasks?.at(-1)?.createdAt || new Date().toISOString()
        });
        if (result?.disabled) throw new Error("积分功能未启用。");
        setState(current => {
          if (!current) return current;
          const next = mergeServerCreditTransaction(current, result);
          const amount = result?.creditWallet?.dailyCheckIn?.amount;
          const title = result?.idempotent
            ? "今日已签到，积分不会重复发放。"
            : `签到成功，已领取 ${Number.isFinite(amount) ? amount.toLocaleString() : "今日"} 积分。`;
          return addNotificationToState(next, { level: "success", title });
        });
      })
      .catch(error => {
        setState(current => current ? addCreditFailureNoticeToState(current, "每日签到", error) : current);
      })
      .finally(() => setDailyCheckInPending(false));
  }
  function syncCreditConsume({ reservationId, taskId, amount, label, reason }) {
    if (!creditsEnabled) return;
    const actualAmount = Number.isFinite(amount) ? Math.max(0, Math.trunc(amount)) : 0;
    if (!serverReadyRef.current || actualAmount <= 0) return;
    remote
      .serializeWrite(async () => {
        const result = await remote.applyCreditTransaction({
          transactionId: "settle:" + reservationId,
          type: "consume",
          amount: -actualAmount,
          label,
          reservationId,
          taskId,
          reason
        });
        setState(current => (current ? mergeServerCreditTransaction(current, result) : current));
      })
      .catch(error => {
        setState(current => current ? addCreditFailureNoticeToState(current, label + " 服务端同步", error) : current);
      });
  }

  async function generateCanvasImage(prompt) {
    const imagePrompt = [prompt, renderBrandImageHint(state.brandKit)].filter(Boolean).join("\n");
    const response = await fetch(aiConfig.endpoint || basePath + "/api/ai/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "image",
        modelId: aiConfig.selection?.image || "auto",
        prompt: imagePrompt
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.imageUrl) throw new Error(data?.error || "AI image generation failed");
    return data.imageUrl;
  }

  async function refreshAiConfig() {
    const nextConfig = await fetchSystemAiConfig();
    setAiConfig(nextConfig);
  }

  function updateAiSelection(selection) {
    const nextSelection = normalizeAiSelection(selection, aiConfig);
    saveAiSelection(nextSelection, aiConfig);
    setAiConfig(current => ({ ...current, selection: nextSelection }));
    if (serverReadyRef.current) remote.serializeWrite(() => remote.pushAiSelectionDoc(nextSelection)).catch(() => {});
  }

  function saveBrand(nextBrand) {
    const brand = normalizeBrandKit(nextBrand);
    saveBrandKit(brand);
    setState(current => ({ ...current, brandKit: brand }));
    if (serverReadyRef.current) remote.serializeWrite(() => remote.pushBrand(brand)).catch(() => {});
  }

  function updateProfile(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    setState(current => ({
      ...current,
      currentUser: {
        ...current.currentUser,
        name: String(data.name || current.currentUser.name),
        email: String(data.email || current.currentUser.email)
      },
      workspace: {
        ...current.workspace,
        name: String(data.workspace || current.workspace.name)
      }
    }));
  }

  function commitGeneratedTask(nextTask, projectName, creditLabel, creditOptions = {}) {
    const reservationId = creditOptions.reservationId || nextTask.id + ":generation";
    const reserveAmount = creditOptions.reserveAmount || nextTask.credits?.estimated || nextTask.credits?.actual || 0;
    setState(current => {
      const nextProject = createProjectFromTask(nextTask, projectName);
      const nextState = {
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
        ]
      };
      if (!creditsEnabled) {
        return addNotificationToState(nextState, {
          level: "success",
          title: nextTask.brief.productName + " 内容包已生成" + (nextTask.aiMeta?.used ? "（" + nextTask.aiMeta.provider + " AI）" : "")
        });
      }
      try {
        const settled = settleTaskCreditsInState(nextState, nextTask, {
          label: creditLabel,
          reservationId,
          reserveAmount,
          reason: creditOptions.reason || "generation"
        });
        queueMicrotask(() => syncCreditConsume({
          reservationId,
          taskId: nextTask.id,
          amount: nextTask.credits?.actual,
          label: creditLabel,
          reason: creditOptions.reason || "generation"
        }));
        return addNotificationToState(settled, {
          level: "success",
          title: nextTask.brief.productName + " 内容包已生成" + (nextTask.aiMeta?.used ? "（" + nextTask.aiMeta.provider + " AI）" : "")
        });
      } catch (error) {
        const released = settleTaskCreditsInState(current, reservationTask(reservationId, reserveAmount, "failed"), {
          label: creditLabel + " reservation released",
          reservationId,
          reserveAmount,
          actualAmount: 0,
          release: true,
          reason: creditOptions.reason || "generation"
        });
        return addCreditFailureNoticeToState(released, creditLabel, error);
      }
    });
    setSelectedTaskId(nextTask.id);
    setSelectedVariantId(nextTask.variants[0]?.id || null);
    navigate("workbench");
  }

  // 已配置 AI → 走真实 LLM（+OpenAI 封面图）；否则回退确定性模拟。
  // 先建立 active reservation，AI/模拟完成后只 settle/release 这条 reservation。
  async function runAndCommit(brief, skillId, projectName, creditLabel) {
    if (generatingRef.current) return;
    generatingRef.current = true;
    setGenerating(true);
    const quote = estimateCredits(brief, skillId);
    const reservationId = makeId("reservation") + ":generation";
    try {
      if (!ensureCreditsBeforeRun(quote.estimated, creditLabel)) return;
      if (!reserveRunCredits(reservationId, quote.estimated, creditLabel, "generation")) return;
      const nextTask = isAiConfigured(aiConfig)
        ? await runCreativeWorkflowWithAI({ brief, skillId, brandKit: state.brandKit, aiConfig })
        : runCreativeWorkflow({ brief, skillId, brandKit: state.brandKit });
      commitGeneratedTask(nextTask, projectName, creditLabel, {
        reservationId,
        reserveAmount: quote.estimated,
        reason: "generation"
      });
    } catch (error) {
      releaseRunCredits(reservationId, quote.estimated, creditLabel, "generation");
      setState(current => (creditsEnabled ? addCreditFailureNoticeToState(current, creditLabel, error) : addRunFailureNoticeToState(current, creditLabel, error)));
    } finally {
      generatingRef.current = false;
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
    if (generatingRef.current) return;
    generatingRef.current = true;
    setGenerating(true);
    const skill = flowToSkill(flow, meta);
    const quote = estimateCreditsForSkill(brief, skill);
    const creditLabel = brief.productName + " 编排生成（" + (meta?.category || "Flow") + "）";
    const reservationId = makeId("reservation") + ":flow";
    try {
      if (!ensureCreditsBeforeRun(quote.estimated, creditLabel)) return;
      if (!reserveRunCredits(reservationId, quote.estimated, creditLabel, "flow")) return;
      ingestBriefMaterials(brief);
      const nextTask = isAiConfigured(aiConfig)
        ? await runFlowWithAI({ brief, flow, brandKit: state.brandKit, aiConfig, meta })
        : runFlow({ brief, flow, brandKit: state.brandKit, meta });
      commitGeneratedTask(
        nextTask,
        brief.productName + " " + brief.platform + " 编排",
        creditLabel,
        { reservationId, reserveAmount: quote.estimated, reason: "flow" }
      );
    } catch (error) {
      releaseRunCredits(reservationId, quote.estimated, creditLabel, "flow");
      setState(current => (creditsEnabled ? addCreditFailureNoticeToState(current, creditLabel, error) : addRunFailureNoticeToState(current, creditLabel, error)));
    } finally {
      generatingRef.current = false;
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
      brief.productName + " " + brief.platform + " launch",
      brief.productName + " generation"
    );
  }

  function generateQuick(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const brief = parseBriefText(data.briefText || data.prompt);
    runAndCommit(
      brief,
      data.skillId || "rednote_seeding_note_v1",
      brief.productName + " quick campaign",
      brief.productName + " quick generation"
    );
  }

  function reviseHook(nextHook) {
    if (!task || !activeVariant || !canEditTask(task)) return;
    const revised = reviseVariantHook(activeVariant, nextHook);
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
    if (!task || !canEditTask(task) || retryingAgentRef.current) return;
    const targetAgent = task.agents.find(agent => agent.id === agentId);
    const retryCost = targetAgent?.cost || agentCatalog.find(agent => agent.id === agentId)?.cost || 8;
    if (!ensureCreditsBeforeRun(retryCost, "Agent retry: " + agentId)) return;
    const reservationId = task.id + ":retry:" + agentId + ":" + makeId("reservation");
    retryingAgentRef.current = agentId;
    setRetryingAgentId(agentId);
    if (!reserveRunCredits(reservationId, retryCost, "Agent retry: " + agentId, "retry")) {
      retryingAgentRef.current = null;
      setRetryingAgentId(null);
      return;
    }
    try {
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
        const nextState = {
          ...current,
          tasks: nextTasks,
          projects: nextProjects
        };
        if (!creditsEnabled) {
          return addNotificationToState(nextState, {
            level: "success",
            title: "Agent 已重试：" + agentId
          });
        }
        const settled = settleTaskCreditsInState(nextState, nextTask, {
          label: "Agent retry: " + agentId,
          reserveAmount: retryCost,
          actualAmount: cost,
          reservationId,
          reason: "retry"
        });
        queueMicrotask(() => syncCreditConsume({
          reservationId,
          taskId: nextTask.id,
          amount: cost,
          label: "Agent retry: " + agentId,
          reason: "retry"
        }));
        return addNotificationToState(settled, {
          level: "success",
          title: "Agent 已重试：" + agentId
        });
      });
    } catch (error) {
      releaseRunCredits(reservationId, retryCost, "Agent retry: " + agentId, "retry");
      setState(current => (creditsEnabled ? addCreditFailureNoticeToState(current, "Agent retry: " + agentId, error) : addRunFailureNoticeToState(current, "Agent retry: " + agentId, error)));
    } finally {
      setTimeout(() => {
        retryingAgentRef.current = null;
        setRetryingAgentId(null);
      }, 0);
    }
  }

  function addAsset(assetInput) {
    setState(current => {
      const normalized = assetInput
        ? normalizeLibraryAsset(assetInput)
        : normalizeLibraryAsset({ name: `Uploaded asset ${current.assets.length + 1}`, type: "image/png", source: "upload", tags: ["product", "new"] });
      const asset = {
        ...createAsset(normalized.type, normalized.name, normalized.source, normalized.tags),
        ...normalized,
        id: makeId("asset"),
        createdAt: normalized.createdAt || new Date().toISOString()
      };
      return { ...current, assets: [asset, ...current.assets] };
    });
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
    setSelectedTaskId(nextState.tasks?.[0]?.id || null);
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
        creditsEnabled={creditsEnabled}
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
              retryingAgentId={retryingAgentId}
              creditsEnabled={creditsEnabled}
            />
          )}
          {view === "history" && (
            <History
              state={state}
              selectedTaskId={task?.id}
              selectTask={selectHistoryTask}
              openTask={openHistoryTask}
              editTask={editHistoryTask}
              toggleLock={toggleHistoryLock}
              setTaskSchedule={setTaskSchedule}
              now={nowTick}
              creditsEnabled={creditsEnabled}
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
              retryingAgentId={retryingAgentId}
              onModeChange={setWorkbenchMode}
              onGenerateImage={isAiConfigured(aiConfig) ? generateCanvasImage : undefined}
              editSeed={editSeed}
              libraryMaterials={referencedMaterials}
              locked={task?.locked}
              creditsEnabled={creditsEnabled}
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
          {view === "assets" && (
            <Assets
              state={state}
              addAsset={addAsset}
              referencedAssetIds={referencedAssetIds}
              toggleAssetReference={toggleAssetReference}
              deleteAsset={deleteAsset}
              navigate={navigate}
            />
          )}
          {view === "skills" && <Skills allSkills={allSkills} creditsEnabled={creditsEnabled} />}
          {view === "brand" && <Brand state={state} saveBrand={saveBrand} />}
          {view === "exports" && <Exports state={state} />}
          {view === "billing" && creditsEnabled && <Billing state={state} onClaimDailyCredits={claimDailyCredits} dailyCheckInPending={dailyCheckInPending} />}
          {view === "admin" && <Admin state={state} creditsEnabled={creditsEnabled} />}
          {view === "onboarding" && <Onboarding state={state} updateProfile={updateProfile} />}
        </section>
      </main>
      <FloatingCommandLayer state={state} view={view} navigate={navigate} manualWorkbench={view === "workbench" && workbenchMode === "manual"} creditsEnabled={creditsEnabled} />
    </div>
  );
}

function Sidebar({ state, view, navigate, aiConfig, collapsed, onToggleCollapsed, creditsEnabled = true }) {
  const visibleNavItems = creditsEnabled ? navItems : navItems.filter(([id]) => id !== "billing");
  const creditRatio = creditsEnabled ? Math.min(100, Math.round((state.workspace.credits / state.workspace.monthlyCredits) * 100)) : 0;
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
        {visibleNavItems.map(([id, label, icon]) => (
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
      {creditsEnabled && (
        <div className="sidebar-footer">
          <div className="credit-ring" style={{ "--value": creditRatio }}>
            <span>{state.workspace.credits}</span>
            <small>credits</small>
          </div>
          <button className="text-link reset-button" onClick={() => navigate("billing")}>
            Studio plan
          </button>
        </div>
      )}
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

function FloatingCommandLayer({ state, view, navigate, manualWorkbench, creditsEnabled = true }) {
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
          {creditsEnabled && <strong>{state.workspace.credits.toLocaleString()}</strong>}
          {creditsEnabled && <em>credits</em>}
        </div>
      )}
    </div>
  );
}

function Dashboard({ state, task, project, generateQuick, navigate, generating, aiConfig, onRetryAgent, retryingAgentId, creditsEnabled = true }) {
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
        {creditsEnabled && <Metric label="可用积分" value={state.workspace.credits.toLocaleString()} caption="current balance" />}
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
        <AgentTimeline task={task} onRetry={onRetryAgent} locked={task?.locked} retryingAgentId={retryingAgentId} creditsEnabled={creditsEnabled} />
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
        <TaskTable tasks={state.tasks.slice(0, 5)} creditsEnabled={creditsEnabled} />
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
  retryingAgentId,
  onModeChange,
  onGenerateImage,
  editSeed,
  libraryMaterials = [],
  locked,
  creditsEnabled = true
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
        editSeed={editSeed}
        libraryMaterials={libraryMaterials}
        creditsEnabled={creditsEnabled}
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
          {locked && <span className="status-chip locked">已锁定</span>}
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
            <VariantDetail variant={variant} reviseHook={reviseHook} locked={locked} />
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
          {creditsEnabled && <span className="status-chip">{task?.credits.actual || 0} credits</span>}
        </div>
        <AgentTimeline task={task} onRetry={onRetryAgent} locked={task?.locked} retryingAgentId={retryingAgentId} creditsEnabled={creditsEnabled} />
        <QaBox task={task} />
      </section>
        </>
      )}
    </div>
  );
}

function History({ state, selectedTaskId, selectTask, openTask, editTask, toggleLock, setTaskSchedule, now, creditsEnabled = true }) {
  const projectByTask = new Map((state.projects || []).map(project => [project.taskId, project]));
  const selectedTask = state.tasks.find(task => task.id === selectedTaskId) || state.tasks[0];
  return (
    <>
      <DueScheduleQueue state={state} now={now} />
      <div className="page-grid two history-page">
      <section className="panel wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">History</p>
            <h3>生成历史</h3>
          </div>
          <span className="status-chip">{state.tasks.length} runs</span>
        </div>
        <div className="history-list">
          {state.tasks.map(item => {
            const project = projectByTask.get(item.id);
            const variant = item.variants?.[0];
            const materialCount = item.brief?.materials?.length || 0;
            const locked = Boolean(item.locked);
            return (
              <article className={`history-row ${item.id === selectedTaskId ? "active" : ""} ${locked ? "locked" : ""}`} key={item.id}>
                <button type="button" className="history-preview reset-button" onClick={() => selectTask(item)} aria-label={`查看 ${item.brief.productName}`}>
                  <PhonePreview variant={variant} />
                </button>
                <div className="history-main">
                  <div className="history-title-line">
                    <div>
                      <strong>{project?.name || `${item.brief.productName} ${item.brief.platform}`}</strong>
                      <span>{item.skillName} · {formatDate(item.updatedAt)}</span>
                    </div>
                    <span className={`status-chip status-chip--${item.status}`}>{statusLabel(item.status)}</span>
                  </div>
                  <p>{variant?.hook || item.brief.goal}</p>
                  <div className="history-meta">
                    <span>{item.variants?.length || 0} variants</span>
                    <span>{item.agents?.length || 0} agents</span>
                    <span>{materialCount} references</span>
                    {creditsEnabled && <span>{item.credits?.actual || 0} credits</span>}
                    {locked && <span>locked</span>}
                  </div>
                  <div className="history-actions">
                    <button type="button" className="ghost-button" onClick={() => selectTask(item)}>
                      查看效果
                    </button>
                    <button type="button" className="primary-button" onClick={() => editTask(item)} disabled={locked} title={locked ? "已锁定，不能重新编辑" : "回填 Brief 并重新编辑"}>
                      重新编辑
                    </button>
                    <button type="button" className="ghost-button" onClick={() => toggleLock(item.id)}>
                      {locked ? "解锁" : "锁定"}
                    </button>
                  </div>
                  {isTaskScheduleEligible(item) && (
                    <ScheduleControl task={item} onSchedule={setTaskSchedule} />
                  )}
                </div>
                <div className={`score-badge ${qualityTone(project?.qualityScore || item.qa?.overallScore || 0)}`}>
                  {project?.qualityScore || item.qa?.overallScore || 0}
                </div>
              </article>
            );
          })}
        </div>
      </section>
      <section className="panel history-detail">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Selected</p>
            <h3>{selectedTask?.brief.productName || "No task"}</h3>
          </div>
          <div className="history-detail-actions">
            {selectedTask?.locked && <span className="status-chip locked">已锁定</span>}
            <button type="button" className="ghost-button" onClick={() => openTask(selectedTask)} disabled={!selectedTask} title="在工作台打开此历史任务">
              在工作台打开
            </button>
          </div>
        </div>
        <HistoryEffect task={selectedTask} />
        <AgentTimeline task={selectedTask} />
      </section>
      </div>
    </>
  );
}
// 历史「之前的效果」面板：把所选历史任务的真实产出（封面预览 + 文案 + 评分）就地铺开，
// 多变体可切换预览。封面 imageUrl 由 rehydrateVariantImages 从 Supabase 回填，故跨会话可见。
function HistoryEffect({ task }) {
  const variants = task?.variants || [];
  const [variantId, setVariantId] = useState(variants[0]?.id || null);
  useEffect(() => {
    setVariantId(task?.variants?.[0]?.id || null);
  }, [task?.id]);
  const active = variants.find(item => item.id === variantId) || variants[0];
  if (!task || !active) return <p className="empty-state">该历史暂无可预览的效果</p>;
  const hashtags = Array.isArray(active.hashtags) ? active.hashtags : [];
  return (
    <div className="history-effect">
      <div className="history-effect-stage">
        <PhonePreview variant={active} size="large" />
      </div>
      <div className="history-effect-side">
        <div className="history-effect-head">
          <strong>
            {active.name} v{active.version}
          </strong>
          <span className={`score-badge ${qualityTone(active.score)}`}>{active.score}</span>
        </div>
        <p className="hook-line">{active.hook}</p>
        {active.caption && (
          <div className="copy-pack">
            <strong>{active.caption}</strong>
            {hashtags.length > 0 && <span>{hashtags.join(" ")}</span>}
          </div>
        )}
        {variants.length > 1 && (
          <div className="history-variant-switch" role="tablist" aria-label="变体切换">
            {variants.map(item => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={item.id === active.id}
                className={`variant-chip ${item.id === active.id ? "active" : ""}`}
                onClick={() => setVariantId(item.id)}
              >
                <span className={`score-badge ${qualityTone(item.score)}`}>{item.score}</span>
                <em>
                  {item.name} v{item.version}
                </em>
              </button>
            ))}
          </div>
        )}
      </div>
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

function Assets({ state, addAsset, referencedAssetIds = [], toggleAssetReference, deleteAsset, navigate }) {
  const [uploadError, setUploadError] = useState("");
  const inputRef = useRef(null);
  const selected = new Set(referencedAssetIds);

  function uploadAssets(event) {
    const files = Array.from(event.target.files || []);
    if (inputRef.current) inputRef.current.value = "";
    setUploadError("");
    files.forEach(file => {
      const check = validateLibraryAsset({ name: file.name, type: file.type, size: file.size });
      if (!check.ok) {
        setUploadError(check.reason);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => addAsset({ name: file.name, type: file.type, size: file.size, ref: reader.result });
      reader.onerror = () => setUploadError(`读取失败：${file.name}`);
      reader.readAsDataURL(file);
    });
  }

  return (
    <div className="page-grid">
      <section className="panel wide assets-library-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Assets</p>
            <h3>素材库</h3>
          </div>
          <div className="toolbar-actions">
            <button className="ghost-button" type="button" onClick={() => navigate("workbench")} disabled={!referencedAssetIds.length}>
              引用并生成
            </button>
            <button className="primary-button" type="button" onClick={() => inputRef.current?.click()}>
              上传文件 / 图片
            </button>
            <input ref={inputRef} type="file" multiple hidden onChange={uploadAssets} accept="image/*,.pdf,.txt,.md,.csv,.json,.doc,.docx,.ppt,.pptx,.xls,.xlsx" />
          </div>
        </div>
        <div className="asset-upload-strip">
          <strong>{referencedAssetIds.length} 个素材已引用到下一次生成</strong>
          <span>支持图片、PDF、文档、表格和文本；文件名会作为生成引用进入 brief。</span>
        </div>
        {uploadError && <p className="oc-material-error">{uploadError}</p>}
        <div className="asset-grid">
          {state.assets.map(asset => (
            <AssetCard
              asset={asset}
              key={asset.id}
              referenced={selected.has(asset.id)}
              onToggleReference={() => toggleAssetReference(asset.id)}
              onDelete={() => deleteAsset(asset.id)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
function Skills({ allSkills, creditsEnabled = true }) {
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

// 小红书一键带稿交接行：复制文案 / 系统分享带图 / 唤起官方发布器。
// 排期控件（绿区半自动）：给含小红书产物的 task 设/清排期时间，并导出 .ics 日历事件。
// 仅在 isTaskScheduleEligible(task) 为真时由 History 渲染（调用方门控）。input 用本地墙钟，
// 存储/.ics 一律 UTC。到点提醒走 OS 日历(.ics 主轨) + 站内 toast(辅轨) 双轨。
function ScheduleControl({ task, onSchedule }) {
  const [value, setValue] = useState(isoToLocalInput(task?.scheduledAt));
  useEffect(() => {
    setValue(isoToLocalInput(task?.scheduledAt));
  }, [task?.id, task?.scheduledAt]);

  function commit(nextLocal) {
    setValue(nextLocal);
    onSchedule(task.id, localInputToIso(nextLocal));
  }

  function downloadIcs() {
    // 仅对可解析时刻导出，挡掉损坏/篡改存储里的非 ISO truthy 串，避免 buildIcsCalendar 抛出。
    if (!hasValidSchedule(task)) return;
    const productName = taskProductName(task);
    const ics = buildIcsCalendar({
      uid: buildScheduleUid(task.id, task.scheduledAt),
      title: `小红书带稿发布：${productName}`,
      description: "AICrew 排期到点，可一键带稿去小红书发布器手动确认发布。",
      startUtc: task.scheduledAt
    });
    downloadIcsFile(`aicrew-${productName}-排期.ics`, ics);
  }

  return (
    <div className="schedule-control">
      <label className="schedule-control-label">排期发布</label>
      <input
        type="datetime-local"
        className="schedule-control-input"
        value={value}
        onChange={event => commit(event.target.value)}
      />
      <div className="schedule-control-actions">
        <button
          type="button"
          className="ghost-btn"
          onClick={downloadIcs}
          disabled={!hasValidSchedule(task)}
          title="导出到系统日历，到点前原生提醒"
        >
          🗓 加入日历(.ics)
        </button>
        {task?.scheduledAt && (
          <button type="button" className="ghost-btn" onClick={() => commit("")}>
            清除排期
          </button>
        )}
      </div>
      {task?.scheduledAt && (
        <small className="schedule-control-hint">
          部分日历（如 Google）会忽略内置提醒、改用其默认通知；站内提醒仅在打开本页时生效。
        </small>
      )}
    </div>
  );
}

// 排期到期队列（最后一公里）：列出到点/逾期且含小红书产物的 task，逐产物复用 RednoteHandoff
// 一键带稿唤起官方发布器（人工确认）。imageFiles 经 assembleExportBundle 派生，强制带图不丢图。
function DueScheduleQueue({ state, now }) {
  const dueTasks = selectDueTasks(state, now);
  if (!dueTasks.length) return null;
  return (
    <section className="panel schedule-due-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Scheduled</p>
          <h3>到期排期 · 可发布</h3>
        </div>
        <span className="status-chip">{dueTasks.length} due</span>
      </div>
      <div className="schedule-due-list">
        {dueTasks.map(task => {
          const rednoteExports = selectRednoteExportsForTask(task);
          const productName = taskProductName(task);
          return (
            <article className="schedule-due-row" key={task.id}>
              <div className="schedule-due-title">
                <strong>{productName}</strong>
                <span>排期 {formatDate(task.scheduledAt)} · {rednoteExports.length} 篇小红书</span>
              </div>
              {rednoteExports.map(item => {
                const variant =
                  (task.variants || []).find(entry => entry.id === item.variantId) || task.variants?.[0];
                const bundle = assembleExportBundle(item, variant);
                return (
                  <div className="schedule-due-export" key={item.variantId || item.name}>
                    <span className="schedule-due-export-name">{item.name}</span>
                    <RednoteHandoff variant={variant} imageFiles={bundle.imageFiles} />
                  </div>
                );
              })}
            </article>
          );
        })}
      </div>
    </section>
  );
}

// 对标小鸡AI App 的发布交接，但终点是用户在小红书发布器手动确认，不做任何自动发布。
function RednoteHandoff({ variant, imageFiles }) {
  const [status, setStatus] = useState("");
  const share = buildRednoteShareText(variant || {});
  if (!share.text) return null;

  async function handleOneClick() {
    setStatus("正在带稿去发布…");
    setStatus(await oneClickRednotePublish(share.text, imageFiles || []));
  }
  async function handleCopy() {
    const ok = await copyShareText(share.text);
    setStatus(ok ? "已复制文案，去小红书发布器粘贴" : "复制失败，请手动选择文案");
  }
  async function handleShare() {
    setStatus("正在准备分享…");
    setStatus(await shareToRednote(share.text, imageFiles || []));
  }
  function handleOpenPublisher() {
    try {
      window.location.href = REDNOTE_PUBLISH_DEEPLINK;
      setStatus("已尝试唤起小红书发布器（需移动端已安装小红书）");
    } catch {
      setStatus("唤起失败，请在手机小红书内手动新建笔记");
    }
  }

  return (
    <div className="export-handoff">
      <span className="export-handoff-label">带到小红书</span>
      <button type="button" className="primary-button export-handoff-primary" onClick={handleOneClick}>
        🚀 一键带稿去发布
      </button>
      <div className="export-handoff-actions">
        <button type="button" className="ghost-btn" onClick={handleCopy}>📋 复制文案</button>
        <button type="button" className="ghost-btn" onClick={handleShare}>📤 分享/带图</button>
        <button type="button" className="ghost-btn" onClick={handleOpenPublisher}>📲 打开发布器</button>
      </div>
      <ol className="export-handoff-steps">
        {REDNOTE_PUBLISH_STEPS.map(step => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {status && (
        <small className="export-handoff-status" role="status">
          {status}
        </small>
      )}
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
            const variant = findVariantById(state, item.variantId);
            const bundle = assembleExportBundle(item, variant);
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
                {supportsRednoteHandoff(item.platform) && <RednoteHandoff variant={variant} imageFiles={bundle.imageFiles} />}
                <small>{formatDate(item.createdAt)}</small>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function Billing({ state, onClaimDailyCredits, dailyCheckInPending = false }) {
  const billingNotice = (state.notifications || []).find(item => ["warning", "success"].includes(item.level) && /credits|积分|签到/i.test(String(item.title || "")));
  const creditWallet = state.creditWallet || null;
  const catalog = creditWallet?.catalog || state.creditCatalog || getCreditCatalog();
  const availableCredits = Number.isFinite(creditWallet?.availableCredits) ? creditWallet.availableCredits : state.workspace.credits;
  const reservedCredits = Number.isFinite(creditWallet?.reservedCredits) ? creditWallet.reservedCredits : state.workspace.reservedCredits || 0;
  const totalCredits = availableCredits + reservedCredits;
  const monthlyCredits = Math.max(1, state.workspace.monthlyCredits || totalCredits || 1);
  const creditRatio = Math.min(100, Math.round((availableCredits / monthlyCredits) * 100));
  const buckets = Array.isArray(creditWallet?.buckets) ? creditWallet.buckets : [];
  const receivedLedger = Array.isArray(creditWallet?.receivedLedger) ? creditWallet.receivedLedger : state.creditLedger.filter(item => item.amount > 0);
  const usedLedger = Array.isArray(creditWallet?.usedLedger) ? creditWallet.usedLedger : state.creditLedger.filter(item => item.amount <= 0);
  const currentPlanId = creditWallet?.planId || state.workspace.plan || "free";
  const accountCreatedAt = state.currentUser?.createdAt || state.workspace?.createdAt || state.tasks?.at(-1)?.createdAt || new Date().toISOString();
  const dailyCheckIn = creditWallet?.dailyCheckIn || getDailyCheckInState({
    ...(creditWallet || {}),
    id: creditWallet?.walletId,
    workspaceId: creditWallet?.workspaceId || state.workspace?.id,
    planId: currentPlanId,
    availableCredits,
    reservedCredits,
    transactions: creditWallet?.transactions || []
  }, { accountCreatedAt });
  const checkedInToday = dailyCheckIn?.checkedIn === true;
  const checkInAmount = Number.isFinite(dailyCheckIn?.amount) ? dailyCheckIn.amount : 0;
  const checkInDisabled = dailyCheckInPending || checkedInToday || checkInAmount <= 0;
  const checkInMeta = checkedInToday
    ? `已于 ${dailyCheckIn.checkedAt ? formatDate(dailyCheckIn.checkedAt) : dailyCheckIn.day} 签到`
    : `${dailyCheckIn?.expiresAt ? `有效期至 ${formatDate(dailyCheckIn.expiresAt)}` : "今日有效"}`;

  return (
    <div className="page-grid two billing-grid">
      <section className="panel billing-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Wallet</p>
            <h3>{catalog.displayName}</h3>
          </div>
          <span className="status-chip">{availableCredits.toLocaleString()} 可用</span>
        </div>
        {billingNotice && <div className={`billing-alert ${billingNotice.level}`}>{billingNotice.title}</div>}
        <div className="wallet-summary">
          <div>
            <span>可用</span>
            <strong>{availableCredits.toLocaleString()}</strong>
          </div>
          <div>
            <span>冻结</span>
            <strong>{reservedCredits.toLocaleString()}</strong>
          </div>
          <div>
            <span>今日到期</span>
            <strong>{(creditWallet?.expiringTodayCredits || 0).toLocaleString()}</strong>
          </div>
          <div>
            <span>永久</span>
            <strong>{(creditWallet?.permanentCredits || availableCredits).toLocaleString()}</strong>
          </div>
        </div>
        <div className="credit-meter" title={`${creditRatio}%`}>
          <span style={{ width: `${creditRatio}%` }} />
        </div>
        <div className={`daily-checkin-form ${checkedInToday ? "checked" : ""}`}>
          <div className="daily-checkin-badge">
            <span>今日签到</span>
            <strong>+{checkInAmount.toLocaleString()}</strong>
          </div>
          <div className="daily-checkin-copy">
            <strong>{checkedInToday ? "今日已签到" : "签到领积分"}</strong>
            <span>{checkInMeta}</span>
          </div>
          <button
            type="button"
            className="primary-button"
            onClick={onClaimDailyCredits}
            disabled={checkInDisabled}
            aria-label={checkedInToday ? "今日已签到" : "签到领取今日积分"}
          >
            {dailyCheckInPending ? "签到中" : checkedInToday ? "已签到" : "立即签到"}
          </button>
        </div>
        <div className="billing-actions">
          <span>{totalCredits.toLocaleString()} total · catalog {catalog.version}</span>
        </div>
        <div className="credit-bucket-list">
          {(buckets.length ? buckets : [{ id: "legacy-balance", sourceType: "legacy", remainingAmount: availableCredits, reservedAmount: reservedCredits, expiresAt: null }]).map(bucket => (
            <div className="credit-bucket-row" key={bucket.id}>
              <div>
                <strong>{bucketLabel(bucket.sourceType)}</strong>
                <span>{bucket.expiresAt ? `有效期至 ${formatDate(bucket.expiresAt)}` : "长期有效"}</span>
              </div>
              <em>{bucket.remainingAmount.toLocaleString()} 可用 · {bucket.reservedAmount.toLocaleString()} 冻结</em>
            </div>
          ))}
        </div>
      </section>

      <section className="panel billing-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Membership</p>
            <h3>会员权益</h3>
          </div>
        </div>
        <div className="pricing-grid membership-grid">
          {catalog.membershipPlans.map(plan => (
            <article className={`price-card ${currentPlanId === plan.id || state.workspace.plan === plan.name ? "active" : ""}`} key={plan.id}>
              <strong>{plan.name}</strong>
              <span>{plan.priceCny ? `¥${plan.priceCny}/月` : "免费"}</span>
              <small>月赠 {plan.monthlyGrant.toLocaleString()} · 每日 {plan.dailyRefreshAfterWeek}</small>
              <small>并发 {plan.concurrentTaskLimit == null ? "不限" : `${plan.concurrentTaskLimit} 个任务`}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="panel billing-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Top up</p>
            <h3>单购积分包</h3>
          </div>
        </div>
        <div className="pricing-grid topup-grid">
          {catalog.topupProducts.map(product => (
            <article className="price-card" key={product.id}>
              <strong>{product.totalCredits.toLocaleString()}</strong>
              <span>¥{product.priceCny}</span>
              <small>{product.bonusCredits ? `含赠送 +${product.bonusCredits}` : product.name}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="panel billing-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Pricing</p>
            <h3>功能价格目录</h3>
          </div>
        </div>
        <div className="credit-rule-list">
          {catalog.priceRules.map(rule => (
            <div className="credit-rule-row" key={rule.id}>
              <span>{rule.category}</span>
              <strong>{rule.baseCredits} / {rule.unit}</strong>
              <em>高级 {rule.highPatternCredits}</em>
            </div>
          ))}
        </div>
      </section>

      <section className="panel billing-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Received</p>
            <h3>收入流水</h3>
          </div>
        </div>
        <LedgerList entries={receivedLedger} empty="暂无收入流水" />
      </section>

      <section className="panel billing-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Used</p>
            <h3>支出流水</h3>
          </div>
        </div>
        <LedgerList entries={usedLedger} empty="暂无支出流水" />
      </section>
    </div>
  );
}

function LedgerList({ entries, empty }) {
  return (
    <div className="ledger-list">
      {entries.length === 0 && <div className="ledger-empty">{empty}</div>}
      {entries.map(item => (
        <div className="ledger-row" key={item.id}>
          <span>{item.label || item.type}</span>
          <strong className={item.amount > 0 ? "positive" : item.amount < 0 ? "negative" : ""}>
            {item.amount > 0 ? "+" : ""}
            {item.amount}
          </strong>
        </div>
      ))}
    </div>
  );
}

function bucketLabel(sourceType) {
  const labels = {
    signup_bonus: "首次赠送",
    daily_refresh_free: "每日免费",
    daily_refresh_membership: "会员每日",
    membership_grant: "会员月赠",
    topup_purchase: "单购积分",
    redeem_code: "兑换码",
    admin_adjustment: "后台调整",
    grant: "系统发放",
    legacy: "历史余额"
  };
  return labels[sourceType] || sourceType;
}
function Admin({ state, creditsEnabled = true }) {
  return (
    <div className="page-grid two">
      <section className="panel wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Admin</p>
            <h3>任务与成本监控</h3>
          </div>
        </div>
        <TaskTable tasks={state.tasks} creditsEnabled={creditsEnabled} />
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
              {creditsEnabled && <em>{agent.cost} credits / retry</em>}
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

function AgentTimeline({ task, onRetry, locked = false, retryingAgentId = null, creditsEnabled = true }) {
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
                  {onRetry && !locked && agent.status === "failed" && (
                    <button className="ghost-button slim" type="button" onClick={() => onRetry(agent.id)} disabled={retryingAgentId === agent.id}>
                      {retryingAgentId === agent.id ? "重试中…" : "Retry"}
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
                <small>{creditsEnabled ? `${agent.cost || 0} credits · ` : ""}{agent.status}</small>
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
              {creditsEnabled && <em>{event.credits} cr</em>}
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

function VariantDetail({ variant, reviseHook, locked = false }) {
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
      <form className="revision-bar" onSubmit={reviseHook} aria-disabled={locked}>
        <input name="instruction" defaultValue="前三秒更强，更直接点出痛点" disabled={locked} />
        <button className="ghost-button" type="submit" disabled={locked} title={locked ? "历史已锁定，不能编辑" : ""}>
          {locked ? "已锁定" : "Revise hook"}
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

function TaskTable({ tasks, creditsEnabled = true }) {
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
          {creditsEnabled && <strong>{task.credits.actual}</strong>}
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

function AssetCard({ asset, referenced = false, onToggleReference, onDelete }) {
  const isImage = asset.type === "image" && typeof asset.ref === "string" && asset.ref.startsWith("data:image/");
  const tags = Array.isArray(asset.tags) ? asset.tags : [];
  return (
    <article className={`asset-card ${referenced ? "referenced" : ""}`}>
      <div className={`asset-thumb ${asset.type}`}>
        {isImage ? <img src={asset.ref} alt={asset.name} /> : <span>{String(asset.type || "file").toUpperCase()}</span>}
      </div>
      <strong>{asset.name}</strong>
      <span>
        {asset.source} · {asset.size}
      </span>
      {asset.mimeType && <small className="asset-mime">{asset.mimeType}</small>}
      <div className="tag-row">{tags.map(tag => <em key={tag}>{tag}</em>)}</div>
      <div className="asset-card-actions">
        {onToggleReference && (
          <button type="button" className={`ghost-button asset-reference-button ${referenced ? "active" : ""}`} onClick={onToggleReference}>
            {referenced ? "已引用" : "引用到生成"}
          </button>
        )}
        {onDelete && (
          <button type="button" className="ghost-button asset-delete-button" onClick={onDelete} aria-label={`删除 ${asset.name}`} title="删除素材">
            删除
          </button>
        )}
      </div>
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
