"use client";

// 三模式编排控制台：自动 / 半自动 / 手动，共用同一个 Flow 编排图。
//
// 设计核心——「一个 Flow，三种创作方式」：
//   auto   中枢从创意推断整条链（routeIdeaToFlow），逐节点点亮后自动运行。
//   semi   中枢先建议，用户勾选增减 + 拖拽微调顺序。
//   manual 导演台：对话逐节点绘制流程，节点在画布上点亮 / 连线。
// 三者最终都把一个合法 Flow 交给 onRun(brief, flow, meta) 执行，产出契约完全一致。

import { useEffect, useMemo, useRef, useState } from "react";
import { agents, skills, parseBriefText, findPlatformPreset, platformPresets, mergeCreativeParams } from "../lib/domain.js";
import {
  createFlow,
  toggleAgent,
  reorderNode,
  orderedAgentIds,
  validateFlow,
  estimateFlowCredits,
  isVideoFlow,
  hasAgent,
  skillToFlow
} from "../lib/flow/model.js";
import { routeIdeaToFlow } from "../lib/flow/router.js";
import { resolveDirectorCommand } from "../lib/flow/director.js";
import { validateMaterial, normalizeMaterial } from "../lib/storage/materialStore.js";

const skillNameFor = skillId => skills.find(skill => skill.id === skillId)?.name || "";

const AGENT_BY_ID = new Map(agents.map(agent => [agent.id, agent]));

// 三档「驾驶模式」：自由度 / 成本随档位升高。文案直接进 UI。
// accent/glow 给每档专属色身份（auto=青 / semi=靛 / manual=薄荷），
// 通过 inline CSS 变量 --seg-accent / --seg-glow 注入，作为 glyph、active 高亮、rail thumb 的单一色源。
const MODES = [
  { id: "auto", glyph: "⚡", name: "自动", en: "Autopilot", freedom: "低", cost: "经济", tip: "只给创意，中枢自己组装并跑完", accent: "var(--cyan)", glow: "var(--glow-cyan)" },
  { id: "semi", glyph: "⚙", name: "半自动", en: "Co-Pilot", freedom: "中", cost: "标准", tip: "中枢建议，你勾选增减 + 拖拽微调", accent: "var(--indigo)", glow: "var(--glow-violet)" },
  { id: "manual", glyph: "✦", name: "手动", en: "Director", freedom: "高", cost: "尊享", tip: "对话逐节点绘制流程，自由度最高", accent: "var(--mint)", glow: "var(--glow-mint)" }
];

const PLACEHOLDER = "用一句话描述你的创意，例如：给露营灯做一组小红书种草笔记";

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

// —— 手动模式迷你流程画布：节点按坐标排布，SVG 连线 ——
function FlowCanvas({ flow }) {
  const NODE_W = 124;
  const NODE_H = 58;
  const byId = new Map(flow.nodes.map(node => [node.id, node]));
  const width = Math.max(360, ...flow.nodes.map(node => node.x + NODE_W + 60));
  const height = Math.max(220, ...flow.nodes.map(node => node.y + NODE_H + 60));
  return (
    // viewport（填满手动主区、滚动）+ inner（按节点坐标定尺寸的坐标系）分层，
    // 让画布既能撑满大区域，又保留节点的绝对定位空间；空态居中于 viewport 而非 inner。
    <div className="oc-canvas">
      <div className="oc-canvas-inner" style={{ width, height }}>
        <svg className="oc-canvas-edges" width={width} height={height} aria-hidden>
          <defs>
            <marker id="oc-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
              <path d="M0,0 L8,3 L0,6 Z" fill="rgba(139,211,255,0.8)" />
            </marker>
          </defs>
          {flow.edges.map(edge => {
            const from = byId.get(edge.from);
            const to = byId.get(edge.to);
            if (!from || !to) return null;
            const x1 = from.x + NODE_W;
            const y1 = from.y + NODE_H / 2;
            const x2 = to.x;
            const y2 = to.y + NODE_H / 2;
            const mid = (x1 + x2) / 2;
            return (
              <path
                key={edge.id}
                className="oc-edge"
                d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                markerEnd="url(#oc-arrow)"
              />
            );
          })}
        </svg>
        {flow.nodes.map(node => {
          const agent = AGENT_BY_ID.get(node.agentId);
          return (
            <div
              key={node.id}
              className="oc-canvas-node"
              style={{ left: node.x, top: node.y, width: NODE_W, height: NODE_H, "--accent": agent?.accent || "#8bd3ff" }}
              title={agent?.responsibility}
            >
              <span className="oc-canvas-node-title">{agent?.title}</span>
              <span className="oc-canvas-node-id">{agent?.id}</span>
            </div>
          );
        })}
      </div>
      {!flow.nodes.length && <div className="oc-canvas-empty">画布空白 · 对话添加第一个节点</div>}
    </div>
  );
}

