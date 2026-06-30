import test from "node:test";
import assert from "node:assert/strict";
import { areCreditsEnabled, normalizeFeatureFlags, publicFeatureFlagsFromEnv } from "../lib/feature-flags.js";
import { normalizeSystemAiConfig } from "../lib/ai/config.js";
import { createSystemAiRuntime, publicSystemAiConfig } from "../lib/ai/server-config.js";

test("credit feature flag defaults to enabled and accepts disabled env values", () => {
  assert.equal(areCreditsEnabled({}), true);
  assert.equal(areCreditsEnabled({ NEXT_PUBLIC_AICREW_CREDITS_ENABLED: "0" }), false);
  assert.equal(areCreditsEnabled({ NEXT_PUBLIC_AICREW_CREDITS_ENABLED: "false" }), false);
  assert.equal(areCreditsEnabled({ NEXT_PUBLIC_AICREW_CREDITS_ENABLED: "off" }), false);
  assert.equal(areCreditsEnabled({ NEXT_PUBLIC_AICREW_CREDITS_ENABLED: "1" }), true);
});

test("feature flags prefer explicit public env over private fallback", () => {
  assert.deepEqual(
    normalizeFeatureFlags({}, { AICREW_CREDITS_ENABLED: "0" }),
    { creditsEnabled: false }
  );
  assert.deepEqual(
    normalizeFeatureFlags({}, { NEXT_PUBLIC_AICREW_CREDITS_ENABLED: "1", AICREW_CREDITS_ENABLED: "0" }),
    { creditsEnabled: true }
  );
});


test("public feature flags parse build-time env for the client initial render", () => {
  assert.deepEqual(
    publicFeatureFlagsFromEnv({ NEXT_PUBLIC_AICREW_CREDITS_ENABLED: "0" }),
    { creditsEnabled: false }
  );
});
test("public AI config exposes credits feature flag without leaking secrets", () => {
  const runtime = createSystemAiRuntime({
    AICREW_AI_BASE_URL: "https://ai.example.com/v1",
    AICREW_AI_API_KEY: "secret-key",
    AICREW_AI_TEXT_MODEL: "text-xl",
    NEXT_PUBLIC_AICREW_CREDITS_ENABLED: "0"
  });
  const publicConfig = publicSystemAiConfig(runtime);

  assert.equal(publicConfig.features.creditsEnabled, false);
  assert.ok(!JSON.stringify(publicConfig).includes("secret-key"));
});

test("client AI config normalization preserves feature flags", () => {
  const config = normalizeSystemAiConfig({
    configured: false,
    features: { creditsEnabled: false }
  });

  assert.equal(config.features.creditsEnabled, false);
});
