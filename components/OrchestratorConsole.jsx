"use client";

// 三模式编排控制台：自动 / 半自动 / 手动，共用同一个 Flow 编排图。
//
// 设计核心——「一个 Flow，三种创作方式」：
//   auto   中枢从创意推断整条链（routeIdeaToFlow），逐节点点亮后自动运行。
//   semi   中枢先建议，用户勾选增减 + 拖拽微调顺序。
//   manual 导演台：对话逐节点绘制流程，节点在画布上点亮 / 连线。
// 三者最终都把一个合法 Flow 交给 onRun(brief, flow, meta) 执行，产出契约完全一致。

import { useEffect, useMemo, useRef, useState } from "react";
import { agents, skills, skillGroups, skillsInGroup, isPromotionGroup, promotionFunnelForGroup, recommendForGroup, parseBriefText, findPlatformPreset, platformPresets, mergeCreativeParams, estimateCreditsForSkill, creditEstimateTotal } from "../lib/domain.js";
import {
  createFlow,
  toggleAgent,
  reorderNode,
  orderedAgentIds,
  validateFlow,
  hasAgent,
  skillToFlow,
  flowToSkill
} from "../lib/flow/model.js";
import { routeIdeaToFlow } from "../lib/flow/router.js";
import { resolveDirectorCommand } from "../lib/flow/director.js";
import { computeFlowOverlay } from "../lib/flow/overlay.js";
import { validateMaterial, normalizeMaterial } from "../lib/storage/materialStore.js";
import { CanvasStudio } from "./canvas/CanvasStudio.jsx";

const skillNameFor = skillId => skills.find(skill => skill.id === skillId)?.name || "";

function mergeMaterials(...groups) {
  const byName = new Map();
  for (const group of groups) {
    for (const item of group || []) {
      const material = normalizeMaterial(item);
      if (material.name) byName.set(material.name, material);
    }
  }
  return [...byName.values()];
}

const AGENT_BY_ID = new Map(agents.map(agent => [agent.id, agent]));

function renderTextValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return value.name || value.label || value.id || "";
  return value;
}

// 三档「驾驶模式」：自由度 / 成本随档位升高。文案直接进 UI。
// accent/glow 给每档专属色身份（auto=青 / semi=靛 / manual=薄荷），
// 通过 inline CSS 变量 --seg-accent / --seg-glow 注入，作为 glyph、active 高亮、rail thumb 的单一色源。
const MODES = [
  { id: "auto", glyph: "⚡", name: "自动", en: "Autopilot", freedom: "低", cost: "经济", tip: "只给创意，中枢自己组装并跑完", accent: "var(--cyan)", glow: "var(--glow-cyan)" },
  { id: "semi", glyph: "⚙", name: "半自动", en: "Co-Pilot", freedom: "中", cost: "标准", tip: "中枢建议，你勾选增减 + 拖拽微调", accent: "var(--indigo)", glow: "var(--glow-violet)" },
  { id: "manual", glyph: "✦", name: "手动", en: "Director", freedom: "高", cost: "尊享", tip: "对话逐节点绘制流程，自由度最高", accent: "var(--mint)", glow: "var(--glow-mint)" }
];

const PLACEHOLDER = "用一句话描述你的创意，例如：给露营灯做一组小红书种草笔记";

// —— RoboNeo 式技能选择器浮层：分类 tab + 技能卡片 ——
// 卡片点击即选中并播种 flow（onPick → onPickSkill）；分组 / 列表由 domain 的
// skillGroups / skillsInGroup 单一数据源驱动，UI 不重复硬编码分组逻辑。
// 单张技能卡：在扁平列表 / 漏斗分段 / 推荐行三处复用，避免重复模板。
function SkillCard({ skill, active, busy, onPick }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      disabled={busy}
      className={`oc-skill-card ${active ? "on" : ""}`}
      style={{ "--c1": skill.palette?.[0] || "#8bd3ff", "--c2": skill.palette?.[1] || "#ff7a90" }}
      onClick={() => onPick(skill.id)}
      title={skill.bestFor}
    >
      <span className="oc-skill-card-icon">{skill.icon || "✦"}</span>
      <span className="oc-skill-card-body">
        <span className="oc-skill-card-top">
          <strong>{skill.name}</strong>
          <em>{renderTextValue(skill.stage)}</em>
        </span>
        <small>{skill.promise}</small>
        <span className="oc-skill-card-foot">
          ≈ {skill.estimatedCredits} credits · {skill.formats?.[0]}
        </span>
      </span>
      {active && (
        <span className="oc-skill-card-check" aria-hidden>
          ✓
        </span>
      )}
    </button>
  );
}

