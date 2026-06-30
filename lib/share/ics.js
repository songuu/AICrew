// .ics（iCalendar / RFC 5545）日历事件生成的纯逻辑层——排期层「主提醒轨」。
//
// 背景：纯静态站无法做真后台 push 提醒（无 VAPID push server、无 cron，静态导出与
// 生产 Next server 皆无）。最接近「tab 关也准时响」的零后端方案，是把排期导出成一个
// .ics 日历事件，由用户 OS 日历在到点前 N 分钟弹原生提醒——提醒所有权卸载给操作系统，
// 与浏览器/标签页生命周期彻底解耦。
// 边界（诚实声明）：内嵌 VALARM 的「到点准时响」仅在保留 VALARM 的客户端兑现
// （Apple Calendar / Outlook）；Google 日历导入会忽略内嵌提醒、改套其默认通知。
// 故 .ics 主轨对部分客户端非绝对保证，站内 toast 辅轨（仅 tab 开）作补充。
//
// 本模块只产纯字符串（VCALENDAR/VEVENT/VALARM），下载副作用（Blob + 锚点点击）由组件层处理。
// DTSTART/DTSTAMP 一律输出 UTC「Z」绝对时刻（用 getUTC* 系列），喂同一时刻在任意 host 时区
// 下输出恒定，杜绝 floating time 按本地墙钟漂移。

// 到点前提醒提前量（分钟）。OS 日历据 VALARM TRIGGER 在事件前这么久弹提醒。
export const DEFAULT_ALARM_MINUTES = 30;

// 事件时长（分钟）。日历事件需要 DTEND 或 DURATION；排期发布本身是一个时间点，
// 这里给一个象征性时长便于日历渲染成可见时段。
export const DEFAULT_DURATION_MINUTES = 30;

function toDate(input) {
  return input instanceof Date ? input : new Date(input);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

// 把任意时刻格式化为 iCalendar UTC 绝对时刻：YYYYMMDDTHHMMSSZ。
// 全程用 getUTC* —— 输出与运行进程的本地时区无关（防 floating time 漂移）。
export function formatIcsUtc(input) {
  const date = toDate(input);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`buildIcsCalendar: invalid date input: ${String(input)}`);
  }
  return (
    `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}` +
    `T${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}Z`
  );
}

// RFC 5545 §3.3.11 文本转义：反斜杠、分号、逗号、换行需转义。反斜杠必须最先处理，
// 否则后续插入的反斜杠会被二次转义。换行统一吞掉 CRLF、裸 LF、裸 CR（孤立回车也必须
// 中和，否则残留换行注入面：用户内容里的裸 \r 可被宽容解析器当行分隔，注入伪 VEVENT 字段）。
export function escapeIcsText(value) {
  return String(value == null ? "" : value)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|[\r\n]/g, "\\n");
}

// RFC 5545 §3.1 内容行折叠：单条逻辑行超 75 octet 时折成多物理行，续行以单空格起头。
// 按 UTF-8 字节宽度累计、按 code point 切分——绝不在多字节序列中间断开（中文 3 字节/字）。
// 续行的前导空格计入该行 75 octet 预算，故续行内容上限 74 octet。
function utf8ByteLength(text) {
  let bytes = 0;
  for (const char of text) {
    const cp = char.codePointAt(0);
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

function foldIcsLine(line) {
  const MAX_OCTETS = 75;
  if (utf8ByteLength(line) <= MAX_OCTETS) return line;
  const pieces = [];
  let current = "";
  let currentBytes = 0;
  let isFirst = true;
  for (const char of line) {
    const charBytes = utf8ByteLength(char);
    const budget = isFirst ? MAX_OCTETS : MAX_OCTETS - 1; // 续行预留 1 octet 给前导空格
    if (currentBytes + charBytes > budget) {
      pieces.push(isFirst ? current : ` ${current}`);
      isFirst = false;
      current = "";
      currentBytes = 0;
    }
    current += char;
    currentBytes += charBytes;
  }
  if (current) pieces.push(isFirst ? current : ` ${current}`);
  return pieces.join("\r\n");
}

// 基于 taskId + 排期时刻生成稳定可复现的 UID（同输入恒定输出，无随机/无时钟）——
// 同一排期重复导出 .ics 时，日历据 UID 去重/更新而非堆叠重复事件。
export function buildScheduleUid(taskId, scheduledAt) {
  return `aicrew-${String(taskId == null ? "task" : taskId)}-${formatIcsUtc(scheduledAt)}@aicrew`;
}

// 把一次排期组装成单事件 .ics 字符串。纯函数：无随机、无时钟（stampUtc 缺省取 startUtc）。
// 行以 CRLF 分隔（RFC 5545 要求）。返回完整 VCALENDAR 文本。
export function buildIcsCalendar({
  uid,
  title,
  description = "",
  startUtc,
  stampUtc,
  alarmMinutes = DEFAULT_ALARM_MINUTES,
  durationMinutes = DEFAULT_DURATION_MINUTES
} = {}) {
  if (startUtc == null) {
    throw new Error("buildIcsCalendar requires startUtc");
  }
  const dtStart = formatIcsUtc(startUtc);
  const dtStamp = formatIcsUtc(stampUtc == null ? startUtc : stampUtc);
  const safeAlarm = Math.max(0, Math.round(Number(alarmMinutes) || 0));
  const safeDuration = Math.max(1, Math.round(Number(durationMinutes) || DEFAULT_DURATION_MINUTES));
  // 负时长 = 事件前触发；0 用 PT0M（准点），非 0 用 -PTnM（提前）。
  const trigger = safeAlarm > 0 ? `-PT${safeAlarm}M` : "PT0M";
  const safeTitle = escapeIcsText(title);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AICrew//Schedule Layer//CN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid || buildScheduleUid("task", startUtc)}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DURATION:PT${safeDuration}M`,
    `SUMMARY:${safeTitle}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    "BEGIN:VALARM",
    `TRIGGER:${trigger}`,
    "ACTION:DISPLAY",
    `DESCRIPTION:${safeTitle}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR"
  ];
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}
