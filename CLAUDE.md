# frontend — Claude Code Context

Klymo chat UI — the user-facing interface. Next.js 16 with App Router, TypeScript, Tailwind 4. MVP deadline: **2026-05-18**.

Backend lives in [backend](https://github.com/sb-klymo/backend). Specs are in [docs](https://github.com/sb-klymo/docs).

## Source of truth

For any architectural question, read `../docs/ARCHITECTURE.md` first. For business rules, read `../docs/PRODUCT_SPEC.md`.

## Stack

- Node 22 LTS, TypeScript strict mode
- Next.js 16 (App Router, `src/` folder)
- Tailwind CSS 4 (CSS-first config, no `tailwind.config.js`)
- TanStack Query (server state) + Zustand (client state) — **NEVER Redux in new code**
- Stripe.js + Stripe Elements (card setup iframe)
- Supabase client (auth, realtime subscriptions)
- @hey-api/openapi-ts (generates TS types from `../docs/schemas/openapi.json`)
- Vitest (unit) + Playwright (E2E)
- ESLint + Prettier + TypeScript

## Build & test commands

```bash
npm install
npm run dev           # Next.js dev server (localhost:3000)
npm run build
npm run lint
npm run typecheck
npm test              # Vitest
npm run test:e2e      # Playwright
npm run gen:api       # Regenerate types from ../docs/schemas/openapi.json
```

## Project structure (Next.js App Router, src/)

```
src/
├── app/                        # Routing only
│   ├── layout.tsx
│   ├── globals.css             # @import "tailwindcss";
│   ├── (marketing)/            # Public route group (landing page)
│   ├── (app)/                  # Authenticated route group (chat, admin)
│   │   ├── layout.tsx          # Auth guard
│   │   ├── chat/
│   │   │   ├── page.tsx
│   │   │   ├── loading.tsx
│   │   │   └── _components/    # Private folder (not routable)
│   │   ├── onboarding/
│   │   └── admin/              # Simple admin dashboard (MVP)
│   └── api/                    # Next.js Route Handlers (BFF proxy to backend)
├── components/
│   ├── ui/                     # shadcn-style primitives
│   ├── layout/
│   └── features/
├── lib/
│   ├── api/
│   │   ├── client.ts           # fetch wrapper with auth + base URL
│   │   └── generated/          # ← @hey-api/openapi-ts output (gitignored)
│   ├── sse.ts                  # SSE consumer helper
│   └── utils.ts
├── hooks/
├── stores/                     # Zustand slices
├── providers/                  # QueryClientProvider, ThemeProvider
└── types/                      # Non-generated app-level types
```

## Critical invariants

1. **Never store server state in Zustand.** Server state lives in TanStack Query cache. Zustand is for UI state only (modals, selected tab, draft forms).
2. **Never add custom card UI.** Card data is captured by Stripe Elements iframes — never write a plain `<input>` for a card number.
3. **Always consume SSE via `ReadableStream` + `TextDecoder`** for chat (native `EventSource` can't send auth headers). See `rules/chat-ui.md`.
4. **Generated API client is gitignored** — runs via `npm run gen:api` when `../docs/schemas/openapi.json` changes. CI must also run it before `npm run build`.
5. **Vitest does not support async Server Components.** Cover those with Playwright E2E tests instead.

## Claude Code skills

| Skill | When to use |
|---|---|
| `/new-component` | Scaffold a React component with Vitest test + Tailwind + props type |
| `/new-page` | Scaffold a Next.js route with proper loading/error boundaries |
| `/new-api-client` | Scaffold a typed wrapper around the generated SDK |

## MCP servers configured

- **Stripe** (official) — Stripe.js docs, Elements guides
- **Supabase** (official) — client config, auth, realtime
- **Next.js DevTools** (Vercel official) — Next.js docs + Playwright
- **Playwright** (Microsoft official) — E2E test authoring + DOM inspection
- **Context7** — live docs for React, Next.js, Tailwind, Zustand, TanStack Query
- **GitHub** — issues, PRs, code search

## Conventions

- `'use client'` directive ONLY when strictly needed (hooks, browser APIs, event handlers) — prefer Server Components by default
- Path alias: `@/*` → `./src/*`
- No default exports in components (use named exports for better refactoring)
- Props types: `type Props = { ... }` inline, or separate in `types/`
- Tailwind: utility classes first, extract to component when repeated 3+ times
- Forms: React Hook Form + Zod (generated from OpenAPI via hey-api)

## What NOT to do

- Never write a card number `<input>` — use Stripe Elements iframe
- Never put server state (booking list, user profile) in Zustand
- Never use Redux in new code (legacy pattern in 2026)
- Never use `getServerSideProps` — this is App Router, use Server Components + `fetch`
- Never use `<a>` for internal navigation — use `next/link`
- Never skip the `alt` attribute on images
- Never commit `.env.local` or the generated `src/lib/api/generated/` folder
