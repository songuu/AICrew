import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRuntimeApiPath,
  buildRuntimePath,
  inferRuntimeBasePath,
  normalizeBasePath,
  withTrailingSlashBeforeSearch
} from "../lib/runtime/base-path.js";

test("runtime base path falls back to the mounted /aicrew path when the bundled env is empty", () => {
  assert.equal(inferRuntimeBasePath("/aicrew/billing/", ""), "/aicrew");
  assert.equal(buildRuntimeApiPath("/api/credits/wallet", { pathname: "/aicrew/billing/" }, ""), "/aicrew/api/credits/wallet/");
});

test("runtime path keeps configured root deployments working", () => {
  assert.equal(inferRuntimeBasePath("/billing/", ""), "");
  assert.equal(buildRuntimePath("/billing/", { pathname: "/billing/" }, ""), "/billing/");
  assert.equal(buildRuntimeApiPath("/api/credits/wallet", { pathname: "/billing/" }, ""), "/api/credits/wallet/");
});

test("runtime API path appends the trailing slash before query strings", () => {
  assert.equal(withTrailingSlashBeforeSearch("/api/canvas?key=main"), "/api/canvas/?key=main");
  assert.equal(buildRuntimeApiPath("/api/canvas?key=main", { pathname: "/aicrew/canvas/" }, "/aicrew"), "/aicrew/api/canvas/?key=main");
});

test("base path normalization handles leading and trailing slashes", () => {
  assert.equal(normalizeBasePath("aicrew/"), "/aicrew");
  assert.equal(normalizeBasePath("/"), "");
});
