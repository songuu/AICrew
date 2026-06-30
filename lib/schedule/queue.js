// 排期层（绿区半自动）的纯逻辑内核——「按 task 分组、仅小红书」。
//
// 设计要点（已逐行核证 lib/domain.js）：
// 1. 排期单位 = task（一次创作运行 = 一个 project = 一整批产物），故 scheduledAt 挂 task 标量层，
//    一个 task 一个排期时间一行，零同步压力。绝不放 task.variants（会被持久化脱敏 stripVariantMedia 剥掉）。
// 2. 门控/到点/带稿全部基于 task 自带的 task.exports + task.variants 判定——task 自描述其产物。
//    刻意不走 export.projectId→project 两跳：auto/seed 路径的 state.exports 缺 projectId
//    （domain.js:1975 拷 task.exports 时只补 id/projectName/createdAt，不补 projectId），两跳对主路径必落空。
// 3. 仅小红书：复用 lib/share/rednote.js::supportsRednoteHandoff 作为唯一门控闸（DRY），
//    非小红书 task 一律不可排期——无控件、无提醒、无带稿，完全出 scope。
//
// 本模块纯函数、不可变、无时钟（nowMs 由调用方注入），domain.js 零改动。

import { supportsRednoteHandoff } from "../share/rednote.js";

// 给指定 task 设排期时间。scheduledAt 应为 ISO-8601 UTC 串（如 "2026-06-30T14:00:00.000Z"）；
// 传 null/空串清除排期。不可变：返回新 state，原 state.tasks 引用不变，仅目标 task 产生新对象。
export function setTaskScheduledAt(state, taskId, scheduledAt) {
  const nextValue = scheduledAt == null || scheduledAt === "" ? null : String(scheduledAt);
  return {
    ...state,
    tasks: (state?.tasks || []).map(task =>
      task.id === taskId ? { ...task, scheduledAt: nextValue } : task
    )
  };
}

// 该 task 自带产物中、平台为小红书的 export 子集。这是「仅小红书一键带稿」门控的唯一闸：
// 抖音/视频号产物被全部滤掉 → 空数组 → 门控关闭。
export function selectRednoteExportsForTask(task) {
  return (task?.exports || []).filter(item => supportsRednoteHandoff(item?.platform));
}

// task 是否可排期：至少有 1 个小红书产物。无产物 / 仅非小红书产物 → false（完全出 scope）。
export function isTaskScheduleEligible(task) {
  return selectRednoteExportsForTask(task).length > 0;
}

// 到点的可排期 task 集合：有 scheduledAt、scheduledAt <= now（含边界）、且 eligible。
// nowMs = Date.now() 由调用方注入，保持本函数纯/可测；非法时间串安全排除（不抛）。
// nowMs 缺值/非数值时 fail-closed 返回 []（不放行）——否则 `due > NaN` 恒 false 会把
// 未来排期也误判为到期（与对非法 scheduledAt 的 fail-closed 处理保持方向一致）。
export function selectDueTasks(state, nowMs) {
  const cutoff = Number(nowMs);
  if (!Number.isFinite(cutoff)) return [];
  return (state?.tasks || []).filter(task => {
    if (!task?.scheduledAt) return false;
    const due = Date.parse(task.scheduledAt);
    if (Number.isNaN(due)) return false;
    if (due > cutoff) return false;
    return isTaskScheduleEligible(task);
  });
}
