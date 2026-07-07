import test from "node:test";
import assert from "node:assert/strict";

import {
  REDNOTE_HOME_DEEPLINK,
  REDNOTE_PROFILE_DEEPLINK,
  REDNOTE_PUBLISH_BASE_DEEPLINK,
  REDNOTE_PUBLISH_DEEPLINK,
  REDNOTE_PUBLISH_STEPS,
  buildRednotePublishDeeplink,
  canLaunchRednoteDeeplink,
  supportsRednoteHandoff,
  buildRednoteShareText
} from "../lib/share/rednote.js";

function parseRednoteDeeplink(url) {
  const [base, query = ""] = url.split("?");
  const params = new URLSearchParams(query);
  return {
    base,
    params,
    source: JSON.parse(params.get("source"))
  };
}

test("deeplink targets the official 小红书 publisher with personal source", () => {
  const parsed = parseRednoteDeeplink(REDNOTE_PUBLISH_DEEPLINK);
  assert.equal(parsed.base, REDNOTE_PUBLISH_BASE_DEEPLINK);
  assert.equal(parsed.base, "xhsdiscover://post");
  assert.ok(!REDNOTE_PUBLISH_DEEPLINK.includes("post_note"), "legacy post_note should not be the default route");
  assert.equal(parsed.source.type, "personal");
  assert.equal(parsed.source.ids, "");
  assert.equal(parsed.source.extraInfo.from, "aicrew");
  assert.equal(parsed.source.extraInfo.handoff, "clipboard");
});

test("buildRednotePublishDeeplink keeps source and draft options explicit", () => {
  const parsed = parseRednoteDeeplink(buildRednotePublishDeeplink({
    sourceType: "home",
    sourceIds: "source-1",
    ignoreDraft: true,
    extraInfo: { handoff: "web-share" }
  }));
  assert.equal(parsed.base, "xhsdiscover://post");
  assert.equal(parsed.params.get("ignore_draft"), "true");
  assert.equal(parsed.source.type, "home");
  assert.equal(parsed.source.ids, "source-1");
  assert.equal(parsed.source.extraInfo.from, "aicrew");
  assert.equal(parsed.source.extraInfo.handoff, "web-share");
});

test("buildRednotePublishDeeplink falls back to personal source for unknown source types", () => {
  const parsed = parseRednoteDeeplink(buildRednotePublishDeeplink({ sourceType: "unsupported" }));
  assert.equal(parsed.source.type, "personal");
});

test("personal entry links target documented 小红书 pages", () => {
  assert.equal(REDNOTE_HOME_DEEPLINK, "xhsdiscover://home");
  assert.equal(REDNOTE_PROFILE_DEEPLINK, "xhsdiscover://me/profile");
});

test("canLaunchRednoteDeeplink prevents desktop Chrome from firing an unregistered scheme", () => {
  assert.equal(canLaunchRednoteDeeplink({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
    platform: "Win32",
    maxTouchPoints: 0
  }), false);
  assert.equal(canLaunchRednoteDeeplink({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
    platform: "MacIntel",
    maxTouchPoints: 0
  }), false);
});

test("canLaunchRednoteDeeplink allows mobile app handoff targets", () => {
  assert.equal(canLaunchRednoteDeeplink({
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Safari/604.1",
    platform: "iPhone",
    maxTouchPoints: 5
  }), true);
  assert.equal(canLaunchRednoteDeeplink({
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36",
    platform: "Linux armv8l",
    maxTouchPoints: 5
  }), true);
  assert.equal(canLaunchRednoteDeeplink({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
    platform: "MacIntel",
    maxTouchPoints: 5
  }), true);
});

test("publish steps are a non-empty credential-free guidance list", () => {
  assert.ok(Array.isArray(REDNOTE_PUBLISH_STEPS));
  assert.equal(REDNOTE_PUBLISH_STEPS.length, 3);
  for (const step of REDNOTE_PUBLISH_STEPS) {
    assert.equal(typeof step, "string");
    assert.ok(step.trim().length > 0, "each step should be a non-empty instruction");
  }
});

test("handoff is gated to 小红书 products only", () => {
  assert.equal(supportsRednoteHandoff("小红书"), true);
  for (const other of ["抖音", "视频号", "", undefined, null]) {
    assert.equal(supportsRednoteHandoff(other), false, `${other} should not get rednote handoff`);
  }
});

test("buildRednoteShareText joins caption + hashtags with a blank line", () => {
  const out = buildRednoteShareText({
    caption: "玻尿酸面膜真实测评",
    hashtags: ["#护肤", "#面膜测评"]
  });
  assert.equal(out.caption, "玻尿酸面膜真实测评");
  assert.deepEqual(out.hashtags, ["#护肤", "#面膜测评"]);
  assert.equal(out.text, "玻尿酸面膜真实测评\n\n#护肤 #面膜测评");
});

test("buildRednoteShareText adds # only when missing (no double prefix)", () => {
  const out = buildRednoteShareText({ caption: "标题", hashtags: ["护肤", "#面膜", "  ", null] });
  assert.deepEqual(out.hashtags, ["#护肤", "#面膜"]);
  assert.equal(out.text, "标题\n\n#护肤 #面膜");
});

test("buildRednoteShareText omits the blank line when one part is empty", () => {
  assert.equal(buildRednoteShareText({ caption: "只有正文", hashtags: [] }).text, "只有正文");
  assert.equal(buildRednoteShareText({ caption: "", hashtags: ["#只有话题"] }).text, "#只有话题");
  assert.equal(buildRednoteShareText({}).text, "");
});

test("buildRednoteShareText is defensive against non-array hashtags", () => {
  const out = buildRednoteShareText({ caption: "标题", hashtags: "not-an-array" });
  assert.deepEqual(out.hashtags, []);
  assert.equal(out.text, "标题");
});
