# Benny

Bun + Turborepo monorepo with TanStack Start, Convex, and shadcn/ui.

## Structure

```text
apps/web              @benny/web — TanStack Start
packages/ui           @benny/ui — shadcn/ui components
packages/backend      @benny/backend — Convex functions
packages/config       @benny/config — shared TS, oxlint, oxfmt
```

## Setup

```bash
bun install
bun run setup   # Convex login / project (named benny) + syncs VITE_CONVEX_URL
bun quality:fix
bun typecheck
bun dev
```

## Scripts

| Script                            | Behavior                       |
| --------------------------------- | ------------------------------ |
| `bun dev`                         | Web + Convex in parallel       |
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
