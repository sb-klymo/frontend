---
name: new-page
description: Scaffold a Next.js App Router route with page, loading, and error boundaries. Arguments - route path under src/app and which route group (marketing or app).
---

# New Page

Scaffold a new Next.js route with proper loading, error, and auth handling.

## Usage

`/new-page $ARGUMENTS`

Examples:
- `/new-page app/bookings` (goes into `(app)` group, authenticated)
- `/new-page marketing/pricing` (goes into `(marketing)` group, public)

## Arguments

- Route group (`app` or `marketing`)
- Route path (under that group)

## Steps

1. Create `src/app/(<group>)/<path>/page.tsx`
2. Create `src/app/(<group>)/<path>/loading.tsx`
3. Create `src/app/(<group>)/<path>/error.tsx`
4. Optionally create `_components/` folder for route-private components
5. If the page fetches data on the server, use `<HydrationBoundary>` for client-side query hydration
6. If the page is client-side (rare — App Router favors Server Components), add `'use client'`
7. Add a Playwright E2E test in `tests/e2e/<path>.spec.ts`

## Template — `page.tsx` (Server Component)

```tsx
// src/app/(<group>)/<path>/page.tsx
export const metadata = {
  title: "<Page title> — Klymo",
};

export default async function <Name>Page() {
  // Fetch data on the server if needed:
  // const data = await fetch(`${process.env.BACKEND_URL}/...`).then(r => r.json());

  return (
    <section>
      <h1 className="text-2xl font-semibold">Title</h1>
      {/* Content */}
    </section>
  );
}
```

## Template — `loading.tsx`

```tsx
// src/app/(<group>)/<path>/loading.tsx
export default function Loading() {
  return <div className="animate-pulse">Loading…</div>;
}
```

## Template — `error.tsx`

```tsx
// src/app/(<group>)/<path>/error.tsx
"use client";  // Error boundaries are always Client Components

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="p-4">
      <h2 className="text-lg font-medium">Something went wrong</h2>
      <p className="text-sm text-gray-600">{error.message}</p>
      <button onClick={reset} className="mt-2 rounded bg-gray-900 px-3 py-1 text-white">
        Try again
      </button>
    </div>
  );
}
```

## Template — Playwright test

```ts
// tests/e2e/<path>.spec.ts
import { test, expect } from "@playwright/test";

test("<path> renders", async ({ page }) => {
  await page.goto("/<path>");
  await expect(page.getByRole("heading", { name: /title/i })).toBeVisible();
});
```

## Route groups

- `(marketing)` — public pages, landing, pricing, legal
- `(app)` — authenticated, wraps with an auth guard in its `layout.tsx`

Route groups `(name)` affect organization only — they don't change the URL. `src/app/(app)/chat/page.tsx` renders at `/chat`.

## Private folders

Use `_components/`, `_lib/`, etc. (underscore prefix) for route-private code that should NOT be routable.

```
src/app/(app)/chat/
├── page.tsx
├── loading.tsx
├── error.tsx
└── _components/
    ├── ChatStream.tsx        # not routable
    └── MessageList.tsx        # not routable
```

## Reminders

- Server Components are the default — add `'use client'` only when necessary
- Always provide `loading.tsx` and `error.tsx` for data-fetching routes
- Use `HydrationBoundary` when prefetching on the server
- Auth guard lives in `src/app/(app)/layout.tsx` — not per-page
- Always test routes with Playwright, especially for async Server Components (Vitest can't)
