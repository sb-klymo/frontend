# State Management — TanStack Query + Zustand

Klymo uses a **three-layer split** for state. Mixing them wrong causes sync bugs.

## The layers

| Layer | Tool | Stores | Example |
|---|---|---|---|
| Server state | **TanStack Query** | Data fetched from the backend | Booking list, user profile, search results |
| Client/UI state | **Zustand** | Ephemeral UI state | Sidebar open/closed, theme, draft form |
| Atomic state | **Jotai** (optional) | Only if deeply nested sharing needs arise | (Not used in MVP) |

## Rule 1 — Never mirror server state in Zustand

This is the #1 bug in React apps. Example of what NOT to do:

```ts
// ❌ BAD
const useStore = create((set) => ({
  bookings: [],
  setBookings: (bookings) => set({ bookings }),
}));

// Somewhere else:
const { data } = useQuery({ queryKey: ["bookings"], queryFn: fetchBookings });
useEffect(() => setBookings(data), [data]);  // sync nightmare
```

```ts
// ✅ GOOD — just use the query directly wherever needed
const { data: bookings } = useQuery({ queryKey: ["bookings"], queryFn: fetchBookings });
```

## Server state (TanStack Query)

### Query keys

Consistent pattern: `[entity, scope, params]`:

```ts
useQuery({ queryKey: ["bookings", "list"], queryFn: fetchBookings });
useQuery({ queryKey: ["bookings", "detail", bookingId], queryFn: () => fetchBooking(bookingId) });
useQuery({ queryKey: ["users", "current"], queryFn: fetchCurrentUser });
```

### Mutations + invalidation

```ts
const queryClient = useQueryClient();

const createBooking = useMutation({
  mutationFn: postBooking,
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["bookings"] });
  },
});
```

### Hydration with Server Components

Fetch on the server, hydrate on the client:

```tsx
// src/app/(app)/bookings/page.tsx
export default async function BookingsPage() {
  const queryClient = new QueryClient();
  await queryClient.prefetchQuery({
    queryKey: ["bookings", "list"],
    queryFn: fetchBookings,
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <BookingsList />
    </HydrationBoundary>
  );
}
```

## Client state (Zustand)

Small, focused slices — one concern per store.

```ts
// src/stores/chatStore.ts
import { create } from "zustand";

type ChatStore = {
  draft: string;
  setDraft: (draft: string) => void;
  isStreaming: boolean;
  setStreaming: (streaming: boolean) => void;
};

export const useChatStore = create<ChatStore>((set) => ({
  draft: "",
  setDraft: (draft) => set({ draft }),
  isStreaming: false,
  setStreaming: (isStreaming) => set({ isStreaming }),
}));
```

### Selectors to avoid re-renders

```ts
const draft = useChatStore((s) => s.draft);      // re-renders only when draft changes
const setDraft = useChatStore((s) => s.setDraft);
```

### What belongs in Zustand

- Current authenticated user (synced once, then immutable for the session)
- UI state: modal open/closed, sidebar collapsed, theme
- Draft form state that spans multiple components
- Current chat session ID
- Client-only flags (e.g. "show debug panel")

### What does NOT belong in Zustand

- Booking data (server state → TanStack Query)
- Search results (server state)
- Any data fetched from an API
- Any data that's sourced from the database

## Why not Redux?

Redux is the legacy choice in 2026. For new projects:

- Boilerplate overhead (reducers, actions, slices, selectors) vs. Zustand's ~5 lines
- Server state is better handled by TanStack Query anyway
- Redux Toolkit is fine but offers no advantage over Zustand + TanStack Query
- We use the 2026 consensus: Zustand + TanStack Query

## Providers setup

```tsx
// src/providers/Providers.tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,         // 1 min
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
```

Wire this in `src/app/layout.tsx`:

```tsx
import { Providers } from "@/providers/Providers";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

## What NOT to do

- Never mirror server data in Zustand (use TanStack Query directly)
- Never use Redux in new code
- Never fetch inside `useEffect` (use TanStack Query)
- Never share a `QueryClient` across requests in Server Components (create per-request)
- Never put async logic in Zustand actions — do it in the caller