// 手动画布底部操作坞按钮（仅手动模式出现，本轮功能轻量、视觉就位）。
function OcDockButton({ active, disabled, label, icon, onClick }) {
  return (
    <button
      type="button"
      className={`oc-dock-btn ${active ? "active" : ""}`}
      disabled={disabled}
      onClick={onClick}
      title={label}
    >
      <span className="oc-dock-icon">{icon}</span>
      <em>{label}</em>
    </button>
  );
}

export function OrchestratorConsole({ onRun, generating, aiReady, aiConfig, task, mode, onModeChange }) {
  const [idea, setIdea] = useState("给露营灯做一组小红书种草笔记");
  const [tool, setTool] = useState("select"); // 手动画布操作坞的本地视觉态（选择/抓手），本轮不驱动真实手势
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
  const credits = useMemo(() => estimateFlowCredits(flow, platform.name), [flow, platform]);
  const validity = useMemo(() => validateFlow(flow), [flow]);
  const orderedIds = orderedAgentIds(flow);

  // 切换模式重置编排上下文，避免线性链与 DAG 互相污染。
  // mode 受控于 Workbench（上提以便外层按模式重排布局），此处只回调 + 重置本组件内部态。
  function switchMode(nextMode) {
    onModeChange(nextMode);
    // 创作参数（平台/受众/skill/素材）跨模式保留：已指定 skill 时在新模式下重新播种。
    setFlow(params.skillId ? skillToFlow(params.skillId, nextMode, flow.brief) : createFlow(nextMode));
    setRoute(null);
    setPhase(params.skillId ? "ready" : "idle");
    setRevealCount(params.skillId ? Infinity : 0);
    setTool("select");
  }

  // 操作坞「添加」：手动模式经对话增删节点，故按钮聚焦对话框引导（本轮轻量功能）。
  function focusChat() {
    chatInputRef.current?.focus();
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
    const brief = mergeCreativeParams(briefOverride || parseBriefText(idea), params);
    const meta = {
      name: skillNameFor(params.skillId) || route?.matchedSkill?.name || "自定义编排",
      category: MODES.find(m => m.id === mode)?.name,
      skillId: params.skillId || undefined
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
          <span className="oc-credit-chip" title="按所选 Agent 估算">≈ {credits} credits</span>
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

  // 创作参数条：平台 / 受众 / 指定 skill / 上传素材，三模式共用（PRD §8.2 required_inputs）。
  const paramsBar = (
    <div className="oc-params">
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

      <label className="oc-param">
        <span className="oc-param-label">Skill</span>
        <select
          className="oc-param-select"
          value={params.skillId}
          disabled={busy}
          onChange={event => onPickSkill(event.target.value)}
        >
          <option value="">自动匹配（中枢决定）</option>
          {skills.map(skill => (
            <option key={skill.id} value={skill.id}>{skill.name}</option>
          ))}
        </select>
      </label>

      <div className="oc-param oc-param-wide">
        <span className="oc-param-label">素材</span>
        <div className="oc-materials">
          <button type="button" className="oc-material-add" disabled={busy} onClick={() => fileInputRef.current?.click()}>
            ＋ 上传图片
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={onUploadMaterials} />
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
      <section className="panel oc-panel oc-panel-manual">
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

            {/* 钉底输入区：快捷指令 + 输入框 + 发送 + 运行 */}
            <div className="oc-composer">
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

          <div className="oc-manual-stage">
            <FlowCanvas flow={flow} />
            {isVideoFlow(flow) ? null : <p className="oc-future">🎬 视频节点 · 未来支持</p>}
            {/* 手动专属底部操作坞：仅手动模式出现，作为画布操作栏归位（本轮功能轻量）*/}
            <div className="oc-canvas-dock" role="toolbar" aria-label="画布操作">
              <OcDockButton active={tool === "select"} label="选择" icon="⌖" onClick={() => setTool("select")} />
              <OcDockButton active={tool === "hand"} label="抓手" icon="✋" onClick={() => setTool("hand")} />
              <OcDockButton label="添加" icon="＋" onClick={focusChat} />
              <i className="oc-dock-sep" />
              <OcDockButton label="撤销" icon="↶" disabled />
              <OcDockButton label="重做" icon="↷" disabled />
            </div>
          </div>
        </div>
      </section>
    );
  }

  // —— 自动 / 半自动：维持现扁平三栏布局，零改动 ——
  return (
    <section className="panel oc-panel">
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
