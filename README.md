# Benny

Bun + Turborepo monorepo with TanStack Start, Convex, and an AI browser scrape worker (self-hosted Stagehand).

## Structure

```text
apps/web              @benny/web — TanStack Start UI
apps/worker           @benny/worker — Stagehand LOCAL scrape worker
packages/ui           @benny/ui — shadcn/ui components
packages/backend      @benny/backend — Convex functions
packages/config       @benny/config — shared TS, oxlint, oxfmt
```

## Setup

```bash
bun install
bun run setup   # Convex login / project (named benny); writes root .env.local
```

Copy `.env.example` into `.env.local` and fill in:

- `WORKER_SECRET` / `CREDENTIALS_ENCRYPTION_KEY` (min 16 chars each)
- `OPENAI_API_KEY` (for the worker)

Set the same secrets on Convex:

```bash
npx convex env set WORKER_SECRET 'your-worker-secret'
npx convex env set CREDENTIALS_ENCRYPTION_KEY 'your-encryption-key'
```

```bash
bun quality:fix
bun typecheck
bun dev          # web + Convex
bun run worker   # Stagehand worker (needs Chrome + OPENAI_API_KEY)
```

Env lives in a single root `.env.local` (see `.env.example`). Vite, Convex, and the worker all use that file.

## Scraping flow

1. Add a **target** (URL + optional username/password).
2. Credentials are encrypted with AES-256-GCM before storage.
3. Click **play** to enqueue a run.
4. The worker claims pending runs and logs in with Stagehand (`env: "LOCAL"`), paginates the listing to collect every RFP/opportunity link, then opens each one and writes it to the `opportunities` table as it goes.

No Browserbase — Chromium runs on the worker host (local or Azure container).

## Scripts

| Script                            | Behavior                       |
| --------------------------------- | ------------------------------ |
| `bun dev`                         | Web + Convex in parallel       |
| `bun run worker`                  | AI browser scrape worker       |
| `bun build`                       | Production build               |
| `bun lint` / `bun lint:fix`       | oxlint                         |
| `bun format` / `bun format:fix`   | oxfmt check / write            |
| `bun quality` / `bun quality:fix` | lint + format together         |
| `bun typecheck`                   | `tsc --noEmit` across packages |
| `bun run setup`                   | One-shot Convex init           |

## Importing UI

```tsx
import { Button } from "@benny/ui/components/button";
```
