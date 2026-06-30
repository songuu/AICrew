import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_ALARM_MINUTES,
  formatIcsUtc,
  escapeIcsText,
  buildScheduleUid,
  buildIcsCalendar
} from "../lib/share/ics.js";

test("formatIcsUtc emits YYYYMMDDTHHMMSSZ from the UTC absolute instant", () => {
  assert.equal(formatIcsUtc("2026-06-30T14:05:09.000Z"), "20260630T140509Z");
  // 从 Date 实例与从 ISO 串入参输出一致（都走 getUTC*）。
  assert.equal(formatIcsUtc(new Date("2026-01-02T03:04:05.000Z")), "20260102T030405Z");
});

test("formatIcsUtc is host-timezone independent (no floating time)", () => {
  // 同一绝对时刻无论以何种偏移写入，UTC 输出恒定：08:00+08:00 === 00:00Z。
  assert.equal(formatIcsUtc("2026-06-30T08:00:00+08:00"), "20260630T000000Z");
  assert.equal(formatIcsUtc("2026-06-30T00:00:00Z"), "20260630T000000Z");
});

test("formatIcsUtc throws on an invalid date", () => {
  assert.throws(() => formatIcsUtc("not-a-date"), /invalid date/);
});

test("escapeIcsText escapes backslash, semicolon, comma and newline (RFC5545)", () => {
  assert.equal(escapeIcsText("a,b;c\\d"), "a\\,b\\;c\\\\d");
  assert.equal(escapeIcsText("line1\nline2"), "line1\\nline2");
  assert.equal(escapeIcsText("crlf\r\nhere"), "crlf\\nhere");
  // 反斜杠先于其余字符转义，不产生二次转义。
  assert.equal(escapeIcsText("\\"), "\\\\");
  assert.equal(escapeIcsText(null), "");
});

test("escapeIcsText neutralizes a lone CR (closes the newline-injection surface)", () => {
  assert.equal(escapeIcsText("a\rb"), "a\\nb");
  assert.equal(escapeIcsText("a\r\nb"), "a\\nb");
  assert.equal(escapeIcsText("a\nb"), "a\\nb");
});

test("buildIcsCalendar folds long lines to <=75 octets with space-prefixed continuations (RFC5545 §3.1)", () => {
  const longCjk = "排期发布提醒".repeat(20); // ~360 octets of CJK, far over 75
  const ics = buildIcsCalendar({ title: "t", description: longCjk, startUtc: "2026-06-30T14:00:00.000Z" });
  const physicalLines = ics.split("\r\n");
  for (const line of physicalLines) {
    assert.ok(Buffer.byteLength(line, "utf8") <= 75, `line exceeds 75 octets: ${line}`);
  }
  // 折叠产生以单空格起头的续行，且绝不在多字节序列中间切断（上面的字节断言保证）。
  assert.ok(physicalLines.some(line => line.startsWith(" ")), "expected space-prefixed continuation lines");
  // 反折（去 CRLF + 续行前导空格）后逐字节还原原始 DESCRIPTION。
  const unfolded = ics.replace(/\r\n /g, "");
  assert.ok(unfolded.includes(`DESCRIPTION:${longCjk}`), "unfolded DESCRIPTION must equal original");
});

test("buildScheduleUid is stable and reproducible (no randomness, no clock)", () => {
  const a = buildScheduleUid("task_42", "2026-06-30T14:00:00.000Z");
  const b = buildScheduleUid("task_42", "2026-06-30T14:00:00.000Z");
  assert.equal(a, b);
  assert.equal(a, "aicrew-task_42-20260630T140000Z@aicrew");
});

test("buildIcsCalendar produces VCALENDAR/VEVENT/VALARM with UTC-Z DTSTART", () => {
  const ics = buildIcsCalendar({
    uid: "aicrew-task_1-20260630T140000Z@aicrew",
    title: "排期到点：小红书带稿发布",
    description: "玻尿酸面膜测评",
    startUtc: "2026-06-30T14:00:00.000Z"
  });
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /BEGIN:VEVENT/);
  assert.match(ics, /BEGIN:VALARM/);
  assert.match(ics, /END:VALARM/);
  assert.match(ics, /END:VEVENT/);
  assert.match(ics, /END:VCALENDAR/);
  assert.match(ics, /ACTION:DISPLAY/);
  // DTSTART/DTSTAMP 必为带 Z 的绝对时刻，无 floating time。
  assert.match(ics, /DTSTART:20260630T140000Z/);
  assert.match(ics, /DTSTAMP:\d{8}T\d{6}Z/);
  // VALARM 默认提前量。
  assert.match(ics, new RegExp(`TRIGGER:-PT${DEFAULT_ALARM_MINUTES}M`));
});

test("buildIcsCalendar joins lines with CRLF (no lone LF)", () => {
  const ics = buildIcsCalendar({ title: "t", startUtc: "2026-06-30T14:00:00.000Z" });
  assert.ok(ics.includes("\r\n"), "lines must be CRLF separated");
  // 不存在不以 \r 结尾的孤立 \n。
  assert.ok(!/[^\r]\n/.test(ics), "no lone LF allowed");
});

test("buildIcsCalendar escapes the title/description into SUMMARY", () => {
  const ics = buildIcsCalendar({
    title: "A, B; C",
    description: "x\ny",
    startUtc: "2026-06-30T14:00:00.000Z"
  });
  assert.match(ics, /SUMMARY:A\\, B\\; C/);
  assert.match(ics, /DESCRIPTION:x\\ny/);
});

test("buildIcsCalendar requires startUtc", () => {
  assert.throws(() => buildIcsCalendar({ title: "t" }), /requires startUtc/);
});

test("buildIcsCalendar uses PT0M trigger when alarmMinutes is 0", () => {
  const ics = buildIcsCalendar({ title: "t", startUtc: "2026-06-30T14:00:00.000Z", alarmMinutes: 0 });
  assert.match(ics, /TRIGGER:PT0M/);
});
