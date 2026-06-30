const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "/aicrew";
const staticExport = process.env.AICREW_STATIC_EXPORT === "1";
const creditsEnabled = process.env.NEXT_PUBLIC_AICREW_CREDITS_ENABLED ?? process.env.AICREW_CREDITS_ENABLED ?? "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath,
  assetPrefix: `${basePath}/`,
  trailingSlash: true,
  images: {
    unoptimized: true
  },
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_AICREW_CREDITS_ENABLED: creditsEnabled
  }
};

if (staticExport) {
  nextConfig.output = "export";
}

export default nextConfig;
