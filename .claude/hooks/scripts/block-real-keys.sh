#!/bin/bash
# Block any Bash command containing real production API keys in the frontend.

set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [ -z "$COMMAND" ]; then
  exit 0
fi

PATTERNS=(
  "sk_live_"                  # Stripe secret (never in frontend!)
  "pk_live_"                  # Stripe publishable (live)
  "rk_live_"                  # Stripe restricted
  "whsec_live_"               # Stripe webhook secret (never in frontend!)
  "duffel_live_"              # Duffel production
  "SUPABASE_SERVICE_ROLE"     # Service role key — never in frontend
)

for pattern in "${PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qE "$pattern"; then
    jq -n --arg reason "Production/server-only key detected ($pattern). Blocked. Frontend uses only test publishable keys and anon keys." '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: $reason
      }
    }'
    exit 0
  fi
done

exit 0