function SkillPickerPanel({ tab, onTab, selectedId, onPick, onClose, busy, query }) {
  // 获客平台 tab（小红书/抖音/视频号）→ 按获客漏斗阶段分段渲染 + 顶部意图推荐行；
  // 其余分类（推荐/电商/美妆/短视频）→ 扁平列表（行为不变）。数据全部来自 domain 单一来源。
  const funnel = isPromotionGroup(tab) ? promotionFunnelForGroup(tab) : null;
  const flatList = funnel ? null : skillsInGroup(tab);
  const recommended = funnel && query && query.trim() ? recommendForGroup(tab, { query, limit: 3 }) : [];
  const renderCard = skill => (
    <SkillCard key={skill.id} skill={skill} active={selectedId === skill.id} busy={busy} onPick={onPick} />
  );
  return (
    <>
      {/* 透明背板：点击空白处关闭浮层 */}
      <button type="button" className="oc-skill-backdrop" aria-label="关闭技能选择" onClick={onClose} />
      <div className="oc-skillpanel" role="dialog" aria-label="选择创作技能">
        <div className="oc-skillpanel-head">
          <div>
            <strong>Skills</strong>
            <small>选择一个创作技能，AICrew 按该技能编排并生成</small>
          </div>
          <button type="button" className="oc-skillpanel-close" onClick={onClose} aria-label="关闭技能选择">
            ×
          </button>
        </div>
        <div className="oc-skill-tabs" role="tablist" aria-label="技能分类">
          {skillGroups.map(group => (
            <button
              key={group.id}
              type="button"
              role="tab"
              aria-selected={tab === group.id}
              className={`oc-skill-tab ${tab === group.id ? "on" : ""}`}
              onClick={() => onTab(group.id)}
              title={group.desc}
            >
              {group.name}
            </button>
          ))}
        </div>
        <div className="oc-skill-list" role="listbox" aria-label="技能列表">
          {/* 扁平分类：原样列出 */}
          {flatList && flatList.length === 0 && <p className="oc-skill-empty">该分类暂无技能</p>}
          {flatList && flatList.map(renderCard)}

          {/* 获客平台：意图推荐行 + 漏斗阶段分段 */}
          {recommended.length > 0 && (
            <section className="oc-skill-stage oc-skill-reco" aria-label="为你的创意推荐">
              <header className="oc-skill-stage-head">
                <strong>✨ 为你的创意推荐</strong>
                <small>按你的描述匹配</small>
              </header>
              {recommended.map(renderCard)}
            </section>
          )}
          {funnel && funnel.map(({ stage, skills: stageSkills }) => (
            <section className="oc-skill-stage" key={stage.id} aria-label={stage.name}>
              <header className="oc-skill-stage-head">
                <strong>{stage.name}</strong>
                <em>{stageSkills.length}</em>
                <small>{stage.desc}</small>
              </header>
              {stageSkills.map(renderCard)}
            </section>
          ))}
        </div>
      </div>
    </>
  );
}

