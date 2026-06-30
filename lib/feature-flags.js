const DISABLED_VALUES = new Set(["0", "false", "off", "no", "disabled"]);

function defaultEnv() {
  return typeof process === "undefined" ? {} : process.env;
}

function parseEnabledFlag(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  return !DISABLED_VALUES.has(String(value).trim().toLowerCase());
}

export function areCreditsEnabled(env = defaultEnv()) {
  return parseEnabledFlag(env?.NEXT_PUBLIC_AICREW_CREDITS_ENABLED ?? env?.AICREW_CREDITS_ENABLED, true);
}

export function normalizeFeatureFlags(input = {}, env = defaultEnv()) {
  return {
    creditsEnabled:
      input?.creditsEnabled === undefined ? areCreditsEnabled(env) : parseEnabledFlag(input.creditsEnabled, true)
  };
}
