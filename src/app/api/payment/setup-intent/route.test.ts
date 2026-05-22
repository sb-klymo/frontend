/**
 * Unit tests for `POST /api/payment/setup-intent` BFF route.
 *
 * Verifies that:
 * - Company admins get `target='organization'` + `org_id` forwarded to the backend.
 * - Individual users get `target='user'`.
 * - Company employees (defensive) get `target='user'` — they shouldn't reach
 *   this route in V1, but the fallback is safe.
 * - Auth guard and misconfiguration paths still work.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock next/headers before importing the route.
vi.mock("next/headers", () => ({
  cookies: vi.fn(() => ({
    getAll: () => [],
    set: vi.fn(),
  })),
}));

const mockGetSession = vi.fn();
const mockAdminFrom = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: { getSession: mockGetSession },
  })),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: mockAdminFrom,
  })),
}));

import { POST } from "./route";

// ── helpers ────────────────────────────────────────────────────────────────

function authedSession(token = "test-jwt", userId = "user-uuid-123") {
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: token, user: { id: userId } } },
  });
}

function noSession() {
  mockGetSession.mockResolvedValue({ data: { session: null } });
}

function mockUserContext(ctx: {
  role: string | null;
  organization_id: string | null;
  account_type: string | null;
}) {
  mockAdminFrom.mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: ctx, error: null }),
      }),
    }),
  });
}

function mockUserContextError() {
  mockAdminFrom.mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: null, error: new Error("DB error") }),
      }),
    }),
  });
}

const SETUP_INTENT_RESPONSE = {
  client_secret: "seti_test_secret",
  setup_intent_id: "seti_test_123",
  publishable_key: "pk_test_dummy",
};

// ── tests ──────────────────────────────────────────────────────────────────

describe("POST /api/payment/setup-intent BFF route", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_API_URL: "http://backend-test",
      NEXT_PUBLIC_SUPABASE_URL: "http://supabase-test",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key-test",
    };
    mockGetSession.mockReset();
    mockAdminFrom.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = originalEnv;
  });

  // ── auth guard ────────────────────────────────────────────────────────

  it("returns 401 when no session is available", async () => {
    noSession();

    const response = await POST();

    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.code).toBe("unauthorized");
  });

  it("returns 500 when NEXT_PUBLIC_API_URL is not set", async () => {
    authedSession();
    mockUserContext({ role: "company_admin", organization_id: "org-123", account_type: "company" });
    delete process.env.NEXT_PUBLIC_API_URL;

    const response = await POST();

    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.code).toBe("misconfigured");
  });

  // ── company admin — target=organization ───────────────────────────────

  it("sends target=organization + org_id for company_admin users", async () => {
    const orgId = "org-uuid-456";
    authedSession("admin-jwt", "admin-user-id");
    mockUserContext({
      role: "company_admin",
      organization_id: orgId,
      account_type: "company",
    });
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify(SETUP_INTENT_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await POST();

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://backend-test/payment/setup-intent",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer admin-jwt",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ target: "organization", org_id: orgId }),
      }),
    );
  });

  // ── individual user — target=user ─────────────────────────────────────

  it("sends target=user for individual users", async () => {
    authedSession("individual-jwt", "individual-user-id");
    mockUserContext({
      role: null,
      organization_id: null,
      account_type: "individual",
    });
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify(SETUP_INTENT_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await POST();

    expect(global.fetch).toHaveBeenCalledWith(
      "http://backend-test/payment/setup-intent",
      expect.objectContaining({
        body: JSON.stringify({ target: "user" }),
      }),
    );
  });

  // ── company employee — defensive fallback to target=user ──────────────

  it("sends target=user for company employees (defensive fallback)", async () => {
    // Company employees have account_type='company' but role='employee' (not 'company_admin').
    authedSession("employee-jwt", "employee-user-id");
    mockUserContext({
      role: "employee",
      organization_id: "org-uuid-456",
      account_type: "company",
    });
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify(SETUP_INTENT_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await POST();

    const [, callOptions] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect(callOptions).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const callBody = JSON.parse((callOptions as RequestInit).body as string);
    expect(callBody.target).toBe("user");
    // Employees must NOT have org_id set in target=user mode.
    expect(callBody.org_id).toBeUndefined();
  });

  // ── company admin without organization_id — defensive fallback ─────────

  it("sends target=user when company_admin has no organization_id (defensive)", async () => {
    authedSession("admin-jwt", "admin-user-id");
    mockUserContext({
      role: "company_admin",
      organization_id: null, // no org yet — shouldn't happen in V1 but defensive
      account_type: "company",
    });
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify(SETUP_INTENT_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await POST();

    const [, callOpts2] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect(callOpts2).toBeDefined();
    const callBody2 = JSON.parse((callOpts2 as RequestInit).body as string);
    expect(callBody2.target).toBe("user");
  });

  // ── user context lookup failure — defensive fallback ──────────────────

  it("falls back to target=user when user context lookup fails", async () => {
    authedSession("some-jwt", "some-user-id");
    mockUserContextError();
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify(SETUP_INTENT_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await POST();

    const [, callOpts3] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect(callOpts3).toBeDefined();
    const callBody3 = JSON.parse((callOpts3 as RequestInit).body as string);
    expect(callBody3.target).toBe("user");
  });

  // ── proxy behaviour ───────────────────────────────────────────────────

  it("forwards non-200 backend responses as-is", async () => {
    authedSession();
    mockUserContext({ role: null, organization_id: null, account_type: "individual" });
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ code: "payment_failed" }), {
        status: 402,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await POST();

    expect(response.status).toBe(402);
  });

  it("returns the setup-intent payload on success", async () => {
    authedSession();
    mockUserContext({ role: null, organization_id: null, account_type: "individual" });
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify(SETUP_INTENT_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await POST();

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.client_secret).toBe("seti_test_secret");
    expect(json.setup_intent_id).toBe("seti_test_123");
  });
});
