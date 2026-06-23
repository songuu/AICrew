import test from "node:test";
import assert from "node:assert/strict";
import { assembleExportBundle } from "../lib/export/bundle.js";
import { runCreativeWorkflow, normalizeBrief } from "../lib/domain.js";

function imageTask() {
  return runCreativeWorkflow({
    brief: normalizeBrief({ productName: "玻尿酸面膜", platform: "小红书" }),
    skillId: "rednote_seeding_note_v1"
  });
}

test("assembleExportBundle extracts downloadable text files with real content", () => {
  const task = imageTask();
  const bundle = assembleExportBundle(task.exports[0], task.variants[0]);
  const names = bundle.textFiles.map(file => file.name);

  assert.ok(names.includes("copy.md"));
  assert.ok(names.includes("note.md"));
  assert.ok(bundle.textFiles.every(file => file.content.length > 0));
});

test("assembleExportBundle resolves cover image from live variant.imageUrl (data vs https)", () => {
  const task = imageTask();
  const variant = task.variants[0];

  const none = assembleExportBundle(task.exports[0], variant);
  assert.equal(none.imageFiles.length, 0); // 无 imageUrl → 无可下载图

  const withData = assembleExportBundle(task.exports[0], { ...variant, imageUrl: "data:image/png;base64,X" });
  assert.equal(withData.imageFiles[0].name, "cover.png");
  assert.equal(withData.imageFiles[0].dataUrl, "data:image/png;base64,X");

  const withHttps = assembleExportBundle(task.exports[0], { ...variant, imageUrl: "https://cdn.example.com/cover.png" });
  assert.equal(withHttps.imageFiles[0].url, "https://cdn.example.com/cover.png");
  assert.equal(withHttps.imageFiles[0].dataUrl, undefined);
});

test("assembleExportBundle excludes placeholder video and is pure", () => {
  const task = runCreativeWorkflow({
    brief: normalizeBrief({ productName: "Lamp", platform: "抖音" }),
    skillId: "ecom_tiktok_product_ad_v1"
  });
  const variant = { ...task.variants[0], imageUrl: "data:image/png;base64,Y" };

  const first = assembleExportBundle(task.exports[0], variant);
  const second = assembleExportBundle(task.exports[0], variant);
  assert.deepEqual(first, second);
  assert.ok(!first.textFiles.some(file => file.name === "video.mp4"));
  assert.ok(!first.imageFiles.some(file => file.name === "video.mp4"));
});
