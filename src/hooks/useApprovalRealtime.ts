"use client";

/**
 * `useApprovalRealtime` — subscribes to Supabase Realtime `postgres_changes`
 * on the `approval_requests` table, filtered by the approval row's `id`.
 *
 * Seeds state with `initialRow` immediately (no loading flicker — the card
 * renders in pending state on mount), then merges UPDATE payloads in place.
 *
 * When the new status is terminal (`approved` | `rejected` | `expired` |
 * `canceled`), the optional `onDecided` callback fires. Task 14 uses this
 * to resume the SSE chat stream after an approval decision.
 *
 * Auth: calls `supabase.realtime.setAuth(session.access_token)` BEFORE
 * `.subscribe()` to ensure the RLS policy (`to authenticated`) is satisfied.
 * Without this, the subscription registers with `claims_role='anon'` and
 * all postgres_changes events are silently filtered out.
 *
 * Cleanup: mirrors the `cancelled` flag + `removeChannel` async-IIFE
 * pattern from `useChatStream.ts` (lines 786-862) to avoid leaking
 * subscriptions when the component unmounts or `initialRow.id` changes
 * while `getSession()` is still in flight.
 */

import { useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { ApprovalRequestDetails, ApprovalStatus } from "@/hooks/useChatStream";

export type UseApprovalRealtimeResult =
  | { status: "loading"; row: null }
  | { status: "ready"; row: ApprovalRequestDetails }
  | { status: "error"; row: null; error: string };

const TERMINAL_STATUSES: ApprovalStatus[] = [
  "approved",
  "rejected",
  "expired",
  "canceled",
];

export function useApprovalRealtime(
  initialRow: ApprovalRequestDetails,
  options?: { onDecided?: (row: ApprovalRequestDetails) => void },
): UseApprovalRealtimeResult {
  // Seed immediately with initialRow so the card renders in pending state
  // on mount without a loading flicker.
  const [result, setResult] = useState<UseApprovalRealtimeResult>({
    status: "ready",
    row: initialRow,
  });

  // Tracks the latest fully-merged row so `onDecided` always receives an
  // up-to-date snapshot — not the stale `initialRow` — even when an
  // intermediate non-terminal UPDATE arrived before the terminal one.
  const latestRowRef = useRef<ApprovalRequestDetails>(initialRow);

  // Keep a stable ref to the onDecided callback so the effect closure
  // doesn't go stale when the parent re-renders.
  const onDecidedRef = useRef(options?.onDecided);
  useEffect(() => {
    onDecidedRef.current = options?.onDecided;
  }, [options?.onDecided]);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    // Explicitly hydrate the user's JWT into the Realtime client
    // BEFORE `.subscribe()` runs. `@supabase/ssr`'s createBrowserClient
    // reads cookies lazily — the auth listener auto-wire that calls
    // `realtime.setAuth(token)` only fires once `getSession()` /
    // `getUser()` is invoked. Without this `await`, the very first
    // subscribe registers in `realtime.subscription` with
    // `claims_role = 'anon'`, and our RLS policy (which is `to
    // authenticated`) silently filters out every postgres_changes
    // event on UPDATE.
    //
    // The async-IIFE pattern requires a `cancelled` flag: if
    // initialRow.id changes (or the component unmounts) while
    // getSession is in flight, we must NOT subscribe — otherwise
    // the cleanup function above runs before `channel` is assigned
    // and we leak a subscription.
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session) {
        supabase.realtime.setAuth(session.access_token);
      }

      channel = supabase
        .channel(`approval-${initialRow.id}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "approval_requests",
            filter: `id=eq.${initialRow.id}`,
          },
          (payload: { new: Record<string, unknown> }) => {
            const next = payload.new as Partial<ApprovalRequestDetails>;
            // Merge eagerly against the ref (which always holds the latest
            // accumulated row) so we have the merged result synchronously —
            // before React batches the setResult call. This means
            // latestRowRef.current is up-to-date by the time we call
            // onDecided, even if the setResult updater runs later.
            const mergedRow: ApprovalRequestDetails = {
              ...latestRowRef.current,
              ...(next as Partial<ApprovalRequestDetails>),
            };
            latestRowRef.current = mergedRow;

            setResult((prev) => {
              if (prev.status !== "ready") return prev;
              return { status: "ready", row: mergedRow };
            });

            const newStatus = next.status as ApprovalStatus | undefined;
            if (newStatus && TERMINAL_STATUSES.includes(newStatus)) {
              // latestRowRef.current was updated synchronously above —
              // it reflects all intermediate UPDATEs that arrived before
              // this terminal one.
              onDecidedRef.current?.(latestRowRef.current);
            }
          },
        )
        .subscribe((status: string, err?: Error) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            setResult({
              status: "error",
              row: null,
              error: err?.message ?? `Realtime subscription error: ${status}`,
            });
          }
        });

      // The unmount could have happened during `await` — clean up
      // the channel we just created if so.
      if (cancelled && channel) {
        void supabase.removeChannel(channel);
        channel = null;
      }
    })();

    return () => {
      cancelled = true;
      // Fire-and-forget — React's cleanup must be sync; the underlying
      // websocket close runs async on the supabase-js side.
      if (channel) void supabase.removeChannel(channel);
    };
  }, [initialRow.id]);

  return result;
}
