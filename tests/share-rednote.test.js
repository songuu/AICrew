import test from "node:test";
import assert from "node:assert/strict";

import {
  REDNOTE_PUBLISH_DEEPLINK,
  REDNOTE_PUBLISH_STEPS,
  supportsRednoteHandoff,
  buildRednoteShareText
} from "../lib/share/rednote.js";

test("deeplink targets the 小红书 image-note publisher", () => {
  assert.equal(REDNOTE_PUBLISH_DEEPLINK, "xhsdiscover://post_note/");
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
