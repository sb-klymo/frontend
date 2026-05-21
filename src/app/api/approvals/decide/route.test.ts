import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock next/headers before importing the route — createSupabaseServerClient
// calls cookies() from next/headers which throws outside the Next.js runtime.
vi.mock("next/headers", () => ({
  cookies: vi.fn(() => ({
    getAll: () => [],
    set: vi.fn(),
  })),
}));

// Mock @supabase/ssr so we control getUser() without real Supabase env vars.
const mockGetUser = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser: mockGetUser },
  })),
}));

// Import the route AFTER mocks are in place.
import { POST } from "./route";

// ── helpers ─────────────────────────────────────────────────────────────────

function makeRequest(
  body: Record<string, unknown> = {
    approval_id: "aaaabbbb-cccc-dddd-eeee-ffffffffffff",
    action: "approve",
  },
): Request {
  return new Request("http://test/api/approvals/decide", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function authedUser(id = "user-uuid-123") {
  mockGetUser.mockResolvedValue({ data: { user: { id } }, error: null });
}

function noUser() {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
}

// ── tests ────────────────────────────────────────────────────────────────────

describe("POST /api/approvals/decide BFF route", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_API_URL: "http://backend-test",
      KLYMO_INTERNAL_SHARED_SECRET: "test-internal-secret",
    };
    mockGetUser.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = originalEnv;
  });

  // ── auth guard ─────────────────────────────────────────────────────────────

  it("returns 401 when no session is available", async () => {
    noUser();

    const response = await POST(makeRequest());

    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.code).toBe("unauthorized");
  });

  // ── env guards ─────────────────────────────────────────────────────────────

  it("returns 500 when NEXT_PUBLIC_API_URL is not set", async () => {
    authedUser();
    delete process.env.NEXT_PUBLIC_API_URL;

    const response = await POST(makeRequest());

    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.code).toBe("misconfigured");
  });

  it("returns 500 when KLYMO_INTERNAL_SHARED_SECRET is not set", async () => {
    authedUser();
    delete process.env.KLYMO_INTERNAL_SHARED_SECRET;

    const response = await POST(makeRequest());

    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.code).toBe("misconfigured");
  });

  // ── validation ─────────────────────────────────────────────────────────────

  it("returns 400 when approval_id is missing", async () => {
    authedUser();

    const response = await POST(makeRequest({ action: "approve" }));

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.code).toBe("bad_request");
  });

  it("returns 400 when action is invalid", async () => {
    authedUser();

    const response = await POST(
      makeRequest({
        approval_id: "aaaabbbb-cccc-dddd-eeee-ffffffffffff",
        action: "confirm",
      }),
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.code).toBe("bad_request");
  });

  // ── forwarding ─────────────────────────────────────────────────────────────

  it("forwards to backend with internal secret (not user JWT)", async () => {
    authedUser("manager-uuid-abc");
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ id: "approval-uuid", status: "approved" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await POST(
      makeRequest({
        approval_id: "aaaabbbb-cccc-dddd-eeee-ffffffffffff",
        action: "approve",
      }),
    );

    expect(global.fetch).toHaveBeenCalledWith(
      "http://backend-test/internal/approvals/aaaabbbb-cccc-dddd-eeee-ffffffffffff/decide",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-internal-secret",
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("puts deciding_user_id from the session into the body (not from the request)", async () => {
    authedUser("manager-uuid-xyz");
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ status: "approved" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await POST(
      makeRequest({
        approval_id: "aaaabbbb-cccc-dddd-eeee-ffffffffffff",
        action: "reject",
        deciding_user_id: "ATTACKER-TRIES-TO-OVERRIDE",
      }),
    );

    const [, init] = vi.mocked(global.fetch).mock.calls[0]!;
    const sentBody = JSON.parse((init as RequestInit).body as string);
    // Must be from the session, not from the request body
    expect(sentBody.deciding_user_id).toBe("manager-uuid-xyz");
    expect(sentBody.action).toBe("reject");
  });

  it("forwards decision_reason when provided", async () => {
    authedUser("manager-uuid-123");
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ status: "rejected" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await POST(
      makeRequest({
        approval_id: "aaaabbbb-cccc-dddd-eeee-ffffffffffff",
        action: "reject",
        decision_reason: "Budget exceeded for Q2",
      }),
    );

    const [, init] = vi.mocked(global.fetch).mock.calls[0]!;
    const sentBody = JSON.parse((init as RequestInit).body as string);
    expect(sentBody.decision_reason).toBe("Budget exceeded for Q2");
  });

  it("omits decision_reason from body when not provided", async () => {
    authedUser("manager-uuid-123");
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ status: "approved" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await POST(
      makeRequest({
        approval_id: "aaaabbbb-cccc-dddd-eeee-ffffffffffff",
        action: "approve",
      }),
    );

    const [, init] = vi.mocked(global.fetch).mock.calls[0]!;
    const sentBody = JSON.parse((init as RequestInit).body as string);
    expect("decision_reason" in sentBody).toBe(false);
  });

  // ── response passthrough ───────────────────────────────────────────────────

  it("returns 200 with backend body on success", async () => {
    authedUser();
    const backendPayload = { id: "approval-uuid", status: "approved" };
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify(backendPayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.status).toBe("approved");
  });

  it("passes through 410 (expired) from backend", async () => {
    authedUser();
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ code: "approval_expired" }), {
        status: 410,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await POST(makeRequest());

    expect(response.status).toBe(410);
    const json = await response.json();
    expect(json.code).toBe("approval_expired");
  });

  it("passes through 409 (already decided) from backend", async () => {
    authedUser();
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ code: "approval_already_decided", message: "Already decided" }),
        {
          status: 409,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const response = await POST(makeRequest());

    expect(response.status).toBe(409);
    const json = await response.json();
    expect(json.code).toBe("approval_already_decided");
  });

  it("passes through 403 (not authorized) from backend", async () => {
    authedUser();
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ code: "not_authorized" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await POST(makeRequest());

    expect(response.status).toBe(403);
  });

  // ── security invariant ─────────────────────────────────────────────────────

  it("never forwards the user JWT to the backend — only the internal secret", async () => {
    // The user's access_token (if it were read) should NOT appear in the
    // Authorization header sent to the backend. We verify by asserting the
    // header value equals the internal secret, not any user token.
    authedUser("user-123");
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ status: "approved" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await POST(makeRequest());

    const [, init] = vi.mocked(global.fetch).mock.calls[0]!;
    const authHeader = (init as RequestInit & { headers: Record<string, string> }).headers
      .Authorization;
    expect(authHeader).toBe("Bearer test-internal-secret");
    // Sanity: must not contain any string that looks like a user token
    expect(authHeader).not.toContain("user");
  });
});
