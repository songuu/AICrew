import test from "node:test";
import assert from "node:assert/strict";
import {
  AI_ROUTE_PUBLIC_ERROR,
  AiRouteInputError,
  assertAiRouteRateLimit,
  normalizeAiRouteBody,
  publicAiRouteError,
  rateLimitKeyFromRequest,
  readBoundedJsonBody,
  sanitizeImageSize
} from "../lib/ai/routeGuard.js";

test("normalizeAiRouteBody rejects invalid mode and oversized prompts", () => {
  assert.throws(() => normalizeAiRouteBody({ mode: "audio", prompt: "x" }), AiRouteInputError);
  assert.throws(() => normalizeAiRouteBody({ mode: "text", prompt: "x".repeat(12001) }), /prompt/);
});

test("normalizeAiRouteBody trims request fields and clamps max tokens", () => {
  const body = normalizeAiRouteBody({ mode: "text", modelId: " m ", prompt: " hello ", system: " sys ", maxTokens: 99999 });
  assert.equal(body.mode, "text");
  assert.equal(body.modelId, "m");
  assert.equal(body.prompt, "hello");
  assert.equal(body.system, "sys");
  assert.equal(body.maxTokens, 4096);
});

test("assertAiRouteRateLimit blocks more than the per-minute allowance", () => {
  const key = "unit-rate-" + Date.now();
  for (let index = 0; index < 30; index += 1) assert.doesNotThrow(() => assertAiRouteRateLimit(key, 1_000));
  assert.throws(() => assertAiRouteRateLimit(key, 1_000), error => {
    assert.ok(error instanceof AiRouteInputError);
    assert.equal(error.status, 429);
    return true;
  });
});

test("publicAiRouteError hides provider details from browser responses", () => {
  const leaked = new Error("upstream 401 https://api.example.com?api_key=sk-secret Bearer sk-secret");
  assert.equal(publicAiRouteError(leaked), AI_ROUTE_PUBLIC_ERROR);
  assert.equal(publicAiRouteError(new AiRouteInputError("bad input")), "bad input");
});


test("rateLimitKeyFromRequest ignores spoofable client IP headers", () => {
  const request = new Request("https://example.test", { headers: { "x-forwarded-for": "1.2.3.4", "x-real-ip": "10.0.0.1" } });
  assert.equal(rateLimitKeyFromRequest(request), "global");
});

test("readBoundedJsonBody rejects oversized bodies before route normalization", async () => {
  const request = new Request("https://example.test", {
    method: "POST",
    headers: { "content-length": "70000" },
    body: JSON.stringify({ mode: "text", prompt: "hello" })
  });
  await assert.rejects(() => readBoundedJsonBody(request), error => {
    assert.ok(error instanceof AiRouteInputError);
    assert.equal(error.status, 413);
    return true;
  });
});

test("sanitizeImageSize accepts bounded dimensions and rejects provider-sized junk", () => {
  assert.equal(sanitizeImageSize("1024x1024"), "1024x1024");
  assert.throws(() => sanitizeImageSize("99999x1"), AiRouteInputError);
  assert.throws(() => normalizeAiRouteBody({ mode: "image", prompt: "x", size: "bad;drop" }), AiRouteInputError);
});
