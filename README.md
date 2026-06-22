# AICrew Studio

AICrew Studio is a Next.js implementation of `docs/AICrew_Studio_RoboNeo_Product_PRD.md`.

Production target:

```text
https://songuu.top/aicrew/
```

Root gateway target:

```text
https://songuu.top/
```

## Local Development

```bash
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:3000/aicrew/
```

## AI Platform Configuration

AICrew now uses project-level system configuration. Users cannot enter API tokens, base URLs, or custom models in the UI. The browser only receives the public model catalog and saves selected model ids.

Put the system AI settings directly in the project root `.env` file. The file is ignored by git, and Next.js loads it automatically for `npm run dev`, `npm run build`, and `npm start`.

Required `.env` values for real AI generation:

| Variable | Purpose |
|---|---|
| `AICREW_AI_BASE_URL` | OpenAI-compatible or provider API base URL |
| `AICREW_AI_API_KEY` | Server-side API key, never returned to the browser |
| `AICREW_AI_TEXT_MODEL` | Text model used for scripts, captions, hooks, and hashtags |

Optional variables:

| Variable | Purpose |
|---|---|
| `AICREW_AI_PROVIDER` | `openai-compatible` (default), `openai`, or `claude` |
| `AICREW_AI_PROVIDER_NAME` | Display name shown in the AI settings page |
| `AICREW_AI_IMAGE_MODEL` | Image model used for cover/product images |
| `AICREW_AI_IMAGE_API` | `siliconflow` or `openai`; SiliconFlow is auto-detected from `api.siliconflow.cn` |
| `AICREW_AI_VIDEO_MODEL` | Video model shown in the system model selector |
| `AICREW_AI_IMAGE_SIZE` | Image generation size, default `1024x1024` |
| `AICREW_AI_IMAGE_BATCH_SIZE` | SiliconFlow image count, default `1` |
| `AICREW_AI_IMAGE_STEPS` | SiliconFlow inference steps, default `20` |
| `AICREW_AI_IMAGE_GUIDANCE_SCALE` | SiliconFlow guidance scale, default `7.5` |
| `AICREW_AI_MODELS_JSON` | JSON catalog for multiple text/image/video system models |

Example `.env` values:

```dotenv
AICREW_AI_PROVIDER=openai-compatible
AICREW_AI_PROVIDER_NAME=项目 AI 平台
AICREW_AI_BASE_URL=https://api.siliconflow.cn/v1
AICREW_AI_API_KEY=sk-project
AICREW_AI_TEXT_MODEL=deepseek-ai/DeepSeek-V4-Pro
AICREW_AI_IMAGE_MODEL=Kwai-Kolors/Kolors
AICREW_AI_IMAGE_API=siliconflow
AICREW_AI_IMAGE_SIZE=1024x1024
AICREW_AI_VIDEO_MODEL=video-pro
```

For SiliconFlow image generation, AICrew sends `image_size`, `batch_size`, `num_inference_steps`, and `guidance_scale`, and reads the returned `images[0].url`. SiliconFlow image URLs expire after one hour, so generated covers should be treated as runtime assets unless you add a later download/storage step.

## Build

```bash
npm test
npm run build
```

Default build is a Next server build because `/api/ai/config` and `/api/ai/generate` read server-side environment variables.

`next.config.mjs` uses:

- `basePath: "/aicrew"`
- `assetPrefix: "/aicrew/"`
- `trailingSlash: true`

## Static Preview

Static export is still available for preview-only builds, but the AI API routes are not available in that mode.

```bash
AICREW_STATIC_EXPORT=1 npm run build
npm run serve:out
```

Open:

```text
http://127.0.0.1:5173/aicrew/
```

## Deploy

Production runs as a PM2-managed Next server behind Nginx:

- Public URL: `https://songuu.top/aicrew/`
- PM2 app: `aicrew-studio`
- Local server: `127.0.0.1:3101`
- Current release symlink: `/opt/aicrew/current-server`

System AI requires the server environment variables above. Deploy with:

```powershell
pwsh scripts/deploy-server.ps1
```

The script requires the project root `.env`, packages it into the server release, writes it to `/opt/aicrew/releases/<timestamp>/.env`, sets permissions to `600`, switches `/opt/aicrew/current-server`, and restarts PM2. After deploy, the server reads `.env` directly and the AI routes are usable without any browser-side configuration.

The older static `out/` deploy flow only works for preview/static mode and cannot serve the AI API routes.

## Product Scope

- Landing/dashboard console
- Login/signup/onboarding shell
- AI creative workbench
- Projects and versions
- Asset library
- Skill library and saved Skill
- Brand Kit / Brand Memory
- Export Center
- Billing and credit ledger
- Admin task and model monitor
- System AI platform integration via server environment variables
- Text/image/video system model selector
- Local persistence through `localStorage` for workspace state and selected model ids only

The implementation still simulates storage, payments, authentication, and final video rendering. Text generation and cover image generation can use the configured system AI platform; without server AI env it falls back to deterministic demo output.
