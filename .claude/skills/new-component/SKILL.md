---
name: new-component
description: Scaffold a React component with typed props, a Vitest test, and Tailwind styling. Arguments - component path (relative to src/components) and whether it needs 'use client'.
---

# New Component

Scaffold a new React component with test + types.

## Usage

`/new-component $ARGUMENTS`

Examples:
- `/new-component ui/Button` (Server Component by default)
- `/new-component features/ChatStream --client` (Client Component — needs 'use client')

## Arguments

- Path (relative to `src/components/`, no extension)
- Optional `--client` flag if it needs interactivity (hooks, events, browser APIs)

## Steps

1. Create `src/components/<path>/<ComponentName>.tsx` using the template.
2. Create `src/components/<path>/<ComponentName>.test.tsx` with React Testing Library.
3. Export from `src/components/<path>/index.ts`.
4. Use it somewhere, or note in the test that it's ready for use.

## Template — Server Component (default)

```tsx
// src/components/<path>/<ComponentName>.tsx
import { cn } from "@/lib/utils";

type Props = {
  children: React.ReactNode;
  className?: string;
};

export function <ComponentName>({ children, className }: Props) {
  return (
    <div className={cn("rounded border p-4", className)}>
      {children}
    </div>
  );
}
```

## Template — Client Component

```tsx
// src/components/<path>/<ComponentName>.tsx
"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

type Props = {
  initialValue?: string;
  onChange?: (value: string) => void;
  className?: string;
};

export function <ComponentName>({ initialValue = "", onChange, className }: Props) {
  const [value, setValue] = useState(initialValue);

  const handleChange = (next: string) => {
    setValue(next);
    onChange?.(next);
  };

  return (
    <input
      className={cn("rounded border px-3 py-2", className)}
      value={value}
      onChange={(e) => handleChange(e.target.value)}
    />
  );
}
```

## Test template

```tsx
// src/components/<path>/<ComponentName>.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { <ComponentName> } from "./<ComponentName>";

describe("<ComponentName>", () => {
  it("renders its children", () => {
    render(<<ComponentName>>Hello</<ComponentName>>);
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });
});
```

## Reminders

- Server Component by default (no `'use client'`)
- Use named exports — never default exports
- Props type inline for small components; extract to `types/` if shared
- Tailwind utility-first; extract when repeated 3+ times
- If the component needs SSE or streaming, mark `'use client'` AND add E2E tests (Vitest can't test async Server Components)
- Always include an `alt` attribute on images
- Use `next/link` for internal navigation, never `<a href>`
