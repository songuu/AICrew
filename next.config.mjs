const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "/aicrew";
const staticExport = process.env.AICREW_STATIC_EXPORT === "1";

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath,
  assetPrefix: `${basePath}/`,
  trailingSlash: true,
  images: {
    unoptimized: true
  },
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath
  }
};

if (staticExport) {
  nextConfig.output = "export";
}

export default nextConfig;
