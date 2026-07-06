const DEFAULT_BASE_PATH = "/aicrew";
const KNOWN_RUNTIME_MOUNTS = [DEFAULT_BASE_PATH];

function defaultEnv() {
  return typeof process === "undefined" ? {} : process.env;
}

export function normalizeBasePath(value, fallback = "") {
  if (value === undefined || value === null) return normalizeBasePath(fallback, "");
  const text = String(value).trim();
  if (!text || text === "/") return "";
  return "/" + text.replace(/^\/+|\/+$/g, "");
}

export function configuredBasePath(env = defaultEnv()) {
  const raw = env?.NEXT_PUBLIC_BASE_PATH;
  return normalizeBasePath(raw === undefined || raw === null ? DEFAULT_BASE_PATH : raw);
}

function pathMatchesBase(pathname, basePath) {
  return Boolean(basePath) && (pathname === basePath || pathname.startsWith(`${basePath}/`));
}

export function inferRuntimeBasePath(pathname = "", configured = configuredBasePath()) {
  const normalizedConfigured = normalizeBasePath(configured);
  const normalizedPathname = typeof pathname === "string" ? pathname : "";
  if (pathMatchesBase(normalizedPathname, normalizedConfigured)) return normalizedConfigured;
  for (const mount of KNOWN_RUNTIME_MOUNTS) {
    if (pathMatchesBase(normalizedPathname, mount)) return mount;
  }
  return normalizedConfigured;
}

export function resolveRuntimeBasePath(locationLike = null, configured = configuredBasePath()) {
  const currentLocation = locationLike || (typeof window === "undefined" ? null : window.location);
  return inferRuntimeBasePath(currentLocation?.pathname || "", configured);
}

export function ensureLeadingSlash(path) {
  const text = String(path || "");
  return text.startsWith("/") ? text : `/${text}`;
}

export function withTrailingSlashBeforeSearch(path) {
  const text = ensureLeadingSlash(path);
  const searchIndex = text.indexOf("?");
  const pathname = searchIndex === -1 ? text : text.slice(0, searchIndex);
  const search = searchIndex === -1 ? "" : text.slice(searchIndex);
  if (pathname === "/" || pathname.endsWith("/")) return `${pathname}${search}`;
  return `${pathname}/${search}`;
}

export function buildRuntimePath(path, locationLike = null, configured = configuredBasePath()) {
  return `${resolveRuntimeBasePath(locationLike, configured)}${ensureLeadingSlash(path)}`;
}

export function buildRuntimeApiPath(path, locationLike = null, configured = configuredBasePath()) {
  return buildRuntimePath(withTrailingSlashBeforeSearch(path), locationLike, configured);
}
