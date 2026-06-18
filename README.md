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

## Build

```bash
npm test
npm run build
```

`next.config.mjs` uses:

- `output: "export"`
- `basePath: "/aicrew"`
- `assetPrefix: "/aicrew/"`

The static artifact is emitted to `out/`.

## Static Preview

```bash
npm run build
npm run serve:out
```

Open:

```text
http://127.0.0.1:5173/aicrew/
```

## Deploy

The deploy contract mirrors `agent-build`:

```powershell
pwsh scripts/deploy.ps1
```

Default target:

| Field | Value |
|---|---|
| SSH host | `root@47.253.230.197` |
| Web root | `/opt/aicrew/current/out` |
| Base path | `/aicrew/` |
| Domain | `songuu.top` |

The script runs tests, builds, checks the `/aicrew` asset base, packages `out/`, uploads by `scp`, performs remote backup + atomic swap, then verifies public HTTPS paths.

## GitHub Actions Deploy

Pushes to `main` trigger `.github/workflows/deploy-aicrew.yml`, which runs:

```text
npm ci
npm test
npm run build
npm audit --omit=dev
artifact self-check
remote backup + atomic swap
production verification
root gateway entry verification
```

Required repository secret:

| Secret | Purpose |
|---|---|
| `AICREW_SSH_PRIVATE_KEY` | SSH private key with deploy access to the production host |

Optional repository secrets override the defaults:

| Secret | Default |
|---|---|
| `AICREW_DEPLOY_HOST` | `47.253.230.197` |
| `AICREW_DEPLOY_USER` | `root` |
| `AICREW_WEB_ROOT` | `/opt/aicrew/current/out` |
| `AICREW_DOMAIN` | `songuu.top` |

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
- Simulated Agent Runtime
- Simulated credit ledger and export packages
- Local persistence through `localStorage`

The current implementation intentionally simulates model outputs, video rendering, storage, payments, and authentication. The UX and workflow surfaces are complete for the PRD demo/MVP; production integrations can attach behind the domain functions in `src/domain.js`.
