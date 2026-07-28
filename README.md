# CA CommonGrants API

A [CommonGrants](https://commongrants.org)-compliant HTTP API that surfaces [California Grants Portal](https://data.ca.gov/dataset/california-grants-portal) data in a standard, interoperable format.

This project is both a **proof of concept** that demonstrates how a state grants portal can expose its data via the CommonGrants protocol, and a **reference template** for building CommonGrants API proxies against any source system. It is a sibling of the [Pennsylvania API](https://github.com/agilesix/cg-api-pa) and shares its architecture; only the `src/adapter/` layer differs.

## Overview

The API fetches grant opportunity data from California's open data portal (a [CKAN DataStore](https://docs.ckan.org/en/latest/maintaining/datastore.html) resource on `data.ca.gov`), normalizes it into the CommonGrants `Opportunity` schema (plus CA-specific custom fields), and serves it via standard CommonGrants endpoints.

Data is kept fresh by a scheduled ETL that runs **every 8 hours** (California refreshes roughly once a day). Syncs are **incremental**: the ETL tracks a high-watermark of the maximum source `LastUpdated` ingested and asks the upstream for only the changed delta, so a steady-state run fetches a handful of records instead of re-streaming the whole dataset. Records are never deleted — an opportunity removed upstream stays at its last-known state.

**Default deployment:** Cloudflare Workers + D1 (SQLite) + R2 (raw snapshots). Every layer is swappable — see [PORTING.md](PORTING.md) for recipes.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  src/index.ts          (Workers entrypoint)                     │
│     ↓ buildConfig(env)                                          │
│  src/cg.config.ts      (wires adapter + storage + snapshots)    │
│     ↓                                                           │
│  src/app.ts            (Hono factory; accepts AppConfig)        │
├─────────────────────────────────────────────────────────────────┤
│  routes/         services/         etl/ (incremental sync)      │
│     ↓                ↓                ↓                         │
│  ISourceClient · IOppRepo · ISnapshotStore                      │
├─────────────────────────────────────────────────────────────────┤
│  storage/ (pick one IOppRepo impl per deploy)                   │
│    ProxyOppRepo   — tier 0, no persistence                      │
│    SqliteOppRepo  — tier 3, Kysely + D1/SQLite (default)        │
│    (sync_state table holds the incremental high-watermark)      │
│                                                                 │
│  snapshots/                                                     │
│    BucketSnapshotStore  — R2 / S3 / GCS                         │
│    NoopSnapshotStore    — disabled                               │
├─────────────────────────────────────────────────────────────────┤
│  adapter/                                                        │
│    plugin.ts     — definePlugin() → CaPlugin (schema +          │
│                    sourceSchema + toCommon/fromCommon + meta)   │
│    transform.ts  — caGrantToOpportunity() pure fn               │
│    getSourceId / getModifiedAt / buildSearchText — per-source   │
│                    SQL-tier hooks (getModifiedAt drives the     │
│                    incremental watermark)                       │
│    CaSourceClient — ISourceClient for the CKAN DataStore        │
│    (future: extract to @common-grants/cg-ca)                    │
└─────────────────────────────────────────────────────────────────┘
```

## Deployment tiers

The `IOppRepo` interface supports all tiers; pick one in `src/cg.config.ts`.

| Tier                  | Repository impl            | Storage                | Search                                           | Best for                                            |
| --------------------- | -------------------------- | ---------------------- | ------------------------------------------------ | --------------------------------------------------- |
| **0 — Proxy**         | `ProxyOppRepo`             | None                   | Delegates to source API, or JS filter (fallback) | POC / demos / sources with native search / zero-ops |
| **1 — Memory**        | `MemoryOppRepo` (future)   | Process memory         | JS filter                                        | Node server, single instance, small data            |
| **2 — KV**            | `KvOppRepo` (future)       | CF KV / Upstash        | JS filter on blob                                | Serverless, read-heavy                              |
| **3 — SQL (default)** | `SqliteOppRepo`            | D1 / SQLite via Kysely | SQL WHERE + FTS5                                 | Most production cases                               |
| **4 — Enterprise**    | `PostgresOppRepo` (future) | Postgres / warehouse   | SQL + tsvector / ES                              | Large data, strict security                         |

Routes, services, ETL, adapter, and the plugin layer are **identical across all tiers** — only which `IOppRepo` impl `src/cg.config.ts` wires changes.

## Getting started

See [DEVELOPMENT.md](DEVELOPMENT.md) for local setup and the dev workflow. Short version:

```bash
corepack enable
pnpm install
pnpm exec wrangler login    # one-time
pnpm run bootstrap          # idempotent: creates D1+R2, patches wrangler.jsonc, applies migrations
pnpm run dev
```

Then hit `http://localhost:8787/docs`.

> **No clickops policy.** First-time setup is fully scripted. Don't click through the Cloudflare dashboard — if something's missing from `pnpm run bootstrap`, add it there.

## Project conventions

- **TypeScript + Hono on Cloudflare Workers.** Routes defined with `@hono/zod-openapi` so the OpenAPI spec is auto-generated at `/openapi.json`. Docs UI at `/docs` (Scalar via CDN, no bundled dependency).
- **Schemas from `@common-grants/sdk`.** No handwritten opportunity schema, filters, or pagination envelope — the SDK provides them. Applicant eligibility uses the native `acceptedApplicantTypes` field.
- **Custom fields aligned with the [CommonGrants custom fields catalog](https://commongrants.org/custom-fields/).** Catalog value schemas (`agency`, `contactInfo`, `additionalInfo`, `costSharing`) are mirrored verbatim from the grants.gov plugin. Concepts shared with other state sources use **unprefixed keys** (`fundingSource`, `fundingInstrument`, `lastSyncedAt`) defined identically in the PA plugin; source-unique data stays `ca*`-prefixed. Applicant eligibility uses the native `acceptedApplicantTypes` field, and matching-funds requirements fold into `costSharing` (`{ isRequired, percentage, details }`).
- **Auto-generated spec validated against the CommonGrants base protocol** via `cg check spec` from `@common-grants/cli`. Runs in CI.
- **Auto-generated SQL types** via `kysely-codegen`. Never hand-edit `src/storage/sql/schema.ts`.
- **No deep cross-directory imports.** Every `src/<dir>/` has an `index.ts` public surface. Lint-enforced.

## Forking for a different source system

This template is designed to be forked for any grants source. To adapt it:

1. Replace `src/adapter/` with an adapter for your source (plugin, transform, HTTP client).
2. Update resource names in `wrangler.jsonc` with your state/funder prefix.
3. Update `src/cg.config.ts` to wire your adapter's `ISourceClient`.
4. Pick a deployment tier per [PORTING.md](PORTING.md).

When your source exposes a per-record last-modified field, supply a `getModifiedAt` hook to enable incremental sync (see `src/adapter/index.ts`).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

See [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). Copyright © 2026 Agile Six Applications, Inc.
