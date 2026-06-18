# AICrew Studio

AICrew Studio is a zero-dependency Web implementation of the product described in `docs/AICrew_Studio_RoboNeo_Product_PRD.md`.

## Run

```bash
npm start
```

Open:

```text
http://127.0.0.1:5173
```

If port `5173` is occupied, `server.mjs` tries the next available port.

## Test

```bash
npm test
```

## Product Scope

- Dashboard
- AI creative workbench
- Projects
- Assets
- Skill library
- Brand Kit
- Export Center
- Billing and credits
- Admin task/model monitor
- Simulated Agent Runtime
- Simulated credit ledger and export packages

The current implementation intentionally uses localStorage and simulated model outputs. Real authentication, database, object storage, model APIs, payments, and video rendering are deferred to later implementation phases.
