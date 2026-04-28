/**
 * Build-mode flag for dev-only UI surfaces.
 *
 * Next.js statically replaces `process.env.NODE_ENV` at build time, so
 * any expression involving it gets dead-code-eliminated in production
 * builds. Importing this constant from a single module keeps the
 * detection in one place and makes tests easy to reason about.
 *
 * Used by:
 *   - `_components/ChatRoot.tsx` to gate `<DevPanel>`
 */

export const DEV_BUILD = process.env.NODE_ENV !== "production";