// —— 横向能量链：自动 / 半自动模式下可视化当前编排 ——
function NodeChain({ flow, revealCount = Infinity }) {
  const ids = orderedAgentIds(flow);
  if (!ids.length) return <div className="oc-chain oc-chain-empty">等待中枢编排…</div>;
  return (
    <div className="oc-chain" role="list">
      {ids.map((id, index) => {
        const agent = AGENT_BY_ID.get(id);
        const revealed = index < revealCount;
        return (
          <div className="oc-chain-item" key={`${id}-${index}`}>
            {index > 0 && <span className={`oc-link ${revealed ? "lit" : ""}`} aria-hidden />}
            <div
              className={`oc-node ${revealed ? "lit" : "dim"}`}
              style={{ "--accent": agent?.accent || "#8bd3ff" }}
              role="listitem"
              title={agent?.responsibility}
            >
              <span className="oc-node-glyph">{index + 1}</span>
              <span className="oc-node-title">{agent?.title}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// —— 手动模式 Director 流程：渲染为画布世界坐标系内的只读 SVG overlay ——
// 统一画布：节点/连线叠加在 CanvasStudio 的自由画布之上，随其 pan/zoom 一起缩放。
// 几何来自纯函数 computeFlowOverlay（可单测）；本组件只做渲染（title/accent 取自 AGENT_BY_ID）。
// pointer-events 由父层 .canvas-overlay 统一关闭，使画布选择/绘制手势可穿透到空白处。
function FlowOverlay({ flow }) {
  const { nodes, edges } = computeFlowOverlay(flow);
  return (
    <g aria-hidden>
      <defs>
        <marker id="oc-overlay-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
          <path d="M0,0 L8,3 L0,6 Z" fill="rgba(139,211,255,0.85)" />
        </marker>
      </defs>
      {edges.map(edge => (
        <path key={edge.id} className="oc-overlay-edge" d={edge.path} markerEnd="url(#oc-overlay-arrow)" />
      ))}
      {nodes.map(node => {
        const agent = AGENT_BY_ID.get(node.agentId);
        const accent = agent?.accent || "#8bd3ff";
        return (
          <g key={node.id} transform={`translate(${node.x} ${node.y})`}>
            <rect className="oc-overlay-node" width={node.w} height={node.h} rx="10" style={{ stroke: accent }} />
            <text className="oc-overlay-node-title" x="12" y="25">
              {agent?.title || node.agentId}
            </text>
            <text className="oc-overlay-node-id" x="12" y="42">
              {agent?.id || node.agentId}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export function OrchestratorConsole({ onRun, generating, aiReady, aiConfig, task, mode, onModeChange, onGenerateImage, editSeed, libraryMaterials = [] }) {
  const [idea, setIdea] = useState("给露营灯做一组小红书种草笔记");
  const [flow, setFlow] = useState(() => createFlow("auto"));
  const [route, setRoute] = useState(null); // {rationale, matchedSkill, summary, brief}
  const [revealCount, setRevealCount] = useState(0); // 自动模式逐节点点亮
  const [phase, setPhase] = useState("idle"); // idle | thinking | ready
  const [log, setLog] = useState([{ role: "system", text: "导演台就绪。试试「加视觉」「视觉连文案」「运行」。" }]);
  const [dragIndex, setDragIndex] = useState(null);
  const chatInputRef = useRef(null);
  // 内联结果：手动模式运行后把生成的内容包作为一条对话消息追加（RoboNeo 对话流形态）。
  const awaitingResultRef = useRef(false); // 本次运行是否来自手动对话（决定是否内联结果卡）
  const lastTaskIdRef = useRef(task?.id ?? null); // 已入对话的最新 task id，避免重复追加

  // —— 创作参数（三模式共享）：平台 / 受众 / 指定 skill / 上传素材 ——
  // 这四个参数是 PRD §8.2 的 required_inputs，统一收敛进 brief（唯一事实来源）后经 onRun 单桥执行。
  // 平台默认取初始创意文本检测到的平台，之后由用户显式选择（可覆盖）。
  const [params, setParams] = useState(() => ({
    platform: findPlatformPreset(parseBriefText(idea).platform).name,
    audience: "",
    skillId: "", // 空 = 由中枢自动匹配（auto/semi）/ 由对话搭建（manual）
    materials: []
  }));
  const [materialError, setMaterialError] = useState("");
  const fileInputRef = useRef(null);

  // —— RoboNeo 式技能选择器状态：浮层开合 + 当前分类 tab ——
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [skillTab, setSkillTab] = useState(skillGroups[0].id);

  useEffect(() => {
    if (!editSeed?.id) return;
    const brief = editSeed.brief || {};
    const platformName = findPlatformPreset(brief.platform || "抖音").name;
    const nextIdea = [
      `产品 ${brief.productName || "AICrew Product"}`,
      `受众 ${brief.targetAudience || "目标用户"}`,
      `目标 ${brief.goal || "生成可发布内容包"}`,
      `${platformName} ${brief.style || ""}`.trim()
    ].join("，");
    setIdea(nextIdea);
    setParams(prev => ({
      ...prev,
      platform: platformName,
      audience: brief.targetAudience || "",
      skillId: editSeed.skillId || "",
      materials: mergeMaterials(brief.materials || [])
    }));
    if (editSeed.skillId) {
      setFlow(skillToFlow(editSeed.skillId, mode, flow.brief));
      setRoute(null);
      setPhase("ready");
      setRevealCount(Infinity);
    }
  }, [editSeed?.id]);
  // 指定 skill：立即用该 skill 播种 flow，使节点链 / credits 同步反映选择；清空则回到自动编排。
  function onPickSkill(skillId) {
    setParams(prev => ({ ...prev, skillId }));
    if (skillId) {
      setFlow(skillToFlow(skillId, mode, flow.brief));
      setRoute(null);
      setPhase("ready");
      setRevealCount(Infinity);
    }
  }

  // 卡片选中：选定技能后关闭浮层（RoboNeo 选中即收起，技能以 chip 锚定输入框）。
  function pickSkillFromCard(skillId) {
    onPickSkill(skillId);
    setSkillPickerOpen(false);
  }

  // 清除技能：回到自动编排 / 自由对话。仅清 skillId，不强行重置已搭好的 flow。
  function clearSkill() {
    setParams(prev => ({ ...prev, skillId: "" }));
  }

  // 上传素材：组件侧 FileReader 读 dataURL，纯校验（MIME/体量）下沉 materialStore。
  // 校验失败给明确原因、不静默吞；通过则归一成 {name,type,ref} 追加进 params.materials。
  function onUploadMaterials(event) {
    const files = Array.from(event.target.files || []);
    if (fileInputRef.current) fileInputRef.current.value = ""; // 复位以便重复选同名文件
    setMaterialError("");
    files.forEach(file => {
      const check = validateMaterial({ name: file.name, type: file.type, size: file.size });
      if (!check.ok) {
        setMaterialError(check.reason);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        setParams(prev => ({
          ...prev,
          materials: [...prev.materials, normalizeMaterial({ name: file.name, type: file.type, ref: reader.result })]
        }));
      };
      reader.readAsDataURL(file);
    });
  }

  function removeMaterial(index) {
    setParams(prev => ({ ...prev, materials: prev.materials.filter((_, i) => i !== index) }));
  }

  // credits / platform 估算以用户所选平台为准（参数即事实），创意文本仅作兜底。
  const platform = useMemo(() => findPlatformPreset(params.platform || parseBriefText(idea).platform), [params.platform, idea]);
  const quoteBrief = useMemo(() => mergeCreativeParams(parseBriefText(idea), {
    ...params,
    materials: mergeMaterials(libraryMaterials, params.materials)
  }), [idea, params, libraryMaterials]);
  const credits = useMemo(() => estimateCreditsForSkill(quoteBrief, flowToSkill(flow, {
    skillId: params.skillId || undefined,
    name: skillNameFor(params.skillId) || "自定义编排"
  })), [flow, quoteBrief, params.skillId]);
  const estimatedCredits = creditEstimateTotal(credits);
  const validity = useMemo(() => validateFlow(flow), [flow]);
  const orderedIds = orderedAgentIds(flow);

  // 手动画布「导入本次封面」数据源：本次任务已出图的 variant 封面（与 /canvas 同口径，保体验一致）。
  const canvasCovers = useMemo(
    () => (task?.variants || []).filter(variant => variant.imageUrl).map(variant => ({ src: variant.imageUrl, name: variant.name })),
    [task]
  );

  // 切换模式重置编排上下文，避免线性链与 DAG 互相污染。
  // mode 受控于 Workbench（上提以便外层按模式重排布局），此处只回调 + 重置本组件内部态。
  function switchMode(nextMode) {
    onModeChange(nextMode);
    // 创作参数（平台/受众/skill/素材）跨模式保留：已指定 skill 时在新模式下重新播种。
    setFlow(params.skillId ? skillToFlow(params.skillId, nextMode, flow.brief) : createFlow(nextMode));
    setRoute(null);
    setPhase(params.skillId ? "ready" : "idle");
    setRevealCount(params.skillId ? Infinity : 0);
  }

  // 中枢路由：auto/semi 共用。auto 走点亮动画后自动运行；semi 停在可编辑态。
  function runRouter(thenRun) {
    // 已显式指定 skill：跳过中枢推断，直接用该 skill 播种（thenRun 时即运行，无点亮动画）。
    if (params.skillId) {
      const seeded = skillToFlow(params.skillId, mode, flow.brief);
      setFlow(seeded);
      setRoute(null);
      setPhase("ready");
      setRevealCount(Infinity);
      if (thenRun) triggerRun(seeded);
      return;
    }
    const result = routeIdeaToFlow(idea, mode);
    setRoute(result);
    setFlow(result.flow);
    if (thenRun) {
      setPhase("thinking");
      setRevealCount(0);
    } else {
      setPhase("ready");
      setRevealCount(Infinity);
    }
  }

  // 自动模式：逐节点点亮，亮完自动触发运行。
  useEffect(() => {
    if (phase !== "thinking" || !route) return;
    const total = route.rationale.length;
    if (revealCount >= total) {
      const timer = setTimeout(() => {
        setPhase("ready");
        // 用路由时的同源 brief，保证执行的 flow 与 brief/平台/计费口径一致。
        triggerRun(route.flow, route.brief);
      }, 420);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => setRevealCount(count => count + 1), 520);
    return () => clearTimeout(timer);
  }, [phase, revealCount, route]);

  // 生成完成（task 更新）→ 若本次运行来自手动对话，把内容包作为结果卡追加进对话流。
  useEffect(() => {
    const id = task?.id ?? null;
    if (!id || id === lastTaskIdRef.current) return;
    lastTaskIdRef.current = id;
    if (!awaitingResultRef.current) return;
    awaitingResultRef.current = false;
    setLog(current => [...current, { role: "result", taskId: id, variant: task.variants?.[0] || null }]);
  }, [task]);

  function triggerRun(targetFlow = flow, briefOverride) {
    // targetFlow 已是 skill 播种态（onPickSkill / switchMode / runRouter 共同保证）：直接执行。
    // 此处不再重新 skillToFlow，否则会覆盖掉 semi 勾选 / manual 对话对该 flow 的微调。
    const check = validateFlow(targetFlow);
    if (!check.valid) return;
    // 手动模式：标记本次运行来自对话，生成完成后把结果卡内联进对话流。
    if (mode === "manual") awaitingResultRef.current = true;
    // 平台 / 受众 / 素材收敛进 brief（唯一事实来源）；创意文本或路由 brief 作基底。
    const brief = mergeCreativeParams(briefOverride || parseBriefText(idea), {
      ...params,
      materials: mergeMaterials(libraryMaterials, params.materials)
    });
    // 选中预设 skill 时透传创作意图（promise/bestFor），经 flowToSkill 进入 AI prompt，
    // 使「选了哪个技能」真正改变生成结果（对标 RoboNeo 技能驱动生成）。
    const picked = skills.find(skill => skill.id === params.skillId);
    const meta = {
      name: skillNameFor(params.skillId) || route?.matchedSkill?.name || "自定义编排",
      category: MODES.find(m => m.id === mode)?.name,
      skillId: params.skillId || undefined,
      promise: picked?.promise,
      bestFor: picked?.bestFor
    };
    onRun(brief, targetFlow, meta);
  }

  // —— 半自动：勾选 + 拖拽 ——
  function onToggle(agentId) {
    setFlow(current => toggleAgent(current, agentId).flow);
  }
  function onDrop(targetIndex) {
    if (dragIndex === null || dragIndex === targetIndex) return;
    setFlow(current => reorderNode(current, dragIndex, targetIndex));
    setDragIndex(null);
  }

  // —— 导演台：对话 ——
  // 单条指令的核心处理：LLM 意图优先 / 正则兜底 → mutate flow → 追加消息 → 命中运行意图则执行。
  // 先即时回显 user 消息再 await，避免 LLM 解析延迟时输入像「卡住」。
  async function runCommand(text) {
    const t = String(text || "").trim();
    if (!t) return;
    setLog(current => [...current, { role: "user", text: t }]);
    const result = await resolveDirectorCommand({ text: t, flow, aiConfig: aiReady ? aiConfig : null });
    setFlow(result.flow);
    setLog(current => [...current, { role: "assistant", text: result.reply }]);
    if (result.run) triggerRun(result.flow);
  }
  function sendCommand(event) {
    event.preventDefault();
    runCommand(chatInputRef.current?.value);
    if (chatInputRef.current) chatInputRef.current.value = "";
  }
  // 输入栏上方的快捷指令芯片（RoboNeo 工具行的对应物：一键发常用导演指令）。
  const QUICK_COMMANDS = ["加视觉", "加文案", "加质检", "运行"];

  const activeMode = MODES.find(m => m.id === mode);
  const busy = generating || phase === "thinking";

  // —— 三模式共享片段（提取以便手动模式走双列布局而不重复 JSX）——
  const modeBlock = (
    <div className="oc-mode-block">
        <div className="oc-head">
          <div>
            <p className="eyebrow">Orchestrator</p>
            <h3>中枢编排台</h3>
          </div>
          <span className="oc-credit-chip" title="按所选 Agent 估算">≈ {estimatedCredits} credits</span>
        </div>

        <p className="oc-mode-eyebrow">MODE · 一个 Flow，三种创作方式</p>

        {/* 档位切换：active 段自展开吸收余宽、idle 段贴内容收缩 → 手动不再被挤；
            active 段本身即选中指示器（高亮锚定真实 DOM 盒，永不漂移）。*/}
        <div className="oc-modes" role="tablist" aria-label="编排模式" data-mode={mode}>
          {MODES.map(item => {
            const isActive = mode === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`oc-mode ${isActive ? "active" : ""}`}
                style={{ "--seg-accent": item.accent, "--seg-glow": item.glow }}
                onClick={() => switchMode(item.id)}
              >
                <span className="oc-mode-glyph" aria-hidden>{item.glyph}</span>
                <span className="oc-mode-name">{item.name}</span>
                {/* 仅 active 段展开：英文代号 + 自由度/成本；idle 折叠为 0 宽，杜绝窄列换行/裁切 */}
                <span className="oc-mode-detail">
                  <span className="oc-mode-en">{item.en}</span>
                  <span className="oc-mode-meters">自由度 {item.freedom} · {item.cost}</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* 自由度 → 成本 进阶刻度尺：ticks 在前、thumb 在后（保证 nth-of-type 正确映射），
            thumb 锁定当前档位（accent 由当前 active 段注入）。*/}
        <div
          className="oc-mode-rail"
          data-mode={mode}
          style={{ "--seg-accent": activeMode.accent, "--seg-glow": activeMode.glow }}
          aria-hidden
        >
          <span className="oc-mode-rail-tick">低</span>
          <span className="oc-mode-rail-tick">中</span>
          <span className="oc-mode-rail-tick">高</span>
          <span className="oc-mode-rail-thumb" />
        </div>

      <p className="oc-mode-tip">{activeMode.tip}</p>
    </div>
  );

  // 创意输入：三模式共用（手动模式作为流程的创意基底，具体编排靠对话）
  const ideaField = (
    <>
      <textarea
        className="oc-idea"
        rows={mode === "manual" ? 2 : 3}
        value={idea}
        placeholder={PLACEHOLDER}
        disabled={busy}
        onChange={event => setIdea(event.target.value)}
      />
      {mode === "manual" && <p className="oc-hint">创意作为基底，下面用对话绘制流程节点 ↓</p>}
    </>
  );

  // 当前选中的技能对象（驱动 chip 展示与浮层选中态）。
  const selectedSkill = skills.find(skill => skill.id === params.skillId) || null;

  // 技能选择字段：trigger（兼作选中 chip）+ 清除按钮 + 浮层。三模式共用同一实例，
  // 保证同一时刻只挂载一个浮层（手动模式在 composer 渲染，自动/半自动在 paramsBar 渲染）。
  const skillField = (
    <div className="oc-skill-field">
      <div className="oc-skill-control">
        <button
          type="button"
          className={`oc-skill-trigger ${selectedSkill ? "on" : ""}`}
          disabled={busy}
          aria-haspopup="dialog"
          aria-expanded={skillPickerOpen}
          onClick={() => setSkillPickerOpen(open => !open)}
          title={selectedSkill ? selectedSkill.promise : "选择创作技能"}
          style={selectedSkill ? { "--c1": selectedSkill.palette?.[0] || "#a78bfa" } : undefined}
        >
          <span className="oc-skill-trigger-icon">{selectedSkill ? selectedSkill.icon || "✦" : "✦"}</span>
          <span className="oc-skill-trigger-text">{selectedSkill ? selectedSkill.name : "选择创作技能"}</span>
          <span className="oc-skill-caret" aria-hidden>
            ▾
          </span>
        </button>
        {selectedSkill && (
          <button type="button" className="oc-skill-clear" disabled={busy} onClick={clearSkill} aria-label="清除技能">
            ×
          </button>
        )}
      </div>
      {skillPickerOpen && (
        <SkillPickerPanel
          tab={skillTab}
          onTab={setSkillTab}
          selectedId={params.skillId}
          onPick={pickSkillFromCard}
          onClose={() => setSkillPickerOpen(false)}
          busy={busy}
          query={idea}
        />
      )}
    </div>
  );

  // 创作参数条：平台 / 受众 / 指定 skill / 上传素材，三模式共用（PRD §8.2 required_inputs）。
  const paramsBar = (
    <div className={`oc-params ${skillPickerOpen && mode !== "manual" ? "is-skill-open" : ""}`}>
      <div className="oc-param">
        <span className="oc-param-label">平台</span>
        <div className="oc-param-platforms" role="group" aria-label="目标平台">
          {platformPresets.map(preset => (
            <button
              key={preset.id}
              type="button"
              className={`oc-platform-chip ${params.platform === preset.name ? "on" : ""}`}
              disabled={busy}
              onClick={() => setParams(prev => ({ ...prev, platform: preset.name }))}
              title={preset.tone}
            >
              {preset.name}
              <em>{preset.ratio}</em>
            </button>
          ))}
        </div>
      </div>

      <label className="oc-param">
        <span className="oc-param-label">受众</span>
        <input
          className="oc-param-input"
          value={params.audience}
          placeholder="如：25-35 岁都市女性 / 跨境电商卖家"
          disabled={busy}
          onChange={event => setParams(prev => ({ ...prev, audience: event.target.value }))}
        />
      </label>

      {/* 手动模式的技能选择移到对话输入框上方（RoboNeo 形态），此处仅在自动/半自动渲染，
          保证同一时刻只挂载一个技能浮层。 */}
      {mode !== "manual" && (
        <div className="oc-param">
          <span className="oc-param-label">Skill</span>
          {skillField}
        </div>
      )}

      <div className="oc-param oc-param-wide">
        <span className="oc-param-label">素材</span>
        <div className="oc-materials">
          <button type="button" className="oc-material-add" disabled={busy} onClick={() => fileInputRef.current?.click()}>
            ＋ 上传图片
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={onUploadMaterials} />
          {libraryMaterials.map((material, index) => (
            <span key={`library-${material.name}-${index}`} className="oc-material-chip library" title={`素材库引用：${material.name}`}>
              {material.ref?.startsWith("data:image/") ? <img src={material.ref} alt="" className="oc-material-thumb" /> : null}
              <em>{material.name}</em>
              <small>引用</small>
            </span>
          ))}
          {params.materials.map((material, index) => (
            <span key={`${material.name}-${index}`} className="oc-material-chip" title={material.name}>
              {material.ref ? <img src={material.ref} alt="" className="oc-material-thumb" /> : null}
              <em>{material.name}</em>
              <button
                type="button"
                className="oc-material-remove"
                disabled={busy}
                onClick={() => removeMaterial(index)}
                aria-label="移除素材"
              >
                ×
              </button>
            </span>
          ))}
        </div>
        {materialError && <p className="oc-material-error">{materialError}</p>}
      </div>
    </div>
  );

  const aiHint = (
    <p className="oc-ai-hint">
      {aiReady ? "系统 AI 已接入 · 真实生成" : "未配置系统 AI · 运行确定性模拟"}
    </p>
  );

  // —— 手动 / 导演台：RoboNeo 式整屏对话流工作台 ——
  // 左：对话流（模式选择 + 欢迎卡 + 创意基底 + 富气泡/内联结果 + 钉底输入），整高撑满；
  // 右：流程画布主区填满 + 底部操作坞。布局填满视口高度由 CSS .is-manual 高度链负责。
  if (mode === "manual") {
    return (
      <section className={`panel oc-panel oc-panel-manual ${skillPickerOpen ? "is-skill-open" : ""}`}>
        <div className="oc-manual-grid">
          <div className="oc-manual-side">
            {modeBlock}

            {/* 对话流：可滚动历史填满余高，输入钉底 */}
            <div className="oc-flow">
              <div className="oc-welcome">
                <div className="oc-welcome-row">
                  <span className="oc-welcome-avatar">AI</span>
                  <div>
                    <strong>欢迎使用 AICrew 导演台</strong>
                    <small>内容由 AI 编排生成</small>
                  </div>
                </div>
                <p>用一句话定创意基底，再用对话逐节点搭流程：「加视觉」「视觉连文案」「运行」。生成的内容包会直接出现在对话里。</p>
              </div>

              {ideaField}
              {paramsBar}

              <div className="oc-chat-log">
                {log.map((entry, index) => {
                  if (entry.role === "result") {
                    const v = entry.variant;
                    return (
                      <article key={index} className="oc-result-card">
                        <div className="oc-result-head">
                          <span className="oc-result-score">{v?.score ?? "✓"}</span>
                          <strong>{v?.name || "内容包已生成"}</strong>
                        </div>
                        {v?.hook && <p className="oc-result-hook">{v.hook}</p>}
                        {v?.caption && <p className="oc-result-caption">{v.caption}</p>}
                        <span className="oc-result-foot">完整内容包见下方 ↓</span>
                      </article>
                    );
                  }
                  return (
                    <div key={index} className={`oc-msg oc-msg-${entry.role}`}>
                      {entry.text}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 钉底输入区：技能选择（chip + 浮层）+ 快捷指令 + 输入框 + 发送 + 运行 */}
            <div className={`oc-composer ${skillPickerOpen ? "is-skill-open" : ""}`}>
              {/* RoboNeo 形态：技能以 chip / trigger 锚定在输入框上方，点击浮层选择 */}
              <div className="oc-skill-row">{skillField}</div>
              <div className="oc-quick" role="group" aria-label="快捷指令">
                {QUICK_COMMANDS.map(q => (
                  <button key={q} type="button" className="oc-quick-chip" disabled={busy} onClick={() => runCommand(q)}>
                    {q}
                  </button>
                ))}
              </div>
              <form className="oc-chat-form" onSubmit={sendCommand}>
                <input ref={chatInputRef} className="oc-chat-input" placeholder="向 AICrew 发送指令：加视觉 / 视觉连文案 / 运行" disabled={busy} />
                <button type="submit" className="oc-send" disabled={busy} aria-label="发送">↑</button>
              </form>
              <button type="button" className="oc-primary" disabled={busy || !validity.valid} onClick={() => triggerRun()}>
                {generating ? "执行中…" : `✦ 运行 Director · ${orderedIds.length} 个节点`}
              </button>
              {aiHint}
            </div>
          </div>

          {/* 统一画布：复用真画布运行时（CanvasStudio）作底座 —— 自带 RoboNeo 添加菜单 /
              选择/抓手/撤销/重做 + 缩放/适应/图层；Director 流程作只读 overlay 叠加、随画布缩放。
              手动画布独立 storageKey，与 /canvas 画布互不串。 */}
          <div className="oc-manual-stage">
            <CanvasStudio
              className="is-embedded"
              storageKey="aicrew-manual-canvas-v1"
              overlay={<FlowOverlay flow={flow} />}
              onGenerateImage={onGenerateImage}
              covers={canvasCovers}
              emptyHint={
                flow.nodes.length ? null : (
                  <>
                    <strong>画布空白</strong>
                    <span>对话添加流程节点，或点「添加」插入图片 / 形状</span>
                  </>
                )
              }
            />
          </div>
        </div>
      </section>
    );
  }

  // —— 自动 / 半自动：维持现扁平三栏布局，零改动 ——
  return (
    <section className={`panel oc-panel ${skillPickerOpen ? "is-skill-open" : ""}`}>
      {modeBlock}
      {ideaField}
      {paramsBar}

      {/* —— 自动 —— */}
      {mode === "auto" && (
        <div className="oc-body">
          <button type="button" className="oc-primary" disabled={busy} onClick={() => runRouter(true)}>
            {phase === "thinking" ? "中枢编排中…" : generating ? "执行中…" : "⚡ 启动中枢自动驾驶"}
          </button>
          {route && (
            <>
              <p className="oc-summary">{route.summary}</p>
              <NodeChain flow={flow} revealCount={revealCount} />
              <ul className="oc-rationale">
                {route.rationale.map((item, index) => (
                  <li key={item.agentId} className={index < revealCount ? "lit" : "dim"}>
                    <strong>{item.title}</strong>
                    <span>{item.reason}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {/* —— 半自动 —— */}
      {mode === "semi" && (
        <div className="oc-body">
          <button type="button" className="oc-ghost" disabled={busy} onClick={() => runRouter(false)}>
            ⚙ 让中枢先建议一条流程
          </button>
          {route && <p className="oc-summary">{route.summary}</p>}

          <p className="oc-label">勾选 Agent（点亮 = 入选）</p>
          <div className="oc-palette">
            {agents.map(agent => {
              const on = hasAgent(flow, agent.id);
              return (
                <button
                  key={agent.id}
                  type="button"
                  className={`oc-chip ${on ? "on" : ""}`}
                  style={{ "--accent": agent.accent }}
                  onClick={() => onToggle(agent.id)}
                  title={agent.responsibility}
                >
                  <span className="oc-chip-dot" />
                  {agent.title}
                  <em>{agent.cost}</em>
                </button>
              );
            })}
          </div>

          <p className="oc-label">拖拽微调执行顺序</p>
          {/* 直接遍历 flow.nodes：拖拽下标即 reorderNode 操作的节点数组下标，
              二者同源，避免与拓扑序错位导致移错节点（半自动为线性流，顺序一致）。*/}
          <div className="oc-order">
            {flow.nodes.length === 0 && <span className="oc-hint">勾选 Agent 后在此排序</span>}
            {flow.nodes.map((node, index) => {
              const agent = AGENT_BY_ID.get(node.agentId);
              return (
                <div
                  key={node.id}
                  className="oc-pill"
                  style={{ "--accent": agent?.accent }}
                  draggable
                  onDragStart={() => setDragIndex(index)}
                  onDragOver={event => event.preventDefault()}
                  onDrop={() => onDrop(index)}
                >
                  <span className="oc-pill-grip">⋮⋮</span>
                  {agent?.title}
                </div>
              );
            })}
          </div>

          <button type="button" className="oc-primary" disabled={busy || !validity.valid} onClick={() => triggerRun()}>
            {generating ? "执行中…" : `▶ 运行 Co-Pilot · ${orderedIds.length} 个 Agent`}
          </button>
        </div>
      )}

      {aiHint}
    </section>
  );
}
