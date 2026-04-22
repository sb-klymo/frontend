# frontend

Next.js 16 chat UI for Klymo — an AI conversational chatbot for booking flights and hotels.

Backend lives in [backend](https://github.com/sb-klymo/backend). Specs are in [docs](https://github.com/sb-klymo/docs).

## Stack

- Node 22 LTS
- Next.js 16 + TypeScript + App Router
- Tailwind CSS 4 (CSS-first config)
- TanStack Query (server state) + Zustand (client state)
- Stripe.js + Stripe Elements
- Supabase client (auth, realtime)
- @hey-api/openapi-ts for type generation
- Vitest (unit) + Playwright (E2E)

## Quickstart

```bash
npm install

cp .env.example .env.local
# Edit .env.local with your test keys

# First-time: generate API client from backend's OpenAPI schema
# (Requires the docs repo cloned as a sibling repo)
npm run gen:api

npm run dev              # localhost:3000
npm test                 # unit tests
npm run test:e2e         # E2E tests
npm run lint
npm run typecheck
```

## Project structure

Next.js App Router with `src/` folder, route groups, private folders:

```
src/
├── app/
│   ├── layout.tsx
│   ├── globals.css
│   ├── (marketing)/           # Public routes
│   ├── (app)/                 # Authenticated routes
│   └── api/                   # Route Handlers (BFF)
├── components/
│   ├── ui/                    # Primitives
│   ├── layout/
│   └── features/
├── lib/
│   ├── api/                   # API client + generated SDK
│   ├── sse.ts                 # SSE consumer helper
│   └── utils.ts
├── hooks/
├── stores/                    # Zustand slices (UI state only)
├── providers/                 # QueryClient, Theme
└── types/
```

## Critical invariants

- **Card UI = Stripe Elements iframe.** Never a plain `<input>` for a card number.
- **Server state → TanStack Query.** Never mirror it into Zustand.
- **SSE consumption via `fetch` + `ReadableStream`.** Native `EventSource` can't send auth headers.
- **Generated API client (`src/lib/api/generated/`) is gitignored.** Regenerate with `npm run gen:api`.

## Claude Code skills

- `/new-component` — scaffold a React component with test
- `/new-page` — scaffold a Next.js route with loading + error boundaries
- `/new-api-client` — typed wrapper around the generated SDK + TanStack Query hooks

## Deployment

- **Vercel** is the intended target
- Build command: `npm run gen:api && npm run build`
- Environment variables must be set in Vercel dashboard (never in git)
- Deploy **after** the backend: the frontend depends on the backend's OpenAPI schema being committed to the docs repo
